import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import { z } from "zod";
import { resolveSurfRuntimeCommand } from "../surf-runtime.js";
import { runCommand } from "./command-runner.js";
import { assertSupportedSurfExploreOptions } from "./support.js";
import type {
  OperationDefinition,
  SurfExploreOperationInput,
  SurfExploreOperationResultEnvelope,
} from "./types.js";

const DEFAULT_SURF_EXPLORE_DEPTH = 1;
const MAX_SURF_EXPLORE_DEPTH = 3;
const MAX_SURF_EXPLORE_PAGES = 10;
const MAX_SURF_EXPLORE_LINKS_PER_PAGE = 5;

export const SurfExploreOperationInputSchema = z
  .object({
    url: z
      .string({
        required_error: "Surf explore requires --url with a valid URL.",
      })
      .url("Surf explore target must be a valid URL."),
    depth: z.string().optional(),
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

type SurfExploreProbeKind = "state" | "dom" | "links";

type SurfExploreEvidence = {
  verified: true;
  url: string;
  signal: string;
  coverageScore: number;
  probesVerified: number;
  probesRequired: number;
};

type SurfExploreEvidenceMatch = {
  evidence: Omit<SurfExploreEvidence, "coverageScore" | "probesVerified" | "probesRequired">;
  record?: Record<string, unknown>;
};

type SurfExploreProbeResult = {
  kind: SurfExploreProbeKind;
  url: string;
  depth: number;
  verified: boolean;
  signal?: string;
  error?: string;
};

type SurfExplorePageResult = {
  url: string;
  depth: number;
  verified: boolean;
  probes: SurfExploreProbeResult[];
  discoveredUrls: string[];
};

type ProbeExecutionResult = {
  probe: SurfExploreProbeResult;
  stdout: string;
  stderr: string;
  discoveredUrls: string[];
};

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

function hasTargetUrl(value: unknown, normalizedTargetUrl: string): boolean {
  return typeof value === "string" && normalizeUrl(value) === normalizedTargetUrl;
}

const SURF_EXPLORE_PROBE_FIELD = "__testCapabilitiesSurfExploreProbe";

function objectContainsVerifiedBrowserEvidence(
  value: unknown,
  normalizedTargetUrl: string,
  probeId: string,
): SurfExploreEvidenceMatch | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record[SURF_EXPLORE_PROBE_FIELD] !== probeId) {
    return undefined;
  }

  const urlKeys = ["url", "href", "currentUrl", "current_url", "location"];
  const matchedUrlKey = urlKeys.find((key) => hasTargetUrl(record[key], normalizedTargetUrl));
  if (!matchedUrlKey) {
    return undefined;
  }

  const browserStateSignals = [
    matchedUrlKey === "currentUrl" ||
      matchedUrlKey === "current_url" ||
      matchedUrlKey === "location",
    typeof record.tabId === "number" || typeof record.tab_id === "number",
    typeof record.windowId === "number" || typeof record.window_id === "number",
    typeof record.title === "string" && record.title.trim().length > 0,
    typeof record.readyState === "string" && record.readyState.trim().length > 0,
    Array.isArray(record.links),
    typeof record.anchors === "number" ||
      typeof record.buttons === "number" ||
      typeof record.forms === "number" ||
      typeof record.inputs === "number",
  ];

  if (!browserStateSignals.some(Boolean)) {
    return undefined;
  }

  return {
    evidence: {
      verified: true,
      url: normalizedTargetUrl,
      signal: `structured ${matchedUrlKey} with browser state`,
    },
    record,
  };
}

function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function tryParseYaml(value: string): unknown | undefined {
  try {
    return yaml.load(value);
  } catch {
    return undefined;
  }
}

function findEvidenceInParsedValue(
  value: unknown,
  normalizedTargetUrl: string,
  probeId: string,
): SurfExploreEvidenceMatch | undefined {
  const direct = objectContainsVerifiedBrowserEvidence(value, normalizedTargetUrl, probeId);
  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findEvidenceInParsedValue(item, normalizedTargetUrl, probeId);
      if (nested) {
        return nested;
      }
    }
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const nested = findEvidenceInParsedValue(item, normalizedTargetUrl, probeId);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function yamlDocumentCandidates(output: string): string[] {
  const rawLines = output.split(/\r?\n/);
  const documents: string[] = [];
  let current: string[] = [];

  for (const line of rawLines) {
    if (line.trim() === "---") {
      if (current.some((candidateLine) => candidateLine.trim().length > 0)) {
        documents.push(current.join("\n"));
      }
      current = [];
      continue;
    }
    current.push(line);
  }

  if (current.some((candidateLine) => candidateLine.trim().length > 0)) {
    documents.push(current.join("\n"));
  }

  return documents;
}

function findStructuredEvidence(
  output: string,
  normalizedTargetUrl: string,
  probeId: string,
): SurfExploreEvidenceMatch | undefined {
  const rawLines = output.split(/\r?\n/);
  const suffixes = rawLines.map((_, index) => rawLines.slice(index).join("\n"));
  const lines = rawLines.map((line) => line.trim());
  const candidates = [output, ...yamlDocumentCandidates(output), ...suffixes, ...lines].filter(
    (candidate) => candidate.trim().length > 0,
  );

  for (const candidate of candidates) {
    const jsonEvidence = findEvidenceInParsedValue(
      tryParseJson(candidate),
      normalizedTargetUrl,
      probeId,
    );
    if (jsonEvidence) {
      return jsonEvidence;
    }

    const yamlEvidence = findEvidenceInParsedValue(
      tryParseYaml(candidate),
      normalizedTargetUrl,
      probeId,
    );
    if (yamlEvidence) {
      return yamlEvidence;
    }
  }

  return undefined;
}

function findTabularEvidence(
  output: string,
  normalizedTargetUrl: string,
  probeId: string,
): SurfExploreEvidenceMatch | undefined {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const targetText = normalizedTargetUrl.replace(/\/$/, "");
  const evidenceLine = lines.find((line) => {
    const normalizedLine = line.replace(/\/$/, "");
    return (
      (normalizedLine.includes(normalizedTargetUrl) || normalizedLine.includes(targetText)) &&
      line.includes(probeId) &&
      /\b(tab[_ -]?id|window[_ -]?id|title|current[_ -]?url|href|ready[_ -]?state)\b/i.test(line)
    );
  });

  if (!evidenceLine) {
    return undefined;
  }

  return {
    evidence: {
      verified: true,
      url: normalizedTargetUrl,
      signal: "tabular/browser-state output containing target URL",
    },
  };
}

function assertSurfExploreEvidence(
  result: { stdout: string; stderr: string },
  commandDisplay: string[],
  targetUrl: string,
  probeId: string,
): SurfExploreEvidenceMatch {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const normalizedTargetUrl = normalizeUrl(targetUrl);

  if (!normalizedTargetUrl || output.length === 0) {
    throw new Error(
      `Surf explore produced no runtime evidence from '${commandDisplay.join(" ")}'. Refusing to mark user-flow coverage as verified from an empty successful process.`,
    );
  }

  const evidence =
    findStructuredEvidence(output, normalizedTargetUrl, probeId) ??
    findTabularEvidence(output, normalizedTargetUrl, probeId);
  if (evidence) {
    return evidence;
  }

  throw new Error(
    `Surf explore produced no verified browser evidence from '${commandDisplay.join(" ")}'. Non-empty Surf output is not enough to mark user-flow coverage; expected probe browser state containing ${normalizedTargetUrl}.`,
  );
}

function buildProbeScript(kind: SurfExploreProbeKind, probeId: string): string {
  const probeIdLiteral = JSON.stringify(probeId);

  if (kind === "links") {
    return `const probeId = ${probeIdLiteral}; return (() => { const seen = new Set(); const links = Array.from(document.querySelectorAll('a[href]')).map((anchor) => new URL(anchor.getAttribute('href'), location.href).href).filter((href) => { const url = new URL(href); if (url.origin !== location.origin) return false; url.hash = ''; if (seen.has(url.href)) return false; seen.add(url.href); return true; }).slice(0, ${MAX_SURF_EXPLORE_LINKS_PER_PAGE}); return { ${SURF_EXPLORE_PROBE_FIELD}: probeId, kind: 'links', href: location.href, title: document.title, readyState: document.readyState, links }; })()`;
  }

  if (kind === "dom") {
    return `return { ${SURF_EXPLORE_PROBE_FIELD}: ${probeIdLiteral}, kind: "dom", href: location.href, title: document.title, readyState: document.readyState, anchors: document.querySelectorAll("a[href]").length, buttons: document.querySelectorAll("button,[role=button],input[type=submit]").length, forms: document.querySelectorAll("form").length, inputs: document.querySelectorAll("input,textarea,select").length }`;
  }

  return `return { ${SURF_EXPLORE_PROBE_FIELD}: ${probeIdLiteral}, kind: "state", href: location.href, title: document.title, readyState: document.readyState }`;
}

function normalizeDiscoveredLink(link: unknown, origin: string): string | undefined {
  if (typeof link !== "string") {
    return undefined;
  }

  try {
    const parsed = new URL(link);
    if (parsed.origin !== origin) {
      return undefined;
    }
    parsed.hash = "";
    return parsed.href;
  } catch {
    return undefined;
  }
}

function extractLinksFromEvidence(
  record: Record<string, unknown> | undefined,
  pageUrl: string,
): string[] {
  const links = record?.links;
  if (!Array.isArray(links)) {
    return [];
  }

  const origin = new URL(pageUrl).origin;
  const uniqueLinks = new Set<string>();
  for (const link of links) {
    const normalized = normalizeDiscoveredLink(link, origin);
    if (normalized) {
      uniqueLinks.add(normalized);
    }
  }

  return [...uniqueLinks].slice(0, MAX_SURF_EXPLORE_LINKS_PER_PAGE);
}

async function runSurfProbe(
  kind: SurfExploreProbeKind,
  url: string,
  depth: number,
): Promise<ProbeExecutionResult> {
  const probeId = randomUUID();
  const runtime = resolveSurfRuntimeCommand("js", [buildProbeScript(kind, probeId)]);

  try {
    const result = await runCommand(runtime.command, runtime.args);
    const match = assertSurfExploreEvidence(result, runtime.commandDisplay, url, probeId);
    return {
      probe: {
        kind,
        url,
        depth,
        verified: true,
        signal: match.evidence.signal,
      },
      stdout: result.stdout,
      stderr: result.stderr,
      discoveredUrls: kind === "links" ? extractLinksFromEvidence(match.record, url) : [],
    };
  } catch (error) {
    return {
      probe: {
        kind,
        url,
        depth,
        verified: false,
        error: error instanceof Error ? error.message : String(error),
      },
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      discoveredUrls: [],
    };
  }
}

function failedPageFromNavigationError(
  url: string,
  depth: number,
  requestedDepth: number,
  error: unknown,
): SurfExplorePageResult {
  const message = error instanceof Error ? error.message : String(error);
  const kinds: SurfExploreProbeKind[] =
    depth < requestedDepth ? ["state", "dom", "links"] : ["state", "dom"];
  return {
    url,
    depth,
    verified: false,
    probes: kinds.map((kind) => ({
      kind,
      url,
      depth,
      verified: false,
      error: message,
    })),
    discoveredUrls: [],
  };
}

async function explorePage(
  url: string,
  depth: number,
  requestedDepth: number,
): Promise<{
  page: SurfExplorePageResult;
  stdout: string[];
  stderr: string[];
  seedRuntime: ReturnType<typeof resolveSurfRuntimeCommand>;
}> {
  const runtime = resolveSurfRuntimeCommand("go", [url]);
  const stdout: string[] = [];
  const stderr: string[] = [];

  const navigateResult = await runCommand(runtime.command, runtime.args);
  if (navigateResult.stdout) {
    stdout.push(navigateResult.stdout);
  }
  if (navigateResult.stderr) {
    stderr.push(navigateResult.stderr);
  }

  const probeKinds: SurfExploreProbeKind[] =
    depth < requestedDepth ? ["state", "dom", "links"] : ["state", "dom"];
  const probes: SurfExploreProbeResult[] = [];
  let discoveredUrls: string[] = [];

  for (const kind of probeKinds) {
    const probeResult = await runSurfProbe(kind, url, depth);
    probes.push(probeResult.probe);
    if (probeResult.stdout) {
      stdout.push(probeResult.stdout);
    }
    if (probeResult.stderr) {
      stderr.push(probeResult.stderr);
    }
    if (kind === "links") {
      discoveredUrls = probeResult.discoveredUrls;
    }
  }

  return {
    page: {
      url,
      depth,
      verified: probes.every((probe) => probe.verified),
      probes,
      discoveredUrls,
    },
    stdout,
    stderr,
    seedRuntime: runtime,
  };
}

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

  const queue: Array<{ url: string; depth: number }> = [{ url: normalizedTargetUrl, depth: 1 }];
  const scheduled = new Set<string>([
    normalizeVisitKey(normalizedTargetUrl) ?? normalizedTargetUrl,
  ]);
  const pages: SurfExplorePageResult[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let firstRuntime: ReturnType<typeof resolveSurfRuntimeCommand> | undefined;

  while (queue.length > 0 && pages.length < MAX_SURF_EXPLORE_PAGES) {
    const next = queue.shift();
    if (!next) {
      break;
    }

    try {
      const pageResult = await explorePage(next.url, next.depth, requestedDepth);
      firstRuntime ??= pageResult.seedRuntime;
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
      const failedPage = failedPageFromNavigationError(next.url, next.depth, requestedDepth, error);
      pages.push(failedPage);
      stderr.push(error instanceof Error ? error.message : String(error));
    }
  }

  const seedStateProbe = pages[0]?.probes.find((probe) => probe.kind === "state");
  if (!seedStateProbe?.verified) {
    throw new Error(
      seedStateProbe?.error ??
        "Surf explore produced no verified browser evidence from the seed page state probe.",
    );
  }

  if (!firstRuntime) {
    firstRuntime = resolveSurfRuntimeCommand("go", [normalizedTargetUrl]);
  }

  const coverage = summarizeCoverage(requestedDepth, pages, scheduled.size);
  const evidence = buildAggregateEvidence(normalizedTargetUrl, coverage);
  const result = {
    code: 0,
    stdout: stdout.filter(Boolean).join("\n"),
    stderr: stderr.filter(Boolean).join("\n"),
  };

  return {
    operationId: "surf.explore",
    input: normalized,
    result: {
      command: firstRuntime.command,
      args: firstRuntime.args,
      runtime: {
        flavor: firstRuntime.flavor,
        provider: firstRuntime.provider,
        resolutionNotes: firstRuntime.resolutionNotes,
      },
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      evidence,
      coverage,
      pages,
    },
  };
}

export const SURF_EXPLORE_OPERATION = {
  id: "surf.explore",
  route: { command: "surf", action: "explore" },
  description: "Run the resolved Surf runtime through the supported explore action",
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
