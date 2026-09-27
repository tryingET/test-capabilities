import assert from "node:assert/strict";
import test from "node:test";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The in-frame probe over CDP (CDP program S2). Candidates arrive as surf's frame topology names
 * them - out-of-process ones with no CDP frame id (measured live 2026-09-27) - and are mapped by
 * frame id, DOM index or URL; each is read in its own frame's isolated world, nothing switched.
 */

const { probeCandidatesOverCdp } = await importRuntimeModule("core/cdp-frame-probe.js");

const PAGE = "https://app.test/host";
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
    owner: { backendNodeId: 51, box: [10, 10, 200, 100] },
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "button", "Deep", 31)],
    elements: { "#deep": { backendNodeId: 31, box: [5, 5, 40, 10] } },
  };
  const player = {
    url: "https://player.test/embed",
    owner: { backendNodeId: 50, box: [100, 200, 400, 300] },
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "Iframe", "", 51)],
    elements: { "#deep-frame": { backendNodeId: 51, box: [10, 10, 200, 100], iframeIndex: 0 } },
    frames: [deep],
  };
  const embedded = {
    url: "https://app.test/embedded",
    id: "SAME1",
    owner: { backendNodeId: 60, box: [0, 600, 200, 100] },
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "button", "Inner", 61)],
    elements: { "#inner": { backendNodeId: 61, box: [10, 10, 50, 20] } },
  };
  return {
    url: PAGE,
    nodes: [
      ax("1", "RootWebArea", "", 0, ["2", "3"]),
      ax("2", "Iframe", "", 50),
      ax("3", "Iframe", "", 60),
    ],
    elements: {
      "#player-frame": { backendNodeId: 50, box: [100, 200, 400, 300], iframeIndex: 0 },
      "#embed-frame": { backendNodeId: 60, box: [0, 600, 200, 100], iframeIndex: 1 },
    },
    frames: [player],
    sameProcess: [embedded],
  };
}

const TOP_PLAYER = { domIndex: 0, src: "https://player.test/embed", cdpFrameIds: [] };
const SAME = { domIndex: 1, src: "https://app.test/embedded", cdpFrameIds: ["SAME1"] };
const NESTED = { domIndex: null, src: "https://deep.test/inner", cdpFrameIds: [] };
const NOWHERE = { domIndex: null, src: "https://nowhere.test/", cdpFrameIds: [] };

async function probe(t, candidates, selector, tree = page()) {
  const fake = await startFakeCdp({ pages: { P1: { url: PAGE, tree } } });
  t.after(() => fake.close());
  const readings = await probeCandidatesOverCdp(
    PAGE,
    { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url },
    candidates,
    selector,
    120,
  );
  return { readings, fake };
}

test("every candidate is read in its own frame: top-level by DOM index, same-process by id, nested by URL", async (t) => {
  const deep = await probe(t, [TOP_PLAYER, SAME, NESTED], "#deep");
  assert.deepEqual(
    deep.readings.map((reading) => reading.reading),
    ["miss", "miss", "hit"],
  );
  const inner = await probe(t, [TOP_PLAYER, SAME, NESTED], "#inner");
  assert.deepEqual(
    inner.readings.map((reading) => reading.reading),
    ["miss", "hit", "miss"],
  );
});

test("a top-level candidate is its DOM index even after a redirect; the probe waits for a late element", async (t) => {
  const tree = page();
  tree.frames[0].frames[0].elements["#deep"].appearAfterMs = 60;
  // surf saw the src before the frame redirected; the CDP frame reports where it landed
  const redirected = { domIndex: 0, src: "https://player.test/start", cdpFrameIds: [] };
  const { readings } = await probe(t, [redirected, NESTED], "#deep", tree);
  assert.deepEqual(
    readings.map((reading) => reading.reading),
    ["miss", "hit"],
  );
});

test("a candidate that maps to no frame, or to several, is unanswered and never guessed", async (t) => {
  const tree = page();
  // a second out-of-process frame at the same URL as the nested one
  tree.frames.push({
    url: "https://deep.test/inner",
    owner: { backendNodeId: 52, box: [0, 0, 10, 10] },
    nodes: [ax("1", "RootWebArea", "", 0)],
  });
  const { readings } = await probe(t, [NESTED, NOWHERE], "#deep", tree);
  assert.deepEqual(
    readings.map((reading) => [reading.reading, reading.detail]),
    [
      ["unanswered", "2 frames match this candidate; none is guessed"],
      [
        "unanswered",
        "no frame on the DevTools connection matches this candidate (https://nowhere.test/)",
      ],
    ],
  );
});

test("an abbreviated src matches the URL it starts; a frame that went away is unanswered", async (t) => {
  const abbreviated = { domIndex: null, src: "https://deep.test/in…", cdpFrameIds: [] };
  const { readings } = await probe(t, [abbreviated], "#deep");
  assert.equal(readings[0].reading, "hit");
  // the frame goes away between the enumeration and the read
  const gone = page();
  const fake = await startFakeCdp({ pages: { P1: { url: PAGE, tree: gone } } });
  t.after(() => fake.close());
  gone.frames[0].frames[0].error = "Frame detached";
  const broken = await probeCandidatesOverCdp(
    PAGE,
    { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url },
    [NESTED],
    "#deep",
    100,
  );
  assert.equal(broken[0].reading, "unanswered");
});

test("a frame that cannot take an isolated world is unanswered; a page with no iframe node maps nothing", async (t) => {
  const tree = page();
  tree.frames[0].frames[0].worldError = "Frame navigated";
  const { readings } = await probe(t, [TOP_PLAYER, NESTED], "#deep", tree);
  assert.deepEqual(
    readings.map((reading) => [reading.reading, reading.detail]),
    [
      ["miss", undefined],
      ["unanswered", "Frame navigated"],
    ],
  );
  // an iframe the accessibility tree does not show (aria-hidden): the main frame id comes from
  // the frame tree, and the candidate maps to no frame this connection read
  const hidden = { url: PAGE, nodes: [ax("1", "RootWebArea", "", 0)], elements: {} };
  const bare = await probe(t, [NESTED], "#deep", hidden);
  assert.equal(bare.readings[0].reading, "unanswered");
});

test("the probe only reads: no input, no navigation, no switching, and nothing left resolved", async (t) => {
  const { fake } = await probe(t, [TOP_PLAYER, SAME, NESTED], "#deep");
  const acting =
    /^(Input\.|Page\.navigate|Page\.reload|Target\.createTarget|Target\.closeTarget|DOM\.set|DOM\.focus)/;
  assert.deepEqual(
    fake.methods.filter((method) => acting.test(method)),
    [],
  );
  assert.deepEqual([...fake.liveObjects.entries()], []);
  assert.ok(fake.worlds.every((world) => world.name === "test-capabilities"));
});

test("an endpoint that is not there is the a11y channel's refusal, for the caller to fall back", async () => {
  await assert.rejects(
    probeCandidatesOverCdp(
      PAGE,
      { TEST_CAPABILITIES_CDP_ENDPOINT: "http://127.0.0.1:9" },
      [NESTED],
      "#deep",
      100,
    ),
    { code: "cdp_endpoint_unreachable" },
  );
});
