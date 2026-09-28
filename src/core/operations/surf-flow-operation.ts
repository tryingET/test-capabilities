/**
 * `surf flow`: run a flow file's steps in a tab this run owns (AK #6164; design
 * `docs/project/2026-09-28-surf-flow-design.md`).
 *
 * The file says what to do; this operation decides everything a step may not decide for itself:
 * its effect class (from its action), its idempotency key (from the flow's content and its id),
 * the origins it may act in (`mutation.allowOrigins`), and whether it may act on a form-level
 * control (only a declared submit step, only when authorized). Every step is one ledger step on
 * the DevTools connection, held once for the run; surf opens, gates and closes the tab.
 *
 * Before a tab exists: the file, the world (the start URL's origin, when the flow acts), the
 * intent (`--submit` with the flow's token) and at-most-once. Before the first step: the
 * DevTools connection must bind the owned tab. Without `--submit` the flow stops before its first
 * submit step, having acted up to it, like apply's fill mode; with it, each declared submit step
 * acts and is verified by its `expect` (`surf-flow-submit.ts`).
 */

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { writeJsonArtifact } from "../artifacts.js";
import type { BrowserStep, SessionReply } from "../browser-session.js";
import type { FlowActPayload } from "../cdp-flow-acts.js";
import { holdCdpActions, releaseCdpActions } from "../cdp-step-transport.js";
import type { EffectDeclaration } from "../effects.js";
import { MutationError } from "../effects.js";
import type { FlowStep, SurfFlow } from "../flow-file.js";
import {
  describeFlowTarget,
  flowApprovalToken,
  isFlowAct,
  isSubmitStep,
  parseFlow,
} from "../flow-file.js";
import { frameOriginPath } from "../frame-address.js";
import type { RunContext } from "../run-context.js";
import { finalizeEnvelope, mintOperationContext } from "../run-context.js";
import { FrameworkError, isFrameworkError } from "../runtime-contract.js";
import { parseSurfJsonOutput } from "../surf-runtime.js";
import { resolveSurfSessionRuntime, SurfSession } from "../surf-session.js";
import { assertSupportedSurfFlowOptions } from "./support.js";
import type { FlowCondition, FlowLook } from "./surf-flow-submit.js";
import {
  asSubmitUnmet,
  assertFlowNotSubmitted,
  assertSubmitIntent,
  reserveFlowSubmit,
  submitStepOf,
} from "./surf-flow-submit.js";
import type {
  OperationDefinition,
  SurfFlowOperationInput,
  SurfFlowOperationResultEnvelope,
  SurfFlowStepResult,
} from "./types.js";

const MAX_FLOW_BYTES = 1024 * 1024;

/** A flow may act, so the operation is `mutating`/`target`; each read step still reads only. */
export const SURF_FLOW_OPERATION_EFFECT: EffectDeclaration = {
  effect: "mutating",
  scope: "target",
  reason:
    "runs a flow's steps in a tab it owns: reads, and acts through receipted steps checked on their element before input",
};

export const SurfFlowOperationInputSchema = z.preprocess(
  (raw) => {
    if (typeof raw === "object" && raw !== null) {
      assertSupportedSurfFlowOptions(raw as Record<string, unknown>);
    }
    return raw;
  },
  z.object({
    file: z.string({ required_error: "Surf flow requires --file <flow.json|flow.yaml>." }).min(1),
    submit: z.boolean().optional().default(false),
    confirmFlow: z.string().min(1).optional(),
    receiptOut: z.string().min(1).optional(),
    config: z.string().min(1).optional(),
    json: z.boolean().optional().default(false),
  }),
);

type NormalizedSurfFlowOperationInput = z.output<typeof SurfFlowOperationInputSchema>;

/** Read a flow file: a regular file of at most 1 MiB, JSON by extension, YAML otherwise. */
export async function readFlowFile(flowPath: string): Promise<SurfFlow> {
  const resolved = path.resolve(flowPath);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(resolved);
  } catch {
    throw new FrameworkError("config_not_found", `Flow file not found: ${resolved}`, {
      path: resolved,
    });
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FLOW_BYTES) {
    throw new FrameworkError(
      "config_invalid",
      `A flow file must be a regular file (not a symlink or a directory) of at most ${MAX_FLOW_BYTES} bytes: ${resolved}`,
      { path: resolved },
    );
  }
  const text = await fs.readFile(resolved, "utf-8");
  let raw: unknown;
  try {
    raw = resolved.endsWith(".json") ? JSON.parse(text) : yaml.load(text);
  } catch (error) {
    // a parser's message, and even its reason, may quote the file, values included: say where only
    const { mark } = error as { mark?: { line: number; column: number } };
    const at = mark ? ` at line ${mark.line + 1}, column ${mark.column + 1}` : "";
    throw new FrameworkError(
      "config_invalid",
      `The flow at ${resolved} does not parse${at}; the parser's words are not repeated here, since they may quote the file. Nothing ran.`,
      { path: resolved },
    );
  }
  return parseFlow(raw, resolved);
}

/** The world: a flow that acts must have its start URL's origin allowlisted before any tab. */
function assertStartOriginAllowed(flow: SurfFlow, context: RunContext): void {
  if (!flow.steps.some(isFlowAct)) return;
  const origin = new URL(flow.url).origin;
  if (context.config.mutation.allowOrigins.includes(origin)) return;
  throw new FrameworkError(
    "mutation_origin_not_allowed",
    `Refusing to run a flow that acts on ${origin}: mutation.allowOrigins in ${context.config.configPath ?? "the config file"} does not name it. Nothing ran and no tab was opened.`,
    { origin },
  );
}

/** One flow step as a session step: its class from its action, never from the file. */
function sessionStepOf(
  flowId: string,
  step: FlowStep,
  policy: { origins: readonly string[]; submit: FlowActPayload["submit"] },
): BrowserStep<Record<string, unknown>> {
  const acts = isFlowAct(step);
  const target = describeFlowTarget(step);
  const payload: FlowActPayload = {
    step: step.id,
    ...("target" in step ? { target: step.target } : {}),
    ...("value" in step ? { value: step.value } : {}),
    ...("key" in step ? { key: step.key } : {}),
    ...(step.action === "wait" ? { condition: step.for } : {}),
    ...(step.action === "assert" ? { condition: step.that } : {}),
    ...(step.timeout_ms ? { timeoutMs: step.timeout_ms } : {}),
    origins: policy.origins,
    submit: policy.submit,
  };
  return {
    id: `surf.flow.step:${flowId}:${step.id}`,
    frame: step.frame
      ? { name: frameOriginPath(step.frame) as string, match: "origin_path" }
      : "main",
    command: `flow.${step.action}`,
    args: [JSON.stringify(payload)],
    intent: `flow step ${step.id}: ${step.action} ${target}`,
    declare: acts
      ? {
          effect: "mutating",
          scope: "target",
          reason: `flow ${step.action} acts on the target page`,
        }
      : { effect: "read_only", reason: `flow ${step.action} reads the page` },
    ...(acts
      ? {
          details: {
            flow_id: flowId,
            mode: isSubmitStep(step) ? "submit" : "act",
            step: { id: step.id, action: step.action, target },
          },
        }
      : {}),
    read: (reply: SessionReply) => {
      const data = parseSurfJsonOutput(reply.stdout, reply.command).data;
      return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    },
  };
}

/** A read of where the page is after a submit step: its expect's condition, in the step's frame. */
function observeStepOf(
  flowId: string,
  step: FlowStep,
  condition: FlowCondition,
): BrowserStep<Record<string, unknown>> {
  const payload: FlowActPayload = { step: step.id, condition, origins: [], submit: "undeclared" };
  return {
    id: `surf.flow.observe:${flowId}:${step.id}`,
    frame: step.frame
      ? { name: frameOriginPath(step.frame) as string, match: "origin_path" }
      : "main",
    command: "flow.observe",
    args: [JSON.stringify(payload)],
    intent: `flow step ${step.id}: look for the submit's expect`,
    declare: { effect: "read_only", reason: "reads where the page is after a submit" },
    read: (reply: SessionReply) => {
      const data = parseSurfJsonOutput(reply.stdout, reply.command).data;
      return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    },
  };
}

/** A step's refusal, named by the step, with its code kept. */
function stepFailure(error: unknown, step: FlowStep, flowId: string, context: RunContext): unknown {
  if (!isFrameworkError(error)) return error;
  const receipts = context.ledger.envelopeReceipts();
  // an act that opened a dialog settles unknown; its receipt, the latest, says why
  const latest = receipts[receipts.length - 1]?.error;
  const code =
    error.code === "mutation_outcome_unknown" && latest?.code === "action_dialog_opened"
      ? latest.code
      : error.code;
  // the redacted copies keep the code; the step's own receipt holds the transport's words
  const full = context.ledger.receipts();
  const why = full[full.length - 1]?.error?.message;
  const cause = error.code === "mutation_outcome_unknown" && why ? ` Cause: ${why}` : "";
  const inDoubt = ["mutation_outcome_unknown", "mutation_replay_refused"].includes(code)
    ? " surf flow takes no --supersede-receipt: inspect the page by hand; a changed flow file is a new flow, with new keys."
    : "";
  const message = `Flow step ${step.id} (${step.action} ${describeFlowTarget(step)}) stopped the flow: ${error.message}${cause}${inDoubt}`;
  const details = { ...(error.details ?? {}), flow_id: flowId, step: step.id };
  return error instanceof MutationError
    ? new MutationError(code as string, message, receipts, details)
    : new FrameworkError(code as string, message, details);
}

async function writeReceiptExport(receiptOut: string, context: RunContext, flowId: string) {
  return writeJsonArtifact(
    receiptOut,
    {
      schema_version: 1,
      artifact_kind: "test-capabilities.surf.flow.receipts",
      run_id: context.runId,
      flow_id: flowId,
      generated_at: new Date().toISOString(),
      receipts: context.ledger.receipts(),
    },
    { label: "Surf flow receipt export" },
  );
}

async function runSurfFlowOperation(
  normalized: NormalizedSurfFlowOperationInput,
  context: RunContext,
): Promise<SurfFlowOperationResultEnvelope> {
  const flow = await readFlowFile(normalized.file);
  const flowId = flowApprovalToken(flow);
  assertStartOriginAllowed(flow, context);
  assertSubmitIntent(flow, flowId, path.resolve(normalized.file), normalized);
  if (normalized.submit) await assertFlowNotSubmitted(flowId, context);

  const session = new SurfSession({
    context,
    url: flow.url,
    runtime: resolveSurfSessionRuntime(),
    idPrefix: `surf.flow.${flowId.slice(7, 15)}`,
  });
  const results: SurfFlowStepResult[] = flow.steps.map((step) => ({
    id: step.id,
    action: step.action,
    target: describeFlowTarget(step),
    effect: isFlowAct(step) ? "mutating" : "read_only",
    outcome: "not_run",
  }));
  let status: "completed" | "stopped_at_submit_gate" = "completed";
  let stoppedAt: string | undefined;
  let submitted = false;
  const observe =
    (step: FlowStep) =>
    async (condition: FlowCondition): Promise<FlowLook> => {
      let answer: Record<string, unknown>;
      try {
        answer = await session.step(observeStepOf(flowId, step, condition));
      } catch (error) {
        // a dialog is the page's answer, and it is never the submit's effect
        if (isFrameworkError(error) && error.code === "action_dialog_opened") return "dialog";
        // a page between documents answers nothing: not yet, so the verify asks again
        return undefined;
      }
      return typeof answer.href === "string"
        ? { held: answer.held === true, href: answer.href }
        : undefined;
    };
  const notes: string[] = [];

  try {
    await session.open();
    await session.gate();
    try {
      await holdCdpActions(session);
    } catch (error) {
      throw new FrameworkError(
        isFrameworkError(error) ? error.code : "cdp_endpoint_unreachable",
        `Refusing to run the flow: the DevTools connection did not bind the owned tab (${error instanceof Error ? error.message : String(error)}), and surf has no check on an element before input. No step ran.`,
        { flow_id: flowId },
      );
    }
    for (const [index, step] of flow.steps.entries()) {
      const submits = isSubmitStep(step);
      if (submits && !normalized.submit) {
        // the gate stays closed: no step at or after the first submit runs
        status = "stopped_at_submit_gate";
        stoppedAt = step.id;
        break;
      }
      const started = Date.now();
      // the flow's submit is claimed once, for good, before the first submit acts
      if (submits && !submitted) await reserveFlowSubmit(flowId, context);
      // authorization covers the declared submit steps only; every other act stays gated
      const base = sessionStepOf(flowId, step, {
        origins: context.config.mutation.allowOrigins,
        submit: submits ? "authorized" : "undeclared",
      });
      const submit = submits
        ? submitStepOf(base, step, observe(step), context.config.surf.submit.postconditionTimeoutMs)
        : undefined;
      try {
        await session.step(submit ?? base);
      } catch (error) {
        throw stepFailure(
          submit ? asSubmitUnmet(error, step, flowId, context, submit.dialogOpened()) : error,
          step,
          flowId,
          context,
        );
      }
      submitted ||= submits;
      results[index] = {
        ...(results[index] as SurfFlowStepResult),
        outcome: "ok",
        ms: Date.now() - started,
      };
    }
  } finally {
    await releaseCdpActions(session);
    notes.push(...session.notes());
    await session.close();
  }

  const receipts = context.ledger.envelopeReceipts();
  const last = receipts[receipts.length - 1];
  const receiptExport = normalized.receiptOut
    ? await writeReceiptExport(normalized.receiptOut, context, flowId)
    : undefined;
  return finalizeEnvelope(
    {
      operationId: "surf.flow" as const,
      input: normalized,
      flow: {
        path: path.resolve(normalized.file),
        approvalToken: flowId,
        steps: flow.steps.length,
      },
      ...(last ? { receipt: { path: last.path ?? "", outcome: last.outcome } } : {}),
      ...(receiptExport ? { receiptExport } : {}),
      result: {
        url: flow.url,
        status,
        ...(stoppedAt ? { stoppedAt } : {}),
        steps: results,
        submitted,
        channel: "cdp" as const,
      },
      notes,
    },
    context,
    SURF_FLOW_OPERATION_EFFECT,
  );
}

export const SURF_FLOW_OPERATION = {
  id: "surf.flow",
  effect: SURF_FLOW_OPERATION_EFFECT,
  route: { command: "surf", action: "flow" },
  description:
    "Run a flow file's steps (wait, assert, fill, select, check, uncheck, click, press) in an owned tab on one DevTools connection: every act is receipted, checked on its element before input against mutation.allowOrigins, and refused on a form-level control unless the flow declares that step a submit; without --submit a flow stops before its first submit step, with --submit and --confirm-flow its declared submits run once, each verified by its expect.",
  inputSchema: SurfFlowOperationInputSchema,
  execute: runSurfFlowOperation,
} satisfies OperationDefinition<NormalizedSurfFlowOperationInput, SurfFlowOperationResultEnvelope>;

export async function executeSurfFlowOperation(
  input: SurfFlowOperationInput,
  context?: RunContext,
): Promise<SurfFlowOperationResultEnvelope> {
  const normalized = SurfFlowOperationInputSchema.parse(input);
  return runSurfFlowOperation(
    normalized,
    context ?? mintOperationContext("surf.flow", SURF_FLOW_OPERATION_EFFECT, normalized),
  );
}
