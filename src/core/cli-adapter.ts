/**
 * The `cli` adapter: an arbitrary target command line, run once with a bounded budget.
 *
 * Resolution is the caller's command line (there is no tool to find), the probe is honest
 * about not having one, translation is the shell-free command-line parse, and the effect
 * declaration is the one the mutation-safety packet writes for the CLI tester: read-only by
 * assumption, not by verification. `invoke` goes through the kernel spawn transport like every
 * other adapter (implementation plan S3 commit (2)).
 */

import process from "node:process";
import type {
  Adapter,
  AdapterContext,
  AdapterEffect,
  AdapterInvocation,
  AdapterStep,
} from "./adapter.js";
import type { ExpectDeclaration, RawResult, ResultOutcome } from "./result-classification.js";
import { classifyResult } from "./result-classification.js";
import { spawnStep } from "./spawn-step.js";

export const DEFAULT_CLI_STEP_TIMEOUT_MS = 10_000;

export interface CliAdapterResolution {
  env: NodeJS.ProcessEnv;
}

export interface CliAdapterProbe {
  /** the adapter runs the target itself; it never probes an unknown binary for capabilities */
  versionProbed: false;
  notes: string[];
}

/** Splits a target command line into command and args without a shell. */
export function parseCommandLine(commandLine: string): { command: string; args: string[] } {
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

export const cliAdapter: Adapter<CliAdapterResolution, CliAdapterProbe> = {
  id: "cli",

  resolve(env: NodeJS.ProcessEnv = process.env): CliAdapterResolution {
    return { env };
  },

  probe(): CliAdapterProbe {
    return {
      versionProbed: false,
      notes: [
        "the cli adapter drives an operator-configured command line; it has no capability probe",
      ],
    };
  },

  translate(step: AdapterStep): AdapterInvocation {
    const parsed = parseCommandLine(step.command);
    const args = [...parsed.args, ...(step.args ?? [])];
    return {
      source: "cli",
      command: parsed.command,
      args,
      timeoutMs: step.timeoutMs ?? DEFAULT_CLI_STEP_TIMEOUT_MS,
      ...(step.env ? { env: step.env } : {}),
      display: [parsed.command, ...args],
    };
  },

  effects(): AdapterEffect {
    return {
      effect: "read_only",
      reason: "runs the configured command with --help only; assumed read-only, not verified",
    };
  },

  invoke(invocation: AdapterInvocation, context: AdapterContext = {}): Promise<RawResult> {
    return spawnStep({
      source: "cli",
      command: invocation.command,
      args: invocation.args,
      timeoutMs: invocation.timeoutMs,
      ...((invocation.env ?? context.env) ? { env: invocation.env ?? context.env } : {}),
      ...(invocation.maxOutputChars ? { maxOutputChars: invocation.maxOutputChars } : {}),
    });
  },

  normalize(raw: RawResult, declaration?: ExpectDeclaration): ResultOutcome {
    return classifyResult(raw, declaration);
  },
};
