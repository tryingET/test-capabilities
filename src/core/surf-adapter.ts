/**
 * The surf adapter: one resolution, one capability probe, one argv translation, one effect map
 * and one transport for every surf command the framework runs (implementation plan S3 commit
 * (2); architecture review A7; adjudication claims 2, 21, 37).
 *
 * `runSurfCommand` is the synchronous path the explore step list and `doctor` use; the adapter's
 * `invoke` is the same transport behind the kernel boundary. Nothing here imports
 * `node:child_process`: `spawn-step.ts` owns that.
 */

import process from "node:process";
import type { Adapter, AdapterEffect, AdapterInvocation, AdapterStep } from "./adapter.js";
import type { EffectAttempt } from "./effects.js";
import { defaultMutationOutcomeForError } from "./effects.js";
import type { ExpectDeclaration, RawResult, ResultOutcome } from "./result-classification.js";
import { classifyResult } from "./result-classification.js";
import { parseSurfErrorOutput } from "./result-payload.js";
import { spawnStepSync } from "./spawn-step.js";
import type { SurfCommandResult, SurfRuntimeProbe, SurfRuntimeResolution } from "./surf-runtime.js";
import {
  DEFAULT_SURF_TIMEOUT_MS,
  resolveSurfRuntimeResolution,
  SURF_EXPLORE_REQUIRED_MECHANISMS,
  SURF_MECHANISM_COMMANDS,
  SurfCommandError,
  type SurfMechanism,
  translateSurfArgs,
} from "./surf-runtime.js";

const probeCache = new Map<string, SurfRuntimeProbe>();

export function resetSurfRuntimeProbeCache(): void {
  probeCache.clear();
}

function helpListsCommand(helpText: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${escaped}(?:\\s|$)`, "m").test(helpText);
}

export function probeSurfRuntime(
  resolution: SurfRuntimeResolution,
  options: { cache?: boolean; env?: NodeJS.ProcessEnv } = {},
): SurfRuntimeProbe {
  const useCache = options.cache ?? true;
  const cached = useCache ? probeCache.get(resolution.command) : undefined;
  if (cached) {
    return cached;
  }

  const version = runSurfCommand(resolution, ["--version"], {
    timeoutMs: 15_000,
    env: options.env,
  });
  assertProbeAnswer(resolution, "--version", version);

  const help = runSurfCommand(resolution, ["--help-full"], {
    timeoutMs: 15_000,
    env: options.env,
  });
  assertProbeAnswer(resolution, "--help-full", help);

  const versionOutput = version.stdout.trim();
  const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  const mechanisms = Object.fromEntries(
    Object.entries(SURF_MECHANISM_COMMANDS).map(([key, command]) => [
      key,
      helpListsCommand(help.stdout, command),
    ]),
  ) as Record<SurfMechanism, boolean>;

  const probe: SurfRuntimeProbe = {
    version: versionMatch?.[1],
    versionOutput,
    mechanisms,
    missingExploreMechanisms: SURF_EXPLORE_REQUIRED_MECHANISMS.filter(
      (mechanism) => !mechanisms[mechanism],
    ).map((mechanism) => SURF_MECHANISM_COMMANDS[mechanism]),
  };

  if (useCache) {
    probeCache.set(resolution.command, probe);
  }
  return probe;
}

/**
 * A probe that did not answer raises the classified failure, not a bare `Error`: a surf binary
 * that never started (`spawn_failed`) and a surf binary that answered with an error must not
 * render identically once the caller reads the basis (adjudication claim 45). The message keeps
 * the shape it always had and gains the `[code]` suffix every framework error carries.
 */
function assertProbeAnswer(
  resolution: SurfRuntimeResolution,
  flag: string,
  result: SurfCommandResult,
): void {
  if (result.ok) {
    return;
  }
  throw new SurfCommandError({
    ...result,
    failure: {
      code: result.failure?.code ?? "browser_error",
      message: `surf at ${resolution.command} did not answer ${flag}: ${result.failure?.message ?? "unknown failure"}`,
      ...(result.failure?.details ? { details: result.failure.details } : {}),
    },
  });
}

/** Builds the fully resolved invocation for one surf command. */
export function surfInvocation(
  resolution: SurfRuntimeResolution,
  argv: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): AdapterInvocation {
  const args = [...resolution.baseArgs, ...argv];
  return {
    source: "surf",
    command: resolution.command,
    args,
    timeoutMs: options.timeoutMs ?? DEFAULT_SURF_TIMEOUT_MS,
    env: options.env ?? process.env,
    display: [resolution.command, ...args],
  };
}

/**
 * Turns one transport reply into the surf runtime's command result.
 *
 * The classified `outcome` is attached to every result (slice S3): it is the additive typed
 * verdict the step lists, the explore probes, the healer and the report switch to in S4. `ok`
 * and `failure` keep the transport meaning they had, so this slice changes no verdict on its
 * own; the declarations that make `empty` a refusal (`expect.output`, the explore link
 * emptiness constant, the readiness gate) arrive with their consumers.
 */
function surfCommandResultFromRaw(
  raw: RawResult,
  invocation: AdapterInvocation,
  declaration?: ExpectDeclaration,
): SurfCommandResult {
  const commandDisplay = invocation.display;
  const base = {
    code: raw.exitCode,
    stdout: raw.stdout,
    stderr: raw.stderr,
    commandDisplay,
    outcome: classifyResult(raw, declaration),
  };

  if (raw.timedOut) {
    return {
      ...base,
      ok: false,
      failure: {
        code: "timeout",
        message: `${commandDisplay.join(" ")} timed out after ${invocation.timeoutMs}ms`,
      },
    };
  }

  if (raw.spawnFailure) {
    return {
      ...base,
      ok: false,
      failure: {
        code: "spawn_failed",
        message: `Failed to run ${commandDisplay.join(" ")}: ${raw.spawnFailure}`,
      },
    };
  }

  // Killed by a signal before it said anything: the exit code is absent, not zero, and the
  // reply teaches nothing about the target. It must not be read as surf's own refusal, which
  // is what `parseSurfErrorOutput` would make of an empty stderr (mutation-safety packet: a
  // step whose process reports nothing is `unknown`, never `failed`).
  if (raw.exitCode === null && raw.signal) {
    return {
      ...base,
      ok: false,
      failure: {
        code: `signal_${raw.signal}`,
        message: `${commandDisplay.join(" ")} was killed by ${raw.signal} before it reported a result`,
      },
    };
  }

  if (raw.exitCode !== 0) {
    return {
      ...base,
      ok: false,
      failure: parseSurfErrorOutput(raw.stdout, raw.stderr, raw.exitCode, commandDisplay),
    };
  }

  return { ...base, ok: true };
}

export function runSurfCommand(
  resolution: SurfRuntimeResolution,
  argv: string[],
  options: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    expect?: ExpectDeclaration;
    /**
     * The class of the step behind this command. A transport failure on a mutating step is
     * `indeterminate`, never a target fault (architecture review A4); the session sets it, and
     * the ledger reads the basis back to settle the attempt `unknown`.
     */
    effect?: "read_only" | "mutating";
  } = {},
): SurfCommandResult {
  const invocation = surfInvocation(resolution, argv, options);
  const raw = spawnStepSync(invocation);
  return surfCommandResultFromRaw(
    options.effect === undefined ? raw : { ...raw, effect: options.effect },
    invocation,
    options.expect,
  );
}

/**
 * The static surf command -> effect class map (mutation-safety packet; S6 enforces it in
 * `Session.step`). `js` stays unclassified on purpose: the caller must declare an effect for
 * page-side script, and an unknown verb is unclassified rather than assumed safe.
 */
const SURF_READ_ONLY_COMMANDS = new Set([
  "read",
  "page.read",
  "page.text",
  "page.state",
  "page.readiness",
  "wait",
  "wait.ready",
  "wait.element",
  "screenshot",
  "tab.list",
  "network",
  "network.get",
  "network.body",
  "network.clear",
  "network.stats",
  "console",
  "cookie.list",
  "frame.list",
  "frame.diagnose",
  "extract",
  "scroll.up",
  "scroll.down",
  "scroll.left",
  "scroll.right",
  "emulate.device",
  "emulate.network",
]);

const SURF_BROWSER_SESSION_COMMANDS = new Set([
  "tab.new",
  "tab.close",
  "tab.switch",
  "window.new",
  "window.close",
  "window.switch",
  "frame.switch",
  "frame.main",
]);

const SURF_TARGET_MUTATING_COMMANDS = new Set([
  "click",
  "type",
  "key",
  "select",
  "do",
  "go",
  "navigate",
  "back",
  "forward",
  "reload",
  "tab.reload",
]);

export function surfEffect(command: string): AdapterEffect {
  if (SURF_READ_ONLY_COMMANDS.has(command)) {
    return { effect: "read_only", reason: `surf ${command} reads the page without acting on it` };
  }
  if (SURF_BROWSER_SESSION_COMMANDS.has(command)) {
    return {
      effect: "mutating",
      scope: "browser_session",
      reason: `surf ${command} changes the runtime's own browser session, not the target`,
    };
  }
  if (SURF_TARGET_MUTATING_COMMANDS.has(command)) {
    return {
      effect: "mutating",
      scope: "target",
      reason: `surf ${command} acts on the target page`,
    };
  }
  return {
    effect: "unclassified",
    reason: `surf ${command} has no declared effect class; the caller must declare one`,
  };
}

/** The surf adapter: resolution, capability probe, argv mapping, effect map, one transport. */
export const surfAdapter: Adapter<SurfRuntimeResolution, SurfRuntimeProbe> = {
  id: "surf",

  resolve(env: NodeJS.ProcessEnv = process.env): SurfRuntimeResolution {
    return resolveSurfRuntimeResolution(env);
  },

  probe(resolution: SurfRuntimeResolution): SurfRuntimeProbe {
    return probeSurfRuntime(resolution);
  },

  translate(step: AdapterStep, resolution: SurfRuntimeResolution): AdapterInvocation {
    return surfInvocation(resolution, translateSurfArgs(step.command, [...(step.args ?? [])]), {
      ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
      ...(step.env ? { env: step.env } : {}),
    });
  },

  effects(step: AdapterStep): AdapterEffect {
    return surfEffect(step.command);
  },

  invoke(invocation: AdapterInvocation): Promise<RawResult> {
    // surf commands are short and the explore step lists are synchronous today; the sync path
    // of the same transport keeps one process boundary without an async rewrite.
    return Promise.resolve(spawnStepSync(invocation));
  },

  normalize(raw: RawResult, declaration?: ExpectDeclaration): ResultOutcome {
    return classifyResult(raw, declaration);
  },
};

/**
 * What a mutating browser attempt means.
 *
 * The framework holds no authoritative read of a page's post-state, so a reply the classifier
 * could not attribute - a budget kill, a signal, a tab that navigated away mid-command - is
 * `unknown` and locks the key until an operator supersedes it. Only a definite refusal from
 * surf is `failed` (mutation-safety packet, "Behaviour and failure modes").
 */
export function settleSurfAttempt<T>(attempt: EffectAttempt<T>): {
  outcome: "applied" | "failed" | "unknown";
  evidence?: string[];
} {
  if (attempt.error === undefined) {
    return { outcome: "applied" };
  }
  const outcome = attempt.error instanceof SurfCommandError ? attempt.error.outcome : undefined;
  if (outcome?.basis === "indeterminate") {
    return {
      outcome: "unknown",
      evidence: [`outcome:${outcome.class}:${outcome.code}`, "basis:indeterminate"],
    };
  }
  return { outcome: defaultMutationOutcomeForError(attempt.error) };
}
