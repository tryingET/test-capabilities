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
import { MutationConfigSchema, ReceiptsConfigSchema } from "./config.js";
import type { EffectDeclaration, LedgerContext } from "./effects.js";
import { MutationLedger } from "./effects.js";
import type { ReceiptStore } from "./receipt-store.js";
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

export interface RunConfigView {
  receipts: ReceiptsSettings;
  mutation: RunMutationSettings;
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

type ReceiptsInput = { config?: unknown; dir?: unknown };

/** The base a relative `receipts.dir` is resolved against, per operation (claim 47). */
export function receiptsBaseFor(
  operationId: string,
  input: ReceiptsInput | undefined,
  cwd: string,
): { base: string; source: string } {
  if (operationId === "test" && typeof input?.config === "string" && input.config.length > 0) {
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
}

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
  return {
    ...(record.receipts === undefined
      ? {}
      : { receipts: ReceiptsConfigSchema.parse(record.receipts) }),
    ...(record.mutation === undefined
      ? {}
      : { mutation: MutationConfigSchema.parse(record.mutation) as { allowOrigins: string[] } }),
  };
}

export interface CreateRunContextOptions {
  operationId: string;
  effect: EffectDeclaration;
  /** the parsed operation input; only `config` and `dir` are read, for the receipts base */
  input?: ReceiptsInput;
  /** a config the caller has already parsed; it wins over the file on disk */
  config?: {
    receipts?: { dir?: string; ephemeral?: boolean };
    mutation?: { allowOrigins?: string[] };
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
  const { base, source } = receiptsBaseFor(options.operationId, options.input, cwd);

  const fromFile =
    options.config === undefined &&
    options.operationId === "test" &&
    typeof options.input?.config === "string"
      ? readConfigReceiptsSection(path.resolve(cwd, options.input.config))
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
  if (options.operationId === "test" && typeof options.input?.config === "string") {
    return [
      ...(readConfigReceiptsSection(path.resolve(cwd, options.input.config)).mutation
        ?.allowOrigins ?? []),
    ];
  }
  return [];
}

/**
 * Mint the run. Cheap and side-effect free: nothing is created on disk until a mutating step
 * writes its first receipt, so a read-only operation never touches `receipts.dir`.
 */
export function createRunContext(options: CreateRunContextOptions): RunContext {
  const receipts = resolveReceiptsSettings(options);
  const config: RunConfigView = {
    receipts,
    mutation: { allowOrigins: resolveAllowOrigins(options) },
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
