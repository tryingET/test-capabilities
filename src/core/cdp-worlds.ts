/**
 * The execution contexts of a frame, for reads and scripts over one DevTools connection (CDP
 * program S1/S3): an isolated world per frame, where the page's own scripts can neither see nor
 * tamper with a read, and the page's own world per frame, for a script that has to act as the
 * page does. Both are found by the frame's id, so a same-process frame is reached in its own
 * document rather than its host's; a navigation destroys a world, and a stale one is made once
 * more.
 */

import type { CdpConnection } from "./a11y-cdp.js";
import { FrameworkError } from "./runtime-contract.js";

/** A frame as the worlds need it: where it is hosted and, once known, its CDP frame id. */
export interface WorldFrame {
  url: string;
  frameId: string | undefined;
  sessionId: string | undefined;
}

/** The worlds of every frame on `connection`; isolated worlds are named `worldName`. */
export function frameWorlds(connection: CdpConnection, worldName: string) {
  // one isolated world per frame; a navigation destroys it, so a stale one is made again once
  const worlds = new Map<string, number>();
  // every frame read carries its id: an out-of-process frame its target's, a same-process one
  // the tree's, and the page its target's (cdp-actions.ts)
  const frameIdOf = async (frame: WorldFrame): Promise<string> => {
    if (frame.frameId) return frame.frameId;
    throw new FrameworkError("action_frame_unknown", `frame ${frame.url} has no frame id`, {
      frame: frame.url,
    });
  };
  const worldOf = async (frame: WorldFrame, fresh = false): Promise<number> => {
    const frameId = await frameIdOf(frame);
    const known = worlds.get(frameId);
    if (known !== undefined && !fresh) return known;
    const { executionContextId } = await connection.send<{ executionContextId: number }>(
      "Page.createIsolatedWorld",
      { frameId, worldName },
      frame.sessionId,
    );
    worlds.set(frameId, executionContextId);
    return executionContextId;
  };
  // the page's own world of a frame: `Runtime.enable` reports one default context per frame of
  // the session before it answers (measured live 2026-09-27), so a same-process frame is reached
  // by its frame id rather than landing in its host's document
  const pageWorlds = new Map<string, number>();
  const pageWorldOf = async (frame: WorldFrame, fresh = false): Promise<number> => {
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
