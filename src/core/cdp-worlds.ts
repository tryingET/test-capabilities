/**
 * The execution contexts of a frame, for reads and scripts over one DevTools connection (CDP
 * program S1/S3): an isolated world per frame, where the page's own scripts can neither see nor
 * tamper with a read, and the page's own world per frame, for a script that has to act as the
 * page does. Both are found by the frame's id, so a same-process frame is reached in its own
 * document rather than its host's; a navigation destroys a world, and a stale one is made once
 * more.
 */

import { randomUUID } from "node:crypto";
import type { CdpConnection } from "./a11y-cdp.js";
import { frameOriginPath } from "./frame-address.js";
import { FrameworkError } from "./runtime-contract.js";

/** A frame as the worlds need it: where it is hosted and, once known, its CDP frame id. */
export interface WorldFrame {
  url: string;
  frameId: string | undefined;
  sessionId: string | undefined;
}

/**
 * A frame of the owned tab by label (`main`, `f1`...), URL or CDP frame id; with `origin_path`,
 * the one child frame at that HTTP(S) origin+path (AK #6162), never a guess among several.
 */
export function frameByName<F extends WorldFrame & { label: string }>(
  frames: readonly F[],
  name: string,
  match?: "origin_path",
): F {
  const address = match ? frameOriginPath(name) : undefined;
  const candidates = match
    ? frames.filter(
        (frame) =>
          frame.label !== "main" && address !== undefined && frameOriginPath(frame.url) === address,
      )
    : [];
  if (candidates.length > 1) {
    throw new FrameworkError(
      "action_frame_ambiguous",
      `${candidates.length} frames match origin+path ${address}; none was guessed`,
      { frame: name },
    );
  }
  const found = match
    ? candidates[0]
    : (frames.find((frame) => frame.label === name) ??
      frames.find((frame) => frame.label !== "main" && frame.url === name) ??
      frames.find((frame) => frame.frameId === name));
  if (!found) {
    throw new FrameworkError(
      "action_frame_unknown",
      // origins only: a frame's URL may carry what its page was given
      `'${name}' is not one of the owned tab's frames (${
        frames
          .filter((frame) => frame.label !== "main")
          .map((frame) => (URL.canParse(frame.url) ? new URL(frame.url).origin : "(no URL)"))
          .join(", ") || "none"
      })`,
      { frame: name },
    );
  }
  return found;
}

/** The worlds of every frame on `connection`; isolated worlds are named `worldName`. */
export function frameWorlds(connection: CdpConnection, worldName: string) {
  // one isolated world per frame; a navigation destroys it, so a stale one is made again once.
  // Context ids are unique within a session only, so a world is its frame's in that session: a
  // frame that moved process (a held connection outlives navigations) gets a world of its own
  const worlds = new Map<string, number>();
  const keyOf = (frame: WorldFrame, frameId: string) => `${frame.sessionId ?? "page"}|${frameId}`;
  // every frame read carries its id: an out-of-process frame its target's, a same-process one
  // the tree's, and the page its target's (cdp-actions.ts)
  const frameIdOf = async (frame: WorldFrame): Promise<string> => {
    if (frame.frameId) return frame.frameId;
    throw new FrameworkError("action_frame_unknown", `frame ${frame.url} has no frame id`, {
      frame: frame.url,
    });
  };
  // A renderer that replaced another behind the same session may reuse context ids, so a cached
  // world proves it is ours before it is reused: each carries a stamp on its own global, which
  // the page's scripts cannot see, and one that lost it is made again
  const stamp = randomUUID();
  const stamped = async (contextId: number, sessionId: string | undefined) => {
    const { result } = await connection.send<{ result: { value?: unknown } }>(
      "Runtime.evaluate",
      { expression: "globalThis.__testCapabilitiesWorld", contextId, returnByValue: true },
      sessionId,
    );
    return result.value === stamp;
  };
  const worldOf = async (frame: WorldFrame, fresh = false): Promise<number> => {
    const frameId = await frameIdOf(frame);
    const known = worlds.get(keyOf(frame, frameId));
    if (known !== undefined && !fresh) {
      if (await stamped(known, frame.sessionId).catch(() => false)) return known;
    }
    const { executionContextId } = await connection.send<{ executionContextId: number }>(
      "Page.createIsolatedWorld",
      { frameId, worldName },
      frame.sessionId,
    );
    await connection.send(
      "Runtime.evaluate",
      {
        expression: `globalThis.__testCapabilitiesWorld = ${JSON.stringify(stamp)}`,
        contextId: executionContextId,
      },
      frame.sessionId,
    );
    worlds.set(keyOf(frame, frameId), executionContextId);
    return executionContextId;
  };
  // the page's own world of a frame: `Runtime.enable` reports one default context per frame of
  // the session before it answers (measured live 2026-09-27), so a same-process frame is reached
  // by its frame id rather than landing in its host's document
  const pageWorlds = new Map<string, number>();
  // a page world cannot be stamped without touching the page: its ids are dropped whenever the
  // session reports a navigation, and a stale one fails and is made again (inContext)
  connection.on("Page.frameNavigated", (_params, sessionId) => {
    for (const key of [...pageWorlds.keys()]) {
      if (key.startsWith(`${sessionId ?? "page"}|`)) pageWorlds.delete(key);
    }
  });
  const pageWorldOf = async (frame: WorldFrame, fresh = false): Promise<number> => {
    const frameId = await frameIdOf(frame);
    const known = pageWorlds.get(keyOf(frame, frameId));
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
    pageWorlds.set(keyOf(frame, frameId), contextId);
    return contextId;
  };
  // a navigation destroys a world; a stale one is made again once
  const inContext = async <T>(
    world: (frame: WorldFrame, fresh?: boolean) => Promise<number>,
    frame: WorldFrame,
    body: (contextId: number) => Promise<T>,
  ): Promise<T> => {
    try {
      return await body(await world(frame));
    } catch (error) {
      if (!/context/i.test(error instanceof Error ? error.message : "")) throw error;
      return body(await world(frame, true));
    }
  };
  const inWorld = <T>(frame: WorldFrame, body: (contextId: number) => Promise<T>): Promise<T> =>
    inContext(worldOf, frame, body);
  return { frameIdOf, worldOf, pageWorldOf, inContext, inWorld };
}
