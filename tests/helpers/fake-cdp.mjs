import { createHash } from "node:crypto";
import { createServer } from "node:http";

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
} = {}) {
  const methods = [];
  const sockets = new Set();
  let port = 0;

  const server = createServer((request, response) => {
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
            url: page.url,
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
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));

    // session id -> tree; the page itself is the session `undefined`
    const trees = new Map([[undefined, page?.tree ?? { nodes: [] }]]);
    // frame ids: the page's main frame is the target id; each frame gets one, and its parent's
    const frameIds = new Map();
    const targets = [];
    const index = (tree, parentId) => {
      for (const frame of tree?.frames ?? []) {
        frameIds.set(frame, frame.id ?? `FRAME${frameIds.size + 1}`);
        targets.push({ frame, parentId });
        index(frame, frameIds.get(frame));
      }
    };
    frameIds.set(trees.get(undefined), targetId);
    index(trees.get(undefined), targetId);
    const emitted = new Set();
    let nextSession = 0;
    let buffer = Buffer.alloc(0);

    const send = (value) => {
      const payload = Buffer.from(JSON.stringify(value));
      const header =
        payload.length < 126
          ? Buffer.from([0x81, payload.length])
          : payload.length < 65536
            ? Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
            : Buffer.concat([Buffer.from([0x81, 127]), bigLength(payload.length)]);
      socket.write(Buffer.concat([header, payload]));
    };

    let noisy = noise;
    const handle = (message) => {
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
                  targetId: frameIds.get(frame),
                  type: "iframe",
                  url: frame.url,
                  parentFrameId: parentId,
                })),
              ],
            },
          });
          return;
        case "Page.getFrameTree":
          if (tree?.error) {
            // a frame that errors on its tree (detached) errors on its frame tree too
            send({ id, error: { message: tree.error } });
            return;
          }
          send({
            id,
            result: { frameTree: { frame: { id: frameIds.get(tree), url: tree?.url } } },
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
                send({
                  method: "Target.attachedToTarget",
                  params: {
                    sessionId: child,
                    targetInfo: { targetId: frameIds.get(frame), type: "iframe", url: frame.url },
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
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        if (opcode === 1) handle(JSON.parse(payload.toString("utf8")));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    methods,
    openSockets: () => sockets.size,
    /** resolves with the open socket count once it reaches 0, or after `ms` */
    async drained(ms = 1000) {
      const deadline = Date.now() + ms;
      while (sockets.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return sockets.size;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
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
