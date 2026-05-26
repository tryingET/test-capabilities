import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  createReplacementValidationPlan,
  type ReplacementValidationResult,
} from "../replacement-validation.js";
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

function writeJsonFile(outPathInput: string, value: unknown): void {
  const outPath = path.resolve(outPathInput);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function executeReplacementValidationOperation(
  input: ReplacementValidationOperationInput,
): Promise<ReplacementValidationOperationResultEnvelope> {
  const requestPath = path.resolve(input.request);
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  const result = createReplacementValidationPlan(request) as ReplacementValidationResult;

  if (input.out) {
    writeJsonFile(input.out, result);
  }

  return {
    operationId: "replacement-validation",
    input: {
      action: input.action,
      request: input.request,
      json: input.json ?? false,
      ...(input.out ? { out: input.out } : {}),
    },
    requestPath,
    result,
  };
}

export const REPLACEMENT_VALIDATION_OPERATION: OperationDefinition<
  ReplacementValidationOperationInput,
  ReplacementValidationOperationResultEnvelope
> = {
  id: "replacement-validation",
  route: { command: "replacement-validation" },
  description:
    "Plan replacement validation from an explicit dep-surgeon candidate request without executing commands",
  inputSchema: ReplacementValidationOperationInputSchema,
  execute: executeReplacementValidationOperation,
};
