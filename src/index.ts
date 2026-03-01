/**
 * TEST-CAPABILITIES Testing Framework
 * The Future of AI-Driven Testing
 */

export type {
  AgentConfig,
  CoverageReport,
  Finding,
  FindingType,
  Prediction,
  QuantumInsights,
  Severity,
  Target,
  TestCapabilitiesConfig,
  TestResult,
} from "./core/orchestrator";
// Core
export { TestCapabilitiesOrchestrator } from "./core/orchestrator";
export type {
  ElementSnapshot,
  HealingContext,
  HealingProposal,
  HealingResult,
  HealingStrategy,
} from "./healing/self-healing";
// Self-healing
export { SelfHealingEngine, TestFileHealer } from "./healing/self-healing";
export type {
  NetworkRequest,
  SurfActionResult,
  SurfConfig,
  SurfElement,
  SurfSnapshot,
} from "./integrations/surf-client";
// Surf Integration
export { SurfClient, SurfFlowBuilder } from "./integrations/surf-client";
export type {
  Prediction,
  PredictionInput,
  PredictionModel,
  TrainingData,
} from "./prediction/engine";
// Prediction
export {
  GradientBoostingPredictor,
  PredictionCollector,
  PredictionEngine,
} from "./prediction/engine";
export type {
  Discovery,
  QuantumAction,
  QuantumBranch,
  QuantumConfig,
  QuantumCoverage,
  QuantumResult,
  QuantumState,
} from "./quantum/simulator";
// Quantum
export { QuantumSimulator, QuantumTestRunner } from "./quantum/simulator";

// Version
export const VERSION = "2.0.0";

import type { TestCapabilitiesConfig } from "./core/orchestrator";
// Convenience factory
import { TestCapabilitiesOrchestrator } from "./core/orchestrator";

export function createTestCapabilities(
  config: TestCapabilitiesConfig,
): TestCapabilitiesOrchestrator {
  return new TestCapabilitiesOrchestrator(config);
}

export default TestCapabilitiesOrchestrator;
