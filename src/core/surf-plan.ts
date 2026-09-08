/**
 * The plan artifact of the submit gate: what an operator reviews, and what an apply run is
 * allowed to address (submit-gate packet §4.1, D1, D2, D14).
 *
 * Pure ring: no I/O. This module owns the artifact's *shape* and the two hashes that make it
 * load-bearing.
 *
 *   - The **approval token** is `sha256` over the RFC 8785 canonical form of what was reviewed:
 *     the origin, every field's resolved selector and intended value, and the submit control's
 *     selector. It binds an approval to content, so an edited plan no longer matches the
 *     approval that was given for it. It is not a secret and confers no authority: whoever can
 *     read the plan can present it (packet, Refinement hazard 3).
 *   - The **fingerprint** is what the page looked like when the plan was written. It is
 *     recomputed against the live page before anything is typed, and a mismatch is `plan_stale`
 *     rather than a heal.
 *
 * The artifact is written 0600 through the kernel artifact writer because it carries the values
 * a run intends to type (architecture review A10).
 */

import { canonicalDigest } from "./canonical-json.js";
import { FrameworkError } from "./runtime-contract.js";

export const SURF_PLAN_KIND = "test-capabilities.surf.plan";
export const SURF_PLAN_SCHEMA_VERSION = 1;

/** How a field is named on the command line: `label:<text>`, `selector:<css>`, `name:<attr>`. */
export const FIELD_LOCATOR_KINDS = ["label", "selector", "name"] as const;
export type FieldLocatorKind = (typeof FIELD_LOCATOR_KINDS)[number];

export interface FieldLocator {
  kind: FieldLocatorKind;
  value: string;
}

/** One `--field <locator>=<value>` request, before the page has been read. */
export interface PlanFieldRequest {
  id: string;
  locator: FieldLocator;
  intendedValue: string;
}

export interface PlanFieldControl {
  tag: string;
  type?: string;
  name?: string;
  form?: string;
}

export interface PlanField {
  id: string;
  locator: FieldLocator;
  resolved_selector: string;
  control: PlanFieldControl;
  current_value: string;
  intended_value: string;
  /** the only way this framework sets a value: through the field's own input (D3) */
  set_via: "field_input";
}

export const SUBMIT_STATUSES = ["identified", "ambiguous", "none"] as const;
export type SubmitStatus = (typeof SUBMIT_STATUSES)[number];

export interface PlanSubmitControl {
  selector: string;
  tag: string;
  type?: string;
  text: string;
  disabled: boolean;
}

export interface PlanSubmitCandidate {
  selector: string;
  text: string;
  /** why this control is a candidate: `explicit_submit`, `implicit_submit`, `submit_selector` */
  reason: string;
}

export interface PlanSubmit {
  status: SubmitStatus;
  /** the gate is closed in the artifact; only `--submit` with a matching token opens it */
  gate: "closed";
  control?: PlanSubmitControl;
  candidates: PlanSubmitCandidate[];
}

export interface PlanForbiddenControl {
  selector: string;
  text: string;
  reason: string;
}

export interface PlanFingerprint {
  url: string;
  form_count: number;
  field_signature: string;
  control_signature: string;
}

export interface PlanTarget {
  url: string;
  origin: string;
  landed_href: string;
  title: string;
  readiness: { state: string; evidence: string[] };
}

export interface PlanRuntime {
  flavor: "surf";
  provider: string;
  version?: string;
}

export interface SurfPlan {
  schema_version: typeof SURF_PLAN_SCHEMA_VERSION;
  artifact_kind: typeof SURF_PLAN_KIND;
  plan_id: string;
  generated_at: string;
  runtime: PlanRuntime;
  target: PlanTarget;
  fields: PlanField[];
  submit: PlanSubmit;
  forbidden_controls: PlanForbiddenControl[];
  fingerprint: PlanFingerprint;
  approval_token: string;
  policy: {
    dry_run_default: true;
    value_via_field_input_only: true;
    never_retry_submit: true;
    approval_binds_to: "content_hash";
    authority: string[];
  };
}

/** The policy block every plan carries: what the artifact promises about how it may be used. */
export const SURF_PLAN_POLICY: SurfPlan["policy"] = {
  dry_run_default: true,
  value_via_field_input_only: true,
  never_retry_submit: true,
  approval_binds_to: "content_hash",
  authority: ["config.mutation.allowOrigins", "apply_runner"],
};

// ============================================
// THE TWO HASHES
// ============================================

/**
 * What the approval token is taken over: the origin acted on, the selector and value of every
 * field, and the control that may be clicked. Everything else in the plan - the plan id, the
 * timestamp, the candidate list, the runtime version - is context an operator reads, not
 * content an approval binds to, so re-planning the same intent yields the same token.
 */
export function approvalTokenContent(plan: {
  target: Pick<PlanTarget, "origin">;
  fields: readonly Pick<PlanField, "resolved_selector" | "intended_value">[];
  submit: Pick<PlanSubmit, "control">;
}): Record<string, unknown> {
  return {
    origin: plan.target.origin,
    fields: plan.fields.map((field) => ({
      resolved_selector: field.resolved_selector,
      intended_value: field.intended_value,
    })),
    submit_selector: plan.submit.control?.selector ?? null,
  };
}

/** `sha256:<hex>` over {@link approvalTokenContent}, canonicalised per RFC 8785 (A11). */
export function approvalTokenFor(plan: Parameters<typeof approvalTokenContent>[0]): string {
  return canonicalDigest(approvalTokenContent(plan));
}

/** The page as the plan saw it: the fields' identity and the buttons around them. */
export function fingerprintFor(input: {
  url: string;
  formCount: number;
  fields: readonly Pick<PlanField, "resolved_selector" | "control">[];
  submitControl: PlanSubmitControl | undefined;
  forbiddenControls: readonly PlanForbiddenControl[];
}): PlanFingerprint {
  return {
    url: input.url,
    form_count: input.formCount,
    field_signature: canonicalDigest(
      input.fields.map((field) => ({
        selector: field.resolved_selector,
        tag: field.control.tag,
        type: field.control.type ?? null,
        name: field.control.name ?? null,
        form: field.control.form ?? null,
      })),
    ),
    control_signature: canonicalDigest({
      submit: input.submitControl
        ? {
            selector: input.submitControl.selector,
            tag: input.submitControl.tag,
            type: input.submitControl.type ?? null,
            text: input.submitControl.text,
          }
        : null,
      forbidden: input.forbiddenControls.map((control) => ({
        selector: control.selector,
        text: control.text,
      })),
    }),
  };
}

/** The fields of a fingerprint that must match before anything is typed; `url` is compared apart. */
export function fingerprintDrift(expected: PlanFingerprint, actual: PlanFingerprint): string[] {
  const drift: string[] = [];
  if (normalizeHref(expected.url) !== normalizeHref(actual.url)) {
    drift.push(`url ${expected.url} -> ${actual.url}`);
  }
  if (expected.form_count !== actual.form_count) {
    drift.push(`form_count ${expected.form_count} -> ${actual.form_count}`);
  }
  if (expected.field_signature !== actual.field_signature) {
    drift.push("field_signature (a field's tag, type, name or owning form changed)");
  }
  if (expected.control_signature !== actual.control_signature) {
    drift.push("control_signature (the submit control or the buttons around it changed)");
  }
  return drift;
}

/** Compare hrefs the way a page moves: the fragment is not a navigation. */
export function normalizeHref(href: string): string {
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    return href;
  }
}

// ============================================
// COMMAND-LINE LOCATORS
// ============================================

function invalidField(spec: string, problem: string, fix: string): FrameworkError {
  return new FrameworkError("config_invalid", `Invalid --field '${spec}': ${problem}. ${fix}`, {
    field: spec,
  });
}

/**
 * Split `<kind>:<locator>=<value>` at the first `=` that is not inside a bracket, so
 * `selector:input[name=q]=surf-cli` names the input and not a truncated selector. A `=` inside
 * the value is kept: only the first eligible separator splits.
 */
function splitFieldSpec(spec: string): { locator: string; value: string } {
  let depth = 0;
  for (let index = 0; index < spec.length; index += 1) {
    const character = spec[index];
    if (character === "[" || character === "(") {
      depth += 1;
      continue;
    }
    if (character === "]" || character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === "=" && depth === 0) {
      return { locator: spec.slice(0, index), value: spec.slice(index + 1) };
    }
  }
  throw invalidField(
    spec,
    "it carries no '=' outside brackets, so the intended value cannot be told from the locator",
    "Write --field '<label|selector|name>:<locator>=<value>'.",
  );
}

/** Parse one `--field` argument into a request, or refuse before the browser is touched. */
export function parseFieldSpec(spec: string, index: number): PlanFieldRequest {
  const { locator, value } = splitFieldSpec(spec);
  const separator = locator.indexOf(":");
  if (separator <= 0) {
    throw invalidField(
      spec,
      `the locator '${locator}' names no kind`,
      `Prefix it with one of ${FIELD_LOCATOR_KINDS.map((kind) => `${kind}:`).join(", ")}.`,
    );
  }
  const kind = locator.slice(0, separator);
  const locatorValue = locator.slice(separator + 1).trim();
  if (!(FIELD_LOCATOR_KINDS as readonly string[]).includes(kind)) {
    throw invalidField(
      spec,
      `'${kind}' is not a locator kind`,
      `Use ${FIELD_LOCATOR_KINDS.map((entry) => `${entry}:`).join(", ")}.`,
    );
  }
  if (locatorValue === "") {
    throw invalidField(spec, "the locator is empty", "Name the field to fill.");
  }
  return {
    id: `f${index + 1}`,
    locator: { kind: kind as FieldLocatorKind, value: locatorValue },
    intendedValue: value,
  };
}

/** The values a checkbox or radio accepts; anything else is refused before the browser. */
export const BOOLEAN_FIELD_VALUES = ["true", "false"] as const;

export function isBooleanControl(control: PlanFieldControl): boolean {
  return control.tag === "input" && (control.type === "checkbox" || control.type === "radio");
}

/** How a value reaches this control: the field's own input, never a form-level button (D3). */
export function setValueCommandFor(control: PlanFieldControl): "type" | "select" | "click" {
  if (control.tag === "select") {
    return "select";
  }
  return isBooleanControl(control) ? "click" : "type";
}

export function describeLocator(locator: FieldLocator): string {
  return `${locator.kind}:${locator.value}`;
}
