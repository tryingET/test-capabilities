import path from "node:path";
import { z } from "zod";
import { collectFiles } from "../../healing/collect-files.js";
import type { HealingProposal } from "../../healing/self-healing.js";
import { TestFileHealer } from "../../healing/self-healing.js";
import type {
  HealOperationInput,
  HealOperationResultEnvelope,
  OperationDefinition,
} from "./types.js";

export const HealOperationInputSchema = z.object({
  dir: z.string().optional().default("./tests"),
  dryRun: z.boolean().optional().default(false),
});

type NormalizedHealOperationInput = z.output<typeof HealOperationInputSchema>;

async function runHealOperation(
  normalized: NormalizedHealOperationInput,
): Promise<HealOperationResultEnvelope> {
  const healer = new TestFileHealer();
  const files = collectFiles(path.resolve(normalized.dir));
  const proposals: HealingProposal[] = [];

  for (const file of files) {
    const fileProposals = await healer.analyzeFile(file);
    proposals.push(...fileProposals);
  }

  if (!normalized.dryRun) {
    await healer.applyProposals(proposals);
  }

  return {
    operationId: "heal",
    input: normalized,
    proposals,
    appliedCount: normalized.dryRun ? 0 : proposals.length,
  };
}

export const HEAL_OPERATION = {
  id: "heal",
  route: { command: "heal" },
  description: "Run the selector-healing workflow",
  inputSchema: HealOperationInputSchema,
  execute: runHealOperation,
} satisfies OperationDefinition<NormalizedHealOperationInput, HealOperationResultEnvelope>;

export async function executeHealOperation(
  input: HealOperationInput,
): Promise<HealOperationResultEnvelope> {
  return runHealOperation(HealOperationInputSchema.parse(input));
}
