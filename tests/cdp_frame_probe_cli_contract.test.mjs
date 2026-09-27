import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { createFakeSurf, readyPages } from "./helpers/fake-surf.mjs";
import { runtimeEnv } from "./helpers/runtime-dist.mjs";

/**
 * `surf explore --frame-probe` with the DevTools channel present (CDP program S2): the probe reads
 * every candidate in its own frame, so a target a surf probe could only call `suspected` - one
 * candidate nested, unreachable by `frame.switch --index` - is `confirmed`, and not one
 * `frame.switch` is sent. The fake surf and the fake DevTools endpoint describe the same page.
 * The CLI runs as an async child: the fake endpoint answers from this process.
 */

const binPath = new URL("../bin/test-capabilities", import.meta.url).pathname;
const URL_UNDER_TEST = "https://example.com/";
const ax = (id, role, name, backendDOMNodeId, children = []) => ({
  nodeId: id,
  role: { value: role },
  ...(name ? { name: { value: name } } : {}),
  ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
  childIds: children,
});

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binPath, ...args], { env: runtimeEnv(env) });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

/** The page both fakes describe: a top-level player frame, and a frame nested inside it. */
function cdpPage({ playIn }) {
  const inner = {
    url: "https://inner.example/",
    owner: { backendNodeId: 51, box: [0, 0, 200, 100] },
    nodes: [ax("1", "RootWebArea", "", 0)],
    elements: playIn === "inner" ? { "#play": { backendNodeId: 31, box: [5, 5, 40, 10] } } : {},
  };
  const player = {
    url: "https://embed.example/player.html",
    owner: { backendNodeId: 50, box: [0, 0, 400, 300] },
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "Iframe", "", 51)],
    elements: {
      "#inner-frame": { backendNodeId: 51, box: [0, 0, 200, 100], iframeIndex: 0 },
      ...(playIn === "player" ? { "#play": { backendNodeId: 21, box: [20, 30, 60, 20] } } : {}),
    },
    frames: [inner],
  };
  return {
    url: URL_UNDER_TEST,
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "Iframe", "", 50)],
    elements: { "#player-frame": { backendNodeId: 50, box: [0, 0, 400, 300], iframeIndex: 0 } },
    frames: [player],
  };
}

async function exploreWithCdp(t, playIn) {
  const surf = createFakeSurf({
    pages: readyPages({
      [URL_UNDER_TEST]: {
        links: [],
        frames: [
          {
            src: "https://embed.example/player.html",
            outOfProcess: true,
            selectors: playIn === "player" ? ["#play"] : [],
          },
          { src: "https://inner.example/", outOfProcess: true, nestedUnder: 0 },
        ],
      },
    }),
  });
  const cdp = await startFakeCdp({
    pages: { P1: { url: URL_UNDER_TEST, tree: cdpPage({ playIn }) } },
  });
  const receipts = mkdtempSync(path.join(os.tmpdir(), "cdp-probe-cli-"));
  t.after(async () => {
    surf.cleanup();
    await cdp.close();
    rmSync(receipts, { recursive: true, force: true });
  });
  const result = await runCli(
    [
      "surf",
      "explore",
      "--url",
      URL_UNDER_TEST,
      "--ready-selector",
      "#play",
      "--frame-probe",
      "--json",
    ],
    {
      TEST_CAPABILITIES_SURF_BIN: surf.path,
      TEST_CAPABILITIES_CDP_ENDPOINT: cdp.url,
      TEST_CAPABILITIES_RECEIPTS_DIR: receipts,
      TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    },
  );
  return {
    result,
    payload: JSON.parse(result.stdout),
    commands: surf.calls().map((call) => call[0]),
    cdp,
  };
}

test("with the DevTools channel, a target in a nested frame is confirmed without one frame.switch", async (t) => {
  const { payload, commands, cdp } = await exploreWithCdp(t, "inner");
  assert.equal(payload.error.details.determination, "confirmed", payload.error.message);
  assert.match(payload.error.message, /nested frame https:\/\/inner\.example\//);
  assert.deepEqual(
    commands.filter((command) => command.startsWith("frame.switch") || command === "frame.main"),
    [],
    "the probe switched nothing",
  );
  assert.ok(cdp.methods.some((method) => method.startsWith("Page.createIsolatedWorld")));
});

test("with the DevTools channel, a hit in the top-level frame is confirmed once the nested one answers", async (t) => {
  // the surf probe could only say `suspected` here: its nested candidate was unprobed
  const { payload, commands } = await exploreWithCdp(t, "player");
  assert.equal(payload.error.details.determination, "confirmed", payload.error.message);
  assert.match(payload.error.message, /DOM index 0/);
  assert.equal(commands.filter((command) => command === "frame.switch").length, 0);
});
