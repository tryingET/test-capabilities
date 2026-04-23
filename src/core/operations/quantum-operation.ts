import { z } from "zod";
import { QuantumTestRunner } from "../../quantum/simulator.js";
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
): Promise<QuantumOperationResultEnvelope> {
  const branches = parsePositiveIntegerOption(normalized.branches, "--branches");
  const runner = new QuantumTestRunner({
    branches,
    collapseStrategy: normalized.collapse ? "significance" : "coverage",
    seed: 42,
  });

  return {
    operationId: "quantum",
    input: {
      ...normalized,
      branches: String(branches),
    },
    result: await runner.run(normalized.target),
  };
}

export const QUANTUM_OPERATION = {
  id: "quantum",
  route: { command: "quantum" },
  description: "Run the shared quantum simulator",
  inputSchema: QuantumOperationInputSchema,
  execute: runQuantumOperation,
} satisfies OperationDefinition<NormalizedQuantumOperationInput, QuantumOperationResultEnvelope>;

export async function executeQuantumOperation(
  input: QuantumOperationInput,
): Promise<QuantumOperationResultEnvelope> {
  return runQuantumOperation(QuantumOperationInputSchema.parse(input));
}
