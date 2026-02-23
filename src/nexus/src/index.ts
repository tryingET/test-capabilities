/**
 * NEXUS Testing Framework
 * The Future of AI-Driven Testing
 */

// Core
export { NexusOrchestrator } from './core/orchestrator';
export type { 
  NexusConfig, 
  Target, 
  AgentConfig, 
  Finding, 
  TestResult,
  CoverageReport,
  Prediction,
  QuantumInsights,
  FindingType,
  Severity,
} from './core/orchestrator';

// Self-healing
export { SelfHealingEngine, TestFileHealer } from './healing/self-healing';
export type {
  HealingStrategy,
  HealingContext,
  HealingResult,
  HealingProposal,
  ElementSnapshot,
} from './healing/self-healing';

// Surf Integration
export { SurfClient, SurfFlowBuilder } from './integrations/surf-client';
export type {
  SurfConfig,
  SurfElement,
  SurfSnapshot,
  SurfActionResult,
  NetworkRequest,
} from './integrations/surf-client';

// Quantum
export { QuantumSimulator, QuantumTestRunner } from './quantum/simulator';
export type {
  QuantumConfig,
  QuantumBranch,
  QuantumAction,
  QuantumState,
  Discovery,
  QuantumResult,
  QuantumCoverage,
} from './quantum/simulator';

// Prediction
export { 
  PredictionEngine, 
  GradientBoostingPredictor, 
  PredictionCollector 
} from './prediction/engine';
export type {
  PredictionInput,
  Prediction,
  PredictionModel,
  TrainingData,
} from './prediction/engine';

// Version
export const VERSION = '2.0.0';

// Convenience factory
import { NexusOrchestrator } from './core/orchestrator';
import type { NexusConfig } from './core/orchestrator';

export function createNexus(config: NexusConfig): NexusOrchestrator {
  return new NexusOrchestrator(config);
}

export default NexusOrchestrator;
