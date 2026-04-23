import { z } from "zod";
import type { TestCapabilitiesConfig, TestResult } from "../orchestrator.js";
import { TestCapabilitiesOrchestrator } from "../orchestrator.js";
import {
  applyQuickMode,
  applyTargetOverride,
  assertMeaningfulTestTargetOverride,
  loadConfig,
} from "./config-overrides.js";
import { assertSupportedTestOptions } from "./support.js";
import type {
  OperationDefinition,
  TestOperationInput,
  TestOperationResultEnvelope,
  TestOperationSummary,
} from "./types.js";

export const TestOperationInputSchema = z
  .object({
    target: z.string().optional(),
    config: z.string().default("test-capabilities.yaml"),
    autonomous: z.boolean().optional().default(false),
    selfHeal: z.boolean().optional().default(false),
    predict: z.boolean().optional().default(false),
    quick: z.boolean().optional().default(false),
    failThreshold: z.string().optional(),
    uploadArtifacts: z.boolean().optional().default(false),
    report: z.string().optional(),
  })
  .transform((input) => {
    assertSupportedTestOptions(input);
    return input;
  });

type NormalizedTestOperationInput = z.output<typeof TestOperationInputSchema>;

async function runSuite(config: TestCapabilitiesConfig): Promise<TestResult> {
  const orchestrator = new TestCapabilitiesOrchestrator(config);
  return orchestrator.run();
}

function summarizeTestResult(result: TestResult): TestOperationSummary {
  return {
    health: result.passed ? "pass" : "fail",
    findings: result.findings.length,
    coverage: result.coverage,
    predictions: result.predictions?.length ?? 0,
    quantumUniverses: result.quantumInsights?.universesSimulated,
  };
}

async function runTestOperation(
  normalized: NormalizedTestOperationInput,
): Promise<TestOperationResultEnvelope> {
  let config = loadConfig(normalized.config);
  config = applyTargetOverride(config, normalized.target);

  if (normalized.quick) {
    config = applyQuickMode(config);
  }

  assertMeaningfulTestTargetOverride(normalized.target, config);

  const result = await runSuite(config);

  return {
    operationId: "test",
    mode: normalized.quick ? "quick" : "standard",
    input: normalized,
    effectiveConfig: config,
    summary: summarizeTestResult(result),
    result,
  };
}

export const TEST_OPERATION = {
  id: "test",
  route: { command: "test" },
  description: "Run the capability-backed orchestrator path",
  inputSchema: TestOperationInputSchema,
  execute: runTestOperation,
} satisfies OperationDefinition<NormalizedTestOperationInput, TestOperationResultEnvelope>;

export async function executeTestOperation(
  input: TestOperationInput,
): Promise<TestOperationResultEnvelope> {
  return runTestOperation(TestOperationInputSchema.parse(input));
}
