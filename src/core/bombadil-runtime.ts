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

export interface BombadilRunInput {
  origin: string;
  durationMs: number;
  env?: NodeJS.ProcessEnv;
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
  return `${contextLabel} found at ${repoRoot}, but no built Bombadil binary exists at ${candidateList}. Build Bombadil first (for example: 'cargo build --release --bin bombadil'). Upstream Bombadil currently also expects 'trunk' and 'esbuild' for a local build, or use its Nix shell.`;
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

export async function runBombadil(input: BombadilRunInput): Promise<BombadilRunResult> {
  const resolution = resolveBombadilBinaryResolution(input.env);
  const { binaryPath, provider, resolutionNotes } = resolution;
  const args = ["test", input.origin, "--headless", "--exit-on-violation"];
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
