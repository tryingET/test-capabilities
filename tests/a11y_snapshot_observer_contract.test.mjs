import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeSurf, readyPages, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The a11y snapshot observer (slice S9; producer switched to surf `page.read --nodes` under
 * AK #5915).
 *
 * The unit cases drive the observer with a stub session whose one `step` answers the way surf
 * does; the whole-run cases go through `executeSurfExploreOperation` and the `test` orchestrator
 * against the fake surf, whose page model can carry the committed live capture. What is proven:
 * the one read-only step and its arguments, the artifact on disk and the digest in the envelope,
 * the refusals (a surf without --nodes, an empty tree, a page that moved), `optional` against
 * `required`, and that no second tool is involved anywhere.
 */

const { createA11ySnapshotObserver, a11yChannelSummary, A11Y_SNAPSHOT_EFFECT } =
  await importRuntimeModule("core/a11y-snapshot-observer.js");
const { A11Y_PAGE_READ_ARGS } = await importRuntimeModule("core/a11y-snapshot.js");
const { createRunContext } = await importRuntimeModule("core/run-context.js");
const { executeSurfExploreOperation } = await importRuntimeModule(
  "core/operations/surf-explore-operation.js",
);
const { TestCapabilitiesOrchestrator } = await importRuntimeModule("index.js");

const CAPTURE = JSON.parse(
  readFileSync(
    new URL("./fixtures/captures/surf-page-read/releases.json", import.meta.url),
    "utf8",
  ),
);
const RELEASES_URL = CAPTURE.url;
const PAGE_URL = "https://example.com/";

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

/** The members the observer asks a session for; `step` answers the one read like surf does. */
function stubSession(runId, url, answer) {
  const steps = [];
  return {
    steps,
    session: {
      runId,
      url,
      tab: { id: 100, url, openedAt: "now" },
      readiness: { state: "ready", href: url, evidence: [] },
      async step(step) {
        steps.push(step);
        // surf's own --json envelope: the result plus the tab it answered from
        const stdout =
          typeof answer === "string"
            ? answer
            : JSON.stringify({ result: answer, target: { tabId: 100 }, notice: null });
        return step.read({ ok: true, stdout, stderr: "", command: step.command, args: step.args });
      },
    },
  };
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

test("one read-only page.read step; the text stays in the 0600 file, the digest in the envelope", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const context = observerContext(dir);
  const { session, steps } = stubSession(context.runId, RELEASES_URL, CAPTURE.stdout.result);

  const observation = await createA11ySnapshotObserver({
    context,
    required: true,
    domCounts: () => CAPTURE.domCounts,
    toolVersion: "2.20.0",
  }).observer.run(session);

  assert.equal(steps.length, 1);
  assert.equal(steps[0].command, "page.read");
  assert.deepEqual(steps[0].args, [...A11Y_PAGE_READ_ARGS]);
  assert.deepEqual(A11Y_PAGE_READ_ARGS, ["--structure", "--full-page", "--no-text", "--nodes"]);

  assert.equal(observation.status, "captured");
  assert.equal(observation.channel, "surf-page-read");
  assert.equal(observation.digest, CAPTURE.digest);
  assert.equal(observation.refCount, CAPTURE.refCount);
  assert.equal(observation.bytes, CAPTURE.bytes);
  assert.equal(observation.snapshot, undefined, "the tree text never enters the envelope");
  assert.equal(observation.tab.surfTabId, 100);
  assert.equal(observation.tool.version, "2.20.0");
  assert.equal(observation.semanticCoverage.anchors.dom, 233);

  const [artifact] = artifactsIn(dir, context.runId);
  assert.equal(artifact.mode, 0o600);
  assert.equal(artifact.path, observation.artifact);
  assert.equal(artifact.body.digest, CAPTURE.digest);
  assert.equal(artifact.body.snapshot.includes("[Viewport:"), false);
  assert.equal(artifact.body.artifact_kind, "test-capabilities.a11y.snapshot");
});

test("the dom probe that did not verify is dom_probe_missing, never three zeros", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const context = observerContext(dir);
  const { session } = stubSession(context.runId, RELEASES_URL, CAPTURE.stdout.result);
  const observation = await createA11ySnapshotObserver({
    context,
    required: false,
    domCounts: () => undefined,
  }).observer.run(session);
  assert.equal(observation.status, "captured");
  assert.equal(observation.semanticCoverage, undefined);
  assert.equal(observation.coverageReason, "dom_probe_missing");
});

test("a surf without --nodes, an empty tree and a page that moved are typed refusals", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const context = observerContext(dir);
  const run = (url, answer) =>
    createA11ySnapshotObserver({ context, required: false }).observer.run(
      stubSession(context.runId, url, answer).session,
    );

  const unsupported = await run(
    PAGE_URL,
    JSON.stringify({ result: 'link "x" [e1]', target: { tabId: 100 }, notice: null }),
  );
  assert.equal(unsupported.status, "unavailable");
  assert.equal(unsupported.reason, "surf_page_read_unsupported");
  assert.match(unsupported.detail, /feat\/page-read-nodes/);

  const empty = await run(PAGE_URL, { pageContent: "", nodes: [], url: PAGE_URL, title: "x" });
  assert.equal(empty.reason, "empty_snapshot");

  const moved = await run(PAGE_URL, { ...CAPTURE.stdout.result });
  assert.equal(moved.reason, "origin_mismatch");
  assert.match(moved.detail, /moved between the readiness gate and the snapshot/);

  // a URL the gate never saw and that is not even a URL still compares as text, never throws
  const odd = await run("not-a-url", { ...CAPTURE.stdout.result, url: "not-a-url" });
  assert.equal(odd.status, "captured");

  // every unavailable observation is written too: a recorded gap, never a silent skip
  assert.equal(artifactsIn(dir, context.runId).length, 4);
});

test("required raises a11y_channel_unavailable and still reports what it saw", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const context = observerContext(dir);
  const handle = createA11ySnapshotObserver({ context, required: true });
  let raised;
  try {
    await handle.observer.run(stubSession(context.runId, PAGE_URL, "not json at all").session);
  } catch (error) {
    raised = error;
  }
  assert.equal(raised?.code, "a11y_channel_unavailable");
  assert.equal(handle.observation().status, "unavailable");
  assert.equal(handle.observation().reason, "snapshot_failed");
});

test("the observer is read-only and claims nothing about a second tool", () => {
  assert.equal(A11Y_SNAPSHOT_EFFECT.effect, "read_only");
  assert.match(A11Y_SNAPSHOT_EFFECT.reason, /opens, navigates and clicks nothing/);
  assert.doesNotMatch(A11Y_SNAPSHOT_EFFECT.reason, /about:blank|agent-browser/);
});

test("the channel summary names the producer and the version that answered", () => {
  assert.deepEqual(a11yChannelSummary(undefined, []), {});
  assert.deepEqual(a11yChannelSummary("required", []), {
    a11yChannel: { mode: "required", channel: "surf-page-read", status: "unavailable" },
  });
  assert.deepEqual(
    a11yChannelSummary("optional", [
      {
        channel: "surf-page-read",
        status: "captured",
        tool: {
          command: "surf page.read --structure --full-page --no-text --nodes",
          version: "2.20.0",
        },
      },
    ]),
    {
      a11yChannel: {
        mode: "optional",
        channel: "surf-page-read",
        tool: "surf page.read --structure --full-page --no-text --nodes",
        version: "2.20.0",
        status: "captured",
      },
    },
  );
});

// ============================================
// THE WHOLE RUN
// ============================================

/** Point the in-process run at a throwaway receipt store for the duration of `callback`. */
async function withReceipts(dir, callback) {
  const keys = ["TEST_CAPABILITIES_RECEIPTS_DIR", "TEST_CAPABILITIES_RECEIPTS_EPHEMERAL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.TEST_CAPABILITIES_RECEIPTS_DIR = dir;
  process.env.TEST_CAPABILITIES_RECEIPTS_EPHEMERAL = "1";
  try {
    return await callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function releasesPages(pageRead = { ...CAPTURE.stdout.result }) {
  return readyPages({ [RELEASES_URL]: { title: "Releases", pageRead } });
}

test("surf explore --a11y-snapshot reads the owned tab once through surf, and nothing else runs", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: releasesPages() });
  t.after(() => surf.cleanup());

  const envelope = await withReceipts(dir, () =>
    withFakeSurfEnv(surf.path, () =>
      executeSurfExploreOperation({ url: RELEASES_URL, a11ySnapshot: "required" }),
    ),
  );

  const page = envelope.result.pages[0];
  assert.equal(page.verified, true);
  assert.equal(page.observations.length, 1);
  assert.equal(page.observations[0].status, "captured");
  assert.equal(page.observations[0].digest, CAPTURE.digest);
  assert.equal(envelope.result.runtime.a11yChannel.channel, "surf-page-read");
  assert.equal(envelope.result.runtime.a11yChannel.status, "captured");

  const reads = surf.calls().filter((call) => call[0] === "page.read");
  assert.equal(reads.length, 1);
  for (const flag of [...A11Y_PAGE_READ_ARGS, "--json", "--tab-id"]) {
    assert.equal(reads[0].includes(flag), true, flag);
  }
  // the read happens in the owned tab, before that tab is closed
  const verbs = surf.calls().map((call) => call[0]);
  assert.ok(verbs.indexOf("page.read") < verbs.lastIndexOf("tab.close"));
});

test("without the flag there is no observation and no page.read", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: releasesPages() });
  t.after(() => surf.cleanup());
  const envelope = await withReceipts(dir, () =>
    withFakeSurfEnv(surf.path, () => executeSurfExploreOperation({ url: RELEASES_URL })),
  );
  assert.equal(envelope.result.pages[0].observations, undefined);
  assert.equal(envelope.result.runtime.a11yChannel, undefined);
  assert.equal(
    surf.calls().some((call) => call[0] === "page.read"),
    false,
  );
});

test("optional against a surf without --nodes: the page stays verified and the reason is named", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: releasesPages("unsupported") });
  t.after(() => surf.cleanup());
  const envelope = await withReceipts(dir, () =>
    withFakeSurfEnv(surf.path, () =>
      executeSurfExploreOperation({ url: RELEASES_URL, a11ySnapshot: true }),
    ),
  );
  assert.equal(envelope.result.pages[0].verified, true);
  assert.equal(envelope.result.pages[0].observations[0].reason, "surf_page_read_unsupported");
  assert.equal(envelope.result.runtime.a11yChannel.mode, "optional");
  assert.equal(envelope.result.runtime.a11yChannel.status, "unavailable");
});

test("required against a surf without --nodes fails the page with the channel's own code", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: releasesPages("unsupported") });
  t.after(() => surf.cleanup());
  const error = await withReceipts(dir, () =>
    withFakeSurfEnv(surf.path, () =>
      executeSurfExploreOperation({ url: RELEASES_URL, a11ySnapshot: "required" }).catch(
        (caught) => caught,
      ),
    ),
  );
  assert.equal(error.code, "a11y_channel_unavailable");
  assert.match(error.message, /surf_page_read_unsupported/);
});

test("an unknown --a11y-snapshot value is refused before a tab is opened", async (t) => {
  const surf = createFakeSurf({ pages: releasesPages() });
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
  const surf = createFakeSurf({ pages: releasesPages() });
  t.after(() => surf.cleanup());
  const run = await withReceipts(dir, () =>
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
    new RegExp(`^a11y-snapshot: captured ${CAPTURE.digest} refs=236 artifact=`),
  );
});

test("a test run reports an optional channel that could not observe, with its reason", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: releasesPages("unsupported") });
  t.after(() => surf.cleanup());
  const run = await withReceipts(dir, () =>
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
  assert.match(lines[0], /^a11y-snapshot: unavailable surf_page_read_unsupported artifact=\S+/);
});
