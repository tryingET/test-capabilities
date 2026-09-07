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

import { invokeAdapter } from "../../adapter.js";
import { runBombadil, runBombadilTerminalTest } from "../../bombadil-runtime.js";
import { cliAdapter } from "../../cli-adapter.js";
import type {
  AgentExpect,
  BombadilOptions,
  BombadilTerminalOptions,
  Target,
} from "../../config.js";
import type { CoverageReport, Finding, Observation } from "../../orchestrator.js";
import type { ExpectDeclaration, ResultOutcome } from "../../result-classification.js";
import { classifyResult } from "../../result-classification.js";
import { executeSurfExploreOperation, outcomeFromError } from "../surf-explore-operation.js";

export const DEFAULT_CLI_TESTER_TIMEOUT_MS = 10_000;

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

export class BombadilAgent implements TestAgent {
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

export class TerminalFuzzerAgent implements TestAgent {
  private readonly agentName: string;
  private readonly durationMs: number;
  private readonly options: BombadilTerminalOptions | undefined;

  constructor(agentName: string, durationMs: number, options: BombadilTerminalOptions | undefined) {
    this.agentName = agentName;
    this.durationMs = durationMs;
    this.options = options;
  }

  async execute(targets: Target): Promise<AgentResult> {
    const command = this.options?.command ?? targets.cli;
    if (!command) {
      return {
        findings: [
          {
            id: `${this.agentName}-missing-cli-target`,
            type: "bug",
            severity: "critical",
            component: "cli",
            description: "CLI target is missing for the terminal-fuzzer agent",
            evidence: ["targets.cli or agents.<name>.terminal.command was not configured"],
            recommendation:
              "Set targets.cli or agents.<name>.terminal.command before running the Bombadil terminal fuzzer path.",
            timestamp: new Date(),
          },
        ],
        coverage: { edgeCases: 0 },
      };
    }

    const result = await runBombadilTerminalTest({
      target: {
        command,
        args: this.options?.args,
      },
      durationMs: this.durationMs,
    });

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
          recommendation:
            "Ensure Bombadil 0.5+ is available and the terminal target is safe, deterministic, and bounded before relying on this experimental signal. A non-zero exit from the terminal runner is not attributed to a property violation: it writes no trace and passes no --exit-on-violation, so nothing distinguishes a violation from a crash.",
          timestamp: new Date(),
        },
      ],
      coverage: { edgeCases: 0 },
      observationSubject: command,
    };
  }
}

export class SurfAgent implements TestAgent {
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
    return {
      findings: [
        {
          id: `${this.agentName}-${shape.id}`,
          type: "bug",
          severity: shape.severity,
          component: "web",
          description: shape.description,
          evidence: outcome ? [...outcome.evidence, message] : [message],
          recommendation: shape.recommendation,
          timestamp: new Date(),
          ...(outcome ? { outcome } : {}),
        },
      ],
      coverage: { userFlows: 0 },
      ...(outcome ? { outcomes: [outcome] } : {}),
    };
  }
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

/** surf's own readiness vocabulary: the page answered, and it answered with a refusal. */
const SURF_PAGE_REFUSAL_CODES = new Set([
  "page_login",
  "page_challenge",
  "page_not_found",
  "page_error",
  "page_timeout",
  "page_not_ready",
]);

interface SurfRefusalShape {
  id: string;
  severity: Finding["severity"];
  description: string;
  recommendation: string;
}

const SURF_RUNTIME_RECOMMENDATION =
  "Ensure the surf CLI (nicobailon/surf-cli with wait.ready and extract) is resolvable through TEST_CAPABILITIES_SURF_BIN, surf on PATH, or ~/.local/bin/surf, and that the browser with the surf extension is running (surf doctor), then re-run the suite.";

function describeSurfRefusal(url: string, outcome: ResultOutcome | undefined): SurfRefusalShape {
  if (outcome === undefined) {
    // Legacy path: a framework-side refusal (a probe without browser evidence, an owned tab
    // that reported no id) has no classified outcome and keeps the pre-S4 wording.
    return {
      id: "runtime-failed",
      severity: "critical",
      description: `Surf runtime could not complete against ${url}`,
      recommendation: SURF_RUNTIME_RECOMMENDATION,
    };
  }

  if (outcome.basis === "no_evidence") {
    return {
      id: "no-evidence",
      severity: "critical",
      description: `Surf produced no browser evidence for ${url} [${outcome.code}]`,
      recommendation:
        "This is the absence of evidence, not a fault in the target: the command exited successfully with an empty payload. Check that the page returns content for the probe, or declare the emptiness with expect.output: empty on this agent.",
    };
  }

  if (outcome.basis === "contradiction") {
    return {
      id: "unclassifiable",
      severity: "critical",
      description: `Surf answered ${url} with a reply the result contract cannot classify [${outcome.code}]`,
      recommendation:
        "The reply contradicts itself (for example a success payload carrying an error field). Nothing downstream may reinterpret it; capture the raw output and fix the producer.",
    };
  }

  if (outcome.basis === "indeterminate") {
    return {
      id: "outcome-unknown",
      severity: "critical",
      description: `Surf could not report an outcome for ${url} [${outcome.code}]`,
      recommendation:
        "A step that may have changed the target never reported a result, so nothing about the target is known. Inspect the page by hand before re-running.",
    };
  }

  if (outcome.class === "spawn_failed" || outcome.class === "timeout") {
    return {
      id: "runtime-failed",
      severity: "critical",
      description: `Surf runtime could not be executed against ${url} [${outcome.code}]`,
      recommendation: SURF_RUNTIME_RECOMMENDATION,
    };
  }

  if (SURF_PAGE_REFUSAL_CODES.has(outcome.code)) {
    return {
      id: `page-${outcome.code}`,
      severity: "high",
      description: `Surf could not reach a settled page state on ${url} [${outcome.code}]`,
      recommendation:
        "The surf runtime worked and the page refused it: the page asked for a login, a challenge, or never settled. Point targets.web at a page the framework may read without credentials, or open the flow by hand first; do not treat this as a broken build.",
    };
  }

  return {
    id: "command-failed",
    severity: "critical",
    description: `Surf reported a failure while exploring ${url} [${outcome.code}]`,
    recommendation:
      "Read the outcome and transport lines in the evidence: the surf command ran and returned an error. Fix the target or the command before relying on browser coverage.",
  };
}

/**
 * The finding a classified CLI outcome renders as.
 *
 * Only `fault` is a statement about the target. `no_evidence` says the command ran and wrote
 * nothing, which is why the recommendation names the declaration that would make that shape
 * legitimate instead of asking anyone to fix a target that may be fine (result-classification
 * packet, refinement; plan S4).
 */
function describeCliOutcome(
  target: string,
  commandDisplay: string,
  outcome: ResultOutcome,
  declarationKey: string,
): SurfRefusalShape {
  if (outcome.basis === "no_evidence") {
    return {
      id: "empty-result",
      severity: "high",
      description: `CLI smoke command produced no output: ${commandDisplay} [${outcome.code}]`,
      recommendation: `The command exited successfully and wrote nothing, so the run obtained no evidence about '${target}'. Point targets.cli at a command that prints, or declare the shape with '${declarationKey}: { output: empty }' (add empty_marker when the command prints a fixed no-results line).`,
    };
  }

  if (outcome.basis === "contradiction") {
    return {
      id: "unclassifiable",
      severity: "critical",
      description: `CLI smoke command answered with a reply the result contract cannot classify: ${commandDisplay} [${outcome.code}]`,
      recommendation:
        "The reply contradicts itself (for example a declared error envelope on a zero exit). Nothing downstream may reinterpret it; capture the raw output and fix the producer.",
    };
  }

  if (outcome.basis === "indeterminate") {
    return {
      id: "outcome-unknown",
      severity: "critical",
      description: `CLI smoke command never reported an outcome: ${commandDisplay} [${outcome.code}]`,
      recommendation:
        "A step that may have changed the target never reported a result, so nothing about the target is known. Inspect the environment by hand before re-running.",
    };
  }

  return {
    id: "help-failed",
    severity: "critical",
    description: `CLI smoke command failed: ${commandDisplay} [${outcome.code}]`,
    recommendation: `Ensure '${target}' is executable and '--help' exits successfully.`,
  };
}

export class CliTesterAgent implements TestAgent {
  private readonly agentName: string;
  private readonly timeoutMs: number;
  private readonly expect: AgentExpect | undefined;

  constructor(
    agentName: string,
    timeoutMs: number = DEFAULT_CLI_TESTER_TIMEOUT_MS,
    expect?: AgentExpect,
  ) {
    this.agentName = agentName;
    this.timeoutMs = timeoutMs;
    this.expect = expect;
  }

  /** The config key this agent's declaration is read from, named in every recommendation. */
  private declarationKey(): string {
    return `agents.${this.agentName}.expect`;
  }

  /**
   * The declaration in force for this agent's steps. The operator's config wins; with no
   * config there is still a declaration, because the framework knows what it ran: `--help`
   * is assumed read-only and its payload is opaque text, which is recorded as the author's
   * claim rather than left implicit (adjudication claims 4, 50).
   */
  private declaration(): ExpectDeclaration {
    return this.expect === undefined
      ? { payload: "opaque", declaredBy: "author:cli-tester" }
      : { ...this.expect, declaredBy: `config:${this.declarationKey()}` };
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
      // The kernel boundary: translation, effect declaration and the spawn transport all live
      // in the adapter, so this step list never touches a process (adjudication claims 2, 21).
      const { raw, invocation } = await invokeAdapter(cliAdapter, {
        id: `${this.agentName}.help`,
        command: targets.cli,
        args: ["--help"],
        timeoutMs: this.timeoutMs,
        subject: targets.cli,
      });
      commandDisplay = invocation.display.join(" ");

      if (raw.spawnFailure) {
        return this.spawnFailure(targets.cli, commandDisplay, raw.spawnFailure);
      }

      const declaration = this.declaration();
      // Exit 0 is not a pass: a command that writes nothing produced no evidence, and only a
      // declaration can make that shape a pass (result-classification packet, region 4).
      const outcome = classifyResult(raw, declaration);

      if (outcome.ok) {
        return {
          findings: [],
          coverage: { edgeCases: 100 },
          outcomes: [outcome],
          expectations: [declaration],
        };
      }

      const shape = describeCliOutcome(targets.cli, commandDisplay, outcome, this.declarationKey());

      return {
        findings: [
          {
            id: `${this.agentName}-${shape.id}`,
            type: "bug",
            severity: shape.severity,
            component: "cli",
            description: shape.description,
            evidence: [
              ...outcome.evidence,
              raw.timedOut
                ? `timed out after ${this.timeoutMs}ms${raw.signal ? ` (${raw.signal})` : ""}`
                : raw.stderr.trim() || raw.stdout.trim() || `exit code ${raw.exitCode}`,
            ],
            recommendation: shape.recommendation,
            timestamp: new Date(),
            outcome,
          },
        ],
        coverage: { edgeCases: 0 },
        outcomes: [outcome],
        expectations: [declaration],
      };
    } catch (error) {
      return this.spawnFailure(
        targets.cli,
        commandDisplay,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** A command that never ran is a framework/environment fault, never target evidence. */
  private spawnFailure(target: string, commandDisplay: string, message: string): AgentResult {
    return {
      findings: [
        {
          id: `${this.agentName}-spawn-failed`,
          type: "bug",
          severity: "critical",
          component: "cli",
          description: `CLI smoke command could not be executed: ${commandDisplay}`,
          evidence: [message],
          recommendation: `Ensure '${target}' exists and is executable in the current environment.`,
          timestamp: new Date(),
        },
      ],
      coverage: { edgeCases: 0 },
    };
  }
}
