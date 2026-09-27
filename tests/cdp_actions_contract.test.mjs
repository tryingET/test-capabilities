import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * Actions on the owned tab over our own CDP connection (AK #6099; CDP program S1, AK #6126).
 * The fake endpoint (`fake-cdp-dom.mjs`) holds a DOM per frame with state over time and resolves
 * every released click by a page-level hit test, so a click only counts when its page coordinates
 * land on the element - through out-of-process and same-process frames alike.
 */

const { openCdpActions } = await importRuntimeModule("core/cdp-actions.js");

const URL_UNDER_TEST = "https://app.test/form";
const SHORT = { timeoutMs: 250 };
const ax = (id, role, name, backendDOMNodeId, children = []) => ({
  nodeId: id,
  role: { value: role },
  ...(name ? { name: { value: name } } : {}),
  ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
  childIds: children,
});
const button = (backendNodeId, box, extra = {}) => ({ backendNodeId, box, ...extra });

function page() {
  const deep = {
    url: "https://deep.test/inner",
    owner: { backendNodeId: 51, box: [50, 100, 200, 100] },
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "link", "Deep", 31)],
    elements: { "#deep": button(31, [5, 5, 40, 10]) },
  };
  const player = {
    url: "https://player.test/embed",
    owner: { backendNodeId: 50, box: [100, 200, 400, 300] },
    nodes: [
      ax("1", "RootWebArea", "", 0, ["2", "3"]),
      ax("2", "button", "Play", 21),
      ax("3", "Iframe", "", 51),
    ],
    elements: { "#play": button(21, [20, 30, 60, 20]) },
    evals: { "document.title": "player" },
    frames: [deep],
  };
  const embedded = {
    url: "https://app.test/embedded",
    owner: { backendNodeId: 60, box: [400, 300, 200, 100] },
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "button", "Inner", 61)],
    elements: { "#inner": button(61, [10, 10, 50, 20]) },
    evals: { "document.title": "embedded" },
  };
  return {
    url: URL_UNDER_TEST,
    nodes: [
      ax("1", "RootWebArea", "", 0, ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]),
      ax("2", "button", "Greet", 11),
      ax("3", "textbox", "Name", 12),
      ax("4", "combobox", "Size", 13),
      ax("5", "button", "Covered", 14),
      ax("6", "checkbox", "Agree", 19),
      ax("7", "button", "Gone", 23),
      ax("8", "button", "Twin", 24),
      ax("9", "button", "Twin", 25),
      ax("10", "Iframe", "", 50),
      ax("11", "Iframe", "", 60),
    ],
    elements: {
      "#greet": button(11, [10, 10, 80, 20]),
      "#odd": button(27, [10.4, 100.25, 45.6, 21]),
      "#name": button(12, [10, 40, 100, 20]),
      "#size": button(13, [10, 70, 60, 20], {
        options: [
          { value: "S", label: "Small" },
          { value: "M", label: "Medium" },
        ],
      }),
      "#covered": button(14, [200, 10, 40, 20], { obscured: true }),
      "#hidden": button(15, null),
      "#late": button(16, [300, 10, 40, 20], { appearAfterMs: 200 }),
      "#disabled": button(17, [300, 40, 40, 20], { disabled: true }),
      "#moving": button(18, [300, 70, 40, 20], { movingUntilMs: 400 }),
      "#agree": button(19, [300, 100, 15, 15], { type: "checkbox", checked: false }),
      "#stuck": button(20, [300, 120, 15, 15], { type: "checkbox", checked: false, stuck: true }),
      "#file": button(26, [300, 140, 100, 20], { type: "file" }),
      "#alert": button(22, [300, 170, 40, 20], { dialog: { type: "alert", message: "hello" } }),
      "#gone": button(23, [300, 200, 40, 20]),
      "#twin-a": button(24, [300, 230, 40, 20]),
      "#twin-b": button(25, [300, 260, 40, 20]),
    },
    evals: { "document.title": "form" },
    frames: [player],
    sameProcess: [embedded],
  };
}

async function open(t, options = {}) {
  const tree = page();
  const fake = await startFakeCdp({ pages: { P1: { url: URL_UNDER_TEST, tree } } });
  const actions = await openCdpActions(
    URL_UNDER_TEST,
    { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url },
    options,
  );
  t.after(async () => {
    await actions.close();
    await fake.close();
  });
  const ref = (role, name) =>
    Object.entries(actions.refs).find(([, entry]) => entry.role === role && entry.name === name)[0];
  const released = () => fake.input.filter((event) => event.type === "mouseReleased");
  return { tree, fake, actions, ref, released };
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
  assert.deepEqual(fake.clicks, [{ frame: "main", selector: "#greet", clickCount: 1 }]);
});

test("a click in a window that paints no frames does not wait for the move's ack", async (t) => {
  const { tree, fake, actions } = await open(t);
  tree.moveAckDelayMs = 800;
  const started = Date.now();
  await actions.click({ selector: "#greet" });
  assert.ok(Date.now() - started < 400, `the press flushed the move (${Date.now() - started} ms)`);
  assert.deepEqual(
    fake.input.map((event) => event.type),
    ["mouseMoved", "mousePressed", "mouseReleased"],
  );
  assert.deepEqual(
    fake.clicks.map((click) => click.selector),
    ["#greet"],
  );
});

test("a click at a fractional centre, as real layouts have, is hit-tested and lands", async (t) => {
  const { fake, actions, released } = await open(t);
  await actions.click({ selector: "#odd" });
  assert.deepEqual(
    fake.clicks.map((click) => click.selector),
    ["#odd"],
  );
  assert.equal(released().at(-1).x, 33.2, "input keeps the exact centre; only the hit test rounds");
});

test("clicks land in a cross-origin frame, a frame inside it, and a same-process frame", async (t) => {
  const { tree, fake, actions, ref, released } = await open(t);
  // the agent's window sits on an unseen workspace and paints no frames: Chromium then routes
  // page-level input into an out-of-process frame only some of the time (measured live
  // 2026-09-27: 4 of 10 clicks landed on the host's <iframe>), and input sent on the frame's own
  // session always (10 of 10)
  tree.unpainted = true;
  await actions.click({ ref: ref("button", "Play") });
  await actions.click({ selector: "#deep", frame: "https://deep.test/inner" });
  await actions.click({ selector: "#inner", frame: "https://app.test/embedded" });
  await actions.click({ ref: ref("button", "Inner") });
  // each click is sent on the session that hosts its element, at the element's centre in that
  // session's own coordinates; same-process quads are already in the host's (measured live)
  assert.deepEqual(
    released().map((event) => [event.x, event.y]),
    [
      [50, 40],
      [25, 10],
      [435, 320],
      [435, 320],
    ],
  );
  const [player, deep, inner] = released().map((event) => event.session);
  assert.ok(player !== "page" && deep !== "page" && player !== deep, "each frame's own session");
  assert.equal(inner, "page", "a same-process frame's input goes to its host's session");
  assert.deepEqual(
    fake.clicks.map((click) => click.selector),
    ["#play", "#deep", "#inner", "#inner"],
  );
  assert.deepEqual(Object.values(actions.frames).sort(), [
    "https://app.test/embedded",
    "https://deep.test/inner",
    "https://player.test/embed",
  ]);
});

test("an action waits for an element that appears late, and for one that stops moving", async (t) => {
  // absent for the first 200 ms of the page's life: the click looks again until it is there
  const late = await open(t);
  const started = Date.now();
  await late.actions.click({ selector: "#late" });
  assert.ok(Date.now() - started >= 150, `it waited for the element (${Date.now() - started} ms)`);
  assert.deepEqual(
    late.fake.clicks.map((click) => click.selector),
    ["#late"],
  );
  // moving for the first 400 ms: the click waits for two equal samples, then lands at rest
  const moving = await open(t);
  await moving.actions.click({ selector: "#moving" });
  assert.deepEqual([moving.released().at(-1).x, moving.released().at(-1).y], [320, 80]);
});

test("an element that never becomes actionable is refused with the conditions that never held", async (t) => {
  const { fake, actions, ref } = await open(t);
  await assert.rejects(actions.click({ selector: "#disabled" }, SHORT), (error) => {
    assert.equal(error.code, "action_target_not_ready");
    assert.equal(error.details.conditions.enabled, false);
    return true;
  });
  await assert.rejects(actions.click({ selector: "#hidden" }, SHORT), (error) => {
    assert.equal(error.code, "action_target_not_ready");
    assert.equal(error.details.conditions.visible, false);
    return true;
  });
  await assert.rejects(actions.click({ ref: ref("button", "Covered") }, SHORT), {
    code: "action_target_obscured",
  });
  assert.equal(fake.input.filter((event) => event.type === "mousePressed").length, 0);
});

test("a role and name is found afresh; an ambiguous or missing one is refused, never guessed", async (t) => {
  const { fake, actions } = await open(t);
  await actions.click({ role: "button", name: "Greet" });
  assert.deepEqual(fake.clicks.at(-1).selector, "#greet");
  await assert.rejects(actions.click({ role: "button", name: "Twin" }, SHORT), (error) => {
    assert.equal(error.code, "action_target_ambiguous");
    assert.equal(error.details.candidates.length, 2);
    return true;
  });
  await assert.rejects(actions.click({ role: "button", name: "Nope" }, SHORT), {
    code: "action_target_not_found",
  });
  await assert.rejects(actions.click({ selector: "#nope" }, SHORT), {
    code: "action_target_not_found",
  });
  await assert.rejects(actions.click({ ref: "e99" }, SHORT), { code: "action_target_not_found" });
  await assert.rejects(actions.click({ selector: "#play", frame: "https://elsewhere.test/" }), {
    code: "action_frame_unknown",
  });
});

test("a ref whose element went away is drift, never a click on something else", async (t) => {
  const { tree, fake, actions, ref } = await open(t);
  const gone = ref("button", "Gone");
  tree.elements["#gone"].removed = true;
  await assert.rejects(actions.click({ ref: gone }, SHORT), { code: "ref_context_drift" });
  assert.equal(fake.clicks.length, 0);
});

test("fill and type are trusted text; press sends keys with their modifiers", async (t) => {
  const { fake, actions, ref } = await open(t);
  await actions.fill({ ref: ref("textbox", "Name") }, "Ada");
  assert.equal(fake.values["#name"], "Ada");
  await actions.fill({ selector: "#name" }, "");
  assert.equal(fake.values["#name"], "");
  await actions.type({ selector: "#name" }, "Bo7");
  assert.equal(fake.values["#name"], "Bo7");
  assert.deepEqual(
    fake.keys.filter((key) => key.type === "keyDown" && key.text).map((key) => key.text),
    ["B", "o", "7"],
  );
  await actions.press("Enter", { target: { selector: "#name" } });
  await actions.press("Shift+Tab");
  const tail = fake.keys.slice(-6).map((key) => `${key.type}:${key.key}:${key.modifiers}`);
  assert.deepEqual(tail, [
    "keyDown:Enter:0",
    "keyUp:Enter:0",
    "rawKeyDown:Shift:8",
    "rawKeyDown:Tab:8",
    "keyUp:Tab:8",
    "keyUp:Shift:0",
  ]);
  const before = fake.keys.length;
  await assert.rejects(actions.press("Hyper+x"), { code: "action_key_unknown" });
  await assert.rejects(actions.press("F99"), { code: "action_key_unknown" });
  assert.equal(fake.keys.length, before, "an unknown key sends nothing");
});

test("hover only moves; dblclick presses twice with rising click counts; modifiers are held", async (t) => {
  const { fake, actions } = await open(t);
  await actions.hover({ selector: "#greet" });
  assert.deepEqual(
    fake.input.map((event) => event.type),
    ["mouseMoved"],
  );
  await actions.dblclick({ selector: "#greet" });
  assert.deepEqual(
    fake.input.filter((event) => event.type === "mousePressed").map((event) => event.clickCount),
    [1, 2],
  );
  await actions.click({ selector: "#greet" }, { modifiers: ["Shift"], button: "right" });
  assert.equal(fake.input.at(-1).button, "right");
  assert.ok(fake.keys.some((key) => key.key === "Shift" && key.type === "rawKeyDown"));
  // in an out-of-process frame the held modifier goes to the same session as the click
  await actions.click(
    { selector: "#play", frame: "https://player.test/embed" },
    {
      modifiers: ["Shift"],
    },
  );
  const press = fake.input.at(-1);
  assert.notEqual(press.session, "page");
  assert.deepEqual(
    fake.keys.slice(-2).map((key) => [key.key, key.session]),
    [
      ["Shift", press.session],
      ["Shift", press.session],
    ],
  );
});

test("check and uncheck act only when needed and verify the state", async (t) => {
  const { fake, actions, ref, tree } = await open(t);
  await actions.check({ ref: ref("checkbox", "Agree") });
  assert.equal(tree.elements["#agree"].checked, true);
  const clicks = fake.clicks.length;
  await actions.check({ selector: "#agree" });
  assert.equal(fake.clicks.length, clicks, "already checked: no click");
  await actions.uncheck({ selector: "#agree" });
  assert.equal(tree.elements["#agree"].checked, false);
  await assert.rejects(actions.check({ selector: "#stuck" }), { code: "action_state_unchanged" });
  await assert.rejects(actions.check({ selector: "#greet" }), {
    code: "action_target_unsuitable",
  });
});

test("select picks by value or label and refuses a missing option or a non-select", async (t) => {
  const { fake, actions, ref } = await open(t);
  await actions.select({ ref: ref("combobox", "Size") }, "M");
  assert.equal(fake.values["#size"], "M");
  await actions.select({ selector: "#size" }, "Small");
  assert.equal(fake.values["#size"], "S");
  await assert.rejects(actions.select({ selector: "#size" }, "XL"), {
    code: "action_option_not_found",
  });
  await assert.rejects(actions.select({ selector: "#greet" }, "M"), {
    code: "action_target_unsuitable",
  });
});

test("setFiles sets existing files on a file input and refuses anything else", async (t) => {
  const { fake, actions } = await open(t);
  const dir = mkdtempSync(path.join(tmpdir(), "cdp-files-"));
  const file = path.join(dir, "cv.pdf");
  writeFileSync(file, "%PDF");
  await actions.setFiles({ selector: "#file" }, [file]);
  assert.deepEqual(fake.values["#file"], [file]);
  await assert.rejects(actions.setFiles({ selector: "#file" }, [path.join(dir, "absent.pdf")]), {
    code: "action_file_missing",
  });
  await assert.rejects(actions.setFiles({ selector: "#greet" }, [file]), {
    code: "action_target_unsuitable",
  });
});

test("a dialog an action opens is answered by policy and never left blocking", async (t) => {
  const dismissing = await open(t);
  await dismissing.actions.click({ selector: "#alert" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(dismissing.actions.dialogs, [
    { type: "alert", message: "hello", url: "main", answer: "dismissed" },
  ]);
  assert.equal(dismissing.fake.dialogs[0].accept, false);

  const accepting = await open(t, { dialogs: "accept", promptText: "yes" });
  await accepting.actions.click({ selector: "#alert" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(accepting.fake.dialogs[0].accept, true);
  assert.equal(accepting.fake.dialogs[0].promptText, "yes");

  const failing = await open(t, { dialogs: "fail" });
  await assert.rejects(
    (async () => {
      await failing.actions.click({ selector: "#alert" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await failing.actions.hover({ selector: "#greet" });
    })(),
    { code: "action_dialog_opened" },
  );
  assert.equal(failing.fake.dialogs[0].accept, false, "dismissed even when it fails the action");
});

test("evaluate runs in the page's world or an isolated one, in any frame", async (t) => {
  const { tree, actions, fake } = await open(t);
  assert.equal(await actions.evaluate("document.title"), "form");
  assert.equal(await actions.evaluate("document.title", "https://player.test/embed"), "player");
  // a same-process frame shares its host's session: its own main world is found by frame id,
  // never the host document's (measured live 2026-09-27: Runtime.enable reports one default
  // context per frame before it answers)
  assert.equal(await actions.evaluate("document.title", "https://app.test/embedded"), "embedded");
  // a navigation destroys the page world too: the next evaluate finds the new one
  fake.dropWorlds();
  assert.equal(await actions.evaluate("document.title", "https://app.test/embedded"), "embedded");
  assert.equal(
    await actions.evaluate("document.title", {
      frame: "https://app.test/embedded",
      world: "isolated",
    }),
    "isolated:embedded",
  );
  // a frame caught mid-navigation reports no page world: refused, never run in its host
  tree.sameProcess[0].noPageWorld = true;
  fake.dropWorlds();
  await assert.rejects(actions.evaluate("document.title", "https://app.test/embedded"), {
    code: "action_frame_unknown",
  });
  await assert.rejects(actions.evaluate("nope"), {
    code: "action_evaluate_failed",
    message: /ReferenceError: nope is not defined/,
  });
  // element reads go through the isolated world named for this channel
  await actions.click({ selector: "#greet" });
  assert.ok(fake.worlds.every((world) => world.name === "test-capabilities"));
  assert.ok(fake.worlds.length >= 2);
});

test("every remote object is released, frames are detached, and nothing is created or navigated", async (t) => {
  const { fake, actions, ref } = await open(t);
  await actions.click({ ref: ref("button", "Play") });
  await actions.fill({ selector: "#name" }, "x");
  await actions.click({ role: "button", name: "Greet" });
  await assert.rejects(actions.click({ selector: "#covered" }, SHORT), {
    code: "action_target_obscured",
  });
  await actions.close();
  await actions.close();
  assert.deepEqual([...fake.liveObjects.entries()], [], "no remote object outlives its action");
  assert.equal(fake.methods.filter((m) => m.startsWith("Target.detachFromTarget")).length, 2);
  assert.deepEqual(
    fake.methods.filter((method) => FORBIDDEN.test(method)),
    [],
  );
});

test("typing punctuation sends its character; a Control chord types nothing", async (t) => {
  const { fake, actions } = await open(t);
  await actions.type({ selector: "#name" }, "a-!");
  assert.equal(fake.values["#name"], "a-!");
  await actions.press("Control+a", { target: { selector: "#name" } });
  const chord = fake.keys.filter((key) => key.key === "a" && key.modifiers === 2);
  assert.deepEqual(
    chord.map((key) => [key.type, key.text]),
    [
      ["rawKeyDown", undefined],
      ["keyUp", undefined],
    ],
  );
});

test("a page without frames, a navigation's lost world, and a re-rendered page", async (t) => {
  const bare = {
    url: "https://app.test/bare",
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "button", "Only", 71)],
    elements: { "#only": button(71, [10, 10, 40, 20]) },
  };
  const fake = await startFakeCdp({ pages: { P1: { url: bare.url, tree: bare } } });
  const actions = await openCdpActions(bare.url, { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url });
  t.after(async () => {
    await actions.close();
    await fake.close();
  });
  await actions.click({ selector: "#only" });
  // a navigation destroys the isolated world: the next action makes a new one and still lands
  fake.dropWorlds();
  await actions.click({ selector: "#only" });
  fake.dropWorlds();
  await actions.click({ ref: Object.keys(actions.refs)[0] });
  assert.equal(fake.clicks.length, 3);
  // the page renders a new control: refresh() reads it
  bare.nodes[0].childIds.push("3");
  bare.nodes.push(ax("3", "button", "New", 72));
  bare.elements["#new"] = button(72, [10, 40, 40, 20]);
  await actions.refresh();
  assert.ok(Object.values(actions.refs).some((entry) => entry.name === "New"));
});

test("an element whose state cannot be read, or whose cover is in another frame, is refused", async (t) => {
  const { tree, actions } = await open(t);
  tree.elements["#flaky"] = button(80, [300, 290, 40, 20], { stateThrows: true });
  tree.elements["#shaded"] = button(81, [300, 320, 40, 20], { obscured: "other-frame" });
  await assert.rejects(actions.click({ selector: "#flaky" }, SHORT), (error) => {
    assert.equal(error.code, "action_target_not_ready");
    assert.equal(error.details.conditions.attached, false);
    return true;
  });
  await assert.rejects(actions.click({ selector: "#shaded" }, SHORT), {
    code: "action_target_obscured",
  });
});
