/**
 * The kernel `Session`: an owned scope of unowned state.
 *
 * A browser page is state the framework does not own. What it can own is a *scope* over it - a
 * tab this run created, gated once, read through declared steps, observed by registered
 * read-only observers, and closed in `finally` whatever happened. That scope is this interface;
 * the surf adapter implements it (`src/core/surf-session.ts`), and explore, the submit gate
 * (S7), the frame diagnosis (S8) and the a11y channel (S9) are step lists over it rather than
 * hooks inside an operation (architecture review A8; adjudication claim 22).
 *
 * It is also the library's browser surface. `SurfClient` exported ambient authority - any
 * consumer holding it could click anything on any page - and was deleted at 0.4.0 (operator
 * decision D2, adjudication claim 36). What is exported instead is a scope that cannot be used
 * without declaring what a step does to the world: `step` resolves the class from the adapter's
 * static command map, `evaluate` refuses page-side script that carries no declaration, and a
 * `read_only` claim is checked against the denylist below before anything runs.
 *
 * Pure ring: types, the denylist and the lifecycle declaration only. Everything that touches a
 * browser lives in the surf implementation.
 */

import type { EffectAttempt, EffectDeclaration, VerifyResult } from "./effects.js";
import type { ExpectDeclaration, ResultOutcome } from "./result-classification.js";

// ============================================
// THE SCOPE
// ============================================

/** A tab this run created. Nothing else is a legitimate subject for a browser step. */
export interface OwnedTab {
  id: number;
  /** the URL the tab was opened with */
  url: string;
  openedAt: string;
}

export type SessionReadinessState =
  | "ready"
  | "empty"
  | "loading"
  | "login"
  | "challenge"
  | "not-found"
  | "error"
  | "unknown";

/** What the readiness gate learned about the page; `operations/types.ts` renders it verbatim. */
export interface SessionReadiness {
  state: SessionReadinessState;
  code?: string;
  message?: string;
  href?: string;
  title?: string;
  readyState?: string;
  polls?: number;
  waited?: number;
  evidence: string[];
}

/**
 * One step's reply, uninterpreted apart from the classifier's verdict.
 *
 * `ok` is the transport's word, not a verdict: a step that reads this reply decides what it
 * means. `step()` never hands a caller a failed reply - it raises the surf failure instead -
 * so `ok: false` is reachable only from the session's own gate and teardown, which have to see
 * the refusal to render it.
 */
export interface SessionReply {
  command: string;
  args: readonly string[];
  /** command and args as one displayable list */
  display: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  outcome: ResultOutcome;
  ok: boolean;
  failure?: { code: string; message: string; details?: Record<string, unknown> };
}

/**
 * What a caller asks a session to do. There is deliberately no `run`: the caller names a
 * command and reads the reply, and the session decides the class, the tab and the budget. A
 * caller that could supply its own `run` would hold the authority the session exists to keep.
 */
export interface BrowserStep<T> {
  /** stable within a run, e.g. `surf.explore.probe:state` */
  id: string;
  /** the adapter-level verb: a surf command */
  command: string;
  args?: readonly string[];
  /** one line: what this step is for; it is rendered in receipts and refusals */
  intent: string;
  /**
   * Required only where the adapter's map leaves the command unclassified (`js`, and any verb
   * the map does not know). A declaration that contradicts a classified command is refused.
   */
  declare?: EffectDeclaration;
  /** what the caller declares about the payload; see the classifier */
  expect?: ExpectDeclaration;
  /** read-only only; the ledger caps it */
  maxAttempts?: number;
  retryOn?: readonly string[];
  /** mutating only; defaults to the ledger's `sha256(operationId|id|subject|intent)` */
  idempotencyKey?: string;
  /** carried onto the receipt of a mutating step */
  details?: Record<string, unknown>;
  /**
   * Turn the reply into the value the caller wants; throwing fails the attempt. The attempt
   * number is the ledger's, so a step that reports its own attempt count reports the budget the
   * framework spent rather than one a tool claims.
   */
  read: (reply: SessionReply, attempt: number) => T;
  /**
   * Read-only revocation: return a reason when the attempt's own evidence shows the target
   * moved. The ledger then fails the step with `read_only_violation_observed` and forfeits the
   * remaining budget - observation cannot prevent the first attempt, only the repeat.
   */
  observe?: (attempt: EffectAttempt<T>) => string | undefined;
  /** mutating only: one read-only post-read that may promote `unknown` to `applied` */
  verify?: () => Promise<{ result: VerifyResult; evidence: string[] }>;
}

/**
 * A read-only observation registered on the session and run after the step list. S9's a11y
 * snapshot channel is one; a session runs them in registration order and tears them down in
 * reverse before the tab closes.
 */
export interface SessionObserver {
  /** must be `read_only`; a mutating observer is refused at registration */
  effect: EffectDeclaration;
  intent: string;
  /** when `false`, a failure is recorded as `unavailable` and the run continues */
  required?: boolean;
  run: (session: Session) => Promise<unknown>;
  teardown?: () => Promise<void>;
}

export interface SessionObservation {
  name: string;
  status: "ok" | "unavailable" | "failed";
  value?: unknown;
  error?: string;
  code?: string;
}

/** What a caller hands `plan`/`apply`; the submit-gate packet (S7) fixes the fields. */
export type SessionActionRequest = Readonly<Record<string, unknown>>;

export interface Session {
  /** the run this session belongs to; a nested session shares its parent's run */
  readonly runId: string;
  /** the URL the session was opened for */
  readonly url: string;
  /** the tab this run owns, once `open` has run */
  readonly tab: OwnedTab | undefined;

  /** `tab.new`: the run's own browser lifecycle, reversed in `close` */
  open(): Promise<{ tab: OwnedTab; reply: SessionReply }>;
  /** the one readiness gate; a page that never settles is refused, never probed */
  gate(options?: {
    timeoutMs?: number;
  }): Promise<{ readiness: SessionReadiness; reply: SessionReply }>;
  /** run one declared step against the owned tab */
  step<T>(step: BrowserStep<T>): Promise<T>;
  /**
   * Page-side script. `js` has no class: the caller declares one and a `read_only` claim is
   * checked against {@link JS_MUTATION_SIGNALS} before anything runs.
   */
  evaluate<T>(
    code: string,
    declaration: EffectDeclaration,
    options?: Omit<BrowserStep<T>, "command" | "args" | "declare" | "id" | "intent"> & {
      id?: string;
      intent?: string;
    },
  ): Promise<T>;
  /** register a read-only observation to run after the step list */
  observe(name: string, observer: SessionObserver): void;
  /** run the registered observers in registration order */
  runObservers(): Promise<readonly SessionObservation[]>;
  /** what the observers reported */
  observations(): readonly SessionObservation[];
  /** lifecycle notes a caller may render (a tab that would not close, an observer teardown) */
  notes(): readonly string[];

  /** the frame diagnosis seam (S8): an `observe` step over the same owned tab */
  explainUnreachable(selector: string, options?: { frameHint?: string }): Promise<never>;
  /** the submit-gate seams (S7): a reviewable plan and its capability-restricted application */
  plan(request: SessionActionRequest): Promise<never>;
  apply(request: SessionActionRequest): Promise<never>;

  /** teardown, then `tab.close`; safe to call twice and called in `finally` */
  close(): Promise<void>;
}

/**
 * The run's own tab lifecycle.
 *
 * `tab.new`/`tab.close` are `browser_session` scope: they change the browser the run brought
 * with it and nothing about the target, and the run reverses them in `finally`. That makes them
 * compatible with a read-only class (mutation-safety packet, decision log 2026-09-07), which is
 * why a read-only explore writes no receipt for opening its own tab. Anything that changes
 * target state is `mutating`/`target` and receipted.
 */
export const SESSION_LIFECYCLE_EFFECT: EffectDeclaration = {
  effect: "read_only",
  scope: "browser_session",
  reason:
    "the run's own tab lifecycle: it opens and closes a tab it owns and leaves no target state",
};

// ============================================
// THE js DENYLIST
// ============================================

/**
 * Page-side script is the one primitive whose effect cannot be decided from the composition
 * site: only the author of `document.title` knows whether it is read or assigned. So `js` has no
 * class, the caller declares one, and a `read_only` claim is checked against these signals
 * before the step runs.
 *
 * This is a fail-closed fence, not a proof (mutation-safety packet, "Non-goals"): it does not
 * parse JavaScript and it will refuse honest read-only scripts that merely mention a listed
 * name. The remedy for a false positive is to declare the step `mutating` - which costs a
 * receipt and the retry budget - never to weaken the list.
 *
 * The list is the packet's, plus one: assignment to any `document` property. The packet
 * enumerates `location`, `document.cookie`, `.value` and `.checked`, which lets
 * `document.title = ...` - the packet's own example of a declared-mutating script - pass a
 * `read_only` claim untouched. A fence with a hole where its own example sits is not a fence.
 */
export interface JsMutationSignal {
  id: string;
  /** what a hit means, rendered in the refusal */
  what: string;
  pattern: RegExp;
}

export const JS_MUTATION_SIGNALS: readonly JsMutationSignal[] = [
  {
    id: "location_assignment",
    what: "assigns to location, which navigates the page",
    pattern: /\blocation\b(?:\s*\.\s*[A-Za-z_$][\w$]*)?\s*=(?![=>])/,
  },
  {
    id: "cookie_assignment",
    what: "assigns to document.cookie",
    pattern: /\bdocument\s*\.\s*cookie\s*=(?![=>])/,
  },
  {
    id: "document_assignment",
    what: "assigns to a document property, which changes what the page shows or is",
    pattern: /\bdocument\s*\.\s*(?!cookie\b)[A-Za-z_$][\w$]*\s*=(?![=>])/,
  },
  {
    id: "field_assignment",
    what: "assigns to a form field's value or checked state",
    pattern: /\.\s*(?:value|checked)\s*=(?![=>])/,
  },
  { id: "form_submit", what: "submits a form", pattern: /\.\s*submit\s*\(/ },
  { id: "element_click", what: "clicks an element", pattern: /\.\s*click\s*\(/ },
  { id: "dispatch_event", what: "dispatches an event", pattern: /\bdispatchEvent\s*\(/ },
  { id: "fetch", what: "issues a fetch request", pattern: /\bfetch\s*\(/ },
  { id: "xhr", what: "issues an XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  {
    id: "storage",
    what: "touches localStorage, sessionStorage or indexedDB",
    pattern: /\b(?:localStorage|sessionStorage|indexedDB)\b/,
  },
  { id: "history", what: "uses the history API", pattern: /\bhistory\s*\./ },
] as const;

export interface JsMutationHit {
  id: string;
  what: string;
  match: string;
}

/** Every denylist signal the code carries, in declaration order. */
export function findJsMutationSignals(code: string): JsMutationHit[] {
  const hits: JsMutationHit[] = [];
  for (const signal of JS_MUTATION_SIGNALS) {
    const match = signal.pattern.exec(code);
    if (match) {
      hits.push({ id: signal.id, what: signal.what, match: match[0].trim() });
    }
  }
  return hits;
}
