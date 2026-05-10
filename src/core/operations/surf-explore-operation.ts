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
    return input;
  });

type NormalizedSurfExploreOperationInput = z.output<typeof SurfExploreOperationInputSchema>;

type SurfExploreEvidence = {
  verified: true;
  url: string;
  signal: string;
};

function normalizeUrl(value: string): string | undefined {
  try {
    return new URL(value).href;
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
): SurfExploreEvidence | undefined {
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
  ];

  if (!browserStateSignals.some(Boolean)) {
    return undefined;
  }

  return {
    verified: true,
    url: normalizedTargetUrl,
    signal: `structured ${matchedUrlKey} with browser state`,
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
): SurfExploreEvidence | undefined {
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
): SurfExploreEvidence | undefined {
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
): SurfExploreEvidence | undefined {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const targetText = normalizedTargetUrl.replace(/\/$/, "");
  const evidenceLine = lines.find((line) => {
    const normalizedLine = line.replace(/\/$/, "");
    return (
      (normalizedLine.includes(normalizedTargetUrl) || normalizedLine.includes(targetText)) &&
      line.includes(probeId) &&
      /\b(tab[_ -]?id|window[_ -]?id|title|current[_ -]?url|href)\b/i.test(line)
    );
  });

  if (!evidenceLine) {
    return undefined;
  }

  return {
    verified: true,
    url: normalizedTargetUrl,
    signal: "tabular/browser-state output containing target URL",
  };
}

function assertSurfExploreEvidence(
  result: { stdout: string; stderr: string },
  commandDisplay: string[],
  targetUrl: string,
  probeId: string,
): SurfExploreEvidence {
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

async function runSurfExploreOperation(
  normalized: NormalizedSurfExploreOperationInput,
): Promise<SurfExploreOperationResultEnvelope> {
  const runtime = resolveSurfRuntimeCommand("go", [normalized.url]);
  const navigateResult = await runCommand(runtime.command, runtime.args);
  const probeId = randomUUID();
  const probeRuntime = resolveSurfRuntimeCommand("js", [
    `return { ${SURF_EXPLORE_PROBE_FIELD}: "${probeId}", href: location.href, title: document.title, readyState: document.readyState }`,
  ]);
  const probeResult = await runCommand(probeRuntime.command, probeRuntime.args);
  const result = {
    code: probeResult.code,
    stdout: [navigateResult.stdout, probeResult.stdout].filter(Boolean).join("\n"),
    stderr: [navigateResult.stderr, probeResult.stderr].filter(Boolean).join("\n"),
  };
  const evidence = assertSurfExploreEvidence(
    result,
    [...runtime.commandDisplay, "&&", ...probeRuntime.commandDisplay],
    normalized.url,
    probeId,
  );

  return {
    operationId: "surf.explore",
    input: normalized,
    result: {
      command: runtime.command,
      args: runtime.args,
      runtime: {
        flavor: runtime.flavor,
        provider: runtime.provider,
        resolutionNotes: runtime.resolutionNotes,
      },
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
      evidence,
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
