/**
 * Actionability for CDP actions (CDP program S1): an action waits until its element is attached,
 * visible, stable, enabled (and editable, for typing), and is what a click at its centre would
 * reach - then acts once. At the deadline the refusal names the conditions that never held.
 *
 * Measured live on Chromium 153 (2026-09-27): content quads of an element inside a same-process
 * frame are already in the session's local-root coordinates, and `DOM.getNodeForLocation` hit-
 * tests into same-process frames in those coordinates; out-of-process frames are their own local
 * roots. So the hit test runs in the element's own session, at the quad centre, with no offset.
 * Stability is two quad samples 16 ms apart on a timer, not animation frames: a browser window
 * that is not painted runs no animation frames.
 */

import type { CdpConnection } from "./a11y-cdp.js";
import { FrameworkError } from "./runtime-contract.js";

/** An element resolved into its frame's isolated world. */
export interface ResolvedElement {
  objectId: string;
  sessionId: string | undefined;
  contextId: number;
}

/** A lookup either finds the element or says why not; the loop retries until the deadline. */
export type ElementLookup =
  | { resolved: ResolvedElement; missing?: undefined }
  | { resolved?: undefined; missing: FrameworkError };

export interface ElementState {
  attached: boolean;
  visible: boolean;
  enabled: boolean;
  editable: boolean;
  checked: boolean | null;
  tag: string;
  type: string | null;
}

export interface Needs {
  enabled?: boolean;
  editable?: boolean;
}

export interface ActionableElement {
  resolved: ResolvedElement;
  /** the centre, in the element's session's local-root coordinates */
  point: { x: number; y: number };
  state: ElementState;
}

const POLL_MS = 50;
const STABLE_GAP_MS = 16;

export const STATE_FUNCTION = `function () { /* tc:state */
  const style = this.ownerDocument.defaultView.getComputedStyle(this);
  const rect = this.getBoundingClientRect();
  const visible = rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
  const enabled = !this.disabled && !this.closest("fieldset[disabled]") &&
    this.getAttribute("aria-disabled") !== "true";
  const editable = enabled && !this.readOnly &&
    (this.isContentEditable || ["INPUT", "TEXTAREA"].includes(this.tagName));
  const aria = this.getAttribute("aria-checked");
  const checked = "checked" in this && (this.type === "checkbox" || this.type === "radio")
    ? this.checked : aria === "true" ? true : aria === "false" ? false : null;
  return { attached: this.isConnected, visible, enabled, editable, checked,
    tag: this.tagName, type: this.type ?? null };
}`;

/**
 * Whether a hit landed on the element: the element itself, or anything inside it - its own
 * shadow tree included, where a host control renders (AK #6163). The walk crosses a shadow root
 * to its host and stops at a fragment that has none.
 */
export const SAME_NODE = `function (other) { /* tc:same-node */
  for (let node = other; node; node = node.parentNode || (node.nodeType === 11 ? node.host : null)) {
    if (node === this) return true;
  }
  return false;
}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `Runtime.callFunctionOn` on a resolved element; arguments are values or `{ objectId }`. */
export async function callOn<T>(
  connection: CdpConnection,
  resolved: ResolvedElement,
  declaration: string,
  args: unknown[] = [],
): Promise<T> {
  const { result, exceptionDetails } = await connection.send<{
    result: { value?: T };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  }>(
    "Runtime.callFunctionOn",
    {
      objectId: resolved.objectId,
      functionDeclaration: declaration,
      arguments: args.map((arg) =>
        typeof arg === "object" && arg !== null && "objectId" in arg ? arg : { value: arg },
      ),
      returnByValue: true,
    },
    resolved.sessionId,
  );
  if (exceptionDetails) {
    throw new FrameworkError(
      "action_evaluate_failed",
      exceptionDetails.exception?.description ?? exceptionDetails.text ?? "the element threw",
      {},
    );
  }
  return result.value as T;
}

export function release(connection: CdpConnection, resolved: ResolvedElement): Promise<void> {
  return connection
    .send("Runtime.releaseObject", { objectId: resolved.objectId }, resolved.sessionId)
    .then(() => undefined)
    .catch(() => undefined);
}

async function centre(
  connection: CdpConnection,
  resolved: ResolvedElement,
): Promise<{ x: number; y: number } | undefined> {
  const { quads } = await connection.send<{ quads: number[][] }>(
    "DOM.getContentQuads",
    { objectId: resolved.objectId },
    resolved.sessionId,
  );
  const quad = quads[0];
  if (!quad) return undefined;
  return {
    x: ((quad[0] ?? 0) + (quad[2] ?? 0) + (quad[4] ?? 0) + (quad[6] ?? 0)) / 4,
    y: ((quad[1] ?? 0) + (quad[3] ?? 0) + (quad[5] ?? 0) + (quad[7] ?? 0)) / 4,
  };
}

/** Whether what a click at `point` reaches is the element or inside it. */
async function receivesEvents(
  connection: CdpConnection,
  resolved: ResolvedElement,
  point: { x: number; y: number },
): Promise<boolean> {
  try {
    const { backendNodeId } = await connection.send<{ backendNodeId: number }>(
      "DOM.getNodeForLocation",
      // integers only: Chromium answers "Invalid parameters" to a fractional point (measured live)
      {
        x: Math.round(point.x),
        y: Math.round(point.y),
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: true,
      },
      resolved.sessionId,
    );
    const { object } = await connection.send<{ object: { objectId: string } }>(
      "DOM.resolveNode",
      { backendNodeId, executionContextId: resolved.contextId },
      resolved.sessionId,
    );
    try {
      return await callOn<boolean>(connection, resolved, SAME_NODE, [
        { objectId: object.objectId },
      ]);
    } finally {
      await release(connection, { ...resolved, objectId: object.objectId });
    }
  } catch {
    // the point is on something outside this frame's world (a cover in another frame)
    return false;
  }
}

/**
 * Wait until the element `lookup` finds is actionable, or refuse at `timeoutMs` with what never
 * held. `hit: false` skips the hit test (an action that dispatches no pointer event).
 */
export async function waitForActionable(
  connection: CdpConnection,
  lookup: () => Promise<ElementLookup>,
  needs: Needs & { hit?: boolean },
  timeoutMs: number,
  describe: string,
): Promise<ActionableElement> {
  const deadline = Date.now() + timeoutMs;
  let missing: FrameworkError | undefined;
  let conditions: Record<string, boolean> | undefined;
  for (;;) {
    const found = await lookup();
    missing = found.missing;
    // what the last look saw decides the refusal: an element that went away is missing again
    if (!found.resolved) conditions = undefined;
    if (found.resolved) {
      const resolved = found.resolved;
      let keep = false;
      try {
        const state = await callOn<ElementState>(connection, resolved, STATE_FUNCTION);
        conditions = {
          attached: state.attached,
          visible: state.visible,
          ...(needs.enabled || needs.editable ? { enabled: state.enabled } : {}),
          ...(needs.editable ? { editable: state.editable } : {}),
        };
        if (Object.values(conditions).every(Boolean)) {
          await connection.send(
            "DOM.scrollIntoViewIfNeeded",
            { objectId: resolved.objectId },
            resolved.sessionId,
          );
          const first = await centre(connection, resolved);
          await sleep(STABLE_GAP_MS);
          const second = await centre(connection, resolved);
          conditions.visible = Boolean(first && second);
          conditions.stable = Boolean(
            first && second && first.x === second.x && first.y === second.y,
          );
          if (second && conditions.stable) {
            conditions.receivesEvents =
              needs.hit === false || (await receivesEvents(connection, resolved, second));
            if (conditions.receivesEvents) {
              keep = true;
              return { resolved, point: second, state };
            }
          }
        }
      } catch (error) {
        // a node that went away between lookup and state: look again
        conditions = { attached: false };
        if (error instanceof FrameworkError && error.code !== "action_evaluate_failed") throw error;
      } finally {
        if (!keep) await release(connection, resolved);
      }
    }
    if (Date.now() >= deadline) break;
    await sleep(POLL_MS);
  }
  // the last look found nothing: why it did not is the refusal
  if (!conditions) throw missing as FrameworkError;
  const unmet = Object.entries(conditions)
    .filter(([, held]) => !held)
    .map(([name]) => name);
  if (unmet.length === 1 && unmet[0] === "receivesEvents") {
    throw new FrameworkError(
      "action_target_obscured",
      `another element covers the centre of ${describe}; nothing was clicked (waited ${timeoutMs} ms)`,
      { conditions },
    );
  }
  throw new FrameworkError(
    "action_target_not_ready",
    `${describe} never became actionable within ${timeoutMs} ms: ${unmet.join(", ")} did not hold`,
    { conditions },
  );
}
