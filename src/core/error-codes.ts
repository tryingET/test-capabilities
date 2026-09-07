/**
 * The framework's error-code registry.
 *
 * Pure ring: no I/O, no imports outside this file. Every code the framework raises itself is
 * registered here as a namespaced `as const` array; `tests/error_codes_contract.test.mjs`
 * asserts uniqueness across the namespaces and that every `new FrameworkError("<code>"` literal
 * in `src/` uses a registered code (architecture review A6, Q5). Later slices append one array
 * each: `EFFECT_ERROR_CODES` (S5), `SUBMIT_GATE_ERROR_CODES` (S7),
 * `FRAME_ROOT_CAUSE_ERROR_CODES` (S8), `A11Y_CHANNEL_ERROR_CODES` (S9).
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
export type ResultOutcomeCode = (typeof RESULT_OUTCOME_CODES)[number];
export type RecordedSignal = (typeof RESULT_RECORDED_SIGNALS)[number];

/** Every code the framework raises through `FrameworkError` itself. */
export const FRAMEWORK_ERROR_CODES = [...CAPABILITY_ERROR_CODES, ...CLI_ERROR_CODES] as const;

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
