/**
 * Surf runtime resolution and command mapping.
 *
 * The runtime flavor is the upstream nicobailon/surf-cli CLI (`surf`), preferably the
 * `feat/site-independent-mechanisms` branch build that adds `wait.ready`, `page.readiness`,
 * `extract` and `frame.diagnose`. The retired `surf-go` fork is refused explicitly: its
 * upstream was deleted, the committed binary was removed, and a static build needs cgo, so a
 * silently kept mapping could never be verified again.
 */

import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { ResultErrorPayload, ResultOutcome } from "./result-classification.js";
import { isRecord, tryParseSurfJson } from "./result-payload.js";
import { FrameworkError } from "./runtime-contract.js";
import { translateSurfArgs } from "./surf-args.js";

// The classifier owns the shapes surf owns: its JSON parsing and its error contract live in the
// pure ring and are re-exported here so the public runtime surface keeps its names.
export { parseSurfErrorOutput, tryParseSurfJson } from "./result-payload.js";

export type SurfRuntimeFlavor = "surf";

export type SurfRuntimeProvider = "explicit_bin" | "path_surf" | "home_local_bin";

export interface SurfRuntimeResolution {
  command: string;
  baseArgs: string[];
  flavor: SurfRuntimeFlavor;
  provider: SurfRuntimeProvider;
  resolutionNotes: string[];
}

export const RETIRED_SURF_GO_ENV_VARS = [
  "TEST_CAPABILITIES_SURF_GO_BIN",
  "TEST_CAPABILITIES_SURF_GO_REPO",
] as const;

export const SURF_MECHANISM_COMMANDS = {
  waitReady: "wait.ready",
  pageReadiness: "page.readiness",
  extract: "extract",
  frameDiagnose: "frame.diagnose",
  /** one process for many commands (our surf-cli fork, AK #6222): its help lists `surf --stdio` */
  stdio: "surf --stdio",
} as const;

export type SurfMechanism = keyof typeof SURF_MECHANISM_COMMANDS;

export const SURF_EXPLORE_REQUIRED_MECHANISMS: readonly SurfMechanism[] = ["waitReady", "extract"];

export interface SurfRuntimeProbe {
  version: string | undefined;
  versionOutput: string;
  mechanisms: Record<SurfMechanism, boolean>;
  missingExploreMechanisms: string[];
}

/** The classifier's error payload; the surf runtime keeps the name it always had. */
export type SurfCommandFailure = ResultErrorPayload;

export interface SurfCommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  commandDisplay: string[];
  failure?: SurfCommandFailure;
  /** the classified outcome of this command; additive, and the only verdict S4 consumers read */
  outcome: ResultOutcome;
}

export class SurfCommandError extends FrameworkError {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly commandDisplay: string[];
  /** the classified outcome the failure came from; carries the basis the healer reads (S4) */
  readonly outcome: ResultOutcome | undefined;

  constructor(result: SurfCommandResult) {
    const failure = result.failure ?? {
      code: "error",
      message: `${result.commandDisplay.join(" ")} exited with code ${result.code ?? "null"}`,
    };
    // surf codes pass through verbatim: the framework never rewrites a code it does not own.
    super(failure.code, `${failure.message} [${failure.code}]`, failure.details);
    this.name = "SurfCommandError";
    this.exitCode = result.code;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.commandDisplay = result.commandDisplay;
    this.outcome = result.outcome;
  }
}

export const SURF_READINESS_ERROR_CODES = [
  "page_login",
  "page_challenge",
  "page_not_found",
  "page_error",
  "page_timeout",
] as const;

export type SurfReadinessErrorCode = (typeof SURF_READINESS_ERROR_CODES)[number];

export function isSurfReadinessErrorCode(code: string): code is SurfReadinessErrorCode {
  return (SURF_READINESS_ERROR_CODES as readonly string[]).includes(code);
}

// ============================================
// RESOLUTION
// ============================================

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(binaryName: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathValue = env.PATH ?? "";
  const pathExts =
    process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];

  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) {
      continue;
    }

    for (const ext of pathExts) {
      const candidate = path.join(entry, `${binaryName}${ext}`);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function homeDirectory(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.HOME?.trim();
  if (explicit) {
    return explicit;
  }

  try {
    return os.homedir();
  } catch {
    return undefined;
  }
}

function assertNoRetiredSurfGoEnv(env: NodeJS.ProcessEnv): void {
  const set = RETIRED_SURF_GO_ENV_VARS.filter((name) => (env[name] ?? "").trim().length > 0);
  if (set.length === 0) {
    return;
  }

  throw new Error(
    `${set.join(" and ")} ${set.length === 1 ? "is" : "are"} set, but the surf-go fork runtime was retired (upstream deleted, binary removed). Unset ${set.length === 1 ? "it" : "them"} and use TEST_CAPABILITIES_SURF_BIN, 'surf' on PATH, or ~/.local/bin/surf from nicobailon/surf-cli.`,
  );
}

export function resolveSurfRuntimeResolution(
  env: NodeJS.ProcessEnv = process.env,
): SurfRuntimeResolution {
  assertNoRetiredSurfGoEnv(env);

  const explicit = env.TEST_CAPABILITIES_SURF_BIN?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!isExecutable(resolved)) {
      throw new Error(
        `TEST_CAPABILITIES_SURF_BIN points to ${resolved}, but no executable surf CLI exists there.`,
      );
    }
    return {
      command: resolved,
      baseArgs: [],
      flavor: "surf",
      provider: "explicit_bin",
      resolutionNotes: [],
    };
  }

  const onPath = findOnPath("surf", env);
  if (onPath) {
    return {
      command: onPath,
      baseArgs: [],
      flavor: "surf",
      provider: "path_surf",
      resolutionNotes: [],
    };
  }

  const home = homeDirectory(env);
  const homeCandidate = home ? path.join(home, ".local", "bin", "surf") : undefined;
  if (homeCandidate && isExecutable(homeCandidate)) {
    return {
      command: homeCandidate,
      baseArgs: [],
      flavor: "surf",
      provider: "home_local_bin",
      resolutionNotes: [
        `surf resolved from ${homeCandidate}, which is not on PATH for this process.`,
      ],
    };
  }

  throw new Error(
    "No surf CLI found. Set TEST_CAPABILITIES_SURF_BIN, put 'surf' on PATH, or install nicobailon/surf-cli to ~/.local/bin/surf. The retired surf-go fork is not supported.",
  );
}

// ============================================
// PROCESS EXECUTION AND OUTPUT PARSING
// ============================================

export const DEFAULT_SURF_TIMEOUT_MS = 90_000;

export interface SurfJsonOutput {
  data: unknown;
  target?: unknown;
  notice?: string | null;
}

/**
 * Parse `--json` stdout. With an explicit target (`--tab-id`, `--window-id`, `--session`) the
 * CLI wraps the payload as `{result, target, notice}`; the wrapper is removed here.
 */
export function parseSurfJsonOutput(stdout: string, commandLabel: string): SurfJsonOutput {
  const raw = stdout.trim();
  if (raw.length === 0) {
    throw new Error(`surf ${commandLabel} returned empty output where JSON was expected`);
  }

  const attempt = tryParseSurfJson(raw);
  if (!attempt.parsed) {
    const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
    throw new Error(`Invalid JSON output from surf ${commandLabel}: ${preview}`);
  }

  const value = attempt.value;
  if (isRecord(value) && "result" in value && "target" in value) {
    const keys = Object.keys(value).filter((key) => !["result", "target", "notice"].includes(key));
    if (keys.length === 0) {
      return {
        data: value.result,
        target: value.target,
        notice: typeof value.notice === "string" ? value.notice : null,
      };
    }
  }

  return { data: value };
}

/** `tab.new` answers with the text "Created tab <id>: <url>" even under `--json`. */
export function parseCreatedTabId(output: string): number | undefined {
  const parsed = tryParseSurfJson(output);
  if (parsed.parsed) {
    const value = parsed.value;
    if (isRecord(value)) {
      const candidate = value.tabId ?? value.tab_id ?? value.id;
      if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
        return candidate;
      }
    }
    if (typeof value === "string") {
      const match = value.match(/Created tab (\d+)/);
      if (match) {
        return Number(match[1]);
      }
    }
  }

  const match = output.match(/Created tab (\d+)/);
  return match ? Number(match[1]) : undefined;
}

// ============================================
// VERSION AND MECHANISM PROBE
// ============================================

export function describeSurfRuntime(
  resolution: SurfRuntimeResolution,
  probe: SurfRuntimeProbe,
): string {
  return `surf ${probe.version ?? "(unknown version)"} via ${resolution.provider} (${resolution.command})`;
}

export function assertSurfExploreMechanisms(
  resolution: SurfRuntimeResolution,
  probe: SurfRuntimeProbe,
): void {
  if (probe.missingExploreMechanisms.length === 0) {
    return;
  }

  throw new Error(
    `${describeSurfRuntime(resolution, probe)} lacks ${probe.missingExploreMechanisms.join(" and ")}. Surf explore requires the surf-cli build with typed page readiness and owned-tab extraction (branch feat/site-independent-mechanisms on top of v2.18.0); refusing to run against an upstream build without them.`,
  );
}

// the command mapping lives in surf-args.ts; it is exported from here as it always was
export { translateSurfArgs };

export function resolveSurfRuntimeCommand(
  command: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): SurfRuntimeResolution & { args: string[]; commandDisplay: string[] } {
  const resolution = resolveSurfRuntimeResolution(env);
  const translatedArgs = translateSurfArgs(command, args);
  const allArgs = [...resolution.baseArgs, ...translatedArgs];

  return {
    ...resolution,
    args: allArgs,
    commandDisplay: [resolution.command, ...allArgs],
  };
}
