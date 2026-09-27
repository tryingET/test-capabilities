/**
 * The in-frame probe over CDP (CDP program S2; design `docs/project/2026-09-27-cdp-channel-program.md`).
 *
 * The surf probe switches the tab into each top-level candidate (`frame.switch`, `wait.element`,
 * `frame.main`): ~225 ms per candidate, nested candidates `unprobed`, and a restore that fails
 * closes the tab (`frame_context_unrestored`). Over the loopback DevTools connection the probe is
 * a read in each candidate's own frame: an isolated world per frame, a fixed read-only query for
 * the selector being present and visible (what surf's `wait.element` waits for), polled until the
 * probe timeout. Nothing is switched, nothing is acted on.
 *
 * A candidate is mapped to a CDP frame by, in order: its `cdpFrameIds` (same-process frames surf's
 * frame tree saw); for a top-level candidate, its DOM index, compared with the index of each
 * frame's owner iframe in the top document; for a nested one, its URL. Surf's own CDP frame tree
 * holds only the page's in-process frames, so out-of-process candidates arrive with no CDP id
 * (measured live 2026-09-27). A candidate that maps to no frame, or to several, is `unanswered`,
 * never guessed.
 */

import type { AxFrameTree } from "./a11y-ax-tree.js";
import {
  bindOwnedTarget,
  CdpConnection,
  listCdpTargets,
  probeCdpBrowser,
  readAxForest,
  releaseForest,
  resolveCdpEndpoint,
} from "./a11y-cdp.js";
import type { EffectDeclaration } from "./effects.js";
import type { FrameProbeReading } from "./frame-root-cause.js";

export const CDP_FRAME_PROBE_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason:
    "reads each candidate frame's DOM in an isolated world over the loopback DevTools endpoint; switches no frame context and acts on nothing",
};

/** What the probe needs of a topology candidate. */
export interface CdpProbeCandidate {
  domIndex: number | null;
  src: string;
  cdpFrameIds: readonly string[];
}

interface ProbeFrame {
  frameId: string;
  url: string;
  sessionId: string | undefined;
  /** the index of the frame's owner among the top document's iframes, when it is one of them */
  topIndex: number | null;
}

const WORLD = "test-capabilities";
const POLL_MS = 50;
const TOP_INDEX = `function () { /* tc:iframe-index */
  return [...this.ownerDocument.querySelectorAll("iframe, frame")].indexOf(this);
}`;

/** The fixed read: the selector is in this document and rendered (what `wait.element` waits for). */
export function visibleQuery(selector: string): string {
  return `/* tc:probe ${JSON.stringify(selector)} */ (() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
})()`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An abbreviated `src` ("…" at the end) matches a URL it is the start of. */
function sameUrl(src: string, url: string): boolean {
  if (src.endsWith("…")) return url.startsWith(src.slice(0, -1));
  return src === url;
}

async function topIndexOf(
  connection: CdpConnection,
  frameId: string,
  mainWorld: number,
): Promise<number | null> {
  try {
    // an iframe owned by the top document answers in the page's own session
    const { backendNodeId } = await connection.send<{ backendNodeId: number }>(
      "DOM.getFrameOwner",
      { frameId },
    );
    const { object } = await connection.send<{ object: { objectId: string } }>("DOM.resolveNode", {
      backendNodeId,
      executionContextId: mainWorld,
    });
    try {
      const { result } = await connection.send<{ result: { value?: number } }>(
        "Runtime.callFunctionOn",
        { objectId: object.objectId, functionDeclaration: TOP_INDEX, returnByValue: true },
      );
      return typeof result.value === "number" && result.value >= 0 ? result.value : null;
    } finally {
      await connection
        .send("Runtime.releaseObject", { objectId: object.objectId })
        .catch(() => undefined);
    }
  } catch {
    return null;
  }
}

function mapCandidate(
  candidate: CdpProbeCandidate,
  frames: readonly ProbeFrame[],
): ProbeFrame | string {
  const byId = frames.filter((frame) => candidate.cdpFrameIds.includes(frame.frameId));
  if (byId.length === 1) return byId[0] as ProbeFrame;
  const matches =
    candidate.domIndex !== null
      ? frames.filter((frame) => frame.topIndex === candidate.domIndex)
      : frames.filter((frame) => frame.topIndex === null && sameUrl(candidate.src, frame.url));
  if (matches.length === 1) return matches[0] as ProbeFrame;
  return matches.length === 0
    ? `no frame on the DevTools connection matches this candidate (${candidate.domIndex !== null ? `DOM index ${candidate.domIndex}` : candidate.src})`
    : `${matches.length} frames match this candidate; none is guessed`;
}

async function probeFrame(
  connection: CdpConnection,
  frame: ProbeFrame,
  selector: string,
  timeoutMs: number,
): Promise<FrameProbeReading["reading"]> {
  const { executionContextId } = await connection.send<{ executionContextId: number }>(
    "Page.createIsolatedWorld",
    { frameId: frame.frameId, worldName: WORLD },
    frame.sessionId,
  );
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { result } = await connection.send<{ result: { value?: boolean } }>(
      "Runtime.evaluate",
      { expression: visibleQuery(selector), contextId: executionContextId, returnByValue: true },
      frame.sessionId,
    );
    if (result.value === true) return "hit";
    if (Date.now() >= deadline) return "miss";
    await sleep(POLL_MS);
  }
}

/**
 * Probe `candidates` (in their order) for `selector` in the owned tab at `href`. Throws the a11y
 * channel's endpoint and binding refusals, so the caller can fall back to the surf probe.
 */
export async function probeCandidatesOverCdp(
  href: string,
  env: NodeJS.ProcessEnv,
  candidates: readonly CdpProbeCandidate[],
  selector: string,
  timeoutMs: number,
): Promise<FrameProbeReading[]> {
  const endpoint = resolveCdpEndpoint(env);
  await probeCdpBrowser(endpoint);
  const target = bindOwnedTarget(await listCdpTargets(endpoint), href);
  const connection = await CdpConnection.open(target.webSocketDebuggerUrl as string);
  const { forest, sessions } = await readAxForest(connection);
  try {
    const main = forest[0] as AxFrameTree;
    const mainId =
      main.frameId ??
      (await connection.send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree"))
        .frameTree.frame.id;
    const { executionContextId: mainWorld } = await connection.send<{
      executionContextId: number;
    }>("Page.createIsolatedWorld", { frameId: mainId, worldName: WORLD });
    const frames: ProbeFrame[] = [];
    for (const tree of forest.slice(1)) {
      if (!tree.frameId || tree.error !== undefined) continue;
      frames.push({
        frameId: tree.frameId,
        url: tree.url,
        sessionId: sessions[tree.frame],
        topIndex: await topIndexOf(connection, tree.frameId, mainWorld),
      });
    }
    const readings: FrameProbeReading[] = [];
    for (const candidate of candidates) {
      const frame = mapCandidate(candidate, frames);
      if (typeof frame === "string") {
        readings.push({ domIndex: candidate.domIndex, reading: "unanswered", detail: frame });
        continue;
      }
      try {
        readings.push({
          domIndex: candidate.domIndex,
          reading: await probeFrame(connection, frame, selector, timeoutMs),
        });
      } catch (error) {
        readings.push({
          domIndex: candidate.domIndex,
          reading: "unanswered",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return readings;
  } finally {
    await releaseForest(connection, sessions);
    connection.close();
  }
}
