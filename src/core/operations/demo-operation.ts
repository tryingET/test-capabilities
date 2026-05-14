import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { TestCapabilitiesConfig, TestResult } from "../orchestrator.js";
import { TestCapabilitiesOrchestrator } from "../orchestrator.js";
import type {
  DemoOperationInput,
  DemoOperationResultEnvelope,
  OperationDefinition,
  TestOperationSummary,
} from "./types.js";

export const DemoOperationInputSchema = z.object({
  json: z.boolean().optional().default(false),
});

type NormalizedDemoOperationInput = z.output<typeof DemoOperationInputSchema>;

function resolvePackageRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TEST_CAPABILITIES_PACKAGE_ROOT) {
    return path.resolve(env.TEST_CAPABILITIES_PACKAGE_ROOT);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
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

function buildDemoConfig(packageRoot: string): TestCapabilitiesConfig {
  const demoCli = path.join(packageRoot, "examples", "demo", "cli-demo.mjs");
  return {
    version: "2.0",
    name: "TEST-CAPABILITIES built-in demo",
    targets: {
      cli: `${process.execPath} ${demoCli}`,
    },
    agents: {
      cli: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
    },
    intelligence: {
      selfHealing: false,
      prediction: false,
      correlation: true,
      collective: false,
    },
    quantum: {
      enabled: false,
    },
    chaos: {
      enabled: false,
    },
  };
}

async function runDemoOperation(
  normalized: NormalizedDemoOperationInput,
): Promise<DemoOperationResultEnvelope> {
  const packageRoot = resolvePackageRoot();
  const config = buildDemoConfig(packageRoot);
  const result = await new TestCapabilitiesOrchestrator(config).run();

  return {
    operationId: "demo",
    input: normalized,
    packageRoot,
    demo: {
      name: config.name,
      cliFixture: path.join(packageRoot, "examples", "demo", "cli-demo.mjs"),
      configFixture: path.join(packageRoot, "examples", "demo", "test-capabilities.yaml"),
    },
    effectiveConfig: config,
    summary: summarizeTestResult(result),
    result,
  };
}

export const DEMO_OPERATION = {
  id: "demo",
  route: { command: "demo" },
  description: "Run the built-in zero-external-dependency demo fixture",
  inputSchema: DemoOperationInputSchema,
  execute: runDemoOperation,
} satisfies OperationDefinition<NormalizedDemoOperationInput, DemoOperationResultEnvelope>;

export async function executeDemoOperation(
  input: DemoOperationInput,
): Promise<DemoOperationResultEnvelope> {
  return runDemoOperation(DemoOperationInputSchema.parse(input));
}
