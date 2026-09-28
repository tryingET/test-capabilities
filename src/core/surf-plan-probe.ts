/**
 * Reading a form without touching it: the page-side probe behind `surf plan`, and the same
 * probe again at apply time as the drift check (submit-gate packet §4.1, §4.2).
 *
 * The script (`surf-plan-script.ts`) is one pure expression. It reads elements, their identity
 * and their layout and returns facts; it decides nothing. Which control may be clicked, which
 * buttons are forbidden and whether the submit is identified, ambiguous or absent is decided
 * here, in TypeScript, where it is testable and where a fail-closed rule cannot be talked out of
 * by a page.
 */

import { randomUUID } from "node:crypto";
import type {
  BrowserStep,
  Session,
  SessionPlanRequest,
  SessionReadiness,
  SessionReply,
} from "./browser-session.js";
import type { EffectDeclaration } from "./effects.js";
import { frameOriginPath } from "./frame-address.js";
import { FrameworkError } from "./runtime-contract.js";
import type {
  PlanField,
  PlanFieldControl,
  PlanFieldRequest,
  PlanFingerprint,
  PlanForbiddenControl,
  PlanRuntime,
  PlanSubmit,
  PlanSubmitCandidate,
  PlanSubmitControl,
  SurfPlan,
} from "./surf-plan.js";
import {
  approvalTokenFor,
  BOOLEAN_FIELD_VALUES,
  describeLocator,
  fingerprintFor,
  isBooleanControl,
  SURF_PLAN_KIND,
  SURF_PLAN_POLICY,
  SURF_PLAN_SCHEMA_VERSION,
} from "./surf-plan.js";
import type { PlanProbeRequest } from "./surf-plan-script.js";
import { buildPlanProbeScript, SURF_PLAN_PROBE_FIELD } from "./surf-plan-script.js";
import { parseSurfJsonOutput } from "./surf-runtime.js";

/** Page-side script that reads a form's fields, its buttons and its layout, and nothing else. */
export const SURF_PLAN_PROBE_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason:
    "a page-side expression that reads form fields, their identity and the buttons around them",
};

export interface PlanProbeField {
  id: string;
  matches: number;
  selector: string | null;
  tag: string;
  type: string | null;
  name: string | null;
  form: string | null;
  value: string;
  checked: boolean;
  buttonLike: boolean;
}

export interface PlanProbeControl {
  selector: string | null;
  text: string;
  tag: string;
  type: string | null;
  disabled: boolean;
  visible: boolean;
  inOwningForm: boolean;
  candidateKind: "explicit_submit" | "implicit_submit" | null;
  matchesSubmitSelector: boolean;
  buttonLike: boolean;
}

export interface PlanProbeAnswer {
  href: string;
  title: string;
  formCount: number;
  frameCount: number;
  /** the open shadow roots the probe searched; a closed root cannot be searched (AK #6163) */
  shadowRoots: number;
  fields: PlanProbeField[];
  controls: PlanProbeControl[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the probe's own answer back, or refuse: an answer that is not ours proves nothing. */
export function readPlanProbeAnswer(reply: SessionReply, probeId: string): PlanProbeAnswer {
  const { data } = parseSurfJsonOutput(reply.stdout, "js");
  if (!isRecord(data) || data[SURF_PLAN_PROBE_FIELD] !== probeId) {
    throw new FrameworkError(
      "probe_unverified",
      `Surf plan could not read the form: '${reply.display.join(" ")}' answered without this run's probe marker, so nothing about the page is verified.`,
      { probe: "surf.plan" },
    );
  }
  return {
    href: typeof data.href === "string" ? data.href : "",
    title: typeof data.title === "string" ? data.title : "",
    formCount: typeof data.formCount === "number" ? data.formCount : 0,
    frameCount: typeof data.frameCount === "number" ? data.frameCount : 0,
    shadowRoots: typeof data.shadowRoots === "number" ? data.shadowRoots : 0,
    fields: Array.isArray(data.fields) ? (data.fields as PlanProbeField[]) : [],
    controls: Array.isArray(data.controls) ? (data.controls as PlanProbeControl[]) : [],
  };
}

/**
 * The one read-only step both `surf plan` and `surf apply` run to see the form - in `frame` when
 * the form is in one (CDP program S3).
 */
export function planProbeStep(
  id: string,
  probeId: string,
  request: PlanProbeRequest,
  intent: string,
  frame?: BrowserStep<unknown>["frame"],
): BrowserStep<PlanProbeAnswer> {
  return {
    id,
    ...(frame === undefined ? {} : { frame }),
    command: "js",
    // `--no-screenshot`: this probe reads a form, and the surf build would otherwise save a
    // picture of it - values included - to /tmp (submit-gate packet §8).
    args: [buildPlanProbeScript(probeId, request), "--no-screenshot"],
    intent,
    declare: SURF_PLAN_PROBE_EFFECT,
    read: (reply: SessionReply) => readPlanProbeAnswer(reply, probeId),
  };
}

export async function runPlanProbe(
  session: Session,
  id: string,
  probeId: string,
  request: PlanProbeRequest,
  intent: string,
  frame?: BrowserStep<unknown>["frame"],
): Promise<PlanProbeAnswer> {
  return session.step(planProbeStep(id, probeId, request, intent, frame));
}

// ============================================
// POLICY OVER THE FACTS
// ============================================

export interface SubmitDecision {
  submit: PlanSubmit;
  forbidden: PlanForbiddenControl[];
}

function candidateOf(control: PlanProbeControl, reason: string): PlanSubmitCandidate {
  return { selector: control.selector ?? "", text: control.text, reason };
}

function controlOf(control: PlanProbeControl): PlanSubmitControl {
  return {
    selector: control.selector as string,
    tag: control.tag,
    ...(control.type ? { type: control.type } : {}),
    text: control.text,
    disabled: control.disabled,
  };
}

/**
 * Which control - if any - this plan may click.
 *
 * Exactly one visible, addressable candidate is `identified`; zero is `none` (an SPA with no
 * owning form lands here unless `--submit-selector` names one control); two or more is
 * `ambiguous` with the whole list, so the operator can re-plan with a narrower hint. Ambiguity
 * refuses the submit, never the fill: a dry run does not need a button.
 */
export function decideSubmit(answer: PlanProbeAnswer, request: PlanProbeRequest): SubmitDecision {
  const normalizedText = request.submitText?.replace(/\s+/g, " ").trim().toLowerCase();
  const pool = request.submitSelector
    ? answer.controls.filter((control) => control.matchesSubmitSelector && control.buttonLike)
    : answer.controls.filter((control) => control.inOwningForm && control.candidateKind !== null);

  const narrowed =
    normalizedText === undefined
      ? pool
      : pool.filter((control) => control.text.toLowerCase() === normalizedText);

  const visibleCandidates = narrowed.filter((control) => control.visible);
  const addressable = visibleCandidates.filter((control) => control.selector !== null);

  const candidates = visibleCandidates.map((control) =>
    candidateOf(
      control,
      control.selector === null
        ? "no_unique_selector"
        : request.submitSelector
          ? "submit_selector"
          : (control.candidateKind ?? "submit_selector"),
    ),
  );

  const identified = addressable.length === 1 ? (addressable[0] as PlanProbeControl) : undefined;
  const status = identified ? "identified" : addressable.length > 1 ? "ambiguous" : "none";

  const forbidden = answer.controls
    .filter(
      (control) =>
        (control.inOwningForm || control.matchesSubmitSelector) &&
        control.selector !== null &&
        control.selector !== identified?.selector,
    )
    .map((control) => ({
      selector: control.selector as string,
      text: control.text,
      reason: "form_level_button_not_submit",
    }));

  return {
    submit: {
      status,
      gate: "closed",
      ...(identified ? { control: controlOf(identified) } : {}),
      candidates,
    },
    forbidden,
  };
}

/** The control shape a plan field records, from the probe's report. */
export function controlFromProbe(field: PlanProbeField): PlanFieldControl {
  return {
    tag: field.tag,
    ...(field.type ? { type: field.type } : {}),
    ...(field.name ? { name: field.name } : {}),
    ...(field.form ? { form: field.form } : {}),
  };
}

// ============================================
// THE PLAN
// ============================================

/** Where a field that matched nothing was looked for: never more than the probe could read. */
function searched(answer: PlanProbeAnswer): string {
  return `in the gated page's document or its ${answer.shadowRoots} open shadow root(s)`;
}

const CLOSED_ROOTS =
  "Closed shadow roots cannot be read by any page script, so they were not searched and a field inside one is not addressable.";

function fieldRefusal(
  code: string,
  request: PlanFieldRequest,
  problem: string,
  fix: string,
  details: Record<string, unknown> = {},
): FrameworkError {
  return new FrameworkError(
    code,
    `Surf plan refuses field ${request.id} (${describeLocator(request.locator)}): ${problem}. ${fix} Nothing was written and nothing was typed.`,
    { field: request.id, locator: describeLocator(request.locator), ...details },
  );
}

/**
 * One field, from the locator an operator wrote to the selector an apply run may address.
 *
 * Every refusal here happens before the artifact exists, so a plan on disk is one whose fields
 * were all resolved, none of which is a button (D3), and each of which has a selector that
 * resolves to exactly one element.
 */
function planFieldFrom(
  request: PlanFieldRequest,
  report: PlanProbeField | undefined,
  answer: PlanProbeAnswer,
): PlanField {
  if (report === undefined || report.matches === 0) {
    // `planFromSession` diagnoses the page's frames before it gets here and raises the refusal
    // that knows *why* (slice S8). This is the fallback for a direct `buildPlan` caller that
    // never ran a diagnosis: with frames on the page the framework may not say the field is
    // simply absent, so it says the weaker thing.
    if (answer.frameCount > 0) {
      throw fieldRefusal(
        "plan_field_unreachable",
        request,
        `it matched no element ${searched(answer)}, and the page carries ${answer.frameCount} iframe(s) and no frame diagnosis was taken`,
        `A field inside a frame is not addressable from the top document; run the plan through a session so Session.explainUnreachable can say which frames could hold it. ${CLOSED_ROOTS}`,
        {
          frames: answer.frameCount,
          determination: "unavailable",
          shadow_roots: answer.shadowRoots,
        },
      );
    }
    throw fieldRefusal(
      "plan_field_not_found",
      request,
      `it matched no element ${searched(answer)}`,
      `Name a field that exists on this page, or re-run once the form is rendered. ${CLOSED_ROOTS}`,
      { shadow_roots: answer.shadowRoots },
    );
  }
  if (report.matches > 1) {
    throw fieldRefusal(
      "plan_field_ambiguous",
      request,
      `it matched ${report.matches} elements`,
      "Narrow the locator until exactly one element matches; a plan never guesses which one was meant.",
      { matches: report.matches },
    );
  }
  if (report.buttonLike) {
    throw fieldRefusal(
      "value_via_button_refused",
      request,
      `it resolves to a <${report.tag}>${report.type ? ` type=${report.type}` : ""}, which is a control that acts rather than a field that holds a value`,
      "A value is set only through the field's own input; clicking a form-level button is how a draft becomes a submission.",
      { tag: report.tag, ...(report.type ? { type: report.type } : {}) },
    );
  }
  if (report.selector === null) {
    throw fieldRefusal(
      "plan_field_ambiguous",
      request,
      "no CSS selector could be derived that resolves to exactly this element",
      "Give the field an id or a name, or address it with selector:<css> so the apply run can find the same element again.",
    );
  }

  const control = controlFromProbe(report);
  if (isBooleanControl(control) && !BOOLEAN_FIELD_VALUES.includes(request.intendedValue as never)) {
    throw new FrameworkError(
      "config_invalid",
      `Field ${request.id} (${describeLocator(request.locator)}) is a ${report.type}, which holds a checked state rather than text: its intended value must be one of ${BOOLEAN_FIELD_VALUES.join(", ")}.`,
      { field: request.id, control: report.type },
    );
  }

  return {
    id: request.id,
    locator: request.locator,
    resolved_selector: report.selector,
    control,
    current_value: isBooleanControl(control) ? String(report.checked) : report.value,
    intended_value: request.intendedValue,
    set_via: "field_input",
  };
}

export interface PlanBuildContext {
  planId: string;
  generatedAt: string;
  url: string;
  runtime: PlanRuntime;
  readiness: SessionReadiness;
}

/**
 * What a plan needs from the session beyond the `Session` interface: which surf build answered,
 * so the artifact records the runtime it was read with.
 */
export interface PlanCapableSession extends Session {
  readonly runtime: { resolution: { provider: string }; probe: { version?: string } };
}

/** Assemble the reviewable artifact out of one probe answer and the run's own facts. */
export function buildPlan(
  request: SessionPlanRequest,
  answer: PlanProbeAnswer,
  context: PlanBuildContext,
): SurfPlan {
  const reports = new Map(answer.fields.map((field) => [field.id, field]));
  const fields = request.fields.map((field) => planFieldFrom(field, reports.get(field.id), answer));
  const decision = decideSubmit(answer, {
    fields: request.fields,
    ...(request.submitText ? { submitText: request.submitText } : {}),
    ...(request.submitSelector ? { submitSelector: request.submitSelector } : {}),
  });
  // in a frame plan the probe answered from the frame: the page's own facts come from the gate
  const { frame } = request;
  const landedHref = (frame ? undefined : answer.href) || context.readiness.href || context.url;
  const title = (frame ? undefined : answer.title) || context.readiness.title || "";

  const draft = {
    schema_version: SURF_PLAN_SCHEMA_VERSION,
    artifact_kind: SURF_PLAN_KIND,
    plan_id: context.planId,
    generated_at: context.generatedAt,
    runtime: context.runtime,
    target: {
      url: context.url,
      origin: new URL(context.url).origin,
      landed_href: landedHref,
      title,
      readiness: { state: context.readiness.state, evidence: [...context.readiness.evidence] },
      ...(frame
        ? {
            frame: {
              url: frameOriginPath(frame) as string,
              match: "origin_path" as const,
              origin: new URL(frame).origin,
              landed_href: answer.href || frame,
            },
          }
        : {}),
    },
    fields,
    submit: decision.submit,
    forbidden_controls: decision.forbidden,
    fingerprint: fingerprintFor({
      url: frame ? answer.href || frame : landedHref,
      formCount: answer.formCount,
      fields,
      submitControl: decision.submit.control,
      forbiddenControls: decision.forbidden,
    }),
    policy: SURF_PLAN_POLICY,
  };

  return { ...draft, approval_token: approvalTokenFor(draft) } as SurfPlan;
}

/** The probe request that reproduces a plan's fingerprint against the live page. */
export function driftProbeRequestFor(plan: SurfPlan): PlanProbeRequest {
  return {
    fields: plan.fields.map((field) => ({
      id: field.id,
      locator: { kind: "selector" as const, value: field.resolved_selector },
    })),
    ...(plan.submit.control ? { submitSelector: plan.submit.control.selector } : {}),
  };
}

/** Recompute a plan's fingerprint from a probe answer taken at apply time. */
export function fingerprintFromAnswer(plan: SurfPlan, answer: PlanProbeAnswer): PlanFingerprint {
  const reports = new Map(answer.fields.map((field) => [field.id, field]));
  const fields = plan.fields.map((field) => {
    const report = reports.get(field.id);
    return {
      resolved_selector: field.resolved_selector,
      control: report && report.matches === 1 ? controlFromProbe(report) : { tag: "" },
    };
  });
  const decision = decideSubmit(answer, driftProbeRequestFor(plan));
  return fingerprintFor({
    url: answer.href,
    formCount: answer.formCount,
    fields,
    submitControl: decision.submit.control,
    forbiddenControls: decision.forbidden,
  });
}

/** `Session.plan`: one read-only probe, the packet's refusals, then the artifact. */
export async function planFromSession(
  session: PlanCapableSession,
  request: SessionPlanRequest,
): Promise<SurfPlan> {
  const readiness = session.readiness;
  if (readiness === undefined) {
    throw new FrameworkError(
      "page_not_ready",
      `Refusing to plan a form on ${session.url} before the readiness gate ran: a page that has not settled is not a page this run may read.`,
      { url: session.url },
    );
  }
  if (request.frame !== undefined && !frameOriginPath(request.frame)) {
    throw new FrameworkError(
      "config_invalid",
      `A plan names its frame by URL, and '${request.frame}' is not one: the frame's origin is what mutation.allowOrigins has to name before anything in it is typed.`,
      { frame: request.frame },
    );
  }
  const context: PlanBuildContext = {
    planId: request.planId ?? randomUUID(),
    generatedAt: new Date().toISOString(),
    url: session.url,
    runtime: {
      flavor: "surf",
      provider: session.runtime.resolution.provider,
      ...(session.runtime.probe.version ? { version: session.runtime.probe.version } : {}),
    },
    readiness,
  };
  const probeId = randomUUID();
  const answer = await runPlanProbe(
    session,
    "surf.plan.probe:form",
    probeId,
    {
      fields: request.fields,
      ...(request.submitText ? { submitText: request.submitText } : {}),
      ...(request.submitSelector ? { submitSelector: request.submitSelector } : {}),
    },
    `read the form on ${context.url}${request.frame ? ` in frame ${request.frame}` : ""} without changing it`,
    request.frame
      ? { name: frameOriginPath(request.frame) as string, match: "origin_path" }
      : request.channel === "cdp"
        ? "main"
        : undefined,
  );
  await assertFieldsReachable(session, request, answer);
  if (request.frame && frameOriginPath(answer.href) !== frameOriginPath(request.frame)) {
    throw new FrameworkError(
      "action_document_changed",
      "The frame left its addressed origin+path during the plan probe; no plan was written.",
    );
  }
  return buildPlan(request, answer, context);
}

/**
 * A field locator that matched nothing: is it absent, or is it somewhere this framework cannot
 * address from the top document?
 *
 * Before slice S8 the answer was inferred from an iframe count, which named a frame boundary on
 * any page with an ad. Now the same `frame.diagnose` observation the explore gate uses answers
 * it: `excluded` means the page carries no frame the field could be missing into, so the field
 * is simply not there (`plan_field_not_found`); anything else means it might be, and the
 * refusal is `plan_field_unreachable` carrying the determination and the candidate count. The
 * diagnosis is read once for the page whatever the number of unresolved fields.
 */
async function assertFieldsReachable(
  session: Session,
  request: SessionPlanRequest,
  answer: PlanProbeAnswer,
): Promise<void> {
  const reports = new Map(answer.fields.map((field) => [field.id, field]));
  const unresolved = request.fields.filter((field) => (reports.get(field.id)?.matches ?? 0) === 0);
  if (unresolved.length === 0) {
    return;
  }

  const first = unresolved[0] as PlanFieldRequest;
  if (request.frame !== undefined) {
    // the operator named the frame and the probe read it: there is no boundary left to diagnose
    throw fieldRefusal(
      "plan_field_not_found",
      first,
      `it matched no element in frame ${request.frame}`,
      "Name a field that exists in that frame, or re-run once the form is rendered.",
      { frame: request.frame },
    );
  }
  const rootCause = await session.explainUnreachable(describeLocator(first.locator));
  const determination = rootCause.determination.value;
  if (determination === "excluded") {
    throw fieldRefusal(
      "plan_field_not_found",
      first,
      `it matched no element ${searched(answer)}, and the page carries no frame it could be missing into`,
      `Name a field that exists on this page, or re-run once the form is rendered. ${CLOSED_ROOTS}`,
      { determination, shadow_roots: answer.shadowRoots },
    );
  }
  throw fieldRefusal(
    "plan_field_unreachable",
    first,
    `it matched no element ${searched(answer)}, and the frame diagnosis is '${determination}' (${rootCause.candidates.length} candidate frame(s))`,
    `A field inside a frame is not addressable from the top document; resolve the frame boundary before planning against it. ${CLOSED_ROOTS}`,
    { determination, candidates: rootCause.candidates.length, shadow_roots: answer.shadowRoots },
  );
}
