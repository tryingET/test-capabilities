/**
 * Reading a form without touching it: the page-side probe behind `surf plan`, and the same
 * probe again at apply time as the drift check (submit-gate packet §4.1, §4.2).
 *
 * The script is one pure expression. It reads elements, their identity and their layout and
 * returns facts; it decides nothing. Which control may be clicked, which buttons are forbidden
 * and whether the submit is identified, ambiguous or absent is decided here, in TypeScript,
 * where it is testable and where a fail-closed rule cannot be talked out of by a page.
 *
 * The script is declared `read_only`, so the session checks it against the `js` denylist before
 * a process exists: it never assigns to a document property, a field value or `location`, and
 * never calls `click`, `submit`, `dispatchEvent` or `fetch`.
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
import { FrameworkError } from "./runtime-contract.js";
import type {
  FieldLocator,
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
import { parseSurfJsonOutput } from "./surf-runtime.js";

export const SURF_PLAN_PROBE_FIELD = "__testCapabilitiesSurfPlanProbe";

/** Page-side script that reads a form's fields, its buttons and its layout, and nothing else. */
export const SURF_PLAN_PROBE_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason:
    "a page-side expression that reads form fields, their identity and the buttons around them",
};

export interface PlanProbeFieldRequest {
  id: string;
  locator: FieldLocator;
}

export interface PlanProbeRequest {
  fields: readonly PlanProbeFieldRequest[];
  submitText?: string;
  submitSelector?: string;
}

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
  fields: PlanProbeField[];
  controls: PlanProbeControl[];
}

/**
 * The probe expression. Every value it embeds is JSON, so a selector or a label carrying a
 * quote cannot end the string it sits in.
 */
export function buildPlanProbeScript(probeId: string, request: PlanProbeRequest): string {
  const spec = JSON.stringify({
    probeId,
    fields: request.fields.map((field) => ({
      id: field.id,
      kind: field.locator.kind,
      value: field.locator.value,
    })),
    submitSelector: request.submitSelector ?? null,
    submitText: request.submitText ?? null,
  });

  return `(() => {
  const spec = ${spec};
  const norm = (value) => String(value === null || value === undefined ? '' : value).replace(/\\s+/g, ' ').trim();
  const all = (selector) => { try { return Array.prototype.slice.call(document.querySelectorAll(selector)); } catch (error) { return []; } };
  const unique = (selector, el) => { const found = all(selector); return found.length === 1 && found[0] === el; };
  const tagOf = (el) => norm(el && el.tagName).toLowerCase();
  const attr = (el, name) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(name) : null);
  const typeOf = (el) => { const value = norm(el && el.type).toLowerCase(); return value === '' ? null : value; };
  const idSelector = (el) => { const id = el && el.id; return typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) ? '#' + id : null; };
  const selectorFor = (el, fallback) => {
    if (!el) return null;
    const candidates = [];
    const byId = idSelector(el);
    if (byId) candidates.push(byId);
    const name = typeof el.name === 'string' ? el.name : '';
    if (/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) candidates.push(tagOf(el) + '[name="' + name + '"]');
    if (fallback) candidates.push(fallback);
    for (let index = 0; index < candidates.length; index += 1) { if (unique(candidates[index], el)) return candidates[index]; }
    return null;
  };
  const visible = (el) => {
    if (!el) return false;
    if (el.hidden === true) return false;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    if (rect) return rect.width > 0 || rect.height > 0;
    return el.offsetParent !== null && el.offsetParent !== undefined;
  };
  const buttonLike = (el) => {
    const tag = tagOf(el);
    if (tag === 'button' || tag === 'a') return true;
    if (norm(attr(el, 'role')).toLowerCase() === 'button') return true;
    if (tag === 'input') { const type = typeOf(el) || 'text'; return ['submit', 'button', 'image', 'reset'].indexOf(type) >= 0; }
    return false;
  };
  const textOf = (el) => {
    const label = norm(attr(el, 'aria-label'));
    if (label !== '') return label;
    const own = norm(el && el.textContent);
    if (own !== '') return own;
    if (tagOf(el) === 'input') return norm(attr(el, 'value'));
    return '';
  };
  const fieldsSelector = 'input,textarea,select';
  const controlSelector = 'button,input[type="submit"],input[type="button"],input[type="image"],input[type="reset"],[role="button"]';
  const resolve = (field) => {
    if (field.kind === 'selector') return all(field.value);
    if (field.kind === 'name') return all(fieldsSelector).filter((el) => typeof el.name === 'string' && el.name === field.value);
    const labelled = all('label')
      .filter((el) => norm(el.textContent) === norm(field.value))
      .map((el) => el.control || (el.htmlFor ? document.getElementById(el.htmlFor) : null))
      .filter((el) => el !== null && el !== undefined);
    if (labelled.length > 0) return labelled;
    return all(fieldsSelector).filter((el) => norm(attr(el, 'aria-label')) === norm(field.value));
  };
  const resolved = spec.fields.map((field) => {
    const matches = resolve(field);
    const el = matches.length === 1 ? matches[0] : null;
    return {
      id: field.id,
      element: el,
      report: {
        id: field.id,
        matches: matches.length,
        selector: el ? selectorFor(el, field.kind === 'selector' ? field.value : null) : null,
        tag: el ? tagOf(el) : '',
        type: el ? typeOf(el) : null,
        name: el && typeof el.name === 'string' && el.name !== '' ? el.name : null,
        form: el && el.form ? selectorFor(el.form, null) : null,
        value: el && typeof el.value === 'string' ? el.value : '',
        checked: Boolean(el && el.checked),
        buttonLike: el ? buttonLike(el) : false,
      },
    };
  });
  const owner = resolved.map((entry) => entry.element).filter((el) => el)[0];
  const owningForm = owner && owner.form ? owner.form : null;
  const submitMatches = spec.submitSelector ? all(spec.submitSelector) : [];
  const controlNodes = all(controlSelector);
  const scope = controlNodes.concat(submitMatches.filter((el) => controlNodes.indexOf(el) < 0));
  const controls = scope.map((el) => {
    const tag = tagOf(el);
    const type = typeOf(el);
    const inOwningForm = Boolean(owningForm && el.form === owningForm);
    let candidateKind = null;
    if (tag === 'button' && (type === 'submit' || type === null)) candidateKind = type === 'submit' ? 'explicit_submit' : 'implicit_submit';
    if (tag === 'input' && type === 'submit') candidateKind = 'explicit_submit';
    return {
      selector: selectorFor(el, null),
      text: textOf(el),
      tag: tag,
      type: type,
      disabled: el.disabled === true,
      visible: visible(el),
      inOwningForm: inOwningForm,
      candidateKind: candidateKind,
      matchesSubmitSelector: submitMatches.indexOf(el) >= 0,
      buttonLike: buttonLike(el),
    };
  });
  return {
    ${SURF_PLAN_PROBE_FIELD}: spec.probeId,
    href: location.href,
    title: document.title,
    formCount: all('form').length,
    frameCount: all('iframe').length,
    fields: resolved.map((entry) => entry.report),
    controls: controls,
  };
})()`;
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
    fields: Array.isArray(data.fields) ? (data.fields as PlanProbeField[]) : [],
    controls: Array.isArray(data.controls) ? (data.controls as PlanProbeControl[]) : [],
  };
}

/** The one read-only step both `surf plan` and `surf apply` run to see the form. */
export function planProbeStep(
  id: string,
  probeId: string,
  request: PlanProbeRequest,
  intent: string,
): BrowserStep<PlanProbeAnswer> {
  return {
    id,
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
): Promise<PlanProbeAnswer> {
  return session.step(planProbeStep(id, probeId, request, intent));
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
        `it matched no element on the gated page, which carries ${answer.frameCount} iframe(s), and no frame diagnosis was taken`,
        "A field inside a frame or a shadow root is not addressable from the top document; run the plan through a session so Session.explainUnreachable can say which frames could hold it.",
        { frames: answer.frameCount, determination: "unavailable" },
      );
    }
    throw fieldRefusal(
      "plan_field_not_found",
      request,
      "it matched no element on the gated page",
      "Name a field that exists on this page, or re-run once the form is rendered.",
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
  const landedHref = answer.href || context.readiness.href || context.url;

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
      title: answer.title || context.readiness.title || "",
      readiness: { state: context.readiness.state, evidence: [...context.readiness.evidence] },
    },
    fields,
    submit: decision.submit,
    forbidden_controls: decision.forbidden,
    fingerprint: fingerprintFor({
      url: landedHref,
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
    `read the form on ${context.url} without changing it`,
  );
  await assertFieldsReachable(session, request, answer);
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
  const rootCause = await session.explainUnreachable(describeLocator(first.locator));
  const determination = rootCause.determination.value;
  if (determination === "excluded") {
    throw fieldRefusal(
      "plan_field_not_found",
      first,
      "it matched no element on the gated page, which carries no frame it could be missing into",
      "Name a field that exists on this page, or re-run once the form is rendered.",
      { determination },
    );
  }
  throw fieldRefusal(
    "plan_field_unreachable",
    first,
    `it matched no element in the top document, and the frame diagnosis is '${determination}' (${rootCause.candidates.length} candidate frame(s))`,
    "A field inside a frame or a shadow root is not addressable from the top document; resolve the frame boundary before planning against it.",
    { determination, candidates: rootCause.candidates.length },
  );
}
