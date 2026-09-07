/**
 * Channel separation: the payload half of the result-classification contract.
 *
 * Pure ring, no I/O. Step 2 of the packet's order lives here - exit code, signal and HTTP status
 * are transport, stderr is a recorded diagnostics channel and never payload, and for
 * `source: "surf"` (and only there) the `{result, target, notice}` wrapper is unwrapped and the
 * bookkeeping keys are moved into `transport.bookkeeping` rather than dropped. The shapes the
 * framework owns - surf's `{"error": {code, message, details}}` envelope, its `Error: <msg>
 * [code]` line and its extract rows - are read here and nowhere else, so no other module
 * re-derives them (result-classification packet, "Placement" and Clash 2).
 */

import type {
  ErrorOrigin,
  ExpectDeclaration,
  PayloadKind,
  RawResult,
  ResultErrorPayload,
} from "./result-classification.js";

/** Bookkeeping keys surf appends to its own payloads; the `_` prefix rule catches the rest. */
export const SURF_BOOKKEEPING_KEYS = [
  "id",
  "_resolvedWindowId",
  "_resolvedTabId",
  "_hint",
] as const;

const STDERR_LINE_CAP = 60;
const STDERR_HEAD_LINES = 40;
const STDERR_TAIL_LINES = 15;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeJsonStart(value: string): boolean {
  return /^(?:\{|\[|"|-?\d|true\b|false\b|null\b)/.test(value);
}

/**
 * Candidate JSON substrings of a stdout that may carry a warning prefix before the payload.
 * Nothing is stripped from stderr and nothing is guessed inside the payload.
 */
function jsonCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const candidates = new Set<string>();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const lines = trimmed.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!looksLikeJsonStart(lines[index].trim())) {
      continue;
    }
    candidates.add(lines.slice(index).join("\n"));
    candidates.add(lines[index].trim());
    break;
  }

  return [...candidates];
}

export function tryParseSurfJson(
  raw: string,
): { parsed: true; value: unknown } | { parsed: false } {
  for (const candidate of jsonCandidates(raw)) {
    try {
      return { parsed: true, value: JSON.parse(candidate) };
    } catch {
      // Try the next candidate shape; an unparsable stdout is a fact, not an exception.
    }
  }
  return { parsed: false };
}

/** Keeps the head and tail of a long channel so the line a human needs survives. */
export function capChannel(text: string): string {
  const trimmed = text.trim();
  const lines = trimmed.split(/\r?\n/);
  if (lines.length <= STDERR_LINE_CAP) {
    return trimmed;
  }
  const elided = lines.length - STDERR_HEAD_LINES - STDERR_TAIL_LINES;
  return [
    ...lines.slice(0, STDERR_HEAD_LINES),
    `[... ${elided} line(s) elided ...]`,
    ...lines.slice(lines.length - STDERR_TAIL_LINES),
  ].join("\n");
}

/**
 * The surf error contract: `{"error": {code, message, details}}` on stdout under `--json`, and
 * `Error: <message> [code]` as the first stderr line in every mode. Returns undefined when
 * neither contract-bearing shape is present, so a caller can tell an owned signal from a guess.
 */
export function readSurfErrorContract(
  stdout: string,
  stderr: string,
): { payload: ResultErrorPayload; origin: ErrorOrigin } | undefined {
  const parsed = tryParseSurfJson(stdout);
  if (parsed.parsed && isRecord(parsed.value) && isRecord(parsed.value.error)) {
    const errorObject = parsed.value.error;
    const code = typeof errorObject.code === "string" ? errorObject.code : "error";
    const message =
      typeof errorObject.message === "string" ? errorObject.message : JSON.stringify(errorObject);
    return {
      payload: {
        code,
        message,
        ...(isRecord(errorObject.details) ? { details: errorObject.details } : {}),
      },
      origin: "json_error_object",
    };
  }

  const errorLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Error:/.test(line));
  if (errorLine) {
    const match = errorLine.match(/^Error:\s*(.*?)(?:\s\[([A-Za-z0-9_.-]+)\])?$/);
    return {
      payload: {
        code: match?.[2] ?? "error",
        message: match?.[1]?.trim() || errorLine,
      },
      origin: "stderr_code_line",
    };
  }

  return undefined;
}

/**
 * The surf runtime's failure shape: the contract-bearing signal when there is one, else a
 * fallback that says what the process did. The classifier is the only interpreter of the
 * shapes surf owns; this function is its surf branch, re-exported by the surf runtime.
 */
export function parseSurfErrorOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  commandDisplay: string[],
): ResultErrorPayload {
  const contract = readSurfErrorContract(stdout, stderr);
  if (contract) {
    return contract.payload;
  }

  const fallback = stderr.trim() || stdout.trim();
  return {
    code: "error",
    message: fallback || `${commandDisplay.join(" ")} exited with code ${exitCode ?? "null"}`,
  };
}

export interface PayloadView {
  kind: PayloadKind;
  /** the parsed payload for json/rows, the raw text otherwise */
  value: unknown;
  /** the textual form used for emptiness and marker matching */
  text: string;
  bytes: number;
  rowCount?: number;
  empty: boolean;
  /** a JSON payload was declared or owned and could not be parsed */
  parseFailed: boolean;
}

export function stripBookkeeping(value: unknown, bookkeeping: Record<string, unknown>): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const kept: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if ((SURF_BOOKKEEPING_KEYS as readonly string[]).includes(key) || key.startsWith("_")) {
      bookkeeping[key] = entry;
      continue;
    }
    kept[key] = entry;
  }
  return kept;
}

export function readRows(value: unknown): { rows: unknown[]; rowCount: number | null } | undefined {
  if (Array.isArray(value)) {
    return { rows: value, rowCount: value.length };
  }
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    return undefined;
  }
  const rowCount =
    typeof value.rowCount === "number"
      ? value.rowCount
      : value.rowCount === null
        ? null
        : value.rows.length;
  return { rows: value.rows, rowCount };
}

export function isEmptyJsonPayload(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (isRecord(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

/** Step 2: separate the channels and take what remains on stdout (or the body) as payload. */
export function extractPayload(
  input: RawResult,
  declaration: ExpectDeclaration | undefined,
  bookkeeping: Record<string, unknown>,
): PayloadView {
  if (input.source === "bombadil") {
    const bytes = input.trace?.bytes ?? 0;
    return {
      kind: "trace",
      value: input.trace,
      text: input.trace?.path ?? "",
      bytes,
      empty: bytes === 0,
      parseFailed: false,
    };
  }

  if (input.source === "http") {
    const body = input.body ?? "";
    return {
      kind: "body",
      value: body,
      text: body,
      bytes: body.length,
      empty: body.trim().length === 0,
      parseFailed: false,
    };
  }

  const stdout = input.stdout;
  const trimmed = stdout.trim();

  if (input.source === "surf") {
    const parsed = tryParseSurfJson(stdout);
    if (!parsed.parsed) {
      return {
        kind: "stdout",
        value: stdout,
        text: trimmed,
        bytes: stdout.length,
        empty: trimmed.length === 0,
        parseFailed: false,
      };
    }
    // The explicit-target wrapper is transport, not payload.
    let value = parsed.value;
    if (isRecord(value) && "result" in value && "target" in value) {
      const extra = Object.keys(value).filter(
        (key) => !["result", "target", "notice"].includes(key),
      );
      if (extra.length === 0) {
        value = value.result;
      }
    }
    value = stripBookkeeping(value, bookkeeping);
    const rows = readRows(value);
    if (rows) {
      return {
        kind: "rows",
        value,
        text: trimmed,
        bytes: stdout.length,
        rowCount: rows.rowCount ?? 0,
        empty: rows.rows.length === 0 && (rows.rowCount === 0 || rows.rowCount === null),
        parseFailed: false,
      };
    }
    return {
      kind: "json",
      value,
      text: trimmed,
      bytes: stdout.length,
      empty: isEmptyJsonPayload(value),
      parseFailed: false,
    };
  }

  // cli: stdout is opaque unless a payload contract is declared.
  if (declaration?.payload === "json") {
    const parsed = tryParseSurfJson(stdout);
    if (!parsed.parsed) {
      return {
        kind: "json",
        value: undefined,
        text: trimmed,
        bytes: stdout.length,
        empty: trimmed.length === 0,
        parseFailed: trimmed.length > 0,
      };
    }
    return {
      kind: "json",
      value: parsed.value,
      text: trimmed,
      bytes: stdout.length,
      empty: isEmptyJsonPayload(parsed.value),
      parseFailed: false,
    };
  }

  return {
    kind: "stdout",
    value: stdout,
    text: trimmed,
    bytes: stdout.length,
    empty: trimmed.length === 0,
    parseFailed: false,
  };
}

export function topLevelErrorField(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  const field = value.error;
  return field === null ? undefined : field;
}

export function renderErrorFieldMessage(field: unknown): string {
  if (typeof field === "string") {
    return field;
  }
  if (isRecord(field) && typeof field.message === "string") {
    return field.message;
  }
  return JSON.stringify(field);
}

/** An extract row that carries its own `error` field: the HOSTERR case, on rows surf owns. */
export function rowError(view: PayloadView): unknown {
  if (view.kind !== "rows") {
    return undefined;
  }
  const rows = readRows(view.value)?.rows ?? [];
  for (const row of rows) {
    const field = topLevelErrorField(row);
    if (field !== undefined) {
      return field;
    }
  }
  return undefined;
}

/** surf's own `--empty-text` state, as it appears in the extract payload's readiness block. */
export function surfEmptyReadiness(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const readiness = value.readiness;
  return isRecord(readiness) && readiness.state === "empty";
}
