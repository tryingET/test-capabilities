/**
 * Surf runtime resolution and command mapping.
 *
 * The runtime flavor is the upstream nicobailon/surf-cli CLI (`surf`), preferably the
 * `feat/site-independent-mechanisms` branch build that adds `wait.ready`, `page.readiness`,
 * `extract` and `frame.diagnose`. The retired `surf-go` fork is refused explicitly: its
 * upstream was deleted, the committed binary was removed, and a static build needs cgo, so a
 * silently kept mapping could never be verified again.
 */

import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export type SurfRuntimeFlavor = "surf";

export type SurfRuntimeProvider = "explicit_bin" | "path_surf" | "home_local_bin";

export interface SurfRuntimeResolution {
  command: string;
  baseArgs: string[];
  flavor: SurfRuntimeFlavor;
  provider: SurfRuntimeProvider;
  resolutionNotes: string[];
}

export const RETIRED_SURF_GO_ENV_VARS = [
  "TEST_CAPABILITIES_SURF_GO_BIN",
  "TEST_CAPABILITIES_SURF_GO_REPO",
] as const;

export const SURF_MECHANISM_COMMANDS = {
  waitReady: "wait.ready",
  pageReadiness: "page.readiness",
  extract: "extract",
  frameDiagnose: "frame.diagnose",
} as const;

export type SurfMechanism = keyof typeof SURF_MECHANISM_COMMANDS;

export const SURF_EXPLORE_REQUIRED_MECHANISMS: readonly SurfMechanism[] = ["waitReady", "extract"];

export interface SurfRuntimeProbe {
  version: string | undefined;
  versionOutput: string;
  mechanisms: Record<SurfMechanism, boolean>;
  missingExploreMechanisms: string[];
}

export interface SurfCommandFailure {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SurfCommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  commandDisplay: string[];
  failure?: SurfCommandFailure;
}

export class SurfCommandError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly commandDisplay: string[];

  constructor(result: SurfCommandResult) {
    const failure = result.failure ?? {
      code: "error",
      message: `${result.commandDisplay.join(" ")} exited with code ${result.code ?? "null"}`,
    };
    super(`${failure.message} [${failure.code}]`);
    this.name = "SurfCommandError";
    this.code = failure.code;
    this.details = failure.details;
    this.exitCode = result.code;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.commandDisplay = result.commandDisplay;
  }
}

export const SURF_READINESS_ERROR_CODES = [
  "page_login",
  "page_challenge",
  "page_not_found",
  "page_error",
  "page_timeout",
] as const;

export type SurfReadinessErrorCode = (typeof SURF_READINESS_ERROR_CODES)[number];

export function isSurfReadinessErrorCode(code: string): code is SurfReadinessErrorCode {
  return (SURF_READINESS_ERROR_CODES as readonly string[]).includes(code);
}

// ============================================
// RESOLUTION
// ============================================

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(binaryName: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathValue = env.PATH ?? "";
  const pathExts =
    process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];

  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) {
      continue;
    }

    for (const ext of pathExts) {
      const candidate = path.join(entry, `${binaryName}${ext}`);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function homeDirectory(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.HOME?.trim();
  if (explicit) {
    return explicit;
  }

  try {
    return os.homedir();
  } catch {
    return undefined;
  }
}

function assertNoRetiredSurfGoEnv(env: NodeJS.ProcessEnv): void {
  const set = RETIRED_SURF_GO_ENV_VARS.filter((name) => (env[name] ?? "").trim().length > 0);
  if (set.length === 0) {
    return;
  }

  throw new Error(
    `${set.join(" and ")} ${set.length === 1 ? "is" : "are"} set, but the surf-go fork runtime was retired (upstream deleted, binary removed). Unset ${set.length === 1 ? "it" : "them"} and use TEST_CAPABILITIES_SURF_BIN, 'surf' on PATH, or ~/.local/bin/surf from nicobailon/surf-cli.`,
  );
}

export function resolveSurfRuntimeResolution(
  env: NodeJS.ProcessEnv = process.env,
): SurfRuntimeResolution {
  assertNoRetiredSurfGoEnv(env);

  const explicit = env.TEST_CAPABILITIES_SURF_BIN?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!isExecutable(resolved)) {
      throw new Error(
        `TEST_CAPABILITIES_SURF_BIN points to ${resolved}, but no executable surf CLI exists there.`,
      );
    }
    return {
      command: resolved,
      baseArgs: [],
      flavor: "surf",
      provider: "explicit_bin",
      resolutionNotes: [],
    };
  }

  const onPath = findOnPath("surf", env);
  if (onPath) {
    return {
      command: onPath,
      baseArgs: [],
      flavor: "surf",
      provider: "path_surf",
      resolutionNotes: [],
    };
  }

  const home = homeDirectory(env);
  const homeCandidate = home ? path.join(home, ".local", "bin", "surf") : undefined;
  if (homeCandidate && isExecutable(homeCandidate)) {
    return {
      command: homeCandidate,
      baseArgs: [],
      flavor: "surf",
      provider: "home_local_bin",
      resolutionNotes: [
        `surf resolved from ${homeCandidate}, which is not on PATH for this process.`,
      ],
    };
  }

  throw new Error(
    "No surf CLI found. Set TEST_CAPABILITIES_SURF_BIN, put 'surf' on PATH, or install nicobailon/surf-cli to ~/.local/bin/surf. The retired surf-go fork is not supported.",
  );
}

// ============================================
// PROCESS EXECUTION AND OUTPUT PARSING
// ============================================

export const DEFAULT_SURF_TIMEOUT_MS = 90_000;

function looksLikeJsonStart(value: string): boolean {
  return /^(?:\{|\[|"|-?\d|true\b|false\b|null\b)/.test(value);
}

function jsonCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const candidates = new Set<string>();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const lines = trimmed.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!looksLikeJsonStart(lines[index].trim())) {
      continue;
    }
    candidates.add(lines.slice(index).join("\n"));
    candidates.add(lines[index].trim());
    break;
  }

  return [...candidates];
}

export function tryParseSurfJson(
  raw: string,
): { parsed: true; value: unknown } | { parsed: false } {
  for (const candidate of jsonCandidates(raw)) {
    try {
      return { parsed: true, value: JSON.parse(candidate) };
    } catch {
      // Try the next candidate shape.
    }
  }
  return { parsed: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface SurfJsonOutput {
  data: unknown;
  target?: unknown;
  notice?: string | null;
}

/**
 * Parse `--json` stdout. With an explicit target (`--tab-id`, `--window-id`, `--session`) the
 * CLI wraps the payload as `{result, target, notice}`; the wrapper is removed here.
 */
export function parseSurfJsonOutput(stdout: string, commandLabel: string): SurfJsonOutput {
  const raw = stdout.trim();
  if (raw.length === 0) {
    throw new Error(`surf ${commandLabel} returned empty output where JSON was expected`);
  }

  const attempt = tryParseSurfJson(raw);
  if (!attempt.parsed) {
    const preview = raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
    throw new Error(`Invalid JSON output from surf ${commandLabel}: ${preview}`);
  }

  const value = attempt.value;
  if (isRecord(value) && "result" in value && "target" in value) {
    const keys = Object.keys(value).filter((key) => !["result", "target", "notice"].includes(key));
    if (keys.length === 0) {
      return {
        data: value.result,
        target: value.target,
        notice: typeof value.notice === "string" ? value.notice : null,
      };
    }
  }

  return { data: value };
}

/**
 * Extract the branch CLI's error contract: `{"error": {code, message, details}}` on stdout under
 * `--json`, and `Error: <message> [code]` as the first stderr line in every mode.
 */
export function parseSurfErrorOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  commandDisplay: string[],
): SurfCommandFailure {
  const parsed = tryParseSurfJson(stdout);
  if (parsed.parsed && isRecord(parsed.value) && isRecord(parsed.value.error)) {
    const errorObject = parsed.value.error;
    const code = typeof errorObject.code === "string" ? errorObject.code : "error";
    const message =
      typeof errorObject.message === "string" ? errorObject.message : JSON.stringify(errorObject);
    return {
      code,
      message,
      ...(isRecord(errorObject.details) ? { details: errorObject.details } : {}),
    };
  }

  const errorLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Error:/.test(line));
  if (errorLine) {
    const match = errorLine.match(/^Error:\s*(.*?)(?:\s\[([A-Za-z0-9_.-]+)\])?$/);
    return {
      code: match?.[2] ?? "error",
      message: match?.[1]?.trim() || errorLine,
    };
  }

  const fallback = stderr.trim() || stdout.trim();
  return {
    code: "error",
    message: fallback || `${commandDisplay.join(" ")} exited with code ${exitCode ?? "null"}`,
  };
}

/** `tab.new` answers with the text "Created tab <id>: <url>" even under `--json`. */
export function parseCreatedTabId(output: string): number | undefined {
  const parsed = tryParseSurfJson(output);
  if (parsed.parsed) {
    const value = parsed.value;
    if (isRecord(value)) {
      const candidate = value.tabId ?? value.tab_id ?? value.id;
      if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
        return candidate;
      }
    }
    if (typeof value === "string") {
      const match = value.match(/Created tab (\d+)/);
      if (match) {
        return Number(match[1]);
      }
    }
  }

  const match = output.match(/Created tab (\d+)/);
  return match ? Number(match[1]) : undefined;
}

// ============================================
// VERSION AND MECHANISM PROBE
// ============================================

export function describeSurfRuntime(
  resolution: SurfRuntimeResolution,
  probe: SurfRuntimeProbe,
): string {
  return `surf ${probe.version ?? "(unknown version)"} via ${resolution.provider} (${resolution.command})`;
}

export function assertSurfExploreMechanisms(
  resolution: SurfRuntimeResolution,
  probe: SurfRuntimeProbe,
): void {
  if (probe.missingExploreMechanisms.length === 0) {
    return;
  }

  throw new Error(
    `${describeSurfRuntime(resolution, probe)} lacks ${probe.missingExploreMechanisms.join(" and ")}. Surf explore requires the surf-cli build with typed page readiness and owned-tab extraction (branch feat/site-independent-mechanisms on top of v2.18.0); refusing to run against an upstream build without them.`,
  );
}

// ============================================
// COMMAND MAPPING
// ============================================

type ParsedArgs = {
  positionals: string[];
  values: Record<string, string>;
  flags: Set<string>;
};

function unsupported(command: string, reason: string): Error {
  return new Error(`Unsupported surf ${command} argument shape: ${reason}`);
}

function parseCommandArgs(
  command: string,
  args: string[],
  spec: { valueFlags?: string[]; boolFlags?: string[]; maxPositionals?: number },
): ParsedArgs {
  const valueFlags = new Set(spec.valueFlags ?? []);
  const boolFlags = new Set(spec.boolFlags ?? []);
  const parsed: ParsedArgs = { positionals: [], values: {}, flags: new Set() };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (valueFlags.has(arg)) {
        const value = args[index + 1];
        if (value === undefined) {
          throw unsupported(command, `${arg} requires a value`);
        }
        parsed.values[arg] = value;
        index += 1;
        continue;
      }
      if (boolFlags.has(arg)) {
        parsed.flags.add(arg);
        continue;
      }
      throw unsupported(command, `${arg} is not a verified surf flag for this command`);
    }
    parsed.positionals.push(arg);
  }

  if (spec.maxPositionals !== undefined && parsed.positionals.length > spec.maxPositionals) {
    throw unsupported(command, `too many positional arguments (${parsed.positionals.join(" ")})`);
  }

  return parsed;
}

function requiredPositional(
  command: string,
  parsed: ParsedArgs,
  index: number,
  label: string,
): string {
  const value = parsed.positionals[index];
  if (!value) {
    throw unsupported(command, `missing ${label}`);
  }
  return value;
}

function numeric(command: string, value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw unsupported(command, `${label} must be numeric`);
  }
  return parsed;
}

function passthroughValues(parsed: ParsedArgs, flags: string[]): string[] {
  const out: string[] = [];
  for (const flag of flags) {
    if (parsed.values[flag] !== undefined) {
      out.push(flag, parsed.values[flag]);
    }
  }
  return out;
}

function passthroughFlags(parsed: ParsedArgs, flags: string[]): string[] {
  return flags.filter((flag) => parsed.flags.has(flag));
}

function translateWait(args: string[]): string[] {
  const parsed = parseCommandArgs("wait", args, {
    valueFlags: ["--element", "--url", "--timeout"],
    boolFlags: ["--network"],
    maxPositionals: 1,
  });
  const timeout = passthroughValues(parsed, ["--timeout"]);

  if (parsed.values["--element"]) {
    return ["wait.element", parsed.values["--element"], ...timeout];
  }
  if (parsed.values["--url"]) {
    return ["wait.url", parsed.values["--url"], ...timeout];
  }
  if (parsed.flags.has("--network")) {
    return ["wait.network", ...timeout];
  }
  if (parsed.positionals.length === 1) {
    const milliseconds = numeric("wait", parsed.positionals[0], "duration");
    if (milliseconds < 0) {
      throw unsupported("wait", "duration must not be negative");
    }
    // The framework API takes milliseconds; upstream `wait <duration>` takes seconds.
    return ["wait", String(milliseconds / 1000)];
  }
  throw unsupported("wait", args.join(" ") || "(empty)");
}

function translateClick(args: string[]): string[] {
  const parsed = parseCommandArgs("click", args, {
    valueFlags: ["--selector", "--index"],
    maxPositionals: 2,
  });
  if (parsed.values["--selector"]) {
    return ["click", ...passthroughValues(parsed, ["--selector", "--index"])];
  }
  if (parsed.positionals.length === 1) {
    return ["click", parsed.positionals[0]];
  }
  if (parsed.positionals.length === 2) {
    return [
      "click",
      "--x",
      String(numeric("click", parsed.positionals[0], "x")),
      "--y",
      String(numeric("click", parsed.positionals[1], "y")),
    ];
  }
  throw unsupported("click", args.join(" ") || "(empty)");
}

function translateType(args: string[]): string[] {
  const parsed = parseCommandArgs("type", args, {
    valueFlags: ["--ref", "--selector"],
    boolFlags: ["--submit", "--clear"],
    maxPositionals: 1,
  });
  const text = requiredPositional("type", parsed, 0, "text");
  const out = ["type", text];
  if (parsed.values["--ref"]) {
    out.push("--ref", parsed.values["--ref"]);
  }
  if (parsed.values["--selector"]) {
    out.push("--into", parsed.values["--selector"]);
  }
  out.push(...passthroughFlags(parsed, ["--submit", "--clear"]));
  return out;
}

function translateScroll(command: string, args: string[]): string[] {
  const direction = command.split(".")[1];
  if (!direction || !["up", "down", "left", "right"].includes(direction)) {
    throw new Error(`Unsupported surf scroll command: ${command}`);
  }
  const parsed = parseCommandArgs(command, args, { maxPositionals: 2 });
  const [first, second] = parsed.positionals;
  const pixels = first === direction ? second : first;
  const out = ["scroll", direction];
  if (pixels !== undefined) {
    out.push(String(numeric(command, pixels, "pixels")));
  }
  return out;
}

function translateScreenshot(args: string[]): string[] {
  const parsed = parseCommandArgs("screenshot", args, {
    valueFlags: ["--output", "--max-size", "--selector"],
    boolFlags: ["--full", "--annotate", "--fullpage"],
    maxPositionals: 0,
  });
  return [
    "screenshot",
    ...passthroughValues(parsed, ["--output", "--selector", "--max-size"]),
    ...passthroughFlags(parsed, ["--full", "--annotate", "--fullpage"]),
  ];
}

function translateSelect(args: string[]): string[] {
  const parsed = parseCommandArgs("select", args, { valueFlags: ["--by"] });
  const target = requiredPositional("select", parsed, 0, "ref or selector");
  const values = parsed.positionals.slice(1);
  if (values.length === 0) {
    throw unsupported("select", "missing value");
  }
  return ["select", target, ...values, ...passthroughValues(parsed, ["--by"])];
}

const NETWORK_LIST_FLAGS = ["--origin", "--method", "--type", "--status", "--since", "--last"];

function translateNetwork(args: string[]): string[] {
  const parsed = parseCommandArgs("network", args, {
    valueFlags: NETWORK_LIST_FLAGS,
    maxPositionals: 0,
  });
  return ["network", ...passthroughValues(parsed, NETWORK_LIST_FLAGS), "--json"];
}

const READINESS_FLAGS = [
  "--tab-id",
  "--selector",
  "--text",
  "--url-prefix",
  "--empty-text",
  "--accept",
  "--timeout",
  "--interval",
];

function translateReadinessFlags(command: string, args: string[]): string[] {
  const parsed = parseCommandArgs(command, args, {
    valueFlags: READINESS_FLAGS,
    maxPositionals: 0,
  });
  return [command, ...passthroughValues(parsed, READINESS_FLAGS), "--json"];
}

const EXTRACT_VALUE_FLAGS = [
  "--tab-id",
  "--session",
  "--file",
  "--code",
  "--options",
  "--options-file",
  "--ready-selector",
  "--ready-text",
  "--ready-url-prefix",
  "--empty-text",
  "--ready-timeout",
  "--rows",
  "--retry",
  "--retry-delay-ms",
];

const EXTRACT_BOOL_FLAGS = ["--allow-empty", "--keep-tab"];

function translateExtract(args: string[]): string[] {
  const parsed = parseCommandArgs("extract", args, {
    valueFlags: EXTRACT_VALUE_FLAGS,
    boolFlags: EXTRACT_BOOL_FLAGS,
    maxPositionals: 1,
  });
  if (!parsed.values["--file"] && !parsed.values["--code"]) {
    throw unsupported("extract", "one of --file or --code is required");
  }
  if (
    parsed.positionals.length === 0 &&
    !parsed.values["--tab-id"] &&
    !parsed.values["--session"]
  ) {
    throw unsupported("extract", "a URL is required unless --tab-id or --session names the page");
  }
  return [
    "extract",
    ...parsed.positionals,
    ...passthroughValues(parsed, EXTRACT_VALUE_FLAGS),
    ...passthroughFlags(parsed, EXTRACT_BOOL_FLAGS),
    "--json",
  ];
}

function translateJs(args: string[]): string[] {
  const parsed = parseCommandArgs("js", args, {
    valueFlags: ["--tab-id", "--file", "--options"],
    maxPositionals: 1,
  });
  if (parsed.positionals.length === 0 && !parsed.values["--file"]) {
    throw unsupported("js", "missing code or --file");
  }
  return [
    "js",
    ...parsed.positionals,
    ...passthroughValues(parsed, ["--file", "--options", "--tab-id"]),
    "--json",
  ];
}

function translateSinglePositional(
  command: string,
  args: string[],
  label: string,
  extra: string[] = [],
): string[] {
  const parsed = parseCommandArgs(command, args, { maxPositionals: 1 });
  return [command, requiredPositional(command, parsed, 0, label), ...extra];
}

function translateNoArgs(command: string, args: string[], extra: string[] = []): string[] {
  parseCommandArgs(command, args, { maxPositionals: 0 });
  return [command, ...extra];
}

function translateLocate(command: string, args: string[]): string[] {
  const valueFlags =
    command === "locate.role" ? ["--name", "--action", "--value"] : ["--action", "--value"];
  const boolFlags =
    command === "locate.text" ? ["--exact"] : command === "locate.role" ? ["--all"] : [];
  const parsed = parseCommandArgs(command, args, { valueFlags, boolFlags, maxPositionals: 1 });
  return [
    command,
    requiredPositional(command, parsed, 0, "target"),
    ...passthroughValues(parsed, valueFlags),
    ...passthroughFlags(parsed, boolFlags),
  ];
}

function translateChatgpt(args: string[]): string[] {
  const parsed = parseCommandArgs("chatgpt", args, {
    valueFlags: ["--model", "--file", "--timeout"],
    boolFlags: ["--with-page"],
    maxPositionals: 1,
  });
  return [
    "chatgpt",
    requiredPositional("chatgpt", parsed, 0, "prompt"),
    ...passthroughValues(parsed, ["--model", "--file", "--timeout"]),
    ...passthroughFlags(parsed, ["--with-page"]),
  ];
}

function translateDo(args: string[]): string[] {
  if (args[0] === "--file") {
    const file = args[1];
    if (!file) {
      throw unsupported("do", "--file requires a path");
    }
    const rest = args.slice(2);
    const pairsValid =
      rest.length % 2 === 0 &&
      rest.every((value, index) => index % 2 === 1 || value.startsWith("--"));
    if (!pairsValid) {
      throw unsupported("do", "workflow arguments must be --name value pairs");
    }
    return ["do", "--file", file, ...rest];
  }
  const parsed = parseCommandArgs("do", args, { maxPositionals: 1 });
  return ["do", requiredPositional("do", parsed, 0, "workflow")];
}

function translateFrameSwitch(args: string[]): string[] {
  const parsed = parseCommandArgs("frame.switch", args, {
    valueFlags: ["--index", "--name", "--selector"],
    maxPositionals: 0,
  });
  if (parsed.values["--index"] !== undefined) {
    numeric("frame.switch", parsed.values["--index"], "--index");
  }
  return ["frame.switch", ...passthroughValues(parsed, ["--index", "--name", "--selector"])];
}

function translateEmulateViewport(args: string[]): string[] {
  const parsed = parseCommandArgs("emulate.viewport", args, {
    valueFlags: ["--width", "--height", "--scale"],
    maxPositionals: 0,
  });
  for (const flag of ["--width", "--height"]) {
    if (parsed.values[flag] === undefined) {
      throw unsupported("emulate.viewport", `missing ${flag}`);
    }
    numeric("emulate.viewport", parsed.values[flag], flag);
  }
  if (parsed.values["--scale"] !== undefined) {
    numeric("emulate.viewport", parsed.values["--scale"], "--scale");
  }
  return ["emulate.viewport", ...passthroughValues(parsed, ["--width", "--height", "--scale"])];
}

function translatePageRead(args: string[]): string[] {
  const parsed = parseCommandArgs("page.read", args, {
    valueFlags: ["--depth", "--max-bytes"],
    boolFlags: ["--compact", "--no-text", "--all"],
    maxPositionals: 0,
  });
  if (parsed.values["--depth"] !== undefined) {
    numeric("page.read", parsed.values["--depth"], "--depth");
  }
  return [
    "page.read",
    ...passthroughValues(parsed, ["--depth", "--max-bytes"]),
    ...passthroughFlags(parsed, ["--compact", "--no-text", "--all"]),
  ];
}

export function translateSurfArgs(command: string, args: string[] = []): string[] {
  switch (command) {
    case "go":
      return translateSinglePositional("navigate", args, "url");
    case "back":
    case "forward":
      return translateNoArgs(command, args);
    case "reload":
    case "tab.reload": {
      const parsed = parseCommandArgs("tab.reload", args, {
        boolFlags: ["--hard"],
        maxPositionals: 0,
      });
      return ["tab.reload", ...passthroughFlags(parsed, ["--hard"])];
    }
    case "read":
      return translatePageRead(args);
    case "page.text":
      return translateNoArgs("page.text", args);
    case "page.state":
      return translateNoArgs("page.state", args, ["--json"]);
    case "page.readiness":
    case "wait.ready":
      return translateReadinessFlags(command, args);
    case "frame.diagnose": {
      const parsed = parseCommandArgs(command, args, {
        valueFlags: ["--tab-id"],
        maxPositionals: 0,
      });
      return ["frame.diagnose", ...passthroughValues(parsed, ["--tab-id"]), "--json"];
    }
    case "extract":
      return translateExtract(args);
    case "network":
      return translateNetwork(args);
    case "network.get":
      return translateSinglePositional("network.get", args, "id", ["--json"]);
    case "network.body":
      return translateSinglePositional("network.body", args, "id");
    case "network.clear":
      return translateNoArgs("network.clear", args);
    case "network.stats":
      return translateNoArgs("network.stats", args, ["--json"]);
    case "console":
      return translateNoArgs("console", args, ["--json"]);
    case "chatgpt":
      return translateChatgpt(args);
    case "wait":
      return translateWait(args);
    case "click":
      return translateClick(args);
    case "type":
      return translateType(args);
    case "key":
      return translateSinglePositional("key", args, "key");
    case "scroll.up":
    case "scroll.down":
    case "scroll.left":
    case "scroll.right":
      return translateScroll(command, args);
    case "select":
      return translateSelect(args);
    case "screenshot":
      return translateScreenshot(args);
    case "js":
      return translateJs(args);
    case "locate.role":
    case "locate.text":
    case "locate.label":
      return translateLocate(command, args);
    case "tab.list":
    case "window.list":
    case "cookie.list":
    case "frame.list":
      return translateNoArgs(command, args, ["--json"]);
    case "frame.main":
      return translateNoArgs(command, args);
    case "tab.new":
    case "window.new":
      return translateSinglePositional(command, args, "url");
    case "tab.switch":
    case "tab.close":
    case "window.close":
      return translateSinglePositional(command, args, "id");
    case "frame.switch":
      return translateFrameSwitch(args);
    case "emulate.device":
      return translateSinglePositional("emulate.device", args, "device");
    case "emulate.viewport":
      return translateEmulateViewport(args);
    case "do":
      return translateDo(args);
    default:
      break;
  }

  throw new Error(
    `Unsupported surf command mapping for '${command}'. Add an explicit adapter mapping and contract test before using this SurfClient method.`,
  );
}

export function resolveSurfRuntimeCommand(
  command: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): SurfRuntimeResolution & { args: string[]; commandDisplay: string[] } {
  const resolution = resolveSurfRuntimeResolution(env);
  const translatedArgs = translateSurfArgs(command, args);
  const allArgs = [...resolution.baseArgs, ...translatedArgs];

  return {
    ...resolution,
    args: allArgs,
    commandDisplay: [resolution.command, ...allArgs],
  };
}
