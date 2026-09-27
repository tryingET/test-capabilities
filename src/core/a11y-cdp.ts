/**
 * The a11y channel's CDP transport (AK #5915, measured series 2026-09-26).
 *
 * The channel reads Chromium's own accessibility tree from the tab a surf run already owns, over
 * the loopback DevTools endpoint of the same browser. It attaches to that page target's own
 * socket, so it creates no target and no tab: page counts were unchanged on every measured
 * page. It reads, and it never navigates, clicks, types or evaluates anything that writes.
 *
 * - **Endpoint:** `TEST_CAPABILITIES_CDP_ENDPOINT` (default `http://127.0.0.1:9222`). A host that
 *   is not loopback is refused before any request is made.
 * - **Binding:** exactly one page target whose URL is the gated href. Zero or several is
 *   `tab_bind_ambiguous`, and the framework never picks.
 * - **Frames:** `Target.setAutoAttach` with `flatten: true`, repeated on every attached frame
 *   session, reaches the out-of-process frames surf's content script cannot read. Every session
 *   is detached before the socket closes.
 * - **Checks:** a ref's backend node is resolved with `DOM.resolveNode`, and a fixed read-only
 *   function reads visibility, text or one attribute. The remote object is released.
 */

import type { AxFrameTree, AxHandle, AxRawNode } from "./a11y-ax-tree.js";
import type { A11yCheckReader, A11yCheckReading } from "./a11y-snapshot.js";
import { FrameworkError } from "./runtime-contract.js";

export const CDP_ENDPOINT_ENV = "TEST_CAPABILITIES_CDP_ENDPOINT";
export const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
export const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "::1", "[::1]"];
const HTTP_TIMEOUT_MS = 3_000;
const COMMAND_TIMEOUT_MS = 15_000;
/** how long a read waits for a frame target of this page that has not attached yet */
const FRAME_WAIT_MS = 2_000;
const FRAME_POLL_MS = 25;

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

/** Resolve the DevTools endpoint, refusing anything that is not on this machine. */
export function resolveCdpEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[CDP_ENDPOINT_ENV]?.trim() || DEFAULT_CDP_ENDPOINT;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new FrameworkError(
      "cdp_endpoint_refused",
      `${CDP_ENDPOINT_ENV}=${raw} is not a URL. Point it at the loopback DevTools endpoint of Chromium (Agent), e.g. ${DEFAULT_CDP_ENDPOINT}.`,
      { endpoint: raw },
    );
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.includes(parsed.hostname)) {
    throw new FrameworkError(
      "cdp_endpoint_refused",
      `${CDP_ENDPOINT_ENV}=${raw} is not an http URL on ${LOOPBACK_HOSTS.join(", ")}. The a11y channel reads a browser on this machine only, and refuses before any request is made.`,
      { endpoint: raw, host: parsed.hostname },
    );
  }
  return `${parsed.protocol}//${parsed.host}`;
}

async function getJson(endpoint: string, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${endpoint}${path}`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  } catch (error) {
    throw new FrameworkError(
      "cdp_endpoint_unreachable",
      `No DevTools endpoint answered at ${endpoint}${path} (${error instanceof Error ? error.message : String(error)}). Start Chromium (Agent) with its remote debugging port, or set ${CDP_ENDPOINT_ENV}; the channel never launches a browser.`,
      { endpoint },
    );
  }
  if (!response.ok) {
    throw new FrameworkError(
      "cdp_endpoint_not_chromium",
      `${endpoint}${path} answered HTTP ${response.status}; a Chromium DevTools endpoint answers 200.`,
      { endpoint, http_status: response.status },
    );
  }
  try {
    return await response.json();
  } catch {
    throw new FrameworkError(
      "cdp_endpoint_not_chromium",
      `${endpoint}${path} did not answer JSON, so it is not a Chromium DevTools endpoint.`,
      { endpoint },
    );
  }
}

/** `/json/version`'s Browser string, or the typed refusal that says what is on that port. */
export async function probeCdpBrowser(endpoint: string): Promise<string> {
  const payload = (await getJson(endpoint, "/json/version")) as { Browser?: unknown } | null;
  if (typeof payload?.Browser !== "string" || payload.Browser.length === 0) {
    throw new FrameworkError(
      "cdp_endpoint_not_chromium",
      `${endpoint}/json/version answered without a 'Browser' string, so the framework cannot tell what is on that port.`,
      { endpoint },
    );
  }
  return payload.Browser;
}

export async function listCdpTargets(endpoint: string): Promise<CdpTarget[]> {
  const payload = await getJson(endpoint, "/json/list");
  if (!Array.isArray(payload)) {
    throw new FrameworkError(
      "cdp_endpoint_not_chromium",
      `${endpoint}/json/list answered ${typeof payload}, not a target list.`,
      { endpoint },
    );
  }
  return payload
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : "",
      type: typeof entry.type === "string" ? entry.type : "",
      url: typeof entry.url === "string" ? entry.url : "",
      title: typeof entry.title === "string" ? entry.title : "",
      ...(typeof entry.webSocketDebuggerUrl === "string"
        ? { webSocketDebuggerUrl: entry.webSocketDebuggerUrl }
        : {}),
    }))
    .filter((target) => target.id.length > 0);
}

/** The one page target at the gated href, or `tab_bind_ambiguous`. */
export function bindOwnedTarget(targets: readonly CdpTarget[], href: string): CdpTarget {
  const candidates = targets.filter((target) => target.type === "page" && target.url === href);
  const target = candidates[0];
  if (candidates.length !== 1 || !target?.webSocketDebuggerUrl) {
    throw new FrameworkError(
      "tab_bind_ambiguous",
      `The browser's target list holds ${candidates.length} page(s) at ${href}; the a11y channel reads exactly one tab or none. ${
        candidates.length === 0
          ? "The tab surf opened is not in /json/list, so the endpoint is a different browser from the one surf drives."
          : candidates.length > 1
            ? `Candidates: ${candidates.map((entry) => entry.id).join(", ")}.`
            : "The target carries no webSocketDebuggerUrl."
      }`,
      { url: href, candidates: candidates.map((entry) => entry.id) },
    );
  }
  return target;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One socket to one page target. Commands, flattened child sessions, attach events. */
export class CdpConnection {
  private readonly socket: WebSocket;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<
    string,
    Set<(params: Record<string, unknown>, sessionId?: string) => void>
  >();
  private nextId = 0;
  /** frame targets as they attach; `parentSessionId` is the session that announced one (none: the page) */
  readonly attached: Array<{
    sessionId: string;
    targetId: string;
    type: string;
    url: string;
    parentSessionId?: string;
  }> = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => this.onMessage(String(event.data)));
    socket.addEventListener("close", () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("the DevTools socket closed"));
      }
      this.pending.clear();
    });
  }

  static async open(url: string): Promise<CdpConnection> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the DevTools socket did not open")),
        HTTP_TIMEOUT_MS,
      );
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`the DevTools socket at ${url} failed`));
      });
    });
    return new CdpConnection(socket);
  }

  private onMessage(raw: string): void {
    let message: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      sessionId?: string;
      params?: {
        sessionId?: string;
        targetInfo?: { targetId?: string; type?: string; url?: string };
        [key: string]: unknown;
      };
    };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(new Error(message.error.message ?? "CDP error"));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (message.method === "Target.attachedToTarget" && message.params?.sessionId) {
      this.attached.push({
        sessionId: message.params.sessionId,
        targetId: message.params.targetInfo?.targetId ?? "",
        type: message.params.targetInfo?.type ?? "",
        url: message.params.targetInfo?.url ?? "",
        ...(message.sessionId ? { parentSessionId: message.sessionId } : {}),
      });
    }
    if (message.method === "Target.detachedFromTarget" && message.params?.sessionId) {
      const gone = this.attached.findIndex(
        (entry) => entry.sessionId === message.params?.sessionId,
      );
      if (gone >= 0) this.attached.splice(gone, 1);
    }
    if (message.method) {
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params ?? {}, message.sessionId);
      }
    }
  }

  /** Call `listener` for every `method` event, on any session; returns the unsubscribe. */
  on(
    method: string,
    listener: (params: Record<string, unknown>, sessionId?: string) => void,
  ): () => void {
    const set = this.listeners.get(method) ?? new Set();
    set.add(listener);
    this.listeners.set(method, set);
    return () => set.delete(listener);
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.nextId;
    if (this.socket.readyState !== WebSocket.OPEN) {
      // a closed socket answers nothing: fail now instead of waiting out the command timeout
      return Promise.reject(new Error(`${method}: the DevTools socket is not open`));
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} did not answer within ${COMMAND_TIMEOUT_MS} ms`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

interface SessionFrameNode {
  frame: { id: string; url: string };
  childFrames?: SessionFrameNode[];
}

/** The page's tree and one per out-of-process frame, plus the session each frame was read on. */
export interface AxForestRead {
  forest: AxFrameTree[];
  sessions: Record<string, string | undefined>;
}

/**
 * Read the forest: the page, then every out-of-process frame, recursively. Chromium announces the
 * frames that exist before `setAutoAttach` answers (measured live 2026-09-27), so each level is
 * read without waiting. The read then checks `Target.getTargets` for frame targets of this page
 * that have not attached, and waits for those only, up to {@link FRAME_WAIT_MS}; one that never
 * attaches is named unreadable. The frame sessions stay attached, so a check can still read inside
 * a frame; the caller ends them with {@link releaseForest}. (Turning auto-attach off on the page
 * detaches every child session in Chromium - measured live 2026-09-26 - so it must not happen
 * before the checks.)
 */
export async function readAxForest(connection: CdpConnection): Promise<AxForestRead> {
  const main = await connection.send<{ nodes: AxRawNode[] }>("Accessibility.getFullAXTree");
  const forest: AxFrameTree[] = [{ frame: "main", url: "", nodes: main.nodes }];
  const sessions: Record<string, string | undefined> = { main: undefined };
  // No iframe node, no frame of either kind: the settle cost ~250 ms on every read.
  if (!main.nodes.some((node) => node.role?.value === "Iframe")) {
    return { forest, sessions };
  }
  // A same-process frame is not in its session's tree (measured live 2026-09-27): each is read
  // with its own frameId, in the session that hosts it. Returns the session's root frame id.
  const readSameProcess = async (sessionId: string | undefined): Promise<string | undefined> => {
    let root: SessionFrameNode;
    try {
      ({ frameTree: root } = await connection.send<{ frameTree: SessionFrameNode }>(
        "Page.getFrameTree",
        {},
        sessionId,
      ));
    } catch {
      return undefined;
    }
    const walk = async (node: SessionFrameNode): Promise<void> => {
      for (const child of node.childFrames ?? []) {
        const frame = `f${forest.length}`;
        sessions[frame] = sessionId;
        const { id: frameId, url } = child.frame;
        try {
          const tree = await connection.send<{ nodes: AxRawNode[] }>(
            "Accessibility.getFullAXTree",
            { frameId },
            sessionId,
          );
          forest.push({ frame, url, frameId, nodes: tree.nodes });
        } catch (error) {
          forest.push({ frame, url, frameId, nodes: [], error: errorText(error) });
        }
        await walk(child);
      }
    };
    await walk(root);
    return root.frame.id;
  };
  const mainFrameId = await readSameProcess(undefined);
  if (mainFrameId) forest[0] = { ...forest[0], frameId: mainFrameId };
  const autoAttach = (on: boolean, sessionId?: string) =>
    connection.send(
      "Target.setAutoAttach",
      { autoAttach: on, waitForDebuggerOnStart: false, flatten: true },
      sessionId,
    );
  const read = new Set<string>();
  const deadline = Date.now() + FRAME_WAIT_MS;
  await autoAttach(true);
  for (;;) {
    const fresh = connection.attached.filter(
      (entry) => entry.type === "iframe" && !read.has(entry.sessionId),
    );
    for (const entry of fresh) {
      read.add(entry.sessionId);
      const frame = `f${forest.length}`;
      sessions[frame] = entry.sessionId;
      try {
        const tree = await connection.send<{ nodes: AxRawNode[] }>(
          "Accessibility.getFullAXTree",
          {},
          entry.sessionId,
        );
        forest.push({ frame, url: entry.url, frameId: entry.targetId, nodes: tree.nodes });
        await readSameProcess(entry.sessionId);
        await autoAttach(true, entry.sessionId);
      } catch (error) {
        forest.push({
          frame,
          url: entry.url,
          frameId: entry.targetId,
          nodes: [],
          error: errorText(error),
        });
      }
    }
    if (fresh.length > 0) {
      continue;
    }
    const pending = await unattachedFrameTargets(connection, sessions);
    if (pending.length === 0) {
      break;
    }
    if (Date.now() >= deadline) {
      for (const target of pending) {
        const error = `frame target did not attach within ${FRAME_WAIT_MS} ms`;
        forest.push({ frame: `f${forest.length}`, url: target.url, nodes: [], error });
      }
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, FRAME_POLL_MS));
  }
  return { forest, sessions };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface FrameTargetInfo {
  targetId: string;
  type: string;
  url: string;
  parentFrameId?: string;
}

/**
 * The out-of-process frame targets of this page that have no session yet: iframe targets whose
 * parent frame is one of the frames the page or an attached frame session hosts. (The page's own
 * frame tree lists only its in-process frames, and an `Iframe` node looks the same either way.)
 */
async function unattachedFrameTargets(
  connection: CdpConnection,
  sessions: Record<string, string | undefined>,
): Promise<FrameTargetInfo[]> {
  const frameIds = new Set<string>();
  type FrameNode = { frame: { id: string }; childFrames?: FrameNode[] };
  const collect = (node: FrameNode) => {
    frameIds.add(node.frame.id);
    for (const child of node.childFrames ?? []) collect(child);
  };
  for (const sessionId of Object.values(sessions)) {
    try {
      const { frameTree } = await connection.send<{ frameTree: FrameNode }>(
        "Page.getFrameTree",
        {},
        sessionId,
      );
      collect(frameTree);
    } catch {
      // a frame that went away hosts no frame to wait for
    }
  }
  const { targetInfos = [] } = await connection.send<{ targetInfos?: FrameTargetInfo[] }>(
    "Target.getTargets",
  );
  const attached = new Set(connection.attached.map((entry) => entry.targetId));
  return targetInfos.filter(
    (target) =>
      target.type === "iframe" &&
      target.parentFrameId !== undefined &&
      frameIds.has(target.parentFrameId) &&
      !attached.has(target.targetId),
  );
}

/**
 * End what a read attached: detach every frame session, then turn auto-attach off on the page.
 * The page socket is closed by the caller.
 */
export async function releaseForest(
  connection: CdpConnection,
  sessions: Record<string, string | undefined>,
): Promise<void> {
  // a same-process frame shares its host's session: detach each session once
  for (const sessionId of new Set(Object.values(sessions))) {
    if (sessionId) {
      await connection.send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
    }
  }
  await connection
    .send("Target.setAutoAttach", {
      autoAttach: false,
      waitForDebuggerOnStart: false,
      flatten: true,
    })
    .catch(() => undefined);
}

/** A fixed read-only function; `this` is the element, the argument selects what to read. */
const READ_FUNCTION = `function (what, name) {
  if (what === "visible") {
    const rect = this.getBoundingClientRect();
    const style = getComputedStyle(this);
    return String(rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none");
  }
  if (what === "text") return String(this.innerText ?? this.value ?? this.textContent ?? "").replace(/\\s+/g, " ").trim();
  return this.getAttribute ? (this.getAttribute(name) ?? "") : "";
}`;

/**
 * The evaluator's reader over the same connection: `visible`, `text` and `attr` for any ref the
 * rendering minted, read on the frame session the ref came from.
 */
export function createCdpCheckReader(
  connection: CdpConnection,
  handles: Record<string, AxHandle>,
  sessions: Record<string, string | undefined>,
): A11yCheckReader {
  const read = async (ref: string, what: string, name = ""): Promise<A11yCheckReading> => {
    const command = `${what}${name ? ` ${name}` : ""} ${ref}`;
    const handle = handles[ref];
    if (!handle) {
      throw new FrameworkError(
        "a11y_check_unavailable",
        `${ref} has no element handle in this snapshot, so ${what} cannot be read`,
        { ref },
      );
    }
    const sessionId = sessions[handle.frame];
    const { object } = await connection.send<{ object: { objectId: string } }>(
      "DOM.resolveNode",
      { backendNodeId: handle.backendNodeId },
      sessionId,
    );
    try {
      const { result } = await connection.send<{ result: { value?: unknown } }>(
        "Runtime.callFunctionOn",
        {
          objectId: object.objectId,
          functionDeclaration: READ_FUNCTION,
          arguments: [{ value: what }, { value: name }],
          returnByValue: true,
        },
        sessionId,
      );
      return { command, value: String(result.value ?? "") };
    } finally {
      await connection
        .send("Runtime.releaseObject", { objectId: object.objectId }, sessionId)
        .catch(() => undefined);
    }
  };
  return {
    visible: (ref) => read(ref, "visible"),
    text: (ref) => read(ref, "text"),
    attr: (ref, name) => read(ref, "attr", name),
  };
}
