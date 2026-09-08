import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { EffectDeclaration } from "../effects.js";
import {
  createReplacementValidationPlan,
  type ReplacementValidationResult,
} from "../replacement-validation.js";
import type { RunContext } from "../run-context.js";
import { finalizeEnvelope, mintOperationContext } from "../run-context.js";
import type {
  OperationDefinition,
  ReplacementValidationOperationInput,
  ReplacementValidationOperationResultEnvelope,
} from "./types.js";

export const ReplacementValidationOperationInputSchema = z
  .object({
    action: z.literal("plan").default("plan"),
    request: z.string().min(1),
    out: z.string().min(1).optional(),
    json: z.boolean().default(false),
  })
  .strict();

/** `--out` writes the plan into the workspace; without it the operation only reads a request. */
export function replacementValidationOperationEffect(input: { out?: string }): EffectDeclaration {
  return input.out
    ? {
        effect: "mutating",
        scope: "workspace",
        reason: "writes the validation plan to --out in the workspace",
      }
    : { effect: "read_only", reason: "reads the request file and returns the plan" };
}

function writeJsonFile(outPathInput: string, value: unknown): void {
  const outPath = path.resolve(outPathInput);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function executeReplacementValidationOperation(
  input: ReplacementValidationOperationInput,
  context?: RunContext,
): Promise<ReplacementValidationOperationResultEnvelope> {
  const run =
    context ??
    mintOperationContext("replacement-validation", replacementValidationOperationEffect, input);
  const requestPath = path.resolve(input.request);
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  const result = createReplacementValidationPlan(request) as ReplacementValidationResult;

  if (input.out) {
    writeJsonFile(input.out, result);
  }

  return finalizeEnvelope(
    {
      operationId: "replacement-validation" as const,
      input: {
        action: input.action,
        request: input.request,
        json: input.json ?? false,
        ...(input.out ? { out: input.out } : {}),
      },
      requestPath,
      result,
    },
    run,
    replacementValidationOperationEffect(input),
  );
}

export const REPLACEMENT_VALIDATION_OPERATION: OperationDefinition<
  ReplacementValidationOperationInput,
  ReplacementValidationOperationResultEnvelope
> = {
  id: "replacement-validation",
  effect: replacementValidationOperationEffect,
  route: { command: "replacement-validation" },
  description:
    "Plan replacement validation from an explicit dep-surgeon candidate request without executing commands",
  inputSchema: ReplacementValidationOperationInputSchema,
  execute: executeReplacementValidationOperation,
};
