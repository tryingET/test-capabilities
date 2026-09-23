import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { A11yDomProbeCounts } from "../a11y-snapshot.js";
import { parseA11ySnapshotMode } from "../a11y-snapshot.js";
import {
  A11Y_SNAPSHOT_OBSERVER_NAME,
  a11yChannelSummary,
  createA11ySnapshotObserver,
  observationsOf,
} from "../a11y-snapshot-observer.js";
import type { BrowserStep, SessionReadiness, SessionReply } from "../browser-session.js";
import type { EffectAttempt, EffectDeclaration } from "../effects.js";
import { ElementUnreachable, isElementReachFailure } from "../frame-diagnosis.js";
import type { FrameRootCause } from "../frame-root-cause.js";
import { parseFrameHint } from "../frame-root-cause.js";
import type { ExpectDeclaration, ResultOutcome } from "../result-classification.js";
import type { RunContext } from "../run-context.js";
import { finalizeEnvelope, mintOperationContext } from "../run-context.js";
import { FrameworkError, isFrameworkError } from "../runtime-contract.js";
import { SessionReadinessRefusal } from "../surf-readiness.js";
import { parseSurfJsonOutput, SurfCommandError, translateSurfArgs } from "../surf-runtime.js";
import type { SurfSessionRuntime } from "../surf-session.js";
import {
  resolveSurfSessionRuntime,
  SURF_SESSION_READY_TIMEOUT_MS,
  SurfSession,
} from "../surf-session.js";
import { assertSupportedSurfExploreOptions } from "./support.js";
import type {
  OperationDefinition,
  SurfExploreOperationInput,
  SurfExploreOperationResultEnvelope,
  SurfExplorePageResult,
  SurfExploreProbeResult,
} from "./types.js";

const DEFAULT_SURF_EXPLORE_DEPTH = 1;
const MAX_SURF_EXPLORE_DEPTH = 3;
const MAX_SURF_EXPLORE_PAGES = 10;
const MAX_SURF_EXPLORE_LINKS_PER_PAGE = 5;

/**
 * The read-only budget for the links probe. It is *ours*: `--retry 1` tells surf to make one
 * attempt, so a second attempt is the ledger's decision, it appears in the ledger's attempt log,
 * and the page's own evidence can revoke it (mutation-safety packet, "Read-only retry is bounded
 * and declared").
 */
const SURF_EXPLORE_LINKS_ATTEMPTS = 2;
const SURF_EXPLORE_UPSTREAM_RETRY = "1";

export const SurfExploreOperationInputSchema = z.preprocess(
  (raw) => {
    // The submit gate's options reach this schema too (one commander command, three actions),
    // and a key explore does not declare would be stripped before anything could refuse it.
    if (typeof raw === "object" && raw !== null) {
      assertSupportedSurfExploreOptions(raw as Record<string, unknown>);
    }
    return raw;
  },
  z
    .object({
      url: z
        .string({
          required_error: "Surf explore requires --url with a valid URL.",
        })
        .url("Surf explore target must be a valid URL."),
      depth: z.string().optional(),
      json: z.boolean().optional().default(false),
      readySelector: z.string().min(1).optional(),
      frameHint: z.string().min(1).optional(),
      frameProbe: z.boolean().optional(),
      a11ySnapshot: z.union([z.string().min(1), z.boolean()]).optional(),
      record: z.boolean().optional().default(false),
      validate: z.boolean().optional().default(false),
      baseline: z.string().optional(),
      aiDiff: z.boolean().optional().default(false),
      file: z.string().optional(),
    })
    .transform((input) => {
      assertSupportedSurfExploreOptions(input);
      parseSurfExploreDepth(input.depth);
      assertFrameHintUsable(input);
      parseA11ySnapshotMode(input.a11ySnapshot);
      return input;
    }),
);

type NormalizedSurfExploreOperationInput = z.output<typeof SurfExploreOperationInputSchema>;

type SurfExploreProbeKind = SurfExploreProbeResult["kind"];

type SurfExploreEvidence = SurfExploreOperationResultEnvelope["result"]["evidence"];

type SurfExploreEvidenceMatch = {
  signal: string;
  record: Record<string, unknown>;
};

type ProbeExecution = {
  probe: SurfExploreProbeResult;
  stdout: string;
  stderr: string;
  discoveredUrls: string[];
  links?: SurfExplorePageResult["links"];
  /** the `dom` probe's element counts; the a11y channel measures its blind spot against them */
  domCounts?: A11yDomProbeCounts;
};

/**
 * The classified outcome behind a refusal, when the refusal came from a surf command. A
 * framework-side refusal (a probe whose payload carries no browser evidence, an owned tab that
 * reported no id) has none, and the consumer must not invent one.
 */
export function outcomeFromError(error: unknown): ResultOutcome | undefined {
  if (
    error instanceof SurfCommandError ||
    error instanceof SessionReadinessRefusal ||
    error instanceof SurfExploreProbeRefusal ||
    error instanceof ElementUnreachable
  ) {
    return error.outcome;
  }
  return undefined;
}

const SURF_EXPLORE_PROBE_FIELD = "__testCapabilitiesSurfExploreProbe";

/**
 * The seed page produced no verified state probe. The refusal carries the probe's own code and
 * classified outcome, so a page that refused the framework (`page_login`), a surf command that
 * failed (`exit_9`) and a probe that answered with nothing (`empty_result`) reach the caller as
 * three different refusals instead of one prose message (adjudication claim 45).
 */
export class SurfExploreProbeRefusal extends FrameworkError {
  readonly outcome: ResultOutcome | undefined;
  /** the frame determination the seed probe carried, when one was taken */
  readonly frameRootCause: FrameRootCause | undefined;

  constructor(url: string, probe: SurfExploreProbeResult | undefined) {
    const frameRootCause = probe?.frameRootCause;
    super(
      probe?.code ?? "probe_unverified",
      probe?.error ??
        `Surf explore produced no verified browser evidence from the seed page state probe for ${url}.`,
      {
        url,
        ...(probe ? { probe: probe.kind } : {}),
        // The frame determination travels on the refusal so the CLI envelope carries the same
        // typed answer the probe and the finding do (architecture review A20).
        ...(frameRootCause
          ? {
              selector: frameRootCause.selector,
              determination: frameRootCause.determination.value,
              candidates: frameRootCause.candidates.length,
              ...(frameRootCause.primaryTag ? { tag: frameRootCause.primaryTag } : {}),
              ...(frameRootCause.hint ? { hint: frameRootCause.hint } : {}),
              // surf's own code for the failure, from the classified outcome behind it
              ...(probe?.outcome?.code ? { surf_code: probe.outcome.code } : {}),
            }
          : {}),
      },
    );
    this.name = "SurfExploreProbeRefusal";
    this.outcome = probe?.outcome;
    this.frameRootCause = probe?.frameRootCause;
  }
}

/**
 * Our own probe answered from a page we did not gate. That is the target moving under a
 * read-only step: the session's `observe` hook turns it into `read_only_violation_observed`, so
 * the remaining budget is forfeit and the *repeat* never happens (mutation-safety packet,
 * "Revocation of read-only retry").
 */
class ProbeTargetMoved extends Error {
  readonly href: string;

  constructor(href: string, accepted: Set<string>) {
    super(
      `the probe answered from ${href}, outside the URL set this page was gated on (${[...accepted].join(", ")})`,
    );
    this.name = "ProbeTargetMoved";
    this.href = href;
  }
}

function parseSurfExploreDepth(depth: string | undefined): number {
  if (depth === undefined) {
    return DEFAULT_SURF_EXPLORE_DEPTH;
  }

  const normalized = depth.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Surf explore --depth must be an integer from 1 to ${MAX_SURF_EXPLORE_DEPTH}.`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_SURF_EXPLORE_DEPTH) {
    throw new Error(`Surf explore --depth must be an integer from 1 to ${MAX_SURF_EXPLORE_DEPTH}.`);
  }

  return parsed;
}

function normalizeUrl(value: string): string | undefined {
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

function normalizeVisitKey(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The surf CLI prints `[surf tab=<id> window=<id>]` on stderr for every targeted call. */
function stripSurfContextLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\[surf tab=\d+ window=\d+\]$/.test(line.trim()))
    .join("\n")
    .trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A hint says which frame the author believes the target lives in, so it only means anything
 * once something has failed to reach that target. Without `--ready-selector` nothing in an
 * explore run names an element, so a hint on its own is a caller believing something the run
 * will not do (submit-gate packet §5, "fail closed everywhere").
 */
function assertFrameHintUsable(input: {
  readySelector?: string;
  frameHint?: string;
  frameProbe?: boolean;
}): void {
  if (input.frameProbe === true && input.readySelector === undefined) {
    throw new FrameworkError(
      "config_invalid",
      "Surf explore takes --frame-probe only together with --ready-selector: the probe looks for a selector that failed to be reached, and without one nothing in an explore run names an element.",
      { option: "--frame-probe" },
    );
  }
  if (input.frameHint === undefined) {
    return;
  }
  if (input.readySelector === undefined) {
    throw new FrameworkError(
      "config_invalid",
      "Surf explore takes --frame-hint only together with --ready-selector: the hint says which frame a failing selector lives in, and without a selector to wait for, nothing in an explore run can fail to be reached.",
      { option: "--frame-hint" },
    );
  }
  parseFrameHint(input.frameHint);
}

/**
 * The frame diagnosis, when a `--ready-selector` gate could not reach its element.
 *
 * It runs in the tab that is still open, before `close()` in the caller's `finally`, and it
 * never throws: a diagnosis that failed is `unavailable` on the typed field, which the report
 * files as a coverage gap rather than leaving to the regex.
 */
async function diagnoseUnreachable(
  session: SurfSession,
  input: NormalizedSurfExploreOperationInput,
  error: unknown,
  readiness: SessionReadiness | undefined,
): Promise<ElementUnreachable | undefined> {
  const selector = input.readySelector;
  if (selector === undefined || !(error instanceof SessionReadinessRefusal)) {
    return undefined;
  }
  if (!isElementReachFailure(readiness?.code ?? error.code)) {
    return undefined;
  }
  const frameRootCause = await session.explainUnreachable(selector, {
    ...(input.frameHint ? { frameHint: input.frameHint } : {}),
    ...(input.frameProbe === true ? { probe: true } : {}),
    ...(readiness?.href ? { failure: { href: readiness.href } } : {}),
  });
  return new ElementUnreachable(
    session.url,
    selector,
    {
      ...(error.code ? { code: error.code } : {}),
      message: error.message,
      ...(error.outcome ? { outcome: error.outcome } : {}),
    },
    frameRootCause,
  );
}

function errorCode(error: unknown): string | undefined {
  return isFrameworkError(error) ? error.code : undefined;
}

// ============================================
// DECLARATIONS
// ============================================

/**
 * Explore opens a tab it owns, reads the page through `wait.ready`, `js` probes and `extract`,
 * and closes the tab in `finally`. The tab lifecycle is a `browser_session` effect: it changes
 * the browser the run brought with it, never the target.
 */
export const SURF_EXPLORE_OPERATION_EFFECT: EffectDeclaration = {
  effect: "read_only",
  scope: "browser_session",
  reason: "opens a tab it owns, reads the page and closes the tab; no step changes the target",
};

/**
 * `js` carries no class, so the probes declare one (mutation-safety packet, "Declaration
 * points"). Every probe expression is built by {@link buildProbeExpression} out of reads -
 * `location.href`, `document.title`, `document.readyState`, element counts, anchor hrefs - and
 * the session checks the claim against the denylist before a process exists.
 */
const SURF_EXPLORE_PROBE_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason: "a page-side expression that reads location, title, readyState and element counts",
};

/**
 * The one emptiness this operation declares on its own authority: a page may legitimately have
 * no same-origin links, and the operation knows that because it wrote the probe. It replaces the
 * bare `--allow-empty` flag, which told surf to permit zero rows but left the framework with no
 * record of who permitted it (result-classification packet, "Declaring acceptable emptiness";
 * plan S4). Every other empty payload in this operation stays an absence of evidence.
 */
const SURF_EXPLORE_LINKS_EMPTINESS: ExpectDeclaration = {
  output: "empty",
  declaredBy: "operation:surf.explore.links",
};

// ============================================
// PROBES
// ============================================

/**
 * The `state` and `dom` probes are pure expressions: the surf CLI evaluates `js` code in
 * expression mode first (`return (<code>)`), so an IIFE works without the statement fallback.
 * The `links` probe runs through `extract`, which always prefixes a `const SURF_OPTIONS = ...`
 * prelude; that makes the script a statement list, so it must `return` explicitly (verified live:
 * a bare expression is reported as `[no_output]`).
 */
function buildProbeExpression(kind: SurfExploreProbeKind, probeId: string): string {
  const probeIdLiteral = JSON.stringify(probeId);
  const browserState = `${SURF_EXPLORE_PROBE_FIELD}: ${probeIdLiteral}, href: location.href, title: document.title, readyState: document.readyState`;

  if (kind === "links") {
    return `return (() => { const seen = new Set(); const rows = Array.from(document.querySelectorAll('a[href]')).map((anchor) => new URL(anchor.getAttribute('href'), location.href).href).filter((href) => { const url = new URL(href); if (url.origin !== location.origin) return false; url.hash = ''; if (seen.has(url.href)) return false; seen.add(url.href); return true; }).slice(0, ${MAX_SURF_EXPLORE_LINKS_PER_PAGE}).map((href) => ({ href })); return { ${browserState}, kind: 'links', rows }; })();`;
  }

  if (kind === "dom") {
    return `(() => ({ ${browserState}, kind: 'dom', anchors: document.querySelectorAll('a[href]').length, buttons: document.querySelectorAll('button,[role=button],input[type=submit]').length, forms: document.querySelectorAll('form').length, inputs: document.querySelectorAll('input,textarea,select').length, iframes: document.querySelectorAll('iframe').length }))()`;
  }

  return `(() => ({ ${browserState}, kind: 'state' }))()`;
}

const PROBE_URL_KEYS = ["href", "url", "currentUrl", "current_url", "location"];

function hasAnyUrl(value: unknown, acceptedUrls: Set<string>): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = normalizeUrl(value);
  return normalized !== undefined && acceptedUrls.has(normalized);
}

function objectContainsVerifiedBrowserEvidence(
  value: unknown,
  acceptedUrls: Set<string>,
  probeId: string,
): SurfExploreEvidenceMatch | undefined {
  if (!isRecord(value) || value[SURF_EXPLORE_PROBE_FIELD] !== probeId) {
    return undefined;
  }

  const matchedUrlKey = PROBE_URL_KEYS.find((key) => hasAnyUrl(value[key], acceptedUrls));
  if (!matchedUrlKey) {
    return undefined;
  }

  const browserStateSignals = [
    typeof value.title === "string" && value.title.trim().length > 0,
    typeof value.readyState === "string" && value.readyState.trim().length > 0,
    Array.isArray(value.rows) || Array.isArray(value.links),
    typeof value.anchors === "number" ||
      typeof value.buttons === "number" ||
      typeof value.forms === "number" ||
      typeof value.inputs === "number",
  ];

  if (!browserStateSignals.some(Boolean)) {
    return undefined;
  }

  return {
    signal: `structured ${matchedUrlKey} with browser state`,
    record: value,
  };
}

function findEvidence(
  value: unknown,
  acceptedUrls: Set<string>,
  probeId: string,
): SurfExploreEvidenceMatch | undefined {
  const direct = objectContainsVerifiedBrowserEvidence(value, acceptedUrls, probeId);
  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findEvidence(item, acceptedUrls, probeId);
      if (nested) {
        return nested;
      }
    }
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const nested = findEvidence(item, acceptedUrls, probeId);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

/** The probe record this run minted, wherever it answered from. */
function findProbeRecord(value: unknown, probeId: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findProbeRecord(item, probeId);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (value[SURF_EXPLORE_PROBE_FIELD] === probeId) {
    return value;
  }
  for (const item of Object.values(value)) {
    const nested = findProbeRecord(item, probeId);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

/**
 * Did our own probe answer from a page this run did not gate? A read-only step cannot prevent
 * the navigation it observes, but it can refuse to spend a second attempt on a page that is no
 * longer the one under test.
 */
function assertProbeStayedOnTarget(
  value: unknown,
  acceptedUrls: Set<string>,
  probeId: string,
): void {
  const record = findProbeRecord(value, probeId);
  if (!record) {
    return;
  }
  for (const key of PROBE_URL_KEYS) {
    const candidate = record[key];
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = normalizeUrl(candidate);
    if (normalized !== undefined && !acceptedUrls.has(normalized)) {
      throw new ProbeTargetMoved(normalized, acceptedUrls);
    }
  }
}

function assertProbeEvidence(
  value: unknown,
  stdout: string,
  commandDisplay: readonly string[],
  acceptedUrls: Set<string>,
  probeId: string,
): SurfExploreEvidenceMatch {
  if (stdout.trim().length === 0) {
    throw new Error(
      `Surf explore produced no runtime evidence from '${commandDisplay.join(" ")}'. Refusing to mark user-flow coverage as verified from an empty successful process.`,
    );
  }

  const evidence = findEvidence(value, acceptedUrls, probeId);
  if (evidence) {
    return evidence;
  }

  assertProbeStayedOnTarget(value, acceptedUrls, probeId);

  throw new Error(
    `Surf explore produced no verified browser evidence from '${commandDisplay.join(" ")}'. Non-empty surf output is not enough to mark user-flow coverage; expected probe browser state containing ${[...acceptedUrls].join(" or ")}.`,
  );
}

function normalizeDiscoveredLink(link: unknown, origin: string): string | undefined {
  const href = isRecord(link) ? link.href : link;
  if (typeof href !== "string") {
    return undefined;
  }

  try {
    const parsed = new URL(href);
    if (parsed.origin !== origin) {
      return undefined;
    }
    parsed.hash = "";
    return parsed.href;
  } catch {
    return undefined;
  }
}

function extractLinks(rows: unknown[], pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin;
  const uniqueLinks = new Set<string>();
  for (const row of rows) {
    const normalized = normalizeDiscoveredLink(row, origin);
    if (normalized) {
      uniqueLinks.add(normalized);
    }
  }
  return [...uniqueLinks].slice(0, MAX_SURF_EXPLORE_LINKS_PER_PAGE);
}

function acceptedProbeUrls(url: string, readiness: SessionReadiness): Set<string> {
  const accepted = new Set<string>();
  const target = normalizeUrl(url);
  if (target) {
    accepted.add(target);
  }
  const landed = readiness.href ? normalizeUrl(readiness.href) : undefined;
  if (landed) {
    accepted.add(landed);
  }
  return accepted;
}

function failedProbe(
  kind: SurfExploreProbeKind,
  url: string,
  depth: number,
  error: unknown,
): ProbeExecution {
  const message = errorMessage(error);
  const code = errorCode(error);
  const outcome = outcomeFromError(error);
  return {
    probe: {
      kind,
      url,
      depth,
      verified: false,
      error: message,
      ...(code ? { code } : {}),
      ...(outcome ? { outcome } : {}),
    },
    stdout: "",
    stderr: message,
    discoveredUrls: [],
  };
}

/** The revocation seam: a probe that left the gated page forfeits its remaining budget. */
function revokeOnMove(attempt: EffectAttempt<ProbeExecution>): string | undefined {
  return attempt.error instanceof ProbeTargetMoved ? attempt.error.message : undefined;
}

function jsProbeStep(
  kind: "state" | "dom",
  url: string,
  depth: number,
  acceptedUrls: Set<string>,
): BrowserStep<ProbeExecution> {
  const probeId = randomUUID();
  return {
    id: `surf.explore.probe:${kind}`,
    command: "js",
    // `--no-screenshot`: the surf build otherwise saves a picture of the page - its content
    // included - to /tmp after every `js` call (submit-gate packet §8; measured live 2026-09-08).
    args: [buildProbeExpression(kind, probeId), "--no-screenshot"],
    intent: `read the ${kind} of ${url} without changing it`,
    declare: SURF_EXPLORE_PROBE_EFFECT,
    observe: revokeOnMove,
    read: (reply: SessionReply): ProbeExecution => {
      const { data } = parseSurfJsonOutput(reply.stdout, "js");
      const match = assertProbeEvidence(data, reply.stdout, reply.display, acceptedUrls, probeId);
      const domCounts = kind === "dom" ? domProbeCounts(match.record) : undefined;
      return {
        probe: { kind, url, depth, verified: true, signal: match.signal, outcome: reply.outcome },
        stdout: reply.stdout,
        stderr: reply.stderr,
        discoveredUrls: [],
        ...(domCounts ? { domCounts } : {}),
      };
    },
  };
}

/**
 * The three counts the a11y channel compares the tree against. All three or none: a partial
 * count would make the blind spot look smaller than it is, and the honest answer to a probe that
 * did not report them is `dom_probe_missing` (a11y-snapshot packet, refinement Clash 1).
 */
function domProbeCounts(record: Record<string, unknown>): A11yDomProbeCounts | undefined {
  const { anchors, buttons, inputs } = record;
  if (typeof anchors !== "number" || typeof buttons !== "number" || typeof inputs !== "number") {
    return undefined;
  }
  return { anchors, buttons, inputs };
}

function linksProbeStep(
  url: string,
  depth: number,
  acceptedUrls: Set<string>,
): BrowserStep<ProbeExecution> {
  const probeId = randomUUID();
  return {
    id: "surf.explore.probe:links",
    command: "extract",
    args: [
      "--code",
      buildProbeExpression("links", probeId),
      "--allow-empty",
      "--retry",
      SURF_EXPLORE_UPSTREAM_RETRY,
      "--ready-timeout",
      String(SURF_SESSION_READY_TIMEOUT_MS),
    ],
    intent: `read the same-origin links of ${url} without changing it`,
    expect: SURF_EXPLORE_LINKS_EMPTINESS,
    maxAttempts: SURF_EXPLORE_LINKS_ATTEMPTS,
    observe: revokeOnMove,
    read: (reply: SessionReply, attempt: number): ProbeExecution => {
      const { data } = parseSurfJsonOutput(reply.stdout, "extract");
      if (!isRecord(data)) {
        throw new Error(
          `Surf explore expected 'surf extract --json' to return an object with data/rows for ${url}.`,
        );
      }

      const match = assertProbeEvidence(
        data.data,
        reply.stdout,
        reply.display,
        acceptedUrls,
        probeId,
      );
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const rowCount = typeof data.rowCount === "number" ? data.rowCount : rows.length;
      // `--retry 1` asks surf for one attempt, so the budget is the ledger's. An upstream
      // attempt this run did not decide on is not an attempt it may report as its own.
      const upstreamAttempts = typeof data.attempts === "number" ? data.attempts : 1;
      if (upstreamAttempts !== 1) {
        throw new Error(
          `Surf explore asked 'surf extract' for one attempt (--retry ${SURF_EXPLORE_UPSTREAM_RETRY}) and it reported ${upstreamAttempts}; the read-only budget belongs to the ledger, so this probe is not verified.`,
        );
      }

      return {
        probe: {
          kind: "links",
          url,
          depth,
          verified: true,
          signal: `${match.signal}; extract verified ${rowCount} same-origin link row(s) (zero rows accepted explicitly)`,
          outcome: reply.outcome,
        },
        stdout: reply.stdout,
        stderr: reply.stderr,
        discoveredUrls: extractLinks(rows, url),
        links: { rowCount, attempts: attempt },
      };
    },
  };
}

async function runProbe(
  session: SurfSession,
  kind: SurfExploreProbeKind,
  url: string,
  depth: number,
  acceptedUrls: Set<string>,
): Promise<ProbeExecution> {
  try {
    return await session.step<ProbeExecution>(
      kind === "links"
        ? linksProbeStep(url, depth, acceptedUrls)
        : jsProbeStep(kind, url, depth, acceptedUrls),
    );
  } catch (error) {
    return failedProbe(kind, url, depth, error);
  }
}

// ============================================
// PAGE EXPLORATION
// ============================================

function probeKindsFor(depth: number, requestedDepth: number): SurfExploreProbeKind[] {
  return depth < requestedDepth ? ["state", "dom", "links"] : ["state", "dom"];
}

function failedPage(
  url: string,
  depth: number,
  requestedDepth: number,
  error: unknown,
  readiness?: SessionReadiness,
  tabId?: number,
): SurfExplorePageResult {
  const message = errorMessage(error);
  const frameRootCause = error instanceof ElementUnreachable ? error.frameRootCause : undefined;
  // A diagnosed element-reach failure names itself: the surf code stays in the message and the
  // details, and the probe carries the framework's own trigger code plus the determination.
  const code = frameRootCause ? "element_unreachable" : (readiness?.code ?? errorCode(error));
  const outcome = outcomeFromError(error);
  return {
    url,
    depth,
    ...(tabId !== undefined ? { tabId } : {}),
    verified: false,
    ...(readiness ? { readiness } : {}),
    probes: probeKindsFor(depth, requestedDepth).map((kind) => ({
      kind,
      url,
      depth,
      verified: false,
      error: message,
      ...(code ? { code } : {}),
      ...(outcome ? { outcome } : {}),
      ...(frameRootCause ? { frameRootCause } : {}),
    })),
    discoveredUrls: [],
  };
}

/**
 * One page, one session: open a tab this run owns, gate it once, run the probe step list, let
 * the registered observers read what the probes left, and close the tab in `finally` whatever
 * happened.
 *
 * The tab is opened outside the try on purpose: a run that never got a tab has nothing to close
 * and nothing to say about the page, and that refusal belongs to the caller.
 */
async function explorePage(
  runtime: SurfSessionRuntime,
  context: RunContext,
  input: NormalizedSurfExploreOperationInput,
  url: string,
  depth: number,
  requestedDepth: number,
  pageIndex: number,
  a11yMode: "optional" | "required" | undefined,
): Promise<{ page: SurfExplorePageResult; stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const session = new SurfSession({
    context,
    url,
    runtime,
    idPrefix: `surf.explore.page${pageIndex}`,
  });

  const opened = await session.open();
  const tabId = opened.tab.id;
  if (opened.reply.stdout) {
    stdout.push(opened.reply.stdout);
  }

  let domCounts: A11yDomProbeCounts | undefined;
  // Registered before the probes and run after them: the observer reads the page the probe list
  // left, and it reads the `dom` probe's counts through a getter because those do not exist yet
  // at registration time (a11y-snapshot packet, "Coexistence with surf on the same tab").
  const a11y = a11yMode
    ? createA11ySnapshotObserver({
        context,
        required: a11yMode === "required",
        sequence: pageIndex,
        domCounts: () => domCounts,
      })
    : undefined;
  if (a11y) {
    session.observe(A11Y_SNAPSHOT_OBSERVER_NAME, a11y.observer);
  }

  let page: SurfExplorePageResult;
  try {
    const gate = await session.gate(
      input.readySelector === undefined ? {} : { selector: input.readySelector },
    );
    if (gate.reply.stdout) {
      stdout.push(gate.reply.stdout);
    }
    const acceptedUrls = acceptedProbeUrls(url, gate.readiness);
    const probes: SurfExploreProbeResult[] = [];
    let discoveredUrls: string[] = [];
    let links: SurfExplorePageResult["links"];

    for (const kind of probeKindsFor(depth, requestedDepth)) {
      const execution = await runProbe(session, kind, url, depth, acceptedUrls);
      probes.push(execution.probe);
      if (execution.stdout) {
        stdout.push(execution.stdout);
      }
      if (execution.stderr) {
        stderr.push(execution.stderr);
      }
      if (execution.domCounts) {
        domCounts = execution.domCounts;
      }
      if (kind === "links") {
        discoveredUrls = execution.discoveredUrls;
        links = execution.links;
      }
    }

    await session.runObservers();

    page = {
      url,
      depth,
      tabId,
      verified: probes.every((probe) => probe.verified),
      readiness: gate.readiness,
      probes,
      ...observationsOf(a11y),
      discoveredUrls,
      ...(links ? { links } : {}),
    };
  } catch (error) {
    const readiness = error instanceof SessionReadinessRefusal ? error.readiness : undefined;
    stderr.push(errorMessage(error));
    const unreachable = await diagnoseUnreachable(session, input, error, readiness);
    page = {
      ...failedPage(url, depth, requestedDepth, unreachable ?? error, readiness, tabId),
      ...observationsOf(a11y),
    };
  } finally {
    await session.close();
    stderr.push(...session.notes());
  }

  return { page, stdout, stderr };
}

// ============================================
// COVERAGE
// ============================================

function summarizeCoverage(
  requestedDepth: number,
  pages: SurfExplorePageResult[],
  pagesDiscovered: number,
): SurfExploreOperationResultEnvelope["result"]["coverage"] {
  const probes = pages.flatMap((page) => page.probes);
  const probesRequired = probes.length;
  const probesVerified = probes.filter((probe) => probe.verified).length;
  const userFlows = probesRequired === 0 ? 0 : Math.round((probesVerified / probesRequired) * 100);
  const reachedDepth = pages
    .filter((page) => page.verified)
    .reduce((maximum, page) => Math.max(maximum, page.depth), 0);

  return {
    userFlows,
    status: userFlows === 100 ? "verified" : "partial",
    requestedDepth,
    reachedDepth,
    pagesDiscovered,
    pagesVisited: pages.length,
    pagesVerified: pages.filter((page) => page.verified).length,
    probesRequired,
    probesVerified,
  };
}

function buildAggregateEvidence(
  normalizedTargetUrl: string,
  coverage: SurfExploreOperationResultEnvelope["result"]["coverage"],
): SurfExploreEvidence {
  return {
    verified: true,
    url: normalizedTargetUrl,
    signal: `${coverage.probesVerified}/${coverage.probesRequired} explicit Surf flow probes verified across ${coverage.pagesVisited} page(s)`,
    coverageScore: coverage.userFlows,
    probesVerified: coverage.probesVerified,
    probesRequired: coverage.probesRequired,
  };
}

async function runSurfExploreOperation(
  normalized: NormalizedSurfExploreOperationInput,
  context: RunContext,
): Promise<SurfExploreOperationResultEnvelope> {
  const requestedDepth = parseSurfExploreDepth(normalized.depth);
  const normalizedTargetUrl = normalizeUrl(normalized.url);
  if (!normalizedTargetUrl) {
    throw new Error("Surf explore target must be a valid URL.");
  }

  const runtime = resolveSurfSessionRuntime();
  const a11yMode = parseA11ySnapshotMode(normalized.a11ySnapshot);
  const queue: Array<{ url: string; depth: number }> = [{ url: normalizedTargetUrl, depth: 1 }];
  const scheduled = new Set<string>([
    normalizeVisitKey(normalizedTargetUrl) ?? normalizedTargetUrl,
  ]);
  const pages: SurfExplorePageResult[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  while (queue.length > 0 && pages.length < MAX_SURF_EXPLORE_PAGES) {
    const next = queue.shift();
    if (!next) {
      break;
    }

    try {
      const pageResult = await explorePage(
        runtime,
        context,
        normalized,
        next.url,
        next.depth,
        requestedDepth,
        pages.length + 1,
        a11yMode,
      );
      pages.push(pageResult.page);
      stdout.push(...pageResult.stdout);
      stderr.push(...pageResult.stderr);

      if (next.depth < requestedDepth) {
        for (const discoveredUrl of pageResult.page.discoveredUrls) {
          if (pages.length + queue.length >= MAX_SURF_EXPLORE_PAGES) {
            break;
          }
          const visitKey = normalizeVisitKey(discoveredUrl);
          if (!visitKey || scheduled.has(visitKey)) {
            continue;
          }
          scheduled.add(visitKey);
          queue.push({ url: discoveredUrl, depth: next.depth + 1 });
        }
      }
    } catch (error) {
      if (pages.length === 0) {
        throw error;
      }
      pages.push(failedPage(next.url, next.depth, requestedDepth, error));
      stderr.push(errorMessage(error));
    }
  }

  const seedStateProbe = pages[0]?.probes.find((probe) => probe.kind === "state");
  if (!seedStateProbe?.verified) {
    throw new SurfExploreProbeRefusal(normalizedTargetUrl, seedStateProbe);
  }

  const coverage = summarizeCoverage(requestedDepth, pages, scheduled.size);
  const evidence = buildAggregateEvidence(normalizedTargetUrl, coverage);
  const seedArgs = translateSurfArgs("tab.new", [normalizedTargetUrl]);

  return finalizeEnvelope(
    {
      operationId: "surf.explore" as const,
      input: normalized,
      result: {
        command: runtime.resolution.command,
        args: [...runtime.resolution.baseArgs, ...seedArgs],
        runtime: {
          flavor: runtime.resolution.flavor,
          provider: runtime.resolution.provider,
          resolutionNotes: runtime.resolution.resolutionNotes,
          version: runtime.probe.version,
          mechanisms: runtime.probe.mechanisms,
          ...a11yChannelSummary(
            a11yMode,
            pages.flatMap((page) => page.observations ?? []),
          ),
        },
        stdout: stdout.filter(Boolean).join("\n"),
        stderr: stderr.map(stripSurfContextLines).filter(Boolean).join("\n"),
        code: 0,
        evidence,
        coverage,
        pages,
      },
    },
    context,
    SURF_EXPLORE_OPERATION_EFFECT,
  );
}

export const SURF_EXPLORE_OPERATION = {
  id: "surf.explore",
  effect: SURF_EXPLORE_OPERATION_EFFECT,
  route: { command: "surf", action: "explore" },
  description: "Run the resolved surf CLI runtime through the supported explore action",
  inputSchema: SurfExploreOperationInputSchema,
  execute: runSurfExploreOperation,
} satisfies OperationDefinition<
  NormalizedSurfExploreOperationInput,
  SurfExploreOperationResultEnvelope
>;

export async function executeSurfExploreOperation(
  input: SurfExploreOperationInput,
  context?: RunContext,
): Promise<SurfExploreOperationResultEnvelope> {
  const normalized = SurfExploreOperationInputSchema.parse(input);
  return runSurfExploreOperation(
    normalized,
    context ?? mintOperationContext("surf.explore", SURF_EXPLORE_OPERATION_EFFECT, normalized),
  );
}
