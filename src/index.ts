/**
 * TEST-CAPABILITIES Testing Framework
 * Fail-closed testing capability framework
 */

export type { ArtifactKind, ArtifactListEntry, WriteArtifactOptions } from "./core/artifacts.js";
export {
  ARTIFACT_FILE_MODE,
  ARTIFACT_KINDS,
  FileReceiptStore,
  listJsonArtifacts,
  writeJsonArtifact,
} from "./core/artifacts.js";
export type {
  ApplyFieldResult,
  ApplyMode,
  ApplyObservation,
  ApplyRunner,
  BrowserStep,
  JsMutationHit,
  JsMutationSignal,
  OwnedTab,
  Session,
  SessionApplyRequest,
  SessionObservation,
  SessionObserver,
  SessionPlanRequest,
  SessionReadiness,
  SessionReadinessState,
  SessionReply,
  SubmitApplyRunner,
} from "./core/browser-session.js";
// Browser surface: the kernel Session interface (operator decision D2)
export {
  canSubmit,
  findJsMutationSignals,
  JS_MUTATION_SIGNALS,
  SESSION_LIFECYCLE_EFFECT,
} from "./core/browser-session.js";
export { canonicalDigest, canonicalJson } from "./core/canonical-json.js";
export {
  assertSupportedCliCommand,
  assertSupportedSurfAction,
  assertSupportedTestOptions,
  CAPABILITY_MATRIX,
  validateCapabilityContract,
} from "./core/capabilities.js";
export type {
  AgentConfig,
  BombadilOptions,
  BombadilTerminalOptions,
  IntelligenceConfig,
  MutationConfig,
  ParsedTestCapabilitiesConfig,
  PropagationEdge,
  PropagationTopology,
  ReceiptsConfig,
  RuntimeConfigLike,
  Target,
  TestCapabilitiesConfig,
} from "./core/config.js";
export {
  AgentConfigSchema,
  MutationConfigSchema,
  ReceiptsConfigSchema,
  TargetSchema,
  TestCapabilitiesConfigSchema,
} from "./core/config.js";
export type {
  Determination,
  DeterminationContext,
  DeterminationValue,
} from "./core/determination.js";
export {
  countOutcomeBases,
  countOutcomeClasses,
  DETERMINATION_VALUES,
  determineRun,
  outcomeEvidenceLines,
  worstOutcome,
} from "./core/determination.js";
export type {
  AttemptLogEntry,
  EffectAttempt,
  EffectClass,
  EffectDeclaration,
  EffectSettlement,
  EffectStep,
  LedgerContext,
  MutationScope,
} from "./core/effects.js";
export {
  countInDoubt,
  defaultMutationOutcomeForError,
  idempotencyKeyFor,
  MutationError,
  MutationLedger,
  READ_ONLY_ATTEMPT_CAP,
  resolveEffectDeclaration,
  webOriginOf,
  worstEffect,
} from "./core/effects.js";
export type {
  CliCommand,
  CliOperationResult,
  CliRoute,
  CliRouteManifestEntry,
  DemoOperationInput,
  DemoOperationResultEnvelope,
  DoctorCheck,
  DoctorOperationInput,
  DoctorOperationResultEnvelope,
  HealOperationInput,
  HealOperationResultEnvelope,
  HealProposalArtifactRef,
  HealReceiptArtifactRef,
  HealVerificationArtifactRef,
  InitOperationInput,
  InitOperationResultEnvelope,
  OperationId,
  OperationStatus,
  QuantumOperationInput,
  QuantumOperationResultEnvelope,
  ReplacementValidationOperationInput,
  ReplacementValidationOperationResultEnvelope,
  SurfAction,
  SurfApplyOperationInput,
  SurfApplyOperationResultEnvelope,
  SurfExploreOperationInput,
  SurfExploreOperationResultEnvelope,
  SurfPlanOperationInput,
  SurfPlanOperationResultEnvelope,
  TestOperationInput,
  TestOperationResultEnvelope,
  TestOperationSummary,
} from "./core/operations.js";
// Core
export {
  CLI_OPERATION_REGISTRY,
  CLI_ROUTE_MANIFEST,
  executeCliOperation,
  executeDemoOperation,
  executeDoctorOperation,
  executeHealOperation,
  executeInitOperation,
  executeQuantumOperation,
  executeReplacementValidationOperation,
  executeSurfApplyOperation,
  executeSurfExploreOperation,
  executeSurfPlanOperation,
  executeTestOperation,
  getCliCommandStatus,
  getSurfActionStatus,
  resolveCliRoute,
  SURF_EXPLORE_OPTION_SUPPORT,
  TEST_OPTION_SUPPORT,
} from "./core/operations.js";
export type {
  CoverageDimension,
  CoverageReport,
  CoverageStatus,
  Finding,
  FindingType,
  Observation,
  ObservationCalibration,
  ObservationCalibrationLevel,
  ObservationKind,
  ObservationProtocol,
  ObservationSemantics,
  ObservationStatus,
  Prediction as OrchestratorPrediction,
  QuantumInsights,
  RootCauseFailureClass,
  Severity,
  TestResult,
} from "./core/orchestrator.js";
export { ROOT_CAUSE_FAILURE_CLASSES, TestCapabilitiesOrchestrator } from "./core/orchestrator.js";
export type {
  MutationOutcome,
  MutationReceipt,
  MutationReceiptEnvelopeCopy,
  ReceiptFilter,
  ReceiptStore,
  VerifyResult,
} from "./core/receipt-store.js";
export {
  isInDoubt,
  MUTATION_OUTCOMES,
  MUTATION_RECEIPT_KIND,
  MUTATION_RECEIPT_SCHEMA_VERSION,
  matchesReceiptFilter,
  redactReceipt,
} from "./core/receipt-store.js";
export type {
  ReplacementValidationDiagnostic,
  ReplacementValidationRequest,
  ReplacementValidationResult,
  ReplacementValidationSelectedCommand,
  ReplacementValidationStatus,
} from "./core/replacement-validation.js";
export {
  createReplacementValidationPlan,
  REPLACEMENT_VALIDATION_NON_AUTHORIZATIONS,
  REPLACEMENT_VALIDATION_REQUEST_SCHEMA_VERSION,
  REPLACEMENT_VALIDATION_RESULT_SCHEMA_VERSION,
  ReplacementValidationRequestSchema,
} from "./core/replacement-validation.js";
export type {
  ConfigReceiptsSection,
  CreateRunContextOptions,
  ReceiptsSettings,
  RunConfigView,
  RunContext,
  RunMutationSettings,
} from "./core/run-context.js";
export {
  createRunContext,
  DEFAULT_RECEIPTS_DIR,
  detectEphemeralStore,
  RECEIPTS_DIR_ENV,
  RECEIPTS_EPHEMERAL_ENV,
  receiptsBaseFor,
  resolveReceiptsSettings,
} from "./core/run-context.js";
export type { ErrorEnvelope } from "./core/runtime-contract.js";
export {
  FrameworkError,
  isFrameworkError,
  renderErrorLine,
  toErrorEnvelope,
} from "./core/runtime-contract.js";
export { probeSurfRuntime, runSurfCommand } from "./core/surf-adapter.js";
export type { ApplyRunnerOptions, PostCondition } from "./core/surf-apply-runner.js";
export { createApplyRunner } from "./core/surf-apply-runner.js";
export type {
  FieldLocator,
  PlanField,
  PlanFingerprint,
  PlanForbiddenControl,
  PlanSubmit,
  PlanSubmitCandidate,
  PlanSubmitControl,
  SubmitStatus,
  SurfPlan,
} from "./core/surf-plan.js";
export {
  approvalTokenFor,
  fingerprintDrift,
  parseFieldSpec,
  SURF_PLAN_KIND,
  SURF_PLAN_SCHEMA_VERSION,
} from "./core/surf-plan.js";
export { SessionReadinessRefusal } from "./core/surf-readiness.js";
export type {
  SurfCommandFailure,
  SurfCommandResult,
  SurfMechanism,
  SurfReadinessErrorCode,
  SurfRuntimeFlavor,
  SurfRuntimeProbe,
  SurfRuntimeProvider,
  SurfRuntimeResolution,
} from "./core/surf-runtime.js";
export {
  assertSurfExploreMechanisms,
  isSurfReadinessErrorCode,
  parseCreatedTabId,
  parseSurfErrorOutput,
  parseSurfJsonOutput,
  resolveSurfRuntimeCommand,
  resolveSurfRuntimeResolution,
  SURF_MECHANISM_COMMANDS,
  SURF_READINESS_ERROR_CODES,
  SurfCommandError,
  translateSurfArgs,
} from "./core/surf-runtime.js";
export type { SurfSessionOptions, SurfSessionRuntime } from "./core/surf-session.js";
/**
 * The browser surface. `SurfClient` and `SurfFlowBuilder` left the public API at 0.4.0
 * (operator decision D2, adjudication claim 36) because a class that could click anything on
 * any page is ambient authority, and a wrapped ambient capability is still held. What is
 * exported instead is a scope: `SurfSession` opens one tab, gates it, runs declared steps
 * through the run's mutation ledger and closes the tab in `finally`; the class of every step
 * comes from the surf adapter's static map, and page-side script has no class until the caller
 * declares one.
 */
export {
  resolveSurfSessionRuntime,
  SURF_SESSION_COMMAND_TIMEOUT_MS,
  SURF_SESSION_READY_TIMEOUT_MS,
  SurfSession,
  settleSurfAttempt,
} from "./core/surf-session.js";
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
import type { TestCapabilitiesConfig } from "./core/config.js";
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
