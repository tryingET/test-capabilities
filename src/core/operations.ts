import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { HealingProposal } from "../healing/self-healing.js";
import { TestFileHealer } from "../healing/self-healing.js";
import type { QuantumResult } from "../quantum/simulator.js";
import { QuantumTestRunner } from "../quantum/simulator.js";
import type { CoverageReport, TestCapabilitiesConfig, TestResult } from "./orchestrator.js";
import { TestCapabilitiesConfigSchema, TestCapabilitiesOrchestrator } from "./orchestrator.js";
import { renderUnsupported } from "./runtime-contract.js";

export type OperationStatus = "implemented" | "unsupported";
export type CliCommand = "test" | "surf" | "predict" | "quantum" | "heal" | "visualize" | "report";
export type SurfAction = "explore" | "flow" | "assert" | "compare" | "replay";
export type OperationId = "test" | "surf.explore" | "quantum" | "heal";
export type CliRoute =
  | { command: "test" }
  | { command: "surf"; action: SurfAction }
  | { command: "predict" }
  | { command: "quantum" }
  | { command: "heal" }
  | { command: "visualize" }
  | { command: "report" };

export interface CliRouteManifestEntry {
  command: CliCommand;
  action?: SurfAction;
  status: OperationStatus;
  operationId?: OperationId;
  description: string;
}

export interface TestOperationInput {
  target?: string;
  config?: string;
  autonomous?: boolean;
  selfHeal?: boolean;
  predict?: boolean;
  quick?: boolean;
  failThreshold?: string;
  uploadArtifacts?: boolean;
  report?: string;
}

export interface SurfExploreOperationInput {
  url?: string;
  depth?: string;
  record?: boolean;
  validate?: boolean;
  baseline?: string;
  aiDiff?: boolean;
  file?: string;
}

export interface QuantumOperationInput {
  target?: string;
  branches?: string;
  collapse?: boolean;
}

export interface HealOperationInput {
  dir?: string;
  dryRun?: boolean;
}

export interface TestOperationSummary {
  health: "pass" | "fail";
  findings: number;
  coverage: CoverageReport;
  predictions: number;
  quantumUniverses?: number;
}

export interface TestOperationResultEnvelope {
  operationId: "test";
  mode: "quick" | "standard";
  input: Required<Pick<TestOperationInput, "config" | "quick">> &
    Omit<TestOperationInput, "config" | "quick">;
  effectiveConfig: TestCapabilitiesConfig;
  summary: TestOperationSummary;
  result: TestResult;
}

export interface SurfExploreOperationResultEnvelope {
  operationId: "surf.explore";
  input: Required<Pick<SurfExploreOperationInput, "url">> & Omit<SurfExploreOperationInput, "url">;
  result: {
    command: "surf";
    args: string[];
    stdout: string;
    stderr: string;
    code: number;
  };
}

export interface QuantumOperationResultEnvelope {
  operationId: "quantum";
  input: Required<Pick<QuantumOperationInput, "target" | "branches" | "collapse">>;
  result: QuantumResult;
}

export interface HealOperationResultEnvelope {
  operationId: "heal";
  input: Required<Pick<HealOperationInput, "dir" | "dryRun">>;
  proposals: HealingProposal[];
  appliedCount: number;
}

export type CliOperationResult =
  | TestOperationResultEnvelope
  | SurfExploreOperationResultEnvelope
  | QuantumOperationResultEnvelope
  | HealOperationResultEnvelope;

interface OperationDefinition<TInput, TResult extends CliOperationResult> {
  id: OperationId;
  route: Extract<CliRoute, { command: CliCommand }>;
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<TResult>;
}

const unsupportedTestOptionGuidance =
  "Use only --config, --target, and --quick until the remaining paths are implemented.";

export const TEST_OPTION_SUPPORT = {
  target: "implemented",
  config: "implemented",
  quick: "implemented",
  autonomous: "unsupported",
  selfHeal: "unsupported",
  predict: "unsupported",
  failThreshold: "unsupported",
  uploadArtifacts: "unsupported",
  report: "unsupported",
} as const satisfies Record<string, OperationStatus>;

const TestOperationInputSchema = z
  .object({
    target: z.string().optional(),
    config: z.string().default("test-capabilities.yaml"),
    autonomous: z.boolean().optional().default(false),
    selfHeal: z.boolean().optional().default(false),
    predict: z.boolean().optional().default(false),
    quick: z.boolean().optional().default(false),
    failThreshold: z.string().optional(),
    uploadArtifacts: z.boolean().optional().default(false),
    report: z.string().optional(),
  })
  .transform((input) => {
    assertSupportedTestOptions(input);
    return input;
  });

const SurfExploreOperationInputSchema = z.object({
  url: z.string().optional().default("about:blank"),
  depth: z.string().optional().default("3"),
  record: z.boolean().optional().default(false),
  validate: z.boolean().optional().default(false),
  baseline: z.string().optional(),
  aiDiff: z.boolean().optional().default(false),
  file: z.string().optional(),
});

const QuantumOperationInputSchema = z.object({
  target: z.string().optional().default("https://example.com"),
  branches: z.string().optional().default("100"),
  collapse: z.boolean().optional().default(false),
});

const HealOperationInputSchema = z.object({
  dir: z.string().optional().default("./tests"),
  dryRun: z.boolean().optional().default(false),
});

const TEST_OPERATION = {
  id: "test",
  route: { command: "test" },
  description: "Run the capability-backed orchestrator path",
  inputSchema: TestOperationInputSchema,
  execute: executeTestOperation,
} satisfies OperationDefinition<TestOperationInput, TestOperationResultEnvelope>;

const SURF_EXPLORE_OPERATION = {
  id: "surf.explore",
  route: { command: "surf", action: "explore" },
  description: "Run the real surf CLI through the supported explore action",
  inputSchema: SurfExploreOperationInputSchema,
  execute: executeSurfExploreOperation,
} satisfies OperationDefinition<SurfExploreOperationInput, SurfExploreOperationResultEnvelope>;

const QUANTUM_OPERATION = {
  id: "quantum",
  route: { command: "quantum" },
  description: "Run the shared quantum simulator",
  inputSchema: QuantumOperationInputSchema,
  execute: executeQuantumOperation,
} satisfies OperationDefinition<QuantumOperationInput, QuantumOperationResultEnvelope>;

const HEAL_OPERATION = {
  id: "heal",
  route: { command: "heal" },
  description: "Run the selector-healing workflow",
  inputSchema: HealOperationInputSchema,
  execute: executeHealOperation,
} satisfies OperationDefinition<HealOperationInput, HealOperationResultEnvelope>;

export const CLI_OPERATION_REGISTRY = {
  test: TEST_OPERATION,
  "surf.explore": SURF_EXPLORE_OPERATION,
  quantum: QUANTUM_OPERATION,
  heal: HEAL_OPERATION,
} as const;

export const CLI_ROUTE_MANIFEST = [
  {
    command: "test",
    status: "implemented",
    operationId: "test",
    description: TEST_OPERATION.description,
  },
  {
    command: "surf",
    status: "implemented",
    description: "Command group for surf-backed browser operations",
  },
  {
    command: "surf",
    action: "explore",
    status: "implemented",
    operationId: "surf.explore",
    description: SURF_EXPLORE_OPERATION.description,
  },
  {
    command: "surf",
    action: "flow",
    status: "unsupported",
    description: "Registered surf action that currently fails clearly",
  },
  {
    command: "surf",
    action: "assert",
    status: "unsupported",
    description: "Registered surf action that currently fails clearly",
  },
  {
    command: "surf",
    action: "compare",
    status: "unsupported",
    description: "Registered surf action that currently fails clearly",
  },
  {
    command: "surf",
    action: "replay",
    status: "unsupported",
    description: "Registered surf action that currently fails clearly",
  },
  {
    command: "quantum",
    status: "implemented",
    operationId: "quantum",
    description: QUANTUM_OPERATION.description,
  },
  {
    command: "heal",
    status: "implemented",
    operationId: "heal",
    description: HEAL_OPERATION.description,
  },
  {
    command: "predict",
    status: "unsupported",
    description: "Registered command that currently fails clearly",
  },
  {
    command: "visualize",
    status: "unsupported",
    description: "Registered command that currently fails clearly",
  },
  {
    command: "report",
    status: "unsupported",
    description: "Registered command that currently fails clearly",
  },
] as const satisfies readonly CliRouteManifestEntry[];

export function resolveCliRoute(route: CliRoute): CliRouteManifestEntry | undefined {
  const routeAction = "action" in route ? route.action : undefined;

  return CLI_ROUTE_MANIFEST.find((entry) => {
    const entryAction = "action" in entry ? entry.action : undefined;
    return entry.command === route.command && entryAction === routeAction;
  });
}

export function getCliCommandStatus(command: CliCommand): OperationStatus | undefined {
  return CLI_ROUTE_MANIFEST.find((entry) => entry.command === command && !("action" in entry))
    ?.status;
}

export function getSurfActionStatus(action: SurfAction): OperationStatus | undefined {
  return CLI_ROUTE_MANIFEST.find(
    (entry) => entry.command === "surf" && "action" in entry && entry.action === action,
  )?.status;
}

export function assertSupportedTestOptions(
  options: Partial<Record<keyof typeof TEST_OPTION_SUPPORT, unknown>>,
): void {
  const unsupported = Object.entries(TEST_OPTION_SUPPORT)
    .filter(
      ([key, status]) => status !== "implemented" && Boolean(options[key as keyof typeof options]),
    )
    .map(([key]) => `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`);

  if (unsupported.length > 0) {
    throw renderUnsupported("option(s) for 'test'", unsupported, unsupportedTestOptionGuidance);
  }
}

export async function executeCliOperation(
  route: Extract<CliRoute, { command: "test" }>,
  rawInput: TestOperationInput,
): Promise<TestOperationResultEnvelope>;
export async function executeCliOperation(
  route: Extract<CliRoute, { command: "surf"; action: "explore" }>,
  rawInput: SurfExploreOperationInput,
): Promise<SurfExploreOperationResultEnvelope>;
export async function executeCliOperation(
  route: Extract<CliRoute, { command: "quantum" }>,
  rawInput: QuantumOperationInput,
): Promise<QuantumOperationResultEnvelope>;
export async function executeCliOperation(
  route: Extract<CliRoute, { command: "heal" }>,
  rawInput: HealOperationInput,
): Promise<HealOperationResultEnvelope>;
export async function executeCliOperation(
  route: CliRoute,
  rawInput:
    | TestOperationInput
    | SurfExploreOperationInput
    | QuantumOperationInput
    | HealOperationInput,
): Promise<CliOperationResult> {
  const manifestEntry = resolveCliRoute(route);

  if (!manifestEntry) {
    throw new Error(`Unregistered CLI route: ${JSON.stringify(route)}`);
  }

  if (manifestEntry.status !== "implemented" || !manifestEntry.operationId) {
    if (route.command === "surf") {
      throw renderUnsupported(
        "surf action(s)",
        [route.action],
        "Only 'explore' is currently backed by a real surf execution path.",
      );
    }

    throw renderUnsupported(
      "CLI command(s)",
      [route.command],
      "This command currently has no capability-backed implementation.",
    );
  }

  switch (manifestEntry.operationId) {
    case "test":
      return TEST_OPERATION.execute(rawInput as TestOperationInput);
    case "surf.explore":
      return SURF_EXPLORE_OPERATION.execute(rawInput as SurfExploreOperationInput);
    case "quantum":
      return QUANTUM_OPERATION.execute(rawInput as QuantumOperationInput);
    case "heal":
      return HEAL_OPERATION.execute(rawInput as HealOperationInput);
    default: {
      const unhandledOperation: never = manifestEntry.operationId;
      throw new Error(`Unhandled operation id: ${unhandledOperation}`);
    }
  }
}

export async function executeTestOperation(
  input: TestOperationInput,
): Promise<TestOperationResultEnvelope> {
  const normalized = TestOperationInputSchema.parse(input);
  let config = loadConfig(normalized.config);
  config = applyTargetOverride(config, normalized.target);

  if (normalized.quick) {
    config = applyQuickMode(config);
  }

  const result = await runSuite(config);

  return {
    operationId: "test",
    mode: normalized.quick ? "quick" : "standard",
    input: normalized,
    effectiveConfig: config,
    summary: summarizeTestResult(result),
    result,
  };
}

export async function executeSurfExploreOperation(
  input: SurfExploreOperationInput,
): Promise<SurfExploreOperationResultEnvelope> {
  const normalized = SurfExploreOperationInputSchema.parse(input);
  const args = ["go", normalized.url];
  const result = await runCommand("surf", args);

  return {
    operationId: "surf.explore",
    input: normalized,
    result: {
      command: "surf",
      args,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    },
  };
}

export async function executeQuantumOperation(
  input: QuantumOperationInput,
): Promise<QuantumOperationResultEnvelope> {
  const normalized = QuantumOperationInputSchema.parse(input);
  const runner = new QuantumTestRunner({
    branches: Number(normalized.branches),
    collapseStrategy: normalized.collapse ? "significance" : "coverage",
    seed: 42,
  });

  return {
    operationId: "quantum",
    input: normalized,
    result: await runner.run(normalized.target),
  };
}

export async function executeHealOperation(
  input: HealOperationInput,
): Promise<HealOperationResultEnvelope> {
  const normalized = HealOperationInputSchema.parse(input);
  const healer = new TestFileHealer();
  const files = collectFiles(path.resolve(normalized.dir));
  const proposals: HealingProposal[] = [];

  for (const file of files) {
    const fileProposals = await healer.analyzeFile(file);
    proposals.push(...fileProposals);
  }

  if (!normalized.dryRun) {
    for (const proposal of proposals) {
      await healer.applyProposal(proposal);
    }
  }

  return {
    operationId: "heal",
    input: normalized,
    proposals,
    appliedCount: normalized.dryRun ? 0 : proposals.length,
  };
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function applyTargetOverride(
  config: TestCapabilitiesConfig,
  target?: string,
): TestCapabilitiesConfig {
  if (!target) {
    return config;
  }

  const targets = { ...(config.targets ?? {}) };
  if (isUrl(target)) {
    targets.web = target;
  } else {
    targets.cli = target;
  }

  return {
    ...config,
    targets,
  };
}

function withIntelligenceOverrides(
  config: TestCapabilitiesConfig,
  overrides: Partial<NonNullable<TestCapabilitiesConfig["intelligence"]>>,
): TestCapabilitiesConfig {
  const current = config.intelligence ?? {
    selfHealing: false,
    prediction: false,
    correlation: true,
    collective: false,
  };

  return {
    ...config,
    intelligence: {
      selfHealing: current.selfHealing,
      prediction: current.prediction,
      correlation: current.correlation,
      collective: current.collective,
      ...overrides,
    },
  };
}

function withQuantumOverrides(
  config: TestCapabilitiesConfig,
  overrides: Partial<NonNullable<TestCapabilitiesConfig["quantum"]>>,
): TestCapabilitiesConfig {
  const current = config.quantum ?? {
    enabled: false,
    branches: 100,
    collapseStrategy: "significance",
    maxDepth: 20,
  };

  return {
    ...config,
    quantum: {
      enabled: current.enabled,
      branches: current.branches,
      collapseStrategy: current.collapseStrategy,
      maxDepth: current.maxDepth,
      timeout: current.timeout,
      ...overrides,
    },
  };
}

function applyQuickMode(config: TestCapabilitiesConfig): TestCapabilitiesConfig {
  return withQuantumOverrides(withIntelligenceOverrides(config, { prediction: false }), {
    enabled: false,
  });
}

function loadConfig(file: string): TestCapabilitiesConfig {
  const configPath = path.resolve(file);

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = yaml.load(fs.readFileSync(configPath, "utf8")) ?? {};
  return TestCapabilitiesConfigSchema.parse(raw);
}

async function runSuite(config: TestCapabilitiesConfig): Promise<TestResult> {
  const orchestrator = new TestCapabilitiesOrchestrator(config);
  return orchestrator.run();
}

function summarizeTestResult(result: TestResult): TestOperationSummary {
  return {
    health: result.passed ? "pass" : "fail",
    findings: result.findings.length,
    coverage: result.coverage,
    predictions: result.predictions?.length ?? 0,
    quantumUniverses: result.quantumInsights?.universesSimulated,
  };
}

function collectFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }

    if (/\.(c|m)?[jt]sx?$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`));
    });

    proc.on("error", (error) => {
      reject(new Error(`Failed to run ${command}: ${error.message}`));
    });
  });
}
