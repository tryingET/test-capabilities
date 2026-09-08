import { z } from "zod";
import { QuantumTestRunner } from "../../quantum/simulator.js";
import type { EffectDeclaration } from "../effects.js";
import type { RunContext } from "../run-context.js";
import { finalizeEnvelope, mintOperationContext } from "../run-context.js";
import type {
  OperationDefinition,
  QuantumOperationInput,
  QuantumOperationResultEnvelope,
} from "./types.js";

export const QuantumOperationInputSchema = z.object({
  target: z
    .string({
      required_error: "Quantum simulation requires --target with a valid URL.",
    })
    .url("Quantum target must be a valid URL."),
  branches: z.string().optional().default("100"),
  collapse: z.boolean().optional().default(false),
});

type NormalizedQuantumOperationInput = z.output<typeof QuantumOperationInputSchema>;

function parsePositiveIntegerOption(value: string, optionName: string): number {
  const normalized = value.trim();

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`Invalid value for ${optionName}: ${value}. Use a positive integer.`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${optionName}: ${value}. Use a positive integer.`);
  }

  return parsed;
}

async function runQuantumOperation(
  normalized: NormalizedQuantumOperationInput,
  context: RunContext,
): Promise<QuantumOperationResultEnvelope> {
  const branches = parsePositiveIntegerOption(normalized.branches, "--branches");
  const runner = new QuantumTestRunner({
    branches,
    collapseStrategy: normalized.collapse ? "significance" : "coverage",
    seed: 42,
  });

  return finalizeEnvelope(
    {
      operationId: "quantum",
      input: {
        ...normalized,
        branches: String(branches),
      },
      result: await runner.run(normalized.target),
    },
    context,
    QUANTUM_OPERATION_EFFECT,
  );
}

/**
 * Parked (operator decision D1). The simulator is a seeded in-memory computation: it contacts no
 * target, so it can produce no target evidence, and `tests/parked_runtime_contract.test.mjs`
 * pins that it never writes a Finding or an Observation and never reaches a determination.
 */
export const QUANTUM_OPERATION_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason: "parked; produces no target evidence",
};

export const QUANTUM_OPERATION = {
  id: "quantum",
  effect: QUANTUM_OPERATION_EFFECT,
  route: { command: "quantum" },
  description: "Run the shared quantum simulator",
  inputSchema: QuantumOperationInputSchema,
  execute: runQuantumOperation,
} satisfies OperationDefinition<NormalizedQuantumOperationInput, QuantumOperationResultEnvelope>;

export async function executeQuantumOperation(
  input: QuantumOperationInput,
  context?: RunContext,
): Promise<QuantumOperationResultEnvelope> {
  const normalized = QuantumOperationInputSchema.parse(input);
  return runQuantumOperation(
    normalized,
    context ?? mintOperationContext("quantum", QUANTUM_OPERATION_EFFECT, normalized),
  );
}
