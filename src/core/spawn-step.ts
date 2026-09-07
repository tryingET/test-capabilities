/**
 * The single spawn transport.
 *
 * Every child process the framework starts goes through this module: `Adapter.invoke`
 * (`src/core/adapter.ts`) is the named kernel boundary and this file is its process transport
 * (architecture review A7, adjudication claims 2, 21, 37). `tests/spawn_boundary_contract.test.mjs`
 * greps `src/` and fails if any other module imports `node:child_process`, so the mutation
 * ledger's `runStep` can become the only mutating caller in S5.
 *
 * The semantics are the ones the CLI tester and the Bombadil runner each had their own copy of:
 * a bounded budget, SIGTERM to the whole process group, SIGKILL after a grace period, and a cap
 * on the output the framework keeps in memory.
 */

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import type { RawResult, ResultSource } from "./result-classification.js";

export const DEFAULT_MAX_OUTPUT_CHARS = 64_000;
export const FORCE_KILL_GRACE_MS = 1_000;

export interface SpawnStepInput {
  /** the sensor asking; lands on `RawResult.source` for the classifier */
  source: ResultSource;
  command: string;
  args: readonly string[];
  timeoutMs: number;
  /** undefined inherits the parent environment, exactly like `child_process` */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  maxOutputChars?: number;
}

/** Appends `chunk` to `current` up to `cap` characters, marking the cut once. */
export function appendCappedOutput(current: string, chunk: string, cap: number): string {
  if (current.length >= cap) {
    return current;
  }

  const remaining = cap - current.length;
  if (chunk.length <= remaining) {
    return current + chunk;
  }

  return `${current}${chunk.slice(0, remaining)}\n[output truncated after ${cap} characters]`;
}

function assertSpawnInput(input: SpawnStepInput): void {
  if (typeof input.command !== "string" || input.command.trim() === "") {
    throw new Error("spawnStep requires a non-empty command; the caller must resolve it first.");
  }
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error(
      `spawnStep requires a positive timeout budget; received ${String(input.timeoutMs)}.`,
    );
  }
}

/**
 * Runs a bounded child process and reports it as a `RawResult`. Never throws for a target
 * failure: a process that could not be started is reported with `spawnFailure` set and
 * `exitCode: null` so the classifier, not the caller, decides what it means.
 */
export function spawnStep(input: SpawnStepInput): Promise<RawResult> {
  assertSpawnInput(input);
  const cap = input.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let closed = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const settle = (result: Omit<RawResult, "source" | "durationMs">): void => {
      resolve({
        source: input.source,
        durationMs: Date.now() - startedAt,
        ...result,
      });
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(input.command, [...input.args], {
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        ...(input.env ? { env: input.env } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
      });
    } catch (error) {
      settle({
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        spawnFailure: error instanceof Error ? error.message : String(error),
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
      }, FORCE_KILL_GRACE_MS);
    }, input.timeoutMs);

    const clearTimers = (): void => {
      closed = true;
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
    };

    proc.stdout?.on("data", (data) => {
      stdout = appendCappedOutput(stdout, String(data), cap);
    });
    proc.stderr?.on("data", (data) => {
      stderr = appendCappedOutput(stderr, String(data), cap);
    });

    proc.on("close", (code, signal) => {
      clearTimers();
      settle({ exitCode: code, signal, stdout, stderr, timedOut });
    });

    proc.on("error", (error) => {
      clearTimers();
      settle({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        spawnFailure: error.message,
      });
    });
  });
}

/**
 * The synchronous path of the same transport, for callers that cannot yield (the surf runtime's
 * command mapping). `spawnSync` enforces the budget itself and reports `ETIMEDOUT`.
 */
export function spawnStepSync(input: SpawnStepInput): RawResult {
  assertSpawnInput(input);
  const cap = input.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const startedAt = Date.now();
  const result = spawnSync(input.command, [...input.args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: input.timeoutMs,
    ...(input.env ? { env: input.env } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
  });
  const durationMs = Date.now() - startedAt;
  const stdout = appendCappedOutput("", (result.stdout as string | null) ?? "", cap);
  const stderr = appendCappedOutput("", (result.stderr as string | null) ?? "", cap);

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    const timedOut = error.code === "ETIMEDOUT";
    return {
      source: input.source,
      exitCode: result.status,
      signal: result.signal ?? null,
      stdout,
      stderr,
      durationMs,
      timedOut,
      ...(timedOut ? {} : { spawnFailure: error.message }),
    };
  }

  return {
    source: input.source,
    exitCode: result.status,
    signal: result.signal ?? null,
    stdout,
    stderr,
    durationMs,
    timedOut: false,
  };
}
