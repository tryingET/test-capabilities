/**
 * Layer 2 of the frame root cause: the determination that gates every consumer.
 *
 * The topology (`frame-topology.ts`) says what the page's frames are. This module answers the
 * only question a consumer may act on, in the kernel's determination shape: `excluded`,
 * `confirmed`, `suspected`, `undetermined`, `unavailable`. The presence of unreachable frames
 * on a page is *not* evidence that this selector targeted one of them - most real pages carry
 * an embed, a consent frame or an ad - so the only positive link v1 accepts is the test
 * author's `--frame-hint` resolving to exactly one reachable candidate. Everything else is
 * `suspected` at best, and the report files it as a coverage gap of the sensor rather than as
 * an established cause.
 *
 * Pure ring: no I/O. The determination is a replayable function of the recorded inventory and
 * the hint, so the same finding yields the same gate on every run, in every retry, in CI, with
 * no model in the path (axiom A5).
 */

import type { DeterminationOf } from "./determination.js";
import type { FrameCandidate, FrameTopology, FrameTopologyTag } from "./frame-topology.js";
import { MAX_FRAME_SRC_CHARS } from "./frame-topology.js";
import { FrameworkError } from "./runtime-contract.js";

// One import site for a consumer: the topology types travel with the determination that
// gates on them.
export type {
  FrameCandidate,
  FrameTopology,
  FrameTopologyTag,
  SurfCdpFrame,
  SurfDomIframe,
  SurfExtensionFrame,
  SurfFrameDiagnosis,
  SurfFrameRect,
} from "./frame-topology.js";
export {
  classifyFrameTopology,
  FRAME_TOPOLOGY_TAGS,
  isHiddenFrame,
  MAX_FRAME_CANDIDATES,
  MAX_FRAME_SRC_CHARS,
  MAX_FRAME_WARNINGS,
  parseSurfFrameDiagnosis,
} from "./frame-topology.js";

// ============================================
// LAYER 2: DETERMINATION (THE GATE)
// ============================================

export const FRAME_DETERMINATION_VALUES = [
  "excluded",
  "confirmed",
  "suspected",
  "undetermined",
  "unavailable",
] as const;

export type FrameDeterminationValue = (typeof FRAME_DETERMINATION_VALUES)[number];

/** The kernel determination shape over the frame question. */
export type FrameDetermination = DeterminationOf<FrameDeterminationValue>;

export interface FrameHint {
  kind: "urlPrefix" | "selector";
  value: string;
  /** as the author wrote it, echoed into the evidence marker */
  raw: string;
}

/**
 * `--frame-hint 'urlPrefix=https://…'` or `--frame-hint 'selector=iframe#player'`.
 *
 * The hint is the test author's assertion that the target lives inside that frame. It is the
 * only source of a positive selector-to-frame link in v1: topology cannot supply one, and
 * inferring it from selector text or healer output would be inventing evidence.
 */
export function parseFrameHint(raw: string): FrameHint {
  const separator = raw.indexOf("=");
  const kind = separator > 0 ? raw.slice(0, separator).trim() : "";
  const value = separator > 0 ? raw.slice(separator + 1).trim() : "";
  if ((kind !== "urlPrefix" && kind !== "selector") || value === "") {
    throw new FrameworkError(
      "config_invalid",
      `--frame-hint must be 'urlPrefix=<prefix>' or 'selector=<css>'; got '${raw}'. The hint is the only way to confirm that a failing selector targets a frame, so it is read strictly rather than guessed at.`,
      { hint: raw },
    );
  }
  return { kind, value, raw };
}

/**
 * Does this candidate answer the hint?
 *
 * `urlPrefix` compares against the frame's own URL. `selector` is matched against the
 * structural identity the inventory actually carries - `#id`, `[id=…]`, `[name=…]`,
 * `[title=…]`, `[src^=…]`, optionally prefixed with the `iframe` tag - because there is no DOM
 * here to run a selector engine against. A selector this module cannot evaluate matches
 * nothing, which makes the determination `undetermined`: a hint the framework cannot check is
 * not a hint it may act on.
 */
export function hintMatchesCandidate(hint: FrameHint, candidate: FrameCandidate): boolean {
  if (hint.kind === "urlPrefix") {
    return candidate.src.startsWith(hint.value.slice(0, MAX_FRAME_SRC_CHARS));
  }
  const selector = hint.value
    .trim()
    .replace(/^iframe/i, "")
    .trim();
  if (selector === "") {
    return true;
  }
  const byId = /^#([\w-]+)$/.exec(selector);
  if (byId) {
    return candidate.id === byId[1];
  }
  const attribute = /^\[\s*([\w-]+)\s*(\^?)=\s*"?([^"\]]*)"?\s*\]$/.exec(selector);
  if (attribute) {
    const [, name, prefix, value] = attribute as unknown as [string, string, string, string];
    const actual =
      name === "id"
        ? candidate.id
        : name === "name"
          ? candidate.name
          : name === "title"
            ? candidate.title
            : name === "src"
              ? candidate.src
              : undefined;
    if (actual === undefined || actual === null) {
      return false;
    }
    return prefix === "^" ? actual.startsWith(value) : actual === value;
  }
  return false;
}

export interface FrameDiagnosisSource {
  command: string;
  tabId?: number;
  browserEpoch?: string;
  durationMs?: number;
}

export interface FrameRootCauseInput {
  /** the selector the failing step could not reach */
  selector: string;
  /** absent when `frame.diagnose` produced nothing; the determination is then `unavailable` */
  topology?: FrameTopology;
  hint?: FrameHint;
  /** where the failing step was, so a navigation between failure and diagnosis is caught */
  failure?: { href?: string; browserEpoch?: string };
  source: FrameDiagnosisSource;
  /** why there is no topology; carried into the `unavailable` reason */
  unavailableReason?: string;
}

/**
 * The typed evidence field. `Finding.frameRootCause`, `SurfExploreProbeResult.frameRootCause`
 * and the healer all read this; the marker line rendered from it is for legacy readers only
 * (architecture review A20).
 */
export interface FrameRootCause {
  selector: string;
  determination: FrameDetermination;
  /** the confirmed candidate's primary tag; null otherwise */
  primaryTag: FrameTopologyTag | null;
  /** the one candidate the hint resolved to; null unless the determination is `confirmed` */
  confirmedCandidate: FrameCandidate | null;
  /** the hint as the author wrote it */
  hint: string | null;
  candidates: FrameCandidate[];
  excludedHidden: FrameCandidate[];
  unmatchedCdpFrames: number;
  counts: FrameTopology["counts"] | null;
  /** verbatim from surf */
  warnings: string[];
  mainPage: { href: string; origin: string | null } | null;
  source: FrameDiagnosisSource;
  /** the registered code a consumer files for this determination, when it refuses */
  code?: string;
  /** where the raw inventory was written, or why it was not */
  artifact?: { path?: string; error?: string };
}

/**
 * The values this inventory could still support, least conclusive first.
 *
 * `suspected` is the only open state: the same frames plus a `--frame-hint` would resolve to
 * `confirmed` or to `excluded`, which is exactly what the report's next step asks the author
 * for. `undetermined` and `unavailable` are closed the other way: nothing may be concluded from
 * an inventory that disagrees with itself or from a diagnosis that never happened.
 */
const CANDIDATE_SETS: Record<FrameDeterminationValue, FrameDeterminationValue[]> = {
  unavailable: ["unavailable"],
  undetermined: ["undetermined"],
  suspected: ["suspected", "confirmed", "excluded"],
  confirmed: ["confirmed"],
  excluded: ["excluded"],
};

function determination(value: FrameDeterminationValue, reason: string): FrameDetermination {
  const basis =
    value === "confirmed" || value === "excluded"
      ? "evidence"
      : value === "undetermined"
        ? "contradiction"
        : "no_evidence";
  return { value, basis, candidates: CANDIDATE_SETS[value], reason };
}

function normalizeHref(href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    return href;
  }
}

function rootCause(
  input: FrameRootCauseInput,
  value: FrameDeterminationValue,
  reason: string,
  confirmed: FrameCandidate | null = null,
): FrameRootCause {
  const topology = input.topology;
  const code =
    value === "unavailable"
      ? "frame_diagnosis_failed"
      : value === "undetermined"
        ? "frame_diagnosis_undetermined"
        : undefined;
  return {
    selector: input.selector,
    determination: determination(value, reason),
    primaryTag: confirmed?.primaryTag ?? null,
    confirmedCandidate: confirmed,
    hint: input.hint?.raw ?? null,
    candidates: topology?.candidates ?? [],
    excludedHidden: topology?.excludedHidden ?? [],
    unmatchedCdpFrames: topology?.unmatchedCdpFrames ?? 0,
    counts: topology?.counts ?? null,
    warnings: topology?.warnings ?? [],
    mainPage: topology ? { href: topology.mainPage.href, origin: topology.mainPage.origin } : null,
    source: input.source,
    ...(code ? { code } : {}),
  };
}

/**
 * The gate. Deterministic, replayable from the recorded inventory, and allowed to say it does
 * not know.
 *
 * The order is the contract. Navigation and inventory inconsistency come first, because a
 * diagnosis of the wrong page or of an inventory that disagrees with itself may conclude
 * nothing at all. Then the hint, which is the only positive link. Only with no hint and a
 * consistent inventory does the count of candidates decide, and then it decides in the one
 * direction it can: none means no frame explains the miss (`excluded`, by modus tollens); some
 * means a frame *might*, which is `suspected` and never `confirmed`.
 */
export function determineFrameRootCause(input: FrameRootCauseInput): FrameRootCause {
  const topology = input.topology;
  if (!topology) {
    return rootCause(
      input,
      "unavailable",
      input.unavailableReason ??
        "surf frame.diagnose produced no inventory for this page, so no frame question was answered",
    );
  }

  const failureHref = normalizeHref(input.failure?.href);
  const diagnosedHref = normalizeHref(topology.mainPage.href);
  if (failureHref && diagnosedHref && failureHref !== diagnosedHref) {
    return rootCause(
      input,
      "undetermined",
      `the page moved between the failure and the diagnosis: the step ran on ${failureHref} and frame.diagnose answered from ${diagnosedHref}`,
    );
  }
  if (
    input.failure?.browserEpoch &&
    input.source.browserEpoch &&
    input.failure.browserEpoch !== input.source.browserEpoch
  ) {
    return rootCause(
      input,
      "undetermined",
      `the browser epoch changed between the failure (${input.failure.browserEpoch}) and the diagnosis (${input.source.browserEpoch}), so the two observations are not of the same browser`,
    );
  }

  if (topology.inconsistencies.length > 0) {
    return rootCause(
      input,
      "undetermined",
      `the frame inventory disagrees with itself: ${topology.inconsistencies.join("; ")}`,
    );
  }

  const hint = input.hint;
  if (hint) {
    if (topology.unmatchedCdpFrames > 0) {
      return rootCause(
        input,
        "undetermined",
        `${topology.unmatchedCdpFrames} CDP child frame(s) are claimed by no <iframe> in the top document and surf does not say what they are, so a hint cannot be resolved against this inventory`,
      );
    }
    const matched = topology.candidates.filter((candidate) =>
      hintMatchesCandidate(hint, candidate),
    );
    if (matched.length === 0) {
      return rootCause(
        input,
        "undetermined",
        `--frame-hint '${hint.raw}' matched none of the ${topology.candidates.length} candidate frame(s); a hint that resolves to nothing is a test defect, not a weaker suspicion`,
      );
    }
    if (matched.length > 1) {
      return rootCause(
        input,
        "undetermined",
        `--frame-hint '${hint.raw}' matched ${matched.length} candidate frames; narrow it until it names exactly one`,
      );
    }
    const candidate = matched[0] as FrameCandidate;
    if (candidate.contentScriptReachable !== true) {
      return rootCause(
        input,
        "undetermined",
        `--frame-hint '${hint.raw}' named a frame whose content script does not answer (${candidate.src || "no src"}), so nothing can be read inside it and the hint cannot be checked`,
      );
    }
    return rootCause(
      input,
      "confirmed",
      `--frame-hint '${hint.raw}' resolves to exactly one reachable frame (${candidate.primaryTag ?? "same-process same-origin frame"}${candidate.domIndex === null ? "" : `, DOM index ${candidate.domIndex}`}), and a main-page selector does not reach into a frame`,
      candidate,
    );
  }

  if (topology.candidates.length === 0) {
    return rootCause(
      input,
      "excluded",
      `the page carries no frame a main-document selector could be missing into (${topology.excludedHidden.length} hidden frame(s) excluded), so '${input.selector}' is wrong in the main document`,
    );
  }

  return rootCause(
    input,
    "suspected",
    `${topology.candidates.length} frame(s) on this page cannot be reached from the main document and nothing links '${input.selector}' to any of them; pass --frame-hint to confirm, or confirm the selector in the main document`,
  );
}

// ============================================
// RENDERINGS (never a source of truth)
// ============================================

export const FRAME_ROOT_CAUSE_MARKER_PREFIX = "frame-root-cause:";

/** The one line legacy consumers parse. The typed field is what everything else reads. */
export function renderFrameRootCauseMarker(rootCauseValue: FrameRootCause): string {
  return `${FRAME_ROOT_CAUSE_MARKER_PREFIX} determination=${rootCauseValue.determination.value} tag=${rootCauseValue.primaryTag ?? "none"} candidates=${rootCauseValue.candidates.length} hint=${rootCauseValue.hint ?? "none"}`;
}

function describeCandidate(candidate: FrameCandidate): string {
  const where =
    candidate.domIndex === null ? `frame ${candidate.frameId}` : `iframe ${candidate.domIndex}`;
  return `${FRAME_ROOT_CAUSE_MARKER_PREFIX} candidate ${where} tag=${candidate.primaryTag ?? "none"} origin=${candidate.origin ?? "null"} reachable=${candidate.contentScriptReachable ?? "unknown"} src=${candidate.src || "(none)"}`;
}

/** The typed field rendered for a human: the marker first, then the evidence behind it. */
export function renderFrameRootCauseEvidence(rootCauseValue: FrameRootCause): string[] {
  return [
    renderFrameRootCauseMarker(rootCauseValue),
    `${FRAME_ROOT_CAUSE_MARKER_PREFIX} ${rootCauseValue.determination.reason}`,
    ...rootCauseValue.candidates.map(describeCandidate),
    ...rootCauseValue.warnings.map(
      (warning) => `${FRAME_ROOT_CAUSE_MARKER_PREFIX} surf: ${warning}`,
    ),
  ];
}

export interface FrameRootCauseMarker {
  determination: FrameDeterminationValue;
  primaryTag: string | null;
  candidates: number;
  hint: string | null;
}

const MARKER_PATTERN =
  /^frame-root-cause:\s+determination=(\w+)\s+tag=(\S+)\s+candidates=(\d+)\s+hint=(.*)$/;

/** Read the marker back. Only used for a finding written before the typed field existed. */
export function parseFrameRootCauseMarker(line: string): FrameRootCauseMarker | undefined {
  const match = MARKER_PATTERN.exec(line.trim());
  if (!match) {
    return undefined;
  }
  const value = match[1] as FrameDeterminationValue;
  if (!FRAME_DETERMINATION_VALUES.includes(value)) {
    return undefined;
  }
  return {
    determination: value,
    primaryTag: match[2] === "none" ? null : (match[2] as string),
    candidates: Number(match[3]),
    hint: match[4] === "none" ? null : (match[4] as string),
  };
}

/** The determination a legacy finding carries in its evidence lines, if any. */
export function frameDeterminationFromEvidence(
  evidence: readonly string[] | undefined,
): FrameDeterminationValue | undefined {
  for (const line of evidence ?? []) {
    const marker = parseFrameRootCauseMarker(line);
    if (marker) {
      return marker.determination;
    }
  }
  return undefined;
}

export interface FrameSwitchSuggestion {
  kind: "frame.switch";
  /** the DOM index surf's own `frame.switch --index` takes */
  index?: number;
  /** the extension frame id, for a nested frame that has no DOM index */
  frameId?: number;
  urlPrefix: string;
  /** how many switches it takes to get there; a nested frame is two */
  hops: number;
}

/**
 * What a reviewer would have to do instead of a selector rewrite.
 *
 * Extension frame ids are per-load, so the suggestion always carries the origin as well and the
 * consumer must re-diagnose before switching. It is offered only for a `confirmed`
 * determination: for anything less the framework does not know which frame it would name.
 */
export function frameSwitchSuggestion(
  rootCauseValue: FrameRootCause,
): FrameSwitchSuggestion | undefined {
  const candidate = rootCauseValue.confirmedCandidate;
  if (rootCauseValue.determination.value !== "confirmed" || !candidate) {
    return undefined;
  }
  return {
    kind: "frame.switch",
    ...(candidate.domIndex === null ? {} : { index: candidate.domIndex }),
    ...(candidate.frameId === null ? {} : { frameId: candidate.frameId }),
    urlPrefix: candidate.origin ?? candidate.src,
    hops: candidate.tags.includes("nested_frame") ? 2 : 1,
  };
}
