/**
 * The surf command mapping (moved out of `surf-runtime.ts` for AK #6221): how a step's command
 * and arguments become the argv a surf build understands. Every mapping is explicit; a command
 * without one is refused, never passed through.
 */

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
    valueFlags: ["--element", "--url", "--timeout", "--tab-id"],
    boolFlags: ["--network"],
    maxPositionals: 1,
  });
  const timeout = passthroughValues(parsed, ["--timeout", "--tab-id"]);

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

/**
 * The surf CLI captures a screenshot to `/tmp` after every value-setting verb, which persists
 * the value that was just typed as an image (submit-gate packet §8). A caller that wants no
 * such copy asks for it, and the flag travels in the receipt's argv so the audit trail says
 * whether one was taken.
 */
const NO_SCREENSHOT_FLAG = "--no-screenshot";

function noScreenshot(parsed: ParsedArgs): string[] {
  return passthroughFlags(parsed, [NO_SCREENSHOT_FLAG]);
}

/**
 * `--tab-id` is a *global* surf option, so the target-mutating verbs can carry it even though
 * their own `--help` does not list it. That is what lets the session point them at the tab this
 * run created instead of whichever tab the browser has in front (slice S7; the owned-tab rule).
 */
function translateClick(args: string[]): string[] {
  const parsed = parseCommandArgs("click", args, {
    valueFlags: ["--selector", "--index", "--tab-id"],
    boolFlags: [NO_SCREENSHOT_FLAG],
    maxPositionals: 2,
  });
  const tab = [...passthroughValues(parsed, ["--tab-id"]), ...noScreenshot(parsed)];
  if (parsed.values["--selector"]) {
    return ["click", ...passthroughValues(parsed, ["--selector", "--index"]), ...tab];
  }
  if (parsed.positionals.length === 1) {
    return ["click", parsed.positionals[0], ...tab];
  }
  if (parsed.positionals.length === 2) {
    return [
      "click",
      "--x",
      String(numeric("click", parsed.positionals[0], "x")),
      "--y",
      String(numeric("click", parsed.positionals[1], "y")),
      ...tab,
    ];
  }
  throw unsupported("click", args.join(" ") || "(empty)");
}

function translateType(args: string[]): string[] {
  const parsed = parseCommandArgs("type", args, {
    valueFlags: ["--ref", "--selector", "--tab-id"],
    boolFlags: ["--submit", "--clear", NO_SCREENSHOT_FLAG],
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
  out.push(...passthroughValues(parsed, ["--tab-id"]), ...noScreenshot(parsed));
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
  const parsed = parseCommandArgs("select", args, {
    valueFlags: ["--by", "--tab-id"],
    boolFlags: [NO_SCREENSHOT_FLAG],
  });
  const target = requiredPositional("select", parsed, 0, "ref or selector");
  const values = parsed.positionals.slice(1);
  if (values.length === 0) {
    throw unsupported("select", "missing value");
  }
  return [
    "select",
    target,
    ...values,
    ...passthroughValues(parsed, ["--by", "--tab-id"]),
    ...noScreenshot(parsed),
  ];
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
    boolFlags: [NO_SCREENSHOT_FLAG],
    maxPositionals: 1,
  });
  if (parsed.positionals.length === 0 && !parsed.values["--file"]) {
    throw unsupported("js", "missing code or --file");
  }
  return [
    "js",
    ...parsed.positionals,
    ...passthroughValues(parsed, ["--file", "--options", "--tab-id"]),
    ...noScreenshot(parsed),
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
    valueFlags: ["--index", "--name", "--selector", "--tab-id"],
    maxPositionals: 0,
  });
  if (parsed.values["--index"] !== undefined) {
    numeric("frame.switch", parsed.values["--index"], "--index");
  }
  return [
    "frame.switch",
    ...passthroughValues(parsed, ["--index", "--name", "--selector", "--tab-id"]),
  ];
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
  // Upstream surf's flags only: the fork's --structure/--full-page/--nodes left the runtime on
  // 2026-09-27 (workstation AK6068); the a11y channel reads over CDP (AK #6032).
  const boolFlags = ["--compact", "--no-text", "--all"];
  const parsed = parseCommandArgs("page.read", args, {
    valueFlags: ["--depth", "--max-bytes", "--tab-id"],
    boolFlags,
    maxPositionals: 0,
  });
  if (parsed.values["--depth"] !== undefined) {
    numeric("page.read", parsed.values["--depth"], "--depth");
  }
  return [
    "page.read",
    ...passthroughValues(parsed, ["--depth", "--max-bytes", "--tab-id"]),
    ...passthroughFlags(parsed, boolFlags),
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
    case "page.read":
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
    case "frame.main": {
      // `--tab-id` is a global surf option; the frame context it restores is per tab.
      const parsed = parseCommandArgs(command, args, {
        valueFlags: ["--tab-id"],
        maxPositionals: 0,
      });
      return [command, ...passthroughValues(parsed, ["--tab-id"])];
    }
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
