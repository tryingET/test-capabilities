import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { createFakeSurf, readyPages, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * A session step that names a frame runs over CDP inside the same ledger step (CDP program S4,
 * AK #6132): its declaration, key, receipt and settlement are a surf step's, only the channel
 * differs. The fake surf opens the tab; the fake DevTools endpoint holds the page, whose checkout
 * form lives in a cross-origin frame surf's own `js`/`type`/`click` cannot address.
 */

const { SurfSession } = await importRuntimeModule("core/surf-session.js");
const { SESSION_LIFECYCLE_EFFECT } = await importRuntimeModule("core/browser-session.js");
const { createRunContext } = await importRuntimeModule("core/run-context.js");

const URL_UNDER_TEST = "https://example.com/";
const PAY = "https://pay.example/checkout";
const READ_ONLY_JS = { effect: "read_only", reason: "reads the frame's title" };
const MUTATING = {
  effect: "mutating",
  scope: "target",
  reason: "fills and submits the checkout form in the payment frame",
};
const ax = (id, role, name, backendDOMNodeId, children = []) => ({
  nodeId: id,
  role: { value: role },
  ...(name ? { name: { value: name } } : {}),
  ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
  childIds: children,
});

function page() {
  const pay = {
    url: PAY,
    owner: { backendNodeId: 50, box: [100, 200, 400, 300] },
    nodes: [
      ax("1", "RootWebArea", "", 0, ["2", "3", "4"]),
      ax("2", "textbox", "Card", 21),
      ax("3", "combobox", "Country", 22),
      ax("4", "button", "Pay", 23),
    ],
    elements: {
      "#card": { backendNodeId: 21, box: [10, 10, 200, 20] },
      "#country": {
        backendNodeId: 22,
        box: [10, 40, 100, 20],
        options: [
          { value: "de", label: "Germany" },
          { value: "fr", label: "France" },
        ],
      },
      "#pay": { backendNodeId: 23, box: [10, 70, 60, 20] },
      "#covered": { backendNodeId: 24, box: [10, 100, 60, 20], obscured: true },
    },
    evals: { "document.title": "checkout" },
  };
  return {
    url: URL_UNDER_TEST,
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "Iframe", "", 50)],
    elements: { "#pay-frame": { backendNodeId: 50, box: [100, 200, 400, 300], iframeIndex: 0 } },
    frames: [pay],
  };
}

/** One session on the fake surf with the fake DevTools endpoint beside it. */
async function withFrameSession(body, { tree = page(), allow = true } = {}) {
  const surf = createFakeSurf({ pages: readyPages({ [URL_UNDER_TEST]: { links: [] } }) });
  const cdp = await startFakeCdp({ pages: { P1: { url: URL_UNDER_TEST, tree } } });
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-frame-step-"));
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  process.env.TEST_CAPABILITIES_CDP_ENDPOINT = cdp.url;
  try {
    await withFakeSurfEnv(surf.path, async () => {
      const context = createRunContext({
        operationId: "surf.explore",
        effect: SESSION_LIFECYCLE_EFFECT,
        env: {
          ...process.env,
          TEST_CAPABILITIES_RECEIPTS_DIR: dir,
          TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
        },
        config: { mutation: { allowOrigins: allow ? ["https://example.com"] : [] } },
      });
      const session = new SurfSession({ context, url: URL_UNDER_TEST, idPrefix: "test.frame" });
      try {
        await session.open();
        await session.gate();
        await body({ session, context, cdp, tree, surf });
      } finally {
        await session.close();
      }
    });
  } finally {
    if (previous === undefined) delete process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
    else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = previous;
    surf.cleanup();
    await cdp.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const step = (id, command, args, declare, extra = {}) => ({
  id,
  command,
  args,
  intent: id,
  declare,
  frame: PAY,
  read: (reply) => ({ payload: JSON.parse(reply.stdout), reply }),
  ...extra,
});

/** The surf verbs issued, without the capability probe every resolution makes. */
const verbs = (surf) =>
  surf
    .calls()
    .map((call) => call[0])
    .filter((command) => !command.startsWith("--"));

test("a read-only script in a frame reads in its isolated world, from the cdp channel, and writes no receipt", async () => {
  await withFrameSession(async ({ session, context, cdp, surf }) => {
    const { payload, reply } = await session.step(
      step("test.title", "js", ["document.title"], READ_ONLY_JS),
    );
    assert.deepEqual(payload, {
      result: "isolated:checkout",
      target: { frame: PAY, frameId: "FRAME1", channel: "cdp" },
    });
    assert.equal(reply.outcome.source, "cdp");
    assert.deepEqual(reply.display, ["cdp", "js", `frame=${PAY}`]);
    assert.deepEqual(context.ledger.receipts(), []);
    assert.ok(cdp.worlds.some((world) => world.name === "test-capabilities"));
    assert.equal(verbs(surf).includes("js"), false, "surf ran no script");
    // a read that throws is the read's own failure: nothing was at stake, so nothing is unknown
    await assert.rejects(session.step(step("test.nope", "js", ["nope"], READ_ONLY_JS)), {
      code: "action_evaluate_failed",
    });
  });
});

test("mutating steps in a frame type, select, click and script behind one applied receipt each", async () => {
  await withFrameSession(async ({ session, context, cdp, surf }) => {
    await session.step(step("test.card", "type", ["4242", "--selector", "#card"], MUTATING));
    const selected = await session.step(
      step("test.country", "select", ["#country", "fr"], MUTATING),
    );
    assert.equal(selected.payload.result, "Selected: fr");
    const clicked = await session.step(step("test.pay", "click", ["--selector", "#pay"], MUTATING));
    assert.equal(clicked.payload.result, "OK");
    // a mutating script runs in the page's own world, where the page's state is
    const own = await session.step(step("test.own", "js", ["document.title"], MUTATING));
    assert.equal(own.payload.result, "checkout");
    assert.equal(cdp.values["#card"], "4242");
    assert.equal(cdp.values["#country"], "fr");
    assert.deepEqual(cdp.clicks, [{ frame: PAY, selector: "#pay", clickCount: 1 }]);
    const receipts = context.ledger.receipts();
    assert.deepEqual(
      receipts.map((receipt) => [receipt.outcome, receipt.effect, receipt.scope]),
      [
        ["applied", "mutating", "target"],
        ["applied", "mutating", "target"],
        ["applied", "mutating", "target"],
        ["applied", "mutating", "target"],
      ],
    );
    assert.deepEqual(
      verbs(surf).filter((verb) => ["type", "select", "click"].includes(verb)),
      [],
    );
    // the key is spent exactly as a surf step's is
    await assert.rejects(
      session.step(step("test.pay", "click", ["--selector", "#pay"], MUTATING)),
      { code: "mutation_replay_refused" },
    );
    assert.equal(cdp.clicks.length, 1);
  });
});

test("a mutating step refused before any input is a failed receipt; the page saw nothing", async () => {
  await withFrameSession(async ({ session, context, cdp }) => {
    await assert.rejects(
      session.step(step("test.covered", "click", ["--selector", "#covered"], MUTATING)),
      { code: "action_target_obscured" },
    );
    assert.deepEqual(
      context.ledger.receipts().map((receipt) => receipt.outcome),
      ["failed"],
    );
    assert.deepEqual(cdp.input, []);
  });
});

test("a mutating step that fails after input was sent is unknown and never repeated", async () => {
  const tree = page();
  tree.inputFails = "mouseReleased";
  await withFrameSession(
    async ({ session, context }) => {
      await assert.rejects(
        session.step(step("test.pay", "click", ["--selector", "#pay"], MUTATING)),
        { code: "mutation_outcome_unknown" },
      );
      assert.deepEqual(
        context.ledger.receipts().map((receipt) => receipt.outcome),
        ["unknown"],
      );
      await assert.rejects(
        session.step(step("test.pay", "click", ["--selector", "#pay"], MUTATING)),
        { code: "mutation_replay_refused" },
      );
    },
    { tree },
  );
});

test("a command with no frame form, or malformed arguments, is refused before the page is touched", async () => {
  await withFrameSession(async ({ session, context, cdp }) => {
    await assert.rejects(session.step(step("test.shot", "screenshot", [], READ_ONLY_JS)), {
      code: "action_frame_step_unsupported",
    });
    assert.equal(cdp.methods.length, 0, "no DevTools connection was made");
    for (const [command, args] of [
      ["js", []],
      ["type", ["4242"]],
      ["select", ["#country"]],
      ["click", []],
    ]) {
      const declare = command === "js" ? READ_ONLY_JS : MUTATING;
      await assert.rejects(session.step(step(`test.bad-${command}`, command, args, declare)), {
        code: "action_frame_step_unsupported",
      });
    }
    // a malformed mutating step did nothing: its receipt says so
    assert.deepEqual(
      context.ledger.receipts().map((receipt) => receipt.outcome),
      ["failed", "failed", "failed"],
    );
    assert.deepEqual(cdp.input, []);
  });
});

test("a frame the tab does not have is refused as unknown before any input", async () => {
  await withFrameSession(async ({ session, context, cdp }) => {
    await assert.rejects(
      session.step(
        step("test.elsewhere", "click", ["--selector", "#pay"], MUTATING, {
          frame: "https://elsewhere.example/",
        }),
      ),
      { code: "action_frame_unknown" },
    );
    assert.deepEqual(
      context.ledger.receipts().map((receipt) => receipt.outcome),
      ["failed"],
    );
    assert.deepEqual(cdp.input, []);
  });
});

test("a mutating step in a frame is still bound by mutation.allowOrigins", async () => {
  await withFrameSession(
    async ({ session, cdp }) => {
      await assert.rejects(
        session.step(step("test.card", "type", ["4242", "--selector", "#card"], MUTATING)),
        { message: /mutation\.allowOrigins does not name it/ },
      );
      assert.equal(cdp.methods.length, 0);
    },
    { allow: false },
  );
});

test("a frame is pinned to the frame it first resolved to, so it stays addressable after it navigates", async () => {
  await withFrameSession(async ({ session, tree }) => {
    const first = await session.step(step("test.title", "js", ["document.title"], READ_ONLY_JS));
    const pinned = first.payload.target.frameId;
    assert.equal(typeof pinned, "string");
    // the frame navigates on its own (a submit, a redirect): the URL no longer names it
    tree.frames[0].url = "https://pay.example/done";
    const after = await session.step(step("test.title-2", "js", ["document.title"], READ_ONLY_JS));
    assert.equal(after.payload.target.frameId, pinned);
    assert.equal(after.payload.target.frame, PAY, "the reply names the frame as the caller did");
    // a frame that is gone is refused by the name the caller used, never guessed again by URL
    tree.frames.pop();
    await assert.rejects(
      session.step(step("test.title-3", "js", ["document.title"], READ_ONLY_JS)),
      { code: "action_frame_unknown", message: /https:\/\/pay\.example\/checkout.*pinned/ },
    );
  });
});

test("arguments are read by position: a value that reads as a flag is typed as the value", async () => {
  await withFrameSession(async ({ session, cdp }) => {
    // `type <text> --selector <css>`: the text is the first word whatever it looks like, and the
    // flags are looked up after it - `--into` is not a flag here, and `#card` is not the text
    await session.step(step("test.flag", "type", ["--into", "--selector", "#card"], MUTATING));
    assert.equal(cdp.values["#card"], "--into");
    await session.step(
      step("test.flag-2", "type", ["--selector", "--selector", "#card"], MUTATING),
    );
    assert.equal(cdp.values["#card"], "--selector");
    // `select <css> <value>`: a value that starts with -- is looked for as an option
    await assert.rejects(
      session.step(step("test.flag-select", "select", ["#country", "--de"], MUTATING)),
      { code: "action_option_not_found" },
    );
  });
});

test("a frame step that names its documents acts only while its frame holds one of them", async () => {
  await withFrameSession(async ({ session, context, cdp, tree }) => {
    const at = { frame: { name: PAY, documents: [PAY] } };
    await session.step(step("test.card", "type", ["4242", "--selector", "#card"], MUTATING, at));
    assert.equal(cdp.values["#card"], "4242");
    // the frame now holds another document with the same form: the element resolves, is
    // actionable, and still nothing is sent to it
    tree.frames[0].url = "https://pay.example/other";
    await assert.rejects(
      session.step(step("test.pay", "click", ["--selector", "#pay"], MUTATING, at)),
      { code: "action_document_changed", message: /https:\/\/pay\.example\/other/ },
    );
    assert.deepEqual(cdp.clicks, []);
    // a script that names its documents is not run in another one either
    await assert.rejects(
      session.step(step("test.script", "js", ["document.title"], MUTATING, at)),
      { code: "action_document_changed", message: /the script was not run/ },
    );
    // a frame whose document cannot be read is not one the script may run in
    tree.frames[0].url = PAY;
    tree.frames[0].noHref = true;
    await assert.rejects(
      session.step(step("test.script-2", "js", ["document.title"], MUTATING, at)),
      { code: "action_document_changed", message: /could not be read/ },
    );
    assert.deepEqual(
      context.ledger.receipts().map((receipt) => receipt.outcome),
      ["applied", "failed", "failed", "failed"],
    );
  });
});
