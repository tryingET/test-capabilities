/**
 * NEXUS Testing Framework
 * The Future of AI-Driven Testing
 */

export type {
  AgentConfig,
  CoverageReport,
  Finding,
  FindingType,
  NexusConfig,
  Prediction,
  QuantumInsights,
  Severity,
  Target,
  TestResult,
} from "./core/orchestrator";
// Core
export { NexusOrchestrator } from "./core/orchestrator";
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

import type { NexusConfig } from "./core/orchestrator";
// Convenience factory
import { NexusOrchestrator } from "./core/orchestrator";

export function createNexus(config: NexusConfig): NexusOrchestrator {
  return new NexusOrchestrator(config);
}

export default NexusOrchestrator;
