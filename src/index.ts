/**
 * TEST-CAPABILITIES Testing Framework
 * The Future of AI-Driven Testing
 */

export {
  assertSupportedCliCommand,
  assertSupportedSurfAction,
  assertSupportedTestOptions,
  CAPABILITY_MATRIX,
  validateCapabilityContract,
} from "./core/capabilities.js";
export type {
  CliCommand,
  CliOperationResult,
  CliRoute,
  CliRouteManifestEntry,
  HealOperationInput,
  HealOperationResultEnvelope,
  HealProposalArtifactRef,
  HealVerificationArtifactRef,
  OperationId,
  OperationStatus,
  QuantumOperationInput,
  QuantumOperationResultEnvelope,
  SurfAction,
  SurfExploreOperationInput,
  SurfExploreOperationResultEnvelope,
  TestOperationInput,
  TestOperationResultEnvelope,
  TestOperationSummary,
} from "./core/operations.js";
// Core
export {
  CLI_OPERATION_REGISTRY,
  CLI_ROUTE_MANIFEST,
  executeCliOperation,
  executeHealOperation,
  executeQuantumOperation,
  executeSurfExploreOperation,
  executeTestOperation,
  getCliCommandStatus,
  getSurfActionStatus,
  resolveCliRoute,
  SURF_EXPLORE_OPTION_SUPPORT,
  TEST_OPTION_SUPPORT,
} from "./core/operations.js";
export type {
  AgentConfig,
  CoverageDimension,
  CoverageReport,
  CoverageStatus,
  Finding,
  FindingType,
  Prediction as OrchestratorPrediction,
  QuantumInsights,
  Severity,
  Target,
  TestCapabilitiesConfig,
  TestCapabilitiesConfig as NexusConfig,
  TestResult,
} from "./core/orchestrator.js";
export {
  AgentConfigSchema,
  TargetSchema,
  TestCapabilitiesConfigSchema,
  TestCapabilitiesOrchestrator,
  TestCapabilitiesOrchestrator as NexusOrchestrator,
} from "./core/orchestrator.js";
export type {
  ElementSnapshot,
  HealingContext,
  HealingProposal,
  HealingProposalVerification,
  HealingProposalVerificationFailure,
  HealingResult,
  HealingStrategy,
} from "./healing/self-healing.js";
// Self-healing
export { SelfHealingEngine, TestFileHealer } from "./healing/self-healing.js";
export type {
  NetworkRequest,
  SurfActionResult,
  SurfConfig,
  SurfElement,
  SurfSnapshot,
} from "./integrations/surf-client.js";
// Surf Integration
export { SurfClient, SurfFlowBuilder } from "./integrations/surf-client.js";
export type {
  Prediction,
  PredictionInput,
  PredictionModel,
  TrainingData,
} from "./prediction/engine.js";
// Prediction
export {
  GradientBoostingPredictor,
  PredictionCollector,
  PredictionEngine,
} from "./prediction/engine.js";
export type {
  Discovery,
  QuantumAction,
  QuantumBranch,
  QuantumConfig,
  QuantumCoverage,
  QuantumResult,
  QuantumState,
} from "./quantum/simulator.js";
// Quantum
export { QuantumSimulator, QuantumTestRunner } from "./quantum/simulator.js";

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { TestCapabilitiesConfig } from "./core/orchestrator.js";
// Convenience factory
import { TestCapabilitiesOrchestrator } from "./core/orchestrator.js";

const packageRoot = process.env.TEST_CAPABILITIES_PACKAGE_ROOT
  ? path.resolve(process.env.TEST_CAPABILITIES_PACKAGE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

// Version
export const VERSION = packageJson.version;

export function createTestCapabilities(
  config: TestCapabilitiesConfig,
): TestCapabilitiesOrchestrator {
  return new TestCapabilitiesOrchestrator(config);
}

export const createNexus = createTestCapabilities;

export default TestCapabilitiesOrchestrator;
