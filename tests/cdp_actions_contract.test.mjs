import assert from "node:assert/strict";
import test from "node:test";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * Actions on the owned tab over our own CDP connection (AK #6099). The fake endpoint holds a small
 * DOM per frame and resolves every released click by a page-level hit test, so a click only
 * counts when its page coordinates land on the element - through out-of-process frames too.
 */

const { openCdpActions } = await importRuntimeModule("core/cdp-actions.js");

const URL_UNDER_TEST = "https://app.test/form";
const ax = (id, role, name, backendDOMNodeId, children = []) => ({
  nodeId: id,
  role: { value: role },
  ...(name ? { name: { value: name } } : {}),
  ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
  childIds: children,
});

function page() {
  const deep = {
    url: "https://deep.test/inner",
    owner: { backendNodeId: 51, box: [50, 100, 200, 100] },
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "link", "Deep", 31)],
    elements: { "#deep": { backendNodeId: 31, box: [5, 5, 40, 10] } },
  };
  const player = {
    url: "https://player.test/embed",
    owner: { backendNodeId: 50, box: [100, 200, 400, 300] },
    nodes: [
      ax("1", "RootWebArea", "", 0, ["2", "3"]),
      ax("2", "button", "Play", 21),
      ax("3", "Iframe", "", 51),
    ],
    elements: { "#play": { backendNodeId: 21, box: [20, 30, 60, 20] } },
    evals: { "document.title": "player" },
    frames: [deep],
  };
  return {
    url: URL_UNDER_TEST,
    nodes: [
      ax("1", "RootWebArea", "", 0, ["2", "3", "4", "5", "6"]),
      ax("2", "button", "Greet", 11),
      ax("3", "textbox", "Name", 12),
      ax("4", "combobox", "Size", 13),
      ax("5", "button", "Covered", 14),
      ax("6", "Iframe", "", 50),
    ],
    elements: {
      "#greet": { backendNodeId: 11, box: [10, 10, 80, 20] },
      "#name": { backendNodeId: 12, box: [10, 40, 100, 20] },
      "#size": {
        backendNodeId: 13,
        box: [10, 70, 60, 20],
        options: [
          { value: "S", label: "Small" },
          { value: "M", label: "Medium" },
        ],
      },
      "#covered": { backendNodeId: 14, box: [200, 10, 40, 20], obscured: true },
      "#hidden": { backendNodeId: 15, box: null },
    },
    evals: { "document.title": "form" },
    frames: [player],
  };
}

async function open(t) {
  const fake = await startFakeCdp({ pages: { P1: { url: URL_UNDER_TEST, tree: page() } } });
  const actions = await openCdpActions(URL_UNDER_TEST, {
    TEST_CAPABILITIES_CDP_ENDPOINT: fake.url,
  });
  t.after(async () => {
    await actions.close();
    await fake.close();
  });
  const ref = (role, name) =>
    Object.entries(actions.refs).find(([, entry]) => entry.role === role && entry.name === name)[0];
  return { fake, actions, ref };
}

/** Commands that would create, navigate or close something; actions never send one. */
const FORBIDDEN =
  /^(Page\.navigate|Page\.reload|Target\.createTarget|Target\.closeTarget|Emulation\.)/;

test("a click is real input at the element's centre, and lands on it", async (t) => {
  const { fake, actions, ref } = await open(t);
  await actions.click({ ref: ref("button", "Greet") });
  assert.deepEqual(
    fake.input.map((event) => [event.type, event.x, event.y, event.session]),
    [
      ["mouseMoved", 50, 20, "page"],
      ["mousePressed", 50, 20, "page"],
      ["mouseReleased", 50, 20, "page"],
    ],
  );
  assert.deepEqual(fake.clicks, [{ frame: "main", selector: "#greet" }]);
});

test("a click inside a cross-origin frame, and inside a frame in that frame, lands on the element", async (t) => {
  const { fake, actions, ref } = await open(t);
  await actions.click({ ref: ref("button", "Play") });
  await actions.click({ selector: "#deep", frame: "https://deep.test/inner" });
  // page coordinates: every enclosing iframe's content origin plus the element's centre
  assert.deepEqual(
    fake.input.filter((event) => event.type === "mouseReleased").map((event) => [event.x, event.y]),
    [
      [150, 240],
      [175, 310],
    ],
  );
  assert.deepEqual(fake.clicks, [
    { frame: "https://player.test/embed", selector: "#play" },
    { frame: "https://deep.test/inner", selector: "#deep" },
  ]);
  assert.ok(
    fake.input.every((event) => event.session === "page"),
    "input goes to the page, which routes it",
  );
});

test("a covered element is refused before any button goes down", async (t) => {
  const { fake, actions, ref } = await open(t);
  await assert.rejects(actions.click({ ref: ref("button", "Covered") }), {
    code: "action_target_obscured",
  });
  await assert.rejects(actions.click({ selector: "#hidden" }), {
    code: "action_target_obscured",
    message: /has no box/,
  });
  assert.equal(fake.input.filter((event) => event.type === "mousePressed").length, 0);
});

test("a selector or a frame that is not there is a typed refusal, never a guess", async (t) => {
  const { actions } = await open(t);
  await assert.rejects(actions.click({ selector: "#nope" }), { code: "action_target_not_found" });
  await assert.rejects(actions.click({ ref: "e99" }), { code: "action_target_not_found" });
  await assert.rejects(actions.click({ selector: "#play", frame: "https://elsewhere.test/" }), {
    code: "action_frame_unknown",
  });
});

test("fill types trusted text into the focused field; an empty fill deletes the selection", async (t) => {
  const { fake, actions, ref } = await open(t);
  await actions.fill({ ref: ref("textbox", "Name") }, "Ada");
  assert.equal(fake.values["#name"], "Ada");
  assert.ok(fake.methods.includes("DOM.focus") && fake.methods.includes("Input.insertText"));
  await actions.fill({ selector: "#name" }, "");
  assert.equal(fake.values["#name"], "");
});

test("select picks an option by value or by label, and refuses one that is not offered", async (t) => {
  const { fake, actions, ref } = await open(t);
  await actions.select({ ref: ref("combobox", "Size") }, "M");
  assert.equal(fake.values["#size"], "M");
  await actions.select({ selector: "#size" }, "Small");
  assert.equal(fake.values["#size"], "S");
  await assert.rejects(actions.select({ selector: "#size" }, "XL"), {
    code: "action_option_not_found",
  });
});

test("evaluate answers inside any frame - the read surf refuses in a selected frame", async (t) => {
  const { actions } = await open(t);
  assert.equal(await actions.evaluate("document.title"), "form");
  assert.equal(await actions.evaluate("document.title", "https://player.test/embed"), "player");
  await assert.rejects(actions.evaluate("nope"), {
    code: "action_evaluate_failed",
    message: /ReferenceError: nope is not defined/,
  });
});

test("every resolved element is released, the frames are detached, and nothing is created or navigated", async (t) => {
  const { fake, actions, ref } = await open(t);
  await actions.click({ ref: ref("button", "Play") });
  await actions.fill({ selector: "#name" }, "x");
  await actions.close();
  const count = (prefix) => fake.methods.filter((method) => method.startsWith(prefix)).length;
  const resolved =
    count("DOM.resolveNode") + fake.methods.filter((m) => m.startsWith("Runtime.evaluate")).length;
  assert.equal(count("Runtime.releaseObject"), resolved);
  assert.equal(count("Target.detachFromTarget"), 2);
  assert.deepEqual(
    fake.methods.filter((method) => FORBIDDEN.test(method)),
    [],
  );
});
