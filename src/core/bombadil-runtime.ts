import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Adapter, AdapterEffect, AdapterInvocation, AdapterStep } from "./adapter.js";
import { invokeAdapter } from "./adapter.js";
import type { RawResult } from "./result-classification.js";
import { spawnStep } from "./spawn-step.js";

/** Bombadil is always run under an explicit budget; this is the floor when a caller omits one. */
const DEFAULT_BOMBADIL_TIMEOUT_MS = 10_000;

const BUILT_BOMBADIL_RELATIVE_PATHS = [
  path.join("target", "release", "bombadil"),
  path.join("target", "debug", "bombadil"),
] as const;

export type BombadilRunStatus = "completed" | "budget_exhausted" | "violation" | "runtime_error";

export type BombadilCommand = "test" | "test-external";

export interface BombadilTerminalRunOptions {
  command: string;
  args?: string[];
}

export interface BombadilRunOptions {
  command?: BombadilCommand;
  outputPath?: string;
  headers?: Record<string, string>;
  reproduceTracePath?: string;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  instrumentJavaScript?: Array<"files" | "inline">;
  chromeGrantPermissions?: string[];
  headless?: boolean;
  noSandbox?: boolean;
  remoteDebugger?: string;
  createTarget?: boolean;
}

export interface BombadilRunInput {
  origin: string;
  durationMs: number;
  env?: NodeJS.ProcessEnv;
  options?: BombadilRunOptions;
}

export interface BombadilBinaryResolution {
  binaryPath: string;
  provider:
    | "explicit_bin"
    | "explicit_repo_build"
    | "workspace_contrib_build"
    | "vendored"
    | "path";
  resolutionNotes: string[];
}

export interface BombadilRunResult {
  status: BombadilRunStatus;
  binaryPath: string;
  binaryProvider: BombadilBinaryResolution["provider"];
  resolutionNotes: string[];
  command: string[];
  origin: string;
  durationMs: number;
  elapsedMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  tracePath?: string;
  /** size of the trace file when it exists; the typed "did this run produce anything" fact */
  traceBytes?: number;
  usedDefaultSpecification: boolean;
  timedOut: boolean;
}

export interface BombadilAdapterProbe {
  binaryPath: string;
  provider: BombadilBinaryResolution["provider"];
  resolutionNotes: string[];
  /** the runtime never asks the binary for its version; resolution notes are the evidence */
  versionProbed: false;
}

export interface BombadilTerminalRunInput {
  target: BombadilTerminalRunOptions;
  durationMs: number;
  env?: NodeJS.ProcessEnv;
}

export interface BombadilTerminalRunResult {
  status: BombadilRunStatus;
  binaryPath: string;
  binaryProvider: BombadilBinaryResolution["provider"];
  resolutionNotes: string[];
  command: string[];
  targetCommand: string[];
  durationMs: number;
  elapsedMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function resolvePackageRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TEST_CAPABILITIES_PACKAGE_ROOT) {
    return path.resolve(env.TEST_CAPABILITIES_PACKAGE_ROOT);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function firstBuiltBombadilBinary(repoRoot: string): string | undefined {
  for (const relativePath of BUILT_BOMBADIL_RELATIVE_PATHS) {
    const candidate = path.join(repoRoot, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function renderMissingBuildNote(repoRoot: string, contextLabel: string): string {
  if (!existsSync(repoRoot)) {
    return `${contextLabel} points to ${repoRoot}, but that Bombadil checkout does not exist.`;
  }

  const candidateList = BUILT_BOMBADIL_RELATIVE_PATHS.map((relativePath) =>
    path.join(repoRoot, relativePath),
  ).join(" or ");
  return `${contextLabel} found at ${repoRoot}, but no built Bombadil binary exists at ${candidateList}. Build Bombadil first (for example: 'cargo build --release --bin bombadil'). Upstream Bombadil 0.5 no longer requires esbuild, but local source builds may still need trunk or the project Nix shell.`;
}

function resolveBombadilRepoRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.TEST_CAPABILITIES_BOMBADIL_REPO?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const packageRoot = resolvePackageRoot(env);
  const workspaceContribRepo = path.resolve(packageRoot, "..", "..", "contrib", "bombadil");
  return existsSync(workspaceContribRepo) ? workspaceContribRepo : undefined;
}

export function resolveBombadilBinaryResolution(
  env: NodeJS.ProcessEnv = process.env,
): BombadilBinaryResolution {
  const explicitBinary = env.TEST_CAPABILITIES_BOMBADIL_BIN?.trim();
  if (explicitBinary) {
    return {
      binaryPath: explicitBinary,
      provider: "explicit_bin",
      resolutionNotes: [],
    };
  }

  const repoRoot = resolveBombadilRepoRoot(env);
  if (repoRoot) {
    const builtBinary = firstBuiltBombadilBinary(repoRoot);
    if (builtBinary) {
      return {
        binaryPath: builtBinary,
        provider: env.TEST_CAPABILITIES_BOMBADIL_REPO
          ? "explicit_repo_build"
          : "workspace_contrib_build",
        resolutionNotes: [],
      };
    }
  }

  const resolutionNotes = repoRoot
    ? [
        renderMissingBuildNote(
          repoRoot,
          env.TEST_CAPABILITIES_BOMBADIL_REPO
            ? "TEST_CAPABILITIES_BOMBADIL_REPO"
            : "Workspace contrib Bombadil checkout",
        ),
      ]
    : [];

  const vendored = path.join(resolvePackageRoot(env), "external", "bombadil");
  if (existsSync(vendored)) {
    return {
      binaryPath: vendored,
      provider: "vendored",
      resolutionNotes,
    };
  }

  return {
    binaryPath: "bombadil",
    provider: "path",
    resolutionNotes,
  };
}

export function resolveBombadilBinary(env: NodeJS.ProcessEnv = process.env): string {
  return resolveBombadilBinaryResolution(env).binaryPath;
}

function extractTracePath(output: string): string | undefined {
  const match = output.match(/storing trace in\s+(\S+)/i);
  return match?.[1];
}

function appendBombadilOptionArgs(args: string[], options: BombadilRunOptions): void {
  if (options.outputPath) {
    args.push("--output-path", options.outputPath);
  }

  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (key.includes("=") || value.includes("\n") || value.includes("\r")) {
      throw new Error(
        "Bombadil headers must be KEY=VALUE pairs without '=' in the key or newlines.",
      );
    }
    args.push("--header", `${key}=${value}`);
  }

  if (options.width !== undefined) {
    args.push("--width", String(options.width));
  }

  if (options.height !== undefined) {
    args.push("--height", String(options.height));
  }

  if (options.deviceScaleFactor !== undefined) {
    args.push("--device-scale-factor", String(options.deviceScaleFactor));
  }

  if (options.instrumentJavaScript?.length) {
    args.push("--instrument-javascript", options.instrumentJavaScript.join(","));
  }

  if (options.chromeGrantPermissions?.length) {
    args.push("--chrome-grant-permissions", options.chromeGrantPermissions.join(","));
  }

  if (options.reproduceTracePath) {
    args.push("--reproduce", options.reproduceTracePath);
  }
}

/**
 * Typed evidence that the process actually ran a test: Bombadil's own trace file, or, when it
 * writes none (the terminal runner), any output at all. Status is derived from this plus the
 * exit contract - never from a regex over stdout (adjudication claim 46).
 */
function traceEvidence(tracePath: string | undefined): { tracePath?: string; traceBytes?: number } {
  if (!tracePath) {
    return {};
  }
  try {
    const stats = statSync(tracePath);
    return { tracePath, traceBytes: stats.size };
  } catch {
    return { tracePath };
  }
}

function deriveBombadilStatus(input: {
  spawnFailed: boolean;
  ranEvidence: boolean;
  violationEvidence: boolean;
  timedOut: boolean;
  exitCode: number | null;
}): BombadilRunStatus {
  if (input.spawnFailed) {
    return "runtime_error";
  }
  if (!input.ranEvidence) {
    // Exit 0 with no trace and no output is not a passed run; it is no evidence of a run.
    return "runtime_error";
  }
  if (input.timedOut) {
    return "budget_exhausted";
  }
  if (input.exitCode === 0) {
    return "completed";
  }
  // A non-zero exit is a violation only where the run left evidence that it got that far:
  // the trace file for the web runner, any terminal output for the terminal runner. Without
  // it, a non-zero exit is a runtime failure, never a claim about the target.
  return input.violationEvidence ? "violation" : "runtime_error";
}

/** The Bombadil adapter: one resolution, one translation, one transport (review A7). */
export const bombadilAdapter: Adapter<BombadilBinaryResolution, BombadilAdapterProbe> = {
  id: "bombadil",

  resolve(env: NodeJS.ProcessEnv = process.env): BombadilBinaryResolution {
    return resolveBombadilBinaryResolution(env);
  },

  probe(resolution: BombadilBinaryResolution): BombadilAdapterProbe {
    return {
      binaryPath: resolution.binaryPath,
      provider: resolution.provider,
      resolutionNotes: resolution.resolutionNotes,
      versionProbed: false,
    };
  },

  translate(step: AdapterStep, resolution: BombadilBinaryResolution): AdapterInvocation {
    const args = [...(step.args ?? [])];
    return {
      source: "bombadil",
      command: resolution.binaryPath,
      args,
      timeoutMs: step.timeoutMs ?? DEFAULT_BOMBADIL_TIMEOUT_MS,
      ...(step.env ? { env: step.env } : {}),
      display: [resolution.binaryPath, ...args],
    };
  },

  effects(step: AdapterStep): AdapterEffect {
    return {
      effect: "mutating",
      scope: "target",
      reason:
        step.command === "terminal"
          ? "bounded terminal fuzz against the configured command"
          : "bounded fuzz against the configured web origin",
    };
  },

  invoke(invocation: AdapterInvocation): Promise<RawResult> {
    return spawnStep({
      source: "bombadil",
      command: invocation.command,
      args: invocation.args,
      timeoutMs: invocation.timeoutMs,
      ...(invocation.env ? { env: invocation.env } : {}),
    });
  },
};

interface BoundedBombadilRun {
  resolution: BombadilBinaryResolution;
  command: string[];
  raw: RawResult;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  ranOutput: boolean;
}

/** One bounded Bombadil invocation through the kernel boundary. */
async function runBoundedBombadilProcess(input: {
  stepId: string;
  command: string;
  args: string[];
  subject: string;
  env?: NodeJS.ProcessEnv;
  durationMs: number;
}): Promise<BoundedBombadilRun> {
  const { raw, invocation, resolution } = await invokeAdapter(
    bombadilAdapter,
    {
      id: input.stepId,
      command: input.command,
      args: input.args,
      timeoutMs: input.durationMs,
      subject: input.subject,
      ...(input.env ? { env: input.env } : {}),
    },
    ...(input.env ? [{ env: input.env }] : []),
  );

  const stdout = raw.stdout.trim();
  const stderr = raw.stderr.trim();
  return {
    resolution,
    command: invocation.display,
    raw,
    stdout,
    stderr,
    combinedOutput: [stdout, stderr].filter(Boolean).join("\n"),
    ranOutput: stdout.length > 0 || stderr.length > 0,
  };
}

function renderBombadilStderr(run: BoundedBombadilRun): string {
  const notes = run.resolution.resolutionNotes;
  if (run.raw.spawnFailure) {
    return [run.raw.spawnFailure, ...notes].join("\n");
  }
  return [run.stderr, ...notes].filter(Boolean).join("\n");
}

export async function runBombadil(input: BombadilRunInput): Promise<BombadilRunResult> {
  const options = input.options ?? {};
  const bombadilCommand = options.command ?? "test";
  const args: string[] = [bombadilCommand];
  appendBombadilOptionArgs(args, options);

  if (!options.reproduceTracePath) {
    args.push("--exit-on-violation");
  }

  if (bombadilCommand === "test") {
    if (options.headless !== false) {
      args.push("--headless");
    }
    if (options.noSandbox) {
      args.push("--no-sandbox");
    }
  } else {
    if (options.remoteDebugger) {
      args.push("--remote-debugger", options.remoteDebugger);
    }
    if (options.createTarget) {
      args.push("--create-target");
    }
  }

  args.push(input.origin);

  const run = await runBoundedBombadilProcess({
    stepId: `bombadil.${bombadilCommand}`,
    command: bombadilCommand,
    args,
    subject: input.origin,
    ...(input.env ? { env: input.env } : {}),
    durationMs: input.durationMs,
  });

  const trace = traceEvidence(
    extractTracePath(run.combinedOutput) ?? options.outputPath ?? options.reproduceTracePath,
  );
  const status = deriveBombadilStatus({
    spawnFailed: Boolean(run.raw.spawnFailure),
    ranEvidence: run.ranOutput || (trace.traceBytes ?? 0) > 0,
    // `--exit-on-violation` stops the run and leaves the trace; that trace is the evidence.
    violationEvidence: (trace.traceBytes ?? 0) > 0,
    timedOut: Boolean(run.raw.timedOut),
    exitCode: run.raw.exitCode,
  });

  return {
    status,
    binaryPath: run.resolution.binaryPath,
    binaryProvider: run.resolution.provider,
    resolutionNotes: run.resolution.resolutionNotes,
    command: run.command,
    origin: input.origin,
    durationMs: input.durationMs,
    elapsedMs: run.raw.durationMs ?? 0,
    exitCode: run.raw.exitCode,
    signal: (run.raw.signal ?? null) as NodeJS.Signals | null,
    stdout: run.raw.spawnFailure ? "" : run.stdout,
    stderr: renderBombadilStderr(run),
    ...(trace.tracePath ? { tracePath: trace.tracePath } : {}),
    ...(trace.traceBytes === undefined ? {} : { traceBytes: trace.traceBytes }),
    usedDefaultSpecification: /using default specification/i.test(run.combinedOutput),
    timedOut: Boolean(run.raw.timedOut),
  };
}

export async function runBombadilTerminalTest(
  input: BombadilTerminalRunInput,
): Promise<BombadilTerminalRunResult> {
  const targetCommand = [input.target.command, ...(input.target.args ?? [])];
  if (targetCommand.some((part) => part.trim().length === 0)) {
    throw new Error("Bombadil terminal target command and args must be non-empty strings.");
  }

  const args = ["terminal", "test", "--", ...targetCommand];
  const run = await runBoundedBombadilProcess({
    stepId: "bombadil.terminal",
    command: "terminal",
    args,
    subject: targetCommand.join(" "),
    ...(input.env ? { env: input.env } : {}),
    durationMs: input.durationMs,
  });

  // The terminal runner writes no trace file, so output is its only typed run evidence and its
  // exit status is the only contract it has.
  const status = deriveBombadilStatus({
    spawnFailed: Boolean(run.raw.spawnFailure),
    ranEvidence: run.ranOutput,
    violationEvidence: run.ranOutput,
    timedOut: Boolean(run.raw.timedOut),
    exitCode: run.raw.exitCode,
  });

  return {
    status,
    binaryPath: run.resolution.binaryPath,
    binaryProvider: run.resolution.provider,
    resolutionNotes: run.resolution.resolutionNotes,
    command: run.command,
    targetCommand,
    durationMs: input.durationMs,
    elapsedMs: run.raw.durationMs ?? 0,
    exitCode: run.raw.exitCode,
    signal: (run.raw.signal ?? null) as NodeJS.Signals | null,
    stdout: run.raw.spawnFailure ? "" : run.stdout,
    stderr: renderBombadilStderr(run),
    timedOut: Boolean(run.raw.timedOut),
  };
}
