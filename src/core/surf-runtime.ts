import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export type SurfRuntimeFlavor = "surf-go";

export type SurfRuntimeProvider =
  | "explicit_go_bin"
  | "explicit_go_repo_build"
  | "explicit_go_repo_source"
  | "workspace_contrib_go_build"
  | "workspace_contrib_go_source"
  | "path_surf_go";

export interface SurfRuntimeResolution {
  command: string;
  baseArgs: string[];
  flavor: SurfRuntimeFlavor;
  provider: SurfRuntimeProvider;
  resolutionNotes: string[];
}

function currentGoArch(): string {
  const archMap: Record<string, string> = {
    x64: "amd64",
    ia32: "386",
    arm64: "arm64",
    arm: "arm",
  };

  return archMap[process.arch] ?? process.arch;
}

function surfGoBinaryName(): string {
  return process.platform === "win32" ? "surf-go.exe" : "surf-go";
}

function surfGoBuiltRelativePaths(): string[] {
  const binaryName = surfGoBinaryName();
  return [
    path.join("dist", "go", `${process.platform}-${currentGoArch()}`, binaryName),
    path.join("dist", "go", `${process.platform}-${process.arch}`, binaryName),
    path.join("go", binaryName),
    path.join("go", "bin", binaryName),
  ];
}

function resolvePackageRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TEST_CAPABILITIES_PACKAGE_ROOT) {
    return path.resolve(env.TEST_CAPABILITIES_PACKAGE_ROOT);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(binaryName: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
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

function firstBuiltSurfGoBinary(repoRoot: string): string | undefined {
  for (const relativePath of surfGoBuiltRelativePaths()) {
    const candidate = path.join(repoRoot, relativePath);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function hasSurfGoSource(repoRoot: string): boolean {
  return existsSync(path.join(repoRoot, "go", "cmd", "surf-go", "main.go"));
}

function explicitSurfGoRepoRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.TEST_CAPABILITIES_SURF_GO_REPO?.trim();
  return explicit ? path.resolve(explicit) : undefined;
}

function workspaceSurfGoRepoRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const packageRoot = resolvePackageRoot(env);
  const workspaceContribRepo = path.resolve(packageRoot, "..", "..", "contrib", "surf-cli-go");
  return existsSync(workspaceContribRepo) ? workspaceContribRepo : undefined;
}

function renderMissingSurfGoBuildNote(repoRoot: string, contextLabel: string): string {
  if (!existsSync(repoRoot)) {
    return `${contextLabel} points to ${repoRoot}, but that Surf Go checkout does not exist.`;
  }

  const candidateList = surfGoBuiltRelativePaths()
    .map((relativePath) => path.join(repoRoot, relativePath))
    .join(" or ");
  return `${contextLabel} found at ${repoRoot}, but no built surf-go binary exists at ${candidateList}; using Surf Go source via 'go -C ${path.join(repoRoot, "go")} run ./cmd/surf-go'. Build one with 'cd ${path.join(repoRoot, "go")} && go build -o surf-go ./cmd/surf-go' for faster runs.`;
}

function resolveSurfGoRepo(
  repoRoot: string,
  buildProvider: SurfRuntimeProvider,
  sourceProvider: SurfRuntimeProvider,
  contextLabel: string,
): SurfRuntimeResolution {
  const builtBinary = firstBuiltSurfGoBinary(repoRoot);
  if (builtBinary) {
    return {
      command: builtBinary,
      baseArgs: [],
      flavor: "surf-go",
      provider: buildProvider,
      resolutionNotes: [],
    };
  }

  if (hasSurfGoSource(repoRoot)) {
    return {
      command: "go",
      baseArgs: ["-C", path.join(repoRoot, "go"), "run", "./cmd/surf-go"],
      flavor: "surf-go",
      provider: sourceProvider,
      resolutionNotes: [renderMissingSurfGoBuildNote(repoRoot, contextLabel)],
    };
  }

  throw new Error(renderMissingSurfGoBuildNote(repoRoot, contextLabel));
}

export function resolveSurfRuntimeResolution(
  env: NodeJS.ProcessEnv = process.env,
): SurfRuntimeResolution {
  const explicitGoBinary = env.TEST_CAPABILITIES_SURF_GO_BIN?.trim();
  if (explicitGoBinary) {
    return {
      command: explicitGoBinary,
      baseArgs: [],
      flavor: "surf-go",
      provider: "explicit_go_bin",
      resolutionNotes: [],
    };
  }

  const explicitRepo = explicitSurfGoRepoRoot(env);
  if (explicitRepo) {
    return resolveSurfGoRepo(
      explicitRepo,
      "explicit_go_repo_build",
      "explicit_go_repo_source",
      "TEST_CAPABILITIES_SURF_GO_REPO",
    );
  }

  const workspaceRepo = workspaceSurfGoRepoRoot(env);
  if (workspaceRepo) {
    return resolveSurfGoRepo(
      workspaceRepo,
      "workspace_contrib_go_build",
      "workspace_contrib_go_source",
      "Workspace contrib Surf Go checkout",
    );
  }

  const surfGoOnPath = findOnPath("surf-go", env) ?? "surf-go";
  return {
    command: surfGoOnPath,
    baseArgs: [],
    flavor: "surf-go",
    provider: "path_surf_go",
    resolutionNotes: [],
  };
}

function argsJson(value: Record<string, unknown>): string[] {
  return ["--args-json", JSON.stringify(value)];
}

function requiredArg(command: string, args: string[], index: number, label: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`Unsupported Surf Go ${command} argument shape: missing ${label}`);
  }
  return value;
}

function numberArg(command: string, value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Unsupported Surf Go ${command} argument shape: ${label} must be numeric`);
  }
  return parsed;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function surfGoToolArgs(command: string, args: Record<string, unknown> = {}): string[] {
  return [...command.split("."), ...argsJson(args)];
}

function translatePageReadArgs(args: string[]): string[] {
  const payload: Record<string, unknown> = {};
  const depth = flagValue(args, "--depth");
  if (depth !== undefined) {
    payload.depth = numberArg("page read", depth, "--depth");
  }
  if (hasFlag(args, "--compact")) {
    payload.compact = true;
  }
  if (hasFlag(args, "--no-text")) {
    payload["no-text"] = true;
  }
  return surfGoToolArgs("page.read", payload);
}

function translateSurfGoWaitArgs(args: string[]): string[] {
  if (args.length === 1 && /^\d+$/.test(args[0])) {
    return ["wait", "dom", ...argsJson({ timeout: Number(args[0]) })];
  }

  const element = flagValue(args, "--element");
  if (element) {
    return ["wait", "element", ...argsJson({ selector: element })];
  }

  const url = flagValue(args, "--url");
  if (url) {
    return ["wait", "url", ...argsJson({ pattern: url })];
  }

  if (hasFlag(args, "--network")) {
    return ["wait", "network"];
  }

  throw new Error(`Unsupported Surf Go wait argument shape: ${args.join(" ") || "(empty)"}`);
}

function translateClickArgs(args: string[]): string[] {
  if (args[0] === "--selector" && args[1]) {
    return surfGoToolArgs("click", { selector: args[1] });
  }
  if (args.length === 1) {
    return surfGoToolArgs("click", { ref: args[0] });
  }
  if (args.length === 2) {
    return surfGoToolArgs("click", {
      x: numberArg("click", args[0], "x"),
      y: numberArg("click", args[1], "y"),
    });
  }
  throw new Error(`Unsupported Surf Go click argument shape: ${args.join(" ") || "(empty)"}`);
}

function translateTypeArgs(args: string[]): string[] {
  const text = requiredArg("type", args, 0, "text");
  const ref = flagValue(args, "--ref");
  const selector = flagValue(args, "--selector");
  const submit = hasFlag(args, "--submit");
  if (submit && ref) {
    return ["tool-raw", "--tool", "click_type_submit", ...argsJson({ text, ref })];
  }
  if (selector || submit) {
    return ["tool-raw", "--tool", "smart_type", ...argsJson({ text, selector, submit })];
  }
  return surfGoToolArgs("type", ref ? { text, ref } : { text });
}

function translateScrollArgs(command: string, args: string[]): string[] {
  const direction = command.split(".")[1];
  if (!direction || !["up", "down", "left", "right"].includes(direction)) {
    throw new Error(`Unsupported Surf Go scroll command: ${command}`);
  }
  const pixels = args[1] ? numberArg(command, args[1], "pixels") : undefined;
  return surfGoToolArgs("scroll", {
    scroll_direction: direction,
    ...(pixels === undefined ? {} : { scroll_amount: Math.max(1, Math.round(pixels / 100)) }),
  });
}

function translateSelectArgs(args: string[]): string[] {
  const selector = requiredArg("select", args, 0, "selector");
  const value = requiredArg("select", args, 1, "value");
  const by = flagValue(args, "--by") ?? "value";
  return surfGoToolArgs("select", { selector, values: [value], by });
}

function translateScreenshotArgs(args: string[]): string[] {
  const output = flagValue(args, "--output");
  const maxSize = flagValue(args, "--max-size");
  return surfGoToolArgs("screenshot", {
    ...(output ? { output } : {}),
    ...(hasFlag(args, "--full") ? { full: true } : {}),
    ...(hasFlag(args, "--annotate") ? { annotate: true } : {}),
    ...(hasFlag(args, "--fullpage") ? { fullpage: true } : {}),
    ...(maxSize ? { "max-size": numberArg("screenshot", maxSize, "--max-size") } : {}),
  });
}

function translateNetworkArgs(command: string, args: string[]): string[] {
  switch (command) {
    case "network":
      return surfGoToolArgs("network.list", {
        ...(flagValue(args, "--origin") ? { origin: flagValue(args, "--origin") } : {}),
        ...(flagValue(args, "--method") ? { method: flagValue(args, "--method") } : {}),
        ...(flagValue(args, "--type") ? { type: flagValue(args, "--type") } : {}),
        ...(flagValue(args, "--status") ? { status: flagValue(args, "--status") } : {}),
        ...(flagValue(args, "--since") ? { since: flagValue(args, "--since") } : {}),
      });
    case "network.get":
      return surfGoToolArgs("network.get", { id: requiredArg(command, args, 0, "id") });
    case "network.body":
      return surfGoToolArgs("network.body", { id: requiredArg(command, args, 0, "id") });
    case "network.clear":
    case "network.stats":
      return surfGoToolArgs(command);
    default:
      throw new Error(`Unsupported Surf Go command mapping for '${command}'.`);
  }
}

function translateSingleIdToolArgs(command: string, args: string[], key: string): string[] {
  return surfGoToolArgs(command, { [key]: requiredArg(command, args, 0, key) });
}

function translateFrameSwitchArgs(args: string[]): string[] {
  const index = flagValue(args, "--index");
  return surfGoToolArgs("frame.switch", {
    ...(index ? { index: numberArg("frame.switch", index, "--index") } : {}),
    ...(flagValue(args, "--name") ? { name: flagValue(args, "--name") } : {}),
    ...(flagValue(args, "--selector") ? { selector: flagValue(args, "--selector") } : {}),
  });
}

export function translateSurfArgs(command: string, args: string[] = []): string[] {
  switch (command) {
    case "go": {
      const [url, ...rest] = args;
      return ["navigate", "--url", url ?? "", ...rest];
    }
    case "read":
      return translatePageReadArgs(args);
    case "page.text":
      return ["page", "text"];
    case "page.state":
      return ["page", "state"];
    case "network":
    case "network.get":
    case "network.body":
    case "network.clear":
    case "network.stats":
      return translateNetworkArgs(command, args);
    case "console":
      return surfGoToolArgs("console.read");
    case "tab.reload":
      return ["reload"];
    case "chatgpt":
      return ["chatgpt", ...args];
    case "wait":
      return translateSurfGoWaitArgs(args);
    case "click":
      return translateClickArgs(args);
    case "type":
      return translateTypeArgs(args);
    case "key":
      return surfGoToolArgs("key", { key: requiredArg("key", args, 0, "key") });
    case "scroll.up":
    case "scroll.down":
    case "scroll.left":
    case "scroll.right":
      return translateScrollArgs(command, args);
    case "select":
      return translateSelectArgs(args);
    case "screenshot":
      return translateScreenshotArgs(args);
    case "js":
      return ["js", ...args];
    case "tab.list":
    case "window.list":
    case "cookie.list":
    case "frame.list":
    case "frame.main":
      return surfGoToolArgs(command);
    case "tab.new":
    case "window.new":
      return surfGoToolArgs(command, { url: requiredArg(command, args, 0, "url") });
    case "tab.switch":
    case "tab.close":
    case "window.close":
      return translateSingleIdToolArgs(command, args, "id");
    case "frame.switch":
      return translateFrameSwitchArgs(args);
    case "emulate.device":
      return surfGoToolArgs(command, { device: requiredArg(command, args, 0, "device") });
    case "emulate.viewport":
      return surfGoToolArgs(command, {
        width: numberArg(command, requiredArg(command, args, 1, "width"), "width"),
        height: numberArg(command, requiredArg(command, args, 3, "height"), "height"),
        ...(flagValue(args, "--scale")
          ? { scale: numberArg(command, flagValue(args, "--scale") ?? "", "--scale") }
          : {}),
      });
    case "back":
    case "forward":
    case "reload":
      return [command];
    default:
      break;
  }

  throw new Error(
    `Unsupported Surf Go command mapping for '${command}'. Add an explicit adapter mapping and contract test before using this SurfClient method.`,
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
