import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { startFakeCdp, treeFromCapture } from "./helpers/fake-cdp.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The a11y channel's CDP transport (AK #5915): the loopback rule, the owned-tab binding, the
 * recursive out-of-process frame read, and the check reader that finally gives the evaluator's
 * `visible`/`text`/`attr` expectations something to read. Everything runs against a fake DevTools
 * endpoint replaying recorded Chromium trees; the method log proves the producer only reads.
 */

const cdp = await importRuntimeModule("core/a11y-cdp.js");
const { openA11yLiveView } = await importRuntimeModule("core/a11y-snapshot-observer.js");
const { evaluateA11yAssertion } = await importRuntimeModule("core/a11y-snapshot.js");
const { executeCliOperation } = await importRuntimeModule("index.js");

const capture = (name) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/captures/cdp-ax/${name}.json`, import.meta.url), "utf8"),
  );
const LOCAL = capture("local-oopif");
const LOCAL_URL = LOCAL.url;

/** Methods that act on a page or evaluate arbitrary script; the channel must never send one. */
const WRITING =
  /^(Page\.navigate|Page\.reload|Input\.|Runtime\.evaluate|DOM\.set|DOM\.remove|Target\.createTarget|Target\.closeTarget|Emulation\.)/;

test("only a loopback http endpoint is accepted, before any request is made", () => {
  assert.equal(cdp.resolveCdpEndpoint({}), "http://127.0.0.1:9222");
  assert.equal(
    cdp.resolveCdpEndpoint({ TEST_CAPABILITIES_CDP_ENDPOINT: "http://localhost:9333" }),
    "http://localhost:9333",
  );
  for (const bad of [
    "http://10.0.0.5:9222",
    "https://127.0.0.1:9222",
    "not a url",
    "ws://127.0.0.1:9222",
  ]) {
    assert.throws(
      () => cdp.resolveCdpEndpoint({ TEST_CAPABILITIES_CDP_ENDPOINT: bad }),
      (error) => error.code === "cdp_endpoint_refused",
      bad,
    );
  }
});

test("the binding is exactly one page target at the gated href, never a pick", () => {
  const page = (id, url) => ({
    id,
    type: "page",
    url,
    title: "",
    webSocketDebuggerUrl: `ws://x/${id}`,
  });
  assert.equal(cdp.bindOwnedTarget([page("A", LOCAL_URL)], LOCAL_URL).id, "A");
  for (const targets of [
    [],
    [page("A", LOCAL_URL), page("B", LOCAL_URL)],
    [page("A", "https://other/")],
  ]) {
    assert.throws(
      () => cdp.bindOwnedTarget(targets, LOCAL_URL),
      (error) => error.code === "tab_bind_ambiguous",
    );
  }
});

test("an endpoint that is not listening, or not Chromium, is a typed refusal", async (t) => {
  await assert.rejects(
    cdp.probeCdpBrowser("http://127.0.0.1:9"),
    (error) => error.code === "cdp_endpoint_unreachable",
  );
  const notChromium = await startFakeCdp({ versionStatus: 404 });
  t.after(() => notChromium.close());
  await assert.rejects(
    cdp.probeCdpBrowser(notChromium.url),
    (error) => error.code === "cdp_endpoint_not_chromium",
  );
});

test("frames attach recursively as flattened sessions, and every session is detached", async (t) => {
  const tree = treeFromCapture(LOCAL);
  // a second, nested out-of-process frame under the first
  tree.frames[0].frames = [
    {
      url: "https://nested.example/",
      nodes: [
        { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
        {
          nodeId: "2",
          parentId: "1",
          role: { value: "link" },
          name: { value: "Deep" },
          backendDOMNodeId: 900,
        },
      ],
    },
  ];
  const fake = await startFakeCdp({ pages: { P1: { url: LOCAL_URL, tree } } });
  t.after(() => fake.close());

  const live = await openA11yLiveView(LOCAL_URL, { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url });
  assert.match(live.snapshot, /button "Play" \[e2\]/);
  assert.match(live.snapshot, /frame "https:\/\/nested.example\/"\n {2}link "Deep" \[e3\]/);
  await live.close();

  assert.equal(fake.methods.filter((m) => m.startsWith("Accessibility.getFullAXTree")).length, 3);
  assert.equal(fake.methods.filter((m) => m.startsWith("Target.detachFromTarget")).length, 2);
  assert.equal(
    fake.methods.filter((m) => m.startsWith("Target.setAutoAttach")).at(-1),
    "Target.setAutoAttach",
  );
  assert.deepEqual(
    fake.methods.filter((m) => WRITING.test(m)),
    [],
    "the channel only reads",
  );
});

test("the check reader gives the evaluator real visible/text/attr readings, in-frame too", async (t) => {
  const tree = treeFromCapture(LOCAL);
  const playNode = tree.frames[0].nodes.find((node) => node.name?.value === "Play");
  const fake = await startFakeCdp({
    pages: { P1: { url: LOCAL_URL, tree } },
    reads: { [playNode.backendDOMNodeId]: { visible: true, text: "Play", attrs: { id: "play" } } },
  });
  t.after(() => fake.close());
  const live = await openA11yLiveView(LOCAL_URL, { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url });
  t.after(() => live.close());

  const passed = await evaluateA11yAssertion(
    {
      kind: "a11y-role",
      role: "button",
      name: "Play",
      expect: { visible: true, text: "Play", attr: { id: "play" } },
    },
    live.view,
    live.reader,
  );
  assert.equal(passed.status, "passed", JSON.stringify(passed));
  assert.equal(passed.ref, "e2");
  assert.ok(passed.evidence.some((line) => line.startsWith("visible e2 -> ")));

  const failed = await evaluateA11yAssertion(
    { kind: "a11y-role", role: "button", name: "Play", expect: { text: "Pause" } },
    live.view,
    live.reader,
  );
  assert.equal(failed.status, "failed");
  assert.match(failed.reason, /text is "Play"/);

  // the read ran on the frame's own session, and released what it resolved
  assert.ok(fake.methods.some((m) => m.startsWith("Runtime.callFunctionOn@S")));
  assert.equal(
    fake.methods.filter((m) => m.startsWith("DOM.resolveNode")).length,
    fake.methods.filter((m) => m.startsWith("Runtime.releaseObject")).length,
  );
  assert.deepEqual(
    fake.methods.filter((m) => WRITING.test(m)),
    [],
  );
});

test("doctor reports the a11y channel's endpoint: pass with Chromium, warn without, never required", async (t) => {
  const fake = await startFakeCdp({ browser: "Chrome/153.0.8010.47" });
  t.after(() => fake.close());
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  t.after(() => {
    if (previous === undefined) delete process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
    else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = previous;
  });
  const checkWith = async (endpoint) => {
    process.env.TEST_CAPABILITIES_CDP_ENDPOINT = endpoint;
    const result = await executeCliOperation({ command: "doctor" }, {});
    return result.checks.find((check) => check.id === "external.a11y_channel");
  };

  const up = await checkWith(fake.url);
  assert.equal(up.status, "pass");
  assert.equal(up.required, false);
  assert.equal(up.data.browser, "Chrome/153.0.8010.47");

  const down = await checkWith("http://127.0.0.1:9");
  assert.equal(down.status, "warn");
  assert.equal(down.required, false, "the channel is optional, never a doctor failure");
  assert.match(down.detail, /No DevTools endpoint answered/);

  const refused = await checkWith("http://10.0.0.5:9222");
  assert.equal(refused.status, "warn");
  assert.match(refused.detail, /refuses before any request is made/);
});

test("an endpoint that answers, but not like Chromium, is refused with what it answered", async (t) => {
  const cases = [
    [
      { versionBody: "<html>not json</html>" },
      (u) => cdp.probeCdpBrowser(u),
      /did not answer JSON/,
    ],
    [
      { versionBody: JSON.stringify({ Product: "x" }) },
      (u) => cdp.probeCdpBrowser(u),
      /without a 'Browser' string/,
    ],
    [
      { listBody: JSON.stringify({ not: "a list" }) },
      (u) => cdp.listCdpTargets(u),
      /not a target list/,
    ],
  ];
  for (const [options, call, message] of cases) {
    const fake = await startFakeCdp(options);
    t.after(() => fake.close());
    await assert.rejects(
      call(fake.url),
      (error) => error.code === "cdp_endpoint_not_chromium" && message.test(error.message),
    );
  }
});

test("a frame whose tree errors is named unreadable, noise on the socket is ignored", async (t) => {
  const tree = treeFromCapture(LOCAL);
  tree.frames[0] = { url: "https://ads.example/slot", error: "Frame detached" };
  const fake = await startFakeCdp({ pages: { P1: { url: LOCAL_URL, tree } }, noise: true });
  t.after(() => fake.close());
  const live = await openA11yLiveView(LOCAL_URL, { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url });
  t.after(() => live.close());
  assert.match(
    live.snapshot,
    /frame "https:\/\/ads.example\/slot"\n {2}\(unreadable: Frame detached\)/,
  );
  // a ref without an element handle cannot be read, and says so rather than guessing
  await assert.rejects(live.reader.text("e99"), (error) => error.code === "a11y_check_unavailable");
});
