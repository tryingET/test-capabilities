/**
 * Reading surf's typed readiness, and refusing a page that never settled.
 *
 * Pure ring: no I/O. This is the vocabulary half of the readiness gate - what surf's
 * `wait.ready` reply means and what a refusal says - kept apart from the session that drives
 * the command, because classifying a page and owning a tab are different jobs.
 *
 * One state settles a page: `ready`. surf reports `empty` when a page rendered its own "no
 * results" state, which it can only know from an `--empty-text` marker the caller passed. The
 * explore step list passes none, so an `empty` here is surf saying "nothing was found" with
 * nothing to check it against: an undeclared emptiness, refused rather than probed
 * (result-classification packet, refinement; plan S4).
 */

import type { SessionReadiness, SessionReadinessState } from "./browser-session.js";
import type { ResultOutcome } from "./result-classification.js";
import { FrameworkError } from "./runtime-contract.js";

export const SETTLED_READINESS_STATES: readonly SessionReadinessState[] = ["ready"];

const KNOWN_READINESS_STATES: readonly string[] = [
  "ready",
  "empty",
  "loading",
  "login",
  "challenge",
  "not-found",
  "error",
];

/**
 * A page that never reached a settled state. It carries surf's own readiness code
 * (`page_login`, `page_challenge`, ...) so the CLI envelope and the surf agent can tell a page
 * that refused the framework from a runtime that never ran (adjudication claim 45), and the
 * classified outcome when one exists.
 */
export class SessionReadinessRefusal extends FrameworkError {
  readonly readiness: SessionReadiness;
  readonly outcome: ResultOutcome | undefined;

  constructor(url: string, readiness: SessionReadiness, outcome?: ResultOutcome) {
    const evidence =
      readiness.evidence.length > 0 ? ` Evidence: ${readiness.evidence.join("; ")}` : "";
    super(
      readiness.code ?? "page_not_ready",
      `Surf explore refused ${url}: page readiness is '${readiness.state}' [${readiness.code ?? "page_not_ready"}]: ${readiness.message ?? "the page did not reach a settled state"}.${evidence}`,
      { url, state: readiness.state, ...(readiness.href ? { href: readiness.href } : {}) },
    );
    this.name = "SessionReadinessRefusal";
    this.readiness = readiness;
    this.outcome = outcome;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** surf's own readiness code, plus whatever state its details carried. */
export function readinessStateFromCode(code: string, details: unknown): SessionReadinessState {
  if (isRecord(details) && typeof details.state === "string") {
    const state = details.state as SessionReadinessState;
    if (KNOWN_READINESS_STATES.includes(state)) {
      return state;
    }
  }
  switch (code) {
    case "page_login":
      return "login";
    case "page_challenge":
      return "challenge";
    case "page_not_found":
      return "not-found";
    case "page_error":
      return "error";
    case "page_timeout":
      return "loading";
    default:
      return "unknown";
  }
}

/** The typed readiness of a successful `wait.ready --json` reply, or nothing. */
export function readinessFromResult(data: unknown): SessionReadiness | undefined {
  if (!isRecord(data) || typeof data.state !== "string") {
    return undefined;
  }
  return {
    state: data.state as SessionReadinessState,
    href: optionalString(data.href),
    title: optionalString(data.title),
    readyState: optionalString(data.readyState),
    polls: optionalNumber(data.polls),
    waited: optionalNumber(data.waited),
    evidence: stringList(data.evidence),
  };
}

/** The refusal behind a `page_*` failure from `wait.ready`. */
export function readinessRefusalFromFailure(
  url: string,
  failure: { code: string; message: string; details?: Record<string, unknown> },
  outcome?: ResultOutcome,
): SessionReadinessRefusal {
  const details = failure.details;
  return new SessionReadinessRefusal(
    url,
    {
      state: readinessStateFromCode(failure.code, details),
      code: failure.code,
      message: failure.message,
      href: isRecord(details) ? optionalString(details.href) : undefined,
      title: isRecord(details) ? optionalString(details.title) : undefined,
      evidence: isRecord(details) ? stringList(details.evidence) : [],
    },
    outcome,
  );
}

/** A settled readiness, or the refusal that says why the page was not probed. */
export function settledReadinessOrRefuse(
  url: string,
  data: unknown,
  outcome?: ResultOutcome,
): SessionReadiness {
  const readiness = readinessFromResult(data);
  if (!readiness) {
    throw new Error(
      `Surf explore could not read a typed readiness state from 'surf wait.ready --json' for ${url}; refusing to probe an unclassified page.`,
    );
  }
  if (SETTLED_READINESS_STATES.includes(readiness.state)) {
    return readiness;
  }
  throw new SessionReadinessRefusal(
    url,
    {
      ...readiness,
      code: "page_not_ready",
      message:
        readiness.state === "empty"
          ? "wait.ready returned state 'empty' and this operation declared no empty marker, so the emptiness is undeclared and the page is not probed"
          : `wait.ready returned state '${readiness.state}' instead of a settled page`,
    },
    outcome,
  );
}
