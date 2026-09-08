/**
 * `surf plan`: read a form, write what an operator can review, touch nothing (submit-gate
 * packet §4.1, D1; slice S7).
 *
 * The operation is read-only by construction: it opens a tab this run owns, gates it once, runs
 * one page-side expression that reads the form, closes the tab in `finally`, and writes the
 * artifact 0600 through the kernel artifact writer. Nothing is typed and nothing is clicked -
 * the verbs that could are not reachable from this file.
 *
 * The artifact is the interlock between preparing and applying (packet, Mode 3): it is what the
 * operator reads, the approval token binds to its content, and `surf apply` may address nothing
 * that is not in it.
 */

import { z } from "zod";
import { writeJsonArtifact } from "../artifacts.js";
import type { EffectDeclaration } from "../effects.js";
import type { RunContext } from "../run-context.js";
import { finalizeEnvelope, mintOperationContext } from "../run-context.js";
import { FrameworkError } from "../runtime-contract.js";
import type { PlanFieldRequest, SurfPlan } from "../surf-plan.js";
import { describeLocator, parseFieldSpec, SURF_PLAN_KIND } from "../surf-plan.js";
import type { SurfSessionRuntime } from "../surf-session.js";
import { resolveSurfSessionRuntime, SurfSession } from "../surf-session.js";
import { assertSupportedSurfPlanOptions } from "./support.js";
import type {
  OperationDefinition,
  SurfPlanOperationInput,
  SurfPlanOperationResultEnvelope,
} from "./types.js";

/**
 * Reading a form is reading a page. The tab lifecycle is the run's own browser, never the
 * target, which is why a plan writes no mutation receipt.
 */
export const SURF_PLAN_OPERATION_EFFECT: EffectDeclaration = {
  effect: "read_only",
  scope: "browser_session",
  reason: "opens a tab it owns, reads the form's fields and buttons, and closes the tab",
};

export const SurfPlanOperationInputSchema = z.preprocess(
  (raw) => {
    // The three surf actions share one commander command, so the check has to see the *raw*
    // input: a key the plan schema does not declare would otherwise be stripped before anything
    // could refuse it.
    if (typeof raw === "object" && raw !== null) {
      assertSupportedSurfPlanOptions(raw as Record<string, unknown>);
    }
    return raw;
  },
  z
    .object({
      url: z
        .string({ required_error: "Surf plan requires --url with a valid URL." })
        .url("Surf plan target must be a valid URL."),
      field: z
        .array(z.string().min(1))
        .default([])
        .refine((fields) => fields.length > 0, {
          message:
            "Surf plan requires at least one --field '<label|selector|name>:<locator>=<value>': a plan with no fields is not a plan.",
        }),
      submitText: z.string().min(1).optional(),
      submitSelector: z.string().min(1).optional(),
      out: z.string({ required_error: "Surf plan requires --out <plan.json>." }).min(1),
      config: z.string().min(1).optional(),
      json: z.boolean().optional().default(false),
    })
    .transform((input) => {
      if (input.submitText !== undefined && input.submitSelector !== undefined) {
        throw new FrameworkError(
          "config_invalid",
          "Surf plan accepts either --submit-text or --submit-selector, not both: two hints that disagree would decide which control may be clicked by accident.",
          {},
        );
      }
      return input;
    }),
);

type NormalizedSurfPlanOperationInput = z.output<typeof SurfPlanOperationInputSchema>;

const SURF_PLAN_ARTIFACT_LABEL = "Surf plan artifact output";

function parseFields(specs: readonly string[]): PlanFieldRequest[] {
  return specs.map((spec, index) => parseFieldSpec(spec, index));
}

/**
 * The envelope carries the plan's shape, its path and its token; the values it intends to type
 * stay in the 0600 file (architecture review A10). An operator reads the file; a pipeline reads
 * the envelope.
 */
function envelopeResultFrom(plan: SurfPlan): SurfPlanOperationResultEnvelope["result"] {
  return {
    target: {
      url: plan.target.url,
      origin: plan.target.origin,
      landedHref: plan.target.landed_href,
      title: plan.target.title,
      readiness: plan.target.readiness,
    },
    runtime: plan.runtime,
    fields: plan.fields.map((field) => ({
      id: field.id,
      locator: describeLocator(field.locator),
      resolvedSelector: field.resolved_selector,
      control: field.control,
      setVia: field.set_via,
    })),
    submit: plan.submit,
    forbiddenControls: plan.forbidden_controls,
    fingerprint: plan.fingerprint,
  };
}

async function planPage(
  context: RunContext,
  runtime: SurfSessionRuntime,
  normalized: NormalizedSurfPlanOperationInput,
  fields: readonly PlanFieldRequest[],
): Promise<{ plan: SurfPlan; notes: string[] }> {
  const session = new SurfSession({
    context,
    url: normalized.url,
    runtime,
    idPrefix: "surf.plan",
  });

  await session.open();
  try {
    await session.gate();
    const plan = await session.plan({
      fields,
      ...(normalized.submitText ? { submitText: normalized.submitText } : {}),
      ...(normalized.submitSelector ? { submitSelector: normalized.submitSelector } : {}),
    });
    return { plan, notes: [...session.notes()] };
  } finally {
    await session.close();
  }
}

async function runSurfPlanOperation(
  normalized: NormalizedSurfPlanOperationInput,
  context: RunContext,
): Promise<SurfPlanOperationResultEnvelope> {
  const fields = parseFields(normalized.field);
  const runtime = resolveSurfSessionRuntime();
  const { plan, notes } = await planPage(context, runtime, normalized, fields);

  // 0600: the artifact carries the values this plan intends to type (packet §5).
  const path = await writeJsonArtifact(normalized.out, plan, {
    label: SURF_PLAN_ARTIFACT_LABEL,
  });

  return finalizeEnvelope(
    {
      operationId: "surf.plan" as const,
      // The locator an operator wrote is context; the value it carries is not. The envelope
      // names what was addressed, the 0600 artifact holds what will be typed (review A10).
      input: {
        ...normalized,
        field: fields.map((field) => `${describeLocator(field.locator)}=[redacted]`),
      },
      plan: {
        path,
        planId: plan.plan_id,
        approvalToken: plan.approval_token,
        artifactKind: SURF_PLAN_KIND,
        schemaVersion: plan.schema_version,
      },
      result: envelopeResultFrom(plan),
      notes,
    },
    context,
    SURF_PLAN_OPERATION_EFFECT,
  );
}

export const SURF_PLAN_OPERATION = {
  id: "surf.plan",
  effect: SURF_PLAN_OPERATION_EFFECT,
  route: { command: "surf", action: "plan" },
  description:
    "Read a form in an owned tab and write a reviewable plan artifact: resolved selectors, intended values, the one control that may be clicked, and the buttons that never may. Read-only; nothing is typed and nothing is clicked.",
  inputSchema: SurfPlanOperationInputSchema,
  execute: runSurfPlanOperation,
} satisfies OperationDefinition<NormalizedSurfPlanOperationInput, SurfPlanOperationResultEnvelope>;

export async function executeSurfPlanOperation(
  input: SurfPlanOperationInput,
  context?: RunContext,
): Promise<SurfPlanOperationResultEnvelope> {
  const normalized = SurfPlanOperationInputSchema.parse(input);
  return runSurfPlanOperation(
    normalized,
    context ?? mintOperationContext("surf.plan", SURF_PLAN_OPERATION_EFFECT, normalized),
  );
}
