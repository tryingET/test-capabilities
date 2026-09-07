/**
 * Effect classes and the mutation ledger: the one path from a declaration to an effect.
 *
 * Pure ring: this module imports neither `node:fs` nor `node:child_process`. Everything it
 * writes goes through the injected `ReceiptStore`, and everything it reads about the world
 * comes from the context the kernel minted, so a ledger is a replayable function of recorded
 * fields plus one store.
 *
 * The rules are the mutation-safety packet's, in the order the packet applies them:
 *
 *   1. No class, no capability, no run (School 4). A step without one of the two classes is
 *      `effect_unclassified`; a declaration that contradicts its class is
 *      `effect_declaration_invalid`; a mutating step that asks for a retry budget is
 *      `mutation_retry_refused`. These are refusals at *construction*, before anything runs.
 *   2. Where the framework does not hold an authoritative read of the post-state (a browser or
 *      CLI target), at-most-once with a durable intent record ahead of the act (Schools 1-3):
 *      the `attempting` receipt is on disk and fsync'd before `run` is called, the interlock
 *      survives the process, and only a recorded human act (`--supersede-receipt`) resets it.
 *   3. Where it does (a workspace file), the write is conditional on the pre-state it expects
 *      (School 5): `precondition` is re-read immediately before the act and a mismatch refuses
 *      with `precondition_failed` having written nothing.
 *   4. Observation audits but never grants (School 6): a read-only step's own evidence may
 *      revoke its remaining retry budget with `read_only_violation_observed`; nothing observed
 *      after the fact can add an attempt.
 *   5. `unknown` stands (School 1). One intent-specific read-only `verify` may promote it to
 *      `applied`; nothing may demote it to `failed`, nothing retries it, nothing compensates it.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  MutationOutcome,
  MutationReceipt,
  MutationReceiptEnvelopeCopy,
  ReceiptFilter,
  ReceiptStore,
  VerifyResult,
} from "./receipt-store.js";
import { isInDoubt, MUTATION_RECEIPT_KIND, redactReceipt } from "./receipt-store.js";
import { TRANSIENT_CODES } from "./result-classification.js";
import { FrameworkError, isFrameworkError } from "./runtime-contract.js";

export type { MutationOutcome, MutationReceipt, VerifyResult };
export { TRANSIENT_CODES };

export type EffectClass = "read_only" | "mutating";
export type MutationScope = "target" | "workspace" | "browser_session";

export interface EffectDeclaration {
  effect: EffectClass;
  /** required when `effect` is `mutating`; `browser_session` is also legal on a read-only step */
  scope?: MutationScope;
  /** one line, rendered in every receipt, envelope and refusal (adjudication claim 50) */
  reason: string;
}

/** The hard cap on a read-only retry budget; the declaration may ask for less, never more. */
export const READ_ONLY_ATTEMPT_CAP = 3;

export interface EffectAttempt<T> {
  attempt: number;
  value?: T;
  error?: unknown;
}

export interface EffectSettlement {
  outcome: MutationOutcome;
  evidence?: string[];
}

export interface EffectStep<T> {
  /** stable within a run, e.g. `heal.apply:/abs/tests/login.spec.ts` */
  id: string;
  effect: EffectDeclaration;
  /** a file path, `<url> tab=<id>`, or a command display */
  subject: string;
  intent: string;
  /** mutating only; defaults to `sha256(operationId|id|subject|intent)` */
  idempotencyKey?: string;
  /** mutating/workspace only; the sha256 the step expects to find, re-read before the act */
  precondition?: string;
  /** required with `precondition`: reads the subject's current sha256 */
  readPrecondition?: () => Promise<string>;
  /** read_only only; default 1, capped at {@link READ_ONLY_ATTEMPT_CAP} */
  maxAttempts?: number;
  /** read_only only; default {@link TRANSIENT_CODES} */
  retryOn?: readonly string[];
  /** carried onto the receipt */
  checkpointRef?: string;
  compensationOf?: string;
  details?: Record<string, unknown>;
  run: (attempt: number) => Promise<T>;
  /**
   * What the attempt means. Without it a resolved step is `applied` and a thrown step is
   * `failed`, except that an error whose code or basis says nothing was learned is `unknown`.
   * A resolved value may never settle as `failed` (a step that knows it failed throws), and a
   * thrown step may never settle as `applied`.
   */
  settle?: (attempt: EffectAttempt<T>) => EffectSettlement;
  /**
   * read_only only. Returns a reason when the attempt's own evidence shows the target moved;
   * the step then fails with `read_only_violation_observed` and forfeits its budget.
   */
  observe?: (attempt: EffectAttempt<T>) => string | undefined;
  /**
   * mutating only. One read-only post-read that may promote `unknown` to `applied` on evidence
   * specific to the intent. It can never produce `failed` and never triggers a retry.
   */
  verify?: () => Promise<{ result: VerifyResult; evidence: string[] }>;
}

/** The read-only attempt log an envelope carries; read-only steps write no receipt. */
export interface AttemptLogEntry {
  stepId: string;
  attempt: number;
  code: string;
}

/**
 * A refusal or failure raised by the ledger, carrying the redacted receipts of the run so an
 * `unknown` outcome is never silent (mutation-safety packet, "Envelope changes"; review A6).
 */
export class MutationError extends FrameworkError {
  readonly receipts: MutationReceiptEnvelopeCopy[];

  constructor(
    code: string,
    message: string,
    receipts: MutationReceiptEnvelopeCopy[] = [],
    details: Record<string, unknown> = {},
  ) {
    super(code, message, { ...details, receipts });
    this.name = "MutationError";
    this.receipts = receipts;
  }
}

/** What the ledger needs from the run; `RunContext` (src/core/run-context.ts) satisfies it. */
export interface LedgerContext {
  runId: string;
  operationId: string;
  receiptStore: ReceiptStore;
  config: {
    receipts: {
      dir: string;
      /** the operator accepted a store that may not survive the run (D5) */
      ephemeral: boolean;
      /** why this store looks ephemeral, when it does; set by the kernel at mint time */
      ephemeralDetected?: string;
    };
    mutation: { allowOrigins: readonly string[] };
  };
  /** the receipt an operator chose to supersede, from `--supersede-receipt` */
  supersedeReceiptId?: string;
}

function errorCodeOf(error: unknown): string | undefined {
  return isFrameworkError(error) ? error.code : undefined;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The basis a carrier error already recorded, if any; `indeterminate` means nothing is known. */
function errorBasisOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const details = (error as { details?: Record<string, unknown> }).details;
  const outcome = details?.outcome;
  if (typeof outcome === "object" && outcome !== null && "basis" in outcome) {
    const basis = (outcome as { basis?: unknown }).basis;
    return typeof basis === "string" ? basis : undefined;
  }
  return undefined;
}

/**
 * What a thrown mutating attempt means when the step did not say. A budget kill or a reply the
 * classifier already called indeterminate teaches nothing about the target; anything else is a
 * definite refusal the operator can act on.
 */
export function defaultMutationOutcomeForError(error: unknown): "failed" | "unknown" {
  const code = errorCodeOf(error);
  if (code === "timeout" || code === "page_timeout" || code === "mutation_outcome_unknown") {
    return "unknown";
  }
  return errorBasisOf(error) === "indeterminate" ? "unknown" : "failed";
}

function invalidDeclaration(stepId: string, problem: string, fix: string): MutationError {
  return new MutationError(
    "effect_declaration_invalid",
    `Effect declaration for step '${stepId}' is invalid: ${problem}. ${fix}`,
    [],
    { step_id: stepId },
  );
}

/**
 * Validate a declaration and return it, or refuse. Used by the ledger for steps and by the
 * operation registry for `OperationDefinition.effect` (there is no default class).
 */
export function resolveEffectDeclaration(declaration: unknown, subject: string): EffectDeclaration {
  const candidate = declaration as Partial<EffectDeclaration> | undefined;
  if (
    candidate === undefined ||
    candidate === null ||
    (candidate.effect !== "read_only" && candidate.effect !== "mutating")
  ) {
    throw new MutationError(
      "effect_unclassified",
      `${subject} did not declare an effect class. There is no default class: declare { effect: "read_only" | "mutating", reason } (a mutating declaration also needs a scope).`,
      [],
      { subject },
    );
  }
  if (typeof candidate.reason !== "string" || candidate.reason.trim() === "") {
    throw invalidDeclaration(
      subject,
      "the declaration carries no reason",
      "The reason is rendered in every receipt and refusal, so it must say why the class is what it is.",
    );
  }
  if (candidate.effect === "mutating" && candidate.scope === undefined) {
    throw invalidDeclaration(
      subject,
      "a mutating declaration has no scope",
      'Declare scope: "target" | "workspace" | "browser_session".',
    );
  }
  if (
    candidate.effect === "read_only" &&
    candidate.scope !== undefined &&
    candidate.scope !== "browser_session"
  ) {
    throw invalidDeclaration(
      subject,
      `a read-only declaration carries scope '${candidate.scope}'`,
      "Only browser_session (the run's own tab lifecycle) is compatible with a read-only class.",
    );
  }
  return candidate as EffectDeclaration;
}

const EFFECT_RANK: Record<EffectClass, number> = { read_only: 0, mutating: 1 };

/** The worst class of a set; `test` resolves to the worst class of its enabled agents. */
export function worstEffect(declarations: readonly EffectDeclaration[]): EffectDeclaration {
  let worst: EffectDeclaration | undefined;
  for (const declaration of declarations) {
    if (worst === undefined || EFFECT_RANK[declaration.effect] > EFFECT_RANK[worst.effect]) {
      worst = declaration;
    }
  }
  return worst ?? { effect: "read_only", reason: "no step declared an effect" };
}

/** `<scheme>://<host>` when the subject names a web origin, otherwise undefined. */
export function webOriginOf(subject: string): string | undefined {
  const candidate = subject.trim().split(/\s+/)[0] ?? "";
  if (!/^https?:\/\//i.test(candidate)) {
    return undefined;
  }
  try {
    return new URL(candidate).origin;
  } catch {
    return undefined;
  }
}

export function idempotencyKeyFor(
  operationId: string,
  step: Pick<EffectStep<unknown>, "id" | "subject" | "intent">,
): string {
  const digest = createHash("sha256")
    .update([operationId, step.id, step.subject, step.intent].join("|"))
    .digest("hex");
  return `sha256:${digest}`;
}

/**
 * The reference monitor for effects: `runStep` is the only way a mutating step reaches the
 * world, and the only mutating caller of `Adapter.invoke` (architecture review A7, adjudication
 * claim 2).
 */
export class MutationLedger {
  private readonly context: LedgerContext;
  private readonly operationId: string;
  private readonly written: MutationReceipt[] = [];
  private readonly byKey = new Map<string, MutationReceipt>();
  private readonly attemptLog: AttemptLogEntry[] = [];

  constructor(context: LedgerContext, operationId: string = context.operationId) {
    this.context = context;
    this.operationId = operationId;
  }

  /** This run's receipts, in the order they were opened. */
  receipts(): MutationReceipt[] {
    return [...this.written];
  }

  /** The redacted copies an envelope carries (review A10). */
  envelopeReceipts(): MutationReceiptEnvelopeCopy[] {
    return this.written.map((receipt) => redactReceipt(receipt, this.receiptPathOf(receipt)));
  }

  /** The read-only attempt log; mutating steps are recorded as receipts instead. */
  attempts(): AttemptLogEntry[] {
    return [...this.attemptLog];
  }

  /** Receipts on disk, for the interlock and for the submit gate's per-plan rule (review A2). */
  async listReceipts(filter?: ReceiptFilter): Promise<MutationReceipt[]> {
    return this.context.receiptStore.list(filter);
  }

  async runStep<T>(step: EffectStep<T>): Promise<T> {
    const declaration = resolveEffectDeclaration(step.effect, `step '${step.id}'`);
    this.assertStepShape(step, declaration);
    return declaration.effect === "read_only"
      ? this.runReadOnlyStep(step)
      : this.runMutatingStep(step, declaration);
  }

  private assertStepShape<T>(step: EffectStep<T>, declaration: EffectDeclaration): void {
    if (declaration.effect === "read_only") {
      if (step.precondition !== undefined || step.verify !== undefined) {
        throw invalidDeclaration(
          step.id,
          "a read-only step carries a precondition or a verify",
          "Both belong to a mutating step: there is nothing to make conditional and nothing to promote.",
        );
      }
      if ((step.maxAttempts ?? 1) > READ_ONLY_ATTEMPT_CAP) {
        throw invalidDeclaration(
          step.id,
          `maxAttempts ${step.maxAttempts} exceeds the cap of ${READ_ONLY_ATTEMPT_CAP}`,
          "A read-only budget is bounded so an unbounded loop cannot be declared into existence.",
        );
      }
      return;
    }

    if ((step.maxAttempts ?? 1) > 1 || step.retryOn !== undefined) {
      throw new MutationError(
        "mutation_retry_refused",
        `Mutating step '${step.id}' declared a retry budget. A mutating step is attempted exactly once: remove maxAttempts/retryOn, or declare the step read_only if it really changes nothing.`,
        [],
        { step_id: step.id },
      );
    }
    if (step.precondition !== undefined) {
      if (declaration.scope !== "workspace") {
        throw invalidDeclaration(
          step.id,
          `a precondition on scope '${declaration.scope}'`,
          "A precondition is a compare-and-swap on state the framework owns; only workspace writes have one.",
        );
      }
      if (step.readPrecondition === undefined) {
        throw invalidDeclaration(
          step.id,
          "a precondition with no way to re-read it",
          "Pass readPrecondition() so the hash can be compared immediately before the write.",
        );
      }
    }
  }

  private async runReadOnlyStep<T>(step: EffectStep<T>): Promise<T> {
    const maxAttempts = Math.max(1, Math.min(step.maxAttempts ?? 1, READ_ONLY_ATTEMPT_CAP));
    const retryOn = step.retryOn ?? TRANSIENT_CODES;

    for (let attempt = 1; ; attempt += 1) {
      let value: T;
      try {
        value = await step.run(attempt);
      } catch (error) {
        const code = errorCodeOf(error) ?? "unclassified_error";
        this.attemptLog.push({ stepId: step.id, attempt, code });
        const revocation = step.observe?.({ attempt, error });
        if (revocation !== undefined) {
          throw this.revoked(step, attempt, revocation);
        }
        if (attempt < maxAttempts && (retryOn as readonly string[]).includes(code)) {
          continue;
        }
        throw error;
      }

      this.attemptLog.push({ stepId: step.id, attempt, code: "ok" });
      const revocation = step.observe?.({ attempt, value });
      if (revocation !== undefined) {
        throw this.revoked(step, attempt, revocation);
      }
      return value;
    }
  }

  private revoked<T>(step: EffectStep<T>, attempt: number, reason: string): MutationError {
    return new MutationError(
      "read_only_violation_observed",
      `Read-only step '${step.id}' on ${step.subject} moved the target: ${reason}. The remaining retry budget is forfeit after attempt ${attempt}; observation cannot prevent the first attempt, only the repeat. Declare the step mutating if this effect is intended.`,
      this.envelopeReceipts(),
      { step_id: step.id, subject: step.subject, attempt },
    );
  }

  private receiptPathOf(receipt: MutationReceipt): string {
    return `${this.context.config.receipts.dir}/${receipt.run_id}/${receipt.receipt_id}.json`;
  }

  private assertStoreUsable<T>(step: EffectStep<T>): void {
    const settings = this.context.config.receipts;
    if (settings.ephemeral || settings.ephemeralDetected === undefined) {
      return;
    }
    throw new MutationError(
      "mutation_receipts_ephemeral",
      `Refusing the mutating step '${step.id}': the receipt store at ${settings.dir} does not survive this run (${settings.ephemeralDetected}). An interlock that is gone when the process restarts is not an interlock. Point receipts.dir (or TEST_CAPABILITIES_RECEIPTS_DIR) at a durable directory, or accept the risk with receipts.ephemeral: true (or TEST_CAPABILITIES_RECEIPTS_EPHEMERAL=1), which is then recorded in every receipt.`,
      this.envelopeReceipts(),
      { step_id: step.id, receipts_dir: settings.dir, detected: settings.ephemeralDetected },
    );
  }

  private assertOriginAllowed<T>(step: EffectStep<T>, declaration: EffectDeclaration): void {
    if (declaration.scope !== "target") {
      return;
    }
    const origin = webOriginOf(step.subject);
    if (origin === undefined) {
      return;
    }
    const allowed = this.context.config.mutation.allowOrigins;
    if (allowed.includes(origin)) {
      return;
    }
    throw new MutationError(
      "mutation_origin_not_allowed",
      `Refusing to act on ${origin}: mutation.allowOrigins does not name it (step '${step.id}', ${declaration.reason}). Which origins this suite may change is the operator's declaration, not the framework's: add '${origin}' to mutation.allowOrigins in the config before running it.`,
      this.envelopeReceipts(),
      { step_id: step.id, origin, allowOrigins: [...allowed] },
    );
  }

  private async assertNotReplayed<T>(step: EffectStep<T>, key: string): Promise<void> {
    const sameRun = this.byKey.get(key);
    if (sameRun) {
      throw new MutationError(
        "mutation_replay_refused",
        `Refusing to repeat mutating step '${step.id}' on ${step.subject} in this run: the same idempotency key was already attempted as receipt ${sameRun.receipt_id} (${sameRun.outcome}). A mutating step runs at most once per key; a rerun is a new run and an operator decision.`,
        this.envelopeReceipts(),
        { step_id: step.id, idempotency_key: key, receipt_id: sameRun.receipt_id },
      );
    }

    const stored = await this.context.receiptStore.list({ idempotencyKey: key, inDoubt: true });
    const blocking = stored.filter(
      (receipt) => receipt.receipt_id !== this.context.supersedeReceiptId,
    );
    if (blocking.length === 0) {
      return;
    }
    const first = blocking[0] as MutationReceipt;
    throw new MutationError(
      "mutation_replay_refused",
      `Refusing to repeat mutating step '${step.id}' on ${step.subject}: receipt ${first.receipt_id} for the same idempotency key is still '${first.outcome}' (run ${first.run_id}, started ${first.started_at}). Nothing is known about whether that attempt took effect, so a rerun could repeat it. Inspect the subject, then run again with --supersede-receipt ${first.receipt_id} to record a superseding attempt.`,
      blocking.map((receipt) => redactReceipt(receipt, this.receiptPathOf(receipt))),
      {
        step_id: step.id,
        idempotency_key: key,
        receipt_id: first.receipt_id,
        supersede_with: `--supersede-receipt ${first.receipt_id}`,
      },
    );
  }

  private async assertPrecondition<T>(step: EffectStep<T>): Promise<void> {
    if (step.precondition === undefined || step.readPrecondition === undefined) {
      return;
    }
    const actual = await step.readPrecondition();
    if (actual === step.precondition) {
      return;
    }
    throw new MutationError(
      "precondition_failed",
      `Refusing to write ${step.subject}: it no longer holds the content this step was planned against (expected ${step.precondition}, found ${actual}). Nothing was written. Re-run the analysis so the proposal is made against what is on disk now.`,
      this.envelopeReceipts(),
      { step_id: step.id, subject: step.subject, expected: step.precondition, actual },
    );
  }

  private openReceipt<T>(
    step: EffectStep<T>,
    declaration: EffectDeclaration,
    key: string,
  ): MutationReceipt {
    const supersedes = this.context.supersedeReceiptId;
    return {
      schema_version: 1,
      artifact_kind: MUTATION_RECEIPT_KIND,
      receipt_id: randomUUID(),
      run_id: this.context.runId,
      operation_id: this.operationId,
      step_id: step.id,
      effect: "mutating",
      scope: declaration.scope ?? "target",
      subject: step.subject,
      intent: step.intent,
      idempotency_key: key,
      attempt: 1,
      started_at: new Date().toISOString(),
      ...(step.precondition ? { precondition: step.precondition } : {}),
      outcome: "attempting",
      evidence: [`declared: ${declaration.reason}`],
      ...(step.checkpointRef ? { checkpoint_ref: step.checkpointRef } : {}),
      ...(step.compensationOf ? { compensation_of: step.compensationOf } : {}),
      ...(supersedes ? { supersedes } : {}),
      ...(this.context.config.receipts.ephemeral ? { ephemeral_store: true } : {}),
      ...(step.details ? { details: step.details } : {}),
    };
  }

  private settleAttempt<T>(step: EffectStep<T>, attempt: EffectAttempt<T>): EffectSettlement {
    const declared = step.settle?.(attempt);
    if (declared === undefined) {
      return attempt.error === undefined
        ? { outcome: "applied" }
        : { outcome: defaultMutationOutcomeForError(attempt.error) };
    }
    if (attempt.error === undefined && declared.outcome === "failed") {
      throw invalidDeclaration(
        step.id,
        "a step that returned a value settled as failed",
        "A step that knows it failed throws; settle may only answer applied or unknown for a value.",
      );
    }
    if (attempt.error !== undefined && declared.outcome === "applied") {
      throw invalidDeclaration(
        step.id,
        "a step that threw settled as applied",
        "Only a verify() post-read may promote an attempt, and only from unknown.",
      );
    }
    return declared;
  }

  private async promoteWithVerify<T>(step: EffectStep<T>, receipt: MutationReceipt): Promise<void> {
    if (receipt.outcome !== "unknown" || step.verify === undefined) {
      return;
    }
    const verified = await step.verify();
    if (verified.result !== "applied") {
      receipt.evidence.push("verify: indeterminate", ...verified.evidence);
      return;
    }
    if (verified.evidence.length === 0) {
      throw invalidDeclaration(
        step.id,
        "verify() answered applied with no evidence",
        "A promotion needs evidence specific to the intent (the after-hash, the assigned value, the declared post-condition); a generic 'it loaded' is not a verify.",
      );
    }
    receipt.outcome = "applied";
    receipt.verified_by = "post_read";
    receipt.evidence.push("verify: applied", ...verified.evidence);
  }

  private async finalizeReceipt(receipt: MutationReceipt): Promise<void> {
    receipt.finished_at = new Date().toISOString();
    try {
      await this.context.receiptStore.append(receipt);
    } catch (error) {
      // The receipt stays `attempting` on disk and the run says so: that is the intended
      // failure direction (mutation-safety packet, "Behaviour and failure modes").
      throw new MutationError(
        "mutation_receipt_write_failed",
        `The mutating step '${receipt.step_id}' ran with outcome '${receipt.outcome}', but the finalising receipt could not be written: ${errorMessageOf(error)}. Receipt ${receipt.receipt_id} stays 'attempting' on disk and will refuse the next run until it is inspected and superseded.`,
        this.envelopeReceipts(),
        { step_id: receipt.step_id, receipt_id: receipt.receipt_id, outcome: receipt.outcome },
      );
    }
  }

  private async runMutatingStep<T>(
    step: EffectStep<T>,
    declaration: EffectDeclaration,
  ): Promise<T> {
    const key = step.idempotencyKey ?? idempotencyKeyFor(this.operationId, step);

    this.assertStoreUsable(step);
    this.assertOriginAllowed(step, declaration);
    await this.assertNotReplayed(step, key);
    // A read, not a write: the conditional check happens before the intent record so a refusal
    // that changed nothing does not leave a locked key behind.
    await this.assertPrecondition(step);

    const receipt = this.openReceipt(step, declaration, key);
    // Write-ahead: the receipt is on stable storage before the act, or the act does not happen.
    await this.context.receiptStore.append(receipt);
    this.written.push(receipt);
    this.byKey.set(key, receipt);

    let value: T | undefined;
    let failure: unknown;
    let settlement: EffectSettlement;
    try {
      value = await step.run(1);
      settlement = this.settleAttempt(step, { attempt: 1, value });
    } catch (error) {
      failure = error;
      settlement = this.settleAttempt(step, { attempt: 1, error });
      receipt.error = {
        code: errorCodeOf(error) ?? "unclassified_error",
        message: errorMessageOf(error),
      };
    }

    receipt.outcome = settlement.outcome;
    if (settlement.evidence) {
      receipt.evidence.push(...settlement.evidence);
    }
    await this.promoteWithVerify(step, receipt);
    await this.finalizeReceipt(receipt);

    if (receipt.outcome === "unknown") {
      throw new MutationError(
        "mutation_outcome_unknown",
        `The mutating step '${step.id}' on ${step.subject} reported no outcome, so nothing is known about whether it took effect. Receipt ${receipt.receipt_id} records the attempt and refuses the next run for this key. Inspect ${step.subject} by hand; if it did not take effect, run again with --supersede-receipt ${receipt.receipt_id}.`,
        this.envelopeReceipts(),
        { step_id: step.id, subject: step.subject, receipt_id: receipt.receipt_id },
      );
    }
    if (receipt.outcome === "failed") {
      // A definite refusal from the target: the original error is what the operation reports,
      // and the receipt is in the envelope's `mutations`.
      throw failure;
    }
    return value as T;
  }
}

/** True when any receipt in the store is still in doubt; `doctor` reports the count. */
export function countInDoubt(receipts: readonly MutationReceipt[]): number {
  return receipts.filter((receipt) => isInDoubt(receipt)).length;
}
