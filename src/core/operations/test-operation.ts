import { z } from "zod";
import type { TestCapabilitiesConfig } from "../config.js";
import { countOutcomeBases, countOutcomeClasses } from "../determination.js";
import type { EffectDeclaration } from "../effects.js";
import { worstEffect } from "../effects.js";
import type { TestResult } from "../orchestrator.js";
import { TestCapabilitiesOrchestrator } from "../orchestrator.js";
import type { RunContext } from "../run-context.js";
import { finalizeEnvelope, mintOperationContext } from "../run-context.js";
import {
  applyQuickMode,
  applyTargetOverride,
  assertMeaningfulTestTargetOverride,
  loadConfig,
} from "./config-overrides.js";
import { assertSupportedTestOptions } from "./support.js";
import { AGENT_EFFECTS } from "./test/agent-findings.js";
import type {
  OperationDefinition,
  TestOperationInput,
  TestOperationResultEnvelope,
  TestOperationSummary,
} from "./types.js";

export const TestOperationInputSchema = z
  .object({
    json: z.boolean().optional().default(false),
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

async function runSuite(config: TestCapabilitiesConfig, context: RunContext): Promise<TestResult> {
  const orchestrator = new TestCapabilitiesOrchestrator(config);
  return orchestrator.run(context);
}

/** The config as `test` will actually run it: the same overrides `runTestOperation` applies. */
function effectiveTestConfig(input: {
  config: string;
  target?: string;
  quick: boolean;
}): TestCapabilitiesConfig {
  const config = applyTargetOverride(loadConfig(input.config), input.target);
  return input.quick ? applyQuickMode(config) : config;
}

/**
 * `test` resolves to the worst class of the agents it will actually enable (mutation-safety
 * packet, "Declaration points"): a suite of cli-tester and surf agents is read-only, and one
 * enabled bombadil or terminal-fuzzer agent makes the whole run mutating, with that agent's
 * reason carried into the envelope.
 */
export function testOperationEffect(input: {
  config: string;
  target?: string;
  quick: boolean;
}): EffectDeclaration {
  return effectForConfig(effectiveTestConfig(input));
}

/** The worst class of the agents this config enables. */
function effectForConfig(config: TestCapabilitiesConfig): EffectDeclaration {
  const enabled = Object.values(config.agents ?? {})
    .filter((agent) => agent.enabled !== false)
    .map((agent) => AGENT_EFFECTS[agent.type]);
  return enabled.length === 0
    ? { effect: "read_only", reason: "no enabled agent declares an effect" }
    : worstEffect(enabled);
}

function summarizeTestResult(result: TestResult): TestOperationSummary {
  const outcomes = result.outcomes;
  return {
    // `pass` is `determination.value === "verified"` and nothing else: a run that produced no
    // evidence either way is not a pass (operator decision D3).
    health: result.passed ? "pass" : "fail",
    determination: result.determination,
    findings: result.findings.length,
    coverage: result.coverage,
    outcomes: countOutcomeClasses(outcomes),
    bases: countOutcomeBases(outcomes),
    predictions: result.predictions?.length ?? 0,
    quantumUniverses: result.quantumInsights?.universesSimulated,
  };
}

async function runTestOperation(
  normalized: NormalizedTestOperationInput,
  context: RunContext,
): Promise<TestOperationResultEnvelope> {
  const config = effectiveTestConfig(normalized);

  assertMeaningfulTestTargetOverride(normalized.target, config);

  const result = await runSuite(config, context);

  return finalizeEnvelope(
    {
      operationId: "test" as const,
      mode: normalized.quick ? "quick" : ("standard" as "quick" | "standard"),
      input: normalized,
      effectiveConfig: config,
      summary: summarizeTestResult(result),
      result,
    },
    context,
    effectForConfig(config),
  );
}

export const TEST_OPERATION = {
  id: "test",
  effect: testOperationEffect,
  route: { command: "test" },
  description: "Run the capability-backed orchestrator path",
  inputSchema: TestOperationInputSchema,
  execute: runTestOperation,
} satisfies OperationDefinition<NormalizedTestOperationInput, TestOperationResultEnvelope>;

export async function executeTestOperation(
  input: TestOperationInput,
  context?: RunContext,
): Promise<TestOperationResultEnvelope> {
  const normalized = TestOperationInputSchema.parse(input);
  return runTestOperation(
    normalized,
    context ?? mintOperationContext("test", testOperationEffect, normalized),
  );
}
