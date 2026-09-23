/**
 * The framework's error-code registry.
 *
 * Pure ring: no I/O, no imports outside this file. Every code the framework raises itself is
 * registered here as a namespaced `as const` array; `tests/error_codes_contract.test.mjs`
 * asserts uniqueness across the namespaces and that every `new FrameworkError("<code>"` literal
 * in `src/` uses a registered code (architecture review A6, Q5). Each slice appends one array.
 *
 * Codes that come from a tool the framework does not own (surf's `page_login`, an HTTP status)
 * pass through verbatim and are never rewritten; `SURF_PASSTHROUGH_CODES` documents the set the
 * result classifier expects to see, without closing it.
 */

/** Refusals raised because a surface is outside the current capability contract. */
export const CAPABILITY_ERROR_CODES = [
  "unsupported_command",
  "unsupported_surf_action",
  "unsupported_option",
  "unsupported_agent_type",
  "unsupported_intelligence",
  "unsupported_config_section",
  "invalid_route_payload",
] as const;

/** Errors the CLI renders when the failure carries no more specific registered code. */
export const CLI_ERROR_CODES = [
  /** a config file or CLI input failed its schema (zod issues land in `details.issues`) */
  "config_invalid",
  /** `--config` (or the default path) names a file that does not exist */
  "config_not_found",
  /** the framework raised an error the registry does not name yet; never a target verdict */
  "unclassified_error",
] as const;

/**
 * Refusals the surf explore step list raises when a page cannot be probed. They travel as
 * `FrameworkError` codes so the CLI envelope, the surf agent and the report all read the same
 * word for the same refusal (adjudication claim 45).
 */
export const EXPLORE_ERROR_CODES = [
  /** `wait.ready` settled on a state the operation cannot probe and no marker declared it */
  "page_not_ready",
  /** a probe produced no verified browser evidence, so no coverage may be claimed from it */
  "probe_unverified",
] as const;

/**
 * The mutation-safety refusals (mutation-safety packet, "Error codes"; slice S5). Every one of
 * them is raised *before* an effect, except `mutation_outcome_unknown` and
 * `read_only_violation_observed`, which are raised after an attempt whose result the framework
 * refuses to guess at.
 */
export const EFFECT_ERROR_CODES = [
  /** an operation or step reached the ledger without a class; there is no default class */
  "effect_unclassified",
  /** the declaration contradicts its class (a precondition on a read-only step, and so on) */
  "effect_declaration_invalid",
  /** a mutating step asked for a retry budget; mutating steps are attempted exactly once */
  "mutation_retry_refused",
  /** the same idempotency key again in this run, or an in-doubt receipt for it on disk */
  "mutation_replay_refused",
  /** the step ran and reported nothing; nothing about the target is known */
  "mutation_outcome_unknown",
  /** the mutating step's process never started, so nothing happened: a definite `failed` */
  "mutation_step_not_started",
  /** the `attempting` receipt did not reach disk, so the step was not run */
  "mutation_receipt_write_failed",
  /** the content the write expected to find is not what is there now; nothing was written */
  "precondition_failed",
  /** a `read_only` claim failed the static denylist before the step ran */
  "read_only_violation",
  /** a read-only attempt's own evidence shows the target moved; the retry budget is forfeit */
  "read_only_violation_observed",
  /** a target-affecting browser command without a tab this run owns */
  "owned_tab_required",
  /** a mutating/target step whose web origin is not in `mutation.allowOrigins` */
  "mutation_origin_not_allowed",
  /** `receipts.dir` resolves inside a workspace that does not survive the run (D5) */
  "mutation_receipts_ephemeral",
] as const;

/**
 * The submit gate (submit-gate packet §4; slice S7). Four of them refuse a plan before any
 * artifact is written; the rest refuse an apply, and in submit mode every one of them is raised
 * before the click. They are ordered here the way the operation applies them - what the page
 * would not give, then the world, the intent, the at-most-once rule and the identification -
 * because that order is the contract: each refusal owns exactly one hazard (packet, Mode 3).
 */
export const SUBMIT_GATE_ERROR_CODES = [
  /** a field locator matched no element on the gated page */
  "plan_field_not_found",
  /** a field locator matched more than one element, or no unique selector could be derived */
  "plan_field_ambiguous",
  /** the field's own element is a button, a link or a submit input: the "Set bid" rule (D3) */
  "value_via_button_refused",
  /** the field is behind an iframe or a shadow root, where this framework cannot address it */
  "plan_field_unreachable",
  /** the page no longer matches the fingerprint the plan was written against */
  "plan_stale",
  /** the value that was read back from the field is not the value the plan intended */
  "field_readback_mismatch",
  /** the page navigated or the form vanished while filling: a failed dry run, never a passed one */
  "fill_side_effect_observed",
  /** the world: `mutation.allowOrigins` does not name the plan's origin */
  "submit_origin_not_allowed",
  /** the intent: `--submit` without `--confirm-plan`, or a confirmation without `--submit` */
  "submit_gate_closed",
  /** the intent: the approval token does not match the plan file's own content */
  "submit_plan_mismatch",
  /** at-most-once: a submit-mode receipt for this plan id already exists, whatever its outcome */
  "submit_already_attempted",
  /** the plan recorded more than one submit candidate, so no single control may be clicked */
  "plan_submit_ambiguous",
  /** the plan recorded no submit control at all */
  "plan_submit_missing",
  /** the control was still disabled when the bounded wait ran out */
  "submit_control_disabled",
  /** the control is no longer unique, or no longer inside the fields' owning form */
  "submit_control_changed",
  /** the click was sent and the post-condition was never observed: `unknown`, never retried */
  "submit_postcondition_unmet",
] as const;

/**
 * The frame root cause (frame-root-cause packet, "Error codes"; slice S8). `element_unreachable`
 * is the trigger the diagnosis answers; the rest are what a consumer files once the
 * determination is in. Note what is absent: there is no code for `suspected`, because a
 * suspicion is not a refusal - it is a caveat the healer carries and the report renders.
 */
export const FRAME_ROOT_CAUSE_ERROR_CODES = [
  /** a browser step could not reach an element by selector or ref on a page that was ready */
  "element_unreachable",
  /** `frame.diagnose` failed, answered a shape the framework cannot read, or is not built in */
  "frame_diagnosis_failed",
  /** the inventory disagrees with itself, or `--frame-hint` does not resolve to one frame */
  "frame_diagnosis_undetermined",
  /** the healer refuses a selector rewrite this determination does not permit */
  "heal_frame_refused",
] as const;

/**
 * The a11y snapshot observation channel (a11y-snapshot packet, "Behaviour and failure modes";
 * slice S9). The first five are the gate: the channel goes `unavailable` with one of them and
 * never with a launched browser. The rest are what one observation or one assertion refuses
 * with.
 *
 * Two are additions to the packet's table, both because a rule it states needs a code to speak
 * with: `a11y_command_not_allowed` is the read-only argv allowlist refusing a verb or a flag,
 * and `a11y_check_unavailable` is an expectation nothing could read, which must not pass
 * silently. `dom_probe_missing` is deliberately *not* here: it is recorded evidence on a
 * captured artifact, not a refusal. `tab_leak` is, since AK #5567: the producer's measured stray
 * stays evidence, and any other page the channel leaves refuses a `required` channel.
 */
export const A11Y_CHANNEL_ERROR_CODES = [
  /** no agent-browser at the env var, on PATH, or in ~/.npm-global/bin */
  "agent_browser_missing",
  /** the binary answered --version below the measured floor */
  "agent_browser_too_old",
  /** the configured CDP endpoint is not a loopback URL; refused before any request is made */
  "cdp_endpoint_refused",
  /** nothing answered at the endpoint; the channel never starts a browser instead */
  "cdp_endpoint_unreachable",
  /** something answered that is not a Chromium DevTools endpoint */
  "cdp_endpoint_not_chromium",
  /** the argv allowlist refused a verb or a flag; this channel reads and never acts */
  "a11y_command_not_allowed",
  /** `--a11y-snapshot=required` and the channel could not observe; the page is unverified */
  "a11y_channel_unavailable",
  /** the surf-owned tab is not in /json/list, or it is there more than once */
  "tab_bind_ambiguous",
  /** `snapshot -i --json` failed, or answered a shape the framework cannot read */
  "snapshot_failed",
  /** the snapshot carries no refs at all: a failure, never a zero-element success */
  "empty_snapshot",
  /** the snapshot's own origin is not the bound tab's URL */
  "origin_mismatch",
  /** the bound tab went away during the run */
  "tab_lost",
  /** a page appeared while the channel held its session that is not the producer's measured stray */
  "tab_leak",
  /** a ref was minted against another snapshot; never `failed`, never `passed` */
  "ref_context_drift",
  /** no control with that role and name in the fresh snapshot */
  "role_name_missing",
  /** more than one, and there is no scoping in v1: the candidates are reported, never guessed */
  "role_name_ambiguous",
  /** an expectation this evaluation had no read-only channel for */
  "a11y_check_unavailable",
] as const;

/**
 * Classifier-owned outcome codes. Process codes (`exit_<n>`, `signal_<name>`), HTTP codes
 * (`http_<status>`) and surf codes are patterned or pass-through and are listed separately.
 */
export const RESULT_OUTCOME_CODES = [
  "ok",
  "declared_empty",
  "empty_result",
  "row_error",
  "invalid_output",
  "unclassifiable",
  "timeout",
  "spawn_failed",
] as const;

/** Shapes of the codes that carry a value: an exit status, a signal name, an HTTP status. */
export const RESULT_OUTCOME_CODE_PATTERNS = [
  /^exit_-?\d+$/,
  /^signal_[A-Z][A-Z0-9]*$/,
  /^http_(\d{3}|unknown)$/,
] as const;

/** Codes surf owns; kept verbatim, never rewritten, never treated as success. */
export const SURF_PASSTHROUGH_CODES = [
  "page_login",
  "page_challenge",
  "page_not_found",
  "page_error",
  "page_timeout",
  "empty_result",
  "no_output",
  "browser_error",
  "spawn_failed",
  "row_error",
  "error",
] as const;

/**
 * Signals seen under no contract. They are recorded in `ResultOutcome.recorded` and never
 * change a class (result-classification packet, refinement).
 */
export const RESULT_RECORDED_SIGNALS = [
  "stderr_error_line",
  "payload_error_key_present",
  "tester_verdict_overruled",
] as const;

export type CapabilityErrorCode = (typeof CAPABILITY_ERROR_CODES)[number];
export type CliErrorCode = (typeof CLI_ERROR_CODES)[number];
export type ExploreErrorCode = (typeof EXPLORE_ERROR_CODES)[number];
export type EffectErrorCode = (typeof EFFECT_ERROR_CODES)[number];
export type SubmitGateErrorCode = (typeof SUBMIT_GATE_ERROR_CODES)[number];
export type FrameRootCauseErrorCode = (typeof FRAME_ROOT_CAUSE_ERROR_CODES)[number];
export type A11yChannelErrorCode = (typeof A11Y_CHANNEL_ERROR_CODES)[number];
export type ResultOutcomeCode = (typeof RESULT_OUTCOME_CODES)[number];
export type RecordedSignal = (typeof RESULT_RECORDED_SIGNALS)[number];

/** Every code the framework raises through `FrameworkError` itself. */
export const FRAMEWORK_ERROR_CODES = [
  ...CAPABILITY_ERROR_CODES,
  ...CLI_ERROR_CODES,
  ...EXPLORE_ERROR_CODES,
  ...EFFECT_ERROR_CODES,
  ...SUBMIT_GATE_ERROR_CODES,
  ...FRAME_ROOT_CAUSE_ERROR_CODES,
  ...A11Y_CHANNEL_ERROR_CODES,
] as const;

export type FrameworkErrorCode = (typeof FRAMEWORK_ERROR_CODES)[number];

/** The code the CLI envelope falls back to when an error carries no registered code. */
export const UNCLASSIFIED_ERROR_CODE: CliErrorCode = "unclassified_error";

export function isRegisteredFrameworkErrorCode(code: string): code is FrameworkErrorCode {
  return (FRAMEWORK_ERROR_CODES as readonly string[]).includes(code);
}

/** True for a classifier-owned code, a patterned transport code, or a surf pass-through code. */
export function isKnownResultOutcomeCode(code: string): boolean {
  if ((RESULT_OUTCOME_CODES as readonly string[]).includes(code)) {
    return true;
  }
  if ((SURF_PASSTHROUGH_CODES as readonly string[]).includes(code)) {
    return true;
  }
  return RESULT_OUTCOME_CODE_PATTERNS.some((pattern) => pattern.test(code));
}
