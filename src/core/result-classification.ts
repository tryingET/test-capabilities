/**
 * Result classification: one closed verdict for every sensor run.
 *
 * Pure ring (implementation plan §1, architecture adjudication Part 4): this module imports
 * neither `node:fs` nor `node:child_process`, so a verdict is a replayable function of recorded
 * fields and nothing else. `RawResult` is what the kernel boundary (`Adapter.invoke`,
 * `src/core/adapter.ts`) returns; `classifyResult` turns it into a `ResultOutcome` from the
 * closed class set of `docs/project/2026-09-07-result-classification-design.md` as refined.
 *
 * The four regions of that packet's decision, in order of application:
 *   1. transport before payload - a step that never produced a result is a transport failure,
 *      and on a mutating step its basis is `indeterminate`, never a target fault (review A4);
 *   2. channels before judgement - stderr is diagnostics, never payload, never pattern-stripped;
 *      surf bookkeeping keys are moved to `transport.bookkeeping`, never dropped;
 *   3. error signals only under an owned or declared contract - surf's envelope, `[code]` line
 *      and rows, the framework's own action result, a declared `payload: json` / `error_envelope`;
 *      everything else is recorded in `recorded` and changes no class;
 *   4. `ok: true` requires a non-empty payload or a declaration (config, operation code, or an
 *      HTTP protocol fact); an undeclared empty run is `empty` with basis `no_evidence`, which
 *      is the absence of information, never a claim about the target.
 */

import { RESULT_RECORDED_SIGNALS } from "./error-codes.js";
import type { PayloadView } from "./result-payload.js";
import {
  capChannel,
  extractPayload,
  isRecord,
  readSurfErrorContract,
  renderErrorFieldMessage,
  rowError,
  surfEmptyReadiness,
  topLevelErrorField,
  tryParseSurfJson,
} from "./result-payload.js";

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

/** The closed class set; exported as a value so consumers can enumerate it (S4 counts them). */
export const OUTCOME_CLASSES = [
  "success",
  "declared_empty",
  "empty",
  "error",
  "timeout",
  "spawn_failed",
  "unclassifiable",
] as const;

export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

export const OUTCOME_BASES = [
  "evidence",
  "fault",
  "no_evidence",
  "contradiction",
  "indeterminate",
] as const;

export type OutcomeBasis = (typeof OUTCOME_BASES)[number];

export type PayloadKind = "stdout" | "json" | "rows" | "body" | "trace";

export type ErrorOrigin =
  | "json_error_object"
  | "stderr_code_line"
  | "exit_code"
  | "payload_error_field"
  | "http_status";

/**
 * What a caller declares about the payload it expects. The keys are the config keys of
 * `agents.<name>.expect` (result-classification packet, "Declaring acceptable emptiness"), so a
 * declaration travels from the config file to the classifier without a hand-written mirror.
 */
export interface ExpectDeclaration {
  output?: "required" | "empty";
  empty_marker?: string;
  payload?: "opaque" | "json";
  error_envelope?: boolean;
  /**
   * Where the declaration came from: `config:agents.<name>.expect`,
   * `operation:surf.explore.links`, `protocol:http_<status>` or `author:<tester>` (claim 4).
   */
  declaredBy: string;
}

export interface ResultErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ResultOutcome {
  class: OutcomeClass;
  /** true only for "success" and "declared_empty" */
  ok: boolean;
  basis: OutcomeBasis;
  code: string;
  source: ResultSource;
  transport: {
    exitCode: number | null;
    signal?: string;
    httpStatus?: number;
    durationMs?: number;
    /** the whole channel, trimmed and capped; never payload */
    stderr: string;
    /** surf only; every stripped key lands here rather than being dropped */
    bookkeeping: Record<string, unknown>;
    contradictions: string[];
  };
  payload: { kind: PayloadKind; bytes: number; rowCount?: number; empty: boolean };
  emptiness?: { declared: boolean; declaredBy: string; marker?: string; markerMatched?: boolean };
  error?: ResultErrorPayload & { origin: ErrorOrigin };
  /** signals seen under no contract and therefore not interpreted */
  recorded: string[];
  /** first line `outcome:<class>:<code>`, second `basis:<basis>` */
  evidence: string[];
}

/**
 * The message for a bare non-zero exit: the diagnostics channel first, then the payload preview,
 * then the bare fact. Nothing is invented and no channel is folded into another.
 */
function exitMessage(input: RawResult, view: PayloadView, subject: string): string {
  const stderr = capChannel(input.stderr);
  if (stderr.length > 0) {
    return stderr;
  }
  const preview = view.text.slice(0, 200);
  return preview || `${subject} exited with code ${input.exitCode}`;
}

function basisForTransportFailure(input: RawResult): OutcomeBasis {
  return input.effect === "mutating" ? "indeterminate" : "fault";
}

function renderEvidence(outcome: Omit<ResultOutcome, "evidence">): string[] {
  const evidence = [`outcome:${outcome.class}:${outcome.code}`, `basis:${outcome.basis}`];
  const transportParts = [`exit:${outcome.transport.exitCode ?? "null"}`];
  if (outcome.transport.signal) {
    transportParts.push(`signal:${outcome.transport.signal}`);
  }
  if (outcome.transport.httpStatus !== undefined) {
    transportParts.push(`http:${outcome.transport.httpStatus}`);
  }
  if (outcome.transport.durationMs !== undefined) {
    transportParts.push(`durationMs:${outcome.transport.durationMs}`);
  }
  evidence.push(`transport:${transportParts.join(" ")}`);
  evidence.push(
    `payload:${outcome.payload.kind} bytes:${outcome.payload.bytes}${
      outcome.payload.rowCount === undefined ? "" : ` rows:${outcome.payload.rowCount}`
    }${outcome.payload.empty ? " empty" : ""}`,
  );
  if (outcome.emptiness) {
    evidence.push(
      `emptiness:declaredBy:${outcome.emptiness.declaredBy}${
        outcome.emptiness.marker === undefined ? "" : ` marker:${outcome.emptiness.marker}`
      }${
        outcome.emptiness.markerMatched === undefined
          ? ""
          : ` markerMatched:${outcome.emptiness.markerMatched}`
      }`,
    );
  }
  if (outcome.error) {
    evidence.push(`error:${outcome.error.origin}:${outcome.error.code}: ${outcome.error.message}`);
  }
  const bookkeepingKeys = Object.keys(outcome.transport.bookkeeping);
  if (bookkeepingKeys.length > 0) {
    evidence.push(`bookkeeping:${bookkeepingKeys.sort().join(",")}`);
  }
  for (const contradiction of outcome.transport.contradictions) {
    evidence.push(`contradiction:${contradiction}`);
  }
  for (const signal of outcome.recorded) {
    evidence.push(`recorded:${signal}`);
  }
  if (outcome.transport.stderr.length > 0) {
    evidence.push(`stderr:\n${outcome.transport.stderr}`);
  }
  return evidence;
}

const OK_CLASSES: readonly OutcomeClass[] = ["success", "declared_empty"];

/**
 * Classify one transport reply. Deterministic: the first matching step decides, and every
 * ignored, stripped or contradicting signal is recorded rather than dropped.
 */
export function classifyResult(input: RawResult, declaration?: ExpectDeclaration): ResultOutcome {
  const bookkeeping: Record<string, unknown> = {};
  const contradictions: string[] = [];
  const recorded: string[] = [];

  const finish = (
    parts: Pick<ResultOutcome, "class" | "basis" | "code"> &
      Partial<Pick<ResultOutcome, "error" | "emptiness">> & { payload: ResultOutcome["payload"] },
  ): ResultOutcome => {
    const base: Omit<ResultOutcome, "evidence"> = {
      class: parts.class,
      ok: OK_CLASSES.includes(parts.class),
      basis: parts.basis,
      code: parts.code,
      source: input.source,
      transport: {
        exitCode: input.exitCode,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.httpStatus === undefined ? {} : { httpStatus: input.httpStatus }),
        ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
        stderr: capChannel(input.stderr),
        bookkeeping,
        contradictions,
      },
      payload: parts.payload,
      ...(parts.emptiness ? { emptiness: parts.emptiness } : {}),
      ...(parts.error ? { error: parts.error } : {}),
      recorded,
    };
    return { ...base, evidence: renderEvidence(base) };
  };

  // ---- step 1: transport failure, before anything is read as payload
  const noPayload = (kind: PayloadKind): ResultOutcome["payload"] => ({
    kind,
    bytes: 0,
    empty: true,
  });

  if (input.spawnFailure) {
    return finish({
      class: "spawn_failed",
      code: "spawn_failed",
      basis: basisForTransportFailure(input),
      payload: noPayload(input.source === "http" ? "body" : "stdout"),
      error: { code: "spawn_failed", message: input.spawnFailure, origin: "exit_code" },
    });
  }

  if (input.timedOut || (input.exitCode === null && input.signal)) {
    const code = input.timedOut ? "timeout" : `signal_${input.signal}`;
    return finish({
      class: "timeout",
      code,
      basis: basisForTransportFailure(input),
      payload: noPayload(input.source === "http" ? "body" : "stdout"),
      error: {
        code,
        message: input.timedOut
          ? "the step was killed at its budget before it reported a result"
          : `the step was killed by ${input.signal}`,
        origin: "exit_code",
      },
    });
  }

  // ---- step 2: channels
  const view = extractPayload(input, declaration, bookkeeping);
  const payload: ResultOutcome["payload"] = {
    kind: view.kind,
    bytes: view.bytes,
    ...(view.rowCount === undefined ? {} : { rowCount: view.rowCount }),
    empty: view.empty,
  };

  // ---- step 3: error signals, under an owned or declared contract only
  const errorField = topLevelErrorField(view.value);

  if (input.source === "surf") {
    const contract = readSurfErrorContract(input.stdout, input.stderr);
    if (contract) {
      if (input.exitCode === 0) {
        contradictions.push("exit 0 with error object");
      }
      return finish({
        class: "error",
        code: contract.payload.code,
        basis: "fault",
        payload,
        error: { ...contract.payload, origin: contract.origin },
      });
    }

    const row = rowError(view);
    if (row !== undefined) {
      if (input.exitCode === 0) {
        contradictions.push("exit 0 with an error field on an extract row");
      }
      return finish({
        class: "error",
        code: "row_error",
        basis: "fault",
        payload,
        error: {
          code: "row_error",
          message: renderErrorFieldMessage(row),
          origin: "payload_error_field",
        },
      });
    }

    // The framework's own action result: `success: true` carrying an error is a contradiction.
    if (isRecord(view.value) && view.value.success === true && errorField !== undefined) {
      contradictions.push("success: true with an error field");
      return finish({
        class: "unclassifiable",
        code: "unclassifiable",
        basis: "contradiction",
        payload,
        error: {
          code: "unclassifiable",
          message: `a success result carries an error field: ${renderErrorFieldMessage(errorField)}`,
          origin: "payload_error_field",
        },
      });
    }

    if (input.exitCode !== 0) {
      return finish({
        class: "error",
        code: `exit_${input.exitCode}`,
        basis: "fault",
        payload,
        error: {
          code: `exit_${input.exitCode}`,
          message: exitMessage(input, view, "surf"),
          origin: "exit_code",
        },
      });
    }
  }

  if (input.source === "cli" || input.source === "bombadil") {
    if (view.parseFailed) {
      return finish({
        class: "unclassifiable",
        code: "invalid_output",
        basis: "contradiction",
        payload,
        error: {
          code: "invalid_output",
          message: `expected a JSON payload (${declaration?.declaredBy ?? "declared"}) but stdout did not parse: ${view.text.slice(0, 200)}`,
          origin: "payload_error_field",
        },
      });
    }

    if (input.exitCode !== 0) {
      return finish({
        class: "error",
        code: `exit_${input.exitCode}`,
        basis: "fault",
        payload,
        error: {
          code: `exit_${input.exitCode}`,
          message: exitMessage(input, view, "the step"),
          origin: "exit_code",
        },
      });
    }

    // Exit 0 with a declared JSON envelope: the envelope wins only where it was declared.
    if (declaration?.payload === "json" && errorField !== undefined) {
      if (declaration.error_envelope === true) {
        return finish({
          class: "error",
          code: "error",
          basis: "fault",
          payload,
          error: {
            code: "error",
            message: renderErrorFieldMessage(errorField),
            origin: "json_error_object",
          },
        });
      }
      contradictions.push("exit 0 with an error envelope in a declared JSON payload");
      return finish({
        class: "unclassifiable",
        code: "unclassifiable",
        basis: "contradiction",
        payload,
        error: {
          code: "unclassifiable",
          message: `exit 0 with a non-null error field: ${renderErrorFieldMessage(errorField)}`,
          origin: "json_error_object",
        },
      });
    }

    // Unowned shapes are recorded, never interpreted (refinement, clash 2).
    if (/^\s*Error:/m.test(input.stderr)) {
      recorded.push("stderr_error_line");
    }
    if (declaration?.payload !== "json") {
      const parsed = tryParseSurfJson(input.stdout);
      if (parsed.parsed && topLevelErrorField(parsed.value) !== undefined) {
        recorded.push("payload_error_key_present");
      }
    }
  }

  if (input.source === "http") {
    const status = input.httpStatus;
    const isSuccessStatus = status !== undefined && status >= 200 && status < 400;
    if (status === undefined || !isSuccessStatus) {
      return finish({
        class: "error",
        code: `http_${status ?? "unknown"}`,
        basis: "fault",
        payload,
        error: {
          code: `http_${status ?? "unknown"}`,
          message:
            status === undefined
              ? "the HTTP transport reported no status"
              : `the endpoint answered ${status}`,
          origin: "http_status",
        },
      });
    }

    const parsedBody = tryParseSurfJson(input.body ?? "");
    const bodyError = parsedBody.parsed ? topLevelErrorField(parsedBody.value) : undefined;
    if (bodyError !== undefined) {
      if (declaration?.error_envelope === true) {
        return finish({
          class: "error",
          code: "error",
          basis: "fault",
          payload,
          error: {
            code: "error",
            message: renderErrorFieldMessage(bodyError),
            origin: "json_error_object",
          },
        });
      }
      contradictions.push(`status ${status} with an error envelope in the body`);
      return finish({
        class: "unclassifiable",
        code: "unclassifiable",
        basis: "contradiction",
        payload,
        error: {
          code: "unclassifiable",
          message: `status ${status} disagrees with the body's error field: ${renderErrorFieldMessage(bodyError)}`,
          origin: "json_error_object",
        },
      });
    }
  }

  // ---- step 4: emptiness
  const effectiveDeclaration = declaration ?? protocolDeclaration(input);
  const marker = effectiveDeclaration?.empty_marker;
  const markerMatched =
    marker === undefined
      ? undefined
      : view.text.trim().toLowerCase() === marker.trim().toLowerCase() ||
        surfEmptyReadiness(view.value);

  if (marker !== undefined && markerMatched === true && !view.empty) {
    // The target said "no results" in the words the operator declared.
    return finish({
      class: "declared_empty",
      code: "declared_empty",
      basis: "evidence",
      payload: { ...payload, empty: true },
      emptiness: {
        declared: true,
        declaredBy: (effectiveDeclaration as ExpectDeclaration).declaredBy,
        marker,
        markerMatched,
      },
    });
  }

  if (view.empty) {
    const declared = effectiveDeclaration?.output === "empty";
    if (declared && (marker === undefined || markerMatched === true)) {
      return finish({
        class: "declared_empty",
        code: "declared_empty",
        basis: "evidence",
        payload,
        emptiness: {
          declared: true,
          declaredBy: (effectiveDeclaration as ExpectDeclaration).declaredBy,
          ...(marker === undefined ? {} : { marker, markerMatched }),
        },
      });
    }

    return finish({
      class: "empty",
      code: "empty_result",
      basis: "no_evidence",
      payload,
      emptiness: {
        declared: Boolean(declared),
        declaredBy: effectiveDeclaration?.declaredBy ?? "default:output_required",
        ...(marker === undefined ? {} : { marker, markerMatched }),
      },
    });
  }

  // ---- step 5: a payload with no error signal is the only way to reach ok
  return finish({
    class: "success",
    code: "ok",
    basis: "evidence",
    payload,
  });
}

/** HTTP 204, 304 and any HEAD response declare their own emptiness (refinement). */
function protocolDeclaration(input: RawResult): ExpectDeclaration | undefined {
  if (input.source !== "http") {
    return undefined;
  }
  const status = input.httpStatus;
  if (status === 204 || status === 304) {
    return { output: "empty", declaredBy: `protocol:http_${status}` };
  }
  if (input.httpMethod?.toUpperCase() === "HEAD") {
    return { output: "empty", declaredBy: `protocol:http_${status ?? "head"}` };
  }
  return undefined;
}

/** A recorded signal never changes a class; this is the guard the contract test pins. */
export function isRecordedSignal(signal: string): boolean {
  return (RESULT_RECORDED_SIGNALS as readonly string[]).includes(signal);
}
