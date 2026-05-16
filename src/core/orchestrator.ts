/**
 * TEST-CAPABILITIES Core Orchestrator
 * The brain that coordinates all testing agents
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { z } from "zod";
import { QuantumTestRunner } from "../quantum/simulator.js";
import { runBombadil } from "./bombadil-runtime.js";
import { validateCapabilityContract } from "./capabilities.js";
import { executeSurfExploreOperation } from "./operations/surf-explore-operation.js";

// ============================================
// TYPES & SCHEMAS
// ============================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withAliases(
  value: unknown,
  aliases: Record<string, string>,
): Record<string, unknown> | unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = { ...value };

  for (const [fromKey, toKey] of Object.entries(aliases)) {
    if (fromKey in normalized && !(toKey in normalized)) {
      normalized[toKey] = normalized[fromKey];
    }
    if (fromKey !== toKey && fromKey in normalized) {
      delete normalized[fromKey];
    }
  }

  return normalized;
}

export const TargetSchema = z
  .object({
    web: z.string().url().optional(),
    api: z.string().url().optional(),
    cli: z.string().optional(),
  })
  .strict();

const BombadilOptionsSchema = z.preprocess(
  (value) =>
    withAliases(value, {
      output_path: "outputPath",
      reproduce_trace: "reproduceTrace",
      instrument_javascript: "instrumentJavaScript",
      chrome_grant_permissions: "chromeGrantPermissions",
      device_scale_factor: "deviceScaleFactor",
      remote_debugger: "remoteDebugger",
      create_target: "createTarget",
    }),
  z
    .object({
      command: z.enum(["test", "test-external"]).default("test"),
      outputPath: z.string().min(1).optional(),
      headers: z.record(z.string().min(1), z.string()).optional(),
      reproduceTrace: z.string().min(1).optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      deviceScaleFactor: z.number().positive().optional(),
      instrumentJavaScript: z.array(z.enum(["files", "inline"])).optional(),
      chromeGrantPermissions: z.array(z.string().min(1)).optional(),
      headless: z.boolean().optional(),
      noSandbox: z.boolean().optional(),
      remoteDebugger: z.string().url().optional(),
      createTarget: z.boolean().optional(),
    })
    .strict(),
);

export const AgentConfigSchema = z
  .object({
    type: z.enum(["bombadil", "surf", "api-fuzzer", "cli-tester"]),
    enabled: z.boolean().default(true),
    intensity: z.enum(["gentle", "normal", "aggressive"]).default("normal"),
    duration: z.string().optional(),
    focus: z.array(z.string()).optional(),
    bombadil: BombadilOptionsSchema.optional(),
  })
  .strict();

const PropagationEdgeSchema = z
  .object({
    upstream: z.string().min(1),
    downstream: z.string().min(1),
  })
  .strict()
  .refine((edge) => edge.upstream !== edge.downstream, {
    message: "Propagation topology edges must connect distinct upstream and downstream components.",
    path: ["downstream"],
  });

const PropagationTopologySchema = z.preprocess(
  (value) => withAliases(value, { include_defaults: "includeDefaults" }),
  z
    .object({
      edges: z.array(PropagationEdgeSchema).default([]),
      includeDefaults: z.boolean().default(true),
    })
    .strict(),
);

const IntelligenceSchema = z.preprocess(
  (value) =>
    withAliases(value, {
      self_healing: "selfHealing",
      propagation_topology: "propagationTopology",
    }),
  z
    .object({
      selfHealing: z.boolean().default(false),
      prediction: z.boolean().default(false),
      correlation: z.boolean().default(true),
      collective: z.boolean().default(false),
      propagationTopology: PropagationTopologySchema.optional(),
    })
    .strict(),
);

const QuantumSchema = z.preprocess(
  (value) =>
    withAliases(value, {
      collapse_strategy: "collapseStrategy",
      max_depth: "maxDepth",
    }),
  z
    .object({
      enabled: z.boolean().default(false),
      branches: z.number().int().positive().default(100),
      collapseStrategy: z.enum(["significance", "diversity", "coverage"]).default("significance"),
      maxDepth: z.number().int().positive().default(20),
      timeout: z.union([z.number().positive(), z.string().min(1)]).optional(),
    })
    .strict(),
);

const ChaosSchema = z
  .object({
    enabled: z.boolean().default(false),
    experiments: z.array(z.unknown()).optional(),
  })
  .strict();

export const TestCapabilitiesConfigSchema = z
  .object({
    version: z.literal("2.0"),
    name: z.string(),
    targets: TargetSchema,
    agents: z.record(z.string(), AgentConfigSchema).optional(),
    intelligence: IntelligenceSchema.optional(),
    quantum: QuantumSchema.optional(),
    chaos: ChaosSchema.optional(),
  })
  .strict();

type ParsedTestCapabilitiesConfig = z.output<typeof TestCapabilitiesConfigSchema>;

export type Target = z.infer<typeof TargetSchema>;
export interface BombadilOptions {
  command?: "test" | "test-external";
  outputPath?: string;
  headers?: Record<string, string>;
  reproduceTrace?: string;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  instrumentJavaScript?: Array<"files" | "inline">;
  chromeGrantPermissions?: string[];
  headless?: boolean;
  noSandbox?: boolean;
  remoteDebugger?: string;
  createTarget?: boolean;
}

export interface AgentConfig {
  type: "bombadil" | "surf" | "api-fuzzer" | "cli-tester";
  enabled?: boolean;
  intensity?: "gentle" | "normal" | "aggressive";
  duration?: string;
  focus?: string[];
  bombadil?: BombadilOptions;
}
export interface PropagationEdge {
  upstream: string;
  downstream: string;
}
export interface PropagationTopology {
  edges?: PropagationEdge[];
  includeDefaults?: boolean;
}
export interface IntelligenceConfig {
  selfHealing?: boolean;
  prediction?: boolean;
  correlation?: boolean;
  collective?: boolean;
  propagationTopology?: PropagationTopology;
}
export interface TestCapabilitiesConfig {
  version: "2.0";
  name: string;
  targets: Target;
  agents?: Record<string, AgentConfig>;
  intelligence?: IntelligenceConfig;
  quantum?: {
    enabled?: boolean;
    branches?: number;
    collapseStrategy?: "significance" | "diversity" | "coverage";
    maxDepth?: number;
    timeout?: number | string;
  };
  chaos?: {
    enabled?: boolean;
    experiments?: unknown[];
  };
}

export interface Finding {
  id: string;
  type: FindingType;
  severity: Severity;
  component: string;
  description: string;
  evidence: string[];
  recommendation: string;
  timestamp: Date;
}

export type ObservationProtocol = "observation.v1";
export type ObservationKind =
  | "runtime"
  | "coverage"
  | "property"
  | "smoke"
  | "correlation"
  | "synthesis"
  | "root_cause"
  | "propagation";
export type ObservationStatus = "passed" | "failed" | "skipped" | "errored";
export type ObservationCalibrationLevel = "low" | "medium" | "high";
export const ROOT_CAUSE_FAILURE_CLASSES = [
  "auth_or_permission",
  "browser_coverage_gap",
  "command_resolution",
  "component_failure_surface",
  "configuration_error",
  "contract_mismatch",
  "network_connectivity",
  "property_violation",
  "resource_exhaustion",
  "selector_or_dom_drift",
  "timeout_or_latency",
] as const;
export type RootCauseFailureClass = (typeof ROOT_CAUSE_FAILURE_CLASSES)[number];

export interface ObservationCalibration {
  level: ObservationCalibrationLevel;
  signalCount: number;
  sensorCount: number;
  findingCount: number;
  basis: string[];
}

export interface ObservationSemantics {
  component: string;
  interpretation: string;
  nextStep?: string;
  calibration?: ObservationCalibration;
  failureClass?: RootCauseFailureClass;
  propagationLink?: string;
}

export interface Observation {
  protocol: ObservationProtocol;
  id: string;
  agent: string;
  kind: ObservationKind;
  status: ObservationStatus;
  subject: string;
  summary: string;
  evidence: string[];
  coverage?: Partial<CoverageReport>;
  semantics?: ObservationSemantics;
  findingIds: string[];
  timestamp: Date;
}

export type FindingType =
  | "bug"
  | "performance"
  | "security"
  | "accessibility"
  | "ux"
  | "api_contract"
  | "race_condition"
  | "memory_leak"
  | "visual_regression";

export type Severity = "low" | "medium" | "high" | "critical";

export interface TestResult {
  passed: boolean;
  duration: number;
  findings: Finding[];
  coverage: CoverageReport;
  observations?: Observation[];
  predictions?: Prediction[];
  quantumInsights?: QuantumInsights;
}

export type CoverageDimension = "userFlows" | "apiEndpoints" | "edgeCases";
export type CoverageStatus = "verified" | "partial" | "unmeasured";

export interface CoverageReport {
  userFlows: number;
  apiEndpoints: number;
  edgeCases: number;
  overall: number;
  measuredDimensions: CoverageDimension[];
  unmeasuredDimensions: CoverageDimension[];
  status: CoverageStatus;
}

export interface Prediction {
  component: string;
  probability: number;
  trigger: string;
  preventiveAction: string;
  confidence: number;
  horizon: string;
}

export interface QuantumInsights {
  universesSimulated: number;
  uniquePaths: number;
  edgeCasesFound: EdgeCase[];
  rareBugs: RareBug[];
  collapseStrategy: string;
}

export interface EdgeCase {
  type: string;
  location: string;
  reproduction: string;
}

export interface RareBug {
  description: string;
  probability: string;
  impact: "low" | "medium" | "high" | "critical";
  reproduction?: string;
}

// ============================================
// ORCHESTRATOR CLASS
// ============================================

function parseDurationToMs(value: number | string | undefined, fallback: number): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  const match = normalized.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (!match) {
    throw new Error(`Unsupported duration format: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? "ms").toLowerCase();
  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60_000;
    default:
      return fallback;
  }
}

function appendCappedProcessOutput(current: string, chunk: string): string {
  if (current.length >= MAX_CLI_TESTER_OUTPUT_CHARS) {
    return current;
  }

  const remaining = MAX_CLI_TESTER_OUTPUT_CHARS - current.length;
  if (chunk.length <= remaining) {
    return current + chunk;
  }

  return `${current}${chunk.slice(0, remaining)}\n[output truncated after ${MAX_CLI_TESTER_OUTPUT_CHARS} characters]`;
}

function parseCommandLine(commandLine: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of commandLine) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(`Unterminated quote in command: ${commandLine}`);
  }

  if (escaping) {
    current += "\\";
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  const [command, ...args] = tokens;
  if (!command) {
    throw new Error("CLI target command is empty.");
  }

  return { command, args };
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function getHighestSeverity(findings: Finding[]): Severity {
  return findings.reduce<Severity>(
    (highest, finding) =>
      SEVERITY_WEIGHT[finding.severity] > SEVERITY_WEIGHT[highest] ? finding.severity : highest,
    "low",
  );
}

const DEFAULT_CLI_TESTER_TIMEOUT_MS = 10_000;
const MAX_CLI_TESTER_OUTPUT_CHARS = 64_000;
const DEFAULT_BOMBADIL_DURATION_MS: Record<NonNullable<AgentConfig["intensity"]>, number> = {
  gentle: 5_000,
  normal: 10_000,
  aggressive: 20_000,
};

function getBombadilBudgetMs(intensity: AgentConfig["intensity"] | undefined): number {
  return DEFAULT_BOMBADIL_DURATION_MS[intensity ?? "normal"];
}

export class TestCapabilitiesOrchestrator {
  private config: ParsedTestCapabilitiesConfig;
  private agents: Map<string, TestAgent> = new Map();
  private predictions: Prediction[] = [];

  constructor(config: TestCapabilitiesConfig) {
    this.config = TestCapabilitiesConfigSchema.parse(config);
    validateCapabilityContract(this.config);
    this.initializeAgents();
  }

  private initializeAgents(): void {
    if (!this.config.agents) {
      return;
    }

    for (const [name, agentConfig] of Object.entries(this.config.agents)) {
      if (!agentConfig.enabled) {
        continue;
      }

      switch (agentConfig.type) {
        case "bombadil": {
          const durationMs = parseDurationToMs(
            agentConfig.duration,
            getBombadilBudgetMs(agentConfig.intensity),
          );
          this.agents.set(name, new BombadilAgent(name, durationMs, agentConfig.bombadil));
          break;
        }
        case "surf": {
          this.agents.set(name, new SurfAgent(name));
          break;
        }
        case "cli-tester": {
          const timeoutMs = parseDurationToMs(agentConfig.duration, DEFAULT_CLI_TESTER_TIMEOUT_MS);
          this.agents.set(name, new CliTesterAgent(name, timeoutMs));
          break;
        }
        default:
          throw new Error(
            `Agent '${name}' uses unsupported type '${agentConfig.type}'. Only 'bombadil', 'surf', and 'cli-tester' are currently backed by the orchestrator runtime.`,
          );
      }
    }
  }

  async run(): Promise<TestResult> {
    if (this.agents.size === 0) {
      throw new Error(
        "No enabled agents were initialized. Refine the config so at least one supported agent can run.",
      );
    }

    const startTime = Date.now();

    const agentResults = await Promise.all(
      Array.from(this.agents.entries()).map(async ([agentName, agent]) =>
        normalizeKnownAgentResult(
          agentName,
          agent,
          await agent.execute(this.config.targets),
          this.config.targets,
        ),
      ),
    );

    const agentObservations = agentResults.flatMap((result) => result.observations ?? []);
    const rawFindings = agentResults.flatMap((result) => result.findings);
    const correlationEnabled = this.config.intelligence?.correlation !== false;
    const correlatedFindings = correlationEnabled
      ? this.correlateFindings(rawFindings)
      : rawFindings;
    const rootCauseObservations = correlationEnabled
      ? this.synthesizeRootCauses(agentObservations, correlatedFindings)
      : [];
    const propagationObservations = correlationEnabled
      ? synthesizePropagationChains(
          rootCauseObservations,
          this.config.intelligence?.propagationTopology,
        )
      : [];
    const observations = ensureUniqueObservationIds(
      correlationEnabled
        ? [
            ...agentObservations,
            ...this.correlateObservations(agentObservations, correlatedFindings),
            ...rootCauseObservations,
            ...propagationObservations,
          ]
        : agentObservations,
    );

    if (this.config.intelligence?.prediction) {
      this.predictions = await this.runPrediction(correlatedFindings);
    }

    let quantumInsights: QuantumInsights | undefined;
    if (this.config.quantum?.enabled) {
      quantumInsights = await this.runQuantumSimulation();
    }

    const duration = Date.now() - startTime;
    const coverage = this.calculateCoverage(agentResults);
    const blockingFindings = correlatedFindings.some(
      (finding) => finding.severity === "high" || finding.severity === "critical",
    );

    return {
      passed: !blockingFindings && coverage.overall > 0,
      duration,
      findings: correlatedFindings,
      coverage,
      observations,
      predictions: this.predictions,
      quantumInsights,
    };
  }

  private correlateFindings(findings: Finding[]): Finding[] {
    const correlations: Finding[] = [];
    const byComponent = new Map<string, Finding[]>();

    for (const finding of findings) {
      const existing = byComponent.get(finding.component) || [];
      existing.push(finding);
      byComponent.set(finding.component, existing);
    }

    for (const [component, componentFindings] of byComponent) {
      if (componentFindings.length <= 1) {
        continue;
      }

      const apiFinding = componentFindings.find((finding) => finding.type === "api_contract");
      const uiFinding = componentFindings.find((finding) => finding.type === "bug");

      if (apiFinding && uiFinding) {
        correlations.push({
          id: `corr-${component}`,
          type: "bug",
          severity: "high",
          component,
          description: "Cross-domain issue: API validation differs from UI handling",
          evidence: [apiFinding.description, uiFinding.description],
          recommendation: `Align API and UI validation for ${component}`,
          timestamp: new Date(),
        });
        continue;
      }

      const distinctDescriptions = [
        ...new Set(componentFindings.map((finding) => finding.description)),
      ];
      correlations.push({
        id: `corr-${component}`,
        type: "bug",
        severity: getHighestSeverity(componentFindings),
        component,
        description: `Correlated findings indicate a systemic issue in ${component}`,
        evidence: distinctDescriptions,
        recommendation: `Investigate ${component} as one systemic failure surface instead of isolated finding(s).`,
        timestamp: new Date(),
      });
    }

    return [...findings, ...correlations];
  }

  private correlateObservations(observations: Observation[], findings: Finding[]): Observation[] {
    if (observations.length === 0 || (observations.length === 1 && findings.length === 0)) {
      return [];
    }

    const correlated: Observation[] = [];
    const byComponent = new Map<string, Observation[]>();
    for (const observation of observations) {
      const component = observation.semantics?.component ?? observation.subject;
      byComponent.set(component, [...(byComponent.get(component) ?? []), observation]);
    }

    for (const [component, componentObservations] of byComponent) {
      const componentFindings = findings.filter((finding) => finding.component === component);
      if (componentObservations.length <= 1 && componentFindings.length === 0) {
        continue;
      }

      const status = worstObservationOrFindingStatus(componentObservations, componentFindings);
      const nonPassing = componentObservations.filter(
        (observation) => observation.status !== "passed",
      );
      const kinds = observationKinds(componentObservations);
      const hasFindings = componentFindings.length > 0;
      correlated.push(
        makeObservation({
          agent: "orchestrator",
          kind: "synthesis",
          status,
          subject: component,
          summary:
            nonPassing.length === 0 && !hasFindings
              ? `Semantic synthesis: ${component} passed across ${kinds.join(", ")} observations.`
              : `Semantic synthesis: ${component} has ${nonPassing.length}/${componentObservations.length} non-passing observation(s) and ${componentFindings.length} finding(s) across ${kinds.join(", ")} observations.`,
          evidence: observationAndFindingEvidence(componentObservations, componentFindings),
          semantics: {
            component,
            interpretation:
              nonPassing.length === 0 && !hasFindings
                ? `${component} has a consistent pass signal across the supported sensors that measured it.`
                : `${component} has a cross-sensor degradation or finding signal; inspect linked findings before treating isolated output as the whole story.`,
            nextStep:
              nonPassing.length === 0 && !hasFindings
                ? "Keep this as a measured baseline and widen sensors only with new evidence."
                : "Triage the linked findings and rerun the same sensor set after repair.",
          },
          findingIds: findingIdsForComponent(componentObservations, findings, component),
        }),
      );
    }

    const worstStatus = worstObservationOrFindingStatus(observations, findings);
    const nonPassing = observations.filter((observation) => observation.status !== "passed");
    const hasFindings = findings.length > 0;
    const kinds = observationKinds(observations);
    correlated.push(
      makeObservation({
        agent: "orchestrator",
        kind: "correlation",
        status: worstStatus,
        subject: "test-capabilities suite",
        summary:
          nonPassing.length === 0 && !hasFindings
            ? `Observation correlation: ${observations.length} supported sensor observation(s) passed across ${kinds.join(", ")}.`
            : `Observation correlation: ${nonPassing.length}/${observations.length} supported sensor observation(s) did not pass and ${findings.length} finding(s) were present across ${kinds.join(", ")}.`,
        evidence: observationAndFindingEvidence(observations, findings),
        semantics: {
          component: "suite",
          interpretation:
            nonPassing.length === 0 && !hasFindings
              ? "All supported sensors that ran produced pass observations."
              : "At least one supported sensor or finding produced a non-passing signal; suite health is degraded by evidence, not by observation synthesis alone.",
          nextStep:
            nonPassing.length === 0 && !hasFindings
              ? "Use the observation set as a baseline for the next capability frontier."
              : "Use findings and per-sensor evidence as the authority for repair prioritization.",
        },
        findingIds: uniqueFindingIds(observations, findings),
      }),
    );

    return correlated;
  }

  private synthesizeRootCauses(observations: Observation[], findings: Finding[]): Observation[] {
    if (observations.length === 0) {
      return [];
    }

    const rootCauses: Observation[] = [];
    const components = new Set<string>([
      ...observations.map((observation) => observation.semantics?.component ?? observation.subject),
      ...findings.map((finding) => finding.component),
    ]);

    for (const component of [...components].sort()) {
      const componentObservations = observations.filter(
        (observation) => (observation.semantics?.component ?? observation.subject) === component,
      );
      const componentFindings = findings.filter((finding) => finding.component === component);
      const primaryFindings = componentFindings.filter(
        (finding) => !finding.id.startsWith("corr-"),
      );
      const calibrationFindings = primaryFindings.length > 0 ? primaryFindings : componentFindings;
      const rootCauseSignals = componentObservations.filter(isRootCauseSignalObservation);
      const candidateEvidenceUnits = rootCauseEvidenceUnits(
        componentObservations,
        calibrationFindings,
        rootCauseSignals,
      );
      const candidateFailureClasses = new Set(
        candidateEvidenceUnits.map((unit) => unit.failureClass),
      );

      if (candidateFailureClasses.size > 1) {
        continue;
      }

      const evidenceUnits = strongestAgreedRootCauseUnits(candidateEvidenceUnits);
      const selectedObservationIds = new Set(evidenceUnits.map((unit) => unit.observationId));
      const selectedFindingIds = new Set(
        evidenceUnits.flatMap((unit) => (unit.findingId ? [unit.findingId] : [])),
      );
      const selectedFailureClass = evidenceUnits[0]?.failureClass;
      const unselectedFindings = calibrationFindings.filter(
        (finding) => !selectedFindingIds.has(finding.id),
      );

      if (
        selectedFailureClass &&
        unselectedFindings.some(
          (finding) => inferRootCauseClass([], [finding]) !== selectedFailureClass,
        )
      ) {
        continue;
      }

      const selectedObservations = componentObservations.filter((observation) =>
        selectedObservationIds.has(observation.id),
      );
      const selectedFindings = calibrationFindings.filter((finding) =>
        selectedFindingIds.has(finding.id),
      );
      const selectedRootCauseSignals = selectedObservations.filter(isRootCauseSignalObservation);

      const calibration = calibrateRootCause(
        selectedObservations,
        selectedFindings,
        selectedRootCauseSignals,
        evidenceUnits,
      );

      if (calibration.level !== "high") {
        continue;
      }

      const failureClass =
        evidenceUnits[0]?.failureClass ??
        inferRootCauseClass(selectedObservations, selectedFindings);
      const status = worstObservationOrFindingStatus(selectedObservations, selectedFindings);
      const sensorLabel = calibration.sensorCount === 1 ? "sensor" : "sensors";
      const findingLabel = calibration.findingCount === 1 ? "finding" : "findings";

      rootCauses.push(
        makeObservation({
          agent: "orchestrator",
          kind: "root_cause",
          status,
          subject: component,
          summary: `Root-cause synthesis: ${component} has ${calibration.level} evidence support for ${failureClass} as the current failure surface (${calibration.signalCount} signal(s), ${calibration.sensorCount} ${sensorLabel}, ${calibration.findingCount} ${findingLabel}).`,
          evidence: rootCauseEvidence(
            failureClass,
            calibration,
            selectedObservations,
            selectedFindings,
          ),
          semantics: {
            component,
            interpretation: `Evidence-bounded root-cause synthesis identifies ${failureClass} as the current ${component} failure class with ${calibration.level} support from the observed run. No later-time claim is made.`,
            nextStep: `Inspect ${component} evidence for ${failureClass}, repair the smallest confirmed cause, then rerun the same sensor set for calibration comparison.`,
            calibration,
            failureClass,
          },
          findingIds: [...selectedFindingIds],
        }),
      );
    }

    return rootCauses;
  }

  private async runPrediction(findings: Finding[]): Promise<Prediction[]> {
    const probabilityBySeverity: Record<Severity, number> = {
      critical: 0.92,
      high: 0.75,
      medium: 0.45,
      low: 0.2,
    };
    const confidenceBySeverity: Record<Severity, number> = {
      critical: 0.9,
      high: 0.8,
      medium: 0.7,
      low: 0.6,
    };
    const horizonBySeverity: Record<Severity, string> = {
      critical: "< 1 hour",
      high: "24h",
      medium: "1-7 days",
      low: "1-7 days",
    };

    return findings
      .filter((finding) => finding.severity === "high" || finding.severity === "critical")
      .map((finding) => ({
        component: finding.component,
        probability: probabilityBySeverity[finding.severity],
        trigger: `Based on finding: ${finding.type}`,
        preventiveAction: finding.recommendation,
        confidence: confidenceBySeverity[finding.severity],
        horizon: horizonBySeverity[finding.severity],
      }));
  }

  private async runQuantumSimulation(): Promise<QuantumInsights> {
    if (!this.config.targets.web) {
      throw new Error("Quantum simulation requires targets.web.");
    }

    const branches = this.config.quantum?.branches ?? 100;
    const collapseStrategy = this.config.quantum?.collapseStrategy ?? "significance";
    const maxDepth = this.config.quantum?.maxDepth ?? 20;
    const timeout = parseDurationToMs(this.config.quantum?.timeout, 60_000);

    const runner = new QuantumTestRunner({
      branches,
      collapseStrategy,
      maxDepth,
      timeout,
      seed: 42,
    });
    const result = await runner.run(this.config.targets.web);

    return {
      universesSimulated: result.branchesSimulated,
      uniquePaths: result.uniquePaths,
      edgeCasesFound: result.edgeCases.map((edgeCase) => ({
        type: edgeCase.type,
        location: edgeCase.evidence[0] ?? this.config.targets.web ?? "unknown",
        reproduction: edgeCase.reproduction
          .map((step) => `${step.type}:${step.target}`)
          .join(" > "),
      })),
      rareBugs: result.rareBugs.map((bug) => ({
        description: bug.description,
        probability: bug.probability.toFixed(6),
        impact: bug.severity,
        reproduction: bug.reproduction.map((step) => `${step.type}:${step.target}`).join(" > "),
      })),
      collapseStrategy,
    };
  }

  private calculateCoverage(results: AgentResult[]): CoverageReport {
    const collect = (selector: (result: AgentResult) => number | undefined): number[] =>
      results
        .map(selector)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    const average = (values: number[]): number => {
      if (values.length === 0) {
        return 0;
      }

      const sum = values.reduce((total, value) => total + value, 0);
      return Math.round(sum / values.length);
    };

    const dimensionValues = {
      userFlows: collect((result) => result.coverage.userFlows),
      apiEndpoints: collect((result) => result.coverage.apiEndpoints),
      edgeCases: collect((result) => result.coverage.edgeCases),
    } as const satisfies Record<CoverageDimension, number[]>;

    const userFlows = average(dimensionValues.userFlows);
    const apiEndpoints = average(dimensionValues.apiEndpoints);
    const edgeCases = average(dimensionValues.edgeCases);
    const measuredDimensions = Object.entries(dimensionValues)
      .filter(([, values]) => values.length > 0)
      .map(([dimension]) => dimension as CoverageDimension);
    const unmeasuredDimensions = (Object.keys(dimensionValues) as CoverageDimension[]).filter(
      (dimension) => !measuredDimensions.includes(dimension),
    );
    const coverageByDimension: Record<CoverageDimension, number> = {
      userFlows,
      apiEndpoints,
      edgeCases,
    };
    const overall = average(measuredDimensions.map((dimension) => coverageByDimension[dimension]));
    const status: CoverageStatus =
      measuredDimensions.length === 0
        ? "unmeasured"
        : unmeasuredDimensions.length > 0
          ? "partial"
          : "verified";

    return {
      userFlows,
      apiEndpoints,
      edgeCases,
      overall,
      measuredDimensions,
      unmeasuredDimensions,
      status,
    };
  }
}

// ============================================
// AGENT INTERFACES
// ============================================

interface AgentResult {
  findings: Finding[];
  coverage: Partial<CoverageReport>;
  observations?: Observation[];
}

interface TestAgent {
  execute(targets: Target): Promise<AgentResult>;
}

type ObservationInput = Omit<Observation, "protocol" | "id" | "timestamp">;

function observationSlug(value: string): string {
  return (
    value
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "unknown"
  );
}

function observationId(
  agent: string,
  kind: ObservationKind,
  status: ObservationStatus,
  subject: string,
): string {
  return `${observationSlug(agent)}-${kind}-${observationSlug(subject)}-${status}`;
}

function makeObservation(input: ObservationInput): Observation {
  return {
    protocol: "observation.v1",
    id: observationId(input.agent, input.kind, input.status, input.subject),
    timestamp: new Date(),
    ...input,
  };
}

function findingEvidence(findings: Finding[]): string[] {
  return findings
    .flatMap((finding) => finding.evidence)
    .filter(Boolean)
    .slice(0, 6);
}

function statusFromFindings(findings: Finding[]): ObservationStatus {
  return findings.some((finding) => finding.severity === "critical") ? "errored" : "failed";
}

const OBSERVATION_STATUS_WEIGHT: Record<ObservationStatus, number> = {
  passed: 1,
  skipped: 2,
  failed: 3,
  errored: 4,
};

function worstObservationStatus(observations: Observation[]): ObservationStatus {
  return observations.reduce<ObservationStatus>(
    (worst, observation) =>
      OBSERVATION_STATUS_WEIGHT[observation.status] > OBSERVATION_STATUS_WEIGHT[worst]
        ? observation.status
        : worst,
    "passed",
  );
}

function observationKinds(observations: Observation[]): ObservationKind[] {
  return [...new Set(observations.map((observation) => observation.kind))].sort();
}

function worstObservationOrFindingStatus(
  observations: Observation[],
  findings: Finding[],
): ObservationStatus {
  const observationStatus = worstObservationStatus(observations);
  if (findings.length === 0) {
    return observationStatus;
  }

  const findingStatus = statusFromFindings(findings);
  return OBSERVATION_STATUS_WEIGHT[findingStatus] > OBSERVATION_STATUS_WEIGHT[observationStatus]
    ? findingStatus
    : observationStatus;
}

function findingObservationEvidence(findings: Finding[]): string[] {
  return findings.map(
    (finding) => `finding:${finding.severity}:${finding.id} — ${finding.description}`,
  );
}

function observationAndFindingEvidence(observations: Observation[], findings: Finding[]): string[] {
  const findingEvidence = findingObservationEvidence(findings);
  if (findingEvidence.length === 0) {
    return observationEvidence(observations).slice(0, 8);
  }

  const observationLimit = Math.max(0, 8 - Math.min(findingEvidence.length, 8));
  const observedEvidence = observationEvidence(observations).slice(0, observationLimit);
  return [...observedEvidence, ...findingEvidence.slice(0, 8 - observedEvidence.length)];
}

function rootCauseCorpus(observations: Observation[], findings: Finding[]): string {
  return [
    ...observations.flatMap((observation) => [
      observation.kind,
      observation.status,
      observation.summary,
      observation.semantics?.interpretation ?? "",
      ...observation.evidence,
    ]),
    ...findings.flatMap((finding) => [
      finding.type,
      finding.severity,
      finding.description,
      ...finding.evidence,
    ]),
  ]
    .join("\n")
    .toLowerCase();
}

function inferRootCauseClass(
  observations: Observation[],
  findings: Finding[],
): RootCauseFailureClass {
  const corpus = rootCauseCorpus(observations, findings);
  const hasCliContext =
    observations.some(
      (observation) => observation.subject === "cli" || observation.semantics?.component === "cli",
    ) || findings.some((finding) => finding.component === "cli");
  const hasApiContext =
    observations.some(
      (observation) => observation.subject === "api" || observation.semantics?.component === "api",
    ) || findings.some((finding) => finding.component === "api" || finding.type === "api_contract");
  const hasWebContext =
    observations.some(
      (observation) => observation.subject === "web" || observation.semantics?.component === "web",
    ) || findings.some((finding) => finding.component === "web");

  const hasApiContractEvidence =
    (hasApiContext || findings.some((finding) => finding.type === "api_contract")) &&
    /api[_ -]?contract|contract|openapi|schema[^\n]*(mismatch|drift|contract|validation)|schema[ -]?validation|contract[ -]?validation|response[^\n]*(body|payload|field|element|property)|payload[^\n]*(field|element|property|missing|required)|required[^\n]*(field|property|element)/.test(
      corpus,
    );
  if (findings.some((finding) => finding.type === "api_contract") || hasApiContractEvidence) {
    return "contract_mismatch";
  }

  const hasCliCommandResolutionEvidence =
    hasCliContext &&
    (/\bspawn\s+[^\n]+\s+enoent\b/.test(corpus) ||
      /command not found|executable[^\n]*not found|binary[^\n]*not found/.test(corpus) ||
      /(^|\n)(sh: \d+: [^\s:]+|[./\w-]+): not found(\n|$)/.test(corpus));
  if (hasCliCommandResolutionEvidence) {
    return "command_resolution";
  }

  const hasConfigurationErrorEvidence =
    /missing (?:required )?(?:env|environment variable|config(?:uration)? file|config(?:uration)? value)|(?:env|environment variable) [a-z0-9_]+ (?:is )?(?:missing|required|not set)|required (?:env|environment variable|config(?:uration)? value) [a-z0-9_]+|\bconfig(?:uration)?\b[^\n]*(?:enoent|no such file|not found)|enoent[^\n]*(?:\.env\b|\.toml\b|\.ini\b|\.conf\b|\.ya?ml\b|\.json\b|\bconfig(?:uration)?\b)|failed to load config(?:uration)?|invalid config(?:uration)? value|yaml parse error|json parse error|config(?:uration)? parse error/.test(
      corpus,
    );
  if (hasConfigurationErrorEvidence) {
    return "configuration_error";
  }

  const hasResourceExhaustionEvidence =
    /out of memory|heap out of memory|oomkilled|heap oom|\boom\b|enospc|emfile|too many open files|disk full|no space left|connection pool (?:exhausted|depleted)|pool exhausted|resource exhausted|quota exceeded|rate limit|throttl|\b(?:http\s*)?429\b|too many requests/.test(
      corpus,
    );
  if (hasResourceExhaustionEvidence) {
    return "resource_exhaustion";
  }

  const hasNetworkConnectivityEvidence =
    (hasApiContext || hasWebContext) &&
    /\b(?:econnrefused|econnreset|enetunreach|ehostunreach|enotfound|eai_again)\b|\bdns\b[^\n]*(?:resolution|lookup|failure|failed|error|timeout|timed out)|(?:resolution|lookup|failure|failed|error|timeout|timed out)[^\n]*\bdns\b|connection refused|connection reset|network unreachable|host unreachable|name resolution|could not resolve host|tls handshake|certificate (?:verify|validation|expired|error)|net::err_(?:connection_refused|name_not_resolved|internet_disconnected|cert_)/.test(
      corpus,
    );
  if (hasNetworkConnectivityEvidence) {
    return "network_connectivity";
  }

  if (/timeout|timed out|latency|duration|slow|sigterm|sigkill/.test(corpus)) {
    return "timeout_or_latency";
  }

  if (
    hasCliContext &&
    (/enoent|spawn|command not found|executable[^\n]*not found|binary[^\n]*not found|no such file/.test(
      corpus,
    ) ||
      /(^|\n)(sh: \d+: [^\s:]+|[./\w-]+): not found(\n|$)/.test(corpus))
  ) {
    return "command_resolution";
  }

  const hasAuthBoundaryEvidence =
    (hasApiContext || hasWebContext) &&
    /\b(?:http\s*)?(?:401|403)\b|unauthori[sz]ed|forbidden|permission denied|access denied|authentication required|not authenticated|invalid (?:token|credentials)|expired (?:token|session)|missing (?:authorization|auth) header/.test(
      corpus,
    );
  if (hasAuthBoundaryEvidence) {
    return "auth_or_permission";
  }

  const hasPropertyEvidence =
    observations.some(
      (observation) =>
        /bombadil/i.test(observation.agent) ||
        (observation.kind === "property" &&
          observation.subject !== "api" &&
          observation.semantics?.component !== "api"),
    ) || /bombadil|invariant/.test(corpus);
  if (hasPropertyEvidence) {
    return "property_violation";
  }

  const hasSelectorOrDomDrift =
    /selector|locator|data-testid|xpath|css selector|stale element|dom[^\n]*drift|markup (drift|changed)/.test(
      corpus,
    );
  const hasBrowserCoverageGap = /surf|browser|coverage|user-flow|browser-state|navigation/.test(
    corpus,
  );

  if (hasBrowserCoverageGap && !hasSelectorOrDomDrift) {
    return "browser_coverage_gap";
  }
  if (hasSelectorOrDomDrift) {
    return "selector_or_dom_drift";
  }
  if (hasBrowserCoverageGap) {
    return "browser_coverage_gap";
  }

  return "component_failure_surface";
}

interface RootCauseEvidenceUnit {
  id: string;
  source: "finding" | "observation";
  failureClass: RootCauseFailureClass;
  observationId: string;
  findingId?: string;
  agent?: string;
}

function isRootCauseSignalObservation(observation: Observation): boolean {
  return observation.status === "failed" || observation.status === "errored";
}

function rootCauseEvidenceUnits(
  observations: Observation[],
  findings: Finding[],
  rootCauseSignals: Observation[],
): RootCauseEvidenceUnit[] {
  const units = new Map<string, RootCauseEvidenceUnit>();
  const findingIds = new Set(findings.map((finding) => finding.id));

  for (const finding of findings) {
    const linkedObservations = observations.filter(
      (observation) =>
        isRootCauseSignalObservation(observation) && observation.findingIds.includes(finding.id),
    );

    for (const linkedObservation of linkedObservations) {
      const findingFailureClass = inferRootCauseClass([linkedObservation], [finding]);
      const observationFailureClass = inferRootCauseClass([linkedObservation], []);
      units.set(`finding:${finding.id}:observation:${linkedObservation.id}`, {
        id: `finding:${finding.id}:observation:${linkedObservation.id}`,
        source: "finding",
        failureClass: findingFailureClass,
        observationId: linkedObservation.id,
        findingId: finding.id,
        agent: linkedObservation.agent,
      });

      if (observationFailureClass !== findingFailureClass) {
        units.set(`observation-conflict:${linkedObservation.id}`, {
          id: `observation-conflict:${linkedObservation.id}`,
          source: "observation",
          failureClass: observationFailureClass,
          observationId: linkedObservation.id,
          agent: linkedObservation.agent,
        });
      }
    }
  }

  for (const observation of rootCauseSignals) {
    const derivedFromFinding = observation.findingIds.some((findingId) =>
      findingIds.has(findingId),
    );
    if (derivedFromFinding) {
      continue;
    }

    units.set(`observation:${observation.id}`, {
      id: `observation:${observation.id}`,
      source: "observation",
      failureClass: inferRootCauseClass([observation], []),
      observationId: observation.id,
      agent: observation.agent,
    });
  }

  return [...units.values()];
}

function strongestAgreedRootCauseUnits(
  evidenceUnits: RootCauseEvidenceUnit[],
): RootCauseEvidenceUnit[] {
  const byFailureClass = new Map<RootCauseFailureClass, RootCauseEvidenceUnit[]>();

  for (const unit of evidenceUnits) {
    byFailureClass.set(unit.failureClass, [...(byFailureClass.get(unit.failureClass) ?? []), unit]);
  }

  return (
    [...byFailureClass.entries()]
      .map(([failureClass, units]) => ({
        failureClass,
        units,
        sensorCount: new Set(
          units.map((unit) => unit.agent).filter((agent): agent is string => agent !== undefined),
        ).size,
      }))
      .filter((entry) => entry.units.length >= 2 && entry.sensorCount >= 2)
      .sort(
        (left, right) =>
          right.sensorCount - left.sensorCount ||
          right.units.length - left.units.length ||
          left.failureClass.localeCompare(right.failureClass),
      )[0]?.units ?? []
  );
}

function calibrateRootCause(
  observations: Observation[],
  findings: Finding[],
  rootCauseSignals: Observation[],
  evidenceUnits: RootCauseEvidenceUnit[],
): ObservationCalibration {
  const sensorCount = new Set(
    evidenceUnits.map((unit) => unit.agent).filter((agent): agent is string => agent !== undefined),
  ).size;
  const signalCount = evidenceUnits.length;
  const highSeverityFindingCount = findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "critical",
  ).length;
  const findingTypes = new Set(findings.map((finding) => finding.type));
  const observationKindsPresent = new Set(observations.map((observation) => observation.kind));
  const agreedFailureClasses = new Set(evidenceUnits.map((unit) => unit.failureClass));
  const basis = [
    `${signalCount} independent evidence unit(s)`,
    `${rootCauseSignals.length} failed-or-errored observation(s)`,
    `${findings.length} primary finding(s)`,
    `${sensorCount} sensor(s)`,
  ];

  if (agreedFailureClasses.size === 1) {
    basis.push(`${[...agreedFailureClasses][0]} failure-class agreement`);
  }

  if (highSeverityFindingCount > 0) {
    basis.push(`${highSeverityFindingCount} high-or-critical finding(s)`);
  }
  if (findingTypes.size > 1) {
    basis.push(`${findingTypes.size} finding type(s)`);
  }
  if (observationKindsPresent.size > 1) {
    basis.push(`${observationKindsPresent.size} observation kind(s)`);
  }

  const level: ObservationCalibrationLevel =
    signalCount >= 2 && sensorCount >= 2
      ? "high"
      : signalCount >= 2 ||
          (signalCount >= 1 && (findingTypes.size > 1 || observationKindsPresent.size > 1))
        ? "medium"
        : "low";

  return {
    level,
    signalCount,
    sensorCount,
    findingCount: findings.length,
    basis,
  };
}

function rootCauseEvidence(
  failureClass: string,
  calibration: ObservationCalibration,
  observations: Observation[],
  findings: Finding[],
): string[] {
  return [
    `failureClass:${failureClass}`,
    `calibration:${calibration.level} — ${calibration.basis.join("; ")}`,
    ...observationAndFindingEvidence(observations, findings),
  ].slice(0, 10);
}

// ============================================
// Propagation synthesis helpers
// ============================================

/**
 * Extract the failure class string from a root_cause observation's semantics.
 * Returns undefined if the observation is not a root_cause or has no interpretable class.
 */
function isRootCauseFailureClass(value: string | undefined): value is RootCauseFailureClass {
  return ROOT_CAUSE_FAILURE_CLASSES.includes(value as RootCauseFailureClass);
}

function getFailureClassFromRootCause(observation: Observation): RootCauseFailureClass | undefined {
  if (observation.kind !== "root_cause") {
    return undefined;
  }
  if (isRootCauseFailureClass(observation.semantics?.failureClass)) {
    return observation.semantics.failureClass;
  }
  const calibration = observation.semantics?.calibration;
  if (calibration) {
    // Backward-compatible fallback for older root_cause observations that only exposed evidence.
    for (const ev of observation.evidence) {
      const match = ev.match(/^failureClass:(.+)$/);
      if (isRootCauseFailureClass(match?.[1])) {
        return match[1];
      }
    }
  }
  // Fallback: extract from summary text.
  const summaryMatch = observation.summary.match(
    /has\s+\w+\s+evidence support for (\S+) as the current/,
  );
  return isRootCauseFailureClass(summaryMatch?.[1]) ? summaryMatch[1] : undefined;
}

/**
 * Known dependency topology: upstream failures can propagate downstream.
 * These are conventional architectural heuristics derived from common stack layouts.
 * They are non-authoritative and produce no output when both components lack
 * high-calibration root_cause observations.
 */
const DEFAULT_DEPENDENCY_EDGES: PropagationEdge[] = [
  { upstream: "api", downstream: "web" },
  { upstream: "cli", downstream: "api" },
  { upstream: "cli", downstream: "web" },
];

function resolvePropagationEdges(topology: PropagationTopology | undefined): PropagationEdge[] {
  const configuredEdges = topology?.edges ?? [];
  const edges = topology?.includeDefaults === false ? [] : [...DEFAULT_DEPENDENCY_EDGES];
  const seen = new Set(edges.map((edge) => `${edge.upstream}\u0000${edge.downstream}`));

  for (const edge of configuredEdges) {
    const key = `${edge.upstream}\u0000${edge.downstream}`;
    if (!seen.has(key)) {
      edges.push(edge);
      seen.add(key);
    }
  }

  return edges;
}

/**
 * Infer whether an upstream failure plausibly explains a downstream failure.
 * Returns a human-readable link description or undefined if no plausible link exists.
 *
 * Heuristic rules:
 * - api timeout_or_latency → web component_failure_surface: API latency is paired with UI runtime failures
 * - api contract_mismatch → web component_failure_surface: API schema drift breaks client rendering
 *   (not Surf/browser coverage gaps, which may be sensor evidence failures)
 * - cli command_resolution → api component_failure_surface: CLI tooling failure prevents API health checks
 * - Same timeout_or_latency across dependent components: suggests shared infrastructure latency
 */
function inferPropagationLink(
  upstream: string,
  upstreamClass: RootCauseFailureClass,
  downstream: string,
  downstreamClass: RootCauseFailureClass,
): string | undefined {
  // Shared-infra propagation is intentionally narrow: same generic or semantic failure classes
  // can co-occur without implying infrastructure coupling. Latency/timeout is the bounded
  // same-class signal this diagnostic layer currently treats as a plausible shared-infra link.
  if (upstreamClass === downstreamClass && upstreamClass === "timeout_or_latency") {
    return `shared-infra (${upstreamClass} on both)`;
  }

  // API→web propagation patterns
  if (upstream === "api" && downstream === "web") {
    if (upstreamClass === "timeout_or_latency" && downstreamClass === "component_failure_surface") {
      return "api-latency-cascade";
    }
    if (upstreamClass === "contract_mismatch" && downstreamClass === "component_failure_surface") {
      return "api-schema-drift-to-ui";
    }
  }

  // CLI→api propagation patterns
  if (upstream === "cli" && downstream === "api") {
    if (upstreamClass === "command_resolution" && downstreamClass === "component_failure_surface") {
      return "cli-tool-failure-blocks-api-check";
    }
  }

  // CLI→web propagation patterns
  if (upstream === "cli" && downstream === "web") {
    if (upstreamClass === "command_resolution" && downstreamClass === "component_failure_surface") {
      return "cli-tool-failure-blocks-web-check";
    }
  }

  return undefined;
}

/**
 * Synthesize propagation chains from existing root_cause observations.
 * Only emits when two dependent components both have high-calibration root_cause
 * and the upstream failure plausibly explains the downstream failure.
 *
 * This is non-authoritative heuristic reasoning — it does not constitute causal proof.
 */
function synthesizePropagationChains(
  rootCauseObservations: Observation[],
  topology?: PropagationTopology,
): Observation[] {
  if (rootCauseObservations.length < 2) {
    return [];
  }

  const propagations: Observation[] = [];

  // Build a map of component -> root_cause observation.
  // If multiple root_causes exist for one component, keep the first (highest calibration).
  const byComponent = new Map<string, Observation>();
  for (const obs of rootCauseObservations) {
    const component = obs.semantics?.component ?? obs.subject;
    if (!byComponent.has(component)) {
      byComponent.set(component, obs);
    }
  }

  for (const { upstream, downstream } of resolvePropagationEdges(topology)) {
    const upstreamObs = byComponent.get(upstream);
    const downstreamObs = byComponent.get(downstream);
    if (!upstreamObs || !downstreamObs) {
      continue;
    }

    const upstreamClass = getFailureClassFromRootCause(upstreamObs);
    const downstreamClass = getFailureClassFromRootCause(downstreamObs);
    if (!upstreamClass || !downstreamClass) {
      continue;
    }

    const link = inferPropagationLink(upstream, upstreamClass, downstream, downstreamClass);
    if (!link) {
      continue;
    }

    const upstreamFindingIds = upstreamObs.findingIds ?? [];
    const downstreamFindingIds = downstreamObs.findingIds ?? [];
    const allFindingIds = [...new Set([...upstreamFindingIds, ...downstreamFindingIds])];

    // Sum each root cause's supporting sensor count so propagation calibration reflects
    // the evidence on both sides of the heuristic link. The source root_cause observations
    // currently expose counts, not distinct agent IDs, so this is a supporting-sensor total
    // rather than a de-duplicated sensor identity set.
    const upstreamSensorCount = upstreamObs.semantics?.calibration?.sensorCount ?? 0;
    const downstreamSensorCount = downstreamObs.semantics?.calibration?.sensorCount ?? 0;
    const propagationSensorCount = upstreamSensorCount + downstreamSensorCount;
    const totalSignals = 2; // two root_cause observations form the chain
    const propagationCalibration: ObservationCalibration = {
      level: "low",
      signalCount: totalSignals,
      sensorCount: propagationSensorCount,
      findingCount: allFindingIds.length,
      basis: [
        `heuristic dependency topology (${upstream}-to-${downstream})`,
        `upstream failureClass:${upstreamClass}`,
        `downstream failureClass:${downstreamClass}`,
        `${upstreamSensorCount} upstream sensor(s)`,
        `${downstreamSensorCount} downstream sensor(s)`,
        `link:${link}`,
        `non-authoritative — verify independently`,
      ],
    };

    propagations.push(
      makeObservation({
        agent: "orchestrator",
        kind: "propagation",
        status: "failed",
        subject: `${upstream}-to-${downstream}`,
        summary: `Propagation synthesis: ${upstream} (${upstreamClass}) may be linked to ${downstream} (${downstreamClass}) via ${link}. Non-authoritative heuristic.`,
        evidence: [
          `upstream:${upstream}:${upstreamClass}`,
          `downstream:${downstream}:${downstreamClass}`,
          `link:${link}`,
          `calibration:${propagationCalibration.level} — ${propagationCalibration.basis.join("; ")}`,
          `non-authoritative heuristic — verify independently before acting on this chain.`,
        ],
        semantics: {
          component: `${upstream}-to-${downstream}`,
          interpretation: `Heuristic propagation analysis suggests ${upstream} failure (${upstreamClass}) may be linked to ${downstream} (${downstreamClass}) via ${link}. This is a non-authoritative inference from co-occurring root causes and known dependency topology; it does not constitute causal proof.`,
          nextStep: `Investigate ${upstream} and ${downstream} independently, then rerun sensors for both components to confirm whether the observed link persists after any repair.`,
          calibration: propagationCalibration,
          propagationLink: link,
        },
        findingIds: allFindingIds,
      }),
    );
  }

  return propagations;
}

function uniqueFindingIds(observations: Observation[], findings: Finding[] = []): string[] {
  return [
    ...new Set([
      ...observations.flatMap((observation) => observation.findingIds),
      ...findings.map((finding) => finding.id),
    ]),
  ];
}

function findingIdsForComponent(
  observations: Observation[],
  findings: Finding[],
  component: string,
): string[] {
  return uniqueFindingIds(
    observations,
    findings.filter((finding) => finding.component === component),
  );
}

function ensureUniqueObservationIds(observations: Observation[]): Observation[] {
  const seen = new Set<string>();
  const baseCounts = new Map<string, number>();

  return observations.map((observation) => {
    if (!seen.has(observation.id)) {
      seen.add(observation.id);
      baseCounts.set(observation.id, Math.max(baseCounts.get(observation.id) ?? 1, 1));
      return observation;
    }

    let nextIndex = (baseCounts.get(observation.id) ?? 1) + 1;
    let candidate = `${observation.id}-${nextIndex}`;
    while (seen.has(candidate)) {
      nextIndex += 1;
      candidate = `${observation.id}-${nextIndex}`;
    }

    baseCounts.set(observation.id, nextIndex);
    seen.add(candidate);
    return {
      ...observation,
      id: candidate,
    };
  });
}

function observationEvidence(observations: Observation[]): string[] {
  return observations
    .map(
      (observation) =>
        `${observation.agent}:${observation.kind}:${observation.status} — ${observation.summary}`,
    )
    .slice(0, 8);
}

function normalizeKnownAgentResult(
  agentName: string,
  agent: TestAgent,
  result: AgentResult,
  targets: Target,
): AgentResult {
  if (result.observations !== undefined) {
    return result;
  }

  const findingIds = result.findings.map((finding) => finding.id);
  const failed = result.findings.length > 0;
  const status = failed ? statusFromFindings(result.findings) : "passed";
  const evidence = failed ? findingEvidence(result.findings) : [];

  if (agent instanceof SurfAgent) {
    const coverage = result.coverage.userFlows ?? 0;
    return {
      ...result,
      observations: [
        makeObservation({
          agent: agentName,
          kind: "coverage",
          status,
          subject: targets.web ?? "targets.web",
          summary: failed
            ? "Surf exploration did not produce verified browser-state coverage."
            : `Surf verified user-flow coverage at ${coverage}%.`,
          evidence: failed ? evidence : [`userFlows: ${coverage}%`],
          coverage: result.coverage,
          semantics: {
            component: "web",
            interpretation: failed
              ? "Surf could not verify browser-state user-flow coverage for the web target."
              : "Surf verified browser-state user-flow coverage for the web target.",
            nextStep: failed
              ? "Inspect Surf runtime evidence and rerun after browser/runtime repair."
              : "Use this measured user-flow signal alongside property exploration.",
          },
          findingIds,
        }),
      ],
    };
  }

  if (agent instanceof BombadilAgent) {
    return {
      ...result,
      observations: [
        makeObservation({
          agent: agentName,
          kind: "property",
          status,
          subject: targets.web ?? "targets.web",
          summary: failed
            ? "Bombadil exploration surfaced a blocking runtime or property finding."
            : "Bounded Bombadil exploration completed without a surfaced violation.",
          evidence:
            evidence.length > 0
              ? evidence
              : ["bounded exploration completed without surfaced violation"],
          coverage: result.coverage,
          semantics: {
            component: "web",
            interpretation: failed
              ? "Bombadil surfaced a property/runtime issue while exploring the web target."
              : "Bombadil completed a bounded exploration budget without surfacing a violation.",
            nextStep: failed
              ? "Review Bombadil trace evidence before treating UI behavior as stable."
              : "Pair this property signal with user-flow coverage for the web surface.",
          },
          findingIds,
        }),
      ],
    };
  }

  if (agent instanceof CliTesterAgent) {
    return {
      ...result,
      observations: [
        makeObservation({
          agent: agentName,
          kind: "smoke",
          status,
          subject: targets.cli ?? "targets.cli",
          summary: failed
            ? "CLI smoke did not complete successfully."
            : "CLI smoke completed successfully.",
          evidence: failed ? evidence : ["--help exited successfully"],
          coverage: result.coverage,
          semantics: {
            component: "cli",
            interpretation: failed
              ? "The CLI smoke sensor could not establish basic executable health."
              : "The CLI smoke sensor established basic executable health.",
            nextStep: failed
              ? "Repair command resolution or --help behavior before relying on CLI-facing tests."
              : "Use this smoke signal as a baseline, not as full CLI behavior coverage.",
          },
          findingIds,
        }),
      ],
    };
  }

  return result;
}

function summarizeBombadilEvidence(
  evidence: Pick<
    Awaited<ReturnType<typeof runBombadil>>,
    | "binaryPath"
    | "binaryProvider"
    | "resolutionNotes"
    | "tracePath"
    | "usedDefaultSpecification"
    | "stderr"
    | "stdout"
    | "timedOut"
    | "durationMs"
  >,
): string[] {
  const renderedEvidence: string[] = [
    `binary: ${evidence.binaryPath}`,
    `provider: ${evidence.binaryProvider}`,
  ];

  if (evidence.usedDefaultSpecification) {
    renderedEvidence.push("specification: default");
  }

  if (evidence.timedOut) {
    renderedEvidence.push(
      `bounded run finished after ${evidence.durationMs}ms without a surfaced violation`,
    );
  }

  if (evidence.tracePath) {
    renderedEvidence.push(`trace: ${evidence.tracePath}`);
  }

  renderedEvidence.push(...evidence.resolutionNotes);

  const diagnosticLine = [...evidence.stderr.split(/\r?\n/), ...evidence.stdout.split(/\r?\n/)]
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) =>
      /violation|error|failed|using default specification|storing trace in|starting test/i.test(
        line,
      ),
    );

  if (diagnosticLine) {
    renderedEvidence.push(diagnosticLine);
  }

  return renderedEvidence;
}

class BombadilAgent implements TestAgent {
  private readonly agentName: string;
  private readonly durationMs: number;
  private readonly options: BombadilOptions | undefined;

  constructor(agentName: string, durationMs: number, options: BombadilOptions | undefined) {
    this.agentName = agentName;
    this.durationMs = durationMs;
    this.options = options;
  }

  async execute(targets: Target): Promise<AgentResult> {
    if (!targets.web) {
      return {
        findings: [
          {
            id: `${this.agentName}-missing-web-target`,
            type: "bug",
            severity: "critical",
            component: "web",
            description: "Web target is missing for the bombadil agent",
            evidence: ["targets.web was not configured"],
            recommendation:
              "Set targets.web to a valid origin before running the Bombadil-backed orchestrator path.",
            timestamp: new Date(),
          },
        ],
        coverage: { edgeCases: 0 },
      };
    }

    const result = await runBombadil({
      origin: targets.web,
      durationMs: this.durationMs,
      options: this.options
        ? {
            command: this.options.command,
            outputPath: this.options.outputPath,
            headers: this.options.headers,
            reproduceTracePath: this.options.reproduceTrace,
            width: this.options.width,
            height: this.options.height,
            deviceScaleFactor: this.options.deviceScaleFactor,
            instrumentJavaScript: this.options.instrumentJavaScript,
            chromeGrantPermissions: this.options.chromeGrantPermissions,
            headless: this.options.headless,
            noSandbox: this.options.noSandbox,
            remoteDebugger: this.options.remoteDebugger,
            createTarget: this.options.createTarget,
          }
        : undefined,
    });

    if (result.status === "completed" || result.status === "budget_exhausted") {
      return {
        findings: [],
        coverage: { edgeCases: 100 },
      };
    }

    if (result.status === "violation") {
      return {
        findings: [
          {
            id: `${this.agentName}-property-violation`,
            type: "bug",
            severity: "high",
            component: "web",
            description: `Bombadil found a property violation while exploring ${targets.web}`,
            evidence: summarizeBombadilEvidence(result),
            recommendation:
              "Review the Bombadil trace and logs, then fix or tighten the violated browser behavior before relying on this target.",
            timestamp: new Date(),
          },
        ],
        coverage: { edgeCases: 100 },
      };
    }

    return {
      findings: [
        {
          id: `${this.agentName}-runtime-failed`,
          type: "bug",
          severity: "critical",
          component: "web",
          description: `Bombadil runtime could not complete against ${targets.web}`,
          evidence: summarizeBombadilEvidence(result),
          recommendation:
            "Ensure Bombadil is available through TEST_CAPABILITIES_BOMBADIL_BIN, a built TEST_CAPABILITIES_BOMBADIL_REPO/workspace contrib checkout, repo-local external/bombadil, or bombadil on PATH, then re-run the suite.",
          timestamp: new Date(),
        },
      ],
      coverage: { edgeCases: 0 },
    };
  }
}

class SurfAgent implements TestAgent {
  private readonly agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  async execute(targets: Target): Promise<AgentResult> {
    if (!targets.web) {
      return {
        findings: [
          {
            id: `${this.agentName}-missing-web-target`,
            type: "bug",
            severity: "critical",
            component: "web",
            description: "Web target is missing for the surf agent",
            evidence: ["targets.web was not configured"],
            recommendation:
              "Set targets.web to a valid URL before running the surf-backed orchestrator path.",
            timestamp: new Date(),
          },
        ],
        coverage: { userFlows: 0 },
      };
    }

    try {
      const envelope = await executeSurfExploreOperation({ url: targets.web });
      return {
        findings: [],
        coverage: { userFlows: envelope.result.coverage.userFlows },
      };
    } catch (error) {
      return {
        findings: [
          {
            id: `${this.agentName}-runtime-failed`,
            type: "bug",
            severity: "critical",
            component: "web",
            description: `Surf runtime could not complete against ${targets.web}`,
            evidence: [error instanceof Error ? error.message : String(error)],
            recommendation:
              "Ensure Surf Go is resolvable through TEST_CAPABILITIES_SURF_GO_BIN, TEST_CAPABILITIES_SURF_GO_REPO, the workspace surf-cli-go checkout, or surf-go on PATH, then re-run the suite.",
            timestamp: new Date(),
          },
        ],
        coverage: { userFlows: 0 },
      };
    }
  }
}

class CliTesterAgent implements TestAgent {
  private readonly agentName: string;
  private readonly timeoutMs: number;

  constructor(agentName: string, timeoutMs: number = DEFAULT_CLI_TESTER_TIMEOUT_MS) {
    this.agentName = agentName;
    this.timeoutMs = timeoutMs;
  }

  async execute(targets: Target): Promise<AgentResult> {
    if (!targets.cli) {
      return {
        findings: [
          {
            id: `${this.agentName}-missing-cli-target`,
            type: "bug",
            severity: "critical",
            component: "cli",
            description: "CLI target is missing for the cli-tester agent",
            evidence: ["targets.cli was not configured"],
            recommendation:
              "Set targets.cli to an executable command or path before running the suite.",
            timestamp: new Date(),
          },
        ],
        coverage: { edgeCases: 0 },
      };
    }

    let commandDisplay = `${targets.cli} --help`;

    try {
      const parsedCommand = parseCommandLine(targets.cli);
      commandDisplay = [parsedCommand.command, ...parsedCommand.args, "--help"].join(" ");
      const result = await this.runCommand(
        parsedCommand.command,
        [...parsedCommand.args, "--help"],
        this.timeoutMs,
      );
      if (result.timedOut || result.code !== 0) {
        return {
          findings: [
            {
              id: `${this.agentName}-help-failed`,
              type: "bug",
              severity: "critical",
              component: "cli",
              description: `CLI smoke command failed: ${commandDisplay}`,
              evidence: [
                result.timedOut
                  ? `timed out after ${this.timeoutMs}ms${result.signal ? ` (${result.signal})` : ""}`
                  : result.stderr || result.stdout || `exit code ${result.code}`,
              ],
              recommendation: `Ensure '${targets.cli}' is executable and '--help' exits successfully.`,
              timestamp: new Date(),
            },
          ],
          coverage: { edgeCases: 0 },
        };
      }

      return {
        findings: [],
        coverage: { edgeCases: 100 },
      };
    } catch (error) {
      return {
        findings: [
          {
            id: `${this.agentName}-spawn-failed`,
            type: "bug",
            severity: "critical",
            component: "cli",
            description: `CLI smoke command could not be executed: ${commandDisplay}`,
            evidence: [error instanceof Error ? error.message : String(error)],
            recommendation: `Ensure '${targets.cli}' exists and is executable in the current environment.`,
            timestamp: new Date(),
          },
        ],
        coverage: { edgeCases: 0 },
      };
    }
  }

  private async runCommand(
    command: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });

      const killProcessTree = (signal: NodeJS.Signals): void => {
        try {
          if (process.platform !== "win32" && typeof proc.pid === "number") {
            process.kill(-proc.pid, signal);
            return;
          }

          proc.kill(signal);
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
            throw error;
          }
        }
      };

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let closed = false;
      const forceKillGraceMs = 1_000;
      let forceKillTimer: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree("SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (!closed) {
            killProcessTree("SIGKILL");
          }
        }, forceKillGraceMs);
      }, timeoutMs);

      proc.stdout.on("data", (data) => {
        stdout = appendCappedProcessOutput(stdout, String(data));
      });
      proc.stderr.on("data", (data) => {
        stderr = appendCappedProcessOutput(stderr, String(data));
      });

      proc.on("close", (code, signal) => {
        closed = true;
        clearTimeout(timer);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        resolve({
          code,
          signal,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut,
        });
      });

      proc.on("error", (error) => {
        closed = true;
        clearTimeout(timer);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
        }
        reject(error);
      });
    });
  }
}

// ============================================
// EXPORTS
// ============================================

export default TestCapabilitiesOrchestrator;
