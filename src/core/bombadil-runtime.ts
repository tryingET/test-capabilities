import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
  usedDefaultSpecification: boolean;
  timedOut: boolean;
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

function looksLikeViolation(output: string): boolean {
  return /\bviolation\b/i.test(output) || /\bproperty\b.*\bfailed\b/i.test(output);
}

function looksLikeBombadilRunEvidence(output: string): boolean {
  return /using default specification|storing trace in|starting test|bombadil/i.test(output);
}

function looksLikeBombadilTerminalEvidence(output: string): boolean {
  return /terminal|pty|starting test|bombadil/i.test(output);
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

async function runBoundedBombadilProcess(input: {
  args: string[];
  env?: NodeJS.ProcessEnv;
  durationMs: number;
}): Promise<{
  command: string[];
  binaryPath: string;
  binaryProvider: BombadilBinaryResolution["provider"];
  resolutionNotes: string[];
  elapsedMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const resolution = resolveBombadilBinaryResolution(input.env);
  const { binaryPath, provider, resolutionNotes } = resolution;
  const command = [binaryPath, ...input.args];
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let closed = false;
    const forceKillGraceMs = 1_000;
    let forceKillTimer: NodeJS.Timeout | undefined;

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(binaryPath, input.args, {
        env: input.env,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      resolve({
        binaryPath,
        command,
        elapsedMs,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: [`Failed to start Bombadil: ${message}`, ...resolutionNotes].join("\n"),
        binaryProvider: provider,
        resolutionNotes,
        timedOut: false,
      });
      return;
    }

    const killProcessTree = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== "win32" && typeof proc.pid === "number") {
          process.kill(-proc.pid, signal);
          return;
        }

        proc.kill(signal);
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
          throw error;
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!closed) {
          killProcessTree("SIGKILL");
        }
      }, forceKillGraceMs);
    }, input.durationMs);

    proc.stdout?.on("data", (data) => {
      stdout += String(data);
    });

    proc.stderr?.on("data", (data) => {
      stderr += String(data);
    });

    proc.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }

      const renderedStdout = stdout.trim();
      const renderedStderr = stderr.trim();
      const elapsedMs = Date.now() - startedAt;
      resolve({
        binaryPath,
        command,
        elapsedMs,
        exitCode: code,
        signal,
        stdout: renderedStdout,
        stderr: [renderedStderr, ...resolutionNotes].filter(Boolean).join("\n"),
        binaryProvider: provider,
        resolutionNotes,
        timedOut,
      });
    });

    proc.on("error", (error) => {
      closed = true;
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }

      const elapsedMs = Date.now() - startedAt;
      resolve({
        binaryPath,
        command,
        elapsedMs,
        exitCode: null,
        signal: null,
        stdout: stdout.trim(),
        stderr: [error.message, ...resolutionNotes].join("\n"),
        binaryProvider: provider,
        resolutionNotes,
        timedOut,
      });
    });
  });
}

export async function runBombadil(input: BombadilRunInput): Promise<BombadilRunResult> {
  const resolution = resolveBombadilBinaryResolution(input.env);
  const { binaryPath, provider, resolutionNotes } = resolution;
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

  const command = [binaryPath, ...args];
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let closed = false;
    const forceKillGraceMs = 1_000;
    let forceKillTimer: NodeJS.Timeout | undefined;

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(binaryPath, args, {
        env: input.env,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      resolve({
        status: "runtime_error",
        binaryPath,
        command,
        origin: input.origin,
        durationMs: input.durationMs,
        elapsedMs,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: [`Failed to start Bombadil: ${message}`, ...resolutionNotes].join("\n"),
        binaryProvider: provider,
        resolutionNotes,
        usedDefaultSpecification: false,
        timedOut: false,
      });
      return;
    }

    const killProcessTree = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== "win32" && typeof proc.pid === "number") {
          process.kill(-proc.pid, signal);
          return;
        }

        proc.kill(signal);
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
          throw error;
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!closed) {
          killProcessTree("SIGKILL");
        }
      }, forceKillGraceMs);
    }, input.durationMs);

    proc.stdout?.on("data", (data) => {
      stdout += String(data);
    });

    proc.stderr?.on("data", (data) => {
      stderr += String(data);
    });

    proc.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }

      const renderedStdout = stdout.trim();
      const renderedStderr = stderr.trim();
      const combinedOutput = [renderedStdout, renderedStderr].filter(Boolean).join("\n");
      const elapsedMs = Date.now() - startedAt;
      const status: BombadilRunStatus = timedOut
        ? "budget_exhausted"
        : code === 0 && looksLikeBombadilRunEvidence(combinedOutput)
          ? "completed"
          : looksLikeViolation(combinedOutput)
            ? "violation"
            : "runtime_error";

      resolve({
        status,
        binaryPath,
        command,
        origin: input.origin,
        durationMs: input.durationMs,
        elapsedMs,
        exitCode: code,
        signal,
        stdout: renderedStdout,
        stderr: [renderedStderr, ...resolutionNotes].filter(Boolean).join("\n"),
        binaryProvider: provider,
        resolutionNotes,
        tracePath: extractTracePath(combinedOutput),
        usedDefaultSpecification: /using default specification/i.test(combinedOutput),
        timedOut,
      });
    });

    proc.on("error", (error) => {
      closed = true;
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }

      const elapsedMs = Date.now() - startedAt;
      resolve({
        status: "runtime_error",
        binaryPath,
        command,
        origin: input.origin,
        durationMs: input.durationMs,
        elapsedMs,
        exitCode: null,
        signal: null,
        stdout: stdout.trim(),
        stderr: [error.message, ...resolutionNotes].join("\n"),
        binaryProvider: provider,
        resolutionNotes,
        tracePath: extractTracePath(stderr),
        usedDefaultSpecification: /using default specification/i.test(stderr),
        timedOut,
      });
    });
  });
}

export async function runBombadilTerminalTest(
  input: BombadilTerminalRunInput,
): Promise<BombadilTerminalRunResult> {
  const targetCommand = [input.target.command, ...(input.target.args ?? [])];
  if (targetCommand.some((part) => part.trim().length === 0)) {
    throw new Error("Bombadil terminal target command and args must be non-empty strings.");
  }

  const args = ["terminal", "test", "--", ...targetCommand];
  const processResult = await runBoundedBombadilProcess({
    args,
    env: input.env,
    durationMs: input.durationMs,
  });
  const combinedOutput = [processResult.stdout, processResult.stderr].filter(Boolean).join("\n");
  const status: BombadilRunStatus = processResult.timedOut
    ? "budget_exhausted"
    : processResult.exitCode === 0 && looksLikeBombadilTerminalEvidence(combinedOutput)
      ? "completed"
      : looksLikeViolation(combinedOutput)
        ? "violation"
        : "runtime_error";

  return {
    status,
    ...processResult,
    targetCommand,
    durationMs: input.durationMs,
  };
}
