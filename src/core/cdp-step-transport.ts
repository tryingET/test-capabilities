/**
 * A session step that runs in a frame (CDP program S4, AK #6132; design
 * `docs/project/2026-09-27-cdp-channel-program.md`).
 *
 * `BrowserStep.frame` names a frame; `SurfSession` then runs that one step here instead of on
 * surf, inside the same ledger step - so its declaration, idempotency key, receipt, settlement
 * and `verify` are exactly a surf step's. surf cannot do these in a frame: it refuses `js` in a
 * selected frame (upstream #323/#324), and its `type`/`select`/`click` address the top document.
 *
 * The arguments are the surf command's own, so a caller does not change shape: `js <code>`,
 * `type <text> --selector <css>`, `select <css> <value>`, `click --selector <css>`. A `read_only`
 * script reads in the frame's isolated world; a `mutating` one runs in the page's own world.
 * The reply's source is `cdp`, never `surf`. A refusal raised before any input reached the page
 * is a definite failure; anything after input was sent is `mutation_outcome_unknown`, which the
 * ledger settles `unknown` and never repeats.
 */

import type { SessionReply } from "./browser-session.js";
import type { CdpActions } from "./cdp-actions.js";
import { openCdpActions } from "./cdp-actions.js";
import { classifyResult } from "./result-classification.js";
import { FrameworkError, isFrameworkError } from "./runtime-contract.js";

/** The commands a step may run in a frame. */
export const FRAME_STEP_COMMANDS: ReadonlySet<string> = new Set(["js", "type", "select", "click"]);

/** One step to run in a frame: the surf command and its arguments, the frame, the declared effect. */
export interface FrameStep {
  command: string;
  args: readonly string[];
  /** a frame by URL, label or CDP frame id, as `openCdpActions` names them */
  frame: string;
  effect: "read_only" | "mutating";
}

/** Refusals that happen before anything reaches the page: a mutating step that got one did nothing. */
const BEFORE_INPUT = new Set([
  "action_target_not_found",
  "action_target_not_ready",
  "action_target_obscured",
  "action_target_ambiguous",
  "action_target_unsuitable",
  "action_frame_unknown",
  "action_option_not_found",
  "action_frame_step_unsupported",
  "ref_context_drift",
  "cdp_endpoint_refused",
  "cdp_endpoint_unreachable",
  "cdp_endpoint_not_chromium",
  "tab_bind_ambiguous",
]);

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

/** The positional arguments of a surf-shaped argv: every word that is not a flag or its value. */
function positionals(args: readonly string[]): string[] {
  const words: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const word = args[index] as string;
    if (word === "--selector" || word === "--tab-id" || word === "--into") {
      index++;
      continue;
    }
    if (!word.startsWith("--")) words.push(word);
  }
  return words;
}

function unsupported(command: string, why: string): FrameworkError {
  return new FrameworkError(
    "action_frame_step_unsupported",
    `A step on '${command}' cannot run in a frame: ${why}. Only js, type, select and click do.`,
    { command },
  );
}

async function act(
  actions: CdpActions,
  command: string,
  args: readonly string[],
  frame: string,
  effect: "read_only" | "mutating",
): Promise<unknown> {
  const words = positionals(args);
  if (command === "js") {
    const code = words[0];
    if (code === undefined) throw unsupported(command, "there is no script");
    return actions.evaluate(code, { frame, world: effect === "read_only" ? "isolated" : "page" });
  }
  const selector = valueAfter(args, "--selector") ?? valueAfter(args, "--into");
  if (command === "type") {
    if (selector === undefined || words[0] === undefined) {
      throw unsupported(command, "it needs the text and --selector");
    }
    await actions.fill({ selector, frame }, words[0]);
    return "OK";
  }
  if (command === "select") {
    const [target, value] = words;
    if (target === undefined || value === undefined) {
      throw unsupported(command, "it needs a selector and a value");
    }
    await actions.select({ selector: target, frame }, value);
    return `Selected: ${value}`;
  }
  // click: the only command left once `assertFrameStepCommand` has passed
  if (selector === undefined) throw unsupported(command, "it needs --selector");
  await actions.click({ selector, frame });
  return "OK";
}

/** Refuse, before anything runs, a step whose command has no frame form. */
export function assertFrameStepCommand(command: string): void {
  if (!FRAME_STEP_COMMANDS.has(command)) {
    throw unsupported(command, "the command has no frame form");
  }
}

/**
 * Run one surf-shaped step in `frame` of the owned tab at `href`, and answer the way the session's
 * `read` expects: a `{ result, target }` envelope on stdout, classified with source `cdp`.
 */
export async function runStepInFrame(
  href: string,
  env: NodeJS.ProcessEnv,
  step: FrameStep,
): Promise<SessionReply> {
  const { command, args, frame, effect } = step;
  const started = Date.now();
  const actions = await openCdpActions(href, env);
  let value: unknown;
  try {
    value = await act(actions, command, args, frame, effect);
  } catch (error) {
    if (effect === "read_only" || (isFrameworkError(error) && BEFORE_INPUT.has(error.code))) {
      throw error;
    }
    throw new FrameworkError(
      "mutation_outcome_unknown",
      `${command} in frame ${frame} was sent and then failed (${error instanceof Error ? error.message : String(error)}); whether it took effect is unknown.`,
      { command, frame },
    );
  } finally {
    await actions.close();
  }
  const stdout = JSON.stringify({ result: value ?? null, target: { frame, channel: "cdp" } });
  const outcome = classifyResult({
    source: "cdp",
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: Date.now() - started,
  });
  return {
    command,
    args,
    display: ["cdp", command, `frame=${frame}`],
    stdout,
    stderr: "",
    exitCode: 0,
    outcome,
    ok: true,
  } as SessionReply;
}
