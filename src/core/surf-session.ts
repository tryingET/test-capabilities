/**
 * The surf implementation of the kernel `Session`: one tab this run created, one readiness
 * gate, declared steps through the mutation ledger, registered read-only observers, and
 * `tab.close` in `finally` (architecture review A8; adjudication claim 22; mutation-safety
 * packet, "Interaction with the surf runtime").
 *
 * Mediated ring: this is the only browser-facing object that reaches the world, and it reaches
 * it through two seams only - the surf adapter's transport and `context.ledger.runStep`. Three
 * rules hold everything the packet asks for:
 *
 *   1. **Owned tabs only.** Every step is pointed at the tab `open()` created. A command whose
 *      argv mapping cannot carry `--tab-id` is refused rather than run against whatever tab the
 *      browser happens to have in front, and a caller that names a different tab is refused
 *      with `owned_tab_required`.
 *   2. **The class comes from the adapter's static map, not from the caller.** `Adapter.effects`
 *      decides; a declaration that contradicts it is `effect_declaration_invalid`; the browser
 *      lifecycle verbs belong to the session, so `step()` refuses them.
 *   3. **`js` has no class.** The caller declares one, and a `read_only` claim is checked
 *      against the denylist in `browser-session.ts` before anything runs. A hit is
 *      `read_only_violation`, raised before a process exists.
 */

import { randomUUID } from "node:crypto";
import type {
  ApplyRunner,
  BrowserStep,
  OwnedTab,
  Session,
  SessionApplyRequest,
  SessionObservation,
  SessionObserver,
  SessionPlanRequest,
  SessionReadiness,
  SessionReply,
} from "./browser-session.js";
import { findJsMutationSignals, SESSION_LIFECYCLE_EFFECT } from "./browser-session.js";
import type { EffectAttempt, EffectDeclaration, EffectStep } from "./effects.js";
import {
  defaultMutationOutcomeForError,
  idempotencyKeyFor,
  MutationError,
  resolveEffectDeclaration,
} from "./effects.js";
import type { ExpectDeclaration } from "./result-classification.js";
import type { RunContext } from "./run-context.js";
import { FrameworkError } from "./runtime-contract.js";
import { probeSurfRuntime, runSurfCommand, surfEffect } from "./surf-adapter.js";
import type { SurfPlan } from "./surf-plan.js";
import { planFromSession } from "./surf-plan-probe.js";
import { readinessRefusalFromFailure, settledReadinessOrRefuse } from "./surf-readiness.js";
import type { SurfCommandResult, SurfRuntimeProbe, SurfRuntimeResolution } from "./surf-runtime.js";
import {
  assertSurfExploreMechanisms,
  isSurfReadinessErrorCode,
  parseCreatedTabId,
  parseSurfJsonOutput,
  resolveSurfRuntimeResolution,
  SurfCommandError,
  translateSurfArgs,
} from "./surf-runtime.js";

export const SURF_SESSION_COMMAND_TIMEOUT_MS = 90_000;
export const SURF_SESSION_READY_TIMEOUT_MS = 20_000;

/**
 * The commands a session may point at the tab it owns: their argv mapping accepts `--tab-id`.
 * Any other page-facing verb would run against whichever tab the browser has in front, which is
 * exactly what the owned-tab rule forbids, so it is refused instead of run untargeted.
 */
const SESSION_TAB_SCOPED_COMMANDS = new Set([
  "wait.ready",
  "page.readiness",
  "frame.diagnose",
  "extract",
  "js",
]);

/** Read-only commands that address no tab at all; the packet exempts them from the rule. */
const SESSION_UNTARGETED_COMMANDS = new Set(["tab.list"]);

/** Commands whose payload is a page-side script the denylist reads. */
const SESSION_SCRIPT_COMMANDS = new Set(["js", "extract"]);

export interface SurfSessionRuntime {
  resolution: SurfRuntimeResolution;
  probe: SurfRuntimeProbe;
}

/** Resolve the surf binary, probe it, and refuse a build without the mechanisms a session needs. */
export function resolveSurfSessionRuntime(): SurfSessionRuntime {
  const resolution = resolveSurfRuntimeResolution();
  const probe = probeSurfRuntime(resolution);
  assertSurfExploreMechanisms(resolution, probe);
  return { resolution, probe };
}

export interface SurfSessionOptions {
  /** the run this session belongs to; a nested session shares its parent's run */
  context: RunContext;
  /** the page the session owns */
  url: string;
  /** a resolved runtime, so a multi-page run probes the binary once */
  runtime?: SurfSessionRuntime;
  timeoutMs?: number;
  readyTimeoutMs?: number;
  /** step-id prefix, so a run with several sessions keeps its ledger entries apart */
  idPrefix?: string;
}

/** The page-side script of a step, when the command carries one. */
function scriptOf(command: string, args: readonly string[]): string | undefined {
  if (command === "js") {
    return args.find((arg) => !arg.startsWith("--"));
  }
  const index = args.indexOf("--code");
  return index >= 0 ? args[index + 1] : undefined;
}

function replyFrom(
  command: string,
  args: readonly string[],
  result: SurfCommandResult,
): SessionReply {
  return {
    command,
    args,
    display: result.commandDisplay,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code,
    outcome: result.outcome,
    ok: result.ok,
    ...(result.failure ? { failure: result.failure } : {}),
  } as SessionReply;
}

interface LedgerStepRequest<T> {
  id: string;
  command: string;
  args: readonly string[];
  intent: string;
  declaration: EffectDeclaration;
  subject: string;
  expect?: ExpectDeclaration;
  maxAttempts?: number;
  retryOn?: readonly string[];
  idempotencyKey?: string;
  details?: Record<string, unknown>;
  timeoutMs?: number;
  /** the session's own lifecycle and gate read a failed reply instead of throwing on it */
  acceptFailure?: boolean;
  read: (reply: SessionReply, attempt: number) => T;
  observe?: (attempt: EffectAttempt<T>) => string | undefined;
  verify?: EffectStep<T>["verify"];
}

export class SurfSession implements Session {
  readonly runId: string;
  readonly url: string;
  readonly runtime: SurfSessionRuntime;

  private readonly context: RunContext;
  private readonly timeoutMs: number;
  private readonly readyTimeoutMs: number;
  private readonly idPrefix: string;
  private readonly registered: { name: string; observer: SessionObserver }[] = [];
  private readonly observed: SessionObservation[] = [];
  private readonly lifecycleNotes: string[] = [];
  private ownedTab: OwnedTab | undefined;
  private gated: SessionReadiness | undefined;
  private closed = false;

  constructor(options: SurfSessionOptions) {
    this.context = options.context;
    this.runId = options.context.runId;
    this.url = options.url;
    this.runtime = options.runtime ?? resolveSurfSessionRuntime();
    this.timeoutMs = options.timeoutMs ?? SURF_SESSION_COMMAND_TIMEOUT_MS;
    this.readyTimeoutMs = options.readyTimeoutMs ?? SURF_SESSION_READY_TIMEOUT_MS;
    this.idPrefix = options.idPrefix ?? `surf.session.${randomUUID().slice(0, 8)}`;
  }

  get tab(): OwnedTab | undefined {
    return this.ownedTab;
  }

  /** What the gate settled on; a step list that needs the landed page reads it from here. */
  get readiness(): SessionReadiness | undefined {
    return this.gated;
  }

  notes(): readonly string[] {
    return [...this.lifecycleNotes];
  }

  observations(): readonly SessionObservation[] {
    return [...this.observed];
  }

  // ---- lifecycle -----------------------------------------------------------

  async open(): Promise<{ tab: OwnedTab; reply: SessionReply }> {
    if (this.closed) {
      throw this.lifecycleRefusal("open a tab on a session that is already closed");
    }
    if (this.ownedTab) {
      throw this.lifecycleRefusal(
        `open a second tab (this session already owns tab ${this.ownedTab.id})`,
      );
    }

    const reply = await this.runLedgerStep({
      id: `${this.idPrefix}.open`,
      command: "tab.new",
      args: [this.url],
      intent: `open a tab this run owns on ${this.url}`,
      declaration: SESSION_LIFECYCLE_EFFECT,
      subject: this.url,
      read: (value: SessionReply) => value,
    });

    const tabId = parseCreatedTabId(reply.stdout);
    if (tabId === undefined) {
      const preview = reply.stdout.trim().slice(0, 200);
      throw new Error(
        `Surf session could not open an owned tab for ${this.url}: 'surf tab.new' did not report a tab id (output: ${preview || "(empty)"}).`,
      );
    }

    this.ownedTab = { id: tabId, url: this.url, openedAt: new Date().toISOString() };
    return { tab: this.ownedTab, reply };
  }

  async gate(
    options: { timeoutMs?: number } = {},
  ): Promise<{ readiness: SessionReadiness; reply: SessionReply }> {
    const tab = this.requireTab("wait.ready");
    const reply = await this.runLedgerStep({
      id: `${this.idPrefix}.gate`,
      command: "wait.ready",
      args: [
        "--tab-id",
        String(tab.id),
        "--timeout",
        String(options.timeoutMs ?? this.readyTimeoutMs),
      ],
      intent: `wait until ${this.url} settles before anything reads it`,
      declaration: this.declarationFor({
        id: `${this.idPrefix}.gate`,
        command: "wait.ready",
        intent: "gate",
        read: (value: SessionReply) => value,
      }),
      subject: this.subjectFor(this.url),
      acceptFailure: true,
      read: (value: SessionReply) => value,
    });

    if (!reply.ok) {
      const failure = reply.failure ?? { code: "error", message: "wait.ready failed" };
      if (isSurfReadinessErrorCode(failure.code)) {
        throw readinessRefusalFromFailure(this.url, failure, reply.outcome);
      }
      throw new SurfCommandError(this.commandResultOf(reply));
    }

    const readiness = settledReadinessOrRefuse(
      this.url,
      parseSurfJsonOutput(reply.stdout, "wait.ready").data,
      reply.outcome,
    );
    this.gated = readiness;
    return { readiness, reply };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    // Teardown before the tab goes: an observer bound to this tab must let go of it first
    // (a11y-snapshot packet, "teardown order"), and it must not stop the tab from closing.
    for (const entry of [...this.registered].reverse()) {
      try {
        await entry.observer.teardown?.();
      } catch (error) {
        this.lifecycleNotes.push(
          `Session observer '${entry.name}' did not tear down: ${errorMessage(error)}`,
        );
      }
    }

    const tab = this.ownedTab;
    this.ownedTab = undefined;
    if (!tab) {
      return;
    }

    try {
      const reply = await this.runLedgerStep({
        id: `${this.idPrefix}.close`,
        command: "tab.close",
        args: [String(tab.id)],
        intent: `close the tab this run owns (${tab.id})`,
        declaration: SESSION_LIFECYCLE_EFFECT,
        subject: this.subjectFor(this.url, tab),
        acceptFailure: true,
        read: (value: SessionReply) => value,
      });
      if (!reply.ok) {
        this.lifecycleNotes.push(
          `Surf explore could not close owned tab ${tab.id}: ${reply.failure?.message ?? "unknown failure"} [${reply.failure?.code ?? "error"}]`,
        );
      }
    } catch (error) {
      this.lifecycleNotes.push(
        `Surf explore could not close owned tab ${tab.id}: ${errorMessage(error)} [error]`,
      );
    }
  }

  // ---- steps ---------------------------------------------------------------

  async step<T>(step: BrowserStep<T>): Promise<T> {
    if (this.closed) {
      throw this.lifecycleRefusal(`run '${step.command}' on a session that is already closed`);
    }
    const declaration = this.declarationFor(step);
    const args = this.targetArgs(step.command, step.args ?? [], declaration);
    this.assertScriptDeclarationHonest(step.command, args, declaration);

    return this.runLedgerStep<T>({
      id: step.id,
      command: step.command,
      args,
      intent: step.intent,
      declaration,
      subject: this.subjectFor(this.url),
      ...(step.expect ? { expect: step.expect } : {}),
      ...(step.maxAttempts === undefined ? {} : { maxAttempts: step.maxAttempts }),
      ...(step.retryOn ? { retryOn: step.retryOn } : {}),
      ...(step.idempotencyKey ? { idempotencyKey: step.idempotencyKey } : {}),
      ...(step.details ? { details: step.details } : {}),
      read: step.read,
      ...(step.observe ? { observe: step.observe } : {}),
      ...(step.verify ? { verify: step.verify } : {}),
    });
  }

  async evaluate<T>(
    code: string,
    declaration: EffectDeclaration,
    options: Omit<BrowserStep<T>, "command" | "args" | "declare" | "id" | "intent"> & {
      id?: string;
      intent?: string;
    } = {} as never,
  ): Promise<T> {
    const read =
      options.read ?? ((reply: SessionReply) => parseSurfJsonOutput(reply.stdout, "js").data as T);
    return this.step<T>({
      ...options,
      id: options.id ?? `${this.idPrefix}.evaluate`,
      command: "js",
      args: [code],
      intent: options.intent ?? declaration.reason,
      declare: declaration,
      read,
    });
  }

  // ---- observation ---------------------------------------------------------

  observe(name: string, observer: SessionObserver): void {
    if (this.closed) {
      throw this.lifecycleRefusal(`register the observer '${name}' on a closed session`);
    }
    const declaration = resolveEffectDeclaration(observer.effect, `session observer '${name}'`);
    if (declaration.effect !== "read_only") {
      throw new MutationError(
        "effect_declaration_invalid",
        `Session observer '${name}' declared '${declaration.effect}'. An observer audits what the step list already did and may never act: register it as a step if it needs to change anything.`,
        [],
        { observer: name },
      );
    }
    if (this.registered.some((entry) => entry.name === name)) {
      throw this.lifecycleRefusal(`register the observer '${name}' twice`);
    }
    this.registered.push({ name, observer });
  }

  async runObservers(): Promise<readonly SessionObservation[]> {
    for (const entry of this.registered) {
      if (this.observed.some((observation) => observation.name === entry.name)) {
        continue;
      }
      try {
        const value = await entry.observer.run(this);
        this.observed.push({
          name: entry.name,
          status: "ok",
          ...(value === undefined ? {} : { value }),
        });
      } catch (error) {
        const required = entry.observer.required === true;
        const code = error instanceof FrameworkError ? error.code : undefined;
        this.observed.push({
          name: entry.name,
          status: required ? "failed" : "unavailable",
          error: errorMessage(error),
          ...(code ? { code } : {}),
        });
        if (required) {
          throw error;
        }
      }
    }
    return [...this.observed];
  }

  // ---- seams later slices fill --------------------------------------------

  /** S8 replaces this with an `observe("frame-diagnosis")` step over the same owned tab. */
  async explainUnreachable(selector: string): Promise<never> {
    throw new FrameworkError(
      "unsupported_surf_action",
      `Session.explainUnreachable('${selector}') is declared but not implemented in this build: the framework cannot yet say why an element is unreachable, and it will not guess. Nothing was sent to the browser.`,
      { selector },
    );
  }

  /**
   * The reviewable plan: one read-only probe over the gated page, the submit-gate packet's
   * refusals, and the artifact. Nothing is typed and nothing is clicked (§4.1). The step list
   * lives in `surf-plan-probe.ts`, not here: a seam is a composition over the session, never a
   * hook inside it.
   */
  async plan(request: SessionPlanRequest): Promise<SurfPlan> {
    return planFromSession(this, request);
  }

  /** S7 commit (2) replaces this with the capability-restricted runner over this session. */
  async apply(request: SessionApplyRequest): Promise<ApplyRunner> {
    throw new FrameworkError(
      "unsupported_surf_action",
      "Session.apply is declared but not implemented in this build: a plan can be prepared and reviewed, but nothing carries it out yet. Nothing was sent to the browser.",
      { action: "apply", mode: request?.mode },
    );
  }

  // ---- the rules -----------------------------------------------------------

  /**
   * The class of a step comes from the adapter's static map. A caller may declare only where
   * the map declines to (`js` and any verb it does not know); a declaration that contradicts a
   * classified command is a lie the session refuses rather than records.
   */
  private declarationFor<T>(step: BrowserStep<T>): EffectDeclaration {
    const mapped = surfEffect(step.command);

    if (mapped.effect === "unclassified") {
      const declared = resolveEffectDeclaration(step.declare, `the surf command '${step.command}'`);
      if (declared.effect === "mutating" && declared.scope !== "target") {
        throw new MutationError(
          "effect_declaration_invalid",
          `Step '${step.id}' declared '${step.command}' mutating with scope '${declared.scope}'. Page-side script that changes anything changes the target: declare scope "target" so the origin allowlist and the receipt apply.`,
          [],
          { step_id: step.id, command: step.command },
        );
      }
      return declared;
    }

    if (mapped.effect === "mutating" && mapped.scope === "browser_session") {
      throw new MutationError(
        "owned_tab_required",
        `Step '${step.id}' asked for '${step.command}', which changes the browser's own tab or window layout. The session owns that lifecycle: open() and close() are the only ways in, so a step can never leave the run holding a tab it did not create.`,
        [],
        { step_id: step.id, command: step.command },
      );
    }

    if (step.declare && step.declare.effect !== mapped.effect) {
      throw new MutationError(
        "effect_declaration_invalid",
        `Step '${step.id}' declared '${step.command}' as '${step.declare.effect}', but the surf adapter classifies it as '${mapped.effect}' (${mapped.reason}). The map decides for a command it knows; only an unclassified command takes a declaration.`,
        [],
        { step_id: step.id, command: step.command, declared: step.declare.effect },
      );
    }

    return {
      effect: mapped.effect,
      ...(mapped.scope ? { scope: mapped.scope } : {}),
      reason: mapped.reason,
    } as EffectDeclaration;
  }

  /** Point the step at the tab this run owns, or refuse. */
  private targetArgs(
    command: string,
    args: readonly string[],
    declaration: EffectDeclaration,
  ): string[] {
    if (SESSION_UNTARGETED_COMMANDS.has(command)) {
      return [...args];
    }

    const tab = this.requireTab(command);
    if (!SESSION_TAB_SCOPED_COMMANDS.has(command)) {
      throw new MutationError(
        "owned_tab_required",
        `Step on '${command}' cannot be pointed at the tab this run owns (${tab.id}): the surf argv mapping for '${command}' carries no --tab-id, so it would act on whichever tab the browser has in front. ${declaration.effect === "mutating" ? "That tab is not this run's to change" : "That page is not this run's to read"}.`,
        [],
        { command, tab_id: tab.id },
      );
    }

    const index = args.indexOf("--tab-id");
    if (index < 0) {
      return [...args, "--tab-id", String(tab.id)];
    }
    if (args[index + 1] !== String(tab.id)) {
      throw new MutationError(
        "owned_tab_required",
        `Step on '${command}' named tab ${args[index + 1] ?? "(none)"}, but this run owns tab ${tab.id}. A run acts only in the tab it created.`,
        [],
        { command, tab_id: tab.id, requested: args[index + 1] },
      );
    }
    return [...args];
  }

  /**
   * A `read_only` claim over page-side script is checked against the denylist before anything
   * runs. The refusal names every signal and says what to do about it: declare the step
   * mutating, which costs a receipt and the retry budget.
   */
  private assertScriptDeclarationHonest(
    command: string,
    args: readonly string[],
    declaration: EffectDeclaration,
  ): void {
    if (declaration.effect !== "read_only" || !SESSION_SCRIPT_COMMANDS.has(command)) {
      return;
    }
    const code = scriptOf(command, args);
    if (code === undefined) {
      return;
    }
    const hits = findJsMutationSignals(code);
    if (hits.length === 0) {
      return;
    }
    throw new MutationError(
      "read_only_violation",
      `Page-side script for '${command}' was declared read_only but ${hits.map((hit) => `${hit.what} ('${hit.match}')`).join("; ")}. The denylist is a fence, not a proof: if the effect is intended, declare the step mutating with scope "target", which costs one attempt and one receipt. Nothing was sent to the browser.`,
      [],
      { command, signals: hits.map((hit) => hit.id) },
    );
  }

  private requireTab(command: string): OwnedTab {
    if (!this.ownedTab) {
      throw new MutationError(
        "owned_tab_required",
        `Step on '${command}' ran before this session opened a tab. A run reads and acts only in a tab it created: call open() first.`,
        [],
        { command },
      );
    }
    return this.ownedTab;
  }

  /** The subject a receipt and a refusal name: the page plus the tab this run owns. */
  private subjectFor(url: string, tab: OwnedTab | undefined = this.ownedTab): string {
    return tab ? `${url} tab=${tab.id}` : url;
  }

  private lifecycleRefusal(what: string): FrameworkError {
    return new FrameworkError(
      "unsupported_surf_action",
      `Refusing to ${what}: a session is one tab, opened once and closed once.`,
      { url: this.url },
    );
  }

  private commandResultOf(reply: SessionReply): SurfCommandResult {
    return {
      ok: reply.ok,
      code: reply.exitCode,
      stdout: reply.stdout,
      stderr: reply.stderr,
      commandDisplay: [...reply.display],
      outcome: reply.outcome,
      ...(reply.failure ? { failure: reply.failure } : {}),
    };
  }

  // ---- the one path to the world -------------------------------------------

  /**
   * The key that decides whether this act already happened.
   *
   * The ledger's default derives it from the step's subject, and a browser subject carries the
   * tab id - which is this run's handle on the page, not part of what the step means. Two runs
   * asking the same page for the same change get different tab ids, and a key that moved with
   * them would let the second run repeat an attempt the first one left in doubt. So the key is
   * built from the page, not from the handle (mutation-safety packet, "In-doubt interlock").
   */
  private idempotencyKeyFor<T>(request: LedgerStepRequest<T>): string {
    return idempotencyKeyFor(this.context.operationId, {
      id: request.id,
      subject: this.url,
      intent: request.intent,
    });
  }

  private async runLedgerStep<T>(request: LedgerStepRequest<T>): Promise<T> {
    const { command, args, declaration } = request;
    const step: EffectStep<T> = {
      id: request.id,
      effect: declaration,
      subject: request.subject,
      intent: request.intent,
      ...(declaration.effect === "mutating"
        ? { idempotencyKey: request.idempotencyKey ?? this.idempotencyKeyFor(request) }
        : {}),
      ...(request.details ? { details: request.details } : {}),
      ...(declaration.effect === "read_only" && request.maxAttempts !== undefined
        ? { maxAttempts: request.maxAttempts }
        : {}),
      ...(declaration.effect === "read_only" && request.retryOn
        ? { retryOn: request.retryOn }
        : {}),
      ...(request.observe ? { observe: request.observe } : {}),
      ...(request.verify ? { verify: request.verify } : {}),
      ...(declaration.effect === "mutating" ? { settle: settleSurfAttempt } : {}),
      run: async (attempt) => {
        const result = runSurfCommand(
          this.runtime.resolution,
          translateSurfArgs(command, [...args]),
          {
            timeoutMs: request.timeoutMs ?? this.timeoutMs,
            effect: declaration.effect,
            ...(request.expect ? { expect: request.expect } : {}),
          },
        );
        const reply = replyFrom(command, args, result);
        if (!result.ok && request.acceptFailure !== true) {
          throw new SurfCommandError(result);
        }
        return request.read(reply, attempt);
      },
    };

    return this.context.ledger.runStep(step);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a mutating browser attempt means.
 *
 * The framework holds no authoritative read of a page's post-state, so a reply the classifier
 * could not attribute - a budget kill, a signal, a tab that navigated away mid-command - is
 * `unknown` and locks the key until an operator supersedes it. Only a definite refusal from
 * surf is `failed` (mutation-safety packet, "Behaviour and failure modes").
 */
export function settleSurfAttempt<T>(attempt: EffectAttempt<T>): {
  outcome: "applied" | "failed" | "unknown";
  evidence?: string[];
} {
  if (attempt.error === undefined) {
    return { outcome: "applied" };
  }
  const outcome = attempt.error instanceof SurfCommandError ? attempt.error.outcome : undefined;
  if (outcome?.basis === "indeterminate") {
    return {
      outcome: "unknown",
      evidence: [`outcome:${outcome.class}:${outcome.code}`, "basis:indeterminate"],
    };
  }
  return { outcome: defaultMutationOutcomeForError(attempt.error) };
}
