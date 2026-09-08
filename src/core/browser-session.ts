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

import type {
  EffectAttempt,
  EffectDeclaration,
  EffectSettlement,
  VerifyResult,
} from "./effects.js";
import type { FrameRootCause } from "./frame-root-cause.js";
import type { ExpectDeclaration, ResultOutcome } from "./result-classification.js";
import type { PlanFieldRequest, SurfPlan } from "./surf-plan.js";

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
   * Mutating only: what this step's own reply means, within the ledger's rules (a resolved
   * value may settle `applied` or `unknown`, never `failed`; a thrown one `failed` or
   * `unknown`). The submit step uses it to settle `unknown` on a click whose effect has not
   * been observed yet, so its post-condition runs as the receipt's `verify`. Without it the
   * session's own settlement applies: a definite surf refusal is `failed`, an unattributable
   * reply is `unknown`.
   */
  settle?: (attempt: EffectAttempt<T>) => EffectSettlement;
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

/** What a caller hands `plan`: the fields to fill and, optionally, a hint at the submit control. */
export interface SessionPlanRequest {
  fields: readonly PlanFieldRequest[];
  /** narrow the submit candidates by the control's normalised visible text */
  submitText?: string;
  /** narrow them by CSS; the only way to identify a submit on a page with no owning form */
  submitSelector?: string;
  /** the plan id the caller will file this artifact under; one is minted when absent */
  planId?: string;
}

/** What a caller hands `apply`: a plan to carry out, and how far it may go. */
export interface SessionApplyRequest {
  plan: SurfPlan;
  mode: ApplyMode;
  /**
   * What the operator expects to see after the one click. Absent means the default: the URL
   * leaves the page the plan was written against. It is the submit step's `verify`, so an
   * unmet post-condition leaves the receipt `unknown` rather than claiming a failure.
   */
  postCondition?: { kind: "url_prefix" | "text" | "left_url"; expected: string };
}

export type ApplyMode = "fill" | "submit";

/** What one field's fill looked like; the operation renders it and the receipt records it. */
export interface ApplyFieldResult {
  id: string;
  resolved_selector: string;
  set_via: "field_input";
  set: boolean;
  read_back: boolean;
  matched: boolean;
}

/** What the runner sees when it looks at the page between acts. */
export interface ApplyObservation {
  /** absent when the page could not be read at all, which during a fill is a side effect */
  href?: string;
  available: boolean;
  submitPresent?: boolean;
  submitUnique?: boolean;
  submitDisabled?: boolean;
  formPresent?: boolean;
  detail?: string;
}

/**
 * The apply runner: the whole surface a `surf apply` run has on a browser (submit-gate packet
 * §4.3, D8, D16).
 *
 * Its addressable set is the plan's own field controls, named by field id - not by selector, so
 * a selector the plan never resolved is not expressible as an argument. There is no
 * `click(selector)`, no `type(..., {submit})`, no `press`, no `key`, no `do`, no coordinate
 * click, and no `clickSubmit` at all unless the runner was built in submit mode from a plan
 * whose submit control is identified. That is the invariant that holds when the operator
 * approves the wrong plan, when the allowlist is wrong and when the page drifts: the code that
 * could click the wrong button does not exist in the apply path.
 */
export interface ApplyRunner {
  readonly planId: string;
  readonly mode: ApplyMode;
  readonly readiness: SessionReadiness | undefined;
  readonly tab: OwnedTab | undefined;
  /** recompute the plan's fingerprint against the live page (read-only) */
  fingerprint(): Promise<{ drift: string[] }>;
  /** set one plan field through its own input: `type --into`, `select`, or a click on the box */
  setValue(fieldId: string): Promise<void>;
  /** read the value back out of the field it was written to (read-only) */
  readBack(fieldId: string): Promise<ApplyFieldResult>;
  /** where the page is and whether the form is still there (read-only, addresses nothing) */
  observe(): Promise<ApplyObservation>;
  /** the surf calls this run made, with values elided; the evidence that nothing else was clicked */
  surfCalls(): readonly string[];
  /** lifecycle notes worth rendering (a tab that would not close) */
  notes(): readonly string[];
  /** `tab.close`; safe to call twice and called in `finally` */
  close(): Promise<void>;
}

/** A runner built in submit mode from a plan whose submit control is identified. */
export interface SubmitApplyRunner extends ApplyRunner {
  /**
   * Click the one control the plan identified, exactly once. The method consumes itself: a
   * second call throws before anything is emitted.
   */
  clickSubmit(): Promise<{ clicked: true; observed: ApplyObservation }>;
}

/** True when this runner holds the one capability a fill-mode runner does not have. */
export function canSubmit(runner: ApplyRunner): runner is SubmitApplyRunner {
  return typeof (runner as SubmitApplyRunner).clickSubmit === "function";
}

export interface Session {
  /** the run this session belongs to; a nested session shares its parent's run */
  readonly runId: string;
  /** the URL the session was opened for */
  readonly url: string;
  /** the tab this run owns, once `open` has run */
  readonly tab: OwnedTab | undefined;
  /** what the readiness gate settled on, once `gate` has run */
  readonly readiness: SessionReadiness | undefined;

  /** `tab.new`: the run's own browser lifecycle, reversed in `close` */
  open(): Promise<{ tab: OwnedTab; reply: SessionReply }>;
  /** the one readiness gate; a page that never settles is refused, never probed */
  gate(options?: {
    timeoutMs?: number;
    /**
     * A visible CSS selector that marks the page ready. A gate that waits for an element is
     * also the run's first way to *fail* to reach one, which is what `explainUnreachable`
     * answers (frame-root-cause packet, trigger (a)).
     */
    selector?: string;
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

  /**
   * Why a browser step could not reach an element: one read-only `frame.diagnose` observation
   * in the tab this session owns, cached for the page visit, answered in the kernel's
   * determination shape. `confirmed` needs a positive selector-to-frame link, and in v1 the
   * only one is `frameHint`; without it the answer is `suspected` at best, and a page with no
   * candidate frame at all is `excluded`.
   *
   * It never throws for a diagnosis that failed: `unavailable` is one of the answers.
   */
  explainUnreachable(
    selector: string,
    options?: {
      /** `urlPrefix=…` or `selector=…` */
      frameHint?: string;
      /** where the failing step was; a page that moved in between concludes nothing */
      failure?: { href?: string; browserEpoch?: string };
    },
  ): Promise<FrameRootCause>;
  /**
   * Read the form the way an operator will review it: resolved selectors, intended values, the
   * one control that may be clicked or an explicit ambiguous/none, and the buttons that may
   * never be. Nothing is typed and nothing is clicked (submit-gate packet §4.1).
   */
  plan(request: SessionPlanRequest): Promise<SurfPlan>;
  /**
   * Build the capability-restricted runner for a plan. The session is the runner's only handle
   * on the browser, and the runner's addressable set is the plan's own controls plus, in submit
   * mode with an identified control, that one control (§4.3).
   */
  apply(request: SessionApplyRequest): Promise<ApplyRunner>;

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
