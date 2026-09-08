/**
 * TEST-CAPABILITIES Core Orchestrator
 * The brain that coordinates all testing agents
 */

import { QuantumTestRunner } from "../quantum/simulator.js";
import { validateCapabilityContract } from "./capability-matrix.js";
import type {
  AgentConfig,
  ParsedTestCapabilitiesConfig,
  PropagationEdge,
  PropagationTopology,
  Target,
  TestCapabilitiesConfig,
} from "./config.js";
import { TestCapabilitiesConfigSchema } from "./config.js";
import type { Determination } from "./determination.js";
import { determineRun, outcomeEvidenceLines, worstOutcome } from "./determination.js";
import { worstEffect } from "./effects.js";
import type { FrameDeterminationValue, FrameRootCause } from "./frame-root-cause.js";
import { frameDeterminationFromEvidence } from "./frame-root-cause.js";
import { AGENT_EFFECTS } from "./operations/test/agent-findings.js";
import type { AgentResult, TestAgent } from "./operations/test/agents.js";
import {
  BombadilAgent,
  CliTesterAgent,
  DEFAULT_CLI_TESTER_TIMEOUT_MS,
  SurfAgent,
  TerminalFuzzerAgent,
} from "./operations/test/agents.js";
import type { MutationReceiptEnvelopeCopy } from "./receipt-store.js";
import type { ResultOutcome } from "./result-classification.js";
import type { RunContext } from "./run-context.js";
import { createRunContext } from "./run-context.js";

// ============================================
// TYPES & SCHEMAS
// ============================================
// The config schema and its types live in ./config.ts (D4); this file keeps
// the run-time result types (Finding, Observation, TestResult, ...).

export interface Finding {
  id: string;
  type: FindingType;
  severity: Severity;
  component: string;
  description: string;
  evidence: string[];
  recommendation: string;
  timestamp: Date;
  /**
   * The classified outcome this finding was raised from (result-classification packet,
   * "Backwards compatibility"). Optional: a finding without one is a legacy finding and the
   * healer accepts it with a `legacy_evidence` note. `outcome.basis` is the attribution axis -
   * only `fault` says the target is broken.
   */
  outcome?: ResultOutcome;
  /**
   * Why an element this finding is about could not be reached (slice S8; architecture review
   * A20). This typed field is authoritative: `inferRootCauseClass` and the healer read
   * `frameRootCause.determination.value` and fall back to the `frame-root-cause:` marker line
   * in `evidence` only for a finding written before the field existed.
   */
  frameRootCause?: FrameRootCause;
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
  /**
   * The step aimed a main-document selector at a target inside a frame. It is a test-defect
   * locus - the repair is a structural change to the step (`frame.switch` before the query),
   * not a selector substitution and not a change in the system under test - which is why it is
   * its own class rather than a flavour of `selector_or_dom_drift`. It is asserted only for a
   * `confirmed` frame determination; anything short of exclusion is a coverage gap of the
   * sensor, and a sensor limit is never filed as a fault of the target.
   */
  "frame_boundary",
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
  /** the worst classified outcome the sensor produced; its first evidence lines mirror it */
  outcome?: ResultOutcome;
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
  /** `determination.value === "verified"`; kept for compatibility with existing consumers */
  passed: boolean;
  /**
   * The run verdict with its basis (adjudication claim 7, operator decision D3). The third
   * state - a run that produced no evidence either way - reaches the top level here instead of
   * being folded into `passed: false`; exit codes stay 0/1 and `unverified`/`indeterminate`
   * map to 1.
   */
  determination: Determination;
  /**
   * Every step the run classified, in agent order. The determination is a function of these
   * and of the coverage report, so the verdict can be re-derived from the envelope alone
   * (axiom A5). Empty when no agent classifies yet.
   */
  outcomes: ResultOutcome[];
  duration: number;
  findings: Finding[];
  coverage: CoverageReport;
  observations?: Observation[];
  /**
   * The redacted receipts of every mutating step the run took (mutation-safety packet,
   * "Envelope changes"). Optional for one release so historical envelopes stay valid; absent
   * when the run mutated nothing, which is the read-only case.
   */
  mutations?: MutationReceiptEnvelopeCopy[];
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
          this.agents.set(name, new CliTesterAgent(name, timeoutMs, agentConfig.expect));
          break;
        }
        case "terminal-fuzzer": {
          const durationMs = parseDurationToMs(
            agentConfig.duration,
            getBombadilBudgetMs(agentConfig.intensity),
          );
          this.agents.set(name, new TerminalFuzzerAgent(name, durationMs, agentConfig.terminal));
          break;
        }
        default:
          throw new Error(
            `Agent '${name}' uses unsupported type '${agentConfig.type}'. Only 'bombadil', 'surf', 'cli-tester', and 'terminal-fuzzer' are currently backed by the orchestrator runtime.`,
          );
      }
    }
  }

  /**
   * Run the suite. The kernel mints the {@link RunContext} and passes it in; a library caller
   * that does not, gets one minted from this config so every mutating agent still runs behind
   * the ledger and its receipts (architecture review A5, adjudication claim 1).
   */
  async run(context?: RunContext): Promise<TestResult> {
    const runContext =
      context ??
      createRunContext({
        operationId: "test",
        effect: worstEffect(
          Object.values(this.config.agents ?? {})
            .filter((agent) => agent.enabled !== false)
            .map((agent) => AGENT_EFFECTS[agent.type]),
        ),
        config: this.config,
      });

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
          await agent.execute(this.config.targets, runContext),
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
    const outcomes = agentResults.flatMap((result) => result.outcomes ?? []);
    const expectations = agentResults.flatMap((result) => result.expectations ?? []);
    const determination = determineRun(outcomes, {
      expectations,
      blockingFindings: countBlockingFindings(correlatedFindings),
      coverage: coverage.overall,
    });

    const mutations = runContext.ledger.envelopeReceipts();

    return {
      passed: determination.value === "verified",
      determination,
      outcomes,
      duration,
      findings: correlatedFindings,
      coverage,
      observations,
      ...(mutations.length > 0 ? { mutations } : {}),
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
      const carriedOutcome = inheritedOutcome(componentFindings);
      correlations.push({
        id: `corr-${component}`,
        type: "bug",
        severity: getHighestSeverity(componentFindings),
        component,
        description: `Correlated findings indicate a systemic issue in ${component}`,
        evidence: distinctDescriptions,
        recommendation: `Investigate ${component} as one systemic failure surface instead of isolated finding(s).`,
        timestamp: new Date(),
        // A correlation of findings that all say "no evidence" is itself no evidence: it must
        // not become the blocking target fault its inputs deliberately are not.
        ...(carriedOutcome ? { outcome: carriedOutcome } : {}),
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
// AGENT OBSERVATIONS
// ============================================

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

/**
 * A blocking finding is one the run may report as a target failure.
 *
 * A finding whose outcome basis is not `fault` describes the absence of information
 * (`no_evidence`), a self-contradictory reply (`contradiction`) or an unknown effect
 * (`indeterminate`); presenting it as a fault would be a claim the evidence does not support
 * (result-classification packet, refinement). Such findings still block `passed` - they simply
 * do so through the determination's `unverified`/`indeterminate` value instead of `failed`.
 * A legacy finding without an outcome keeps the pre-S4 meaning and blocks.
 */
function countBlockingFindings(findings: Finding[]): number {
  return findings.filter(
    (finding) =>
      (finding.severity === "high" || finding.severity === "critical") &&
      (finding.outcome === undefined || finding.outcome.basis === "fault"),
  ).length;
}

/**
 * The outcome a synthesized correlation may carry: only when every correlated finding is
 * classified and none of them is a target fault. A single legacy or `fault` input leaves the
 * correlation unclassified, which keeps its pre-S4 blocking meaning.
 */
function inheritedOutcome(findings: Finding[]): ResultOutcome | undefined {
  const outcomes = findings.map((finding) => finding.outcome);
  if (outcomes.some((outcome) => outcome === undefined)) {
    return undefined;
  }
  const classified = outcomes as ResultOutcome[];
  if (classified.some((outcome) => outcome.basis === "fault")) {
    return undefined;
  }
  return worstOutcome(classified);
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

/**
 * The frame determination in force for this evidence, worst claim first.
 *
 * The typed field is authoritative; the marker line is read only for a finding written before
 * it existed (architecture review A20). A `confirmed` finding outranks the rest because it is
 * the only one that names a cause; between the others, any determination short of exclusion is
 * enough to keep the failure out of the regex.
 */
function frameDeterminationOf(
  observations: Observation[],
  findings: Finding[],
): FrameDeterminationValue | undefined {
  const values = [
    ...findings.map(
      (finding) =>
        finding.frameRootCause?.determination.value ??
        frameDeterminationFromEvidence(finding.evidence),
    ),
    // A sensor's own observation of the same failure carries the marker line and nothing else,
    // so it is read the same way. Without this the finding and its observation would classify
    // differently and the synthesis would suppress itself as ambiguous.
    ...observations.map((observation) => frameDeterminationFromEvidence(observation.evidence)),
  ];
  for (const value of [
    "confirmed",
    "undetermined",
    "unavailable",
    "suspected",
    "excluded",
  ] as const) {
    if (values.includes(value)) {
      return value;
    }
  }
  return undefined;
}

function inferRootCauseClass(
  observations: Observation[],
  findings: Finding[],
): RootCauseFailureClass {
  // Structurally, before any regex: a frame determination is a fact the run recorded, and the
  // regex corpus would read the same failure text as selector drift (frame-root-cause packet,
  // "Consumer permissions per determination").
  const frame = frameDeterminationOf(observations, findings);
  if (frame === "confirmed") {
    return "frame_boundary";
  }
  if (frame === "suspected" || frame === "undetermined" || frame === "unavailable") {
    // A limit of the sensor is not a fault of the system under test (School 4). The diagnosis
    // travels on the finding either way, so a reader can disagree with the label.
    return "browser_coverage_gap";
  }

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
  // The typed outcome is rendered, never re-derived: `outcome:<class>:<code>` and
  // `basis:<basis>` lead every sensor's evidence so the verdict is replayable from the receipt
  // (result-classification packet, "Backwards compatibility").
  const outcome = worstOutcome(result.outcomes ?? []);
  const outcomeLines = outcomeEvidenceLines(outcome);
  const typed = outcome ? { outcome } : {};
  const evidence = failed ? findingEvidence(result.findings) : [];
  const withOutcome = (lines: string[]): string[] => [...outcomeLines, ...lines];

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
          evidence: withOutcome(failed ? evidence : [`userFlows: ${coverage}%`]),
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
          ...typed,
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
          evidence: withOutcome(
            evidence.length > 0
              ? evidence
              : ["bounded exploration completed without surfaced violation"],
          ),
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
          ...typed,
        }),
      ],
    };
  }

  if (agent instanceof TerminalFuzzerAgent) {
    return {
      ...result,
      observations: [
        makeObservation({
          agent: agentName,
          kind: "runtime",
          status,
          subject: result.observationSubject ?? targets.cli ?? "targets.cli",
          summary: failed
            ? "Bombadil terminal fuzzer surfaced a blocking runtime or terminal finding."
            : "Bounded Bombadil terminal fuzzer completed without a surfaced violation.",
          evidence: withOutcome(
            evidence.length > 0
              ? evidence
              : ["bombadil terminal test completed without surfaced violation"],
          ),
          coverage: result.coverage,
          semantics: {
            component: "cli",
            interpretation: failed
              ? "Bombadil terminal fuzzing could not establish a stable terminal interaction signal."
              : "Bombadil terminal fuzzing completed a bounded terminal-interaction budget.",
            nextStep: failed
              ? "Review Bombadil terminal evidence before relying on terminal UI behavior."
              : "Treat this as a bounded terminal smoke/fuzz signal, not production autonomy proof.",
          },
          findingIds,
          ...typed,
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
          evidence: withOutcome(failed ? evidence : ["--help exited successfully"]),
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
          ...typed,
        }),
      ],
    };
  }

  return result;
}

// ============================================
// EXPORTS
// ============================================

export default TestCapabilitiesOrchestrator;
