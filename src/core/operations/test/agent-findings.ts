/**
 * What an agent *reports*: the effect class it declares and the finding each refusal renders as.
 *
 * Split out of `agents.ts` in slice S5 (the run lists and the report vocabulary are different
 * jobs, and the file was over the 700-line budget). Nothing here runs a step; every function is
 * a pure rendering of a typed fact into the `Finding` shape the orchestrator consumes.
 */

import type { EffectDeclaration } from "../../effects.js";
import type { Finding } from "../../orchestrator.js";
import type { ResultOutcome } from "../../result-classification.js";
import { isFrameworkError } from "../../runtime-contract.js";

/**
 * The effect class of every agent type (mutation-safety packet, "Declaration points").
 *
 * `cli-tester`'s class is an assumption, not a measurement, and its reason says so, because the
 * reason is rendered in every envelope (adjudication claim 50). The fuzzers change the target by
 * construction, so they run through the ledger and, on a web origin, only when
 * `mutation.allowOrigins` names it (architecture review A13, Q1).
 */
export const AGENT_EFFECTS: Record<
  "bombadil" | "surf" | "api-fuzzer" | "cli-tester" | "terminal-fuzzer",
  EffectDeclaration
> = {
  "cli-tester": {
    effect: "read_only",
    reason: "runs `--help` only; assumed read-only, not verified",
  },
  surf: {
    effect: "read_only",
    scope: "browser_session",
    reason: "opens a tab it owns, reads the page and closes the tab; no step changes the target",
  },
  bombadil: {
    effect: "mutating",
    scope: "target",
    reason: "bounded fuzz: clicks and types on the configured web origin",
  },
  "terminal-fuzzer": {
    effect: "mutating",
    scope: "target",
    reason: "bounded fuzz: sends input to the configured terminal command",
  },
  "api-fuzzer": {
    effect: "mutating",
    scope: "target",
    reason: "sends generated requests to the configured API target",
  },
};

/** The shape every refusal finding is rendered from: one id, one severity, one instruction. */
export interface AgentRefusalShape {
  id: string;
  severity: Finding["severity"];
  description: string;
  recommendation: string;
}

export interface AgentRefusalShape {
  id: string;
  severity: Finding["severity"];
  description: string;
  recommendation: string;
}

export const BOMBADIL_RUNTIME_RECOMMENDATION = {
  web: "Ensure Bombadil is available through TEST_CAPABILITIES_BOMBADIL_BIN, a built TEST_CAPABILITIES_BOMBADIL_REPO/workspace contrib checkout, repo-local external/bombadil, or bombadil on PATH, then re-run the suite.",
  cli: "Ensure Bombadil 0.5+ is available and the terminal target is safe, deterministic, and bounded before relying on this experimental signal. A non-zero exit from the terminal runner is not attributed to a property violation: it writes no trace and passes no --exit-on-violation, so nothing distinguishes a violation from a crash.",
} as const;

/**
 * The finding a ledger refusal renders as. None of these is a statement about the target: the
 * framework refused, or could not learn what its own attempt did.
 */
export function describeLedgerRefusal(
  component: "web" | "cli",
  subject: string,
  error: unknown,
): AgentRefusalShape {
  const code = isFrameworkError(error) ? error.code : "unclassified_error";
  if (code === "mutation_origin_not_allowed") {
    return {
      id: "origin-not-allowed",
      severity: "critical",
      description: `Refused to fuzz ${subject}: the origin is not in mutation.allowOrigins [${code}]`,
      recommendation:
        "Which origins this suite may change is the operator's declaration, not the framework's. Add the origin to mutation.allowOrigins in the config, or disable the agent; nothing was spawned.",
    };
  }
  if (code === "mutation_replay_refused") {
    return {
      id: "mutation-replay-refused",
      severity: "critical",
      description: `Refused to repeat the bounded fuzz of ${subject}: an earlier attempt is still in doubt [${code}]`,
      recommendation:
        "A receipt for this step is still 'attempting' or 'unknown', so a rerun could repeat an effect nobody has confirmed. Inspect the target, then re-run with the --supersede-receipt id the refusal names.",
    };
  }
  if (code === "mutation_receipts_ephemeral") {
    return {
      id: "receipts-ephemeral",
      severity: "critical",
      description: `Refused to fuzz ${subject}: the receipt store does not survive this run [${code}]`,
      recommendation:
        "Point receipts.dir at a durable directory, or set receipts.ephemeral: true to accept an interlock that vanishes with the workspace.",
    };
  }
  if (code === "mutation_outcome_unknown") {
    return {
      id: "outcome-unknown",
      severity: "critical",
      description: `The bounded fuzz of ${subject} reported no outcome [${code}]`,
      recommendation:
        "The runner produced neither a trace nor output, so nothing is known about what it did to the target. Inspect the target by hand; the receipt named in the refusal blocks a blind rerun until it is superseded.",
    };
  }
  return {
    id: "runtime-failed",
    severity: "critical",
    description: `Bombadil runtime could not complete against ${subject}`,
    recommendation: BOMBADIL_RUNTIME_RECOMMENDATION[component],
  };
}

const SURF_PAGE_REFUSAL_CODES = new Set([
  "page_login",
  "page_challenge",
  "page_not_found",
  "page_error",
  "page_timeout",
  "page_not_ready",
]);

const SURF_RUNTIME_RECOMMENDATION =
  "Ensure the surf CLI (nicobailon/surf-cli with wait.ready and extract) is resolvable through TEST_CAPABILITIES_SURF_BIN, surf on PATH, or ~/.local/bin/surf, and that the browser with the surf extension is running (surf doctor), then re-run the suite.";

export function describeSurfRefusal(
  url: string,
  outcome: ResultOutcome | undefined,
): AgentRefusalShape {
  if (outcome === undefined) {
    // Legacy path: a framework-side refusal (a probe without browser evidence, an owned tab
    // that reported no id) has no classified outcome and keeps the pre-S4 wording.
    return {
      id: "runtime-failed",
      severity: "critical",
      description: `Surf runtime could not complete against ${url}`,
      recommendation: SURF_RUNTIME_RECOMMENDATION,
    };
  }

  if (outcome.basis === "no_evidence") {
    return {
      id: "no-evidence",
      severity: "critical",
      description: `Surf produced no browser evidence for ${url} [${outcome.code}]`,
      recommendation:
        "This is the absence of evidence, not a fault in the target: the command exited successfully with an empty payload. Check that the page returns content for the probe, or declare the emptiness with expect.output: empty on this agent.",
    };
  }

  if (outcome.basis === "contradiction") {
    return {
      id: "unclassifiable",
      severity: "critical",
      description: `Surf answered ${url} with a reply the result contract cannot classify [${outcome.code}]`,
      recommendation:
        "The reply contradicts itself (for example a success payload carrying an error field). Nothing downstream may reinterpret it; capture the raw output and fix the producer.",
    };
  }

  if (outcome.basis === "indeterminate") {
    return {
      id: "outcome-unknown",
      severity: "critical",
      description: `Surf could not report an outcome for ${url} [${outcome.code}]`,
      recommendation:
        "A step that may have changed the target never reported a result, so nothing about the target is known. Inspect the page by hand before re-running.",
    };
  }

  if (outcome.class === "spawn_failed" || outcome.class === "timeout") {
    return {
      id: "runtime-failed",
      severity: "critical",
      description: `Surf runtime could not be executed against ${url} [${outcome.code}]`,
      recommendation: SURF_RUNTIME_RECOMMENDATION,
    };
  }

  if (SURF_PAGE_REFUSAL_CODES.has(outcome.code)) {
    return {
      id: `page-${outcome.code}`,
      severity: "high",
      description: `Surf could not reach a settled page state on ${url} [${outcome.code}]`,
      recommendation:
        "The surf runtime worked and the page refused it: the page asked for a login, a challenge, or never settled. Point targets.web at a page the framework may read without credentials, or open the flow by hand first; do not treat this as a broken build.",
    };
  }

  return {
    id: "command-failed",
    severity: "critical",
    description: `Surf reported a failure while exploring ${url} [${outcome.code}]`,
    recommendation:
      "Read the outcome and transport lines in the evidence: the surf command ran and returned an error. Fix the target or the command before relying on browser coverage.",
  };
}

/**
 * The finding a classified CLI outcome renders as.
 *
 * Only `fault` is a statement about the target. `no_evidence` says the command ran and wrote
 * nothing, which is why the recommendation names the declaration that would make that shape
 * legitimate instead of asking anyone to fix a target that may be fine (result-classification
 * packet, refinement; plan S4).
 */
export function describeCliOutcome(
  target: string,
  commandDisplay: string,
  outcome: ResultOutcome,
  declarationKey: string,
): AgentRefusalShape {
  if (outcome.basis === "no_evidence") {
    return {
      id: "empty-result",
      severity: "high",
      description: `CLI smoke command produced no output: ${commandDisplay} [${outcome.code}]`,
      recommendation: `The command exited successfully and wrote nothing, so the run obtained no evidence about '${target}'. Point targets.cli at a command that prints, or declare the shape with '${declarationKey}: { output: empty }' (add empty_marker when the command prints a fixed no-results line).`,
    };
  }

  if (outcome.basis === "contradiction") {
    return {
      id: "unclassifiable",
      severity: "critical",
      description: `CLI smoke command answered with a reply the result contract cannot classify: ${commandDisplay} [${outcome.code}]`,
      recommendation:
        "The reply contradicts itself (for example a declared error envelope on a zero exit). Nothing downstream may reinterpret it; capture the raw output and fix the producer.",
    };
  }

  if (outcome.basis === "indeterminate") {
    return {
      id: "outcome-unknown",
      severity: "critical",
      description: `CLI smoke command never reported an outcome: ${commandDisplay} [${outcome.code}]`,
      recommendation:
        "A step that may have changed the target never reported a result, so nothing about the target is known. Inspect the environment by hand before re-running.",
    };
  }

  return {
    id: "help-failed",
    severity: "critical",
    description: `CLI smoke command failed: ${commandDisplay} [${outcome.code}]`,
    recommendation: `Ensure '${target}' is executable and '--help' exits successfully.`,
  };
}
