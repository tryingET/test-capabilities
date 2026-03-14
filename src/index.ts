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
  AgentConfig,
  CoverageReport,
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
// Core
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

// Version
export const VERSION = "2.0.0";

import type { TestCapabilitiesConfig } from "./core/orchestrator.js";
// Convenience factory
import { TestCapabilitiesOrchestrator } from "./core/orchestrator.js";

export function createTestCapabilities(
  config: TestCapabilitiesConfig,
): TestCapabilitiesOrchestrator {
  return new TestCapabilitiesOrchestrator(config);
}

export const createNexus = createTestCapabilities;

export default TestCapabilitiesOrchestrator;
