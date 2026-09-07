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

import { spawn } from "node:child_process";
import process from "node:process";
import { runBombadil, runBombadilTerminalTest } from "../../bombadil-runtime.js";
import type { BombadilOptions, BombadilTerminalOptions, Target } from "../../config.js";
import type { CoverageReport, Finding, Observation } from "../../orchestrator.js";
import { executeSurfExploreOperation } from "../surf-explore-operation.js";

export const DEFAULT_CLI_TESTER_TIMEOUT_MS = 10_000;
const MAX_CLI_TESTER_OUTPUT_CHARS = 64_000;

export interface AgentResult {
  findings: Finding[];
  coverage: Partial<CoverageReport>;
  observations?: Observation[];
  observationSubject?: string;
}

export interface TestAgent {
  execute(targets: Target): Promise<AgentResult>;
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

    return {
      findings: [
        {
          id:
            result.status === "violation"
              ? `${this.agentName}-terminal-violation`
              : `${this.agentName}-runtime-failed`,
          type: "bug",
          severity: result.status === "violation" ? "high" : "critical",
          component: "cli",
          description:
            result.status === "violation"
              ? `Bombadil terminal test surfaced a violation for ${command}`
              : `Bombadil terminal test could not complete for ${command}`,
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
            "Ensure Bombadil 0.5+ is available and the terminal target is safe, deterministic, and bounded before relying on this experimental signal.",
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
              "Ensure the surf CLI (nicobailon/surf-cli with wait.ready and extract) is resolvable through TEST_CAPABILITIES_SURF_BIN, surf on PATH, or ~/.local/bin/surf, and that the browser with the surf extension is running (surf doctor), then re-run the suite.",
            timestamp: new Date(),
          },
        ],
        coverage: { userFlows: 0 },
      };
    }
  }
}

export class CliTesterAgent implements TestAgent {
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
