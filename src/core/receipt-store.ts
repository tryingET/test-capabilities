/**
 * The mutation receipt (schema v1) and the store interface the ledger writes it through.
 *
 * Pure ring: this module imports neither `node:fs` nor `node:child_process`. It owns the
 * receipt *shape*, the in-doubt rule and the redaction rule; the file implementation lives in
 * `src/core/artifacts.ts` (adjudication claim 6, architecture review A9), and a test may
 * substitute any other implementation of {@link ReceiptStore}.
 *
 * A receipt is the runtime shadow of the effect declaration (mutation-safety packet, School 4):
 * the declaration says a step *may* act, the receipt says it *did* - or, while it is
 * `attempting`, that nobody knows. Receipts are never deleted or rewritten in place by a later
 * run; a superseding receipt names the one it supersedes and both stay on disk.
 */

export const MUTATION_RECEIPT_KIND = "test-capabilities.mutation.receipt";
export const MUTATION_RECEIPT_SCHEMA_VERSION = 1;

/**
 * `attempting` and `unknown` are *in doubt*: the framework recorded an intent it cannot resolve
 * from its own memory. `applied` and `failed` are definite and never block a later run
 * (mutation-safety packet, refinement decision "in-doubt interlock across runs").
 */
export const MUTATION_OUTCOMES = ["attempting", "applied", "failed", "unknown"] as const;
export type MutationOutcome = (typeof MUTATION_OUTCOMES)[number];

/** A single read-only post-read may promote `unknown`; nothing may demote it. */
export type VerifyResult = "applied" | "indeterminate";

export interface MutationReceiptError {
  code: string;
  message: string;
}

export interface MutationReceipt {
  schema_version: typeof MUTATION_RECEIPT_SCHEMA_VERSION;
  artifact_kind: typeof MUTATION_RECEIPT_KIND;
  receipt_id: string;
  run_id: string;
  operation_id: string;
  step_id: string;
  effect: "mutating";
  scope: "target" | "workspace" | "browser_session";
  subject: string;
  intent: string;
  idempotency_key: string;
  attempt: number;
  started_at: string;
  finished_at?: string;
  precondition?: string;
  outcome: MutationOutcome;
  verified_by?: "post_read";
  evidence: string[];
  error?: MutationReceiptError;
  checkpoint_ref?: string;
  compensation_of?: string;
  supersedes?: string;
  /**
   * True when the store this receipt was written to was declared ephemeral by the operator
   * (`receipts.ephemeral: true`, operator decision D5). A receipt that says so is a receipt
   * whose interlock may not survive the workspace.
   */
  ephemeral_store?: boolean;
  /** The adapter-specific payload; the submit gate's plan/mode/fields live here (review A1). */
  details?: Record<string, unknown>;
}

export interface ReceiptFilter {
  idempotencyKey?: string;
  planId?: string;
  mode?: string;
  outcome?: MutationOutcome;
  /** only the receipts that are in doubt (`attempting` or `unknown`) */
  inDoubt?: boolean;
}

/**
 * Where receipts live. `append` must not return before the receipt is on stable storage, and
 * writing the same `receipt_id` again replaces that one receipt atomically (the finalising
 * rewrite after the act).
 */
export interface ReceiptStore {
  readonly dir: string;
  append(receipt: MutationReceipt): Promise<void>;
  list(filter?: ReceiptFilter): Promise<MutationReceipt[]>;
}

/** `attempting` and `unknown` are the two states that block a later run with the same key. */
export function isInDoubt(receipt: Pick<MutationReceipt, "outcome">): boolean {
  return receipt.outcome === "attempting" || receipt.outcome === "unknown";
}

function detailValue(receipt: MutationReceipt, key: string): unknown {
  const details = receipt.details;
  return details === undefined ? undefined : details[key];
}

export function matchesReceiptFilter(receipt: MutationReceipt, filter?: ReceiptFilter): boolean {
  if (!filter) {
    return true;
  }
  if (filter.idempotencyKey !== undefined && receipt.idempotency_key !== filter.idempotencyKey) {
    return false;
  }
  if (filter.planId !== undefined && detailValue(receipt, "plan_id") !== filter.planId) {
    return false;
  }
  if (filter.mode !== undefined && detailValue(receipt, "mode") !== filter.mode) {
    return false;
  }
  if (filter.outcome !== undefined && receipt.outcome !== filter.outcome) {
    return false;
  }
  if (filter.inDoubt === true && !isInDoubt(receipt)) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Read a stored artifact back as a receipt, failing closed.
 *
 * A file that carries our artifact kind but not our shape is not discarded and is not trusted:
 * it becomes an `unknown` receipt, so a damaged store blocks the key it names instead of
 * silently unlocking it. The operator resolves it the same way as any other in-doubt receipt,
 * with `--supersede-receipt`.
 */
export function coerceReceipt(
  artifact: Record<string, unknown>,
  fallbackReceiptId: string,
): MutationReceipt | undefined {
  if (artifact.artifact_kind !== MUTATION_RECEIPT_KIND) {
    return undefined;
  }

  const outcomeValue = artifact.outcome;
  const outcome = (MUTATION_OUTCOMES as readonly unknown[]).includes(outcomeValue)
    ? (outcomeValue as MutationOutcome)
    : "unknown";
  const scopeValue = artifact.scope;
  const scope =
    scopeValue === "target" || scopeValue === "workspace" || scopeValue === "browser_session"
      ? scopeValue
      : "target";

  return {
    schema_version: MUTATION_RECEIPT_SCHEMA_VERSION,
    artifact_kind: MUTATION_RECEIPT_KIND,
    receipt_id: stringField(artifact, "receipt_id") ?? fallbackReceiptId,
    run_id: stringField(artifact, "run_id") ?? "unknown",
    operation_id: stringField(artifact, "operation_id") ?? "unknown",
    step_id: stringField(artifact, "step_id") ?? "unknown",
    effect: "mutating",
    scope,
    subject: stringField(artifact, "subject") ?? "unknown",
    intent: stringField(artifact, "intent") ?? "unknown",
    idempotency_key: stringField(artifact, "idempotency_key") ?? "unknown",
    attempt: typeof artifact.attempt === "number" ? artifact.attempt : 1,
    started_at: stringField(artifact, "started_at") ?? "unknown",
    ...(stringField(artifact, "finished_at")
      ? { finished_at: artifact.finished_at as string }
      : {}),
    ...(stringField(artifact, "precondition")
      ? { precondition: artifact.precondition as string }
      : {}),
    outcome,
    ...(artifact.verified_by === "post_read" ? { verified_by: "post_read" as const } : {}),
    evidence: Array.isArray(artifact.evidence)
      ? artifact.evidence.filter((entry): entry is string => typeof entry === "string")
      : [],
    ...(isRecord(artifact.error) && typeof artifact.error.code === "string"
      ? {
          error: {
            code: artifact.error.code,
            message: typeof artifact.error.message === "string" ? artifact.error.message : "",
          },
        }
      : {}),
    ...(stringField(artifact, "checkpoint_ref")
      ? { checkpoint_ref: artifact.checkpoint_ref as string }
      : {}),
    ...(stringField(artifact, "compensation_of")
      ? { compensation_of: artifact.compensation_of as string }
      : {}),
    ...(stringField(artifact, "supersedes") ? { supersedes: artifact.supersedes as string } : {}),
    ...(artifact.ephemeral_store === true ? { ephemeral_store: true } : {}),
    ...(isRecord(artifact.details) ? { details: artifact.details } : {}),
  };
}

/** `sha256:<hex>` and short opaque tokens are safe to copy; free text is not. */
const SAFE_ENVELOPE_VALUE = /^(sha256:[0-9a-f]{64}|[A-Za-z0-9_.:@+-]{1,64})$/;

function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "number" || typeof value === "boolean") {
      redacted[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (SAFE_ENVELOPE_VALUE.test(value)) {
        redacted[key] = value;
      } else {
        redacted[key] = { redacted: true, bytes: Buffer.byteLength(value, "utf-8") };
      }
      continue;
    }
    if (Array.isArray(value)) {
      redacted[key] = { redacted: true, count: value.length };
      continue;
    }
    if (isRecord(value)) {
      redacted[key] = { redacted: true, keys: Object.keys(value).length };
      continue;
    }
    if (value === null) {
      redacted[key] = null;
    }
  }
  return redacted;
}

/** The envelope copy of a receipt, and its `path` on disk. */
export type MutationReceiptEnvelopeCopy = Omit<
  MutationReceipt,
  "evidence" | "error" | "details"
> & {
  evidence: string[];
  evidence_redacted?: number;
  error?: { code: string };
  details?: Record<string, unknown>;
  path?: string;
};

/**
 * The redacted copy an envelope carries (architecture review A10): hashes, codes, refs and
 * counts only. The file under `receipts.dir` keeps everything; the envelope names its path.
 */
export function redactReceipt(
  receipt: MutationReceipt,
  artifactPath?: string,
): MutationReceiptEnvelopeCopy {
  const { evidence, error, details, ...rest } = receipt;
  const keptEvidence = evidence.filter((entry) => /sha256:[0-9a-f]{64}/.test(entry));
  return {
    ...rest,
    evidence: keptEvidence,
    ...(keptEvidence.length === evidence.length
      ? {}
      : { evidence_redacted: evidence.length - keptEvidence.length }),
    ...(error ? { error: { code: error.code } } : {}),
    ...(details ? { details: redactDetails(details) } : {}),
    ...(artifactPath ? { path: artifactPath } : {}),
  };
}
