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

export const AgentConfigSchema = z
  .object({
    type: z.enum(["bombadil", "surf", "api-fuzzer", "cli-tester"]),
    enabled: z.boolean().default(true),
    intensity: z.enum(["gentle", "normal", "aggressive"]).default("normal"),
    duration: z.string().optional(),
    focus: z.array(z.string()).optional(),
  })
  .strict();

const IntelligenceSchema = z.preprocess(
  (value) => withAliases(value, { self_healing: "selfHealing" }),
  z
    .object({
      selfHealing: z.boolean().default(false),
      prediction: z.boolean().default(false),
      correlation: z.boolean().default(true),
      collective: z.boolean().default(false),
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

export type TestCapabilitiesConfig = z.infer<typeof TestCapabilitiesConfigSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

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
const DEFAULT_BOMBADIL_DURATION_MS: Record<NonNullable<AgentConfig["intensity"]>, number> = {
  gentle: 5_000,
  normal: 10_000,
  aggressive: 20_000,
};

function getBombadilBudgetMs(intensity: AgentConfig["intensity"] | undefined): number {
  return DEFAULT_BOMBADIL_DURATION_MS[intensity ?? "normal"];
}

export class TestCapabilitiesOrchestrator {
  private config: TestCapabilitiesConfig;
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
          this.agents.set(name, new BombadilAgent(name, durationMs));
          break;
        }
        case "cli-tester": {
          const timeoutMs = parseDurationToMs(agentConfig.duration, DEFAULT_CLI_TESTER_TIMEOUT_MS);
          this.agents.set(name, new CliTesterAgent(name, timeoutMs));
          break;
        }
        default:
          throw new Error(
            `Agent '${name}' uses unsupported type '${agentConfig.type}'. Only 'bombadil' and 'cli-tester' are currently backed by the orchestrator runtime.`,
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
      Array.from(this.agents.values()).map((agent) => agent.execute(this.config.targets)),
    );

    const correlatedFindings = this.correlateFindings(agentResults.flatMap((r) => r.findings));

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
}

interface TestAgent {
  execute(targets: Target): Promise<AgentResult>;
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

  constructor(agentName: string, durationMs: number) {
    this.agentName = agentName;
    this.durationMs = durationMs;
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
        stdout += String(data);
      });
      proc.stderr.on("data", (data) => {
        stderr += String(data);
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
