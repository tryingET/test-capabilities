import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ExpectDeclaration, ResultOutcome } from "../result-classification.js";
import { FrameworkError, isFrameworkError } from "../runtime-contract.js";
import { probeSurfRuntime, runSurfCommand } from "../surf-adapter.js";
import {
  assertSurfExploreMechanisms,
  isSurfReadinessErrorCode,
  parseCreatedTabId,
  parseSurfJsonOutput,
  resolveSurfRuntimeResolution,
  SurfCommandError,
  type SurfCommandResult,
  type SurfRuntimeProbe,
  type SurfRuntimeResolution,
  translateSurfArgs,
} from "../surf-runtime.js";
import { assertSupportedSurfExploreOptions } from "./support.js";
import type {
  OperationDefinition,
  SurfExploreOperationInput,
  SurfExploreOperationResultEnvelope,
  SurfExplorePageReadiness,
  SurfExplorePageResult,
  SurfExploreProbeResult,
  SurfExploreReadinessState,
} from "./types.js";

const DEFAULT_SURF_EXPLORE_DEPTH = 1;
const MAX_SURF_EXPLORE_DEPTH = 3;
const MAX_SURF_EXPLORE_PAGES = 10;
const MAX_SURF_EXPLORE_LINKS_PER_PAGE = 5;
const SURF_EXPLORE_READY_TIMEOUT_MS = 20_000;
const SURF_EXPLORE_COMMAND_TIMEOUT_MS = 90_000;

export const SurfExploreOperationInputSchema = z
  .object({
    url: z
      .string({
        required_error: "Surf explore requires --url with a valid URL.",
      })
      .url("Surf explore target must be a valid URL."),
    depth: z.string().optional(),
    json: z.boolean().optional().default(false),
    record: z.boolean().optional().default(false),
    validate: z.boolean().optional().default(false),
    baseline: z.string().optional(),
    aiDiff: z.boolean().optional().default(false),
    file: z.string().optional(),
  })
  .transform((input) => {
    assertSupportedSurfExploreOptions(input);
    parseSurfExploreDepth(input.depth);
    return input;
  });

type NormalizedSurfExploreOperationInput = z.output<typeof SurfExploreOperationInputSchema>;

type SurfExploreProbeKind = SurfExploreProbeResult["kind"];

type SurfExploreEvidence = SurfExploreOperationResultEnvelope["result"]["evidence"];

type SurfExploreRuntime = {
  resolution: SurfRuntimeResolution;
  probe: SurfRuntimeProbe;
};

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
};

/**
 * The classified outcome behind a refusal, when the refusal came from a surf command. A
 * framework-side refusal (a probe whose payload carries no browser evidence, an owned tab that
 * reported no id) has none, and the consumer must not invent one.
 */
export function outcomeFromError(error: unknown): ResultOutcome | undefined {
  if (
    error instanceof SurfCommandError ||
    error instanceof SurfExploreReadinessRefusal ||
    error instanceof SurfExploreProbeRefusal
  ) {
    return error.outcome;
  }
  return undefined;
}

const SURF_EXPLORE_PROBE_FIELD = "__testCapabilitiesSurfExploreProbe";

/**
 * Only `ready` settles a page for probing.
 *
 * surf reports `empty` when a page rendered its own "no results" state, which it can only know
 * from an `--empty-text` marker the caller passed. This operation passes none, so an `empty`
 * here is surf saying "nothing was found" with nothing to check it against: an undeclared
 * emptiness, refused rather than probed (result-classification packet, refinement; plan S4).
 */
const SETTLED_READINESS_STATES: readonly SurfExploreReadinessState[] = ["ready"];

/**
 * A page that never reached a settled state. It carries surf's own readiness code
 * (`page_login`, `page_challenge`, ...) so the CLI envelope and the surf agent can tell a page
 * that refused the framework from a runtime that never ran (adjudication claim 45), and the
 * classified outcome when one exists.
 */
export class SurfExploreReadinessRefusal extends FrameworkError {
  readonly readiness: SurfExplorePageReadiness;
  readonly outcome: ResultOutcome | undefined;

  constructor(url: string, readiness: SurfExplorePageReadiness, outcome?: ResultOutcome) {
    const evidence =
      readiness.evidence.length > 0 ? ` Evidence: ${readiness.evidence.join("; ")}` : "";
    super(
      readiness.code ?? "page_not_ready",
      `Surf explore refused ${url}: page readiness is '${readiness.state}' [${readiness.code ?? "page_not_ready"}]: ${readiness.message ?? "the page did not reach a settled state"}.${evidence}`,
      { url, state: readiness.state, ...(readiness.href ? { href: readiness.href } : {}) },
    );
    this.name = "SurfExploreReadinessRefusal";
    this.readiness = readiness;
    this.outcome = outcome;
  }
}

/**
 * The seed page produced no verified state probe. The refusal carries the probe's own code and
 * classified outcome, so a page that refused the framework (`page_login`), a surf command that
 * failed (`exit_9`) and a probe that answered with nothing (`empty_result`) reach the caller as
 * three different refusals instead of one prose message (adjudication claim 45).
 */
export class SurfExploreProbeRefusal extends FrameworkError {
  readonly outcome: ResultOutcome | undefined;

  constructor(url: string, probe: SurfExploreProbeResult | undefined) {
    super(
      probe?.code ?? "probe_unverified",
      probe?.error ??
        `Surf explore produced no verified browser evidence from the seed page state probe for ${url}.`,
      { url, ...(probe ? { probe: probe.kind } : {}) },
    );
    this.name = "SurfExploreProbeRefusal";
    this.outcome = probe?.outcome;
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

function errorCode(error: unknown): string | undefined {
  return isFrameworkError(error) ? error.code : undefined;
}

// ============================================
// RUNTIME
// ============================================

function resolveExploreRuntime(): SurfExploreRuntime {
  const resolution = resolveSurfRuntimeResolution();
  const probe = probeSurfRuntime(resolution);
  assertSurfExploreMechanisms(resolution, probe);
  return { resolution, probe };
}

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

function runMapped(
  runtime: SurfExploreRuntime,
  command: string,
  args: string[],
  expect?: ExpectDeclaration,
): SurfCommandResult {
  return runSurfCommand(runtime.resolution, translateSurfArgs(command, args), {
    timeoutMs: SURF_EXPLORE_COMMAND_TIMEOUT_MS,
    ...(expect ? { expect } : {}),
  });
}

function runMappedOrThrow(
  runtime: SurfExploreRuntime,
  command: string,
  args: string[],
  expect?: ExpectDeclaration,
): SurfCommandResult {
  const result = runMapped(runtime, command, args, expect);
  if (!result.ok) {
    throw new SurfCommandError(result);
  }
  return result;
}

function openOwnedTab(
  runtime: SurfExploreRuntime,
  url: string,
): { tabId: number; result: SurfCommandResult } {
  const result = runMappedOrThrow(runtime, "tab.new", [url]);
  const tabId = parseCreatedTabId(result.stdout);
  if (tabId === undefined) {
    const preview = result.stdout.trim().slice(0, 200);
    throw new Error(
      `Surf explore could not open an owned tab for ${url}: 'surf tab.new' did not report a tab id (output: ${preview || "(empty)"}).`,
    );
  }
  return { tabId, result };
}

function closeOwnedTab(runtime: SurfExploreRuntime, tabId: number): string | undefined {
  const result = runMapped(runtime, "tab.close", [String(tabId)]);
  if (result.ok) {
    return undefined;
  }
  return `Surf explore could not close owned tab ${tabId}: ${result.failure?.message ?? "unknown failure"} [${result.failure?.code ?? "error"}]`;
}

// ============================================
// READINESS GATE
// ============================================

function readinessStateFromCode(code: string, details: unknown): SurfExploreReadinessState {
  if (isRecord(details) && typeof details.state === "string") {
    const state = details.state as SurfExploreReadinessState;
    if (["ready", "empty", "loading", "login", "challenge", "not-found", "error"].includes(state)) {
      return state;
    }
  }
  switch (code) {
    case "page_login":
      return "login";
    case "page_challenge":
      return "challenge";
    case "page_not_found":
      return "not-found";
    case "page_error":
      return "error";
    case "page_timeout":
      return "loading";
    default:
      return "unknown";
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readinessFromResult(data: unknown): SurfExplorePageReadiness | undefined {
  if (!isRecord(data) || typeof data.state !== "string") {
    return undefined;
  }
  return {
    state: data.state as SurfExploreReadinessState,
    href: optionalString(data.href),
    title: optionalString(data.title),
    readyState: optionalString(data.readyState),
    polls: optionalNumber(data.polls),
    waited: optionalNumber(data.waited),
    evidence: stringList(data.evidence),
  };
}

function gateReadiness(
  runtime: SurfExploreRuntime,
  tabId: number,
  url: string,
): { readiness: SurfExplorePageReadiness; result: SurfCommandResult } {
  const result = runMapped(runtime, "wait.ready", [
    "--tab-id",
    String(tabId),
    "--timeout",
    String(SURF_EXPLORE_READY_TIMEOUT_MS),
  ]);

  if (!result.ok) {
    const failure = result.failure ?? { code: "error", message: "wait.ready failed" };
    if (isSurfReadinessErrorCode(failure.code)) {
      const details = failure.details;
      throw new SurfExploreReadinessRefusal(
        url,
        {
          state: readinessStateFromCode(failure.code, details),
          code: failure.code,
          message: failure.message,
          href: isRecord(details) ? optionalString(details.href) : undefined,
          title: isRecord(details) ? optionalString(details.title) : undefined,
          evidence: isRecord(details) ? stringList(details.evidence) : [],
        },
        result.outcome,
      );
    }
    throw new SurfCommandError(result);
  }

  const readiness = readinessFromResult(parseSurfJsonOutput(result.stdout, "wait.ready").data);
  if (!readiness) {
    throw new Error(
      `Surf explore could not read a typed readiness state from 'surf wait.ready --json' for ${url}; refusing to probe an unclassified page.`,
    );
  }
  if (!SETTLED_READINESS_STATES.includes(readiness.state)) {
    throw new SurfExploreReadinessRefusal(
      url,
      {
        ...readiness,
        code: "page_not_ready",
        message:
          readiness.state === "empty"
            ? "wait.ready returned state 'empty' and this operation declared no empty marker, so the emptiness is undeclared and the page is not probed"
            : `wait.ready returned state '${readiness.state}' instead of a settled page`,
      },
      result.outcome,
    );
  }

  return { readiness, result };
}

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

  const urlKeys = ["href", "url", "currentUrl", "current_url", "location"];
  const matchedUrlKey = urlKeys.find((key) => hasAnyUrl(value[key], acceptedUrls));
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

function assertProbeEvidence(
  value: unknown,
  stdout: string,
  commandDisplay: string[],
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

function acceptedProbeUrls(url: string, readiness: SurfExplorePageReadiness): Set<string> {
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

function runJsProbe(
  runtime: SurfExploreRuntime,
  kind: "state" | "dom",
  tabId: number,
  url: string,
  depth: number,
  acceptedUrls: Set<string>,
): ProbeExecution {
  const probeId = randomUUID();
  const result = runMappedOrThrow(runtime, "js", [
    buildProbeExpression(kind, probeId),
    "--tab-id",
    String(tabId),
  ]);
  const { data } = parseSurfJsonOutput(result.stdout, "js");
  const match = assertProbeEvidence(
    data,
    result.stdout,
    result.commandDisplay,
    acceptedUrls,
    probeId,
  );
  return {
    probe: { kind, url, depth, verified: true, signal: match.signal, outcome: result.outcome },
    stdout: result.stdout,
    stderr: result.stderr,
    discoveredUrls: [],
  };
}

function runLinksProbe(
  runtime: SurfExploreRuntime,
  tabId: number,
  url: string,
  depth: number,
  acceptedUrls: Set<string>,
): ProbeExecution {
  const probeId = randomUUID();
  const result = runMappedOrThrow(
    runtime,
    "extract",
    [
      "--tab-id",
      String(tabId),
      "--code",
      buildProbeExpression("links", probeId),
      "--allow-empty",
      "--ready-timeout",
      String(SURF_EXPLORE_READY_TIMEOUT_MS),
    ],
    SURF_EXPLORE_LINKS_EMPTINESS,
  );
  const { data } = parseSurfJsonOutput(result.stdout, "extract");
  if (!isRecord(data)) {
    throw new Error(
      `Surf explore expected 'surf extract --json' to return an object with data/rows for ${url}.`,
    );
  }

  const match = assertProbeEvidence(
    data.data,
    result.stdout,
    result.commandDisplay,
    acceptedUrls,
    probeId,
  );
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const rowCount = typeof data.rowCount === "number" ? data.rowCount : rows.length;
  const attempts = typeof data.attempts === "number" ? data.attempts : 1;
  const discoveredUrls = extractLinks(rows, url);

  return {
    probe: {
      kind: "links",
      url,
      depth,
      verified: true,
      signal: `${match.signal}; extract verified ${rowCount} same-origin link row(s) (zero rows accepted explicitly)`,
      outcome: result.outcome,
    },
    stdout: result.stdout,
    stderr: result.stderr,
    discoveredUrls,
    links: { rowCount, attempts },
  };
}

function runProbe(
  runtime: SurfExploreRuntime,
  kind: SurfExploreProbeKind,
  tabId: number,
  url: string,
  depth: number,
  acceptedUrls: Set<string>,
): ProbeExecution {
  try {
    return kind === "links"
      ? runLinksProbe(runtime, tabId, url, depth, acceptedUrls)
      : runJsProbe(runtime, kind, tabId, url, depth, acceptedUrls);
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
  readiness?: SurfExplorePageReadiness,
  tabId?: number,
): SurfExplorePageResult {
  const message = errorMessage(error);
  const code = readiness?.code ?? errorCode(error);
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
    })),
    discoveredUrls: [],
  };
}

function explorePage(
  runtime: SurfExploreRuntime,
  url: string,
  depth: number,
  requestedDepth: number,
): { page: SurfExplorePageResult; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const opened = openOwnedTab(runtime, url);
  const tabId = opened.tabId;
  if (opened.result.stdout) {
    stdout.push(opened.result.stdout);
  }

  let page: SurfExplorePageResult;
  try {
    const gate = gateReadiness(runtime, tabId, url);
    if (gate.result.stdout) {
      stdout.push(gate.result.stdout);
    }
    const acceptedUrls = acceptedProbeUrls(url, gate.readiness);
    const probes: SurfExploreProbeResult[] = [];
    let discoveredUrls: string[] = [];
    let links: SurfExplorePageResult["links"];

    for (const kind of probeKindsFor(depth, requestedDepth)) {
      const execution = runProbe(runtime, kind, tabId, url, depth, acceptedUrls);
      probes.push(execution.probe);
      if (execution.stdout) {
        stdout.push(execution.stdout);
      }
      if (execution.stderr) {
        stderr.push(execution.stderr);
      }
      if (kind === "links") {
        discoveredUrls = execution.discoveredUrls;
        links = execution.links;
      }
    }

    page = {
      url,
      depth,
      tabId,
      verified: probes.every((probe) => probe.verified),
      readiness: gate.readiness,
      probes,
      discoveredUrls,
      ...(links ? { links } : {}),
    };
  } catch (error) {
    const readiness = error instanceof SurfExploreReadinessRefusal ? error.readiness : undefined;
    stderr.push(errorMessage(error));
    page = failedPage(url, depth, requestedDepth, error, readiness, tabId);
  } finally {
    const closeNote = closeOwnedTab(runtime, tabId);
    if (closeNote) {
      stderr.push(closeNote);
    }
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
): Promise<SurfExploreOperationResultEnvelope> {
  const requestedDepth = parseSurfExploreDepth(normalized.depth);
  const normalizedTargetUrl = normalizeUrl(normalized.url);
  if (!normalizedTargetUrl) {
    throw new Error("Surf explore target must be a valid URL.");
  }

  const runtime = resolveExploreRuntime();
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
      const pageResult = explorePage(runtime, next.url, next.depth, requestedDepth);
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

  return {
    operationId: "surf.explore",
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
      },
      stdout: stdout.filter(Boolean).join("\n"),
      stderr: stderr.map(stripSurfContextLines).filter(Boolean).join("\n"),
      code: 0,
      evidence,
      coverage,
      pages,
    },
  };
}

export const SURF_EXPLORE_OPERATION = {
  id: "surf.explore",
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
): Promise<SurfExploreOperationResultEnvelope> {
  return runSurfExploreOperation(SurfExploreOperationInputSchema.parse(input));
}
