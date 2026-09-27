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
import { assertDocument, openCdpActions } from "./cdp-actions.js";
import { classifyResult } from "./result-classification.js";
import { FrameworkError, isFrameworkError } from "./runtime-contract.js";

/** The commands a step may run in a frame. */
export const FRAME_STEP_COMMANDS: ReadonlySet<string> = new Set(["js", "type", "select", "click"]);

/**
 * A frame, by URL, label or CDP frame id as `openCdpActions` names them - optionally with the
 * documents it must hold when an element in it is acted on (`CdpActionOptions.documents`).
 */
export type StepFrame = string | { name: string; documents: readonly string[] };

/** One step to run in a frame: the surf command and its arguments, the frame, the declared effect. */
export interface FrameStep {
  command: string;
  args: readonly string[];
  frame: StepFrame;
  effect: "read_only" | "mutating";
}

/** The name a step addresses its frame by. */
export const frameName = (frame: StepFrame): string =>
  typeof frame === "string" ? frame : frame.name;

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
  "action_document_changed",
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

function unsupported(command: string, why: string): FrameworkError {
  return new FrameworkError(
    "action_frame_step_unsupported",
    `A step on '${command}' cannot run in a frame: ${why}. Only js, type, select and click do.`,
    { command },
  );
}

/**
 * Run the command. Its argv is surf's documented shape, read by position - `js <code>`,
 * `type <text> --selector <css>`, `select <css> <value>`, `click --selector <css>` - and flags
 * are looked up only after the positional words: a value that reads as a flag (`--into`,
 * `--help`) is a value, never a flag, and never makes another word the value.
 */
async function act(
  actions: CdpActions,
  command: string,
  args: readonly string[],
  frame: string,
  step: { effect: "read_only" | "mutating"; documents?: readonly string[] },
): Promise<unknown> {
  const options = step.documents ? { documents: step.documents } : {};
  const flag = (after: number) =>
    valueAfter(args.slice(after), "--selector") ?? valueAfter(args.slice(after), "--into");
  if (command === "js") {
    const [code] = args;
    if (code === undefined) throw unsupported(command, "there is no script");
    const world = step.effect === "read_only" ? "isolated" : "page";
    if (step.documents) {
      // read before the script runs: a frame whose document cannot be read ran nothing
      const href = await actions
        .evaluate<string>("location.href", { frame, world: "isolated" })
        .catch((error: unknown) => {
          throw new FrameworkError(
            "action_document_changed",
            `the frame's document could not be read (${error instanceof Error ? error.message : String(error)}); the script was not run`,
            { frame },
          );
        });
      assertDocument(href, step.documents, "the script was not run");
    }
    return actions.evaluate(code, { frame, world });
  }
  if (command === "type") {
    const [text] = args;
    const selector = flag(1);
    if (selector === undefined || text === undefined) {
      throw unsupported(command, "it needs the text and --selector");
    }
    await actions.fill({ selector, frame }, text, options);
    return "OK";
  }
  if (command === "select") {
    const [target, value] = args;
    if (target === undefined || value === undefined) {
      throw unsupported(command, "it needs a selector and a value");
    }
    await actions.select({ selector: target, frame }, value, options);
    return `Selected: ${value}`;
  }
  // click: the only command left once `frameAwareDeclaration` has passed
  const selector = flag(0);
  if (selector === undefined) throw unsupported(command, "it needs --selector");
  await actions.click({ selector, frame }, options);
  return "OK";
}

/**
 * The declaration of a session step, for a step that names a frame: a command with no frame
 * form is refused before anything is declared or run, and the declaration says where the step
 * runs - surf never runs it, and the class map's reasons name surf - so its receipt's evidence
 * names the frame and the channel. A step without a frame keeps its declaration as it is.
 */
export function frameAwareDeclaration<D extends { reason: string }>(
  step: { command: string; frame?: StepFrame },
  declare: () => D,
): D {
  if (step.frame === undefined) return declare();
  if (!FRAME_STEP_COMMANDS.has(step.command)) {
    throw unsupported(step.command, "the command has no frame form");
  }
  const declaration = declare();
  const reason = declaration.reason.replace(/^surf /, "");
  return {
    ...declaration,
    reason: `${reason}, in frame ${frameName(step.frame)} over the DevTools connection`,
  };
}

/** Each session's pinned frames: the name a caller used, to the CDP frame id it first reached. */
const pinsBySession = new WeakMap<object, Map<string, string>>();

/**
 * The frame a step addresses. A name is pinned to the frame id it first resolves to, for the
 * life of the session: a frame that navigates (a submit, a redirect) is still the frame the
 * caller meant, and a URL is never matched again against whatever frame holds it later.
 */
async function pinnedFrame(actions: CdpActions, pins: Map<string, string>, frame: string) {
  const pinned = pins.get(frame);
  if (pinned === undefined) {
    const frameId = await actions.frameId(frame);
    pins.set(frame, frameId);
    return frameId;
  }
  try {
    return await actions.frameId(pinned);
  } catch (error) {
    if (!isFrameworkError(error) || error.code !== "action_frame_unknown") throw error;
    throw new FrameworkError(
      "action_frame_unknown",
      `frame ${frame} is gone: this session pinned it to frame id ${pinned} when it first reached it, and the tab no longer has that frame. It is not looked up by URL again.`,
      { frame, frameId: pinned },
    );
  }
}

/**
 * Run one surf-shaped step in `frame` of `session`'s owned tab, and answer the way the session's
 * `read` expects: a `{ result, target }` envelope on stdout, classified with source `cdp`. The
 * session is the key its frame pins are kept under.
 */
export async function runStepInFrame(
  session: { readonly url: string },
  env: NodeJS.ProcessEnv,
  step: FrameStep,
): Promise<SessionReply> {
  const { command, args, effect } = step;
  const frame = frameName(step.frame);
  const documents = typeof step.frame === "string" ? undefined : step.frame.documents;
  const pins = pinsBySession.get(session) ?? new Map<string, string>();
  pinsBySession.set(session, pins);
  const started = Date.now();
  const actions = await openCdpActions(session.url, env);
  let value: unknown;
  let frameId: string | undefined;
  try {
    frameId = await pinnedFrame(actions, pins, frame);
    value = await act(actions, command, args, frameId, {
      effect,
      ...(documents ? { documents } : {}),
    });
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
  const target = { frame, frameId, channel: "cdp" };
  const stdout = JSON.stringify({ result: value ?? null, target });
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
