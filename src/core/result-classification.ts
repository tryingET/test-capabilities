/**
 * Result classification: the one shape every sensor result arrives in.
 *
 * Pure ring (implementation plan §1, architecture adjudication Part 4): this module imports
 * neither `node:fs` nor `node:child_process`, so the classification of a run is a replayable
 * function of recorded fields and nothing else. `RawResult` is what the kernel boundary
 * (`Adapter.invoke`, `src/core/adapter.ts`) returns; `classifyResult` (slice S3 commit (3))
 * turns it into the closed `ResultOutcome` class set of the result-classification packet.
 */

/** Every sensor whose results this contract classifies. */
export type ResultSource = "cli" | "surf" | "http" | "bombadil";

/**
 * A transport reply, before any judgement. Channels are separate: `stderr` is diagnostics and
 * is never payload, `exitCode`/`signal`/`httpStatus` are transport, and what the process wrote
 * to stdout (or the HTTP body) is the only payload candidate.
 */
export interface RawResult {
  source: ResultSource;
  /** null when the process was killed by a signal, never started, or the transport is not a process. */
  exitCode: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  durationMs?: number;
  /** true when the framework's own budget killed the step; the exit code is then meaningless. */
  timedOut?: boolean;
  /** set when the transport never produced a result (spawn error, connect error). */
  spawnFailure?: string;
  httpStatus?: number;
  /** HTTP request method, so protocol-level emptiness (HEAD) can be declared. */
  httpMethod?: string;
  body?: string;
  /** Bombadil's trace file: the typed evidence that the run produced something (claim 46). */
  trace?: { path?: string; bytes?: number };
  /**
   * The declared effect class of the step that produced this result. A transport failure on a
   * mutating step has an unknown outcome and is `indeterminate`, never a target fault
   * (architecture review A4); the mutation ledger sets this in S5.
   */
  effect?: "read_only" | "mutating";
}

/**
 * Codes a read-only step may be retried on. Owned here and re-exported by the effects module
 * in S5 (mutation-safety packet, architecture review A7).
 */
export const TRANSIENT_CODES = [
  "timeout",
  "spawn_failed",
  "browser_error",
  "page_timeout",
] as const;

export type TransientCode = (typeof TRANSIENT_CODES)[number];

export function isTransientCode(code: string): code is TransientCode {
  return (TRANSIENT_CODES as readonly string[]).includes(code);
}
