/**
 * The DOM half of the fake DevTools endpoint (CDP program S1): elements with state over time,
 * same-process child frames, isolated worlds, hit tests, input, dialogs and file inputs. The
 * transport, targets and accessibility trees stay in `fake-cdp.mjs`, which calls
 * `createFakeDom(page, emit)` once per page socket and hands it every command it does not own.
 *
 * A frame tree node (the page, an out-of-process frame, or a same-process frame) may carry:
 * - `elements`: `{ selector: element }`, boxes in that frame's own coordinates;
 * - `sameProcess`: in-process child frames `{ url, id?, nodes, elements, owner, sameProcess }`;
 * - `owner`: the iframe element in the parent `{ backendNodeId, box }` (content box);
 * - `evals`: `{ expression: value }`.
 * An element may carry: `backendNodeId`, `box` (null: no box), `appearAfterMs`, `movingUntilMs`,
 * `disabled`, `readonly`, `hidden`, `obscured`, `removed`, `options`, `type`, `checked`, `stuck`
 * (a checkbox that ignores clicks), `dialog` (`{ type, message }` opened by a click).
 *
 * Module functions are dispatched on their marker comment (`tc:state`, `tc:hit`, ...), never on
 * their body, so a change of implementation cannot silently change what the fake answers.
 */

export function createFakeDom(page, initialEmit) {
  let emit = initialEmit;
  const started = Date.now();
  const now = () => Date.now() - started;
  const record = {
    clicks: [],
    values: {},
    keys: [],
    dialogs: [],
    input: [],
    worlds: [],
    live: new Map(),
  };
  // every remote object handed out is counted, and released ones are taken off
  const handOut = (backendNodeId) => {
    const objectId = `obj:${backendNodeId}`;
    record.live.set(objectId, (record.live.get(objectId) ?? 0) + 1);
    return objectId;
  };

  // every frame node, with the session that hosts it and its same-process parent
  const frames = [];
  const index = (tree, session, parent) => {
    frames.push({ tree, session, parent });
    for (const child of tree.sameProcess ?? []) index(child, session, tree);
  };
  const sessionsOf = new Map(); // tree -> session id (undefined: the page)
  // a frame attached again (another socket) replaces its entries instead of adding a second copy
  const bindSession = (tree, session) => {
    const subtree = new Set();
    const walk = (node) => {
      subtree.add(node);
      for (const child of node.sameProcess ?? []) walk(child);
    };
    walk(tree);
    for (let i = frames.length - 1; i >= 0; i--)
      if (subtree.has(frames[i].tree)) frames.splice(i, 1);
    sessionsOf.set(tree, session);
    index(tree, session, undefined);
  };
  bindSession(page, undefined);

  const frameIds = new Map();
  let nextFrame = 0;
  const frameIdOf = (tree) => {
    if (!frameIds.has(tree)) frameIds.set(tree, tree.id ?? `SP${++nextFrame}`);
    return frameIds.get(tree);
  };
  const entryOf = (tree) => frames.find((entry) => entry.tree === tree);
  // same-process offset of a frame inside its session's local root
  const localOffset = (tree) => {
    const entry = entryOf(tree);
    if (!entry?.parent) return [0, 0];
    const [px, py] = localOffset(entry.parent);
    return [px + tree.owner.box[0], py + tree.owner.box[1]];
  };
  const present = (element) =>
    !element.removed && (element.appearAfterMs === undefined || now() >= element.appearAfterMs);
  const elements = () =>
    frames.flatMap(({ tree, session }) =>
      Object.entries(tree.elements ?? {}).map(([selector, element]) => ({
        tree,
        session,
        selector,
        element,
      })),
    );
  const byBackend = (backendNodeId) =>
    elements().find((entry) => entry.element.backendNodeId === Number(backendNodeId));
  const objectOf = (objectId) => byBackend(String(objectId).split(":")[1]);
  // the element's box in its session's local root, moving until `movingUntilMs`
  const localBox = ({ tree, element }) => {
    if (!element.box || element.hidden) return null;
    const [ox, oy] = localOffset(tree);
    const drift =
      element.movingUntilMs !== undefined && now() < element.movingUntilMs ? 1 + (now() % 7) : 0;
    const [x, y, w, h] = element.box;
    return [ox + x + drift, oy + y, w, h];
  };

  const worlds = new Map(); // context id -> tree
  let nextContext = 100;
  let focused;
  let pendingDialog;
  let pendingMove;

  const frameTreeOf = (tree) => ({
    frame: { id: frameIdOf(tree), url: tree.url },
    ...(tree.sameProcess?.length ? { childFrames: tree.sameProcess.map(frameTreeOf) } : {}),
  });
  const treeInSession = (session, frameId) =>
    frames.find((entry) => entry.session === session && frameIdOf(entry.tree) === frameId)?.tree;
  const rootOf = (session) =>
    frames.find((entry) => entry.session === session && !entry.parent)?.tree;

  const nodeError = (id) => ({ id, error: { message: "No node with given id found" } });

  /** Answer `message` if it is a DOM command; returns false for the transport to handle. */
  function handle(message, send) {
    const { id, method, params = {}, sessionId } = message;
    const reply = (result) => send({ id, result });
    switch (method) {
      case "Page.getFrameTree": {
        const root = rootOf(sessionId);
        if (!root) return false;
        reply({ frameTree: frameTreeOf(root) });
        return true;
      }
      case "Page.enable":
        reply({});
        return true;
      case "Page.handleJavaScriptDialog":
        record.dialogs.push({
          ...pendingDialog,
          accept: params.accept,
          promptText: params.promptText,
        });
        pendingDialog = undefined;
        reply({});
        return true;
      case "Accessibility.getFullAXTree": {
        if (!params.frameId) return false;
        const tree = treeInSession(sessionId, params.frameId);
        if (tree?.error) {
          send({ id, error: { message: tree.error } });
          return true;
        }
        reply({ nodes: tree?.nodes ?? [] });
        return true;
      }
      case "Page.createIsolatedWorld": {
        const tree = treeInSession(sessionId, params.frameId) ?? rootOf(sessionId);
        const contextId = ++nextContext;
        worlds.set(contextId, tree);
        record.worlds.push({ frame: tree?.url, name: params.worldName });
        reply({ executionContextId: contextId });
        return true;
      }
      case "Runtime.evaluate": {
        if (params.contextId && !worlds.has(params.contextId)) {
          send({ id, error: { message: "Cannot find context with specified id" } });
          return true;
        }
        const tree = params.contextId ? worlds.get(params.contextId) : rootOf(sessionId);
        if (!tree) return false;
        const query = /^document\.querySelector\((".*")\)$/.exec(params.expression);
        if (query) {
          const element = tree.elements?.[JSON.parse(query[1])];
          reply({
            result:
              element && present(element)
                ? { type: "object", objectId: handOut(element.backendNodeId) }
                : { type: "object", subtype: "null", value: null },
          });
          return true;
        }
        if (Object.hasOwn(tree.evals ?? {}, params.expression)) {
          const value = tree.evals[params.expression];
          reply({
            result: { type: typeof value, value: params.contextId ? `isolated:${value}` : value },
          });
          return true;
        }
        reply({
          result: { type: "object", subtype: "error" },
          exceptionDetails: {
            text: "Uncaught",
            exception: { description: "ReferenceError: nope is not defined" },
          },
        });
        return true;
      }
      case "DOM.resolveNode": {
        if (params.executionContextId && !worlds.has(params.executionContextId)) {
          send({ id, error: { message: "Cannot find context with specified id" } });
          return true;
        }
        if (Number(params.backendNodeId) === 8888) {
          // a cover that lives in another frame: not resolvable in this frame's world
          send({ id, error: { message: "Node with given id does not belong to the document" } });
          return true;
        }
        if (Number(params.backendNodeId) === 9999) {
          reply({ object: { objectId: handOut(9999) } });
          return true;
        }
        const entry = byBackend(params.backendNodeId);
        if (!entry) return false;
        // a removed node still resolves in Chromium, detached (measured live 2026-09-27); one that
        // never appeared does not
        if (!entry.element.removed && !present(entry.element)) {
          send(nodeError(id));
          return true;
        }
        reply({ object: { objectId: handOut(params.backendNodeId) } });
        return true;
      }
      case "Runtime.releaseObject": {
        const count = record.live.get(params.objectId) ?? 0;
        if (count <= 1) record.live.delete(params.objectId);
        else record.live.set(params.objectId, count - 1);
        reply({});
        return true;
      }
      case "Runtime.callFunctionOn": {
        const entry = objectOf(params.objectId);
        const marker = /\/\* tc:([a-z-]+) \*\//.exec(params.functionDeclaration)?.[1];
        if (!marker) return false;
        const element = entry?.element ?? {};
        const args = (params.arguments ?? []).map(
          (argument) => argument.value ?? argument.objectId,
        );
        let value;
        if (marker === "state" && element.stateThrows) {
          reply({
            result: { type: "object", subtype: "error" },
            exceptionDetails: {
              text: "Uncaught",
              exception: { description: "TypeError: frame detached" },
            },
          });
          return true;
        }
        if (marker === "state") {
          value = {
            attached: Boolean(entry) && present(element) && !element.removed,
            visible: Boolean(element.box) && !element.hidden,
            enabled: !element.disabled,
            editable: !element.disabled && !element.readonly,
            checked: element.checked ?? null,
            tag: element.options ? "SELECT" : element.type === "file" ? "INPUT" : "OTHER",
            type: element.type ?? null,
          };
        } else if (marker === "same-node") {
          value = objectOf(args[0])?.element === element;
        } else if (marker === "select-option") {
          const option = (element.options ?? []).find(
            (candidate) => candidate.value === args[0] || candidate.label === args[0],
          );
          if (option) record.values[entry.selector] = option.value;
          value = Boolean(option);
        } else if (marker === "connected") {
          value = Boolean(entry) && !element.removed;
        } else if (marker === "select-all" || marker === "focus-check") {
          value = true;
        } else {
          return false;
        }
        reply({ result: { type: typeof value, value } });
        return true;
      }
      case "DOM.scrollIntoViewIfNeeded":
        reply({});
        return true;
      case "DOM.getContentQuads": {
        const entry = objectOf(params.objectId);
        if (!entry) return false;
        const box = localBox(entry);
        if (!box) {
          reply({ quads: [] });
          return true;
        }
        const [x, y, w, h] = box;
        reply({ quads: [[x, y, x + w, y, x + w, y + h, x, y + h]] });
        return true;
      }
      case "DOM.getNodeForLocation": {
        // as Chromium does (measured live 2026-09-27): x and y must be integers
        if (!Number.isInteger(params.x) || !Number.isInteger(params.y)) {
          send({ id, error: { message: "Invalid parameters" } });
          return true;
        }
        const found = elements().find((entry) => {
          if (entry.session !== sessionId || !present(entry.element)) return false;
          const box = localBox(entry);
          return (
            box &&
            params.x >= box[0] &&
            params.x <= box[0] + box[2] &&
            params.y >= box[1] &&
            params.y <= box[1] + box[3]
          );
        });
        // a covered element hits the cover (backend 9999), which is no element of ours
        const cover = found?.element.obscured === "other-frame" ? 8888 : 9999;
        reply({
          backendNodeId: found && !found.element.obscured ? found.element.backendNodeId : cover,
        });
        return true;
      }
      case "DOM.focus":
        focused = objectOf(params.objectId);
        reply({});
        return true;
      case "Input.insertText":
        record.values[focused.selector] = params.text;
        reply({});
        return true;
      case "Input.dispatchKeyEvent":
        record.keys.push({
          type: params.type,
          key: params.key,
          text: params.text,
          modifiers: params.modifiers ?? 0,
        });
        // a key that types nothing arrives as rawKeyDown, as Chromium takes it
        if ((params.type === "keyDown" || params.type === "rawKeyDown") && focused) {
          if (params.key === "Delete") record.values[focused.selector] = "";
          else if (params.text)
            record.values[focused.selector] = (record.values[focused.selector] ?? "") + params.text;
        }
        reply({});
        return true;
      case "DOM.setFileInputFiles": {
        const entry = objectOf(params.objectId);
        record.values[entry.selector] = params.files;
        reply({});
        return true;
      }
      case "Input.dispatchMouseEvent": {
        // Chromium aligns a move to the next animation frame; a window that paints no frames acks
        // it only after ~1 s, while a press flushes the queued move at once (measured live)
        if (params.type === "mouseMoved" && page.moveAckDelayMs) {
          record.input.push({
            type: params.type,
            x: params.x,
            y: params.y,
            session: sessionId ?? "page",
          });
          const timer = setTimeout(() => {
            pendingMove = undefined;
            reply({});
          }, page.moveAckDelayMs);
          pendingMove = { flush: () => (clearTimeout(timer), reply({})) };
          return true;
        }
        if (params.type === "mousePressed" && pendingMove) {
          pendingMove.flush();
          pendingMove = undefined;
        }
        record.input.push({
          type: params.type,
          x: params.x,
          y: params.y,
          button: params.button,
          clickCount: params.clickCount,
          session: sessionId ?? "page",
        });
        if (params.type === "mouseReleased") {
          const landed = pageHit(params.x, params.y);
          if (landed) {
            record.clicks.push({
              frame: landed.frame,
              selector: landed.selector,
              clickCount: params.clickCount,
            });
            const element = landed.element;
            if (element.type === "checkbox" && !element.stuck) element.checked = !element.checked;
            if (element.dialog) {
              pendingDialog = { ...element.dialog, frame: landed.frame };
              emit({
                method: "Page.javascriptDialogOpening",
                ...(landed.session ? { sessionId: landed.session } : {}),
                params: { ...element.dialog, url: landed.frame },
              });
            }
          }
        }
        reply({});
        return true;
      }
      default:
        return false;
    }
  }

  // page-level hit: out-of-process offsets come from `pageOrigin`, supplied by the transport
  let pageOrigin = () => [0, 0];
  function pageHit(x, y) {
    let found;
    for (const entry of elements()) {
      if (!present(entry.element) || entry.element.obscured) continue;
      const box = localBox(entry);
      if (!box) continue;
      const [ox, oy] = pageOrigin(entry.session);
      if (
        x >= ox + box[0] &&
        x <= ox + box[0] + box[2] &&
        y >= oy + box[1] &&
        y <= oy + box[1] + box[3]
      ) {
        found = { ...entry, frame: entry.tree === page ? "main" : entry.tree.url };
      }
    }
    return found;
  }

  return {
    handle,
    record,
    bindSession,
    /** what a navigation does to every isolated world */
    dropWorlds() {
      worlds.clear();
    },
    setEmit(fn) {
      emit = fn;
    },
    setPageOrigin(fn) {
      pageOrigin = fn;
    },
    frameIdOf,
  };
}
