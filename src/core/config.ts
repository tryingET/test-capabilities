/**
 * Kernel config schema for test-capabilities.yaml (operator decision D4).
 *
 * One source for every config key: the orchestrator, the config loader, the
 * init template and the capability matrix all read this file. Nothing under
 * operations/ is imported here, so the file stays a leaf of the import graph
 * (proven by tests/deep_import_contract.test.mjs).
 */

import { z } from "zod";
import { parseFrameHint } from "./frame-root-cause.js";

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

/**
 * Which second observation channels this agent's browser runs attach (a11y-snapshot packet,
 * "Config keys"; slice S9).
 *
 * `off` is the default, so an existing config produces a byte-identical envelope. `optional`
 * records an `unavailable` observation and continues; `required` fails the page as unverified
 * with the reason - which is the whole point of having a mode rather than a boolean: a channel
 * that silently skips is indistinguishable from a channel that found nothing.
 */
export const ObservationConfigSchema = z.preprocess(
  (value) => withAliases(value, { a11y_snapshot: "a11ySnapshot" }),
  z
    .object({
      a11ySnapshot: z.enum(["off", "optional", "required"]).default("off"),
    })
    .strict(),
);

export const AgentConfigSchema = z.preprocess(
  (value) => withAliases(value, { ready_selector: "readySelector", frame_hint: "frameHint" }),
  z
    .object({
      type: z.enum(["bombadil", "surf", "api-fuzzer", "cli-tester", "terminal-fuzzer"]),
      enabled: z.boolean().default(true),
      intensity: z.enum(["gentle", "normal", "aggressive"]).default("normal"),
      duration: z.string().optional(),
      focus: z.array(z.string()).optional(),
      expect: AgentExpectSchema.optional(),
      observation: ObservationConfigSchema.optional(),
      /**
       * A visible CSS selector the surf agent's readiness gate waits for (AK #5568). A page
       * that is ready but never shows it is an element-reach failure, which is what takes a
       * frame determination; without it a `test` run names no element and cannot fail to
       * reach one. Surf only: on any other agent nothing would wait for it.
       */
      readySelector: z.string().min(1).optional(),
      /**
       * `urlPrefix=<prefix>` or `selector=<css>`: the test author's assertion of the frame the
       * readySelector target lives in, and the only way a `test` run reaches a `confirmed`
       * determination (AK #5885). Read by the same strict parser as `--frame-hint`.
       */
      frameHint: z.string().optional(),
      bombadil: BombadilOptionsSchema.optional(),
      terminal: BombadilTerminalOptionsSchema.optional(),
    })
    .strict()
    .superRefine((agent, context) => {
      for (const key of ["readySelector", "frameHint"] as const) {
        if (agent[key] !== undefined && agent.type !== "surf") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is read only by 'surf' agents; a '${agent.type}' agent would ignore it.`,
          });
        }
      }
      if (agent.frameHint === undefined) {
        return;
      }
      if (agent.readySelector === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frameHint"],
          message:
            "frameHint needs readySelector: the hint says which frame a failing selector lives in, and without one nothing in the run can fail to be reached.",
        });
      }
      try {
        parseFrameHint(agent.frameHint);
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["frameHint"],
          message: `frameHint must be 'urlPrefix=<prefix>' or 'selector=<css>'; got '${agent.frameHint}'.`,
        });
      }
    }),
);

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

/**
 * The two bounded waits the submit gate needs (submit-gate packet §4.2).
 *
 * `postconditionTimeoutMs` bounds the wait for the effect the operator expects to see after the
 * one click; when it runs out the outcome is `unknown`, never a retry. `controlEnableTimeoutMs`
 * bounds the wait for a submit control that is disabled until the form validates - a plan-time
 * refusal would make asynchronous validation look like a broken plan (packet, Refinement D4).
 */
export const SurfSubmitConfigSchema = z.preprocess(
  (value) =>
    withAliases(value, {
      postcondition_timeout_ms: "postconditionTimeoutMs",
      control_enable_timeout_ms: "controlEnableTimeoutMs",
    }),
  z
    .object({
      postconditionTimeoutMs: z.number().int().positive().default(15_000),
      controlEnableTimeoutMs: z.number().int().positive().default(5_000),
    })
    .strict(),
);

/** The `surf` section of the config; `surf.receipts.dir` does not exist (review A1). */
export const SurfConfigSchema = z
  .object({
    submit: SurfSubmitConfigSchema.optional(),
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
    receipts: ReceiptsConfigSchema.optional(),
    mutation: MutationConfigSchema.optional(),
    surf: SurfConfigSchema.optional(),
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

/** See {@link ObservationConfigSchema}. */
export interface ObservationConfig {
  a11ySnapshot?: "off" | "optional" | "required";
}

export interface AgentConfig {
  type: "bombadil" | "surf" | "api-fuzzer" | "cli-tester" | "terminal-fuzzer";
  enabled?: boolean;
  intensity?: "gentle" | "normal" | "aggressive";
  duration?: string;
  focus?: string[];
  expect?: AgentExpect;
  observation?: ObservationConfig;
  /** surf agents only; see {@link AgentConfigSchema} */
  readySelector?: string;
  /** surf agents only, and only with `readySelector`; see {@link AgentConfigSchema} */
  frameHint?: string;
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

/** See {@link SurfSubmitConfigSchema}. */
export interface SurfSubmitConfig {
  postconditionTimeoutMs?: number;
  controlEnableTimeoutMs?: number;
}

/** See {@link SurfConfigSchema}. */
export interface SurfConfig {
  submit?: SurfSubmitConfig;
}

export interface TestCapabilitiesConfig {
  version: "2.0";
  name: string;
  targets: Target;
  agents?: Record<string, AgentConfig>;
  receipts?: ReceiptsConfig;
  mutation?: MutationConfig;
  surf?: SurfConfig;
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
