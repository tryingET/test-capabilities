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
/** how long frame attachment may stay quiet before the forest is considered complete */
const FRAME_SETTLE_MS = 250;
const FRAME_ROUNDS = 8;

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
  private nextId = 0;
  readonly attached: Array<{ sessionId: string; type: string; url: string }> = [];

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
      params?: { sessionId?: string; targetInfo?: { type?: string; url?: string } };
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
        type: message.params.targetInfo?.type ?? "",
        url: message.params.targetInfo?.url ?? "",
      });
    }
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = ++this.nextId;
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

/** The page's tree and one per out-of-process frame, plus the session each frame was read on. */
export interface AxForestRead {
  forest: AxFrameTree[];
  sessions: Record<string, string | undefined>;
}

/**
 * Read the forest: the page, then every out-of-process frame that attaches, recursively. Returns
 * once no new frame has attached for {@link FRAME_SETTLE_MS}, or after {@link FRAME_ROUNDS}
 * rounds. The frame sessions stay attached, so a check can still read inside a frame; the caller
 * ends them with {@link releaseForest}. (Turning auto-attach off on the page detaches every child
 * session in Chromium - measured live 2026-09-26 - so it must not happen before the checks.)
 */
export async function readAxForest(connection: CdpConnection): Promise<AxForestRead> {
  const main = await connection.send<{ nodes: AxRawNode[] }>("Accessibility.getFullAXTree");
  const forest: AxFrameTree[] = [{ frame: "main", url: "", nodes: main.nodes }];
  const sessions: Record<string, string | undefined> = { main: undefined };
  const autoAttach = (on: boolean, sessionId?: string) =>
    connection.send(
      "Target.setAutoAttach",
      { autoAttach: on, waitForDebuggerOnStart: false, flatten: true },
      sessionId,
    );
  const read = new Set<string>();
  await autoAttach(true);
  for (let round = 0; round < FRAME_ROUNDS; round++) {
    await new Promise((resolve) => setTimeout(resolve, FRAME_SETTLE_MS));
    const fresh = connection.attached.filter(
      (entry) => entry.type === "iframe" && !read.has(entry.sessionId),
    );
    if (fresh.length === 0) {
      break;
    }
    for (const entry of fresh) {
      read.add(entry.sessionId);
      const frame = `f${read.size}`;
      sessions[frame] = entry.sessionId;
      try {
        const tree = await connection.send<{ nodes: AxRawNode[] }>(
          "Accessibility.getFullAXTree",
          {},
          entry.sessionId,
        );
        forest.push({ frame, url: entry.url, nodes: tree.nodes });
        await autoAttach(true, entry.sessionId);
      } catch (error) {
        forest.push({
          frame,
          url: entry.url,
          nodes: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { forest, sessions };
}

/**
 * End what a read attached: detach every frame session, then turn auto-attach off on the page.
 * The page socket is closed by the caller.
 */
export async function releaseForest(
  connection: CdpConnection,
  sessions: Record<string, string | undefined>,
): Promise<void> {
  for (const sessionId of Object.values(sessions)) {
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
