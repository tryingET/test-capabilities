/**
 * The kernel boundary: `Adapter.invoke(step, ctx) -> RawResult`.
 *
 * Every sensor the framework drives is an adapter with the same six members (architecture
 * review A7/A8, adjudication claims 2, 21, 37, Part 4): `resolve` finds the tool, `probe`
 * reports what that tool can do, `translate` turns a step into an invocation, `effects`
 * declares what the step may do to the world, `invoke` runs it through one transport and
 * `normalize` (slice S3 commit (3)) classifies the reply. `spawn-step.ts` is the process
 * transport behind `invoke`; S9's a11y channel adds an HTTP transport and the test fakes a
 * third, all behind the same member.
 *
 * `invokeAdapter` is the only composition of those members, so a step cannot skip translation
 * or return a shape the classifier cannot read.
 */

import type { RawResult, ResultSource } from "./result-classification.js";

export type AdapterId = ResultSource | "agent-browser";

/** Effect classes as the mutation-safety packet defines them; S5 owns the enforcing ledger. */
export type AdapterEffectClass = "read_only" | "mutating" | "unclassified";
export type AdapterMutationScope = "target" | "workspace" | "browser_session";

export interface AdapterEffect {
  effect: AdapterEffectClass;
  scope?: AdapterMutationScope;
  /** one line; it is rendered in receipts and refusals, so it must say why */
  reason: string;
}

/** What a caller asks an adapter to do, in the adapter's own vocabulary. */
export interface AdapterStep {
  /** stable within a run, e.g. "cli-tester.help" or "surf.explore.wait-ready" */
  id: string;
  /** the adapter-level command: a surf verb, a Bombadil subcommand, a target command line */
  command: string;
  args?: readonly string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** what the step acts on: a URL, a tab, a file, a command display */
  subject?: string;
}

/** A fully resolved invocation: nothing here is derived from prose any more. */
export interface AdapterInvocation {
  source: ResultSource;
  command: string;
  args: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  maxOutputChars?: number;
  /** command and args as one displayable list, for messages and receipts */
  display: string[];
}

/**
 * What the kernel hands an adapter with a step. S5 replaces this with the full `RunContext`
 * (`{runId, startedAt, config, receiptStore, ledger, adapters}`); until then the transport
 * needs the environment and the run identity only.
 */
export interface AdapterContext {
  runId?: string;
  env?: NodeJS.ProcessEnv;
}

export interface Adapter<TResolution = unknown, TProbe = unknown> {
  readonly id: AdapterId;
  resolve(env?: NodeJS.ProcessEnv): TResolution;
  probe(resolution: TResolution): TProbe;
  translate(step: AdapterStep, resolution: TResolution): AdapterInvocation;
  effects(step: AdapterStep): AdapterEffect;
  invoke(invocation: AdapterInvocation, context?: AdapterContext): Promise<RawResult>;
}

export function assertAdapterInvocation(invocation: AdapterInvocation, adapterId: AdapterId): void {
  if (typeof invocation?.command !== "string" || invocation.command.trim() === "") {
    throw new Error(
      `Adapter '${adapterId}' translated a step into an invocation without a command; refusing to invoke.`,
    );
  }
  if (!Array.isArray(invocation.args)) {
    throw new Error(
      `Adapter '${adapterId}' translated a step into an invocation without an argv list; refusing to invoke.`,
    );
  }
  if (!Number.isFinite(invocation.timeoutMs) || invocation.timeoutMs <= 0) {
    throw new Error(
      `Adapter '${adapterId}' translated a step without a positive timeout budget; refusing to invoke.`,
    );
  }
}

/**
 * Fail closed on a transport that answers with something the classifier cannot read: an
 * unclassifiable reply must be a refusal at the boundary, not a silently degraded outcome.
 */
export function assertRawResult(raw: RawResult, adapterId: AdapterId): void {
  const shapeOk =
    raw !== null &&
    typeof raw === "object" &&
    typeof raw.source === "string" &&
    typeof raw.stdout === "string" &&
    typeof raw.stderr === "string" &&
    (raw.exitCode === null || typeof raw.exitCode === "number");
  if (!shapeOk) {
    throw new Error(
      `Adapter '${adapterId}' returned a value that is not a RawResult; the kernel boundary refuses it.`,
    );
  }
}

/**
 * The one path from a step to a result: resolve, translate, invoke, check. The effect class is
 * resolved on the way so a step whose class is unknown is visible at the boundary; S5's ledger
 * turns that into the `effect_unclassified` refusal and becomes the only mutating caller.
 */
export async function invokeAdapter<TResolution, TProbe>(
  adapter: Adapter<TResolution, TProbe>,
  step: AdapterStep,
  context: AdapterContext = {},
): Promise<{
  raw: RawResult;
  effect: AdapterEffect;
  invocation: AdapterInvocation;
  resolution: TResolution;
}> {
  const resolution = adapter.resolve(context.env);
  const invocation = adapter.translate(step, resolution);
  assertAdapterInvocation(invocation, adapter.id);
  const effect = adapter.effects(step);
  const raw = await adapter.invoke(invocation, context);
  assertRawResult(raw, adapter.id);
  return { raw, effect, invocation, resolution };
}
