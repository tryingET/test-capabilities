/**
 * `a11y-snapshot.v1` and `a11y-assert.v1`: the accessibility observation channel's contract.
 *
 * The schema is the durable asset and the producer is replaceable (a11y-snapshot packet,
 * Clash 3 and the refinement's consequence 5): `channel` names the producer in every receipt.
 * The producer was agent-browser over CDP until the packet's sunset condition was met on
 * 2026-09-26 (AK #5915): surf's own `page.read --structure --full-page --nodes` emits roles,
 * names, headings and landmarks deterministically, so the second tool, its CDP attachment and
 * its stray tab are gone and no consumer changed.
 *
 * Two rules from the packet's adjudication live here, and nowhere else:
 *
 *   - **Validity is content identity.** A ref is valid *iff* the digest of a fresh snapshot
 *     equals the digest of the snapshot that minted it (Clash 5). There is no event list, no
 *     action count and no trust in the producer's own staleness bookkeeping: the producer was
 *     measured re-resolving `@e28` after a reload, and a `sequence` number orders artifacts
 *     without invalidating anything. A reload that leaves the tree byte-identical therefore
 *     keeps a ref valid, and a navigation that changes the tree does not.
 *   - **Cross-run identity is `{role, name}`.** Refs are a within-snapshot reading aid for a
 *     model; what a test writes down, and what survives into another run or another producer,
 *     is the role and the accessible name (Clash 4). Ambiguity is a typed `unverified`, never a
 *     guess and never an `nth`.
 *
 * Pure ring: types, the digest, the counts and the resolution rules. The step, the file and the
 * session live in `a11y-snapshot-observer.ts`.
 */

import { createHash } from "node:crypto";
import { FrameworkError } from "./runtime-contract.js";

export const A11Y_SNAPSHOT_SCHEMA_VERSION = 1;
export const A11Y_SNAPSHOT_KIND = "a11y-snapshot";
export const A11Y_ASSERT_KIND = "a11y-assert";

/** The producer this artifact came from; a switch is visible in every receipt. */
export const A11Y_CHANNEL = "surf-page-read";

/** The one read the channel makes; `--nodes` is the structured, footer-free form (AK #5915). */
export const A11Y_PAGE_READ_ARGS: readonly string[] = [
  "--structure",
  "--full-page",
  "--no-text",
  "--nodes",
];

/** The observation name the session registers this channel under. */
export const A11Y_SNAPSHOT_OBSERVATION = "a11y-snapshot";

// ============================================
// THE ARTIFACT
// ============================================

/** One node of the tree as the producer names it: what a person would call this control. */
export interface A11yRef {
  role: string;
  name: string;
}

/** `{ "e28": { role: "searchbox", name: "Find a release" }, ... }`, straight from the producer. */
export type A11yRefMap = Record<string, A11yRef>;

/** What the DOM has against what the tree can name, for one family of controls. */
export interface A11ySemanticCoverageEntry {
  dom: number;
  tree: number;
}

/**
 * The size of this channel's blind spot on this page (refinement, Clash 1).
 *
 * `dom` is the `dom` probe's own count on the same tab and the same page visit; `tree` is what
 * the accessibility tree could name. A gap is recorded evidence, never a failure and never
 * zeroed: it is the number of controls the application has and the browser cannot name, which
 * is exactly the set a tester must address through surf selectors instead of by role.
 */
export interface A11ySemanticCoverage {
  anchors: A11ySemanticCoverageEntry;
  buttons: A11ySemanticCoverageEntry;
  inputs: A11ySemanticCoverageEntry;
}

/** The counts the `dom` probe produced for the same page visit. */
export interface A11yDomProbeCounts {
  anchors: number;
  buttons: number;
  inputs: number;
}

/** The tab the tree was read from: the one surf opened for this run. */
export interface A11yTabBinding {
  surfTabId?: number;
  url: string;
  title: string;
}

export interface A11ySnapshotCaptured {
  schemaVersion: typeof A11Y_SNAPSHOT_SCHEMA_VERSION;
  kind: typeof A11Y_SNAPSHOT_KIND;
  channel: typeof A11Y_CHANNEL;
  tool: { command: string; version: string };
  tab: A11yTabBinding;
  /** orders artifacts within a run; it is *not* an invalidator (refinement, Clash 5) */
  sequence: number;
  capturedAt: string;
  elapsedMs: number;
  bytes: number;
  refCount: number;
  /** `sha256:<hex>` over the snapshot text, which is the only digest input */
  digest: string;
  refs: A11yRefMap;
  snapshot: string;
  roleCounts: Record<string, number>;
  /** absent when the `dom` probe did not verify; see {@link A11ySnapshotCaptured.coverageReason} */
  semanticCoverage?: A11ySemanticCoverage;
  /** why `semanticCoverage` is absent: `dom_probe_missing`, never a zero */
  coverageReason?: "dom_probe_missing";
  status: "captured";
}

export interface A11ySnapshotUnavailable {
  schemaVersion: typeof A11Y_SNAPSHOT_SCHEMA_VERSION;
  kind: typeof A11Y_SNAPSHOT_KIND;
  channel: typeof A11Y_CHANNEL;
  status: "unavailable";
  /** the registered code that says why: `surf_page_read_unsupported`, `snapshot_failed`, ... */
  reason: string;
  detail?: string;
}

export type A11ySnapshotArtifact = A11ySnapshotCaptured | A11ySnapshotUnavailable;

/**
 * What the page result carries (architecture review A10): the digest, the refs map, the counts
 * and the file's path - never the ~8 KB snapshot text, which stays in the 0600 artifact.
 */
export interface A11ySnapshotObservation {
  channel: typeof A11Y_CHANNEL;
  status: "captured" | "unavailable";
  /** where the artifact was written; absent when the write itself failed */
  artifact?: string;
  /** why the artifact could not be written; the observation still reaches the caller */
  artifactError?: string;
  reason?: string;
  detail?: string;
  digest?: string;
  refCount?: number;
  bytes?: number;
  sequence?: number;
  refs?: A11yRefMap;
  roleCounts?: Record<string, number>;
  semanticCoverage?: A11ySemanticCoverage;
  coverageReason?: "dom_probe_missing";
  tab?: A11yTabBinding;
  tool?: { command: string; version: string };
}

/** The three channel modes; `off` is the default, so an existing run is byte-compatible. */
export const A11Y_SNAPSHOT_MODES = ["off", "optional", "required"] as const;
export type A11ySnapshotMode = (typeof A11Y_SNAPSHOT_MODES)[number];

export function isA11ySnapshotMode(value: unknown): value is A11ySnapshotMode {
  return typeof value === "string" && (A11Y_SNAPSHOT_MODES as readonly string[]).includes(value);
}

/**
 * The mode a caller asked for: `--a11y-snapshot` with no value is `optional`, `=required` fails
 * the page when the channel cannot observe, and `off` (or nothing at all) leaves the run
 * byte-identical to one from before this channel existed.
 *
 * An unknown value is refused rather than defaulted, because the difference between `optional`
 * and `required` is the difference between a recorded gap and a verdict.
 */
export function parseA11ySnapshotMode(
  value: string | boolean | undefined,
): "optional" | "required" | undefined {
  if (value === undefined || value === false) {
    return undefined;
  }
  const normalized = value === true || value.trim() === "" ? "optional" : value.trim();
  if (!isA11ySnapshotMode(normalized)) {
    throw new FrameworkError(
      "config_invalid",
      `--a11y-snapshot takes one of ${A11Y_SNAPSHOT_MODES.join(", ")}; '${String(value)}' is none of them.`,
      { option: "--a11y-snapshot", value: String(value) },
    );
  }
  return normalized === "off" ? undefined : normalized;
}

// ============================================
// DIGEST, ROLES AND THE BLIND SPOT
// ============================================

/**
 * The identity of "the page as the tree sees it".
 *
 * The input is the snapshot *text* and nothing else: it is what the producer renders, what a
 * tester prompt reads, and what a byte-identical tree reproduces. The refs map is deliberately
 * not hashed - it is the same information in another shape, and hashing both would make the
 * digest depend on a JSON key order the producer does not promise.
 */
export function snapshotDigest(snapshotText: string): string {
  return `sha256:${createHash("sha256").update(snapshotText, "utf8").digest("hex")}`;
}

/** Role counts derived from the refs map; the packet's `roleCounts`, in descending order. */
export function roleCountsFrom(refs: A11yRefMap): Record<string, number> {
  const counts = new Map<string, number>();
  for (const entry of Object.values(refs)) {
    const role = typeof entry?.role === "string" && entry.role.length > 0 ? entry.role : "unknown";
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  );
}

/**
 * The tree roles that answer the `dom` probe's `input,textarea,select` count. The union is the
 * packet's; a role the browser computes for a control the DOM counts as an input belongs here,
 * and anything else would overstate what the tree can name.
 */
export const A11Y_INPUT_ROLES: readonly string[] = [
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "slider",
  "spinbutton",
  "listbox",
];

/**
 * The DOM's counts against the tree's, or the typed reason there is no comparison.
 *
 * A missing `dom` probe yields `undefined` with `dom_probe_missing`, never zeros: a zero would
 * claim the page has no anchors, and the truth is that nothing counted them.
 */
export function semanticCoverageFrom(
  roleCounts: Record<string, number>,
  domCounts: A11yDomProbeCounts | undefined,
): { semanticCoverage: A11ySemanticCoverage } | { coverageReason: "dom_probe_missing" } {
  if (!domCounts) {
    return { coverageReason: "dom_probe_missing" };
  }
  const treeInputs = A11Y_INPUT_ROLES.reduce((sum, role) => sum + (roleCounts[role] ?? 0), 0);
  return {
    semanticCoverage: {
      anchors: { dom: domCounts.anchors, tree: roleCounts.link ?? 0 },
      buttons: { dom: domCounts.buttons, tree: roleCounts.button ?? 0 },
      inputs: { dom: domCounts.inputs, tree: treeInputs },
    },
  };
}

/** The families where the DOM counted more controls than the tree could name. */
export function semanticCoverageGaps(coverage: A11ySemanticCoverage): Array<{
  family: keyof A11ySemanticCoverage;
  missing: number;
}> {
  return (Object.keys(coverage) as Array<keyof A11ySemanticCoverage>)
    .map((family) => ({ family, missing: coverage[family].dom - coverage[family].tree }))
    .filter((entry) => entry.missing > 0);
}

/** What one structured read says about the page, before anything is decided about it. */
export interface A11ySnapshotReading {
  origin: string;
  title: string;
  refs: A11yRefMap;
  snapshot: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** surf appends the window size to the tree; it is not the page, so it is not digested. */
const VIEWPORT_FOOTER = /\n*\[Viewport: \d+x\d+\]\s*$/;

/**
 * Map surf's `page.read --nodes` payload (`{pageContent, nodes, url, title}`) onto the reading
 * this schema is built from, or say what is wrong with it.
 *
 * The refs map comes from `nodes` - the parser-free source of `{role, name}`; deriving it from
 * the text would recreate the `parseSnapshot` failure this channel exists to avoid - and the
 * text, without its viewport line, is the only digest input. A payload without `nodes` is a
 * surf that does not know `--nodes` (`surf_page_read_unsupported`). An empty tree is a failure,
 * never a zero-element success (assessment row 5).
 */
export function parseA11ySnapshotPayload(payload: unknown):
  | { reading: A11ySnapshotReading }
  | {
      error: "snapshot_failed" | "empty_snapshot" | "surf_page_read_unsupported";
      detail: string;
    } {
  if (typeof payload === "string") {
    return {
      error: "surf_page_read_unsupported",
      detail: `page.read answered text instead of the --nodes object (${payload.slice(0, 80).replace(/\s+/g, " ")}...)`,
    };
  }
  if (!isRecord(payload)) {
    return {
      error: "snapshot_failed",
      detail: `payload is ${payload === null ? "null" : typeof payload}, not an object`,
    };
  }
  const { pageContent, nodes, url, title } = payload;
  if (nodes === undefined) {
    return {
      error: "surf_page_read_unsupported",
      detail: "page.read answered without 'nodes'; this surf does not know --nodes",
    };
  }
  if (typeof pageContent !== "string") {
    return { error: "snapshot_failed", detail: "payload carries no 'pageContent' text" };
  }
  if (!Array.isArray(nodes)) {
    return { error: "snapshot_failed", detail: "payload 'nodes' is not a list" };
  }
  const parsedRefs: A11yRefMap = {};
  for (const [index, node] of nodes.entries()) {
    if (
      !isRecord(node) ||
      typeof node.ref !== "string" ||
      typeof node.role !== "string" ||
      typeof node.name !== "string"
    ) {
      return { error: "snapshot_failed", detail: `node ${index} is not a {ref, role, name} node` };
    }
    parsedRefs[node.ref] = { role: node.role, name: node.name };
  }
  const snapshot = pageContent.replace(VIEWPORT_FOOTER, "");
  if (snapshot.trim().length === 0 || Object.keys(parsedRefs).length === 0) {
    return {
      error: "empty_snapshot",
      detail: `the tree has ${Object.keys(parsedRefs).length} ref(s) and ${snapshot.trim().length} characters of text`,
    };
  }
  return {
    reading: {
      origin: typeof url === "string" ? url : "",
      title: typeof title === "string" ? title : "",
      refs: parsedRefs,
      snapshot,
    },
  };
}

// ============================================
// THE ASSERTION
// ============================================

/** What an assertion expects of the node it resolved. `visible` is a computed predicate. */
export interface A11yExpectation {
  role?: string;
  name?: string;
  /** the reader's computed style-and-geometry predicate, never a perceptual claim */
  visible?: boolean;
  text?: string;
  attr?: Record<string, string>;
}

/** A handle minted by one snapshot; valid only against a snapshot with the same digest. */
export interface A11yRefAssertion {
  kind: "a11y-ref";
  snapshotDigest: string;
  ref: string;
  expect: A11yExpectation;
}

/** The cross-run form: what a person would call the control, resolved in the fresh snapshot. */
export interface A11yRoleAssertion {
  kind: "a11y-role";
  role: string;
  name: string;
  expect?: A11yExpectation;
}

export type A11yAssertion = A11yRefAssertion | A11yRoleAssertion;

export type A11yAssertionStatus = "passed" | "failed" | "unverified";

export interface A11yAssertionResult {
  kind: A11yAssertion["kind"];
  status: A11yAssertionStatus;
  /** set on `unverified`: the registered code that says why nothing could be decided */
  code?: string;
  /** the ref the assertion resolved to in the *fresh* snapshot */
  ref?: string;
  /** on `role_name_ambiguous`: every ref the pair matched, so a reader can scope by hand */
  candidates?: string[];
  digest?: string;
  expectedDigest?: string;
  evidence: string[];
  reason?: string;
}

/** The fresh snapshot an assertion is evaluated against; always taken immediately before. */
export interface A11ySnapshotView {
  digest: string;
  refs: A11yRefMap;
}

/** Every ref whose `{role, name}` equals the pair, in ref order. */
export function findRefsByRoleName(refs: A11yRefMap, role: string, name: string): string[] {
  return Object.entries(refs)
    .filter(([, entry]) => entry?.role === role && entry?.name === name)
    .map(([ref]) => ref)
    .sort();
}

/**
 * Resolve an assertion against a fresh snapshot: the pure half of the evaluation.
 *
 * It answers with a ref to read, or with the `unverified` result that says why nothing may be
 * read. `ref_context_drift` is the answer whenever the fresh digest is not the minting digest
 * *or* the ref no longer carries the role and name it was written for - both mean the handle
 * addresses something the assertion was not written about, and neither is a failure of the
 * target (packet, "Behaviour and failure modes").
 */
export function resolveA11yAssertion(
  assertion: A11yAssertion,
  fresh: A11ySnapshotView,
): { ref: string; node: A11yRef } | A11yAssertionResult {
  if (assertion.kind === "a11y-ref") {
    if (fresh.digest !== assertion.snapshotDigest) {
      return {
        kind: assertion.kind,
        status: "unverified",
        code: "ref_context_drift",
        digest: fresh.digest,
        expectedDigest: assertion.snapshotDigest,
        evidence: [
          `a11y-ref ${assertion.ref} was minted against ${assertion.snapshotDigest}`,
          `the fresh snapshot is ${fresh.digest}`,
        ],
        reason:
          "The page's accessibility tree is not the tree this ref was minted against, so the ref addresses an unknown node. Re-snapshot and assert by {role, name} instead.",
      };
    }
    const node = fresh.refs[assertion.ref];
    if (!node) {
      return {
        kind: assertion.kind,
        status: "unverified",
        code: "ref_context_drift",
        digest: fresh.digest,
        expectedDigest: assertion.snapshotDigest,
        evidence: [`the fresh snapshot ${fresh.digest} carries no ref ${assertion.ref}`],
        reason:
          "The digest matched but the ref is absent, so the producer's ref minting is not reproducible for this page; nothing may be read through it.",
      };
    }
    const expectedRole = assertion.expect.role;
    const expectedName = assertion.expect.name;
    if (
      (expectedRole !== undefined && node.role !== expectedRole) ||
      (expectedName !== undefined && node.name !== expectedName)
    ) {
      return {
        kind: assertion.kind,
        status: "unverified",
        code: "ref_context_drift",
        ref: assertion.ref,
        digest: fresh.digest,
        expectedDigest: assertion.snapshotDigest,
        evidence: [
          `${assertion.ref} is ${node.role} "${node.name}" in the fresh snapshot`,
          `the assertion was written for ${expectedRole ?? node.role} "${expectedName ?? node.name}"`,
        ],
        reason:
          "The digest matched but the ref names another control, so the handle is not the one the assertion was written about.",
      };
    }
    return { ref: assertion.ref, node };
  }

  const candidates = findRefsByRoleName(fresh.refs, assertion.role, assertion.name);
  if (candidates.length === 0) {
    return {
      kind: assertion.kind,
      status: "unverified",
      code: "role_name_missing",
      digest: fresh.digest,
      evidence: [
        `no ${assertion.role} named "${assertion.name}" in the fresh snapshot ${fresh.digest}`,
      ],
      reason:
        "The tree carries no control with that role and name. Either the page changed or the browser cannot name this control; check semanticCoverage and assert it through a surf selector.",
    };
  }
  if (candidates.length > 1) {
    return {
      kind: assertion.kind,
      status: "unverified",
      code: "role_name_ambiguous",
      digest: fresh.digest,
      candidates,
      evidence: [
        `${candidates.length} refs match ${assertion.role} "${assertion.name}": ${candidates.join(", ")}`,
      ],
      reason:
        "A {role, name} pair that is not unique on the page identifies nothing. Landmark scoping is not available in v1, so the assertion is reported rather than guessed at.",
    };
  }
  const ref = candidates[0] as string;
  return { ref, node: fresh.refs[ref] as A11yRef };
}

/** One ref-addressed read the evaluator asked the producer for. */
export interface A11yCheckReading {
  /** the read-only verb and argument, as the producer was asked (`is visible @e28`) */
  command: string;
  value: string;
}

/** The reads an evaluation needs; the runtime supplies them from the same pinned session. */
export interface A11yCheckReader {
  visible?(ref: string): Promise<A11yCheckReading>;
  text?(ref: string): Promise<A11yCheckReading>;
  attr?(ref: string, name: string): Promise<A11yCheckReading>;
}

function comparisonEvidence(reading: A11yCheckReading, expected: string): string {
  return `${reading.command} -> ${JSON.stringify(reading.value)} (expected ${JSON.stringify(expected)})`;
}

/**
 * Evaluate one assertion against a fresh snapshot and the reads the same session can make.
 *
 * The order is the packet's and it is not negotiable: resolve first (digest, then `{role,
 * name}`), and only read once a single node is identified. A reader the caller did not supply
 * makes the corresponding expectation `unverified` rather than silently passing - an
 * expectation nothing checked is not an expectation that held.
 */
export async function evaluateA11yAssertion(
  assertion: A11yAssertion,
  fresh: A11ySnapshotView,
  reader: A11yCheckReader = {},
): Promise<A11yAssertionResult> {
  const resolved = resolveA11yAssertion(assertion, fresh);
  if ("status" in resolved) {
    return resolved;
  }

  const expectation = assertion.kind === "a11y-ref" ? assertion.expect : (assertion.expect ?? {});
  const evidence: string[] = [
    `${resolved.ref} is ${resolved.node.role} "${resolved.node.name}" in snapshot ${fresh.digest}`,
  ];
  const failures: string[] = [];

  if (assertion.kind === "a11y-role" && expectation.role !== undefined) {
    if (resolved.node.role !== expectation.role) {
      failures.push(`role is ${resolved.node.role}, expected ${expectation.role}`);
    }
  }

  if (expectation.visible !== undefined) {
    if (!reader.visible) {
      return unreadable(assertion, fresh, resolved.ref, "visible", evidence);
    }
    const reading = await reader.visible(resolved.ref);
    evidence.push(comparisonEvidence(reading, String(expectation.visible)));
    if (reading.value !== String(expectation.visible)) {
      failures.push(`visible is ${reading.value}, expected ${String(expectation.visible)}`);
    }
  }

  if (expectation.text !== undefined) {
    if (!reader.text) {
      return unreadable(assertion, fresh, resolved.ref, "text", evidence);
    }
    const reading = await reader.text(resolved.ref);
    evidence.push(comparisonEvidence(reading, expectation.text));
    if (reading.value !== expectation.text) {
      failures.push(`text is ${JSON.stringify(reading.value)}`);
    }
  }

  for (const [name, expected] of Object.entries(expectation.attr ?? {})) {
    if (!reader.attr) {
      return unreadable(assertion, fresh, resolved.ref, `attr ${name}`, evidence);
    }
    const reading = await reader.attr(resolved.ref, name);
    evidence.push(comparisonEvidence(reading, expected));
    if (reading.value !== expected) {
      failures.push(`attr ${name} is ${JSON.stringify(reading.value)}`);
    }
  }

  return {
    kind: assertion.kind,
    status: failures.length === 0 ? "passed" : "failed",
    ref: resolved.ref,
    digest: fresh.digest,
    ...(assertion.kind === "a11y-ref" ? { expectedDigest: assertion.snapshotDigest } : {}),
    evidence,
    ...(failures.length === 0 ? {} : { reason: failures.join("; ") }),
  };
}

function unreadable(
  assertion: A11yAssertion,
  fresh: A11ySnapshotView,
  ref: string,
  what: string,
  evidence: string[],
): A11yAssertionResult {
  return {
    kind: assertion.kind,
    status: "unverified",
    code: "a11y_check_unavailable",
    ref,
    digest: fresh.digest,
    evidence: [...evidence, `no reader for '${what}'`],
    reason: `The assertion expects '${what}' but this evaluation has no read-only channel for it, so nothing was checked. An expectation nothing checked never passes.`,
  };
}

// ============================================
// THE TESTER PROMPT INPUT
// ============================================

export interface TesterPromptOptions {
  /** how many snapshot lines to hand over; the whole tree by default */
  maxLines?: number;
}

/**
 * What an LLM-driven tester reads instead of a DOM dump (packet, "Tester prompt input").
 *
 * Three things travel and nothing else: the snapshot text (about 2 k tokens against 22 KB for
 * `page.read` or an image), the coverage gap so the model routes the controls the browser cannot
 * name to surf selectors, and the instruction to write `{role, name}` rather than `eN` - because
 * the refs it is reading die with this snapshot, and the digest that owns them is named.
 */
export function renderTesterPromptInput(
  artifact: A11ySnapshotArtifact,
  options: TesterPromptOptions = {},
): string {
  if (artifact.status === "unavailable") {
    return [
      `Accessibility snapshot: unavailable (${artifact.reason}).`,
      "Assert through surf selectors; no role-addressed assertion can be written for this page.",
    ].join("\n");
  }

  const lines = artifact.snapshot.split("\n");
  const shown =
    options.maxLines !== undefined && lines.length > options.maxLines
      ? [...lines.slice(0, options.maxLines), `… ${lines.length - options.maxLines} more line(s)`]
      : lines;

  const header = `Page: ${artifact.tab.url} (readiness: ready). Accessibility snapshot (${artifact.channel}, ${artifact.refCount} refs):`;

  const gapLine = artifact.semanticCoverage
    ? gapSentence(artifact.semanticCoverage)
    : `Controls the DOM has that the tree cannot name: not measured (${artifact.coverageReason ?? "dom_probe_missing"}); prefer surf selectors where a control is not in the tree.`;

  return [
    header,
    ...shown,
    ...(gapLine ? [gapLine] : []),
    `Write assertions as {kind: "a11y-role", role, name, expect}; do not emit eN refs,`,
    `they are valid only for this snapshot (digest ${artifact.digest}). If a {role, name} pair is not`,
    "unique on this page, say so instead of picking one.",
  ].join("\n");
}

function gapSentence(coverage: A11ySemanticCoverage): string | undefined {
  const gaps = semanticCoverageGaps(coverage);
  if (gaps.length === 0) {
    return undefined;
  }
  return `Controls the DOM has that the tree cannot name (semanticCoverage gap): ${gaps
    .map((gap) => `${gap.missing} ${gap.family}`)
    .join(", ")}; assert those through surf selectors, not by role.`;
}
