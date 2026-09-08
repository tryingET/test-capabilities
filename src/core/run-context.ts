/**
 * The run: one identity, one receipt store, one ledger, minted by the kernel.
 *
 * Mediated ring. `executeCliOperation` mints a `RunContext` before it resolves an operation's
 * effect class and passes it to `execute`, so every operation - and every operation nested
 * inside one - shares a run id, a ledger and a store (architecture review A5, adjudication
 * claim 1). Nothing below the kernel invents a run.
 *
 * Where the receipts live is defined per operation, because `heal`, `init` and
 * `replacement-validation` run without a config file at all (adjudication claim 47):
 *
 *   | operation                    | base for a relative `receipts.dir` |
 *   |------------------------------|------------------------------------|
 *   | `test`                       | the directory of `--config`        |
 *   | `heal`                       | `--dir`                            |
 *   | everything else              | the working directory              |
 *
 * `TEST_CAPABILITIES_RECEIPTS_DIR` overrides all of them, and is the only way to move the
 * store for an operation that takes no config.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import type { Adapter } from "./adapter.js";
import { FileReceiptStore } from "./artifacts.js";
import { bombadilAdapter } from "./bombadil-runtime.js";
import { cliAdapter } from "./cli-adapter.js";
import { MutationConfigSchema, ReceiptsConfigSchema, SurfSubmitConfigSchema } from "./config.js";
import type { EffectDeclaration, LedgerContext } from "./effects.js";
import { MutationLedger, resolveEffectDeclaration } from "./effects.js";
import type { MutationReceiptEnvelopeCopy, ReceiptStore } from "./receipt-store.js";
import { surfAdapter } from "./surf-adapter.js";

export const RECEIPTS_DIR_ENV = "TEST_CAPABILITIES_RECEIPTS_DIR";
export const RECEIPTS_EPHEMERAL_ENV = "TEST_CAPABILITIES_RECEIPTS_EPHEMERAL";
export const DEFAULT_RECEIPTS_DIR = ".test-capabilities/receipts";

export interface ReceiptsSettings {
  /** the resolved absolute directory */
  dir: string;
  /** the operator accepted a store that may not survive the run (operator decision D5) */
  ephemeral: boolean;
  /** why this store looks ephemeral, when it does; a mutating step refuses unless accepted */
  ephemeralDetected?: string;
  /** the directory a relative `receipts.dir` was resolved against */
  base: string;
  /** how the directory was chosen, for `doctor` and for refusals */
  source: string;
}

export interface RunMutationSettings {
  allowOrigins: string[];
}

/** The bounded waits the submit gate reads, with the schema's defaults applied (S7). */
export interface RunSurfSettings {
  submit: { postconditionTimeoutMs: number; controlEnableTimeoutMs: number };
}

export interface RunConfigView {
  receipts: ReceiptsSettings;
  mutation: RunMutationSettings;
  surf: RunSurfSettings;
  /** the config file the world was read from, named in every refusal that consults it */
  configPath?: string;
}

export interface RunContext extends LedgerContext {
  runId: string;
  startedAt: string;
  operationId: string;
  effect: EffectDeclaration;
  config: RunConfigView;
  receiptStore: ReceiptStore;
  ledger: MutationLedger;
  adapters: Readonly<Record<string, Adapter<never, never>>>;
  supersedeReceiptId?: string;
}

/** The adapters a run may drive; S6 and S9 add the session and the a11y channel to this map. */
export function defaultAdapters(): Readonly<Record<string, Adapter<never, never>>> {
  return Object.freeze({
    cli: cliAdapter,
    surf: surfAdapter,
    bombadil: bombadilAdapter,
  } as unknown as Record<string, Adapter<never, never>>);
}

function isTruthyFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realPathOrSelf(candidate: string): string {
  try {
    return fs.realpathSync(candidate);
  } catch {
    return candidate;
  }
}

/**
 * Does this store survive the run? A directory under `$TMPDIR`, inside a CI job workspace or
 * inside a linked git worktree does not, and an interlock that clears itself when the workspace
 * is thrown away is not an interlock (operator decision D5; mutation-safety packet, School 3).
 * The answer is a reason string, so every refusal can say what was detected.
 */
export function detectEphemeralStore(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const resolved = path.resolve(dir);
  const candidates = [resolved, realPathOrSelf(resolved)];

  // The caller's environment is the authority on where its temporary directory is; only when
  // it names none does the process default apply.
  const declaredTempRoots = [env.TMPDIR, env.TMP, env.TEMP].filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  const tempRoots = (declaredTempRoots.length > 0 ? declaredTempRoots : [os.tmpdir()]).flatMap(
    (entry) => [path.resolve(entry), realPathOrSelf(path.resolve(entry))],
  );
  for (const root of tempRoots) {
    if (candidates.some((candidate) => isInside(candidate, root))) {
      return `receipts.dir is inside the temporary directory ${root}`;
    }
  }

  if (isTruthyFlag(env.CI)) {
    const workspace = env.GITHUB_WORKSPACE;
    if (workspace === undefined || candidates.some((candidate) => isInside(candidate, workspace))) {
      return workspace === undefined
        ? "CI is set, so this workspace is a job workspace"
        : `receipts.dir is inside the CI job workspace ${workspace}`;
    }
  }

  for (let current = resolved; ; ) {
    const gitPath = path.join(current, ".git");
    let stat: fs.Stats | undefined;
    try {
      stat = fs.lstatSync(gitPath);
    } catch {
      stat = undefined;
    }
    if (stat?.isFile()) {
      return `receipts.dir is inside the linked git worktree ${current}`;
    }
    if (stat?.isDirectory()) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return undefined;
}

/** The two input fields the receipts base is derived from; every parsed input may carry them. */
type ReceiptsInput = { config?: unknown; dir?: unknown };

/** The base a relative `receipts.dir` is resolved against, per operation (claim 47). */
export function receiptsBaseFor(
  operationId: string,
  input: ReceiptsInput | undefined,
  cwd: string,
): { base: string; source: string } {
  if (
    CONFIG_SCOPED_OPERATIONS.has(operationId) &&
    typeof input?.config === "string" &&
    input.config.length > 0
  ) {
    return {
      base: path.dirname(path.resolve(cwd, input.config)),
      source: `the directory of --config ${input.config}`,
    };
  }
  if (operationId === "heal" && typeof input?.dir === "string" && input.dir.length > 0) {
    return { base: path.resolve(cwd, input.dir), source: `--dir ${input.dir}` };
  }
  return { base: path.resolve(cwd), source: "the working directory" };
}

export interface ConfigReceiptsSection {
  receipts?: { dir?: string; ephemeral: boolean };
  mutation?: { allowOrigins: string[] };
  surf?: { submit?: { postconditionTimeoutMs: number; controlEnableTimeoutMs: number } };
}

/**
 * The operations whose world is declared in a config file (operator decision D4, adjudication
 * claim 48): `test`, and the two submit-gate operations, which read `mutation.allowOrigins`,
 * `receipts.dir` and `surf.submit.*` through the same `--config` lookup.
 */
const CONFIG_SCOPED_OPERATIONS = new Set(["test", "surf.plan", "surf.apply"]);

/**
 * Read `receipts` and `mutation` out of a config file without loading the whole config.
 *
 * A file that is missing or unreadable yields nothing: the operation that needs the config
 * raises its own `config_not_found`/`config_invalid` a moment later, and that message is the
 * useful one. A file that *has* these sections but declares them wrongly still fails here,
 * because a mis-declared interlock must not resolve to a default.
 */
export function readConfigReceiptsSection(configPath: string): ConfigReceiptsSection {
  let raw: unknown;
  try {
    raw = yaml.load(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const surf = isRecord(record.surf) ? record.surf : undefined;
  return {
    ...(record.receipts === undefined
      ? {}
      : { receipts: ReceiptsConfigSchema.parse(record.receipts) }),
    ...(record.mutation === undefined
      ? {}
      : { mutation: MutationConfigSchema.parse(record.mutation) as { allowOrigins: string[] } }),
    ...(surf?.submit === undefined
      ? {}
      : {
          surf: {
            submit: SurfSubmitConfigSchema.parse(surf.submit) as {
              postconditionTimeoutMs: number;
              controlEnableTimeoutMs: number;
            },
          },
        }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The fields every operation envelope gains (mutation-safety packet, "Envelope changes"). They
 * are additive and optional, so an envelope built before the kernel filled them is still valid;
 * `finalizeEnvelope` fills them for every operation the kernel runs.
 */
/**
 * Resolve an operation's declaration and mint its run in one step. Every entry point uses it -
 * the CLI dispatcher and the library `execute<X>Operation` wrappers alike - so no operation can
 * reach the world without a class (mutation-safety packet, "Declaration points").
 */
export function mintOperationContext<TInput extends object>(
  operationId: string,
  effect: EffectDeclaration | ((input: TInput) => EffectDeclaration),
  input: TInput,
  overrides: Partial<CreateRunContextOptions> = {},
): RunContext {
  const declaration = resolveEffectDeclaration(
    typeof effect === "function" ? effect(input) : effect,
    `operation '${operationId}'`,
  );
  return createRunContext({ operationId, effect: declaration, input, ...overrides });
}

export interface OperationEffectEnvelope {
  /** the run that produced this envelope; a nested operation shares its parent's id */
  runId?: string;
  /** the class this operation resolved to, with the reason rendered (adjudication claim 50) */
  effect?: EffectDeclaration;
  /** the redacted receipts of the run: hashes, codes, refs and counts (review A10) */
  mutations?: MutationReceiptEnvelopeCopy[];
}

/**
 * Stamp the run identity, the effect class and the run's receipts onto an envelope.
 *
 * `runId` and `mutations` belong to the *run*, so a nested operation reports its parent's; the
 * class belongs to the *operation*, so a nested one reports its own and `effect` defaults to the
 * run's only when the caller does not say otherwise.
 */
export function finalizeEnvelope<T extends object>(
  envelope: T,
  context: RunContext,
  effect: EffectDeclaration = context.effect,
): T & OperationEffectEnvelope {
  return {
    ...envelope,
    runId: context.runId,
    effect,
    mutations: context.ledger.envelopeReceipts(),
  };
}

export interface CreateRunContextOptions {
  operationId: string;
  effect: EffectDeclaration;
  /** the parsed operation input; only `config` and `dir` are read, for the receipts base */
  input?: object;
  /** a config the caller has already parsed; it wins over the file on disk */
  config?: {
    receipts?: { dir?: string; ephemeral?: boolean };
    mutation?: { allowOrigins?: string[] };
    surf?: { submit?: { postconditionTimeoutMs?: number; controlEnableTimeoutMs?: number } };
  };
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** tests and future stores substitute their own implementation */
  receiptStore?: ReceiptStore;
  supersedeReceiptId?: string;
  runId?: string;
}

export function resolveReceiptsSettings(options: CreateRunContextOptions): ReceiptsSettings {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const { base, source } = receiptsBaseFor(
    options.operationId,
    options.input as ReceiptsInput | undefined,
    cwd,
  );

  const inputPaths = (options.input ?? {}) as ReceiptsInput;
  const fromFile =
    options.config === undefined &&
    CONFIG_SCOPED_OPERATIONS.has(options.operationId) &&
    typeof inputPaths.config === "string"
      ? readConfigReceiptsSection(path.resolve(cwd, inputPaths.config))
      : {};
  const declared = options.config?.receipts ?? fromFile.receipts;

  const fromEnv = env[RECEIPTS_DIR_ENV];
  const resolved =
    typeof fromEnv === "string" && fromEnv.trim() !== ""
      ? { dir: path.resolve(cwd, fromEnv.trim()), source: `${RECEIPTS_DIR_ENV}` }
      : declared?.dir
        ? {
            dir: path.resolve(base, declared.dir),
            source: `receipts.dir, resolved against ${source}`,
          }
        : { dir: path.resolve(base, DEFAULT_RECEIPTS_DIR), source: `the default, under ${source}` };

  const ephemeral = isTruthyFlag(env[RECEIPTS_EPHEMERAL_ENV]) || declared?.ephemeral === true;
  const detected = detectEphemeralStore(resolved.dir, env);

  return {
    dir: resolved.dir,
    ephemeral,
    ...(detected === undefined ? {} : { ephemeralDetected: detected }),
    base,
    source: resolved.source,
  };
}

function resolveAllowOrigins(options: CreateRunContextOptions): string[] {
  const cwd = options.cwd ?? process.cwd();
  if (options.config?.mutation?.allowOrigins) {
    return [...options.config.mutation.allowOrigins];
  }
  if (options.config !== undefined) {
    return [];
  }
  const inputPaths = (options.input ?? {}) as ReceiptsInput;
  if (CONFIG_SCOPED_OPERATIONS.has(options.operationId) && typeof inputPaths.config === "string") {
    return [
      ...(readConfigReceiptsSection(path.resolve(cwd, inputPaths.config)).mutation?.allowOrigins ??
        []),
    ];
  }
  return [];
}

/** The submit gate's bounded waits: the caller's config, then the file, then the schema default. */
function resolveSurfSettings(options: CreateRunContextOptions): RunSurfSettings {
  const cwd = options.cwd ?? process.cwd();
  const inputPaths = (options.input ?? {}) as ReceiptsInput;
  const fromCaller = options.config?.surf?.submit;
  const fromFile =
    fromCaller === undefined &&
    options.config === undefined &&
    CONFIG_SCOPED_OPERATIONS.has(options.operationId) &&
    typeof inputPaths.config === "string"
      ? readConfigReceiptsSection(path.resolve(cwd, inputPaths.config)).surf?.submit
      : undefined;
  const declared = fromCaller ?? fromFile ?? {};
  return {
    submit: {
      postconditionTimeoutMs: declared.postconditionTimeoutMs ?? 15_000,
      controlEnableTimeoutMs: declared.controlEnableTimeoutMs ?? 5_000,
    },
  };
}

/**
 * Mint the run. Cheap and side-effect free: nothing is created on disk until a mutating step
 * writes its first receipt, so a read-only operation never touches `receipts.dir`.
 */
export function createRunContext(options: CreateRunContextOptions): RunContext {
  const receipts = resolveReceiptsSettings(options);
  const inputPaths = (options.input ?? {}) as ReceiptsInput;
  const configPath =
    CONFIG_SCOPED_OPERATIONS.has(options.operationId) && typeof inputPaths.config === "string"
      ? path.resolve(options.cwd ?? process.cwd(), inputPaths.config)
      : undefined;
  const config: RunConfigView = {
    receipts,
    mutation: { allowOrigins: resolveAllowOrigins(options) },
    surf: resolveSurfSettings(options),
    ...(configPath ? { configPath } : {}),
  };

  const context = {
    runId: options.runId ?? randomUUID(),
    startedAt: new Date().toISOString(),
    operationId: options.operationId,
    effect: options.effect,
    config,
    receiptStore: options.receiptStore ?? new FileReceiptStore(receipts.dir),
    adapters: defaultAdapters(),
    ...(options.supersedeReceiptId ? { supersedeReceiptId: options.supersedeReceiptId } : {}),
  } as RunContext;

  context.ledger = new MutationLedger(context, options.operationId);
  return context;
}
