/**
 * Kernel config schema for test-capabilities.yaml (operator decision D4).
 *
 * One source for every config key: the orchestrator, the config loader, the
 * init template and the capability matrix all read this file. Nothing under
 * operations/ is imported here, so the file stays a leaf of the import graph
 * (proven by tests/deep_import_contract.test.mjs).
 */

import { z } from "zod";

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

const BombadilTerminalOptionsSchema = z.preprocess(
  (value) => withAliases(value, { command_args: "args" }),
  z
    .object({
      command: z.string().min(1).optional(),
      args: z.array(z.string().min(1)).optional(),
    })
    .strict(),
);

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

/**
 * What the operator declares about the payload this agent's steps produce.
 *
 * An empty payload is the absence of evidence, so the framework refuses to read it as a pass
 * unless someone declared that emptiness is the expected shape (result-classification packet,
 * "Declaring acceptable emptiness"). The keys are the ones `ExpectDeclaration` carries into the
 * classifier, so a declaration travels from the file to the verdict without a hand-written
 * mirror; `declaredBy` is filled in as `config:agents.<name>.expect` at the call site.
 */
export const AgentExpectSchema = z.preprocess(
  (value) => withAliases(value, { emptyMarker: "empty_marker", errorEnvelope: "error_envelope" }),
  z
    .object({
      output: z.enum(["required", "empty"]).optional(),
      empty_marker: z.string().min(1).optional(),
      payload: z.enum(["opaque", "json"]).optional(),
      error_envelope: z.boolean().optional(),
    })
    .strict(),
);

export const AgentConfigSchema = z
  .object({
    type: z.enum(["bombadil", "surf", "api-fuzzer", "cli-tester", "terminal-fuzzer"]),
    enabled: z.boolean().default(true),
    intensity: z.enum(["gentle", "normal", "aggressive"]).default("normal"),
    duration: z.string().optional(),
    focus: z.array(z.string()).optional(),
    expect: AgentExpectSchema.optional(),
    bombadil: BombadilOptionsSchema.optional(),
    terminal: BombadilTerminalOptionsSchema.optional(),
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

/**
 * Where the mutation ledger keeps its receipts, and whether the operator has accepted that the
 * store may not survive the run (mutation-safety packet §Contract; operator decision D5).
 *
 * `dir` is resolved against a base the operation defines (`src/core/run-context.ts`,
 * adjudication claim 47), because `heal`, `init` and `replacement-validation` run without a
 * config file at all. `ephemeral: true` is the operator's declaration that a receipt written
 * here may vanish with the workspace; it is recorded in every receipt written under it, so a
 * receipt never overstates the interlock it belongs to.
 */
export const ReceiptsConfigSchema = z
  .object({
    dir: z.string().min(1).optional(),
    ephemeral: z.boolean().default(false),
  })
  .strict();

/**
 * The operator's declaration of which web origins this repo may act on (architecture review
 * A13, Q1). Empty by default: a mutating step whose subject is a web origin refuses with
 * `mutation_origin_not_allowed` until the origin is named here, Bombadil included. The
 * authority is the operator's, never the framework's.
 */
export const MutationConfigSchema = z.preprocess(
  (value) => withAliases(value, { allow_origins: "allowOrigins" }),
  z
    .object({
      allowOrigins: z.array(z.string().min(1)).default([]),
    })
    .strict(),
);

export const TestCapabilitiesConfigSchema = z
  .object({
    version: z.literal("2.0"),
    name: z.string(),
    targets: TargetSchema,
    agents: z.record(z.string(), AgentConfigSchema).optional(),
    intelligence: IntelligenceSchema.optional(),
    quantum: QuantumSchema.optional(),
    chaos: ChaosSchema.optional(),
    receipts: ReceiptsConfigSchema.optional(),
    mutation: MutationConfigSchema.optional(),
  })
  .strict();

/** The parsed (defaults applied) shape the orchestrator runs on. */
export type ParsedTestCapabilitiesConfig = z.output<typeof TestCapabilitiesConfigSchema>;

/**
 * The config shape kernel checks read. Derived from the schema, never hand-mirrored
 * (adjudication claim 49): a key added to the schema is visible here at once.
 */
export type RuntimeConfigLike = z.infer<typeof TestCapabilitiesConfigSchema>;

export type Target = z.infer<typeof TargetSchema>;
export interface BombadilTerminalOptions {
  command?: string;
  args?: string[];
}

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

/** The declaration keys of `agents.<name>.expect`; see {@link AgentExpectSchema}. */
export interface AgentExpect {
  output?: "required" | "empty";
  empty_marker?: string;
  payload?: "opaque" | "json";
  error_envelope?: boolean;
}

export interface AgentConfig {
  type: "bombadil" | "surf" | "api-fuzzer" | "cli-tester" | "terminal-fuzzer";
  enabled?: boolean;
  intensity?: "gentle" | "normal" | "aggressive";
  duration?: string;
  focus?: string[];
  expect?: AgentExpect;
  bombadil?: BombadilOptions;
  terminal?: BombadilTerminalOptions;
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
/** See {@link ReceiptsConfigSchema}. */
export interface ReceiptsConfig {
  dir?: string;
  ephemeral?: boolean;
}

/** See {@link MutationConfigSchema}. */
export interface MutationConfig {
  allowOrigins?: string[];
}

export interface TestCapabilitiesConfig {
  version: "2.0";
  name: string;
  targets: Target;
  agents?: Record<string, AgentConfig>;
  receipts?: ReceiptsConfig;
  mutation?: MutationConfig;
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
