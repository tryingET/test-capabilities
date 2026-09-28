/**
 * `surf flow` submit authorization (AK #6164 slice F2; design
 * `docs/project/2026-09-28-surf-flow-design.md` section 7).
 *
 * A step that acts on a form-level control must be declared `submit: true`, and the run must be
 * given `--submit` with the flow's approval token. Before a tab exists: the flow declares such a
 * step, the token matches its content, and no submit was ever attempted for it (any outcome).
 * Before its first submit acts, a run claims the flow's submit in the receipt store, atomically,
 * so two runs that raced past the first check cannot both submit. A submit's act settles
 * `unknown`; its `expect` is the receipt's `verify`, and only an expect observed within its
 * deadline promotes it. Evidence names the expect, never the address or text the page showed: a
 * page may put what was typed into either.
 */

import { setTimeout as sleep } from "node:timers/promises";
import type { BrowserStep } from "../browser-session.js";
import type { EffectAttempt, EffectSettlement } from "../effects.js";
import { MutationError } from "../effects.js";
import type { FlowStep, SurfFlow } from "../flow-file.js";
import { isSubmitStep } from "../flow-file.js";
import type { RunContext } from "../run-context.js";
import { FrameworkError, isFrameworkError } from "../runtime-contract.js";
import { settleSurfAttempt } from "../surf-adapter.js";
import { normalizeHref } from "../surf-plan.js";

const POLL_MS = 100;

/** What a flow-level observation answers: whether the condition holds, and where the page is. */
export interface FlowObservation {
  held: boolean;
  href: string;
}
export type FlowCondition = { url_prefix: string } | { text: string };
/** a look at the page: what it showed, a dialog it opened, or nothing (between documents) */
export type FlowLook = FlowObservation | "dialog" | undefined;

/** The claim a run makes before its flow's first submit acts: one per flow, for good. */
export const flowSubmitReservation = (flowId: string): string =>
  `flow-submit-${flowId.replace(/^sha256:/, "")}`;

function alreadySubmitted(flowId: string, context: RunContext, what: string): MutationError {
  return new MutationError(
    "submit_already_attempted",
    `Refusing to submit flow ${flowId} again: ${what}. A flow is submitted at most once, whatever that attempt reported; inspect the page by hand, and change the flow if it needs to happen again (a changed flow is a new flow).`,
    context.ledger.envelopeReceipts(),
    { flow_id: flowId },
  );
}

/**
 * The intent, before a tab: `--confirm-flow` alone opens nothing; `--submit` needs a declared
 * submit step and the token of exactly this content.
 */
export function assertSubmitIntent(
  flow: SurfFlow,
  flowId: string,
  flowPath: string,
  input: { submit: boolean; confirmFlow?: string | undefined },
): void {
  if (!input.submit) {
    if (input.confirmFlow === undefined) return;
    throw new FrameworkError(
      "submit_gate_closed",
      "Surf flow was given --confirm-flow without --submit. An approval is not an instruction: the gate is opened by --submit, and this run refuses rather than running with a confirmation nobody asked it to act on.",
      { flow_id: flowId },
    );
  }
  if (!flow.steps.some(isSubmitStep)) {
    throw new FrameworkError(
      "config_invalid",
      `Surf flow was given --submit, but the flow at ${flowPath} declares no submit step (submit: true on a click or press), so there is nothing to authorize. Nothing ran.`,
      { path: flowPath },
    );
  }
  if (input.confirmFlow === undefined) {
    throw new FrameworkError(
      "submit_gate_closed",
      `Refusing to submit the flow at ${flowPath}: --submit needs --confirm-flow <approval token>. Run it without --submit to print the token, review the file, then pass that token; it binds the approval to the content that was reviewed. Nothing ran.`,
      { path: flowPath },
    );
  }
  if (input.confirmFlow !== flowId) {
    throw new FrameworkError(
      "flow_approval_mismatch",
      `Refusing to submit the flow at ${flowPath}: --confirm-flow does not match the token of its content. An approval names the content it was given for; an edited flow is a new flow with a new token. Nothing ran.`,
      { path: flowPath },
    );
  }
}

/**
 * At most once, before a tab: any submit receipt for this flow, whatever its outcome, or a claim
 * a run made before its submit (one that stopped before its receipt was written), closes the
 * gate for good.
 */
export async function assertFlowNotSubmitted(flowId: string, context: RunContext): Promise<void> {
  const receipts = await context.ledger.listReceipts({ flowId, mode: "submit" });
  const first = receipts[0];
  if (first !== undefined) {
    throw new MutationError(
      "submit_already_attempted",
      `Refusing to submit flow ${flowId} again: receipt ${first.receipt_id} in ${context.config.receipts.dir} records a submit attempt for it (outcome '${first.outcome}'). A flow is submitted at most once, whatever that attempt reported; inspect the page by hand, and change the flow if it needs to happen again (a changed flow is a new flow). No tab was opened.`,
      [],
      { flow_id: flowId, receipt_id: first.receipt_id, outcome: first.outcome },
    );
  }
  const claim = await context.receiptStore.reservation?.(flowSubmitReservation(flowId));
  if (claim !== undefined) {
    throw alreadySubmitted(
      flowId,
      context,
      `a run claimed its submit in ${context.config.receipts.dir} (reservations) and wrote no receipt for it. No tab was opened`,
    );
  }
}

/**
 * Just before the first submit acts: claim the flow's submit, atomically across runs. A run that
 * raced past the first check finds the claim taken and acts no further; a store that cannot
 * claim cannot hold at most once, so nothing is submitted through it.
 */
export async function reserveFlowSubmit(flowId: string, context: RunContext): Promise<void> {
  const store = context.receiptStore;
  if (store.reserve === undefined) {
    throw new MutationError(
      "mutation_receipt_write_failed",
      `Refusing to submit flow ${flowId}: the receipt store at ${store.dir} cannot claim an act for good, so at most once cannot be held across runs. Nothing was submitted.`,
      context.ledger.envelopeReceipts(),
      { flow_id: flowId },
    );
  }
  const claimed = await store.reserve(flowSubmitReservation(flowId), {
    flow_id: flowId,
    run_id: context.runId,
    reserved_at: new Date().toISOString(),
  });
  if (!claimed) {
    throw alreadySubmitted(
      flowId,
      context,
      "another run claimed its submit first. Nothing was submitted by this run",
    );
  }
}

/**
 * An authorized submit step: its act settles `unknown`, and its `expect` - `left_url` when the
 * file names none - is polled as the receipt's `verify` until it holds or `timeoutMs` passes;
 * only a look that ended within the deadline counts. `dialogOpened` says whether a dialog opened,
 * during the act or while the expect was looked for: then nothing is promoted.
 */
export function submitStepOf(
  base: BrowserStep<Record<string, unknown>>,
  step: FlowStep,
  observe: (condition: FlowCondition) => Promise<FlowLook>,
  timeoutMs: number,
): BrowserStep<Record<string, unknown>> & { dialogOpened: () => boolean } {
  const expect = ("expect" in step ? step.expect : undefined) ?? { left_url: true as const };
  const kind = "url_prefix" in expect ? "url_prefix" : "text" in expect ? "text" : "left_url";
  let started: string | undefined;
  let dialogOpened = false;
  return {
    ...base,
    dialogOpened: () => dialogOpened,
    read: (reply, attempt) => {
      const data = base.read(reply, attempt);
      // where the act started: the element's document, which `left_url` must leave
      if (typeof data.href === "string") started = data.href;
      return data;
    },
    settle: (attempt: EffectAttempt<Record<string, unknown>>): EffectSettlement => {
      dialogOpened =
        isFrameworkError(attempt.error) && attempt.error.code === "action_dialog_opened";
      return attempt.error === undefined
        ? { outcome: "unknown", evidence: [`${step.action} sent; expect not observed yet`] }
        : settleSurfAttempt(attempt);
    },
    verify: async () => {
      // a dismissed dialog may let the page move on: that is not the submit's effect
      if (dialogOpened) {
        return { result: "indeterminate", evidence: ["a dialog opened; no promotion"] };
      }
      const condition: FlowCondition =
        "url_prefix" in expect
          ? { url_prefix: expect.url_prefix }
          : "text" in expect
            ? { text: expect.text }
            : { url_prefix: started ?? "" };
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const seen = await observe(condition);
        if (seen === "dialog") {
          dialogOpened = true;
          return {
            result: "indeterminate",
            evidence: ["a dialog opened while the expect was looked for; no promotion"],
          };
        }
        const met =
          seen !== undefined &&
          Date.now() <= deadline &&
          (kind === "left_url"
            ? started !== undefined && normalizeHref(seen.href) !== normalizeHref(started)
            : seen.held);
        if (met) {
          return {
            result: "applied",
            evidence: [
              "url_prefix" in expect
                ? `expect url_prefix ${expect.url_prefix} observed`
                : `expect ${kind} observed`,
            ],
          };
        }
        if (Date.now() >= deadline) {
          return {
            result: "indeterminate",
            evidence: [`expect ${kind} not observed within ${timeoutMs} ms`],
          };
        }
        await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
      }
    },
  };
}

/**
 * A submit whose expect was never observed: the ledger says `mutation_outcome_unknown` about the
 * step; for the flow it means the submit is `unknown`, and the flow is never submitted again.
 */
export function asSubmitUnmet(
  error: unknown,
  step: FlowStep,
  flowId: string,
  context: RunContext,
  dialogWhileLooking = false,
): unknown {
  if (!isFrameworkError(error) || error.code !== "mutation_outcome_unknown") return error;
  const receipts = context.ledger.envelopeReceipts();
  const receipt = receipts[receipts.length - 1];
  if (receipt === undefined || receipt.error?.code === "action_dialog_opened") return error;
  if (dialogWhileLooking) {
    return new MutationError(
      "action_dialog_opened",
      `Flow step ${step.id} (${step.action}) was sent as the flow's declared submit and a dialog opened while its expect was looked for; dismissal was requested, not approval, so it is never promoted. Receipt ${receipt.receipt_id} records it as 'unknown' and refuses every later submit of this flow; inspect the page by hand.`,
      receipts,
      { flow_id: flowId, step: step.id, submitted: "unknown", receipt_id: receipt.receipt_id },
    );
  }
  return new MutationError(
    "submit_postcondition_unmet",
    `Flow step ${step.id} (${step.action}) was sent as the flow's declared submit and its expect was never observed, so whether it took effect is unknown. Receipt ${receipt.receipt_id} records it as 'unknown' and refuses every later submit of this flow; inspect the page by hand. It is never retried.`,
    receipts,
    { flow_id: flowId, step: step.id, submitted: "unknown", receipt_id: receipt.receipt_id },
  );
}
