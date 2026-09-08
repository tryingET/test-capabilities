/**
 * `surf apply`: carry out a plan, fill by default, submit only through the gate (submit-gate
 * packet §4.2, §4.3, D2, D5, D9, D10, D11, D13; slice S7 commit (2)).
 *
 * The four hazards the packet separates are four different mechanisms here, and none of them
 * substitutes for another:
 *
 *   1. *Wrong control* is owned by capability restriction: this file never holds a browser
 *      handle it could click with. It opens a session, hands it to `session.apply(...)` and
 *      then talks only to the runner, whose addressable set is the plan's own fields plus, in
 *      submit mode, the one identified control. There is no code path here that names a
 *      selector of its own.
 *   2. *Wrong world* is owned by the operator's `mutation.allowOrigins`, read through
 *      `--config`. No flag and no environment variable adds an origin, and the ledger enforces
 *      the same list again for every mutating step, so a fill inherits it too.
 *   3. *Wrong intent* is owned by the plan artifact and its content-bound approval token.
 *   4. *Unknown after-state* is owned by at-most-once: the receipt is on disk before the click,
 *      the post-condition is the receipt's `verify`, and any submit-mode receipt for a plan id
 *      refuses every later submit of it, `attempting` and `unknown` included.
 *
 * In submit mode the refusals are ordered world -> intent -> at-most-once -> identification,
 * and all four happen before a tab is opened.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonArtifact } from "../artifacts.js";
import type { ApplyFieldResult, ApplyMode, ApplyRunner } from "../browser-session.js";
import { canSubmit } from "../browser-session.js";
import type { EffectDeclaration } from "../effects.js";
import { MutationError } from "../effects.js";
import type { MutationReceiptEnvelopeCopy } from "../receipt-store.js";
import type { RunContext } from "../run-context.js";
import { finalizeEnvelope, mintOperationContext } from "../run-context.js";
import { FrameworkError, isFrameworkError } from "../runtime-contract.js";
import type { PostCondition } from "../surf-apply-runner.js";
import type { SurfPlan } from "../surf-plan.js";
import { approvalTokenFor, parsePlanArtifact } from "../surf-plan.js";
import { resolveSurfSessionRuntime, SurfSession } from "../surf-session.js";
import { assertSupportedSurfApplyOptions } from "./support.js";
import type {
  OperationDefinition,
  SurfApplyOperationInput,
  SurfApplyOperationResultEnvelope,
} from "./types.js";

const MAX_PLAN_BYTES = 2 * 1024 * 1024;

/**
 * Filling a form changes the target page, so both modes are `mutating`/`target`: a fill is a
 * bounded mutation, not a safe one (packet, Refinement clash 3). The class is what makes the
 * ledger write a receipt per act and consult `mutation.allowOrigins` for the origin.
 */
export function surfApplyEffect(input: { submit?: boolean }): EffectDeclaration {
  return {
    effect: "mutating",
    scope: "target",
    reason: input.submit
      ? "sets the plan's field values and clicks the one control the plan identified"
      : "sets the plan's field values through their own inputs; no control is clicked",
  };
}

export const SurfApplyOperationInputSchema = z.preprocess(
  (raw) => {
    if (typeof raw === "object" && raw !== null) {
      assertSupportedSurfApplyOptions(raw as Record<string, unknown>);
    }
    return raw;
  },
  z
    .object({
      plan: z.string({ required_error: "Surf apply requires --plan <plan.json>." }).min(1),
      submit: z.boolean().optional().default(false),
      confirmPlan: z.string().min(1).optional(),
      untilUrlPrefix: z.string().min(1).optional(),
      untilText: z.string().min(1).optional(),
      receiptOut: z.string().min(1).optional(),
      config: z.string().min(1).optional(),
      json: z.boolean().optional().default(false),
    })
    .transform((input) => {
      if (input.untilUrlPrefix !== undefined && input.untilText !== undefined) {
        throw new FrameworkError(
          "config_invalid",
          "Surf apply accepts either --until-url-prefix or --until-text, not both: one submit has one post-condition.",
          {},
        );
      }
      if (!input.submit && (input.untilUrlPrefix !== undefined || input.untilText !== undefined)) {
        throw new FrameworkError(
          "config_invalid",
          "Surf apply was given a post-condition but no --submit. A fill clicks nothing, so there is no act for a post-condition to wait on; drop the flag or open the gate deliberately.",
          {},
        );
      }
      return input;
    }),
);

type NormalizedSurfApplyOperationInput = z.output<typeof SurfApplyOperationInputSchema>;

async function readPlanFile(planPath: string): Promise<SurfPlan> {
  const resolved = path.resolve(planPath);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(resolved);
  } catch {
    throw new FrameworkError("config_not_found", `Plan file not found: ${resolved}`, {
      path: resolved,
    });
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new FrameworkError(
      "config_invalid",
      `Plan file must be a regular file, not a symlink or a directory: ${resolved}`,
      { path: resolved },
    );
  }
  if (stat.size > MAX_PLAN_BYTES) {
    throw new FrameworkError(
      "config_invalid",
      `Plan file is larger than ${MAX_PLAN_BYTES} bytes: ${resolved}`,
      { path: resolved, bytes: stat.size },
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(resolved, "utf-8"));
  } catch (error) {
    throw new FrameworkError(
      "config_invalid",
      `Plan file is not valid JSON: ${resolved} (${error instanceof Error ? error.message : String(error)})`,
      { path: resolved },
    );
  }
  return parsePlanArtifact(raw, resolved);
}

/** Hazard 2, the world: the operator's declaration about the origin, before any tab. */
function assertOriginAllowed(plan: SurfPlan, mode: ApplyMode, context: RunContext): void {
  const allowed = context.config.mutation.allowOrigins;
  if (allowed.includes(plan.target.origin)) {
    return;
  }
  const where = context.config.configPath ?? "the config file";
  if (mode === "submit") {
    throw new FrameworkError(
      "submit_origin_not_allowed",
      `Refusing to submit on ${plan.target.origin}: mutation.allowOrigins in ${where} does not name it. Which origins this suite may act on is the operator's declaration about the world, not the run's: add the origin to the config. No flag and no environment variable adds one.`,
      { plan_id: plan.plan_id, origin: plan.target.origin, config: where },
    );
  }
  throw new FrameworkError(
    "mutation_origin_not_allowed",
    `Refusing to fill a form on ${plan.target.origin}: mutation.allowOrigins in ${where} does not name it. A fill is a bounded mutation, not a safe one - a change handler can navigate or post on its own - so the origin has to be declared acceptable before anything is typed.`,
    { plan_id: plan.plan_id, origin: plan.target.origin, config: where },
  );
}

/** Hazard 3, the intent: the approval token over the plan's own content (D2, D14). */
function assertApproved(plan: SurfPlan, input: NormalizedSurfApplyOperationInput): void {
  if (!input.submit) {
    if (input.confirmPlan !== undefined) {
      throw new FrameworkError(
        "submit_gate_closed",
        "Surf apply was given --confirm-plan without --submit. An approval is not an instruction: the gate is opened by --submit, and this run refuses rather than filling with a confirmation nobody asked it to act on.",
        { plan_id: plan.plan_id },
      );
    }
    return;
  }
  if (input.confirmPlan === undefined) {
    throw new FrameworkError(
      "submit_gate_closed",
      `Refusing to submit plan ${plan.plan_id}: --submit needs --confirm-plan <approval_token>. Read the plan, then pass the token it prints; the token binds the approval to the content that was reviewed.`,
      { plan_id: plan.plan_id },
    );
  }
  const recomputed = approvalTokenFor(plan);
  if (recomputed !== plan.approval_token) {
    throw new FrameworkError(
      "submit_plan_mismatch",
      `Refusing to submit plan ${plan.plan_id}: the plan file no longer hashes to its own approval_token, so its content was edited after it was written. Re-run 'surf plan'; an edited plan is a new plan with a new token.`,
      { plan_id: plan.plan_id },
    );
  }
  if (input.confirmPlan !== recomputed) {
    throw new FrameworkError(
      "submit_plan_mismatch",
      `Refusing to submit plan ${plan.plan_id}: --confirm-plan does not match the token recomputed from the plan's content. An approval names what was reviewed, not which file it lives in.`,
      { plan_id: plan.plan_id },
    );
  }
}

/** Hazard 4, at-most-once: any submit-mode receipt for this plan closes the gate for good. */
async function assertNotAttempted(plan: SurfPlan, context: RunContext): Promise<void> {
  const receipts = await context.ledger.listReceipts({
    planId: plan.plan_id,
    mode: "submit",
  });
  if (receipts.length === 0) {
    return;
  }
  const first = receipts[0];
  throw new MutationError(
    "submit_already_attempted",
    `Refusing to submit plan ${plan.plan_id} again: receipt ${first?.receipt_id} in ${context.config.receipts.dir} records a submit attempt for it (outcome '${first?.outcome}'). A plan is submitted at most once, whatever that attempt reported; inspect ${plan.target.origin}, then re-plan if it needs to happen again.`,
    [],
    { plan_id: plan.plan_id, receipt_id: first?.receipt_id, outcome: first?.outcome },
  );
}

/** The submit control has to be identified, not merely present (packet §4.2 rule 4). */
function assertSubmitIdentified(plan: SurfPlan): void {
  if (plan.submit.status === "identified") {
    return;
  }
  if (plan.submit.status === "ambiguous") {
    throw new FrameworkError(
      "plan_submit_ambiguous",
      `Refusing to submit plan ${plan.plan_id}: it recorded ${plan.submit.candidates.length} submit candidates (${plan.submit.candidates.map((candidate) => candidate.selector).join(", ")}). Re-plan with --submit-text or --submit-selector so exactly one control is named.`,
      { plan_id: plan.plan_id, candidates: plan.submit.candidates.length },
    );
  }
  throw new FrameworkError(
    "plan_submit_missing",
    `Refusing to submit plan ${plan.plan_id}: it recorded no submit control, so there is nothing this run is allowed to click. Re-plan with --submit-selector naming the control.`,
    { plan_id: plan.plan_id },
  );
}

function postConditionFor(plan: SurfPlan, input: NormalizedSurfApplyOperationInput): PostCondition {
  if (input.untilUrlPrefix !== undefined) {
    return { kind: "url_prefix", expected: input.untilUrlPrefix };
  }
  if (input.untilText !== undefined) {
    return { kind: "text", expected: input.untilText };
  }
  return { kind: "left_url", expected: plan.target.landed_href };
}

/** Every field, in the plan's order: set it, read it back, and look at what the page did. */
async function fillFields(runner: ApplyRunner, plan: SurfPlan): Promise<ApplyFieldResult[]> {
  const results: ApplyFieldResult[] = [];
  for (const field of plan.fields) {
    await runner.setValue(field.id);
    const read = await runner.readBack(field.id);
    results.push(read);
    if (!read.matched) {
      throw new FrameworkError(
        "field_readback_mismatch",
        `Field ${field.id} (${field.resolved_selector}) does not hold the value the plan intended after it was set${read.read_back ? "" : " (the element could not be read back at all)"}. The run stops here rather than reporting a fill it cannot prove.`,
        { plan_id: plan.plan_id, field: field.id, selector: field.resolved_selector },
      );
    }
    await assertNoSideEffect(runner, plan);
  }
  // Once more after the last field: a change handler that acts on blur has had its chance.
  await assertNoSideEffect(runner, plan);
  return results;
}

async function assertNoSideEffect(runner: ApplyRunner, plan: SurfPlan): Promise<void> {
  const observation = await runner.observe();
  if (!observation.available) {
    throw new FrameworkError(
      "fill_side_effect_observed",
      `The page could not be read while filling plan ${plan.plan_id}: ${observation.detail ?? "no answer"}. A page that stops answering mid-fill has moved, and a dry run that moved the page is a failed dry run.`,
      { plan_id: plan.plan_id },
    );
  }
  const href = observation.href;
  if (href !== undefined && !isAcceptedHref(href, plan)) {
    throw new FrameworkError(
      "fill_side_effect_observed",
      `The page navigated to ${href} while filling plan ${plan.plan_id}; nothing was clicked. A form whose change handlers act on their own is a finding, not a passed dry run.`,
      { plan_id: plan.plan_id, href },
    );
  }
  if (observation.formPresent === false) {
    throw new FrameworkError(
      "fill_side_effect_observed",
      `The form the plan's fields belong to disappeared while filling plan ${plan.plan_id}; nothing was clicked.`,
      { plan_id: plan.plan_id },
    );
  }
}

function isAcceptedHref(href: string, plan: SurfPlan): boolean {
  const strip = (value: string): string => {
    try {
      const url = new URL(value);
      url.hash = "";
      return url.href;
    } catch {
      return value;
    }
  };
  const accepted = new Set(
    [plan.target.url, plan.target.landed_href, plan.fingerprint.url].map(strip),
  );
  return accepted.has(strip(href));
}

/** The receipt an operator will look at first: the submit if there was one, else the last fill. */
function decisiveReceipt(
  receipts: readonly MutationReceiptEnvelopeCopy[],
): SurfApplyOperationResultEnvelope["receipt"] {
  const submit = [...receipts].reverse().find((receipt) => receipt.details?.mode === "submit");
  const chosen = submit ?? receipts[receipts.length - 1];
  return chosen ? { path: chosen.path ?? "", outcome: chosen.outcome } : undefined;
}

async function writeReceiptExport(
  receiptOut: string,
  context: RunContext,
  plan: SurfPlan,
): Promise<string> {
  return writeJsonArtifact(
    receiptOut,
    {
      schema_version: 1,
      artifact_kind: "test-capabilities.surf.apply.receipts",
      run_id: context.runId,
      plan_id: plan.plan_id,
      generated_at: new Date().toISOString(),
      receipts: context.ledger.receipts(),
    },
    { label: "Surf apply receipt export" },
  );
}

async function runSurfApplyOperation(
  normalized: NormalizedSurfApplyOperationInput,
  context: RunContext,
): Promise<SurfApplyOperationResultEnvelope> {
  const plan = await readPlanFile(normalized.plan);
  const mode: ApplyMode = normalized.submit ? "submit" : "fill";

  // The order is the contract: the world, then the intent, then at-most-once, then whether a
  // control was ever identified. Every one of them refuses before a tab exists.
  assertOriginAllowed(plan, mode, context);
  assertApproved(plan, normalized);
  if (mode === "submit") {
    await assertNotAttempted(plan, context);
    assertSubmitIdentified(plan);
  }

  const runtime = resolveSurfSessionRuntime();
  const session = new SurfSession({
    context,
    url: plan.target.url,
    runtime,
    idPrefix: `surf.apply.${plan.plan_id.slice(0, 8)}`,
  });

  let runner: ApplyRunner | undefined;
  let fields: ApplyFieldResult[] = [];
  let submitted: boolean | "unknown" = false;
  const notes: string[] = [];

  try {
    await session.open();
    await session.gate();
    runner = await session.apply({
      plan,
      mode,
      postCondition: postConditionFor(plan, normalized),
    });

    const { drift } = await runner.fingerprint();
    if (drift.length > 0) {
      throw new FrameworkError(
        "plan_stale",
        `Refusing to apply plan ${plan.plan_id}: the page no longer matches the fingerprint it was written against (${drift.join("; ")}). Nothing was typed. Re-run 'surf plan'; a drifted plan is never healed into a new one.`,
        { plan_id: plan.plan_id, drift },
      );
    }

    fields = await fillFields(runner, plan);

    if (mode === "submit") {
      if (!canSubmit(runner)) {
        throw new FrameworkError(
          "plan_submit_missing",
          `The runner for plan ${plan.plan_id} carries no submit capability, so nothing can be clicked.`,
          { plan_id: plan.plan_id },
        );
      }
      try {
        await runner.clickSubmit();
        submitted = true;
      } catch (error) {
        throw asPostconditionRefusal(error, plan, context);
      }
    }
  } finally {
    notes.push(...(runner ? runner.notes() : session.notes()));
    await (runner ? runner.close() : session.close());
  }

  const receipts = context.ledger.envelopeReceipts();
  const receiptExport = normalized.receiptOut
    ? await writeReceiptExport(normalized.receiptOut, context, plan)
    : undefined;

  return finalizeEnvelope(
    {
      operationId: "surf.apply" as const,
      input: normalized,
      plan: { path: path.resolve(normalized.plan), planId: plan.plan_id },
      ...(decisiveReceipt(receipts) ? { receipt: decisiveReceipt(receipts) } : {}),
      ...(receiptExport ? { receiptExport } : {}),
      result: {
        mode,
        submitted,
        fields,
        submit: {
          status: plan.submit.status,
          ...(plan.submit.control ? { control: plan.submit.control.selector } : {}),
          clicked: submitted === true,
          ...(mode === "submit" ? { postCondition: postConditionFor(plan, normalized) } : {}),
        },
        surfCalls: runner ? [...runner.surfCalls()] : [],
      },
      notes,
    },
    context,
    surfApplyEffect(normalized),
  );
}

/**
 * The click reached the page and the post-condition did not arrive. The ledger says
 * `mutation_outcome_unknown` about the step; this operation says what it means for the plan:
 * the submit is `unknown`, the receipt records it, and rule (3) now refuses this plan for good.
 */
function asPostconditionRefusal(error: unknown, plan: SurfPlan, context: RunContext): unknown {
  if (!isFrameworkError(error) || error.code !== "mutation_outcome_unknown") {
    return error;
  }
  const receipt = context.ledger
    .envelopeReceipts()
    .find((entry) => entry.details?.mode === "submit");
  return new MutationError(
    "submit_postcondition_unmet",
    `The submit for plan ${plan.plan_id} was clicked and its post-condition was never observed, so whether it took effect is unknown. Receipt ${receipt?.receipt_id ?? "(unwritten)"} records the attempt as 'unknown' and refuses every later submit of this plan; inspect ${plan.target.origin} by hand. It is never retried.`,
    receipt ? [receipt] : [],
    {
      plan_id: plan.plan_id,
      submitted: "unknown",
      ...(receipt ? { receipt_id: receipt.receipt_id } : {}),
    },
  );
}

export const SURF_APPLY_OPERATION = {
  id: "surf.apply",
  effect: surfApplyEffect,
  route: { command: "surf", action: "apply" },
  description:
    "Carry out a plan on a capability-restricted runner: fill the plan's fields through their own inputs by default, and click the one control the plan identified only with --submit, --confirm-plan and an allowlisted origin. Not wired to any agent, hook or retry path; reachable through the library like every operation, where mutation.allowOrigins and the runner's construction are the boundary.",
  inputSchema: SurfApplyOperationInputSchema,
  execute: runSurfApplyOperation,
} satisfies OperationDefinition<
  NormalizedSurfApplyOperationInput,
  SurfApplyOperationResultEnvelope
>;

export async function executeSurfApplyOperation(
  input: SurfApplyOperationInput,
  context?: RunContext,
): Promise<SurfApplyOperationResultEnvelope> {
  const normalized = SurfApplyOperationInputSchema.parse(input);
  return runSurfApplyOperation(
    normalized,
    context ?? mintOperationContext("surf.apply", surfApplyEffect, normalized),
  );
}
