import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import {
  createFakeAgentBrowser,
  pageTarget,
  releasesCapture,
  startFakeCdpEndpoint,
} from "./helpers/fake-agent-browser.mjs";
import { createFakeSurf, readyPages, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The a11y snapshot channel as a `Session.observe` step (implementation plan S9 commit (2);
 * a11y-snapshot packet "Session and tab binding", "Snapshot artifact", "Behaviour and failure
 * modes"; architecture review A8, A9, A10).
 *
 * Two levels, both against fakes: the observer alone over a minimal session, where every refusal
 * of the packet's table is reachable, and the whole `surf explore` run, where the wiring, the
 * artifact on disk, the envelope's redaction and the teardown order are proved end to end. No
 * case here touches a browser.
 */

const { createA11ySnapshotObserver, a11yChannelSummary, tabLeakOf } = await importRuntimeModule(
  "core/a11y-snapshot-observer.js",
);
const { createRunContext } = await importRuntimeModule("core/run-context.js");
const { executeSurfExploreOperation } = await importRuntimeModule(
  "core/operations/surf-explore-operation.js",
);
const { A11Y_SNAPSHOT_EFFECT } = await importRuntimeModule("core/a11y-snapshot-observer.js");

const CAPTURE = releasesCapture();
const TARGET_ID = "82FF618C514C4D95C04EFD4AAF478A48";
const PAGE_URL = "https://example.com/";
const RELEASES_URL = CAPTURE.url;

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

/** The only members the observer asks a session for. */
function fakeSession(runId, url, tabId = 100) {
  return {
    runId,
    url,
    tab: { id: tabId, url, openedAt: "now" },
    readiness: { state: "ready", href: url, evidence: [] },
  };
}

function observerEnv(fake, endpoint, extra = {}) {
  return {
    PATH: path.dirname(process.execPath),
    HOME: mkdtempSync(path.join(os.tmpdir(), "tc-a11y-home-")),
    TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path,
    TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
    ...extra,
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

/** The page model both fakes agree on: one target, the live capture's tree. */
function agentBrowserPages(url = RELEASES_URL) {
  return { [TARGET_ID]: { ...CAPTURE.stdout.data, origin: url, title: "Releases" } };
}

test("a captured observation keeps the text in the 0600 file and the digest in the envelope", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = createFakeAgentBrowser({ pages: agentBrowserPages() });
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint({
    targets: [pageTarget(TARGET_ID, RELEASES_URL, "Releases")],
  });
  t.after(() => endpoint.close());

  const context = observerContext(dir);
  const handle = createA11ySnapshotObserver({
    context,
    required: false,
    env: observerEnv(fake, endpoint),
    domCounts: () => ({ anchors: 120, buttons: 30, inputs: 4 }),
  });

  const observation = await handle.observer.run(fakeSession(context.runId, RELEASES_URL));

  assert.equal(observation.status, "captured");
  assert.equal(observation.digest, CAPTURE.digest);
  assert.equal(observation.refCount, CAPTURE.refCount);
  assert.equal(observation.bytes, CAPTURE.bytes);
  assert.equal(observation.tab.targetId, TARGET_ID);
  assert.equal(observation.tab.surfTabId, 100);
  assert.equal(observation.session, `test-capabilities-${context.runId}`);
  assert.equal(observation.roleCounts.link, 95);
  // The blind spot the DOM measured against what the tree could name.
  assert.deepEqual(observation.semanticCoverage.anchors, { dom: 120, tree: 95 });
  assert.deepEqual(observation.semanticCoverage.buttons, { dom: 30, tree: 24 });
  assert.deepEqual(observation.semanticCoverage.inputs, { dom: 4, tree: 1 });
  // A10: the ~8 KB tree text never travels in the envelope.
  assert.equal(observation.snapshot, undefined);
  assert.ok(observation.refs.e28);

  const artifacts = artifactsIn(dir, context.runId);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].path, observation.artifact);
  assert.equal(artifacts[0].mode, 0o600);
  assert.equal(artifacts[0].body.artifact_kind, "test-capabilities.a11y.snapshot");
  assert.equal(artifacts[0].body.channel, "agent-browser-cdp");
  assert.equal(artifacts[0].body.status, "captured");
  assert.equal(artifacts[0].body.digest, CAPTURE.digest);
  assert.equal(Buffer.byteLength(artifacts[0].body.snapshot, "utf8"), CAPTURE.bytes);
  assert.equal(Object.keys(artifacts[0].body.refs).length, CAPTURE.refCount);
  assert.equal(artifacts[0].body.tool.version, "0.35.1");
  assert.equal(artifacts[0].body.endpoint.url, endpoint.url);

  // The two agent-browser calls the packet allows, in order, and nothing else.
  assert.deepEqual(fake.verbs(), ["tab", "snapshot"]);
});

test("the dom probe that did not verify is dom_probe_missing, never three zeros", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = createFakeAgentBrowser({ pages: agentBrowserPages() });
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint({
    targets: [pageTarget(TARGET_ID, RELEASES_URL, "Releases")],
  });
  t.after(() => endpoint.close());

  const context = observerContext(dir);
  const handle = createA11ySnapshotObserver({
    context,
    required: false,
    env: observerEnv(fake, endpoint),
    domCounts: () => undefined,
  });
  const observation = await handle.observer.run(fakeSession(context.runId, RELEASES_URL));

  assert.equal(observation.status, "captured");
  assert.equal(observation.semanticCoverage, undefined);
  assert.equal(observation.coverageReason, "dom_probe_missing");
  assert.equal(artifactsIn(dir, context.runId)[0].body.coverageReason, "dom_probe_missing");
});

test("the tab binding needs exactly one page target, and says so when it does not have one", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = createFakeAgentBrowser({ pages: agentBrowserPages() });
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint({ targets: [] });
  t.after(() => endpoint.close());

  const context = observerContext(dir);
  const env = observerEnv(fake, endpoint);

  const none = await createA11ySnapshotObserver({ context, required: false, env }).observer.run(
    fakeSession(context.runId, RELEASES_URL),
  );
  assert.equal(none.status, "unavailable");
  assert.equal(none.reason, "tab_bind_ambiguous");
  assert.match(none.detail, /not in \/json\/list/);

  endpoint.setTargets([
    pageTarget(TARGET_ID, RELEASES_URL, "Releases"),
    pageTarget("SECOND", RELEASES_URL, "Releases (again)"),
  ]);
  const twice = await createA11ySnapshotObserver({ context, required: false, env }).observer.run(
    fakeSession(context.runId, RELEASES_URL),
  );
  assert.equal(twice.reason, "tab_bind_ambiguous");
  assert.match(twice.detail, /Candidates: 82FF618C514C4D95C04EFD4AAF478A48, SECOND/);

  // Nothing was ever spawned: the binding is decided from the browser's own target list.
  assert.deepEqual(fake.verbs(), []);
});

test("a snapshot whose origin is not the bound tab is origin_mismatch", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = createFakeAgentBrowser({
    pages: agentBrowserPages(),
    origin: "https://github.com/nicobailon/surf-cli/tags",
  });
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint({
    targets: [pageTarget(TARGET_ID, RELEASES_URL, "Releases")],
  });
  t.after(() => endpoint.close());

  const context = observerContext(dir);
  const observation = await createA11ySnapshotObserver({
    context,
    required: false,
    env: observerEnv(fake, endpoint),
  }).observer.run(fakeSession(context.runId, RELEASES_URL));

  assert.equal(observation.status, "unavailable");
  assert.equal(observation.reason, "origin_mismatch");
  assert.match(observation.detail, /tags while the bound tab is/);
  assert.equal(artifactsIn(dir, context.runId)[0].body.status, "unavailable");
});

test("an empty tree is a failure, and a refusing tool is snapshot_failed", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const endpoint = await startFakeCdpEndpoint({
    targets: [pageTarget(TARGET_ID, RELEASES_URL, "Releases")],
  });
  t.after(() => endpoint.close());
  const context = observerContext(dir);

  const empty = createFakeAgentBrowser({ pages: agentBrowserPages(), emptyOn: ["snapshot"] });
  t.after(() => empty.cleanup());
  const emptyObservation = await createA11ySnapshotObserver({
    context,
    required: false,
    env: observerEnv(empty, endpoint),
  }).observer.run(fakeSession(context.runId, RELEASES_URL));
  assert.equal(emptyObservation.reason, "empty_snapshot");
  assert.match(emptyObservation.detail, /never a zero-element success/);

  const gone = createFakeAgentBrowser({ pages: agentBrowserPages(), tabGoneOn: ["snapshot"] });
  t.after(() => gone.cleanup());
  const goneObservation = await createA11ySnapshotObserver({
    context,
    required: false,
    env: observerEnv(gone, endpoint),
  }).observer.run(fakeSession(context.runId, RELEASES_URL));
  assert.equal(goneObservation.reason, "tab_lost");

  const broken = createFakeAgentBrowser({ pages: agentBrowserPages(), failOn: ["snapshot"] });
  t.after(() => broken.cleanup());
  const brokenObservation = await createA11ySnapshotObserver({
    context,
    required: false,
    env: observerEnv(broken, endpoint),
  }).observer.run(fakeSession(context.runId, RELEASES_URL));
  assert.equal(brokenObservation.reason, "snapshot_failed");
});

test("required raises a11y_channel_unavailable; optional records the same reason and continues", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const endpoint = await startFakeCdpEndpoint({ targets: [] });
  t.after(() => endpoint.close());
  const context = observerContext(dir);
  const env = {
    PATH: path.dirname(process.execPath),
    HOME: mkdtempSync(path.join(os.tmpdir(), "tc-a11y-home-")),
    TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
  };

  const optional = createA11ySnapshotObserver({ context, required: false, env });
  const recorded = await optional.observer.run(fakeSession(context.runId, PAGE_URL));
  assert.equal(recorded.status, "unavailable");
  assert.equal(recorded.reason, "agent_browser_missing");

  const required = createA11ySnapshotObserver({ context, required: true, env });
  let raised;
  try {
    await required.observer.run(fakeSession(context.runId, PAGE_URL));
  } catch (error) {
    raised = error;
  }
  assert.equal(raised?.code, "a11y_channel_unavailable");
  assert.match(raised.message, /agent_browser_missing/);
  // The observation is recorded on the handle even when the refusal is raised.
  assert.equal(required.observation().reason, "agent_browser_missing");
  assert.equal(required.observation().status, "unavailable");
  // Both wrote an artifact: an unavailable channel is a recorded gap, never a silent skip.
  assert.equal(artifactsIn(dir, context.runId).length, 2);
});

test("the observer is registered read-only, so a session refuses it if it ever claimed otherwise", () => {
  assert.equal(A11Y_SNAPSHOT_EFFECT.effect, "read_only");
  assert.match(A11Y_SNAPSHOT_EFFECT.reason, /opens, navigates and clicks nothing/);
  // ...and it does not claim to leave the browser untouched: 0.35.1 strands a page (AK #5567)
  assert.match(A11Y_SNAPSHOT_EFFECT.reason, /leaves one about:blank page target/);
});

test("a leak is attributed, never subtracted: only the measured stray is known (AK #5567)", () => {
  const before = [pageTarget("A", RELEASES_URL)];
  const stray = [pageTarget("A", RELEASES_URL), pageTarget("B", "about:blank")];
  assert.equal(tabLeakOf(before, before, "0.35.1"), undefined);
  assert.deepEqual(tabLeakOf(before, stray, "0.35.1"), {
    before: 1,
    after: 2,
    urls: ["about:blank"],
    attribution: "known_producer_stray",
  });
  // A page that went away is not a leak.
  assert.equal(tabLeakOf(stray, before, "0.35.1"), undefined);

  // Everything outside the measured signature is unexplained.
  const unexplained = (after, version) => tabLeakOf(before, after, version)?.attribution;
  assert.equal(unexplained(stray, "0.38.0"), "known_producer_stray", "measured 2026-09-23");
  assert.equal(unexplained(stray, "0.36.0"), "unexplained", "a version nobody measured");
  assert.equal(unexplained(stray, undefined), "unexplained", "no version at all");
  assert.equal(
    unexplained([...stray, pageTarget("C", "about:blank")], "0.35.1"),
    "unexplained",
    "a second page",
  );
  assert.equal(
    unexplained([pageTarget("A", RELEASES_URL), pageTarget("B", PAGE_URL)], "0.35.1"),
    "unexplained",
    "a page that is not about:blank",
  );
});

/** A channel whose `after` read finds `leaked` beside the bound tab. */
async function leakingChannel(t, leaked, required) {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = createFakeAgentBrowser({ pages: agentBrowserPages() });
  t.after(() => fake.cleanup());
  const bound = pageTarget(TARGET_ID, RELEASES_URL, "Releases");
  const endpoint = await startFakeCdpEndpoint({ listSequence: [[bound], [bound, ...leaked]] });
  t.after(() => endpoint.close());
  const context = observerContext(dir);
  const handle = createA11ySnapshotObserver({
    context,
    required,
    env: observerEnv(fake, endpoint),
  });
  let raised;
  let returned;
  try {
    returned = await handle.observer.run(fakeSession(context.runId, RELEASES_URL));
  } catch (error) {
    raised = error;
  }
  return { handle, raised, returned, artifacts: artifactsIn(dir, context.runId) };
}

test("the measured stray is evidence even on a required channel", async (t) => {
  const run = await leakingChannel(t, [pageTarget("STRAY", "about:blank")], true);
  assert.equal(run.raised, undefined);
  assert.equal(run.returned.status, "captured");
  assert.equal(run.returned.tabLeak.attribution, "known_producer_stray");
  assert.equal(run.artifacts[0].body.tabLeak.attribution, "known_producer_stray");
});

test("an unexplained leak refuses a required channel with tab_leak, keeping what it saw", async (t) => {
  const run = await leakingChannel(t, [pageTarget("POPUP", "https://ads.example/")], true);
  assert.equal(run.raised?.code, "tab_leak");
  assert.match(run.raised.message, /https:\/\/ads\.example\//);
  assert.deepEqual(run.raised.details.urls, ["https://ads.example/"]);
  // the refusal and the evidence are different facts: both survive
  assert.equal(run.handle.observation().status, "captured");
  assert.equal(run.handle.observation().tabLeak.attribution, "unexplained");
  assert.equal(run.artifacts.length, 1);
  assert.equal(run.artifacts[0].body.tabLeak.attribution, "unexplained");
});

test("an unexplained leak on an optional channel is recorded and does not refuse", async (t) => {
  const run = await leakingChannel(t, [pageTarget("POPUP", "https://ads.example/")], false);
  assert.equal(run.raised, undefined);
  assert.equal(run.returned.status, "captured");
  assert.equal(run.returned.tabLeak.attribution, "unexplained");
});

test("the channel summary names the producer and the tool that answered", () => {
  assert.deepEqual(a11yChannelSummary(undefined, []), {});
  assert.deepEqual(a11yChannelSummary("required", []), {
    a11yChannel: { mode: "required", channel: "agent-browser-cdp", status: "unavailable" },
  });
  assert.deepEqual(
    a11yChannelSummary("optional", [
      {
        channel: "agent-browser-cdp",
        status: "captured",
        tool: { command: "/bin/agent-browser", version: "0.35.1" },
        endpoint: "http://127.0.0.1:9222",
      },
    ]),
    {
      a11yChannel: {
        mode: "optional",
        channel: "agent-browser-cdp",
        tool: "/bin/agent-browser",
        version: "0.35.1",
        endpoint: "http://127.0.0.1:9222",
        status: "captured",
      },
    },
  );
});

// ============================================
// THE WHOLE RUN
// ============================================

/** Point the in-process observer at the fakes for the duration of `callback`. */
async function withA11yEnv(overrides, callback) {
  const keys = [
    "TEST_CAPABILITIES_AGENT_BROWSER_BIN",
    "TEST_CAPABILITIES_CDP_ENDPOINT",
    "TEST_CAPABILITIES_RECEIPTS_DIR",
    "TEST_CAPABILITIES_RECEIPTS_EPHEMERAL",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    return await callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

test("surf explore --a11y-snapshot binds the surf-owned tab and tears down before it closes", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sharedLog = path.join(dir, "order.log");

  const surf = createFakeSurf({ pages: readyPages({ [PAGE_URL]: {} }), log: sharedLog });
  t.after(() => surf.cleanup());
  const agentBrowser = createFakeAgentBrowser({
    pages: { [TARGET_ID]: { ...CAPTURE.stdout.data, origin: PAGE_URL, title: "Example Domain" } },
    log: sharedLog,
  });
  t.after(() => agentBrowser.cleanup());
  const endpoint = await startFakeCdpEndpoint({
    targets: [pageTarget(TARGET_ID, PAGE_URL, "Example Domain")],
  });
  t.after(() => endpoint.close());

  const envelope = await withA11yEnv(
    {
      TEST_CAPABILITIES_AGENT_BROWSER_BIN: agentBrowser.path,
      TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
      TEST_CAPABILITIES_RECEIPTS_DIR: dir,
      TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    },
    () =>
      withFakeSurfEnv(surf.path, () =>
        executeSurfExploreOperation({ url: PAGE_URL, a11ySnapshot: "required" }),
      ),
  );

  assert.equal(envelope.result.coverage.userFlows, 100);
  const page = envelope.result.pages[0];
  assert.equal(page.verified, true);
  assert.equal(page.observations.length, 1);
  assert.equal(page.observations[0].status, "captured");
  assert.equal(page.observations[0].digest, CAPTURE.digest);
  assert.equal(page.observations[0].snapshot, undefined);
  // The `dom` probe of the same page visit fed the coverage comparison.
  assert.equal(typeof page.observations[0].semanticCoverage.anchors.dom, "number");
  assert.equal(page.observations[0].semanticCoverage.anchors.tree, 95);

  assert.deepEqual(envelope.result.runtime.a11yChannel, {
    mode: "required",
    channel: "agent-browser-cdp",
    tool: agentBrowser.path,
    version: "0.35.1",
    endpoint: endpoint.url,
    status: "captured",
  });

  // Teardown order (packet, "Coexistence"): the pinned session ends before surf closes the tab.
  const order = readFileSync(sharedLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((call) =>
      call.includes("--pin-tab") ? `agent-browser ${call[call.length - 1]}` : `surf ${call[0]}`,
    )
    .filter((entry) => !entry.startsWith("surf --"));
  assert.deepEqual(order, [
    "surf tab.new",
    "surf wait.ready",
    "surf js",
    "surf js",
    "agent-browser 82FF618C514C4D95C04EFD4AAF478A48",
    "agent-browser --json",
    "agent-browser close",
    "surf tab.close",
  ]);
});

test("without the flag the explore envelope carries no observations and spawns no second tool", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: readyPages({ [PAGE_URL]: {} }) });
  t.after(() => surf.cleanup());
  const agentBrowser = createFakeAgentBrowser({ pages: agentBrowserPages(PAGE_URL) });
  t.after(() => agentBrowser.cleanup());
  const endpoint = await startFakeCdpEndpoint({
    targets: [pageTarget(TARGET_ID, PAGE_URL, "Example Domain")],
  });
  t.after(() => endpoint.close());

  const envelope = await withA11yEnv(
    {
      TEST_CAPABILITIES_AGENT_BROWSER_BIN: agentBrowser.path,
      TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
      TEST_CAPABILITIES_RECEIPTS_DIR: dir,
      TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    },
    () => withFakeSurfEnv(surf.path, () => executeSurfExploreOperation({ url: PAGE_URL })),
  );

  assert.equal(envelope.result.pages[0].observations, undefined);
  assert.equal(envelope.result.runtime.a11yChannel, undefined);
  assert.deepEqual(agentBrowser.calls(), []);
  assert.deepEqual(endpoint.requests, []);
});

test("an optional channel that cannot observe leaves the page verified and names the reason", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: readyPages({ [PAGE_URL]: {} }) });
  t.after(() => surf.cleanup());
  const endpoint = await startFakeCdpEndpoint({ targets: [] });
  t.after(() => endpoint.close());
  await endpoint.close();

  const envelope = await withA11yEnv(
    {
      TEST_CAPABILITIES_AGENT_BROWSER_BIN: "/nonexistent/agent-browser",
      TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
      TEST_CAPABILITIES_RECEIPTS_DIR: dir,
      TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    },
    () =>
      withFakeSurfEnv(surf.path, () =>
        executeSurfExploreOperation({ url: PAGE_URL, a11ySnapshot: true }),
      ),
  );

  assert.equal(envelope.result.pages[0].verified, true);
  assert.equal(envelope.result.coverage.userFlows, 100);
  assert.equal(envelope.result.pages[0].observations[0].status, "unavailable");
  assert.equal(envelope.result.pages[0].observations[0].reason, "agent_browser_missing");
  assert.equal(envelope.result.runtime.a11yChannel.mode, "optional");
  assert.equal(envelope.result.runtime.a11yChannel.status, "unavailable");
});

test("a required channel that cannot observe fails the page and keeps the observation", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const surf = createFakeSurf({ pages: readyPages({ [PAGE_URL]: {} }) });
  t.after(() => surf.cleanup());
  const endpoint = await startFakeCdpEndpoint({ targets: [] });
  t.after(() => endpoint.close());

  const envelope = await withA11yEnv(
    {
      TEST_CAPABILITIES_AGENT_BROWSER_BIN: "/nonexistent/agent-browser",
      TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
      TEST_CAPABILITIES_RECEIPTS_DIR: dir,
      TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    },
    () =>
      withFakeSurfEnv(surf.path, () =>
        executeSurfExploreOperation({ url: PAGE_URL, a11ySnapshot: "required" }).catch(
          (error) => error,
        ),
      ),
  );

  // The seed page is refused, and the refusal carries the channel's own code rather than a
  // generic `probe_unverified`: a required channel that could not observe is the reason.
  assert.equal(envelope.code, "a11y_channel_unavailable");
  assert.match(envelope.message, /agent_browser_missing/);
  assert.equal(envelope.details.probe, "state");
});

test("an unknown --a11y-snapshot value is refused before a tab is opened", async (t) => {
  const surf = createFakeSurf({ pages: readyPages({ [PAGE_URL]: {} }) });
  t.after(() => surf.cleanup());

  let raised;
  try {
    await withFakeSurfEnv(surf.path, () =>
      executeSurfExploreOperation({ url: PAGE_URL, a11ySnapshot: "sometimes" }),
    );
  } catch (error) {
    raised = error;
  }
  assert.equal(raised?.code, "config_invalid");
  assert.match(raised.message, /off, optional, required/);
  assert.deepEqual(surf.calls(), []);
});

test("a channel that never bound a tab starts no session, and so tears none down", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = createFakeAgentBrowser({ pages: agentBrowserPages() });
  t.after(() => fake.cleanup());
  // The endpoint is gone, so the probe refuses before anything is spawned - but the binary is
  // right there, and a teardown that ran anyway would create a session (and its stray
  // `about:blank`) purely in order to close it.
  const endpoint = await startFakeCdpEndpoint({ targets: [] });
  await endpoint.close();

  const context = observerContext(dir);
  const handle = createA11ySnapshotObserver({
    context,
    required: false,
    env: observerEnv(fake, endpoint),
  });
  const observation = await handle.observer.run(fakeSession(context.runId, RELEASES_URL));
  await handle.observer.teardown();

  assert.equal(observation.status, "unavailable");
  assert.equal(observation.reason, "cdp_endpoint_unreachable");
  // `--version` is the capability probe and creates nothing; no session verb ran.
  assert.deepEqual(
    fake.calls().map((call) => call.join(" ")),
    ["--version"],
  );
  assert.deepEqual(fake.verbs(), []);
});

test("a channel that bound a tab and then failed still ends its session", async (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fake = createFakeAgentBrowser({ pages: agentBrowserPages(), failOn: ["snapshot"] });
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint({
    targets: [pageTarget(TARGET_ID, RELEASES_URL, "Releases")],
  });
  t.after(() => endpoint.close());

  const context = observerContext(dir);
  const handle = createA11ySnapshotObserver({
    context,
    required: false,
    env: observerEnv(fake, endpoint),
  });
  const observation = await handle.observer.run(fakeSession(context.runId, RELEASES_URL));
  await handle.observer.teardown();

  assert.equal(observation.reason, "snapshot_failed");
  assert.deepEqual(fake.verbs(), ["tab", "snapshot", "close"]);
});
