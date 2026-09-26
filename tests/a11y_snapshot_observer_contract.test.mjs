import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeCdp, treeFromCapture } from "./helpers/fake-cdp.mjs";
import { createFakeSurf, readyPages, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The a11y snapshot observer (slice S9; producer: Chromium's accessibility tree over CDP, chosen
 * by the measured series of AK #5915).
 *
 * The unit cases drive the observer with a stub session against a fake DevTools endpoint that
 * replays the recorded Chromium trees; the whole-run cases add the fake surf, which owns the tab.
 * What is proven: one read of the owned tab (bound by the gated href, no new target), the
 * artifact on disk and the digest in the envelope, the refusals (no endpoint, an ambiguous tab,
 * an empty tree), `optional` against `required`, and that the channel only reads.
 */

const { createA11ySnapshotObserver, a11yChannelSummary, A11Y_SNAPSHOT_EFFECT } =
  await importRuntimeModule("core/a11y-snapshot-observer.js");
const { renderAxForest } = await importRuntimeModule("core/a11y-ax-tree.js");
const { snapshotDigest } = await importRuntimeModule("core/a11y-snapshot.js");
const { createRunContext } = await importRuntimeModule("core/run-context.js");
const { executeSurfExploreOperation } = await importRuntimeModule(
  "core/operations/surf-explore-operation.js",
);
const { TestCapabilitiesOrchestrator } = await importRuntimeModule("index.js");

const RELEASES = JSON.parse(
  readFileSync(new URL("./fixtures/captures/cdp-ax/releases.json", import.meta.url), "utf8"),
);
const RELEASES_URL = RELEASES.url;
const RELEASES_TREE = treeFromCapture(RELEASES);
const EXPECTED = renderAxForest(
  RELEASES.frames.map((frame, index) => ({
    frame: index === 0 ? "main" : `f${index}`,
    url: frame.url,
    nodes: frame.nodes,
  })),
);
const EXPECTED_DIGEST = snapshotDigest(EXPECTED.snapshot);
const PAGE_URL = "https://example.com/";
const DOM_COUNTS = { anchors: 233, buttons: 36, inputs: 42 };

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), "tc-a11y-observer-"));
}

/** A run whose receipts and artifacts land in a throwaway store (the S8 rule for read-only runs). */
function observerContext(dir) {
  return createRunContext({
    operationId: "surf.explore",
    effect: { effect: "read_only", reason: "test" },
    env: {
      ...process.env,
      TEST_CAPABILITIES_RECEIPTS_DIR: dir,
      TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    },
    config: { mutation: { allowOrigins: [] } },
  });
}

/** The members the observer asks a session for: the URL the gate saw and the owned tab. */
function stubSession(runId, url) {
  return {
    runId,
    url,
    tab: { id: 100, url, openedAt: "now" },
    readiness: { state: "ready", href: url, evidence: [] },
  };
}

async function releasesEndpoint(t, extraPages = {}) {
  const fake = await startFakeCdp({
    pages: {
      RELEASES: { url: RELEASES_URL, title: "Releases", tree: RELEASES_TREE },
      ...extraPages,
    },
  });
  t.after(() => fake.close());
  return fake;
}

function artifactsIn(dir, runId) {
  const runDir = path.join(dir, runId);
  return readdirSync(runDir)
    .filter((name) => name.startsWith("a11y-snapshot-"))
    .map((name) => ({
      path: path.join(runDir, name),
      mode: statSync(path.join(runDir, name)).mode & 0o777,
      body: JSON.parse(readFileSync(path.join(runDir, name), "utf8")),
    }));
}

test("one read of the owned tab: the text stays in the 0600 file, the digest in the envelope", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = await releasesEndpoint(t);
  const context = observerContext(dir);

  const observation = await createA11ySnapshotObserver({
    context,
    required: true,
    domCounts: () => DOM_COUNTS,
    env: { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url },
  }).observer.run(stubSession(context.runId, RELEASES_URL));

  assert.equal(observation.status, "captured");
  assert.equal(observation.channel, "chromium-ax-cdp");
  assert.equal(observation.digest, EXPECTED_DIGEST);
  assert.equal(observation.refCount, 256);
  assert.equal(observation.snapshot, undefined, "the tree text never enters the envelope");
  assert.equal(observation.tab.surfTabId, 100);
  assert.equal(observation.tab.targetId, "RELEASES");
  assert.equal(observation.tool.command, "CDP Accessibility.getFullAXTree");
  assert.equal(observation.tool.version, "Chrome/153.0.0.0");
  assert.equal(observation.semanticCoverage.anchors.dom, 233);
  assert.equal(observation.semanticCoverage.anchors.tree, 119);

  const [artifact] = artifactsIn(dir, context.runId);
  assert.equal(artifact.mode, 0o600);
  assert.equal(artifact.path, observation.artifact);
  assert.equal(artifact.body.snapshot, EXPECTED.snapshot);
  assert.equal(artifact.body.artifact_kind, "test-capabilities.a11y.snapshot");
  // it attached to the existing page, read, and left: nothing created, nothing left open
  assert.equal(fake.methods.includes("Target.createTarget"), false);
  assert.equal(await fake.drained(), 0, "the socket was closed");
});

test("the dom probe that did not verify is dom_probe_missing, never three zeros", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = await releasesEndpoint(t);
  const context = observerContext(dir);
  const observation = await createA11ySnapshotObserver({
    context,
    required: false,
    domCounts: () => undefined,
    env: { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url },
  }).observer.run(stubSession(context.runId, RELEASES_URL));
  assert.equal(observation.status, "captured");
  assert.equal(observation.semanticCoverage, undefined);
  assert.equal(observation.coverageReason, "dom_probe_missing");
});

test("no endpoint, an ambiguous tab and an empty tree are typed refusals, each written", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const context = observerContext(dir);
  const run = (url, env) =>
    createA11ySnapshotObserver({ context, required: false, env }).observer.run(
      stubSession(context.runId, url),
    );

  const unreachable = await run(RELEASES_URL, {
    TEST_CAPABILITIES_CDP_ENDPOINT: "http://127.0.0.1:9",
  });
  assert.equal(unreachable.reason, "cdp_endpoint_unreachable");
  const refused = await run(RELEASES_URL, {
    TEST_CAPABILITIES_CDP_ENDPOINT: "http://10.1.1.1:9222",
  });
  assert.equal(refused.reason, "cdp_endpoint_refused");

  const twice = await startFakeCdp({
    pages: {
      A: { url: RELEASES_URL, tree: RELEASES_TREE },
      B: { url: RELEASES_URL, tree: RELEASES_TREE },
      E: { url: PAGE_URL, tree: { nodes: [] } },
    },
  });
  t.after(() => twice.close());
  const ambiguous = await run(RELEASES_URL, { TEST_CAPABILITIES_CDP_ENDPOINT: twice.url });
  assert.equal(ambiguous.reason, "tab_bind_ambiguous");
  assert.match(ambiguous.detail, /Candidates: A, B/);
  const empty = await run(PAGE_URL, { TEST_CAPABILITIES_CDP_ENDPOINT: twice.url });
  assert.equal(empty.reason, "empty_snapshot");

  assert.equal(artifactsIn(dir, context.runId).length, 4);
});

test("required raises a11y_channel_unavailable and still reports what it saw", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const context = observerContext(dir);
  const handle = createA11ySnapshotObserver({
    context,
    required: true,
    env: { TEST_CAPABILITIES_CDP_ENDPOINT: "http://127.0.0.1:9" },
  });
  let raised;
  try {
    await handle.observer.run(stubSession(context.runId, PAGE_URL));
  } catch (error) {
    raised = error;
  }
  assert.equal(raised?.code, "a11y_channel_unavailable");
  assert.equal(handle.observation().status, "unavailable");
  assert.equal(handle.observation().reason, "cdp_endpoint_unreachable");
});

test("the observer is read-only and says it reads over the loopback endpoint", () => {
  assert.equal(A11Y_SNAPSHOT_EFFECT.effect, "read_only");
  assert.match(A11Y_SNAPSHOT_EFFECT.reason, /opens, navigates and clicks nothing/);
  assert.match(A11Y_SNAPSHOT_EFFECT.reason, /loopback DevTools endpoint/);
});

test("the channel summary names the producer and the version that answered", () => {
  assert.deepEqual(a11yChannelSummary(undefined, []), {});
  assert.deepEqual(a11yChannelSummary("required", []), {
    a11yChannel: { mode: "required", channel: "chromium-ax-cdp", status: "unavailable" },
  });
  assert.deepEqual(
    a11yChannelSummary("optional", [
      {
        channel: "chromium-ax-cdp",
        status: "captured",
        tool: {
          command: "CDP Accessibility.getFullAXTree",
          version: "Chrome/153",
        },
      },
    ]),
    {
      a11yChannel: {
        mode: "optional",
        channel: "chromium-ax-cdp",
        tool: "CDP Accessibility.getFullAXTree",
        version: "Chrome/153",
        status: "captured",
      },
    },
  );
});

// ============================================
// THE WHOLE RUN
// ============================================

/** Point the in-process run at a throwaway receipt store and at the fake endpoint. */
async function withRun(dir, endpoint, callback) {
  const values = {
    TEST_CAPABILITIES_RECEIPTS_DIR: dir,
    TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    TEST_CAPABILITIES_CDP_ENDPOINT: endpoint,
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const surfPages = () => readyPages({ [RELEASES_URL]: { title: "Releases" } });

test("surf explore --a11y-snapshot reads the tab surf owns over CDP, and nothing else", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = await releasesEndpoint(t);
  const surf = createFakeSurf({ pages: surfPages() });
  t.after(() => surf.cleanup());

  const envelope = await withRun(dir, fake.url, () =>
    withFakeSurfEnv(surf.path, () =>
      executeSurfExploreOperation({ url: RELEASES_URL, a11ySnapshot: "required" }),
    ),
  );

  const page = envelope.result.pages[0];
  assert.equal(page.verified, true);
  assert.equal(page.observations[0].status, "captured");
  assert.equal(page.observations[0].digest, EXPECTED_DIGEST);
  assert.deepEqual(envelope.result.runtime.a11yChannel, {
    mode: "required",
    channel: "chromium-ax-cdp",
    tool: "CDP Accessibility.getFullAXTree",
    version: "Chrome/153.0.0.0",
    status: "captured",
  });
  // surf never ran a second read for the channel; the tree came over CDP
  assert.equal(
    surf.calls().some((call) => call[0] === "page.read"),
    false,
  );
  assert.equal(await fake.drained(), 0, "the socket was closed");
});

test("without the flag there is no observation and no DevTools request", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = await releasesEndpoint(t);
  const surf = createFakeSurf({ pages: surfPages() });
  t.after(() => surf.cleanup());
  const envelope = await withRun(dir, fake.url, () =>
    withFakeSurfEnv(surf.path, () => executeSurfExploreOperation({ url: RELEASES_URL })),
  );
  assert.equal(envelope.result.pages[0].observations, undefined);
  assert.equal(envelope.result.runtime.a11yChannel, undefined);
  assert.deepEqual(fake.methods, []);
});

test("optional without an endpoint: the page stays verified and the reason is named", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: surfPages() });
  t.after(() => surf.cleanup());
  const envelope = await withRun(dir, "http://127.0.0.1:9", () =>
    withFakeSurfEnv(surf.path, () =>
      executeSurfExploreOperation({ url: RELEASES_URL, a11ySnapshot: true }),
    ),
  );
  assert.equal(envelope.result.pages[0].verified, true);
  assert.equal(envelope.result.pages[0].observations[0].reason, "cdp_endpoint_unreachable");
  assert.equal(envelope.result.runtime.a11yChannel.status, "unavailable");
});

test("required without an endpoint fails the page with the channel's own code", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: surfPages() });
  t.after(() => surf.cleanup());
  const error = await withRun(dir, "http://127.0.0.1:9", () =>
    withFakeSurfEnv(surf.path, () =>
      executeSurfExploreOperation({ url: RELEASES_URL, a11ySnapshot: "required" }).catch(
        (caught) => caught,
      ),
    ),
  );
  assert.equal(error.code, "a11y_channel_unavailable");
  assert.match(error.message, /cdp_endpoint_unreachable/);
});

test("an unknown --a11y-snapshot value is refused before a tab is opened", async (t) => {
  const surf = createFakeSurf({ pages: surfPages() });
  t.after(() => surf.cleanup());
  let raised;
  try {
    await withFakeSurfEnv(surf.path, () =>
      executeSurfExploreOperation({ url: RELEASES_URL, a11ySnapshot: "sometimes" }),
    );
  } catch (error) {
    raised = error;
  }
  assert.equal(raised?.code, "config_invalid");
  assert.match(raised.message, /off, optional, required/);
  assert.deepEqual(surf.calls(), []);
});

test("a test run carries the surf agent's a11y observation into its report", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = await releasesEndpoint(t);
  const surf = createFakeSurf({ pages: surfPages() });
  t.after(() => surf.cleanup());
  const run = await withRun(dir, fake.url, () =>
    withFakeSurfEnv(surf.path, () =>
      new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "a11y in a test run",
        targets: { web: RELEASES_URL },
        agents: { web: { type: "surf", observation: { a11ySnapshot: "required" } } },
      }).run(),
    ),
  );
  assert.equal(run.determination.value, "verified");
  const coverage = run.observations.find((o) => o.kind === "coverage" && o.agent === "web");
  const lines = coverage.evidence.filter((line) => line.startsWith("a11y-snapshot:"));
  assert.equal(lines.length, 1, coverage.evidence.join("\n"));
  assert.match(
    lines[0],
    new RegExp(`^a11y-snapshot: captured ${EXPECTED_DIGEST} refs=256 artifact=`),
  );
});

test("a test run reports an optional channel that could not observe, with its reason", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: surfPages() });
  t.after(() => surf.cleanup());
  const run = await withRun(dir, "http://127.0.0.1:9", () =>
    withFakeSurfEnv(surf.path, () =>
      new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "optional a11y that cannot observe",
        targets: { web: RELEASES_URL },
        agents: { web: { type: "surf", observation: { a11ySnapshot: "optional" } } },
      }).run(),
    ),
  );
  assert.equal(run.determination.value, "verified");
  const coverage = run.observations.find((o) => o.kind === "coverage" && o.agent === "web");
  const lines = coverage.evidence.filter((line) => line.startsWith("a11y-snapshot:"));
  assert.match(lines[0], /^a11y-snapshot: unavailable cdp_endpoint_unreachable artifact=\S+/);
});
