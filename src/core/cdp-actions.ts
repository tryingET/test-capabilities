/**
 * Actions on the owned tab over our own CDP connection (AK #6099; design
 * `docs/project/2026-09-27-playwright-action-channel-design.md` section 6).
 *
 * The a11y channel already binds the tab surf owns and holds one DevTools connection to it; a
 * held connection is where Playwright's speed came from. This module acts over the same binding:
 * `click` is real input (scrolled into view, hit-tested, dispatched at page coordinates through
 * every enclosing out-of-process frame), `fill` types trusted text, `select` picks an option and
 * fires input/change, and `evaluate` runs in any frame's own session - the read surf refuses in a
 * selected frame. Its effect is mutating, so it is its own entry point, never part of the
 * read-only a11y channel. It creates, navigates and closes nothing.
 */

import { type AxHandle, renderAxForest } from "./a11y-ax-tree.js";
import {
  bindOwnedTarget,
  CdpConnection,
  listCdpTargets,
  probeCdpBrowser,
  readAxForest,
  releaseForest,
  resolveCdpEndpoint,
} from "./a11y-cdp.js";
import { FrameworkError } from "./runtime-contract.js";

/** An element by its a11y ref from this view, or by a CSS selector in a frame (label or URL). */
export type CdpActionTarget = { ref: string } | { selector: string; frame?: string };

export interface CdpActions {
  /** the refs of the snapshot read at open, `{ role, name }` each */
  refs: Record<string, { role: string; name: string }>;
  /** the out-of-process frames by label (`f1`...), with their URLs */
  frames: Record<string, string>;
  click(target: CdpActionTarget): Promise<void>;
  fill(target: CdpActionTarget, text: string): Promise<void>;
  select(target: CdpActionTarget, value: string): Promise<void>;
  evaluate<T = unknown>(expression: string, frame?: string): Promise<T>;
  close(): Promise<void>;
}

// true when the element, or something inside it, is what a click at (x, y) would reach
const HIT_TEST = `function (x, y) {
  const found = this.ownerDocument.elementFromPoint(x, y);
  return found === this || this.contains(found);
}`;
const SELECT_ALL = "function () { if (typeof this.select === 'function') this.select(); }";
const SELECT_OPTION = `function (wanted) {
  const option = [...this.options].find((o) => o.value === wanted || o.label === wanted);
  if (!option) return false;
  this.value = option.value;
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}`;

interface Resolved {
  objectId: string;
  sessionId: string | undefined;
}

/**
 * Bind the owned tab at `href`, read its forest (for refs and frame sessions), and return actions
 * on it. The caller closes it: the frame sessions are detached and the socket closed.
 */
export async function openCdpActions(
  href: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CdpActions> {
  const endpoint = resolveCdpEndpoint(env);
  await probeCdpBrowser(endpoint);
  const target = bindOwnedTarget(await listCdpTargets(endpoint), href);
  const connection = await CdpConnection.open(target.webSocketDebuggerUrl as string);
  const { forest, sessions } = await readAxForest(connection);
  const rendering = renderAxForest(forest);
  const frames: Record<string, string> = {};
  for (const tree of forest) if (tree.frame !== "main") frames[tree.frame] = tree.url;
  let closed = false;
  const parentOf = (sessionId: string) =>
    connection.attached.find((entry) => entry.sessionId === sessionId)?.parentSessionId;

  const sessionFor = (frame = "main"): string | undefined => {
    if (frame === "main") return undefined;
    const label =
      frame in frames ? frame : Object.keys(frames).find((key) => frames[key] === frame);
    if (!label || !sessions[label]) {
      throw new FrameworkError(
        "action_frame_unknown",
        `'${frame}' is not one of the owned tab's out-of-process frames (${Object.values(frames).join(", ") || "none"})`,
        { frame },
      );
    }
    return sessions[label];
  };

  const resolve = async (actionTarget: CdpActionTarget): Promise<Resolved> => {
    if ("ref" in actionTarget) {
      const handle: AxHandle | undefined = rendering.handles[actionTarget.ref];
      if (!handle) {
        throw new FrameworkError(
          "action_target_not_found",
          `${actionTarget.ref} has no element in this snapshot`,
          { ref: actionTarget.ref },
        );
      }
      const sessionId = sessions[handle.frame];
      const { object } = await connection.send<{ object: { objectId: string } }>(
        "DOM.resolveNode",
        { backendNodeId: handle.backendNodeId },
        sessionId,
      );
      return { objectId: object.objectId, sessionId };
    }
    const sessionId = sessionFor(actionTarget.frame);
    const { result } = await connection.send<{ result: { objectId?: string } }>(
      "Runtime.evaluate",
      { expression: `document.querySelector(${JSON.stringify(actionTarget.selector)})` },
      sessionId,
    );
    if (!result.objectId) {
      throw new FrameworkError(
        "action_target_not_found",
        `no element matches ${actionTarget.selector} in ${actionTarget.frame ?? "the page"}`,
        { selector: actionTarget.selector, frame: actionTarget.frame ?? "main" },
      );
    }
    return { objectId: result.objectId, sessionId };
  };

  const release = (resolved: Resolved) =>
    connection
      .send("Runtime.releaseObject", { objectId: resolved.objectId }, resolved.sessionId)
      .catch(() => undefined);

  // the page coordinates of a frame's viewport origin: its iframe's content box, recursively
  const frameOrigin = async (sessionId: string | undefined): Promise<[number, number]> => {
    if (sessionId === undefined) return [0, 0];
    const parent = parentOf(sessionId);
    const { frameTree } = await connection.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
      {},
      sessionId,
    );
    const { backendNodeId } = await connection.send<{ backendNodeId: number }>(
      "DOM.getFrameOwner",
      { frameId: frameTree.frame.id },
      parent,
    );
    const { model } = await connection.send<{ model: { content: number[] } }>(
      "DOM.getBoxModel",
      { backendNodeId },
      parent,
    );
    const [px, py] = await frameOrigin(parent);
    return [px + (model.content[0] ?? 0), py + (model.content[1] ?? 0)];
  };

  const callOn = async <T>(resolved: Resolved, declaration: string, args: unknown[] = []) => {
    const { result } = await connection.send<{ result: { value?: T } }>(
      "Runtime.callFunctionOn",
      {
        objectId: resolved.objectId,
        functionDeclaration: declaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
      },
      resolved.sessionId,
    );
    return result.value;
  };

  const act = async <T>(
    actionTarget: CdpActionTarget,
    body: (resolved: Resolved) => Promise<T>,
  ) => {
    const resolved = await resolve(actionTarget);
    try {
      return await body(resolved);
    } finally {
      await release(resolved);
    }
  };

  const describe = (actionTarget: CdpActionTarget) =>
    "ref" in actionTarget ? actionTarget.ref : actionTarget.selector;

  return {
    refs: rendering.refs,
    frames,
    click: (actionTarget) =>
      act(actionTarget, async (resolved) => {
        await connection.send(
          "DOM.scrollIntoViewIfNeeded",
          { objectId: resolved.objectId },
          resolved.sessionId,
        );
        const { quads } = await connection.send<{ quads: number[][] }>(
          "DOM.getContentQuads",
          { objectId: resolved.objectId },
          resolved.sessionId,
        );
        const quad = quads[0];
        if (!quad) {
          throw new FrameworkError(
            "action_target_obscured",
            `${describe(actionTarget)} has no box to click`,
            {},
          );
        }
        const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
        const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
        if (!(await callOn<boolean>(resolved, HIT_TEST, [x, y]))) {
          throw new FrameworkError(
            "action_target_obscured",
            `another element covers the centre of ${describe(actionTarget)}; nothing was clicked`,
            { x, y },
          );
        }
        const [ox, oy] = await frameOrigin(resolved.sessionId);
        const at = { x: ox + x, y: oy + y };
        await connection.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
        await connection.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...at,
          button: "left",
          clickCount: 1,
        });
        await connection.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...at,
          button: "left",
          clickCount: 1,
        });
      }),
    fill: (actionTarget, text) =>
      act(actionTarget, async (resolved) => {
        await connection.send("DOM.focus", { objectId: resolved.objectId }, resolved.sessionId);
        await callOn(resolved, SELECT_ALL);
        if (text === "") {
          for (const type of ["keyDown", "keyUp"]) {
            await connection.send("Input.dispatchKeyEvent", {
              type,
              key: "Delete",
              code: "Delete",
              windowsVirtualKeyCode: 46,
            });
          }
        } else {
          await connection.send("Input.insertText", { text });
        }
      }),
    select: (actionTarget, value) =>
      act(actionTarget, async (resolved) => {
        if (!(await callOn<boolean>(resolved, SELECT_OPTION, [value]))) {
          throw new FrameworkError(
            "action_option_not_found",
            `${describe(actionTarget)} offers no option with the value or label '${value}'`,
            { value },
          );
        }
      }),
    async evaluate<T>(expression: string, frame?: string): Promise<T> {
      const { result, exceptionDetails } = await connection.send<{
        result: { value?: T };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      }>(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sessionFor(frame),
      );
      if (exceptionDetails) {
        throw new FrameworkError(
          "action_evaluate_failed",
          `the expression threw in ${frame ?? "the page"}: ${exceptionDetails.exception?.description ?? exceptionDetails.text ?? "unknown error"}`,
          { frame: frame ?? "main" },
        );
      }
      return result.value as T;
    },
    async close() {
      if (closed) return;
      closed = true;
      await releaseForest(connection, sessions);
      connection.close();
    },
  };
}
