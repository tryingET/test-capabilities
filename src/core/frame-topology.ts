/**
 * Layer 1 of the frame root cause: the topology surf reports, as typed evidence.
 *
 * Everything here is descriptive. It reads a `surf frame.diagnose` inventory and answers what
 * the page's frames *are* - which of them a main-document selector cannot reach, which are
 * rendered at all, and where the inventory disagrees with itself. It never says that a frame
 * explains a particular selector miss: that is the determination in `frame-root-cause.ts`, and
 * keeping the two apart is the whole correction the packet's refinement made (Clash 1 - the
 * presence of an incidental frame is not evidence that this selector targeted it).
 *
 * Every rule reads a *structural* field (`crossOrigin`, `cdpFrameIds`, `extensionFrameIds`,
 * `shadowHost`, `rect`, `blank`). Surf's warnings are quoted verbatim as evidence and are never
 * parsed for a decision: they are a rendering of fields surf already exports, and a producer's
 * prose is not a contract (Clash 4).
 *
 * Pure ring: no I/O.
 */

import { FrameworkError } from "./runtime-contract.js";

// ============================================
// THE INVENTORY surf ANSWERS WITH
// ============================================

export interface SurfFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One `<iframe>` in the top document, as `frame.diagnose` reports it. */
export interface SurfDomIframe {
  domIndex: number;
  id?: string;
  name?: string;
  allow?: string;
  rect: SurfFrameRect;
  sandbox: string | null;
  /** the open shadow root chain the iframe sits in, e.g. `interactive-example > mdn-play-runner` */
  shadowHost: string | null;
  src: string;
  srcAttribute?: string;
  srcdoc: boolean;
  title?: string;
  origin: string | null;
  crossOrigin: boolean;
  blank: boolean;
  /** surf's own flag; false for the 1x1 pixel frame observed on claude.ai/login */
  zeroSize: boolean;
  scriptsBlocked?: boolean;
  extensionFrameIds: number[];
  cdpFrameIds: string[];
}

/** One frame the browser extension can see, with whether its content script answers. */
export interface SurfExtensionFrame {
  frameId: number;
  parentFrameId: number;
  url: string;
  errorOccurred?: boolean;
  contentScriptReachable: boolean;
  contentScriptError?: string;
  contentScript?: { href?: string; readyState?: string };
  isMain: boolean;
  origin: string | null;
  crossOrigin: boolean;
}

/** One frame in this tab's CDP frame tree; an out-of-process iframe is absent from it. */
export interface SurfCdpFrame {
  frameId: string;
  url: string;
  name?: string;
  parentId?: string;
  isMain: boolean;
  origin: string | null;
  crossOrigin: boolean;
  extensionFrameIds?: number[];
}

export interface SurfFrameDiagnosis {
  mainPage: { href: string; title?: string; origin: string | null };
  counts: { domIframes: number; extensionFrames: number; cdpFrames: number };
  domIframes: SurfDomIframe[];
  extensionFrames: SurfExtensionFrame[];
  cdpFrames: SurfCdpFrame[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Read `surf frame.diagnose --json`'s payload, or refuse.
 *
 * A diagnosis whose shape the framework does not recognise is `unavailable`, never an empty
 * inventory: an empty inventory is the *strongest* claim this module makes (`excluded` says a
 * frame cannot explain the miss), and defaulting to it on a parse failure would turn a missing
 * observation into a positive one.
 */
export function parseSurfFrameDiagnosis(value: unknown): SurfFrameDiagnosis {
  const payload = isRecord(value) && isRecord(value.result) ? value.result : value;
  if (!isRecord(payload) || !isRecord(payload.mainPage) || !Array.isArray(payload.domIframes)) {
    throw new FrameworkError(
      "frame_diagnosis_failed",
      "Surf answered 'frame.diagnose' with a payload that carries no mainPage and no domIframes list, so this run has no frame inventory. Nothing about the page's frames may be concluded from it.",
      { probe: "frame.diagnose" },
    );
  }
  const counts = isRecord(payload.counts) ? payload.counts : {};
  const domIframes = arrayOf<SurfDomIframe>(payload.domIframes);
  const extensionFrames = arrayOf<SurfExtensionFrame>(payload.extensionFrames);
  const cdpFrames = arrayOf<SurfCdpFrame>(payload.cdpFrames);
  return {
    mainPage: {
      href: typeof payload.mainPage.href === "string" ? payload.mainPage.href : "",
      ...(typeof payload.mainPage.title === "string" ? { title: payload.mainPage.title } : {}),
      origin: stringOrNull(payload.mainPage.origin),
    },
    counts: {
      domIframes: numberOf(counts.domIframes, domIframes.length),
      extensionFrames: numberOf(counts.extensionFrames, extensionFrames.length),
      cdpFrames: numberOf(counts.cdpFrames, cdpFrames.length),
    },
    domIframes,
    extensionFrames,
    cdpFrames,
    warnings: arrayOf<string>(payload.warnings).filter((entry) => typeof entry === "string"),
  };
}

// ============================================
// LAYER 1: TOPOLOGY (EVIDENCE)
// ============================================

export const FRAME_TOPOLOGY_TAGS = [
  "out_of_process_frame",
  "cross_origin_frame",
  "shadow_hosted_frame",
  "nested_frame",
  "hidden_frame",
] as const;

export type FrameTopologyTag = (typeof FRAME_TOPOLOGY_TAGS)[number];

/**
 * Which tag names the reason a main-page selector cannot reach the frame, when several hold.
 * It is descriptive - it says which surf alternative works - and it decides nothing.
 */
const PRIMARY_TAG_PRECEDENCE: readonly FrameTopologyTag[] = [
  "out_of_process_frame",
  "cross_origin_frame",
  "shadow_hosted_frame",
  "nested_frame",
];

/** Evidence caps, so a page like MDN (three 600-char frame URLs) cannot bloat a finding. */
export const MAX_FRAME_CANDIDATES = 10;
export const MAX_FRAME_WARNINGS = 10;
export const MAX_FRAME_SRC_CHARS = 160;

export interface FrameCandidate {
  /** index in the top document's iframe list; null for a nested frame the DOM walk cannot see */
  domIndex: number | null;
  /** the extension frame id, when the candidate is a nested frame */
  frameId: number | null;
  origin: string | null;
  /** abbreviated to {@link MAX_FRAME_SRC_CHARS} */
  src: string;
  rect: SurfFrameRect | null;
  sandbox: string | null;
  shadowHost: string | null;
  id: string | null;
  name: string | null;
  title: string | null;
  crossOrigin: boolean;
  outOfProcess: boolean;
  hidden: boolean;
  extensionFrameIds: number[];
  cdpFrameIds: string[];
  /** null when no extension frame matched, so nothing is known about reachability */
  contentScriptReachable: boolean | null;
  tags: FrameTopologyTag[];
  primaryTag: FrameTopologyTag | null;
}

export interface FrameTopology {
  mainPage: { href: string; origin: string | null; title: string | null };
  counts: { domIframes: number; extensionFrames: number; cdpFrames: number };
  /** frames a main-page selector cannot reach and that could hold the target */
  candidates: FrameCandidate[];
  /** frames excluded because nothing is rendered in them; evidence, never candidates */
  excludedHidden: FrameCandidate[];
  /** CDP child frames no DOM iframe accounts for; surf does not explain them */
  unmatchedCdpFrames: number;
  /** structural disagreements inside the inventory, never derived from warning text */
  inconsistencies: string[];
  /** surf's own prose, verbatim and capped: evidence for a reader, never an input to a gate */
  warnings: string[];
}

function abbreviate(value: string | undefined | null): string {
  const text = value ?? "";
  return text.length > MAX_FRAME_SRC_CHARS ? `${text.slice(0, MAX_FRAME_SRC_CHARS)}…` : text;
}

/**
 * The framework's own hidden rule, and a deliberate divergence from the packet's third clause.
 *
 * A hidden frame is one nothing is rendered in, and it leaves the candidate set - which pushes
 * the determination towards `excluded`, the strongest claim this module makes and the only one
 * that licenses an automatic selector rewrite. So the rule is read in the conservative
 * direction, and its three clauses use *two different* geometry boundaries on purpose:
 *
 *   1. `zeroSize` - surf's own flag, kept verbatim.
 *   2. `rect.width <= 1 **&&** rect.height <= 1` - the packet's clause. A pixel. surf's
 *      `zeroSize` is false for the 1x1 frame observed live on `claude.ai/login`, which is why
 *      the framework decides from the rect at all (packet decision log, 2026-09-07).
 *   3. `blank && src === ""` **and** `rect.width <= 1 **||** rect.height <= 1` - the packet's
 *      third clause, qualified. The packet leaves it unqualified; live on 2026-09-08 the
 *      w3schools try-it page renders a **933x949** frame that surf reports as
 *      `blank: true, src: ""` (its content is written by the parent, so it has no `src`
 *      attribute), and under the unqualified clause that page becomes `excluded` and a target
 *      inside that frame is healed into a lookalike in the main document. A blank, src-less
 *      frame is hidden here only when its box is degenerate in either dimension - a line or a
 *      pixel, where nothing can be seen - which is a *wider* hidden test than clause 2 for
 *      blank frames and a narrower one than the packet's.
 *
 * This is an amendment to the packet, not compliance with it, and the slice note says so; P3's
 * clause and this rule are not both satisfied.
 */
export function isHiddenFrame(frame: {
  rect?: SurfFrameRect | null;
  zeroSize?: boolean;
  blank?: boolean;
  src?: string;
}): boolean {
  if (frame.zeroSize === true) {
    return true;
  }
  const rect = frame.rect;
  if (!rect) {
    return false;
  }
  const degenerate = rect.width <= 1 || rect.height <= 1;
  if (rect.width <= 1 && rect.height <= 1) {
    return true;
  }
  return frame.blank === true && (frame.src ?? "") === "" && degenerate;
}

function primaryTagOf(tags: readonly FrameTopologyTag[]): FrameTopologyTag | null {
  return PRIMARY_TAG_PRECEDENCE.find((tag) => tags.includes(tag)) ?? null;
}

/** Reachability of a DOM iframe: known only through the extension frames that matched it. */
function reachabilityOf(
  extensionFrameIds: readonly number[],
  byId: Map<number, SurfExtensionFrame>,
): boolean | null {
  const matched = extensionFrameIds
    .map((id) => byId.get(id))
    .filter((frame): frame is SurfExtensionFrame => frame !== undefined);
  if (matched.length === 0) {
    return null;
  }
  return matched.every((frame) => frame.contentScriptReachable === true);
}

function candidateFromDomIframe(
  frame: SurfDomIframe,
  byId: Map<number, SurfExtensionFrame>,
): FrameCandidate {
  const extensionFrameIds = arrayOf<number>(frame.extensionFrameIds);
  const cdpFrameIds = arrayOf<string>(frame.cdpFrameIds);
  const outOfProcess =
    frame.crossOrigin === true && cdpFrameIds.length === 0 && extensionFrameIds.length > 0;
  const hidden = isHiddenFrame(frame);

  const tags: FrameTopologyTag[] = [];
  if (outOfProcess) {
    tags.push("out_of_process_frame");
  }
  if (frame.crossOrigin === true && cdpFrameIds.length > 0) {
    tags.push("cross_origin_frame");
  }
  if (frame.shadowHost !== null && frame.shadowHost !== undefined) {
    tags.push("shadow_hosted_frame");
  }
  if (hidden) {
    tags.push("hidden_frame");
  }

  return {
    domIndex: frame.domIndex,
    frameId: null,
    origin: stringOrNull(frame.origin),
    src: abbreviate(frame.src),
    rect: frame.rect ?? null,
    sandbox: stringOrNull(frame.sandbox),
    shadowHost: stringOrNull(frame.shadowHost),
    id: frame.id ? frame.id : null,
    name: frame.name ? frame.name : null,
    title: frame.title ? frame.title : null,
    crossOrigin: frame.crossOrigin === true,
    outOfProcess,
    hidden,
    extensionFrameIds,
    cdpFrameIds,
    contentScriptReachable: reachabilityOf(extensionFrameIds, byId),
    tags,
    primaryTag: primaryTagOf(tags),
  };
}

function candidateFromNestedFrame(frame: SurfExtensionFrame): FrameCandidate {
  const tags: FrameTopologyTag[] = ["nested_frame"];
  if (frame.crossOrigin === true) {
    tags.push("cross_origin_frame");
  }
  return {
    domIndex: null,
    frameId: frame.frameId,
    origin: stringOrNull(frame.origin),
    src: abbreviate(frame.url),
    rect: null,
    sandbox: null,
    shadowHost: null,
    id: null,
    name: null,
    title: null,
    crossOrigin: frame.crossOrigin === true,
    outOfProcess: false,
    hidden: false,
    extensionFrameIds: [frame.frameId],
    cdpFrameIds: [],
    contentScriptReachable: frame.contentScriptReachable === true,
    tags,
    primaryTag: primaryTagOf(tags),
  };
}

/**
 * What the inventory disagrees with itself about.
 *
 * Only structural facts: surf's own counts against its own lists, and extension child frames of
 * the main frame that no DOM iframe accounts for. The second is the closed-shadow-root case -
 * the extension sees a frame the DOM walk cannot - and it is only counted when there are more
 * unmatched children than there are DOM iframes surf *could not* match by URL (a blank or
 * srcdoc frame has no URL to match on, which surf says in its own warning and which the fields
 * show without it).
 */
function inconsistenciesOf(diagnosis: SurfFrameDiagnosis): string[] {
  const problems: string[] = [];
  const { counts, domIframes, extensionFrames, cdpFrames } = diagnosis;
  if (counts.domIframes !== domIframes.length) {
    problems.push(
      `surf counted ${counts.domIframes} DOM iframe(s) and listed ${domIframes.length}`,
    );
  }
  if (counts.extensionFrames !== extensionFrames.length) {
    problems.push(
      `surf counted ${counts.extensionFrames} extension frame(s) and listed ${extensionFrames.length}`,
    );
  }
  if (counts.cdpFrames !== cdpFrames.length) {
    problems.push(`surf counted ${counts.cdpFrames} CDP frame(s) and listed ${cdpFrames.length}`);
  }

  const referenced = new Set(
    domIframes.flatMap((frame) => arrayOf<number>(frame.extensionFrameIds)),
  );
  const unmatchedDirectChildren = extensionFrames.filter(
    (frame) => frame.isMain !== true && frame.parentFrameId === 0 && !referenced.has(frame.frameId),
  );
  const unmatchableDomIframes = domIframes.filter(
    (frame) =>
      arrayOf<number>(frame.extensionFrameIds).length === 0 &&
      (frame.blank === true || frame.srcdoc === true || (frame.src ?? "") === ""),
  );
  if (unmatchedDirectChildren.length > unmatchableDomIframes.length) {
    problems.push(
      `${unmatchedDirectChildren.length} extension child frame(s) of the main frame (${unmatchedDirectChildren
        .map((frame) => frame.frameId)
        .join(
          ", ",
        )}) match no <iframe> in the top document, and only ${unmatchableDomIframes.length} listed iframe(s) have no URL to match on: a closed shadow root would hide exactly this`,
    );
  }
  return problems;
}

/** How many CDP child frames no DOM iframe claims; surf does not explain what they are. */
function unmatchedCdpFramesOf(diagnosis: SurfFrameDiagnosis): number {
  const claimed = new Set(
    diagnosis.domIframes.flatMap((frame) => arrayOf<string>(frame.cdpFrameIds)),
  );
  return diagnosis.cdpFrames.filter((frame) => frame.isMain !== true && !claimed.has(frame.frameId))
    .length;
}

/** Typed topology from one `frame.diagnose` inventory. Decides nothing; describes everything. */
export function classifyFrameTopology(diagnosis: SurfFrameDiagnosis): FrameTopology {
  const byId = new Map(diagnosis.extensionFrames.map((frame) => [frame.frameId, frame]));
  const referenced = new Set(
    diagnosis.domIframes.flatMap((frame) => arrayOf<number>(frame.extensionFrameIds)),
  );

  const fromDom = diagnosis.domIframes.map((frame) => candidateFromDomIframe(frame, byId));
  // A frame below another frame has no <iframe> of its own in the top document, so the DOM walk
  // never sees it; the extension does. It is still somewhere a main-page selector cannot reach.
  const nested = diagnosis.extensionFrames
    .filter(
      (frame) =>
        frame.isMain !== true && frame.parentFrameId !== 0 && !referenced.has(frame.frameId),
    )
    .map(candidateFromNestedFrame);

  const all = [...fromDom, ...nested];
  return {
    mainPage: {
      href: diagnosis.mainPage.href,
      origin: diagnosis.mainPage.origin,
      title: diagnosis.mainPage.title ?? null,
    },
    counts: diagnosis.counts,
    candidates: all.filter((candidate) => !candidate.hidden).slice(0, MAX_FRAME_CANDIDATES),
    excludedHidden: all.filter((candidate) => candidate.hidden).slice(0, MAX_FRAME_CANDIDATES),
    unmatchedCdpFrames: unmatchedCdpFramesOf(diagnosis),
    inconsistencies: inconsistenciesOf(diagnosis),
    warnings: diagnosis.warnings.slice(0, MAX_FRAME_WARNINGS),
  };
}
