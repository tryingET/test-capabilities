import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { createFakeDom } from "./fake-cdp-dom.mjs";

/**
 * A fake Chromium DevTools endpoint on 127.0.0.1:0 for the a11y channel (AK #5915): HTTP
 * `/json/version` and `/json/list`, and a minimal RFC 6455 WebSocket per page target that
 * answers the commands the producer sends from recorded accessibility trees.
 *
 * `pages` maps a target id to `{ url, title, tree: { nodes, frames: [{ url, nodes, frames }] } }`.
 * Frames attach recursively through `Target.setAutoAttach` as flattened sessions, the way
 * Chromium attaches out-of-process iframes: the attach events of existing frames come before the
 * command's answer (measured live 2026-09-27). A frame may set `lateMs` (it attaches that much
 * later) or `neverAttach`; every frame is listed by `Target.getTargets` with its `parentFrameId`. `reads` maps a backend node id to
 * `{ visible, text, attrs }` for the check reader. Every command is logged in `methods`, so a
 * test can prove the producer only ever read.
 *
 * The DOM half - elements, same-process frames, isolated worlds, hit tests, input, dialogs - is
 * `fake-cdp-dom.mjs`, one per page and shared by every socket to it; its record (`clicks`,
 * `values`, `input`, `keys`, `dialogs`, `worlds`) is exposed here for the first page.
 */
export async function startFakeCdp({
  pages = {},
  reads = {},
  browser = "Chrome/153.0.0.0",
  versionStatus = 200,
  // raw bodies for the endpoint's refusal cases, and socket noise before the first answer
  versionBody,
  listBody,
  noise = false,
  // TCP callbacks are not evidence of client WebSocket close completion.
  log,
  holdCloseReply = false,
} = {}) {
  const methods = [];
  const requests = [];
  let replyFault;
  let disconnectOnFault = true;
  let replyGate;
  const sockets = new Set();
  // one DOM per page, shared by every socket to it; session ids are unique across sockets
  const doms = new Map();
  let nextSession = 0;
  let port = 0;
  // every page socket ever opened: a caller that holds one connection opens one
  let opened = 0;
  let closeFrames = 0;
  let closeReplies = 0;
  let replyReleased = !holdCloseReply;
  const waitingReplies = [];
  let frameReceived;
  const closeFrameReceived = new Promise((resolve) => {
    frameReceived = resolve;
  });

  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/json/version") {
      response.writeHead(versionStatus, { "content-type": "application/json" });
      response.end(versionBody ?? JSON.stringify({ Browser: browser, "Protocol-Version": "1.3" }));
      return;
    }
    if (request.url === "/json/list") {
      response.writeHead(200, { "content-type": "application/json" });
      if (listBody !== undefined) {
        response.end(listBody);
        return;
      }
      response.end(
        JSON.stringify(
          Object.entries(pages).map(([id, page]) => ({
            id,
            type: "page",
            // the page's current URL, as Chromium lists it: a navigated tab is found by its id
            url: page.tree?.url ?? page.url,
            title: page.title ?? "",
            webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}`,
          })),
        ),
      );
      return;
    }
    response.writeHead(404);
    response.end("{}");
  });

  server.on("upgrade", (request, socket) => {
    const targetId = request.url.split("/").pop();
    const page = pages[targetId];
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    opened += 1;
    socket.on("close", () => {
      sockets.delete(socket);
      if (log) appendFileSync(log, `${JSON.stringify(["cdp.tcp.closed"])}\n`);
    });
    socket.on("error", () => sockets.delete(socket));

    // session id -> tree; the page itself is the session `undefined`
    const pageTree = page?.tree ?? { nodes: [] };
    const trees = new Map([[undefined, pageTree]]);
    // frame ids: the page's main frame is the target id; each out-of-process frame gets one
    const targets = [];
    const parents = new Map();
    pageTree.id ??= targetId;
    let frameCount = 0;
    const index = (tree) => {
      for (const frame of tree?.frames ?? []) {
        frame.id ??= `FRAME${++frameCount}`;
        parents.set(frame, tree);
        targets.push({ frame, parentId: tree.id });
        index(frame);
      }
    };
    index(pageTree);
    if (!doms.has(targetId))
      doms.set(
        targetId,
        createFakeDom(pageTree, () => {}),
      );
    const dom = doms.get(targetId);
    // the page coordinates of an out-of-process frame's viewport: its owners' boxes, summed
    const origin = (tree) => {
      const parent = parents.get(tree);
      if (!parent) return [0, 0];
      const [px, py] = origin(parent);
      return [px + tree.owner.box[0], py + tree.owner.box[1]];
    };
    dom.setPageOrigin((session) => origin(trees.get(session) ?? pageTree));
    const emitted = new Set();
    let buffer = Buffer.alloc(0);

    let handling;
    const send = (value) => {
      // The handler already acted; lose only its answer, not the input it received.
      if (value.id !== undefined && replyFault?.(handling)) {
        replyFault = undefined;
        if (disconnectOnFault) socket.destroy();
        return;
      }
      if (value.id !== undefined && replyGate?.predicate(handling)) {
        const gate = replyGate;
        replyGate = undefined;
        gate.handled(handling);
        gate.releaseReply = () =>
          send(gate.error ? { id: value.id, error: { message: gate.error } } : value);
        return;
      }
      const payload = Buffer.from(JSON.stringify(value));
      const header =
        payload.length < 126
          ? Buffer.from([0x81, payload.length])
          : payload.length < 65536
            ? Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
            : Buffer.concat([Buffer.from([0x81, 127]), bigLength(payload.length)]);
      socket.write(Buffer.concat([header, payload]));
    };

    dom.setEmit(send);
    let noisy = noise;
    const handle = (message) => {
      handling = message;
      const { id, method, params = {}, sessionId } = message;
      if (noisy) {
        // what a real socket may carry: a frame that is not JSON, and an answer nobody asked for
        noisy = false;
        const garbage = Buffer.from("not json");
        socket.write(Buffer.concat([Buffer.from([0x81, garbage.length]), garbage]));
        send({ id: 999999, result: {} });
      }
      methods.push(sessionId ? `${method}@${sessionId}` : method);
      const tree = trees.get(sessionId);
      if (sessionId !== undefined && !trees.has(sessionId)) {
        send({ id, error: { message: "Session with given id not found." } });
        return;
      }
      if (method === "Page.getFrameTree" && tree?.frameTreeError) {
        send({ id, error: { message: tree.frameTreeError } });
        return;
      }
      if (method === "Target.detachFromTarget" && trees.has(params.sessionId)) {
        send({ id, result: {} });
        send({ method: "Target.detachedFromTarget", params: { sessionId: params.sessionId } });
        return;
      }
      if (
        (method === "Page.getFrameTree" || method === "Accessibility.getFullAXTree") &&
        tree?.error
      ) {
        // a frame that errors on its tree (detached) errors on its frame tree too
        send({ id, error: { message: tree.error } });
        return;
      }
      if (dom.handle(message, send)) return;
      switch (method) {
        case "Accessibility.getFullAXTree":
          if (tree?.error) {
            send({ id, error: { message: tree.error } });
          } else {
            send({ id, result: { nodes: tree?.nodes ?? [] } });
          }
          return;
        case "Target.getTargets":
          send({
            id,
            result: {
              targetInfos: [
                // another tab's frame: its parent is no frame of this page
                { targetId: "OTHER", type: "iframe", url: "chrome://other/", parentFrameId: "X" },
                ...targets.map(({ frame, parentId }) => ({
                  targetId: frame.id,
                  type: "iframe",
                  url: frame.url,
                  parentFrameId: parentId,
                })),
              ],
            },
          });
          return;
        case "Target.setAutoAttach":
          if (!params.autoAttach && sessionId === undefined) {
            // as Chromium does: turning auto-attach off on the page detaches the child sessions
            for (const key of [...trees.keys()]) {
              if (key !== undefined) trees.delete(key);
            }
          }
          if (params.autoAttach) {
            for (const frame of tree?.frames ?? []) {
              if (emitted.has(frame) || frame.neverAttach) continue;
              emitted.add(frame);
              const attach = () => {
                const child = `S${++nextSession}`;
                trees.set(child, frame);
                dom.bindSession(frame, child);
                send({
                  method: "Target.attachedToTarget",
                  ...(sessionId ? { sessionId } : {}),
                  params: {
                    sessionId: child,
                    targetInfo: { targetId: frame.id, type: "iframe", url: frame.url },
                    waitingForDebugger: false,
                  },
                });
              };
              if (frame.lateMs) setTimeout(attach, frame.lateMs);
              else attach();
            }
          }
          send({ id, result: {} });
          return;
        case "DOM.resolveNode":
          send({ id, result: { object: { objectId: `obj:${params.backendNodeId}` } } });
          return;
        case "Runtime.callFunctionOn": {
          const backendId = Number(String(params.objectId).split(":")[1]);
          const node = reads[backendId] ?? {};
          const [what, name] = (params.arguments ?? []).map((argument) => argument.value);
          const value =
            what === "visible"
              ? String(node.visible ?? false)
              : what === "text"
                ? (node.text ?? "")
                : (node.attrs?.[name] ?? "");
          send({ id, result: { result: { type: "string", value } } });
          return;
        }
        case "DOM.getFrameOwner": {
          const frame = targets.find((target) => target.frame.id === params.frameId)?.frame;
          // Chromium answers only in the session that hosts the frame's parent
          if (!frame || trees.get(sessionId) !== parents.get(frame)) {
            send({ id, error: { message: "Frame with the given id was not found." } });
            return;
          }
          send({ id, result: { backendNodeId: frame.owner.backendNodeId } });
          return;
        }
        case "DOM.getBoxModel": {
          const owned = targets.find(
            (target) => target.frame.owner?.backendNodeId === params.backendNodeId,
          );
          const [x, y, w, h] = owned.frame.owner.box;
          send({ id, result: { model: { content: [x, y, x + w, y, x + w, y + h, x, y + h] } } });
          return;
        }
        default:
          send({ id, result: {} });
      }
    };

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const masked = (buffer[1] & 0x80) !== 0;
        const maskOffset = offset;
        if (masked) offset += 4;
        if (buffer.length < offset + length) return;
        const payload = Buffer.from(buffer.subarray(offset, offset + length));
        if (masked) {
          for (let index = 0; index < payload.length; index++) {
            payload[index] ^= buffer[maskOffset + (index % 4)];
          }
        }
        buffer = buffer.subarray(offset + length);
        if (opcode === 8) {
          closeFrames += 1;
          if (log) appendFileSync(log, `${JSON.stringify(["cdp.close.frame"])}\n`);
          const reply = () => {
            closeReplies += 1;
            if (log) appendFileSync(log, `${JSON.stringify(["cdp.close.reply"])}\n`);
            socket.end(Buffer.concat([Buffer.from([0x88, payload.length]), payload]));
          };
          if (replyReleased) reply();
          else waitingReplies.push(reply);
          frameReceived();
          return;
        }
        if (opcode === 1) handle(JSON.parse(payload.toString("utf8")));
      }
    });
  });

  const firstDom = () => doms.values().next().value;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    methods,
    requests,
    dropReplyAfterHandled(predicate, { disconnect = true } = {}) {
      replyFault = predicate;
      disconnectOnFault = disconnect;
    },
    disconnectUnexpectedly() {
      for (const socket of sockets) socket.destroy();
    },
    /** Stop after the fake handled a command, before its answer reaches the client. */
    gateReplyAfterHandled(predicate, { error } = {}) {
      const gate = { predicate, error };
      const handled = new Promise((resolve) => {
        gate.handled = resolve;
      });
      replyGate = gate;
      return { handled, release: () => gate.releaseReply() };
    },
    closeResponse: {
      received: closeFrameReceived,
      release() {
        replyReleased = true;
        for (const reply of waitingReplies.splice(0)) reply();
      },
      get frames() {
        return closeFrames;
      },
      get replies() {
        return closeReplies;
      },
    },
    get input() {
      return firstDom()?.record.input ?? [];
    },
    get clicks() {
      return firstDom()?.record.clicks ?? [];
    },
    get values() {
      return firstDom()?.record.values ?? {};
    },
    get keys() {
      return firstDom()?.record.keys ?? [];
    },
    get dialogs() {
      return firstDom()?.record.dialogs ?? [];
    },
    get worlds() {
      return firstDom()?.record.worlds ?? [];
    },
    /** the first page opens a dialog of its own, outside any command */
    openDialog(dialog) {
      firstDom()?.openDialog(dialog);
    },
    /** what a navigation does to every isolated world of the first page */
    dropWorlds() {
      firstDom()?.dropWorlds();
    },
    /** remote objects handed out and not released, by object id */
    get liveObjects() {
      return firstDom()?.record.live ?? new Map();
    },
    openSockets: () => sockets.size,
    socketsOpened: () => opened,
    /** resolves with the open socket count once it reaches 0, or after `ms` */
    async drained(ms = 1000) {
      const deadline = Date.now() + ms;
      while (sockets.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return sockets.size;
    },
    async close() {
      await Promise.all(
        [...sockets].map(
          (socket) =>
            new Promise((resolve) => {
              socket.once("close", resolve);
              socket.destroy();
            }),
        ),
      );
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function bigLength(length) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(length));
  return buffer;
}

/** A recorded forest file (`frames[]` with the page first) as the fake's nested tree. */
export function treeFromCapture(capture) {
  const [main, ...frames] = capture.frames;
  return {
    nodes: main.nodes,
    frames: frames.map((frame) => ({
      url: frame.url,
      nodes: frame.nodes ?? [],
      ...(frame.error ? { error: frame.error } : {}),
    })),
  };
}
