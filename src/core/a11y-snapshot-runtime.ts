/**
 * The agent-browser `Adapter`: resolution, version floor, loopback CDP probe, a read-only argv
 * allowlist and two transports behind one `invoke` (adjudication claim 28, review A14).
 *
 * This is the second sensor the framework drives and the first with more than one transport:
 * `/json/version` and `/json/list` are HTTP reads of the browser's own DevTools endpoint, and
 * `snapshot`, `get`, `is` and `tab` are process invocations. Both go through `Adapter.invoke`,
 * so a step cannot skip translation and the classifier sees one shape either way.
 *
 * The whole module is a fence around one sentence of the packet: *the channel never launches a
 * browser*. That is enforced four times over - the endpoint must be loopback and is checked
 * before any request is made, every invocation carries `--cdp <port>`, the argv allowlist has no
 * `open`, no `--auto-connect`, no `--profile` and no action verb at all, and a resolution,
 * version or endpoint failure is a typed `unavailable` rather than a fallback that starts
 * something.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { Adapter, AdapterEffect, AdapterInvocation, AdapterStep } from "./adapter.js";
import type { ExpectDeclaration, RawResult, ResultOutcome } from "./result-classification.js";
import { classifyResult } from "./result-classification.js";
import { FrameworkError } from "./runtime-contract.js";
import { spawnStep } from "./spawn-step.js";

export const AGENT_BROWSER_BIN_ENV = "TEST_CAPABILITIES_AGENT_BROWSER_BIN";
export const CDP_ENDPOINT_ENV = "TEST_CAPABILITIES_CDP_ENDPOINT";
export const AGENT_BROWSER_SESSION_PREFIX_ENV = "TEST_CAPABILITIES_AGENT_BROWSER_SESSION_PREFIX";
export const AGENT_BROWSER_SESSION_ENV = "TEST_CAPABILITIES_AGENT_BROWSER_SESSION";

export const DEFAULT_SESSION_PREFIX = "test-capabilities";
export const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";

/**
 * The version whose `--pin-tab`, `tab_gone` and `tab list --json` `targetId` semantics were
 * measured (packet, "Resolution and probe"). Below it the channel is `unavailable`: an older
 * build may accept the same argv and mean something else by it.
 */
export const AGENT_BROWSER_MIN_VERSION = "0.35.1";

export const DEFAULT_AGENT_BROWSER_TIMEOUT_MS = 30_000;
export const DEFAULT_CDP_PROBE_TIMEOUT_MS = 2_000;

/** The hosts a CDP endpoint may name. Anything else is refused before a socket is opened. */
export const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "::1", "[::1]"];

// ============================================
// RESOLUTION
// ============================================

export type AgentBrowserProvider = "explicit_bin" | "path" | "npm_global_bin";

export interface CdpEndpoint {
  /** the origin as the operator wrote it, without a trailing slash */
  url: string;
  host: string;
  port: number;
}

export interface AgentBrowserResolution {
  command: string;
  provider: AgentBrowserProvider;
  resolutionNotes: string[];
  endpoint: CdpEndpoint;
  /** `<prefix>-<runId>`; never the default session, which belongs to whoever else is on the box */
  session: string;
}

export interface AgentBrowserProbe {
  version: string;
  versionOutput: string;
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function findOnPath(binary: string, env: NodeJS.ProcessEnv): string | undefined {
  const entries = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const candidate = path.join(entry, binary);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function homeDirectory(env: NodeJS.ProcessEnv): string | undefined {
  if (env.HOME?.trim()) {
    return env.HOME.trim();
  }
  try {
    return os.homedir();
  } catch {
    return undefined;
  }
}

/**
 * Where the endpoint is, and whether the framework is allowed to talk to it.
 *
 * The loopback rule is applied here, before any request: a non-loopback host is refused as a
 * configuration error, not as a connection that happened to fail. The open DevTools port lets
 * any local process read the agent browser's cookies (workstation doc); the channel does not
 * widen that, and it will not be pointed at somebody else's browser by a stray environment
 * variable.
 */
export function resolveCdpEndpoint(env: NodeJS.ProcessEnv = process.env): CdpEndpoint {
  const raw = env[CDP_ENDPOINT_ENV]?.trim() || DEFAULT_CDP_ENDPOINT;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new FrameworkError(
      "cdp_endpoint_refused",
      `${CDP_ENDPOINT_ENV}=${raw} is not a URL. Point it at the loopback DevTools endpoint of Chromium (Agent), e.g. ${DEFAULT_CDP_ENDPOINT}.`,
      { endpoint: raw },
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FrameworkError(
      "cdp_endpoint_refused",
      `${CDP_ENDPOINT_ENV}=${raw} uses '${parsed.protocol}'. The CDP probe speaks HTTP to /json/version and /json/list only.`,
      { endpoint: raw, protocol: parsed.protocol },
    );
  }
  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) {
    throw new FrameworkError(
      "cdp_endpoint_refused",
      `${CDP_ENDPOINT_ENV}=${raw} names host '${parsed.hostname}'. The a11y channel attaches to a browser on this machine only (${LOOPBACK_HOSTS.join(", ")}); a remote DevTools endpoint is refused before any request is made.`,
      { endpoint: raw, host: parsed.hostname },
    );
  }
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  return {
    url: `${parsed.protocol}//${parsed.host}`,
    host: parsed.hostname,
    port,
  };
}

export function resolveSessionName(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env[AGENT_BROWSER_SESSION_ENV]?.trim();
  if (explicit) {
    return explicit;
  }
  const prefix = env[AGENT_BROWSER_SESSION_PREFIX_ENV]?.trim() || DEFAULT_SESSION_PREFIX;
  return `${prefix}-${process.pid}`;
}

/** `<prefix>-<runId>`: the session name the observer pins for one run. */
export function sessionNameForRun(runId: string, env: NodeJS.ProcessEnv = process.env): string {
  const prefix = env[AGENT_BROWSER_SESSION_PREFIX_ENV]?.trim() || DEFAULT_SESSION_PREFIX;
  return `${prefix}-${runId}`;
}

/**
 * `TEST_CAPABILITIES_AGENT_BROWSER_BIN` -> `agent-browser` on PATH -> `~/.npm-global/bin`, with a
 * note when the last one is used (the surf runtime's rule, `surf-runtime.ts:196-208`). The npm
 * global bin is on the login shell's PATH but not on every tool shell's, which is why it is a
 * resolution step rather than the operator's problem.
 */
export function resolveAgentBrowserResolution(
  env: NodeJS.ProcessEnv = process.env,
): AgentBrowserResolution {
  const endpoint = resolveCdpEndpoint(env);
  const session = resolveSessionName(env);

  const explicit = env[AGENT_BROWSER_BIN_ENV]?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!isExecutable(resolved)) {
      throw new FrameworkError(
        "agent_browser_missing",
        `${AGENT_BROWSER_BIN_ENV} points to ${resolved}, but no executable agent-browser exists there.`,
        { command: resolved },
      );
    }
    return { command: resolved, provider: "explicit_bin", resolutionNotes: [], endpoint, session };
  }

  const onPath = findOnPath("agent-browser", env);
  if (onPath) {
    return { command: onPath, provider: "path", resolutionNotes: [], endpoint, session };
  }

  const home = homeDirectory(env);
  const npmGlobal = home ? path.join(home, ".npm-global", "bin", "agent-browser") : undefined;
  if (npmGlobal && isExecutable(npmGlobal)) {
    return {
      command: npmGlobal,
      provider: "npm_global_bin",
      resolutionNotes: [
        `agent-browser resolved from ${npmGlobal}, which is not on PATH for this process.`,
      ],
      endpoint,
      session,
    };
  }

  throw new FrameworkError(
    "agent_browser_missing",
    `No agent-browser CLI found. Set ${AGENT_BROWSER_BIN_ENV}, put 'agent-browser' on PATH, or install it with 'npm install -g agent-browser' (>= ${AGENT_BROWSER_MIN_VERSION}). The a11y snapshot channel never launches a browser of its own, so there is no fallback.`,
    { min_version: AGENT_BROWSER_MIN_VERSION },
  );
}

// ============================================
// VERSION FLOOR
// ============================================

/** -1, 0 or 1 for dotted numeric versions; a missing segment reads as 0. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] =>
    (value.match(/\d+(?:\.\d+)*/)?.[0] ?? "0").split(".").map((part) => Number(part));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

const probeCache = new Map<string, AgentBrowserProbe>();

export function resetAgentBrowserProbeCache(): void {
  probeCache.clear();
}

/**
 * `agent-browser --version` against the floor, cached per command path the way the surf probe
 * is. A binary that does not answer is `agent_browser_missing` (it is not there in any usable
 * sense); one that answers below the floor is `agent_browser_too_old`, which names both numbers.
 */
export async function probeAgentBrowser(
  resolution: AgentBrowserResolution,
  options: { cache?: boolean; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<AgentBrowserProbe> {
  const useCache = options.cache ?? true;
  const cached = useCache ? probeCache.get(resolution.command) : undefined;
  if (cached) {
    return cached;
  }

  const raw = await spawnStep({
    source: "cli",
    command: resolution.command,
    args: ["--version"],
    timeoutMs: options.timeoutMs ?? 15_000,
    ...(options.env ? { env: options.env } : {}),
  });

  const output = `${raw.stdout}${raw.stderr}`.trim();
  if (raw.exitCode !== 0 || output.length === 0) {
    throw new FrameworkError(
      "agent_browser_missing",
      `agent-browser at ${resolution.command} did not answer --version (exit ${raw.exitCode ?? "null"}${raw.spawnFailure ? `, ${raw.spawnFailure}` : ""}). The a11y channel needs a working binary; it never launches a browser instead.`,
      { command: resolution.command, exit_code: raw.exitCode },
    );
  }

  const version = output.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)?.[1];
  if (!version) {
    throw new FrameworkError(
      "agent_browser_too_old",
      `agent-browser at ${resolution.command} answered --version with '${output.slice(0, 120)}', which carries no version number. The channel needs >= ${AGENT_BROWSER_MIN_VERSION}.`,
      { command: resolution.command, version_output: output.slice(0, 200) },
    );
  }
  if (compareVersions(version, AGENT_BROWSER_MIN_VERSION) < 0) {
    throw new FrameworkError(
      "agent_browser_too_old",
      `agent-browser ${version} at ${resolution.command} is below the ${AGENT_BROWSER_MIN_VERSION} floor. That is the version whose --pin-tab, tab_gone and 'tab list --json' targetId semantics this channel was measured against; an older build may accept the same argv and mean something else by it.`,
      { command: resolution.command, version, min_version: AGENT_BROWSER_MIN_VERSION },
    );
  }

  const probe: AgentBrowserProbe = { version, versionOutput: output };
  if (useCache) {
    probeCache.set(resolution.command, probe);
  }
  return probe;
}

// ============================================
// THE ARGV ALLOWLIST
// ============================================

/**
 * Every agent-browser invocation this framework may make.
 *
 * An allowlist, not a denylist: a verb that is not named here does not run, so the channel
 * cannot grow an action path by accident, by a future refactor or by a caller passing argv
 * through. `open`, `--auto-connect`, `--profile`, `--headed`, `eval`, `click`, `fill`, `type`,
 * `network route`, `cookies` and screenshots are absent by construction rather than by a rule
 * that has to remember them (packet, "Non-goals").
 *
 * `close` is the one entry that is not a page read. It ends *this run's own session* - the
 * `browser_session` scope surf's `tab.close` already occupies - and was measured on 2026-09-08
 * to leave an attached browser running and its pages open, which closes the packet's open
 * question about the teardown verb. `--all` would end everyone's sessions and is refused.
 */
export interface A11yCommandRule {
  /** the closed set the first positional must come from */
  subcommands?: readonly string[];
  /**
   * When the first positional may instead be a free value (a CDP target id), the shape it must
   * have. A pattern rather than "anything": `tab <targetId>` is in contract and `tab new <url>`
   * is not, and the difference has to be decidable before a process exists.
   */
  freeFirstPositional?: RegExp;
  /** positionals allowed after the first slot (a ref, an attribute name) */
  maxArguments?: number;
  flags?: readonly string[];
  effect: "read" | "session";
}

/** A CDP target id as `/json/list` and `tab list --json` both report it. */
export const CDP_TARGET_ID_PATTERN = /^[0-9A-F]{16,}$/i;

export const A11Y_COMMAND_ALLOWLIST: Readonly<Record<string, A11yCommandRule>> = {
  snapshot: { flags: ["-i", "--interactive", "--json"], maxArguments: 0, effect: "read" },
  get: {
    subcommands: ["text", "attr", "box", "url", "title", "count"],
    maxArguments: 2,
    flags: ["--json"],
    effect: "read",
  },
  is: {
    subcommands: ["visible", "enabled", "checked"],
    maxArguments: 1,
    flags: ["--json"],
    effect: "read",
  },
  tab: {
    subcommands: ["list"],
    freeFirstPositional: CDP_TARGET_ID_PATTERN,
    maxArguments: 0,
    flags: ["--json"],
    effect: "read",
  },
  close: { maxArguments: 0, effect: "session" },
};

/** The HTTP reads; they never spawn anything, so they are named separately. */
export const A11Y_HTTP_COMMANDS = ["json.version", "json.list"] as const;
export type A11yHttpCommand = (typeof A11Y_HTTP_COMMANDS)[number];

function refuseArgv(command: string, args: readonly string[], why: string): never {
  throw new FrameworkError(
    "a11y_command_not_allowed",
    `The a11y snapshot channel refuses 'agent-browser ${[command, ...args].join(" ")}': ${why}. The channel is an observer with a read-only argv allowlist (${Object.keys(A11Y_COMMAND_ALLOWLIST).join(", ")}); surf is the only action channel.`,
    { command, args: [...args] },
  );
}

/**
 * Turn a verb and its arguments into the full argv, globals included, or refuse.
 *
 * The globals are not the caller's to choose: `--cdp <port>` is what makes the invocation attach
 * instead of launch, `--session` keeps the run out of the shared default session, and
 * `--pin-tab` is what made a session fail with `tab_gone` instead of silently creating an
 * `about:blank` when its tab went away.
 */
export function translateA11yArgs(
  command: string,
  args: readonly string[],
  resolution: AgentBrowserResolution,
): string[] {
  const rule = A11Y_COMMAND_ALLOWLIST[command];
  if (!rule) {
    refuseArgv(command, args, "the verb is not on the read-only allowlist");
  }

  const positionals: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (!(rule.flags ?? []).includes(arg)) {
        refuseArgv(command, args, `the flag '${arg}' is not allowed for '${command}'`);
      }
      continue;
    }
    positionals.push(arg);
  }

  let rest = positionals;
  if (rule.subcommands) {
    const first = positionals[0];
    if (first === undefined) {
      refuseArgv(command, args, `'${command}' needs one of ${rule.subcommands.join(", ")}`);
    }
    if (!rule.subcommands.includes(first) && !rule.freeFirstPositional?.test(first)) {
      refuseArgv(
        command,
        args,
        `'${first}' is neither one of ${rule.subcommands.join(", ")} nor a CDP target id`,
      );
    }
    rest = positionals.slice(1);
  }

  if (rest.length > (rule.maxArguments ?? 0)) {
    refuseArgv(
      command,
      args,
      `it carries ${rest.length} argument(s) where '${command}' takes at most ${rule.maxArguments ?? 0}`,
    );
  }

  return [
    "--cdp",
    String(resolution.endpoint.port),
    "--session",
    resolution.session,
    "--pin-tab",
    command,
    ...args,
  ];
}

// ============================================
// THE ADAPTER
// ============================================

/** Every step this adapter runs is read-only on the target; nothing here may act on a page. */
export function agentBrowserEffect(step: AdapterStep): AdapterEffect {
  if ((A11Y_HTTP_COMMANDS as readonly string[]).includes(step.command)) {
    return {
      effect: "read_only",
      reason: `agent-browser channel reads ${step.command} from the browser's DevTools endpoint without acting`,
    };
  }
  const rule = A11Y_COMMAND_ALLOWLIST[step.command];
  if (!rule) {
    return {
      effect: "unclassified",
      reason: `agent-browser ${step.command} is not on the a11y channel's read-only allowlist`,
    };
  }
  if (rule.effect === "session") {
    return {
      effect: "read_only",
      scope: "browser_session",
      reason: `agent-browser ${step.command} ends the session this run created and leaves the browser and its pages alone`,
    };
  }
  return {
    effect: "read_only",
    reason: `agent-browser ${step.command} reads the page's accessibility tree without acting on it`,
  };
}

function httpInvocation(command: string, resolution: AgentBrowserResolution): AdapterInvocation {
  const url = `${resolution.endpoint.url}${command === "json.version" ? "/json/version" : "/json/list"}`;
  return {
    source: "http",
    command: url,
    args: [],
    timeoutMs: DEFAULT_CDP_PROBE_TIMEOUT_MS,
    display: ["GET", url],
  };
}

async function invokeHttp(invocation: AdapterInvocation): Promise<RawResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(invocation.command, {
      signal: AbortSignal.timeout(invocation.timeoutMs),
      headers: { accept: "application/json" },
    });
    const body = await response.text();
    return {
      source: "http",
      exitCode: response.ok ? 0 : 1,
      signal: null,
      stdout: body,
      stderr: "",
      durationMs: Date.now() - startedAt,
      httpStatus: response.status,
      httpMethod: "GET",
      body,
    };
  } catch (error) {
    return {
      source: "http",
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startedAt,
      spawnFailure: error instanceof Error ? error.message : String(error),
      httpMethod: "GET",
    };
  }
}

/**
 * The agent-browser adapter. Two transports, one boundary: `translate` decides which by the
 * verb, and `invoke` is the only place either of them is reached.
 */
export const agentBrowserAdapter: Adapter<AgentBrowserResolution, undefined> = {
  id: "agent-browser",

  resolve(env: NodeJS.ProcessEnv = process.env): AgentBrowserResolution {
    return resolveAgentBrowserResolution(env);
  },

  /** The version floor is an async probe; `probeAgentBrowser` is the member callers use. */
  probe(): undefined {
    return undefined;
  },

  translate(step: AdapterStep, resolution: AgentBrowserResolution): AdapterInvocation {
    if ((A11Y_HTTP_COMMANDS as readonly string[]).includes(step.command)) {
      return httpInvocation(step.command, resolution);
    }
    const args = translateA11yArgs(step.command, step.args ?? [], resolution);
    return {
      source: "cli",
      command: resolution.command,
      args,
      timeoutMs: step.timeoutMs ?? DEFAULT_AGENT_BROWSER_TIMEOUT_MS,
      ...(step.env ? { env: step.env } : {}),
      display: [resolution.command, ...args],
    };
  },

  effects(step: AdapterStep): AdapterEffect {
    return agentBrowserEffect(step);
  },

  invoke(invocation: AdapterInvocation): Promise<RawResult> {
    return invocation.source === "http" ? invokeHttp(invocation) : spawnStep(invocation);
  },

  normalize(raw: RawResult, declaration?: ExpectDeclaration): ResultOutcome {
    return classifyResult(raw, declaration);
  },
};

// ============================================
// THE CDP READS
// ============================================

export interface CdpVersion {
  browser: string;
  webSocketDebuggerUrl?: string;
}

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
}

function parseJsonBody(body: string, what: string, endpoint: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new FrameworkError(
      "cdp_endpoint_not_chromium",
      `${endpoint}${what} did not answer JSON. The a11y channel needs a Chromium DevTools endpoint; ${DEFAULT_CDP_ENDPOINT} is the agent browser's.`,
      { endpoint, path: what, body: body.slice(0, 200) },
    );
  }
}

/**
 * `GET /json/version`: the endpoint answers, and it is a Chromium.
 *
 * A transport failure and a wrong answer are different facts and get different codes: nothing is
 * listening is `cdp_endpoint_unreachable` (start Chromium (Agent)), and something is listening
 * that is not a browser is `cdp_endpoint_not_chromium` (the port is somebody else's).
 */
export async function probeCdpEndpoint(
  resolution: AgentBrowserResolution,
  options: { timeoutMs?: number } = {},
): Promise<CdpVersion> {
  const invocation = httpInvocation("json.version", resolution);
  const raw = await invokeHttp({
    ...invocation,
    timeoutMs: options.timeoutMs ?? invocation.timeoutMs,
  });
  if (raw.spawnFailure !== undefined) {
    throw new FrameworkError(
      "cdp_endpoint_unreachable",
      `No DevTools endpoint answered at ${resolution.endpoint.url}/json/version (${raw.spawnFailure}). Start Chromium (Agent) with its remote debugging port, or set ${CDP_ENDPOINT_ENV}; the channel never launches a browser.`,
      { endpoint: resolution.endpoint.url, detail: raw.spawnFailure },
    );
  }
  if (raw.httpStatus !== 200) {
    throw new FrameworkError(
      "cdp_endpoint_not_chromium",
      `${resolution.endpoint.url}/json/version answered HTTP ${raw.httpStatus ?? "unknown"}; a Chromium DevTools endpoint answers 200 with a Browser string.`,
      { endpoint: resolution.endpoint.url, http_status: raw.httpStatus ?? null },
    );
  }
  const payload = parseJsonBody(raw.stdout, "/json/version", resolution.endpoint.url);
  const browser =
    typeof payload === "object" && payload !== null
      ? (payload as { Browser?: unknown }).Browser
      : undefined;
  if (typeof browser !== "string" || browser.length === 0) {
    throw new FrameworkError(
      "cdp_endpoint_not_chromium",
      `${resolution.endpoint.url}/json/version answered without a 'Browser' string, so the framework cannot tell what is on that port.`,
      { endpoint: resolution.endpoint.url },
    );
  }
  const socket = (payload as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl;
  return {
    browser,
    ...(typeof socket === "string" ? { webSocketDebuggerUrl: socket } : {}),
  };
}

/** `GET /json/list`: the browser's own target inventory, read without agent-browser. */
export async function listCdpTargets(
  resolution: AgentBrowserResolution,
  options: { timeoutMs?: number } = {},
): Promise<CdpTarget[]> {
  const invocation = httpInvocation("json.list", resolution);
  const raw = await invokeHttp({
    ...invocation,
    timeoutMs: options.timeoutMs ?? invocation.timeoutMs,
  });
  if (raw.spawnFailure !== undefined) {
    throw new FrameworkError(
      "cdp_endpoint_unreachable",
      `No DevTools endpoint answered at ${resolution.endpoint.url}/json/list (${raw.spawnFailure}).`,
      { endpoint: resolution.endpoint.url, detail: raw.spawnFailure },
    );
  }
  const payload = parseJsonBody(raw.stdout, "/json/list", resolution.endpoint.url);
  if (!Array.isArray(payload)) {
    throw new FrameworkError(
      "cdp_endpoint_not_chromium",
      `${resolution.endpoint.url}/json/list answered ${typeof payload}, not a target list.`,
      { endpoint: resolution.endpoint.url },
    );
  }
  return payload
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : "",
      type: typeof entry.type === "string" ? entry.type : "",
      url: typeof entry.url === "string" ? entry.url : "",
      title: typeof entry.title === "string" ? entry.title : "",
    }))
    .filter((target) => target.id.length > 0);
}

export type {
  A11yAssertion,
  A11yAssertionResult,
  A11yRefMap,
  A11ySnapshotArtifact,
} from "./a11y-snapshot.js";
export { evaluateA11yAssertion, resolveA11yAssertion } from "./a11y-snapshot.js";
