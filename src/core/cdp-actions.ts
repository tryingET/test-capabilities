/**
 * Actions over the owned tab's CDP binding (AK #6099/#6126; cdp-channel-program.md).
 * Elements must be actionable; targets are refs, selectors or freshly resolved role/name pairs.
 * Frames are addressed by label/URL/id, with isolated-world reads and native pointer input.
 * Dialogs are answered by policy. The optional per-RPC guard fences async continuations too.
 * This mutating entry point creates/navigates/closes no page; its caller owns socket teardown.
 */

import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { type AxFrameTree, type AxRendering, renderAxForest } from "./a11y-ax-tree.js";
import {
  bindOwnedTarget,
  boundTarget,
  CdpConnection,
  closeCdpAfterFailure,
  listCdpTargets,
  probeCdpBrowser,
  readAxForest,
  releaseForest,
  resolveCdpEndpoint,
} from "./a11y-cdp.js";
import {
  type ActionableElement,
  callAtPoint,
  callOn,
  closedShadowReached,
  type ElementCall,
  type ElementLookup,
  type ElementState,
  type Needs,
  release,
  STATE_FUNCTION,
  waitForActionable,
} from "./cdp-actionability.js";
import { cdpCloseOnce } from "./cdp-close.js";
import { type CdpDialogRecord, watchDialogs } from "./cdp-dialogs.js";
import {
  assertDocument,
  CANCEL_CLICK,
  CONNECTED,
  DOCUMENT,
  FOCUS_KEPT,
  SELECT_ALL,
  SELECT_OPTION,
  UNCANCEL_CLICK,
} from "./cdp-element-functions.js";
import { characterKey, type KeyDefinition, MODIFIER_BITS, parseChord } from "./cdp-keys.js";
import { frameByName, frameWorlds, type WorldFrame } from "./cdp-worlds.js";
import { FrameworkError } from "./runtime-contract.js";
import { isShadowPath, shadowQueryExpression } from "./shadow-path.js";

/** An a11y ref from this view, a CSS selector in a frame, or a role and name found afresh. */
export type CdpActionTarget =
  | { ref: string }
  | { selector: string; frame?: string }
  | { role: string; name: string; frame?: string };

export interface CdpActionOptions {
  /** how long an action waits for its element to become actionable (default 5000) */
  timeoutMs?: number;
  /**
   * The documents the element may be in, by URL (the fragment ignored). Read from the element's
   * own document once it is actionable, immediately before any input: a frame that swapped its
   * document keeps its selectors, and an element there is not the one the caller meant.
   */
  documents?: readonly string[];
  /** Keep the fragment too when guarding a freshly bound per-run document (AK #6162). */
  exactDocuments?: boolean;
  /**
   * A check on the actionable element, after the document check and before any input, focus
   * included (a flow's guards, AK #6164).
   */
  before?: (probe: ElementProbe) => Promise<void>;
  /**
   * A check between a pointer's press and its release (a mousedown handler can change what the
   * release completes): throwing cancels the click - released outside the viewport - and raises.
   */
  afterPress?: () => Promise<void>;
  /** a check once a pointer's release went out: throwing raises (the input was sent) */
  afterRelease?: () => Promise<void>;
}

/** What a check before input may ask about the element an act is about to take. */
export interface ElementProbe {
  /** run a function on the element */
  call<T>(fn: string, args?: unknown[]): Promise<T>;
  /** run it on what the input reaches: the node a pointer at the element's point hits, else the element */
  reached<T>(fn: string, args?: unknown[]): Promise<T>;
  /** whether a closed shadow root hosts anything on a pointer's path (false for other input) */
  closedShadow(): Promise<boolean>;
}

export interface CdpClickOptions extends CdpActionOptions {
  button?: "left" | "right" | "middle";
  /** held during the click: `Alt`, `Control`, `Meta`, `Shift` */
  modifiers?: string[];
}

export type { CdpDialogRecord } from "./cdp-dialogs.js";

export interface CdpActionsOpenOptions extends CdpActionOptions {
  onDisconnect?: (error: Error) => void;
  beforeSend?: () => void;
  /** Separate finite budgets for close preparation and the native socket close (default 1000). */
  closeTimeoutMs?: number;
  /** what to do with an alert, confirm or prompt an action opens (default `dismiss`) */
  dialogs?: "dismiss" | "accept" | "fail";
  /** the text a prompt is accepted with under `dialogs: "accept"` */
  promptText?: string;
  /**
   * Bind by the owned tab's pinned target id, which survives navigation (2026-09-27).
   */
  targetId?: string;
}

export interface CdpActions {
  /** the id of the page target these actions are bound to */
  readonly targetId: string;
  /** the refs of the latest snapshot, `{ role, name }` each */
  readonly refs: Record<string, { role: string; name: string }>;
  /** every frame by label (`f1`...), with its URL - out-of-process and same-process */
  readonly frames: Record<string, string>;
  /** the dialogs actions opened, and how each was answered */
  readonly dialogs: readonly CdpDialogRecord[];
  click(target: CdpActionTarget, options?: CdpClickOptions): Promise<void>;
  dblclick(target: CdpActionTarget, options?: CdpClickOptions): Promise<void>;
  hover(target: CdpActionTarget, options?: CdpActionOptions): Promise<void>;
  fill(target: CdpActionTarget, text: string, options?: CdpActionOptions): Promise<void>;
  type(target: CdpActionTarget, text: string, options?: CdpActionOptions): Promise<void>;
  press(key: string, options?: CdpActionOptions & { target?: CdpActionTarget }): Promise<void>;
  check(target: CdpActionTarget, options?: CdpActionOptions): Promise<void>;
  uncheck(target: CdpActionTarget, options?: CdpActionOptions): Promise<void>;
  select(target: CdpActionTarget, value: string, options?: CdpActionOptions): Promise<void>;
  setFiles(target: CdpActionTarget, files: string[], options?: CdpActionOptions): Promise<void>;
  /** Reads may opt into context recovery; arbitrary scripts never replay by default. */
  evaluate<T = unknown>(
    expression: string,
    frame?: string | { frame?: string; world?: "page" | "isolated" },
    effect?: "read_only" | "mutating",
  ): Promise<T>;
  /**
   * The CDP frame id of a frame named by label, URL or id. It stays the frame's id while the
   * frame lives, across its own navigations, so a caller can pin a frame it found by URL.
   */
  frameId(frame?: string, match?: "origin_path"): Promise<string>;
  /** read the page again: refs and frames as they are now */
  refresh(): Promise<void>;
  close(): Promise<void>;
}

interface FrameEntry extends WorldFrame {
  label: string;
}

const WORLD = "test-capabilities";
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const DEFAULT_TIMEOUT_MS = 5000;
const STATE_SETTLE_MS = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bind the owned tab at `href`, read its page (refs and frames), and return actions on it. The
 * caller closes it: frame cleanup and native socket completion each have a finite budget.
 */
export async function openCdpActions(
  href: string,
  env: NodeJS.ProcessEnv = process.env,
  options: CdpActionsOpenOptions = {},
): Promise<CdpActions> {
  const endpoint = resolveCdpEndpoint(env);
  options.beforeSend?.();
  await probeCdpBrowser(endpoint);
  options.beforeSend?.();
  const targets = await listCdpTargets(endpoint);
  const target =
    options.targetId === undefined
      ? bindOwnedTarget(targets, href)
      : boundTarget(targets, options.targetId, href);
  const connection = await CdpConnection.open(
    target.webSocketDebuggerUrl as string,
    options.beforeSend,
  );
  if (options.onDisconnect) connection.onDisconnect(options.onDisconnect);
  const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let rendering: AxRendering = {
    snapshot: "",
    refs: {},
    handles: {},
    frames: 0,
    unreadableFrames: [],
  };
  let frames: FrameEntry[] = [];
  let sessions: Record<string, string | undefined> = {};
  const read = async () => {
    const forest = await readAxForest(connection);
    sessions = forest.sessions;
    rendering = renderAxForest(forest.forest);
    // a page target's id is its main frame's id (measured live 2026-09-27, across same- and
    // cross-site navigation), so the page is addressable by it even with no iframe to walk
    frames = forest.forest.map((tree: AxFrameTree) => ({
      label: tree.frame,
      url: tree.url,
      frameId: tree.frameId ?? (tree.frame === "main" ? target.id : undefined),
      sessionId: forest.sessions[tree.frame],
    }));
  };
  try {
    await read();
  } catch (error) {
    // no actions object reaches the caller, so nothing else would close this socket
    await closeCdpAfterFailure(() => connection.closeAndWait(options.closeTimeoutMs), error);
    throw error;
  }

  // dialogs: every session that hosts a frame reports them; each is answered by the policy
  const dialogWatch = watchDialogs(connection, options.dialogs ?? "dismiss", options.promptText);
  const enabledPages = new Set<string>();
  const enablePages = async () => {
    for (const sessionId of new Set(frames.map((frame) => frame.sessionId))) {
      const key = sessionId ?? "page";
      if (enabledPages.has(key)) continue;
      enabledPages.add(key);
      await connection.send("Page.enable", {}, sessionId).catch(() => undefined);
    }
  };
  await enablePages();

  // a frame by label (`main`, `f1`...), URL or CDP frame id
  const frameOf = (name = "main", match?: "origin_path"): FrameEntry =>
    frameByName(frames, name, match);

  const { frameIdOf, worldOf, pageWorldOf, inContext, inWorld } = frameWorlds(connection, WORLD);

  const describe = (actionTarget: CdpActionTarget): string =>
    "ref" in actionTarget
      ? actionTarget.ref
      : "selector" in actionTarget
        ? actionTarget.selector
        : `${actionTarget.role} "${actionTarget.name}"`;

  const byHandle = async (ref: string): Promise<ElementLookup> => {
    const handle = rendering.handles[ref];
    const frame = handle ? frames.find((entry) => entry.label === handle.frame) : undefined;
    if (!handle || !frame) {
      return {
        missing: new FrameworkError(
          "action_target_not_found",
          `${ref} has no element in this snapshot`,
          { ref },
        ),
      };
    }
    try {
      return await inWorld(frame, async (contextId): Promise<ElementLookup> => {
        const { object } = await connection.send<{ object: { objectId: string } }>(
          "DOM.resolveNode",
          { backendNodeId: handle.backendNodeId, executionContextId: contextId },
          frame.sessionId,
        );
        const resolved = { objectId: object.objectId, sessionId: frame.sessionId, contextId };
        // Chromium still resolves a removed node while something holds it: detached is gone
        if (await callOn<boolean>(connection, resolved, CONNECTED)) return { resolved };
        await release(connection, resolved);
        throw new Error("detached");
      });
    } catch {
      return {
        missing: new FrameworkError(
          "ref_context_drift",
          `the element ${ref} named is gone; target it by role and name, or read the page again`,
          { ref },
        ),
      };
    }
  };

  const bySelector = (selector: string, name: string | undefined): Promise<ElementLookup> => {
    const frame = frameOf(name);
    const where = { selector, frame: name ?? "main" };
    return inWorld(frame, async (contextId) => {
      // a shadow path needs exactly one element at every segment (AK #6163)
      const expression = isShadowPath(selector)
        ? shadowQueryExpression(selector)
        : `document.querySelector(${JSON.stringify(selector)})`;
      const { result } = await connection.send<{ result: { objectId?: string; value?: unknown } }>(
        "Runtime.evaluate",
        { expression, contextId },
        frame.sessionId,
      );
      if (result.objectId) {
        return { resolved: { objectId: result.objectId, sessionId: frame.sessionId, contextId } };
      }
      if (typeof result.value === "number" && result.value > 1) {
        throw new FrameworkError(
          "action_target_ambiguous",
          `${result.value} elements match ${selector} in ${name ?? "the page"}; none was guessed`,
          { ...where, matches: result.value },
        );
      }
      return {
        missing: new FrameworkError(
          "action_target_not_found",
          `no element matches ${selector} in ${name ?? "the page"}`,
          where,
        ),
      };
    });
  };

  const byRoleAndName = async (role: string, name: string, frameName?: string) => {
    await read();
    await enablePages();
    const wanted = frameName ? frameOf(frameName).label : undefined;
    const matches = Object.entries(rendering.refs)
      .filter(
        ([ref, entry]) =>
          entry.role === role &&
          entry.name === name &&
          (!wanted || rendering.handles[ref]?.frame === wanted),
      )
      .map(([ref]) => ref);
    if (matches.length === 1) return byHandle(matches[0] as string);
    const label = `${role} "${name}"`;
    return {
      missing:
        matches.length === 0
          ? new FrameworkError("action_target_not_found", `no ${label} on the page`, { role, name })
          : new FrameworkError(
              "action_target_ambiguous",
              `${matches.length} controls are ${label}: ${matches.join(", ")}; none was guessed`,
              { candidates: matches },
            ),
    };
  };

  const lookupOf = (actionTarget: CdpActionTarget) => async (): Promise<ElementLookup> =>
    "ref" in actionTarget
      ? byHandle(actionTarget.ref)
      : "selector" in actionTarget
        ? bySelector(actionTarget.selector, actionTarget.frame)
        : byRoleAndName(actionTarget.role, actionTarget.name, actionTarget.frame);

  const actionable = (
    actionTarget: CdpActionTarget,
    needs: Needs & { hit?: boolean },
    timeoutMs: number | undefined,
  ) =>
    waitForActionable(
      connection,
      lookupOf(actionTarget),
      needs,
      timeoutMs ?? defaultTimeout,
      describe(actionTarget),
    );

  const key = (
    type: "keyDown" | "keyUp",
    definition: KeyDefinition,
    modifiers: number,
    sessionId?: string,
  ) =>
    connection.send(
      "Input.dispatchKeyEvent",
      {
        type: type === "keyDown" && !definition.text ? "rawKeyDown" : type,
        key: definition.key,
        code: definition.code,
        windowsVirtualKeyCode: definition.keyCode,
        modifiers,
        ...(type === "keyDown" && definition.text ? { text: definition.text } : {}),
      },
      sessionId,
    );

  const pointer = async (
    element: ActionableElement,
    clickCount: number,
    options: CdpClickOptions,
  ) => {
    // Input goes to the session that hosts the element, at its point in that session's own
    // coordinates. Page-level input into an out-of-process frame is routed by hit-test data a
    // window that paints no frames does not have: measured live 2026-09-27 on an unseen
    // workspace, 4 of 10 page-level clicks landed on the host's <iframe>, 10 of 10 sent on the
    // frame's own session landed on the element.
    const { sessionId } = element.resolved;
    const at = element.point;
    const send = (type: string, extra: Record<string, unknown>) =>
      connection.send("Input.dispatchMouseEvent", { type, ...at, ...extra }, sessionId);
    const chord = parseChord([...(options.modifiers ?? []), "a"].join("+"));
    let held = 0;
    for (const modifier of chord.modifiers) {
      held |= MODIFIER_BITS[modifier.key] ?? 0;
      await key("keyDown", modifier, held, sessionId);
    }
    // A move is aligned to the next animation frame; in a window that paints no frames its ack
    // takes ~1 s, while the press that follows flushes it at once with the event order intact
    // (measured live 2026-09-27: 974 ms awaited, 1-2 ms not). So a click does not wait for it.
    const moved = send("mouseMoved", { modifiers: chord.mask });
    const button = options.button ?? "left";
    try {
      for (let count = 1; count <= clickCount; count++) {
        const click = { button, clickCount: count, modifiers: chord.mask };
        await send("mousePressed", click);
        await dialogWatch.settled();
        const refused = dialogWatch.failing()
          ? undefined
          : await options.afterPress?.().then(
              () => undefined,
              (error: unknown) => error ?? new Error("refused"),
            );
        // A mousedown dialog, or a press that changed what the release would complete, must not be
        // followed by a release on the control: release outside the viewport to clear held input.
        const cancel = dialogWatch.failing() || refused;
        const cancelling = (fn: string) => callOn(connection, element.resolved, fn).catch(() => 0);
        if (cancel) await cancelling(CANCEL_CLICK);
        await send("mouseReleased", cancel ? { ...click, x: -1, y: -1 } : click);
        if (cancel) await cancelling(UNCANCEL_CLICK);
        if (refused) throw refused;
        if (cancel) break;
        await options.afterRelease?.();
      }
    } finally {
      await moved;
      for (const modifier of [...chord.modifiers].reverse()) {
        await key("keyUp", modifier, 0, sessionId);
      }
    }
  };

  // every action ends here: releases its element, and raises a dialog the `fail` policy caught
  const settle = async (element: ActionableElement | undefined) => {
    if (element) await release(connection, element.resolved);
    await dialogWatch.settled();
    const opened = dialogWatch.takeFailing();
    if (opened) {
      throw new FrameworkError(
        "action_dialog_opened",
        `the action opened a ${opened.type}; answer: ${opened.answer}`,
        { ...opened },
      );
    }
  };

  type Call = ElementCall;
  // on the actionable element, before any input: its document, then the caller's own check
  const guard = async (
    element: ActionableElement,
    actionTarget: CdpActionTarget,
    options: CdpActionOptions | undefined,
    reached?: Call,
  ) => {
    if (options?.documents) {
      const href = await callOn<string>(connection, element.resolved, DOCUMENT);
      assertDocument(
        href,
        options.documents,
        `nothing was sent to ${describe(actionTarget)}`,
        options.exactDocuments,
      );
    }
    const call: Call = (fn, args) => callOn(connection, element.resolved, fn, args);
    const closedShadow = async () => (reached ? closedShadowReached(connection, element) : false);
    await options?.before?.({ call, reached: reached ?? call, closedShadow });
  };

  const act = async (
    actionTarget: CdpActionTarget,
    needs: Needs & { hit?: boolean },
    options: CdpActionOptions | undefined,
    body: (element: ActionableElement) => Promise<void>,
  ) => {
    const element = await actionable(actionTarget, needs, options?.timeoutMs);
    try {
      const reached = needs.hit === false ? undefined : callAtPoint(connection, element);
      await guard(element, actionTarget, options, reached);
      await body(element);
    } finally {
      await settle(element);
    }
  };

  const setChecked = (actionTarget: CdpActionTarget, wanted: boolean, options?: CdpActionOptions) =>
    act(actionTarget, { enabled: true }, options, async (element) => {
      if (element.state.checked === null) {
        throw new FrameworkError(
          "action_target_unsuitable",
          `${describe(actionTarget)} is not a checkbox or radio button`,
          { tag: element.state.tag },
        );
      }
      if (element.state.checked === wanted) return;
      await pointer(element, 1, {
        afterPress: options?.afterPress,
        afterRelease: options?.afterRelease,
      });
      const deadline = Date.now() + STATE_SETTLE_MS;
      for (;;) {
        const state = await callOn<ElementState>(connection, element.resolved, STATE_FUNCTION);
        if (state.checked === wanted) return;
        if (Date.now() >= deadline) break;
        await sleep(50);
      }
      throw new FrameworkError(
        "action_state_unchanged",
        `${describe(actionTarget)} was clicked and is still ${wanted ? "unchecked" : "checked"}`,
        { wanted },
      );
    });

  const focusOn = async (element: ActionableElement) => {
    await connection
      .send("DOM.focus", { objectId: element.resolved.objectId }, element.resolved.sessionId)
      .catch((error: unknown) => {
        // Chromium refuses an element that takes no focus, and focus did not move: nothing sent
        if (!/not focusable/.test(errorText(error))) throw error;
        throw new FrameworkError(
          "action_target_unsuitable",
          "it takes no focus; nothing was sent",
          {},
        );
      });
    await settle(undefined);
    await assertFocusKept(element);
  };
  // text and keys go where focus is: one a handler moved elsewhere is not the element's
  const assertFocusKept = async (element: ActionableElement) => {
    if (!(await callOn<boolean>(connection, element.resolved, FOCUS_KEPT))) {
      throw new FrameworkError("action_focus_moved", "focus left the element once focused", {});
    }
  };
  const close = cdpCloseOnce(
    connection,
    async () => {
      dialogWatch.off();
      await dialogWatch.settled();
      await releaseForest(connection, sessions);
    },
    options.closeTimeoutMs,
  );
  return {
    targetId: target.id,
    get refs() {
      return rendering.refs;
    },
    get frames() {
      return Object.fromEntries(
        frames.filter((frame) => frame.label !== "main").map((frame) => [frame.label, frame.url]),
      );
    },
    dialogs: dialogWatch.records,
    click: (actionTarget, options = {}) =>
      act(actionTarget, { enabled: true }, options, (element) => pointer(element, 1, options)),
    dblclick: (actionTarget, options = {}) =>
      act(actionTarget, { enabled: true }, options, (element) => pointer(element, 2, options)),
    hover: (actionTarget, options = {}) =>
      act(actionTarget, {}, options, (element) => pointer(element, 0, {})),
    fill: (actionTarget, text, options) =>
      act(actionTarget, { editable: true, hit: false }, options, async (element) => {
        await focusOn(element);
        await callOn(connection, element.resolved, SELECT_ALL);
        await settle(undefined);
        // a select handler may move focus too: checked again just before the text goes out
        await assertFocusKept(element);
        if (text === "") {
          const erase = parseChord("Delete").key;
          await key("keyDown", erase, 0);
          await key("keyUp", erase, 0);
        } else {
          await connection.send("Input.insertText", { text });
        }
      }),
    type: (actionTarget, text, options) =>
      act(actionTarget, { editable: true, hit: false }, options, async (element) => {
        await focusOn(element);
        for (const character of text) {
          const definition = characterKey(character);
          await key("keyDown", definition, 0);
          await key("keyUp", definition, 0);
        }
      }),
    async press(chordText, options = {}) {
      const chord = parseChord(chordText);
      let element: ActionableElement | undefined;
      try {
        if (options.target) {
          element = await actionable(options.target, { hit: false }, options.timeoutMs);
          await guard(element, options.target, options);
          await focusOn(element);
        }
        let held = 0;
        try {
          for (const modifier of chord.modifiers) {
            held |= MODIFIER_BITS[modifier.key] ?? 0;
            await key("keyDown", modifier, held);
            // a modifier's keydown handler may move focus: checked before anything more is sent
            if (element) await assertFocusKept(element);
          }
          await key("keyDown", chord.key, chord.mask);
          await key("keyUp", chord.key, chord.mask);
          await options.afterRelease?.();
        } finally {
          for (const modifier of [...chord.modifiers].reverse()) await key("keyUp", modifier, 0);
        }
      } finally {
        await settle(element);
      }
    },
    check: (actionTarget, options) => setChecked(actionTarget, true, options),
    uncheck: (actionTarget, options) => setChecked(actionTarget, false, options),
    select: (actionTarget, value, options) =>
      act(actionTarget, { enabled: true, hit: false }, options, async (element) => {
        if (element.state.tag !== "SELECT") {
          throw new FrameworkError(
            "action_target_unsuitable",
            `${describe(actionTarget)} is not a select element`,
            { tag: element.state.tag },
          );
        }
        if (!(await callOn<boolean>(connection, element.resolved, SELECT_OPTION, [value]))) {
          throw new FrameworkError(
            "action_option_not_found",
            `${describe(actionTarget)} offers no option with the value or label '${value}'`,
            { value },
          );
        }
      }),
    async setFiles(actionTarget, files, options) {
      const paths = files.map((file) => resolvePath(file));
      const absent = paths.filter((file) => !existsSync(file));
      if (absent.length > 0) {
        throw new FrameworkError(
          "action_file_missing",
          `no such file: ${absent.join(", ")}; nothing was set`,
          { files: absent },
        );
      }
      await act(actionTarget, { enabled: true, hit: false }, options, async (element) => {
        if (element.state.tag !== "INPUT" || element.state.type !== "file") {
          throw new FrameworkError(
            "action_target_unsuitable",
            `${describe(actionTarget)} is not a file input`,
            { tag: element.state.tag, type: element.state.type },
          );
        }
        await connection.send(
          "DOM.setFileInputFiles",
          { files: paths, objectId: element.resolved.objectId },
          element.resolved.sessionId,
        );
      });
    },
    async evaluate<T>(
      expression: string,
      where?: string | { frame?: string; world?: "page" | "isolated" },
      effect: "read_only" | "mutating" = "mutating",
    ): Promise<T> {
      const { frame: name, world = "page" } =
        typeof where === "string" ? { frame: where } : (where ?? {});
      const frame = frameOf(name);
      const run = (contextId: number) =>
        connection.send<{
          result: { value?: T };
          exceptionDetails?: { text?: string; exception?: { description?: string } };
        }>(
          "Runtime.evaluate",
          {
            expression,
            returnByValue: true,
            awaitPromise: true,
            contextId,
          },
          frame.sessionId,
        );
      const { result, exceptionDetails } = await inContext(
        world === "isolated" ? worldOf : pageWorldOf,
        frame,
        run,
        effect,
      );
      if (exceptionDetails) {
        throw new FrameworkError(
          "action_evaluate_failed",
          `the expression threw in ${name ?? "the page"}: ${exceptionDetails.exception?.description ?? exceptionDetails.text ?? "unknown error"}`,
          { frame: name ?? "main" },
        );
      }
      return result.value as T;
    },
    frameId(name?: string, match?: "origin_path") {
      return frameIdOf(frameOf(name, match));
    },
    async refresh() {
      await read();
      await enablePages();
    },
    close,
  };
}
