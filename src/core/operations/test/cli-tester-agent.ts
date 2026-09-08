/**
 * The `cli-tester` sensor as a step list.
 *
 * One step: `<targets.cli> --help` through the CLI adapter, classified by the pure classifier
 * against the declaration in force. Split out of `agents.ts` in slice S10 as the first of the
 * "one file per agent" shrink its structure-budget exception named; `agents.ts` re-exports both
 * names, so every import site is unchanged.
 */
import { invokeAdapter } from "../../adapter.js";
import { cliAdapter } from "../../cli-adapter.js";
import type { AgentExpect, Target } from "../../config.js";
import type { ExpectDeclaration } from "../../result-classification.js";
import { classifyResult } from "../../result-classification.js";
import { AGENT_EFFECTS, describeCliOutcome } from "./agent-findings.js";
import type { AgentResult, TestAgent } from "./agents.js";

export const DEFAULT_CLI_TESTER_TIMEOUT_MS = 10_000;

export class CliTesterAgent implements TestAgent {
  readonly effect = AGENT_EFFECTS["cli-tester"];
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
