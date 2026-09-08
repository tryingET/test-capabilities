/**
 * The apply runner: the whole surface a `surf apply` run has on a browser (submit-gate packet
 * §4.3, D8, D16; adjudication claim 36).
 *
 * This is the load-bearing layer of the packet, and it is load-bearing because of what it does
 * *not* have. There is no `click(selector)`, no `type(..., {submit})`, no `press`, no `key`, no
 * `do`, no coordinate click and no way to name an element that is not a field of the plan the
 * runner was built from: `setValue` takes a field *id*, and the selector it resolves to comes
 * from the artifact, not from the caller. A `forbidden_controls[]` selector is therefore not
 * expressible as an argument to any method here.
 *
 * `clickSubmit` exists only when the runner was built in submit mode from a plan whose submit
 * control is identified - the fill-mode runner does not carry the property at all, at the type
 * level and at runtime - and it consumes itself, so a second call throws before anything is
 * emitted. That is the invariant that still holds when the operator approves the wrong plan,
 * when the allowlist is wrong and when the page drifts (packet, Mode 3, hazard 1).
 *
 * The runner owns the session. The operation that uses it never holds one, so it has no
 * `evaluate`, no `step` and no way around the addressable set.
 */

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  ApplyFieldResult,
  ApplyMode,
  ApplyObservation,
  ApplyRunner,
  OwnedTab,
  Session,
  SessionReadiness,
  SessionReply,
  SubmitApplyRunner,
} from "./browser-session.js";
import type { EffectAttempt, EffectDeclaration, EffectSettlement } from "./effects.js";
import type { RunContext } from "./run-context.js";
import { FrameworkError } from "./runtime-contract.js";
import { settleSurfAttempt } from "./surf-adapter.js";
import type { PlanField, SurfPlan } from "./surf-plan.js";
import {
  fingerprintDrift,
  isBooleanControl,
  normalizeHref,
  setValueCommandFor,
} from "./surf-plan.js";
import { driftProbeRequestFor, fingerprintFromAnswer, runPlanProbe } from "./surf-plan-probe.js";
import { parseSurfJsonOutput } from "./surf-runtime.js";

const APPLY_READ_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason: "a page-side expression that reads a planned field's value and where the page is",
};

const APPLY_PROBE_FIELD = "__testCapabilitiesSurfApplyProbe";

/** Where the post-condition of a submit is looked for, and what would satisfy it. */
export interface PostCondition {
  kind: "url_prefix" | "text" | "left_url";
  expected: string;
}

export interface PostConditionResult {
  kind: PostCondition["kind"];
  expected: string;
  observed: string | undefined;
  satisfied: boolean;
}

export interface ApplyRunnerOptions {
  context: RunContext;
  plan: SurfPlan;
  mode: ApplyMode;
  /** the bounded wait for a submit control that is disabled until the form validates */
  controlEnableTimeoutMs?: number;
  /** the bounded wait for the effect the operator expects to see after the one click */
  postconditionTimeoutMs?: number;
  postCondition?: PostCondition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A surf call as the envelope shows it: the verb and what it addressed, never the value. */
function redactedCall(command: string, selector: string | undefined): string {
  return selector === undefined ? command : `${command} ${selector}`;
}

function fieldReadScript(probeId: string, selector: string): string {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return { ${APPLY_PROBE_FIELD}: ${JSON.stringify(probeId)}, href: location.href, found: el !== null, value: el && typeof el.value === 'string' ? el.value : null, checked: Boolean(el && el.checked) }; })()`;
}

function observeScript(
  probeId: string,
  submitSelector: string | undefined,
  formSelector: string | undefined,
  text: string | undefined,
): string {
  const submit = JSON.stringify(submitSelector ?? null);
  const form = JSON.stringify(formSelector ?? null);
  const needle = JSON.stringify(text ?? null);
  return `(() => {
  const submitSelector = ${submit};
  const formSelector = ${form};
  const needle = ${needle};
  const found = submitSelector ? Array.prototype.slice.call(document.querySelectorAll(submitSelector)) : [];
  const body = document.body && typeof document.body.innerText === 'string' ? document.body.innerText : '';
  return {
    ${APPLY_PROBE_FIELD}: ${JSON.stringify(probeId)},
    href: location.href,
    submitCount: found.length,
    submitDisabled: found.length === 1 ? found[0].disabled === true : null,
    formPresent: formSelector ? document.querySelectorAll(formSelector).length > 0 : null,
    textPresent: needle === null ? null : body.indexOf(needle) >= 0,
  };
})()`;
}

/** The pages this run gated; a reply that answers from anywhere else is the page moving. */
function acceptedHrefs(plan: SurfPlan): Set<string> {
  return new Set(
    [plan.target.url, plan.target.landed_href, plan.fingerprint.url].map((href) =>
      normalizeHref(href),
    ),
  );
}

export function evaluatePostCondition(
  condition: PostCondition,
  observation: ApplyObservation,
  startedFrom: string,
): PostConditionResult {
  const href = observation.href;
  const base = { kind: condition.kind, expected: condition.expected, observed: href };
  if (!observation.available || href === undefined) {
    return { ...base, satisfied: false };
  }
  if (condition.kind === "url_prefix") {
    return { ...base, satisfied: href.startsWith(condition.expected) };
  }
  if (condition.kind === "text") {
    return { ...base, satisfied: observation.detail === "text-present" };
  }
  return { ...base, satisfied: normalizeHref(href) !== normalizeHref(startedFrom) };
}

/**
 * Build the runner over an open, gated session. The fill-mode runner is a frozen object without
 * `clickSubmit`; the submit-mode runner has it exactly when the plan identified a control.
 */
export function createApplyRunner(
  session: Session,
  readiness: SessionReadiness,
  options: ApplyRunnerOptions,
): ApplyRunner | SubmitApplyRunner {
  const { plan, mode, context } = options;
  const calls: string[] = [];
  const accepted = acceptedHrefs(plan);
  const submitControl = plan.submit.status === "identified" ? plan.submit.control : undefined;
  const formSelector = plan.fields[0]?.control.form;
  const controlEnableTimeoutMs =
    options.controlEnableTimeoutMs ?? context.config.surf.submit.controlEnableTimeoutMs;
  const postconditionTimeoutMs =
    options.postconditionTimeoutMs ?? context.config.surf.submit.postconditionTimeoutMs;
  const postCondition: PostCondition = options.postCondition ?? {
    kind: "left_url",
    expected: plan.target.landed_href,
  };
  let submitConsumed = false;

  const fieldOf = (fieldId: string): PlanField => {
    const field = plan.fields.find((entry) => entry.id === fieldId);
    if (field === undefined) {
      throw new FrameworkError(
        "plan_field_not_found",
        `The apply runner was asked for field '${fieldId}', which this plan does not carry. A runner addresses the plan's own fields and nothing else.`,
        { plan_id: plan.plan_id, field: fieldId },
      );
    }
    return field;
  };

  const sideEffect = (field: PlanField | undefined, detail: string): FrameworkError =>
    new FrameworkError(
      "fill_side_effect_observed",
      `The page acted on its own while filling${field ? ` field ${field.id} (${field.resolved_selector})` : ""}: ${detail}. A dry run that moves the page is a failed dry run, never a passed one; nothing further was set and the tab is closed.`,
      { plan_id: plan.plan_id, ...(field ? { field: field.id } : {}), detail },
    );

  /**
   * A reply that reports a URL the run never gated is the page acting on its own.
   *
   * It is best-effort on purpose: the surf build answers `type` with the plain text `OK` and a
   * screenshot line rather than JSON (verified live, 2026-09-08), so a reply that carries no
   * parsable payload teaches nothing here and the observation step after the field is what
   * catches the navigation. What this check adds is the case where the reply *does* name a
   * page - then the receipt for the act itself settles `failed`.
   */
  const assertStayed = (field: PlanField, reply: SessionReply): void => {
    let parsed: unknown;
    try {
      parsed = parseSurfJsonOutput(reply.stdout, reply.command).data;
    } catch {
      return;
    }
    const href = isRecord(parsed) && typeof parsed.url === "string" ? parsed.url : undefined;
    if (href !== undefined && !accepted.has(normalizeHref(href))) {
      throw sideEffect(field, `setting it navigated the tab to ${href}`);
    }
  };

  const readField = async (field: PlanField): Promise<ApplyFieldResult> => {
    const probeId = randomUUID();
    calls.push(redactedCall("js", `read-back ${field.resolved_selector}`));
    // `--no-screenshot`: a read-back names the value it read, and the surf build would save a
    // picture of the page - with that value in it - to /tmp (packet §8).
    const answer = await session.step<Record<string, unknown>>({
      command: "js",
      args: [fieldReadScript(probeId, field.resolved_selector), "--no-screenshot"],
      declare: APPLY_READ_EFFECT,
      id: `surf.apply.readback:${plan.plan_id}:${field.id}`,
      intent: `read back what field ${field.id} holds`,
      read: (reply: SessionReply) => {
        const parsed = parseSurfJsonOutput(reply.stdout, "js").data;
        if (!isRecord(parsed) || parsed[APPLY_PROBE_FIELD] !== probeId) {
          throw new FrameworkError(
            "field_readback_mismatch",
            `Field ${field.id} (${field.resolved_selector}) could not be read back: the page answered without this run's probe marker.`,
            { plan_id: plan.plan_id, field: field.id },
          );
        }
        return parsed;
      },
    });

    const boolean = isBooleanControl(field.control);
    const actual = boolean ? String(answer.checked === true) : ((answer.value as string) ?? "");
    return {
      id: field.id,
      resolved_selector: field.resolved_selector,
      set_via: field.set_via,
      set: true,
      read_back: answer.found === true,
      matched: answer.found === true && actual === field.intended_value,
    };
  };

  const observe = async (): Promise<ApplyObservation> => {
    const probeId = randomUUID();
    calls.push(redactedCall("js", "observe"));
    try {
      const answer = await session.step<Record<string, unknown>>({
        command: "js",
        args: [
          observeScript(
            probeId,
            submitControl?.selector,
            formSelector,
            postCondition.kind === "text" ? postCondition.expected : undefined,
          ),
          "--no-screenshot",
        ],
        declare: APPLY_READ_EFFECT,
        id: `surf.apply.observe:${plan.plan_id}`,
        intent: "read where the page is and whether the form is still there",
        read: (reply: SessionReply) => {
          const parsed = parseSurfJsonOutput(reply.stdout, "js").data;
          if (!isRecord(parsed) || parsed[APPLY_PROBE_FIELD] !== probeId) {
            throw new FrameworkError(
              "fill_side_effect_observed",
              "The page answered an observation without this run's probe marker, so where it is cannot be established.",
              { plan_id: plan.plan_id },
            );
          }
          return parsed;
        },
      });
      return {
        available: true,
        href: typeof answer.href === "string" ? answer.href : undefined,
        ...(typeof answer.submitCount === "number"
          ? { submitPresent: answer.submitCount > 0, submitUnique: answer.submitCount === 1 }
          : {}),
        ...(typeof answer.submitDisabled === "boolean"
          ? { submitDisabled: answer.submitDisabled }
          : {}),
        ...(typeof answer.formPresent === "boolean" ? { formPresent: answer.formPresent } : {}),
        ...(answer.textPresent === true ? { detail: "text-present" } : {}),
      };
    } catch (error) {
      return {
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const base: ApplyRunner = {
    planId: plan.plan_id,
    mode,
    readiness,
    get tab(): OwnedTab | undefined {
      return session.tab;
    },

    async fingerprint(): Promise<{ drift: string[] }> {
      calls.push(redactedCall("js", "fingerprint"));
      const answer = await runPlanProbe(
        session,
        `surf.apply.probe:${plan.plan_id}`,
        randomUUID(),
        driftProbeRequestFor(plan),
        `check the page still matches plan ${plan.plan_id} before anything is typed`,
      );
      return { drift: fingerprintDrift(plan.fingerprint, fingerprintFromAnswer(plan, answer)) };
    },

    async setValue(fieldId: string): Promise<void> {
      const field = fieldOf(fieldId);
      const command = setValueCommandFor(field.control);

      if (command === "click") {
        // A checkbox or radio is set by clicking the input itself, and only when it does not
        // already hold the intended state: an unnecessary click is an unnecessary mutation.
        const before = await readField(field);
        if (before.matched) {
          return;
        }
      }

      // `--no-screenshot`: the surf build saves a screenshot to /tmp after every value-setting
      // verb, which is a copy of the value outside the 0600 artifacts (packet §8).
      const args =
        command === "type"
          ? [field.intended_value, "--selector", field.resolved_selector, "--no-screenshot"]
          : command === "select"
            ? [field.resolved_selector, field.intended_value, "--no-screenshot"]
            : ["--selector", field.resolved_selector, "--no-screenshot"];
      calls.push(redactedCall(command, field.resolved_selector));

      await session.step<SessionReply>({
        id: `surf.apply.field:${plan.plan_id}:${field.id}`,
        command,
        args,
        intent: `set field ${field.id} through its own input on ${plan.target.origin}`,
        details: {
          plan_id: plan.plan_id,
          mode: "fill",
          apply_mode: mode,
          field: {
            id: field.id,
            resolved_selector: field.resolved_selector,
            set_via: field.set_via,
          },
          surf_calls: [redactedCall(command, field.resolved_selector)],
        },
        read: (reply: SessionReply) => {
          assertStayed(field, reply);
          return reply;
        },
      });
    },

    async readBack(fieldId: string): Promise<ApplyFieldResult> {
      return readField(fieldOf(fieldId));
    },

    observe,

    surfCalls(): readonly string[] {
      return [...calls];
    },

    notes(): readonly string[] {
      return session.notes();
    },

    async close(): Promise<void> {
      await session.close();
    },
  };

  if (mode !== "submit" || submitControl === undefined) {
    // No `clickSubmit` property at all: the capability is absent, not disabled.
    return Object.freeze(base);
  }

  const control = submitControl;

  /** The bounded wait on `disabled`, then the checks that the control is still the plan's. */
  const assertControlReady = async (): Promise<void> => {
    const deadline = Date.now() + controlEnableTimeoutMs;
    let observation = await observe();
    while (observation.submitDisabled === true && Date.now() < deadline) {
      await sleep(250);
      observation = await observe();
    }
    if (!observation.available) {
      // The click is the one act that cannot be undone, so it is not sent on a page this run
      // could not read: an unreadable page is a changed page as far as the gate is concerned.
      throw new FrameworkError(
        "submit_control_changed",
        `The page could not be read before clicking ${control.selector} (${observation.detail ?? "no answer"}), so the control cannot be confirmed as the one the plan reviewed. Nothing was clicked.`,
        { plan_id: plan.plan_id, control: control.selector },
      );
    }
    if (observation.submitUnique !== true) {
      throw new FrameworkError(
        "submit_control_changed",
        `The submit control ${control.selector} no longer resolves to exactly one element on ${plan.target.origin} (${observation.submitPresent === false ? "it is gone" : "several match"}). The plan named one control; nothing else may be clicked, so this apply refuses instead of choosing.`,
        { plan_id: plan.plan_id, control: control.selector },
      );
    }
    if (observation.formPresent === false) {
      throw new FrameworkError(
        "submit_control_changed",
        `The form the planned fields belong to (${formSelector}) is no longer on the page, so the control ${control.selector} is not the one the plan reviewed.`,
        { plan_id: plan.plan_id, control: control.selector, form: formSelector },
      );
    }
    if (observation.submitDisabled === true) {
      throw new FrameworkError(
        "submit_control_disabled",
        `The submit control ${control.selector} was still disabled after ${controlEnableTimeoutMs}ms. Raise surf.submit.controlEnableTimeoutMs if this form validates slowly, or fix the values the plan intends; nothing was clicked.`,
        { plan_id: plan.plan_id, control: control.selector, waited_ms: controlEnableTimeoutMs },
      );
    }
  };

  /**
   * The click, and only the click. It is settled `unknown` on purpose: the click reached the
   * page, and whether it took effect is what the post-condition - this step's `verify` - is
   * for. A promotion needs the observation the operator declared; anything else leaves the
   * receipt `unknown`, which is terminal and never retried (packet D5, School 6).
   */
  const submitRunner: SubmitApplyRunner = {
    ...base,
    async clickSubmit() {
      if (submitConsumed) {
        throw new FrameworkError(
          "submit_already_attempted",
          `The submit for plan ${plan.plan_id} was already clicked by this runner. clickSubmit consumes itself: a second call cannot emit anything.`,
          { plan_id: plan.plan_id },
        );
      }
      submitConsumed = true;
      await assertControlReady();

      const startedFrom = plan.target.landed_href;
      let observed: ApplyObservation = { available: false };
      let result: PostConditionResult = {
        kind: postCondition.kind,
        expected: postCondition.expected,
        observed: undefined,
        satisfied: false,
      };

      const settle = (attempt: EffectAttempt<SessionReply>): EffectSettlement =>
        attempt.error === undefined
          ? { outcome: "unknown", evidence: ["click sent; post-condition not observed yet"] }
          : settleSurfAttempt(attempt);

      calls.push(redactedCall("click", control.selector));
      await session.step<SessionReply>({
        id: `surf.apply.submit:${plan.plan_id}`,
        command: "click",
        args: ["--selector", control.selector, "--no-screenshot"],
        intent: `click the one control plan ${plan.plan_id} identified on ${plan.target.origin}`,
        details: {
          plan_id: plan.plan_id,
          mode: "submit",
          apply_mode: mode,
          submit: {
            control: control.selector,
            post_condition: { kind: postCondition.kind, expected: postCondition.expected },
          },
          surf_calls: [redactedCall("click", control.selector)],
        },
        settle,
        read: (reply: SessionReply) => reply,
        verify: async () => {
          const deadline = Date.now() + postconditionTimeoutMs;
          for (;;) {
            observed = await observe();
            result = evaluatePostCondition(postCondition, observed, startedFrom);
            if (result.satisfied || Date.now() >= deadline) {
              break;
            }
            await sleep(250);
          }
          return result.satisfied
            ? {
                result: "applied" as const,
                evidence: [
                  `post-condition ${result.kind} satisfied`,
                  `observed ${result.observed ?? "(nothing)"}`,
                ],
              }
            : {
                result: "indeterminate" as const,
                evidence: [
                  `post-condition ${result.kind} not observed within ${postconditionTimeoutMs}ms`,
                ],
              };
        },
      });

      return { clicked: true as const, observed };
    },
  };

  return Object.freeze(submitRunner);
}
