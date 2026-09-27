/**
 * Actions on the owned tab over our own CDP connection (AK #6099; CDP program S1, AK #6126;
 * design `docs/project/2026-09-27-cdp-channel-program.md`).
 *
 * The a11y channel binds the tab surf owns and holds one DevTools connection to it; a held
 * connection is where Playwright's speed came from. This module acts over the same binding:
 * - every action waits until its element is actionable (`cdp-actionability.ts`) and refuses with
 *   the conditions that never held;
 * - a target is an a11y ref, a CSS selector in a frame, or `{ role, name }` resolved against a
 *   fresh read of the page, so it survives navigation and re-rendering;
 * - every frame is addressable by label, URL or CDP frame id - out-of-process frames through their
 *   sessions, same-process frames in their host's session - and elements are resolved into an
 *   isolated world per frame, where the page's scripts cannot see or tamper with the reads;
 * - pointer input is real, dispatched on the session that hosts the element, in its coordinates;
 * - dialogs an action opens are answered by policy, never left blocking the page.
 * Its effect is mutating, so it is its own entry point, never part of the read-only a11y channel.
 * It creates, navigates and closes nothing.
 */

import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { type AxFrameTree, type AxRendering, renderAxForest } from "./a11y-ax-tree.js";
import {
  bindOwnedTarget,
  CdpConnection,
  listCdpTargets,
  probeCdpBrowser,
  readAxForest,
  releaseForest,
  resolveCdpEndpoint,
} from "./a11y-cdp.js";
import {
  type ActionableElement,
  callOn,
  type ElementLookup,
  type ElementState,
  type Needs,
  release,
  STATE_FUNCTION,
  waitForActionable,
} from "./cdp-actionability.js";
import { characterKey, type KeyDefinition, MODIFIER_BITS, parseChord } from "./cdp-keys.js";
import { FrameworkError } from "./runtime-contract.js";

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
}

export interface CdpClickOptions extends CdpActionOptions {
  button?: "left" | "right" | "middle";
  /** held during the click: `Alt`, `Control`, `Meta`, `Shift` */
  modifiers?: string[];
}

export interface CdpDialogRecord {
  type: string;
  message: string;
  url: string;
  answer: "accepted" | "dismissed";
}

export interface CdpActionsOpenOptions extends CdpActionOptions {
  /** what to do with an alert, confirm or prompt an action opens (default `dismiss`) */
  dialogs?: "dismiss" | "accept" | "fail";
  /** the text a prompt is accepted with under `dialogs: "accept"` */
  promptText?: string;
}

export interface CdpActions {
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
  evaluate<T = unknown>(
    expression: string,
    frame?: string | { frame?: string; world?: "page" | "isolated" },
  ): Promise<T>;
  /**
   * The CDP frame id of a frame named by label, URL or id. It stays the frame's id while the
   * frame lives, across its own navigations, so a caller can pin a frame it found by URL.
   */
  frameId(frame?: string): Promise<string>;
  /** read the page again: refs and frames as they are now */
  refresh(): Promise<void>;
  close(): Promise<void>;
}

interface FrameEntry {
  label: string;
  url: string;
  frameId: string | undefined;
  sessionId: string | undefined;
}

const SELECT_ALL =
  "function () { /* tc:select-all */ if (typeof this.select === 'function') this.select(); }";
const SELECT_OPTION = `function (wanted) { /* tc:select-option */
  const option = [...this.options].find((o) => o.value === wanted || o.label === wanted);
  if (!option) return false;
  this.value = option.value;
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}`;
const CONNECTED = "function () { /* tc:connected */ return this.isConnected; }";
const DOCUMENT = "function () { /* tc:document */ return this.ownerDocument.location.href; }";
const withoutFragment = (href: string) => href.split("#")[0];

/** Refuse, before any input, an element or a frame whose document is not one of `documents`. */
export function assertDocument(href: string, documents: readonly string[], what: string): void {
  if (!documents.map(withoutFragment).includes(withoutFragment(href))) {
    throw new FrameworkError(
      "action_document_changed",
      `the document is ${href}, not ${documents.join(" or ")}; ${what}`,
      { href, documents: [...documents] },
    );
  }
}
const WORLD = "test-capabilities";
const DEFAULT_TIMEOUT_MS = 5000;
const STATE_SETTLE_MS = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bind the owned tab at `href`, read its page (refs and frames), and return actions on it. The
 * caller closes it: frame sessions are detached and the socket is closed.
 */
export async function openCdpActions(
  href: string,
  env: NodeJS.ProcessEnv = process.env,
  options: CdpActionsOpenOptions = {},
): Promise<CdpActions> {
  const endpoint = resolveCdpEndpoint(env);
  await probeCdpBrowser(endpoint);
  const target = bindOwnedTarget(await listCdpTargets(endpoint), href);
  const connection = await CdpConnection.open(target.webSocketDebuggerUrl as string);
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
    frames = forest.forest.map((tree: AxFrameTree) => ({
      label: tree.frame,
      url: tree.url,
      frameId: tree.frameId,
      sessionId: forest.sessions[tree.frame],
    }));
  };
  await read();

  // dialogs: every session that hosts a frame reports them; each is answered by the policy
  const dialogs: CdpDialogRecord[] = [];
  let failingDialog: CdpDialogRecord | undefined;
  const policy = options.dialogs ?? "dismiss";
  const offDialogs = connection.on("Page.javascriptDialogOpening", (params, sessionId) => {
    const accept = policy === "accept";
    const record: CdpDialogRecord = {
      type: String(params.type ?? ""),
      message: String(params.message ?? ""),
      url: String(params.url ?? ""),
      answer: accept ? "accepted" : "dismissed",
    };
    dialogs.push(record);
    if (policy === "fail") failingDialog = record;
    void connection
      .send(
        "Page.handleJavaScriptDialog",
        {
          accept,
          ...(accept && options.promptText !== undefined ? { promptText: options.promptText } : {}),
        },
        sessionId,
      )
      .catch(() => undefined);
  });
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
  const frameOf = (name = "main"): FrameEntry => {
    const found =
      frames.find((frame) => frame.label === name) ??
      frames.find((frame) => frame.label !== "main" && frame.url === name) ??
      frames.find((frame) => frame.frameId === name);
    if (!found) {
      throw new FrameworkError(
        "action_frame_unknown",
        `'${name}' is not one of the owned tab's frames (${
          frames
            .filter((frame) => frame.label !== "main")
            .map((frame) => frame.url)
            .join(", ") || "none"
        })`,
        { frame: name },
      );
    }
    return found;
  };

  // one isolated world per frame; a navigation destroys it, so a stale one is made again once
  const worlds = new Map<string, number>();
  const frameIdOf = async (frame: FrameEntry): Promise<string> => {
    if (frame.frameId) return frame.frameId;
    const { frameTree } = await connection.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
      {},
      frame.sessionId,
    );
    frame.frameId = frameTree.frame.id;
    return frame.frameId;
  };
  const worldOf = async (frame: FrameEntry, fresh = false): Promise<number> => {
    const frameId = await frameIdOf(frame);
    const known = worlds.get(frameId);
    if (known !== undefined && !fresh) return known;
    const { executionContextId } = await connection.send<{ executionContextId: number }>(
      "Page.createIsolatedWorld",
      { frameId, worldName: WORLD },
      frame.sessionId,
    );
    worlds.set(frameId, executionContextId);
    return executionContextId;
  };
  // the page's own world of a frame: `Runtime.enable` reports one default context per frame of
  // the session before it answers (measured live 2026-09-27), so a same-process frame is reached
  // by its frame id rather than landing in its host's document
  const pageWorlds = new Map<string, number>();
  const pageWorldOf = async (frame: FrameEntry, fresh = false): Promise<number> => {
    const frameId = await frameIdOf(frame);
    const known = pageWorlds.get(frameId);
    if (known !== undefined && !fresh) return known;
    const found: number[] = [];
    const off = connection.on("Runtime.executionContextCreated", (params, sessionId) => {
      const context = params.context as { id: number; auxData?: Record<string, unknown> };
      if (sessionId !== frame.sessionId || context.auxData?.frameId !== frameId) return;
      if (context.auxData.isDefault === true) found.push(context.id);
    });
    try {
      await connection.send("Runtime.enable", {}, frame.sessionId);
      await connection.send("Runtime.disable", {}, frame.sessionId);
    } finally {
      off();
    }
    const contextId = found[0];
    if (contextId === undefined) {
      throw new FrameworkError(
        "action_frame_unknown",
        `frame ${frame.url} reported no page world; it may be navigating`,
        { frame: frame.url },
      );
    }
    pageWorlds.set(frameId, contextId);
    return contextId;
  };
  // a navigation destroys a world; a stale one is made again once
  const inContext = async <T>(
    world: (frame: FrameEntry, fresh?: boolean) => Promise<number>,
    frame: FrameEntry,
    body: (contextId: number) => Promise<T>,
  ): Promise<T> => {
    try {
      return await body(await world(frame));
    } catch (error) {
      if (!/context/i.test(error instanceof Error ? error.message : "")) throw error;
      return body(await world(frame, true));
    }
  };
  const inWorld = <T>(frame: FrameEntry, body: (contextId: number) => Promise<T>): Promise<T> =>
    inContext(worldOf, frame, body);

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
    return inWorld(frame, async (contextId) => {
      const { result } = await connection.send<{ result: { objectId?: string } }>(
        "Runtime.evaluate",
        { expression: `document.querySelector(${JSON.stringify(selector)})`, contextId },
        frame.sessionId,
      );
      return result.objectId
        ? { resolved: { objectId: result.objectId, sessionId: frame.sessionId, contextId } }
        : {
            missing: new FrameworkError(
              "action_target_not_found",
              `no element matches ${selector} in ${name ?? "the page"}`,
              { selector, frame: name ?? "main" },
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
    for (let count = 1; count <= clickCount; count++) {
      const click = { button, clickCount: count, modifiers: chord.mask };
      await send("mousePressed", click);
      await send("mouseReleased", click);
    }
    await moved;
    for (const modifier of [...chord.modifiers].reverse()) {
      await key("keyUp", modifier, 0, sessionId);
    }
  };

  // every action ends here: releases its element, and raises a dialog the `fail` policy caught
  const settle = async (element: ActionableElement | undefined) => {
    if (element) await release(connection, element.resolved);
    if (failingDialog) {
      const opened = failingDialog;
      failingDialog = undefined;
      throw new FrameworkError(
        "action_dialog_opened",
        `the action opened a ${opened.type} ("${opened.message}"); it was dismissed`,
        { ...opened },
      );
    }
  };

  const act = async (
    actionTarget: CdpActionTarget,
    needs: Needs & { hit?: boolean },
    options: CdpActionOptions | undefined,
    body: (element: ActionableElement) => Promise<void>,
  ) => {
    const element = await actionable(actionTarget, needs, options?.timeoutMs);
    try {
      if (options?.documents) {
        const href = await callOn<string>(connection, element.resolved, DOCUMENT);
        assertDocument(href, options.documents, `nothing was sent to ${describe(actionTarget)}`);
      }
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
      await pointer(element, 1, {});
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

  const focusOn = (element: ActionableElement) =>
    connection.send(
      "DOM.focus",
      { objectId: element.resolved.objectId },
      element.resolved.sessionId,
    );

  let closed = false;
  return {
    get refs() {
      return rendering.refs;
    },
    get frames() {
      return Object.fromEntries(
        frames.filter((frame) => frame.label !== "main").map((frame) => [frame.label, frame.url]),
      );
    },
    dialogs,
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
      if (options.target) {
        element = await actionable(options.target, { hit: false }, options.timeoutMs);
        await focusOn(element);
      }
      try {
        let held = 0;
        for (const modifier of chord.modifiers) {
          held |= MODIFIER_BITS[modifier.key] ?? 0;
          await key("keyDown", modifier, held);
        }
        await key("keyDown", chord.key, chord.mask);
        await key("keyUp", chord.key, chord.mask);
        for (const modifier of [...chord.modifiers].reverse()) await key("keyUp", modifier, 0);
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
    frameId(name?: string) {
      return frameIdOf(frameOf(name));
    },
    async refresh() {
      await read();
      await enablePages();
    },
    async close() {
      if (closed) return;
      closed = true;
      offDialogs();
      await releaseForest(connection, sessions);
      connection.close();
    },
  };
}
