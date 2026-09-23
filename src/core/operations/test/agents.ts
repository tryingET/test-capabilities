/**
 * Test-agent step lists.
 *
 * The four orchestrator agents (bombadil, terminal-fuzzer, surf, cli-tester) live here as
 * their own module so later slices edit the step lists instead of the orchestrator
 * (implementation plan S3 commit 1; architecture adjudication claim 33). The orchestrator
 * keeps the run loop, correlation, root-cause synthesis and the observation rendering and
 * imports the classes from here; this module imports the orchestrator for types only, so the
 * runtime import graph stays acyclic.
 */

export { CliTesterAgent, DEFAULT_CLI_TESTER_TIMEOUT_MS } from "./cli-tester-agent.js";

import type { BombadilRunResult, BombadilTerminalRunResult } from "../../bombadil-runtime.js";
import { runBombadil, runBombadilTerminalTest } from "../../bombadil-runtime.js";
import type {
  BombadilOptions,
  BombadilTerminalOptions,
  ObservationConfig,
  Target,
} from "../../config.js";
import type { EffectDeclaration } from "../../effects.js";
import { defaultMutationOutcomeForError } from "../../effects.js";
import { ElementUnreachable } from "../../frame-diagnosis.js";
import type { FrameRootCause } from "../../frame-root-cause.js";
import { renderFrameRootCauseEvidence } from "../../frame-root-cause.js";
import type { CoverageReport, Finding, Observation } from "../../orchestrator.js";
import type { ExpectDeclaration, ResultOutcome } from "../../result-classification.js";
import type { RunContext } from "../../run-context.js";
import { FrameworkError } from "../../runtime-contract.js";
import {
  executeSurfExploreOperation,
  outcomeFromError,
  SurfExploreProbeRefusal,
} from "../surf-explore-operation.js";
import {
  AGENT_EFFECTS,
  BOMBADIL_RUNTIME_RECOMMENDATION,
  describeLedgerRefusal,
  describeSurfRefusal,
} from "./agent-findings.js";

export interface AgentResult {
  findings: Finding[];
  coverage: Partial<CoverageReport>;
  observations?: Observation[];
  observationSubject?: string;
  /**
   * Every step this agent classified. The run determination is computed over these
   * (`determineRun`), so an agent that produces none is reported from the legacy signal
   * (blocking findings and measured coverage) instead of being called unverified.
   */
  outcomes?: ResultOutcome[];
  /** the declarations that were in force for those steps; named in the determination's reason */
  expectations?: ExpectDeclaration[];
}

export interface TestAgent {
  /** what this agent may do to the world; `test` resolves to the worst class it enables */
  readonly effect: EffectDeclaration;
  execute(targets: Target, context: RunContext): Promise<AgentResult>;
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

export class BombadilAgent implements TestAgent {
  readonly effect = AGENT_EFFECTS.bombadil;
  private readonly agentName: string;
  private readonly durationMs: number;
  private readonly options: BombadilOptions | undefined;

  constructor(agentName: string, durationMs: number, options: BombadilOptions | undefined) {
    this.agentName = agentName;
    this.durationMs = durationMs;
    this.options = options;
  }

  async execute(targets: Target, context: RunContext): Promise<AgentResult> {
    if (!targets.web) {
      return missingTarget(
        this.agentName,
        "web",
        "Web target is missing for the bombadil agent",
        "targets.web was not configured",
        "Set targets.web to a valid origin before running the Bombadil-backed orchestrator path.",
      );
    }

    const origin = targets.web;
    let attempted: BombadilRunResult | undefined;
    let result: BombadilRunResult;
    try {
      // The agent's one mutating step. The receipt is on disk before Bombadil is spawned, and
      // an origin the operator has not declared never gets that far (review A13).
      result = await context.ledger.runStep<BombadilRunResult>({
        id: `${this.agentName}.bombadil`,
        effect: this.effect,
        subject: origin,
        intent: "bounded fuzz",
        details: { agent: this.agentName, budget_ms: this.durationMs },
        run: async () => {
          const run = await runBombadil({
            origin,
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
          attempted = run;
          if (run.spawnFailed) {
            // The process never started: nothing happened, and that is knowledge rather than
            // doubt, so the receipt settles `failed` instead of locking the key.
            throw new FrameworkError(
              "mutation_step_not_started",
              `Bombadil could not be executed against ${origin}`,
              { binary: run.binaryPath, provider: run.binaryProvider },
            );
          }
          return run;
        },
        settle: (attempt) => settleBombadilAttempt(attempt.error, attempt.value),
      });
    } catch (error) {
      return this.refusal(origin, error, attempted);
    }

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
            description: `Bombadil found a property violation while exploring ${origin}`,
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
          description: `Bombadil runtime could not complete against ${origin}`,
          evidence: summarizeBombadilEvidence(result),
          recommendation: BOMBADIL_RUNTIME_RECOMMENDATION.web,
          timestamp: new Date(),
        },
      ],
      coverage: { edgeCases: 0 },
    };
  }

  /** A refusal by the ledger, or a run that never reported: never a claim about the target. */
  private refusal(origin: string, error: unknown, attempted?: BombadilRunResult): AgentResult {
    const shape = describeLedgerRefusal("web", origin, error);
    return {
      findings: [
        {
          id: `${this.agentName}-${shape.id}`,
          type: "bug",
          severity: shape.severity,
          component: "web",
          description: shape.description,
          evidence: [
            error instanceof Error ? error.message : String(error),
            ...(attempted ? summarizeBombadilEvidence(attempted) : []),
          ],
          recommendation: shape.recommendation,
          timestamp: new Date(),
        },
      ],
      coverage: { edgeCases: 0 },
    };
  }
}

/**
 * What a bounded fuzz attempt means, from typed facts only (adjudication claim 46): a run that
 * left a trace or output did something to the target and is `applied` whatever its exit; a run
 * that left neither is `unknown`, because nothing says what it did.
 *
 * `applied` here means "this attempt is consumed", not "the effects are proven": output may be
 * a startup banner, and a definite outcome deliberately does not block a later run, because a
 * fuzz campaign is meant to be run again and a rerun is the operator's decision. What must not
 * happen silently is a rerun *after an attempt nobody can account for*, which is the `unknown`
 * case, and that one holds the key until a human supersedes it.
 */
function settleBombadilAttempt(
  error: unknown,
  value:
    | { ranEvidence: boolean; status: string; tracePath?: string; traceBytes?: number }
    | undefined,
): { outcome: "applied" | "failed" | "unknown"; evidence?: string[] } {
  if (error !== undefined) {
    return { outcome: defaultMutationOutcomeForError(error) };
  }
  if (!value?.ranEvidence) {
    return { outcome: "unknown", evidence: ["the run left no trace and no output"] };
  }
  return {
    outcome: "applied",
    evidence: [
      `status: ${value.status}`,
      ...(value.tracePath ? [`trace: ${value.tracePath}`] : []),
      `traceBytes: ${value.traceBytes ?? 0}`,
    ],
  };
}

/** The finding an agent renders when its target is not configured; nothing was attempted. */
function missingTarget(
  agentName: string,
  component: "web" | "cli",
  description: string,
  evidence: string,
  recommendation: string,
): AgentResult {
  return {
    findings: [
      {
        id: `${agentName}-missing-${component}-target`,
        type: "bug",
        severity: "critical",
        component,
        description,
        evidence: [evidence],
        recommendation,
        timestamp: new Date(),
      },
    ],
    coverage: component === "web" ? { edgeCases: 0 } : { edgeCases: 0 },
  };
}

export class TerminalFuzzerAgent implements TestAgent {
  readonly effect = AGENT_EFFECTS["terminal-fuzzer"];
  private readonly agentName: string;
  private readonly durationMs: number;
  private readonly options: BombadilTerminalOptions | undefined;

  constructor(agentName: string, durationMs: number, options: BombadilTerminalOptions | undefined) {
    this.agentName = agentName;
    this.durationMs = durationMs;
    this.options = options;
  }

  async execute(targets: Target, context: RunContext): Promise<AgentResult> {
    const command = this.options?.command ?? targets.cli;
    if (!command) {
      return missingTarget(
        this.agentName,
        "cli",
        "CLI target is missing for the terminal-fuzzer agent",
        "targets.cli or agents.<name>.terminal.command was not configured",
        "Set targets.cli or agents.<name>.terminal.command before running the Bombadil terminal fuzzer path.",
      );
    }

    let attempted: BombadilTerminalRunResult | undefined;
    let result: BombadilTerminalRunResult;
    try {
      // A terminal subject is not a web origin, so `mutation.allowOrigins` does not apply; the
      // receipt and the at-most-once rule do.
      result = await context.ledger.runStep<BombadilTerminalRunResult>({
        id: `${this.agentName}.bombadil-terminal`,
        effect: this.effect,
        subject: command,
        intent: "bounded terminal fuzz",
        details: { agent: this.agentName, budget_ms: this.durationMs },
        run: async () => {
          const run = await runBombadilTerminalTest({
            target: { command, args: this.options?.args },
            durationMs: this.durationMs,
          });
          attempted = run;
          if (run.spawnFailed) {
            throw new FrameworkError(
              "mutation_step_not_started",
              `Bombadil terminal test could not be executed for ${command}`,
              { binary: run.binaryPath, provider: run.binaryProvider },
            );
          }
          return run;
        },
        settle: (attempt) => settleBombadilAttempt(attempt.error, attempt.value),
      });
    } catch (error) {
      return this.refusal(command, error, attempted);
    }

    if (result.status === "completed" || result.status === "budget_exhausted") {
      return {
        findings: [],
        coverage: { edgeCases: 100 },
        observationSubject: command,
      };
    }

    // The terminal runner has no typed way to distinguish a property violation from a crash
    // (no trace, no `--exit-on-violation`), so this finding never claims one; the runtime
    // reports `runtime_error` for every non-zero exit (S3, adjudication claim 46).
    return {
      findings: [
        {
          id: `${this.agentName}-runtime-failed`,
          type: "bug",
          severity: "critical",
          component: "cli",
          description: `Bombadil terminal test could not complete for ${command}`,
          evidence: summarizeBombadilEvidence({
            binaryPath: result.binaryPath,
            binaryProvider: result.binaryProvider,
            resolutionNotes: result.resolutionNotes,
            stderr: result.stderr,
            stdout: result.stdout,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
            usedDefaultSpecification: false,
          }),
          recommendation: BOMBADIL_RUNTIME_RECOMMENDATION.cli,
          timestamp: new Date(),
        },
      ],
      coverage: { edgeCases: 0 },
      observationSubject: command,
    };
  }

  private refusal(
    command: string,
    error: unknown,
    attempted?: BombadilTerminalRunResult,
  ): AgentResult {
    const shape = describeLedgerRefusal("cli", command, error);
    return {
      findings: [
        {
          id: `${this.agentName}-${shape.id}`,
          type: "bug",
          severity: shape.severity,
          component: "cli",
          description: shape.description.replace("fuzz", "fuzz the terminal target"),
          evidence: [
            error instanceof Error ? error.message : String(error),
            ...(attempted
              ? summarizeBombadilEvidence({
                  binaryPath: attempted.binaryPath,
                  binaryProvider: attempted.binaryProvider,
                  resolutionNotes: attempted.resolutionNotes,
                  stderr: attempted.stderr,
                  stdout: attempted.stdout,
                  timedOut: attempted.timedOut,
                  durationMs: attempted.durationMs,
                  usedDefaultSpecification: false,
                })
              : []),
          ],
          recommendation: shape.recommendation,
          timestamp: new Date(),
          observationSubject: undefined,
        } as Finding,
      ],
      coverage: { edgeCases: 0 },
      observationSubject: command,
    };
  }
}

export class SurfAgent implements TestAgent {
  readonly effect = AGENT_EFFECTS.surf;
  private readonly agentName: string;
  /** `agents.<name>.observation.a11ySnapshot`, forwarded to the nested explore (slice S9). */
  private readonly observation: ObservationConfig | undefined;
  /** `agents.<name>.readySelector`, the element the nested explore must reach (AK #5568). */
  private readonly readySelector: string | undefined;

  constructor(
    agentName: string,
    options: { observation?: ObservationConfig; readySelector?: string } = {},
  ) {
    this.agentName = agentName;
    this.observation = options.observation;
    this.readySelector = options.readySelector;
  }

  async execute(targets: Target, context: RunContext): Promise<AgentResult> {
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
      // The nested operation runs inside this run: one run id, one ledger, one store
      // (architecture review A5, adjudication claim 1).
      const a11ySnapshot = this.observation?.a11ySnapshot;
      const envelope = await executeSurfExploreOperation(
        {
          url: targets.web,
          ...(this.readySelector ? { readySelector: this.readySelector } : {}),
          ...(a11ySnapshot && a11ySnapshot !== "off" ? { a11ySnapshot } : {}),
        },
        context,
      );
      return {
        findings: [],
        coverage: { userFlows: envelope.result.coverage.userFlows },
        outcomes: exploreOutcomes(envelope),
      };
    } catch (error) {
      return this.refusal(targets.web, error);
    }
  }

  /**
   * One explore refusal, attributed from its classified outcome.
   *
   * Before slice S4 every error - a readiness refusal, a spawn failure, an empty payload -
   * became the same critical "Surf runtime could not complete" finding, so a page that asked
   * for a login and a surf binary that does not exist rendered identically (adjudication claim
   * 45). The basis axis decides the attribution now, and the code names what happened.
   */
  private refusal(url: string, error: unknown): AgentResult {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = outcomeFromError(error);
    const shape = describeSurfRefusal(url, outcome);
    // The frame determination is copied onto the finding as the typed field, and rendered into
    // the evidence lines for a reader (architecture review A20): the report and the healer read
    // `finding.frameRootCause`, the marker line is only its rendering.
    const frameRootCause = frameRootCauseOf(error);
    return {
      findings: [
        {
          id: `${this.agentName}-${shape.id}`,
          type: "bug",
          severity: shape.severity,
          component: "web",
          description: shape.description,
          evidence: [
            ...(frameRootCause ? renderFrameRootCauseEvidence(frameRootCause) : []),
            ...(outcome ? outcome.evidence : []),
            message,
          ],
          recommendation: shape.recommendation,
          timestamp: new Date(),
          ...(outcome ? { outcome } : {}),
          ...(frameRootCause ? { frameRootCause } : {}),
        },
      ],
      coverage: { userFlows: 0 },
      ...(outcome ? { outcomes: [outcome] } : {}),
    };
  }
}

/** The frame determination an explore refusal carried, when the run took one (slice S8). */
function frameRootCauseOf(error: unknown): FrameRootCause | undefined {
  if (error instanceof ElementUnreachable) {
    return error.frameRootCause;
  }
  if (error instanceof SurfExploreProbeRefusal) {
    return error.frameRootCause;
  }
  return undefined;
}

/** The classified outcome of every probe the explore run made, in page and probe order. */
function exploreOutcomes(
  envelope: Awaited<ReturnType<typeof executeSurfExploreOperation>>,
): ResultOutcome[] {
  return envelope.result.pages
    .flatMap((page) => page.probes)
    .map((probe) => probe.outcome)
    .filter((outcome): outcome is ResultOutcome => outcome !== undefined);
}
