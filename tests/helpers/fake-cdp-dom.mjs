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
 * - `evals`: `{ expression: value }`;
 * - `form`: a `stub-dom.mjs` page model (`fields`, `controls`, `title`); any other script is
 *   evaluated against it, with the values the actions set laid over it.
 * A frame may carry `noPageWorld` (Runtime.enable reports no default context for it, as for a
 * frame caught mid-navigation). The page may carry `inputFails` (a mouse event type the
 * endpoint answers with an error), and `unpainted` (a window that paints no frames: input sent on
 * the page's session never reaches an out-of-process frame).
 * An element may carry: `backendNodeId`, `box` (null: no box), `appearAfterMs`, `movingUntilMs`,
 * `disabled`, `readonly`, `hidden`, `obscured`, `removed`, `options`, `type`, `checked`, `stuck`
 * (a checkbox that ignores clicks), `navigatesTo` (a click moves its frame to that URL),
 * `inputNavigatesTo` (typing into it moves its frame to that URL),
 * `dialog` (`{ type, message }` opened by a click), `betweenDocuments` (a click leaves its frame
 * answering that many reads with a destroyed context, as mid-navigation), `dialogOnRead` (a
 * click leaves a dialog that opens on its frame's next read). A frame may carry `probeFails` (every
 * plan probe read over the connection fails).
 *
 * Module functions are dispatched on their marker comment (`tc:state`, `tc:hit`, ...), never on
 * their body, so a change of implementation cannot silently change what the fake answers.
 */

import { DEFAULT_TIME_ORIGIN, normalizeStubPage, runInStub } from "../fixtures/stub-dom.mjs";

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

  let captured; // the element holding pointer capture since the last press, if any
  let clickBlocked = false; // an isolated world's one-shot click blocker is armed
  let guardArmed = false; // a flow's click-time guard is listening
  let guardBlocked = false; // it prevented a click
  const arraysById = new Map(); // a returned array's handle -> its members' object ids
  let arrays = 0;
  const worlds = new Map(); // isolated context id -> tree
  const pageWorlds = new Map(); // page-world context id -> tree
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

  // a frame's form model as the page shows it now: typed values, selected options and checked
  // states from the actions, over the values the model started with
  const formPage = (tree) => {
    const fields = {};
    for (const [selector, field] of Object.entries(tree.form.fields ?? {})) {
      const element = tree.elements?.[selector];
      fields[selector] = {
        ...field,
        ...(Object.hasOwn(record.values, selector) ? { value: record.values[selector] } : {}),
        ...(element && typeof element.checked === "boolean" ? { checked: element.checked } : {}),
      };
    }
    return normalizeStubPage({ ...tree.form, fields }, tree.url);
  };

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
      case "Runtime.enable": {
        // one default context per frame of the session, reported before the answer
        for (const entry of frames.filter((frame) => frame.session === sessionId)) {
          if (entry.tree.noPageWorld) continue;
          // an extension's isolated world comes first, as Chromium reports surf's (measured live)
          const extension = ++nextContext;
          worlds.set(extension, entry.tree);
          send({
            method: "Runtime.executionContextCreated",
            ...(sessionId ? { sessionId } : {}),
            params: {
              context: {
                id: extension,
                name: "Surf",
                auxData: { isDefault: false, type: "isolated", frameId: frameIdOf(entry.tree) },
              },
            },
          });
          const contextId = ++nextContext;
          pageWorlds.set(contextId, entry.tree);
          send({
            method: "Runtime.executionContextCreated",
            ...(sessionId ? { sessionId } : {}),
            params: {
              context: {
                id: contextId,
                name: "",
                auxData: { isDefault: true, type: "default", frameId: frameIdOf(entry.tree) },
              },
            },
          });
        }
        reply({});
        return true;
      }
      case "Runtime.disable":
        reply({});
        return true;
      case "Page.handleJavaScriptDialog":
        if (page.dialogHandleFails) {
          send({ id, error: { message: "dialog answer failed" } });
          return true;
        }
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
        if (tree?.worldError) {
          // a frame navigating away while the world is made
          send({ id, error: { message: tree.worldError } });
          return true;
        }
        const contextId = ++nextContext;
        worlds.set(contextId, tree);
        record.worlds.push({ frame: tree?.url, name: params.worldName });
        reply({ executionContextId: contextId });
        return true;
      }
      case "Runtime.evaluate": {
        if (
          params.contextId &&
          !worlds.has(params.contextId) &&
          !pageWorlds.has(params.contextId)
        ) {
          send({ id, error: { message: "Cannot find context with specified id" } });
          return true;
        }
        const isolated = worlds.has(params.contextId);
        const tree = params.contextId
          ? (worlds.get(params.contextId) ?? pageWorlds.get(params.contextId))
          : rootOf(sessionId);
        if (!tree) return false;
        const query = /^document\.querySelector\((".*")\)$/.exec(params.expression);
        if (query && JSON.parse(query[1]).includes(" >>> ")) {
          // as Chromium answers: `>>>` is no CSS combinator (a shadow path goes to tc:shadow-query)
          reply({
            result: { type: "object", subtype: "error" },
            exceptionDetails: {
              text: "Uncaught",
              exception: { description: "SyntaxError: not a valid selector" },
            },
          });
          return true;
        }
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
        // a shadow path (AK #6163): the element keyed by the whole path, or `shadowCounts[path]`
        // elements when the path reaches several (or none) - the page-side resolver itself runs
        // against the stub DOM, where the probe and the reads use it
        const shadow = /^\/\* tc:shadow-query (".*?") \*\//.exec(params.expression);
        if (shadow) {
          const path = JSON.parse(shadow[1]);
          const element = tree.elements?.[path];
          const count = tree.shadowCounts?.[path];
          reply({
            result:
              count === undefined && element && present(element)
                ? { type: "object", subtype: "node", objectId: handOut(element.backendNodeId) }
                : { type: "number", value: count ?? 0 },
          });
          return true;
        }
        const probe = /^\/\* tc:probe (".*?") \*\//.exec(params.expression);
        if (probe) {
          const element = tree.elements?.[JSON.parse(probe[1])];
          const value = Boolean(element && present(element) && element.box && !element.hidden);
          reply({ result: { type: "boolean", value } });
          return true;
        }
        if (params.expression === "String(performance.timeOrigin)") {
          const origin = String(tree.timeOrigin ?? DEFAULT_TIME_ORIGIN);
          reply({ result: { type: "string", value: origin } });
          return true;
        }
        if (params.expression === "location.href" && !tree.noHref) {
          reply({ result: { type: "string", value: tree.url } });
          return true;
        }
        if (Object.hasOwn(tree.evals ?? {}, params.expression)) {
          const value = tree.evals[params.expression];
          if (tree.evalDialogs?.[params.expression]) {
            pendingDialog = { ...tree.evalDialogs[params.expression], frame: tree.url };
            emit({
              method: "Page.javascriptDialogOpening",
              ...(sessionId ? { sessionId } : {}),
              params: { ...tree.evalDialogs[params.expression], url: tree.url },
            });
          }
          reply({
            result: { type: typeof value, value: isolated ? `isolated:${value}` : value },
          });
          return true;
        }
        if (tree.nextReadDialog && tree.form) {
          // a dialog a submit's handler opens while the page is being read
          pendingDialog = { ...tree.nextReadDialog, frame: tree.url };
          emit({
            method: "Page.javascriptDialogOpening",
            ...(sessionId ? { sessionId } : {}),
            params: { ...tree.nextReadDialog, url: tree.url },
          });
          delete tree.nextReadDialog;
        }
        if (tree.probeFails && params.expression.includes("__testCapabilitiesSurfPlanProbe")) {
          // a page that answers no plan probe over this connection
          send({ id, error: { message: "Execution context was destroyed" } });
          return true;
        }
        if (tree.betweenDocuments > 0) {
          // a frame between documents: its next reads fail as Chromium's do mid-navigation
          tree.betweenDocuments -= 1;
          send({ id, error: { message: "Execution context was destroyed" } });
          return true;
        }
        if (tree.form) {
          // any other script reads the frame's form model, with what the actions typed over it
          try {
            const value = runInStub(params.expression, formPage(tree));
            // A transient document change visible in this read-back, gone by the next observation.
            if (tree.readbackHref && params.expression.includes("found: el !== null"))
              value.href = tree.readbackHref;
            reply({ result: { type: typeof value, value: value ?? null } });
          } catch (error) {
            reply({
              result: { type: "object", subtype: "error" },
              exceptionDetails: { text: "Uncaught", exception: { description: String(error) } },
            });
          }
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
        // the page's own timer fires once the act let go of its element: a dialog after the step
        const released = objectOf(params.objectId);
        const later = released?.element.clicked ? released.element.laterDialog : undefined;
        if (later) {
          delete released.element.laterDialog;
          // a later task than the answer: the act has settled by the time the page asks
          setTimeout(() => {
            pendingDialog = { ...later, frame: released.tree.url };
            emit({
              method: "Page.javascriptDialogOpening",
              ...(released.session ? { sessionId: released.session } : {}),
              params: { ...later, url: released.tree.url },
            });
          }, 0);
        }
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
          const other = objectOf(args[0]);
          value = other?.element === element || (element.contains ?? []).includes(other?.selector);
        } else if (marker === "select-option") {
          const option = (element.options ?? []).find(
            (candidate) => candidate.value === args[0] || candidate.label === args[0],
          );
          if (option) record.values[entry.selector] = option.value;
          value = Boolean(option);
        } else if (marker === "click-path") {
          // the elements a click's path runs through, as the page model states them (`lightPath`)
          const members = [
            entry,
            ...(element.lightPath ?? []).map((key) => ({ element: entry.tree.elements?.[key] })),
          ]
            .filter((member) => member.element)
            .map((member) => handOut(member.element.backendNodeId));
          const arrayId = `arr:${++arrays}`;
          arraysById.set(arrayId, members);
          reply({ result: { type: "object", subtype: "array", objectId: arrayId } });
          return true;
        } else if (marker === "click-guard") {
          guardArmed = true;
          guardBlocked = false;
          value = true;
        } else if (marker === "click-guard-end") {
          guardArmed = false;
          value = guardBlocked;
        } else if (marker === "find-captor" && element.captorFails) {
          send({ id, error: { message: "Execution context was destroyed" } });
          return true;
        } else if (marker === "find-captor") {
          // the element holding pointer capture, by reference, or null
          reply({
            result: captured?.element
              ? {
                  type: "object",
                  subtype: "node",
                  objectId: handOut(captured.element.backendNodeId),
                }
              : { type: "object", subtype: "null", value: null },
          });
          return true;
        } else if (marker === "captor-gate") {
          // the element that holds pointer capture, judged as a click on it would be
          value = captured?.element?.gated === true;
        } else if (marker === "cancel-click") {
          // pointer capture released, and the next click blocked
          captured = undefined;
          clickBlocked = true;
          value = true;
        } else if (marker === "uncancel-click") {
          clickBlocked = false;
          value = true;
        } else if (marker === "focus-kept") {
          // focus is still where the act put it: on this element
          value = focused?.element === element;
        } else if (marker === "flow-gate") {
          // a flow's form-level control check, on what a click reaches
          value = element.gated === true;
        } else if (marker === "iframe-index") {
          value = element.iframeIndex ?? -1;
        } else if (marker === "document") {
          value = entry.tree.url;
        } else if (marker === "connected") {
          value = Boolean(entry) && !element.removed;
        } else if (marker === "select-all" || marker === "focus-check") {
          // a select handler that moves focus on
          if (marker === "select-all" && element.selectMovesFocusTo && focused) {
            const to = focused.tree.elements?.[element.selectMovesFocusTo];
            if (to) focused = { ...focused, selector: element.selectMovesFocusTo, element: to };
          }
          value = true;
        } else {
          return false;
        }
        reply({ result: { type: typeof value, value } });
        return true;
      }
      case "Runtime.getProperties": {
        const members = arraysById.get(params.objectId);
        if (!members) return false;
        reply({
          result: members.map((objectId, at) => ({
            name: String(at),
            value: { type: "object", objectId },
          })),
        });
        return true;
      }
      case "DOM.describeNode": {
        const described = objectOf(params.objectId);
        if (!described) return false;
        reply({
          node: {
            backendNodeId: described.element.backendNodeId,
            ...(described.element.closedShadow
              ? { shadowRoots: [{ shadowRootType: "closed" }] }
              : {}),
          },
        });
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
        const under = elements().filter((entry) => {
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
        // an element painted over the others (`onTop`) is what the point is on
        const found = under.find((entry) => entry.element.onTop) ?? under[0];
        // a covered element hits the cover (backend 9999), which is no element of ours
        let cover = found?.element.obscured === "other-frame" ? 8888 : 9999;
        // `hitOnce`: the first hit test reaches it, later ones a cover in another frame
        if (found?.element.hitOnce) {
          if (found.element.hitSeen) {
            cover = 8888;
            found.element.obscured = "other-frame";
          }
          found.element.hitSeen = true;
        }
        // a wrapper whose centre a descendant covers: the hit is the descendant; an element with
        // pointer-events: none is hit only when the caller asks to ignore that, as Chromium does
        const through =
          found?.element.pointerEventsNone && !params.ignorePointerEventsNone
            ? found.element.passesTo
            : undefined;
        const reached = through
          ? found.tree.elements?.[through]
          : found?.element.hitReaches
            ? found.tree.elements?.[found.element.hitReaches]
            : found?.element;
        reply({
          backendNodeId: found && !found.element.obscured ? reached.backendNodeId : cover,
        });
        return true;
      }
      case "DOM.getFrameOwner": {
        // a same-process frame's owner answers in the session that hosts both
        const owned = frames.find(
          (entry) =>
            entry.parent && entry.session === sessionId && frameIdOf(entry.tree) === params.frameId,
        );
        if (!owned) return false;
        reply({ backendNodeId: owned.tree.owner.backendNodeId });
        return true;
      }
      case "DOM.focus":
        // as Chromium answers for an element that takes no focus (a host without tabindex)
        if (objectOf(params.objectId)?.element.unfocusable) {
          send({ id, error: { message: "Element is not focusable" } });
          return true;
        }
        if (objectOf(params.objectId)?.element.focusFails) {
          send({ id, error: { message: objectOf(params.objectId).element.focusFails } });
          return true;
        }
        focused = objectOf(params.objectId);
        // a focus handler that moves focus on to another element
        if (focused?.element.focusMovesTo) {
          const to = focused.tree.elements?.[focused.element.focusMovesTo];
          focused = to
            ? { ...focused, selector: focused.element.focusMovesTo, element: to }
            : focused;
        }
        if (focused.element.focusDialog) {
          pendingDialog = { ...focused.element.focusDialog, frame: focused.tree.url };
          emit({
            method: "Page.javascriptDialogOpening",
            ...(focused.session ? { sessionId: focused.session } : {}),
            params: { ...focused.element.focusDialog, url: focused.tree.url },
          });
        }
        reply({});
        return true;
      case "Input.insertText":
        record.values[focused.selector] = params.text;
        // a change handler that navigates its frame
        if (focused.element.inputNavigatesTo) focused.tree.url = focused.element.inputNavigatesTo;
        if (focused.element.inputDialog) {
          pendingDialog = { ...focused.element.inputDialog, frame: focused.tree.url };
          emit({
            method: "Page.javascriptDialogOpening",
            ...(focused.session ? { sessionId: focused.session } : {}),
            params: { ...focused.element.inputDialog, url: focused.tree.url },
          });
        }
        reply({});
        return true;
      case "Input.dispatchKeyEvent":
        record.keys.push({
          type: params.type,
          key: params.key,
          text: params.text,
          modifiers: params.modifiers ?? 0,
          session: sessionId ?? "page",
        });
        // a key that makes the page click an element (an access key, a keydown handler): judged by
        // an armed click-time guard like any click
        if (params.type !== "keyUp" && focused?.element.keyClicks) {
          const clicked = focused.tree.elements?.[focused.element.keyClicks];
          if (guardArmed && clicked?.gated) guardBlocked = true;
          else if (clicked)
            record.clicks.push({ frame: "main", selector: focused.element.keyClicks });
        }
        // a modifier's keydown handler that moves focus on
        if (
          params.type === "rawKeyDown" &&
          ["Shift", "Control", "Alt", "Meta"].includes(params.key) &&
          focused?.element.modifierMovesFocusTo
        ) {
          const to = focused.tree.elements?.[focused.element.modifierMovesFocusTo];
          if (to)
            focused = { ...focused, selector: focused.element.modifierMovesFocusTo, element: to };
        }
        // Enter in a field whose form submits by it: its frame moves
        if (
          params.type === "keyDown" &&
          params.key === "Enter" &&
          focused?.element.enterNavigatesTo
        )
          focused.tree.url = focused.element.enterNavigatesTo;
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
        if (page.inputFails === params.type) {
          send({ id, error: { message: `${params.type} failed` } });
          return true;
        }
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
        if (params.type === "mousePressed") {
          const landed = sessionId
            ? sessionHit(sessionId, params.x, params.y)
            : pageHit(params.x, params.y);
          // a mousedown handler that makes the control form-level (sets its form=), captures the
          // pointer (setPointerCapture), or covers the control with another frame
          if (landed?.element.pressMakesGated) landed.element.gated = true;
          if (landed?.element.capturesPointer) captured = landed;
          // a pointerdown handler that hands the capture to another element
          if (landed?.element.pointerdownCaptures) {
            const to = landed.element.pointerdownCaptures;
            captured = { ...landed, selector: to, element: landed.tree.elements?.[to] };
          }
          if (landed?.element.pressObscures) landed.element.obscured = "other-frame";
          if (landed?.element.pressDialog) {
            pendingDialog = { ...landed.element.pressDialog, frame: landed.tree.url };
            emit({
              method: "Page.javascriptDialogOpening",
              ...(sessionId ? { sessionId } : {}),
              params: { ...landed.element.pressDialog, url: landed.tree.url },
            });
          }
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
          // releases outside the viewport cancel held input, they do not click a control - unless
          // the pointer is captured, when the release (and its click) go to the capturing element;
          // a blocked click completes nothing
          const hit = sessionId
            ? sessionHit(sessionId, params.x, params.y)
            : pageHit(params.x, params.y);
          let landed = clickBlocked ? undefined : (captured ?? hit);
          captured = undefined;
          // a mouseup handler that makes the control form-level before the click lands; an armed
          // click-time guard prevents a click that lands on a form-level control
          if (landed?.element.releaseMakesGated) landed.element.gated = true;
          // an onclick handler that does the same (judged by the guard's bubble listener)
          if (landed?.element.clickMakesGated) landed.element.gated = true;
          if (landed && guardArmed && landed.element.gated) {
            guardBlocked = true;
            landed = undefined;
          }
          if (landed) {
            record.clicks.push({
              frame: landed.frame,
              selector: landed.selector,
              clickCount: params.clickCount,
            });
            const element = landed.element;
            element.clicked = true;
            // a click that navigates another frame of the page
            if (element.navigatesFrame)
              element.navigatesFrame.frame.url = element.navigatesFrame.to;
            // a click that inserts a frame into its page (a checkout step revealing a payment form)
            if (element.revealsFrame) {
              const frame = element.revealsFrame;
              landed.tree.frames = [...(landed.tree.frames ?? []), frame];
              // the page's accessibility tree gains the frame's node, as Chromium's does
              landed.tree.nodes = [
                ...(landed.tree.nodes ?? []),
                {
                  nodeId: `frame-${frame.id}`,
                  role: { value: "Iframe" },
                  backendDOMNodeId: frame.owner?.backendNodeId,
                  childIds: [],
                },
              ];
              delete element.revealsFrame;
            }
            if (element.type === "checkbox" && !element.stuck) element.checked = !element.checked;
            // a submit that navigates its frame: same frame, same id, a new URL
            if (element.navigatesTo) landed.tree.url = element.navigatesTo;
            if (element.betweenDocuments) landed.tree.betweenDocuments = element.betweenDocuments;
            if (element.dialogOnRead) landed.tree.nextReadDialog = element.dialogOnRead;
            if (element.dialog) {
              pendingDialog = { ...element.dialog, frame: landed.frame };
              emit({
                method: "Page.javascriptDialogOpening",
                ...(landed.session ? { sessionId: landed.session } : {}),
                params: { ...element.dialog, url: landed.tree.url },
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

  // page-level hit: out-of-process offsets come from `pageOrigin`, supplied by the transport. In
  // an unpainted window page input never reaches an out-of-process frame (measured live).
  let pageOrigin = () => [0, 0];
  function pageHit(x, y) {
    let found;
    for (const entry of elements()) {
      if (!present(entry.element) || entry.element.obscured) continue;
      if (page.unpainted && entry.session !== undefined) continue;
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

  // input sent on a frame's own session: its elements, in that session's local coordinates
  function sessionHit(session, x, y) {
    let found;
    for (const entry of elements()) {
      if (entry.session !== session || !present(entry.element) || entry.element.obscured) continue;
      const box = localBox(entry);
      if (box && x >= box[0] && x <= box[0] + box[2] && y >= box[1] && y <= box[1] + box[3]) {
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
      pageWorlds.clear();
    },
    setEmit(fn) {
      emit = fn;
    },
    setPageOrigin(fn) {
      pageOrigin = fn;
    },
    /** the page opens a dialog of its own, outside any command (a timer) */
    openDialog(dialog) {
      pendingDialog = { ...dialog, frame: page.url };
      emit({ method: "Page.javascriptDialogOpening", params: { ...dialog, url: page.url } });
    },
    frameIdOf,
  };
}
