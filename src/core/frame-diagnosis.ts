/**
 * `Session.explainUnreachable`: the frame diagnosis as a read-only observation over the tab the
 * run already owns (architecture review A8; adjudication claim 22).
 *
 * A step list in its own module, the way `surf-plan-probe.ts` is: the session stays a one-line
 * delegation, and the composition - one `frame.diagnose` in the owned tab, the pure classifier
 * over its inventory, the raw document on disk, the typed field back to the caller - lives
 * here where it is testable.
 *
 * Two rules the packet is explicit about:
 *
 *   - **One command per failing page, not per failing step.** The topology of a page does not
 *     change between two steps on it, so it is read once and cached for the life of the tab
 *     (key: tab id, browser epoch and the page the diagnosis answered from). The
 *     *determination* is still computed per call, because two steps carry different selectors
 *     and different hints.
 *   - **A diagnosis that did not happen is `unavailable`, never `excluded`.** Every failure
 *     path here - surf refused, the payload was unreadable, the mechanism is not in this build
 *     - lands on `determination: "unavailable"` with the reason, which the report files as a
 *     coverage gap of the sensor and the healer refuses to act on. It is never left to the
 *     regex, which would read the failure text as selector drift.
 */

import path from "node:path";
import { writeJsonArtifactSync } from "./artifacts.js";
import type { BrowserStep, OwnedTab, SessionReply } from "./browser-session.js";
import type { EffectDeclaration } from "./effects.js";
import type { FrameRootCause } from "./frame-root-cause.js";
import { determineFrameRootCause, parseFrameHint } from "./frame-root-cause.js";
import type { FrameTopology, SurfFrameDiagnosis } from "./frame-topology.js";
import { classifyFrameTopology, parseSurfFrameDiagnosis } from "./frame-topology.js";
import type { ResultOutcome } from "./result-classification.js";
import type { RunContext } from "./run-context.js";
import { FrameworkError, isFrameworkError } from "./runtime-contract.js";
import { parseSurfJsonOutput } from "./surf-runtime.js";

/** The artifact kind the raw inventory is written under. */
export const FRAME_DIAGNOSIS_ARTIFACT_KIND = "test-capabilities.frame.diagnosis";

/** The name this observation carries in a report. */
export const FRAME_DIAGNOSIS_OBSERVATION = "frame-diagnosis";

export const FRAME_DIAGNOSIS_STEP_ID = "surf.frame.diagnose";

/**
 * `frame.diagnose` reads three inventories and answers with them. The surf adapter's static map
 * already classifies it `read_only`, so this declaration is documentation rather than a claim
 * the session would accept over the map.
 */
export const FRAME_DIAGNOSIS_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason: "reads the tab's DOM iframes, extension frames and CDP frame tree without acting",
};

interface FrameDiagnoseReply {
  diagnosis: SurfFrameDiagnosis;
  browserEpoch: string | undefined;
  tabId: number | undefined;
  raw: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The one read-only step. It parses; it decides nothing. */
export function frameDiagnoseStep(url: string): BrowserStep<FrameDiagnoseReply> {
  return {
    id: FRAME_DIAGNOSIS_STEP_ID,
    command: "frame.diagnose",
    intent: `read the frame topology of ${url} without changing it`,
    read: (reply: SessionReply): FrameDiagnoseReply => {
      const parsed = parseSurfJsonOutput(reply.stdout, "frame.diagnose");
      const target = isRecord(parsed.target) ? parsed.target : {};
      return {
        diagnosis: parseSurfFrameDiagnosis(parsed.data),
        browserEpoch: typeof target.browserEpoch === "string" ? target.browserEpoch : undefined,
        tabId: typeof target.tabId === "number" ? target.tabId : undefined,
        raw: parsed.data,
      };
    },
  };
}

/** What the session must offer this step list; a fake session in a test offers the same. */
export interface FrameDiagnosisSession {
  readonly runId: string;
  readonly url: string;
  readonly tab: OwnedTab | undefined;
  step<T>(step: BrowserStep<T>): Promise<T>;
}

export interface ExplainUnreachableOptions {
  /** `urlPrefix=…` or `selector=…`; the only v1 route to a `confirmed` determination */
  frameHint?: string;
  /** where the failing step was, so a page that moved in between concludes nothing */
  failure?: { href?: string; browserEpoch?: string };
}

interface CachedDiagnosis {
  key: string;
  topology: FrameTopology;
  browserEpoch: string | undefined;
  durationMs: number;
  artifact: FrameRootCause["artifact"];
  /** set instead of `topology` when the diagnosis could not be taken */
  unavailableReason?: string;
}

/**
 * One entry per session. A `WeakMap` rather than a field on the session, so the cache costs the
 * session nothing and dies with the tab exactly as the packet's cost section requires.
 */
const DIAGNOSIS_CACHE = new WeakMap<object, CachedDiagnosis>();

function cacheKeyFor(session: FrameDiagnosisSession): string {
  return `${session.tab?.id ?? "no-tab"}|${session.url}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Write the raw inventory next to the run's receipts, at 0600.
 *
 * Values, page text and long third-party URLs belong in a file; the envelope keeps the capped
 * evidence (architecture review A10). A write that fails is recorded on the typed field and
 * does not turn the diagnosis into a refusal: the failing step has already failed, and losing
 * the report as well because a directory is unwritable would delete information rather than
 * protect anything.
 */
function writeDiagnosisArtifact(
  context: RunContext,
  session: FrameDiagnosisSession,
  raw: unknown,
  topology: FrameTopology,
): FrameRootCause["artifact"] {
  const file = path.join(
    context.config.receipts.dir,
    session.runId,
    `frame-diagnosis-${session.tab?.id ?? "no-tab"}-${Date.now()}.json`,
  );
  try {
    return {
      path: writeJsonArtifactSync(
        file,
        {
          schema_version: 1,
          artifact_kind: FRAME_DIAGNOSIS_ARTIFACT_KIND,
          generated_at: new Date().toISOString(),
          run_id: session.runId,
          operation_id: context.operationId,
          url: session.url,
          tab_id: session.tab?.id ?? null,
          counts: topology.counts,
          inconsistencies: topology.inconsistencies,
          diagnosis: raw,
        },
        { label: "Frame diagnosis artifact" },
      ),
    };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

/** Read the page's topology once per page visit, or record why it could not be read. */
async function topologyFor(
  session: FrameDiagnosisSession,
  context: RunContext,
): Promise<CachedDiagnosis> {
  const key = cacheKeyFor(session);
  const cached = DIAGNOSIS_CACHE.get(session);
  if (cached && cached.key === key) {
    return cached;
  }

  const startedAt = Date.now();
  let entry: CachedDiagnosis;
  try {
    const reply = await session.step(frameDiagnoseStep(session.url));
    const topology = classifyFrameTopology(reply.diagnosis);
    entry = {
      key,
      topology,
      browserEpoch: reply.browserEpoch,
      durationMs: Date.now() - startedAt,
      artifact: writeDiagnosisArtifact(context, session, reply.raw, topology),
    };
  } catch (error) {
    const code = isFrameworkError(error) ? ` [${error.code}]` : "";
    entry = {
      key,
      topology: undefined as unknown as FrameTopology,
      browserEpoch: undefined,
      durationMs: Date.now() - startedAt,
      artifact: undefined,
      unavailableReason: `surf frame.diagnose did not answer for ${session.url}: ${errorMessage(error)}${code}`,
    };
  }
  DIAGNOSIS_CACHE.set(session, entry);
  return entry;
}

/**
 * The seam the packet's trigger list points at: a browser step could not reach an element, so
 * the framework reads the page's frames and says - in the kernel's determination shape - what
 * that can and cannot explain.
 *
 * It never throws for a diagnosis that failed: a caller asking "why could this not be reached"
 * gets an answer in every case, and `unavailable` is one of the answers.
 */
export async function explainUnreachable(
  session: FrameDiagnosisSession,
  context: RunContext,
  selector: string,
  options: ExplainUnreachableOptions = {},
): Promise<FrameRootCause> {
  const hint = options.frameHint === undefined ? undefined : parseFrameHint(options.frameHint);
  const entry = await topologyFor(session, context);
  const rootCause = determineFrameRootCause({
    selector,
    ...(entry.unavailableReason ? {} : { topology: entry.topology }),
    ...(hint ? { hint } : {}),
    ...(options.failure ? { failure: options.failure } : {}),
    source: {
      command: "frame.diagnose",
      ...(session.tab ? { tabId: session.tab.id } : {}),
      ...(entry.browserEpoch ? { browserEpoch: entry.browserEpoch } : {}),
      durationMs: entry.durationMs,
    },
    ...(entry.unavailableReason ? { unavailableReason: entry.unavailableReason } : {}),
  });
  return entry.artifact ? { ...rootCause, artifact: entry.artifact } : rootCause;
}

// ============================================
// THE TRIGGER
// ============================================

/**
 * The surf codes that mean "the element this step named was not there", on a page that answered
 * at all. They are the packet's trigger list: `page_login`, `page_challenge`, `page_not_found`
 * and `page_error` are deliberately absent, because a page that refused the framework is not an
 * element problem and running a frame diagnosis on it would answer a question nobody asked.
 */
export const ELEMENT_REACH_FAILURE_CODES: readonly string[] = [
  "page_timeout",
  "element_not_found",
  "no_ref",
];

export function isElementReachFailure(code: string | undefined): boolean {
  return code !== undefined && ELEMENT_REACH_FAILURE_CODES.includes(code);
}

/**
 * A browser step could not reach the element it named, and the frame diagnosis says what that
 * can and cannot explain.
 *
 * The determination travels on the error, so the CLI envelope, the probe result and the
 * finding all read one typed field rather than three renderings of it (architecture review
 * A20). The surf code that produced the failure stays in the message and the details: the
 * framework renames nothing surf owns.
 */
export class ElementUnreachable extends FrameworkError {
  readonly frameRootCause: FrameRootCause;
  readonly outcome: ResultOutcome | undefined;

  constructor(
    url: string,
    selector: string,
    cause: { code?: string; message: string; outcome?: ResultOutcome },
    frameRootCause: FrameRootCause,
  ) {
    super(
      "element_unreachable",
      `Surf explore could not reach '${selector}' on ${url}: ${cause.message}${cause.code ? ` [${cause.code}]` : ""}. Frame diagnosis: ${frameRootCause.determination.value} - ${frameRootCause.determination.reason}.`,
      {
        url,
        selector,
        ...(cause.code ? { surf_code: cause.code } : {}),
        determination: frameRootCause.determination.value,
        candidates: frameRootCause.candidates.length,
      },
    );
    this.name = "ElementUnreachable";
    this.frameRootCause = frameRootCause;
    this.outcome = cause.outcome;
  }
}
