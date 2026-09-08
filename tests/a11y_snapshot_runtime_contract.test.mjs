import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The agent-browser adapter (implementation plan S9 commit (1); a11y-snapshot packet,
 * "Resolution and probe" and "Non-goals"; adjudication claim 28).
 *
 * Everything here runs against the fake binary and a fake `node:http` DevTools endpoint on
 * `127.0.0.1:0` - `npm test` never touches a browser. What is proven: the resolution order, the
 * version floor, the loopback rule applied before any request, the two transports behind one
 * `invoke`, and the argv allowlist - which is checked in both directions, that the globals which
 * make an invocation *attach* are always present, and that no action verb can be expressed.
 */

const runtime = await importRuntimeModule("core/a11y-snapshot-runtime.js");
const pure = await importRuntimeModule("core/a11y-snapshot.js");
const { invokeAdapter } = await importRuntimeModule("core/adapter.js");

const CAPTURE = releasesCapture();
const TARGET_ID = "82FF618C514C4D95C04EFD4AAF478A48";

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), "tc-a11y-runtime-"));
}

/** `assert.throws` returns nothing, and every case here is about the code that was raised. */
function raised(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("expected a refusal, nothing was thrown");
}

async function rejected(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return assert.fail("expected a rejection, nothing was thrown");
}

/** An env with no agent-browser anywhere: no PATH entry and an empty HOME. */
function bareEnv(extra = {}) {
  return {
    PATH: path.dirname(process.execPath),
    HOME: mkdtempSync(path.join(os.tmpdir(), "tc-a11y-home-")),
    ...extra,
  };
}

test("resolution prefers the env var, then PATH, then ~/.npm-global/bin with a note", async (t) => {
  const fake = createFakeAgentBrowser();
  t.after(() => fake.cleanup());

  const explicit = runtime.resolveAgentBrowserResolution(
    bareEnv({ TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path }),
  );
  assert.equal(explicit.provider, "explicit_bin");
  assert.equal(explicit.command, fake.path);
  assert.deepEqual(explicit.resolutionNotes, []);

  const onPath = runtime.resolveAgentBrowserResolution(bareEnv({ PATH: fake.binDir }));
  assert.equal(onPath.provider, "path");
  assert.equal(onPath.command, fake.path);

  // ~/.npm-global/bin is on the login shell's PATH and not on every tool shell's, so it is a
  // resolution step with a note rather than the operator's problem.
  const home = mkdtempSync(path.join(os.tmpdir(), "tc-a11y-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const npmGlobal = createFakeAgentBrowser();
  t.after(() => npmGlobal.cleanup());
  const { chmodSync, copyFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(path.join(home, ".npm-global", "bin"), { recursive: true });
  const homeBin = path.join(home, ".npm-global", "bin", "agent-browser");
  copyFileSync(npmGlobal.path, homeBin);
  chmodSync(homeBin, 0o755);

  const fromHome = runtime.resolveAgentBrowserResolution({
    PATH: path.dirname(process.execPath),
    HOME: home,
  });
  assert.equal(fromHome.provider, "npm_global_bin");
  assert.match(fromHome.resolutionNotes[0], /not on PATH for this process/);
});

test("no agent-browser anywhere is agent_browser_missing, never a launched browser", () => {
  const error = raised(() => runtime.resolveAgentBrowserResolution(bareEnv()));
  assert.equal(error.code, "agent_browser_missing");
  assert.match(error.message, /never launches a browser of its own/);
});

test("an env var pointing at nothing executable is agent_browser_missing", () => {
  const error = raised(() =>
    runtime.resolveAgentBrowserResolution(
      bareEnv({ TEST_CAPABILITIES_AGENT_BROWSER_BIN: "/nonexistent/agent-browser" }),
    ),
  );
  assert.equal(error.code, "agent_browser_missing");
});

test("the version floor names both numbers and refuses below 0.35.1", async (t) => {
  const old = createFakeAgentBrowser({ version: "0.34.9" });
  const current = createFakeAgentBrowser({ version: "0.35.1" });
  const newer = createFakeAgentBrowser({ version: "0.36.0" });
  t.after(() => {
    old.cleanup();
    current.cleanup();
    newer.cleanup();
  });

  const resolutionFor = (fake) =>
    runtime.resolveAgentBrowserResolution(
      bareEnv({ TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path }),
    );

  runtime.resetAgentBrowserProbeCache();
  const error = await rejected(() =>
    runtime.probeAgentBrowser(resolutionFor(old), { cache: false }),
  );
  assert.equal(error.code, "agent_browser_too_old");
  assert.match(error.message, /0\.34\.9 .* is below the 0\.35\.1 floor/);

  assert.equal(
    (await runtime.probeAgentBrowser(resolutionFor(current), { cache: false })).version,
    "0.35.1",
  );
  assert.equal(
    (await runtime.probeAgentBrowser(resolutionFor(newer), { cache: false })).version,
    "0.36.0",
  );
});

test("compareVersions orders dotted versions and treats a missing segment as zero", () => {
  assert.equal(runtime.compareVersions("0.35.1", "0.35.1"), 0);
  assert.equal(runtime.compareVersions("0.35.0", "0.35.1"), -1);
  assert.equal(runtime.compareVersions("0.36", "0.35.1"), 1);
  assert.equal(runtime.compareVersions("1.0.0", "0.99.99"), 1);
});

test("a binary that does not answer --version is missing, not old", async (t) => {
  // `--version` is answered before any knob, so the case needs a binary that is not the fixture.
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { writeFileSync } = await import("node:fs");
  const bin = path.join(dir, "agent-browser");
  writeFileSync(bin, "#!/bin/sh\nexit 3\n", { mode: 0o755 });

  const error = await rejected(() =>
    runtime.probeAgentBrowser(
      runtime.resolveAgentBrowserResolution(bareEnv({ TEST_CAPABILITIES_AGENT_BROWSER_BIN: bin })),
      { cache: false },
    ),
  );
  assert.equal(error.code, "agent_browser_missing");
});

test("a non-loopback CDP endpoint is refused before any request is made", async (t) => {
  const fake = createFakeAgentBrowser();
  t.after(() => fake.cleanup());

  for (const endpoint of [
    "http://10.0.0.5:9222",
    "http://example.com:9222",
    "ws://127.0.0.1:9222",
    "not-a-url",
  ]) {
    const error = raised(() =>
      runtime.resolveAgentBrowserResolution(
        bareEnv({
          TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path,
          TEST_CAPABILITIES_CDP_ENDPOINT: endpoint,
        }),
      ),
    );
    assert.equal(error.code, "cdp_endpoint_refused", endpoint);
  }

  for (const endpoint of ["http://127.0.0.1:9222", "http://localhost:9333", "http://[::1]:9222"]) {
    const resolved = runtime.resolveCdpEndpoint({ TEST_CAPABILITIES_CDP_ENDPOINT: endpoint });
    assert.ok(resolved.port > 0, endpoint);
  }
});

test("the endpoint probe separates 'nothing is listening' from 'not a browser'", async (t) => {
  const fake = createFakeAgentBrowser();
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint();
  t.after(() => endpoint.close());

  const resolutionFor = (url) =>
    runtime.resolveAgentBrowserResolution(
      bareEnv({
        TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path,
        TEST_CAPABILITIES_CDP_ENDPOINT: url,
      }),
    );

  const version = await runtime.probeCdpEndpoint(resolutionFor(endpoint.url));
  assert.match(version.browser, /^Chrome\//);
  assert.ok(endpoint.requests.includes("/json/version"));

  endpoint.setVersionBody(JSON.stringify({ hello: "world" }));
  assert.equal(
    (await rejected(() => runtime.probeCdpEndpoint(resolutionFor(endpoint.url)))).code,
    "cdp_endpoint_not_chromium",
  );

  endpoint.setVersionBody("<html>not json</html>");
  assert.equal(
    (await rejected(() => runtime.probeCdpEndpoint(resolutionFor(endpoint.url)))).code,
    "cdp_endpoint_not_chromium",
  );

  await endpoint.close();
  assert.equal(
    (
      await rejected(() =>
        runtime.probeCdpEndpoint(resolutionFor(endpoint.url), { timeoutMs: 500 }),
      )
    ).code,
    "cdp_endpoint_unreachable",
  );
});

test("/json/list is an HTTP invoke: page targets come back typed, without agent-browser", async (t) => {
  const fake = createFakeAgentBrowser();
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint({
    targets: [
      pageTarget(TARGET_ID, "https://github.com/nicobailon/surf-cli/releases", "Releases"),
      { id: "SW", type: "service_worker", url: "chrome-extension://x/sw.js", title: "" },
    ],
  });
  t.after(() => endpoint.close());

  const resolution = runtime.resolveAgentBrowserResolution(
    bareEnv({
      TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path,
      TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
    }),
  );
  const targets = await runtime.listCdpTargets(resolution);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].id, TARGET_ID);
  assert.equal(targets[0].type, "page");
  // The HTTP transport never spawns: the fake binary was not invoked once.
  assert.deepEqual(fake.calls(), []);
});

test("the argv allowlist passes the read-only verbs and refuses everything else", () => {
  const resolution = {
    command: "/bin/agent-browser",
    provider: "explicit_bin",
    resolutionNotes: [],
    endpoint: { url: "http://127.0.0.1:9222", host: "127.0.0.1", port: 9222 },
    session: "test-capabilities-run-1",
  };

  assert.deepEqual(runtime.translateA11yArgs("snapshot", ["-i", "--json"], resolution), [
    "--cdp",
    "9222",
    "--session",
    "test-capabilities-run-1",
    "--pin-tab",
    "snapshot",
    "-i",
    "--json",
  ]);
  assert.ok(runtime.translateA11yArgs("tab", [TARGET_ID], resolution).includes(TARGET_ID));
  assert.ok(runtime.translateA11yArgs("is", ["visible", "@e28"], resolution).includes("visible"));
  assert.ok(runtime.translateA11yArgs("get", ["attr", "@e26", "href"], resolution).length > 0);
  assert.ok(runtime.translateA11yArgs("close", [], resolution).includes("close"));

  // Nothing that acts, nothing that launches, nothing that reaches another profile.
  for (const [command, args] of [
    ["open", ["https://example.com/"]],
    ["click", ["@e28"]],
    ["fill", ["@e28", "x"]],
    ["type", ["@e28", "x"]],
    ["eval", ["document.title = 'x'"]],
    ["cookies", ["get"]],
    ["screenshot", []],
    ["a11y", []],
    ["network", ["route", "**"]],
    ["chat", ["do the thing"]],
  ]) {
    const error = raised(() => runtime.translateA11yArgs(command, args, resolution));
    assert.equal(error.code, "a11y_command_not_allowed", command);
    assert.match(error.message, /surf is the only action channel/);
  }

  for (const [command, args] of [
    ["snapshot", ["--profile", "Default"]],
    ["snapshot", ["--auto-connect"]],
    ["snapshot", ["--headed"]],
    ["close", ["--all"]],
    ["get", ["cookies", "@e1"]],
    ["is", ["logged-in", "@e1"]],
    ["tab", ["new", "https://example.com/"]],
  ]) {
    const error = raised(() => runtime.translateA11yArgs(command, args, resolution));
    assert.equal(error.code, "a11y_command_not_allowed", `${command} ${args.join(" ")}`);
  }
});

test("every spawned invocation carries --cdp, --session and --pin-tab", async (t) => {
  const fake = createFakeAgentBrowser();
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint();
  t.after(() => endpoint.close());

  const env = bareEnv({
    TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path,
    TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
    TEST_CAPABILITIES_AGENT_BROWSER_SESSION: "test-capabilities-run-7",
  });

  await invokeAdapter(
    runtime.agentBrowserAdapter,
    { id: "bind", command: "tab", args: [TARGET_ID] },
    { env },
  );
  await invokeAdapter(
    runtime.agentBrowserAdapter,
    { id: "snap", command: "snapshot", args: ["-i", "--json"] },
    { env },
  );

  for (const call of fake.calls()) {
    assert.ok(call.includes("--cdp"), call.join(" "));
    assert.equal(call[call.indexOf("--session") + 1], "test-capabilities-run-7");
    assert.ok(call.includes("--pin-tab"), call.join(" "));
  }
  assert.deepEqual(fake.verbs(), ["tab", "snapshot"]);
});

test("the adapter declares read_only for every allowed verb and unclassified for the rest", () => {
  const { agentBrowserAdapter } = runtime;
  for (const command of ["snapshot", "get", "is", "tab", "json.version", "json.list"]) {
    const effect = agentBrowserAdapter.effects({ id: "x", command });
    assert.equal(effect.effect, "read_only", command);
    assert.equal(effect.scope, undefined, command);
  }
  const close = agentBrowserAdapter.effects({ id: "x", command: "close" });
  assert.equal(close.effect, "read_only");
  assert.equal(close.scope, "browser_session");

  const click = agentBrowserAdapter.effects({ id: "x", command: "click" });
  assert.equal(click.effect, "unclassified");
});

test("the session name is the run's, never the shared default session", () => {
  assert.equal(runtime.sessionNameForRun("run-42", {}), "test-capabilities-run-42");
  assert.equal(
    runtime.sessionNameForRun("run-42", { TEST_CAPABILITIES_AGENT_BROWSER_SESSION_PREFIX: "tc" }),
    "tc-run-42",
  );
  assert.notEqual(runtime.resolveSessionName({}), "default");
});

test("the fake agent-browser reproduces the committed live capture (fidelity, review A17)", async (t) => {
  const fake = createFakeAgentBrowser();
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint();
  t.after(() => endpoint.close());

  const env = bareEnv({
    TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path,
    TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
    TEST_CAPABILITIES_AGENT_BROWSER_SESSION: "fidelity",
  });

  await invokeAdapter(
    runtime.agentBrowserAdapter,
    { id: "bind", command: "tab", args: [TARGET_ID] },
    { env },
  );
  const snap = await invokeAdapter(
    runtime.agentBrowserAdapter,
    { id: "snap", command: "snapshot", args: ["-i", "--json"] },
    { env },
  );

  const payload = JSON.parse(snap.raw.stdout);
  assert.equal(payload.success, true);
  const parsed = pure.parseA11ySnapshotPayload(payload.data);
  assert.ok("reading" in parsed, JSON.stringify(parsed).slice(0, 200));
  assert.equal(Object.keys(parsed.reading.refs).length, CAPTURE.refCount);
  assert.equal(Buffer.byteLength(parsed.reading.snapshot, "utf8"), CAPTURE.bytes);
  assert.equal(pure.snapshotDigest(parsed.reading.snapshot), CAPTURE.digest);
  assert.equal(parsed.reading.origin, CAPTURE.url);

  // The live role mix the packet measured, reproduced from the capture.
  const roles = pure.roleCountsFrom(parsed.reading.refs);
  assert.equal(roles.link, 95);
  assert.equal(roles.heading, 58);
  assert.equal(roles.button, 24);
  assert.equal(roles.searchbox, 1);
});

test("the HTTP transport refuses what is not a target list, and says when nothing answered", async (t) => {
  const fake = createFakeAgentBrowser();
  t.after(() => fake.cleanup());
  const endpoint = await startFakeCdpEndpoint({ targets: [] });
  t.after(() => endpoint.close());

  const resolution = runtime.resolveAgentBrowserResolution(
    bareEnv({
      TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path,
      TEST_CAPABILITIES_CDP_ENDPOINT: endpoint.url,
    }),
  );

  assert.deepEqual(await runtime.listCdpTargets(resolution), []);

  endpoint.setVersionBody(JSON.stringify({ Browser: "Chrome/152" }), 503);
  const status = await rejected(() => runtime.probeCdpEndpoint(resolution));
  assert.equal(status.code, "cdp_endpoint_not_chromium");
  assert.match(status.message, /answered HTTP 503/);

  await endpoint.close();
  const gone = await rejected(() => runtime.listCdpTargets(resolution, { timeoutMs: 500 }));
  assert.equal(gone.code, "cdp_endpoint_unreachable");
});

test("the adapter translates the HTTP verbs into GETs and spawns nothing for them", async (t) => {
  const fake = createFakeAgentBrowser();
  t.after(() => fake.cleanup());
  const resolution = runtime.resolveAgentBrowserResolution(
    bareEnv({ TEST_CAPABILITIES_AGENT_BROWSER_BIN: fake.path }),
  );

  const version = runtime.agentBrowserAdapter.translate(
    { id: "v", command: "json.version" },
    resolution,
  );
  assert.equal(version.source, "http");
  assert.match(version.command, /\/json\/version$/);
  assert.deepEqual(version.display, ["GET", version.command]);

  const list = runtime.agentBrowserAdapter.translate({ id: "l", command: "json.list" }, resolution);
  assert.match(list.command, /\/json\/list$/);

  // The capability probe is the async `probeAgentBrowser`; the interface member answers nothing.
  assert.equal(runtime.agentBrowserAdapter.probe(resolution), undefined);
  assert.deepEqual(fake.calls(), []);
});

test("a verb that needs a subcommand refuses without one", () => {
  const resolution = {
    command: "/bin/agent-browser",
    provider: "explicit_bin",
    resolutionNotes: [],
    endpoint: { url: "http://127.0.0.1:9222", host: "127.0.0.1", port: 9222 },
    session: "s",
  };
  assert.equal(
    raised(() => runtime.translateA11yArgs("get", [], resolution)).code,
    "a11y_command_not_allowed",
  );
  assert.equal(
    raised(() => runtime.translateA11yArgs("is", [], resolution)).code,
    "a11y_command_not_allowed",
  );
  assert.equal(
    raised(() => runtime.translateA11yArgs("tab", [TARGET_ID, "extra"], resolution)).code,
    "a11y_command_not_allowed",
  );
  assert.equal(
    raised(() => runtime.translateA11yArgs("snapshot", ["main"], resolution)).code,
    "a11y_command_not_allowed",
  );
});

// ============================================
// THE ARTIFACT CONTRACT AND THE EVALUATOR
// ============================================

const REFS = {
  e28: { role: "searchbox", name: "Find a release" },
  e26: { role: "link", name: "Releases" },
  e27: { role: "link", name: "Tags" },
  e40: { role: "link", name: "v2.18.0" },
  e41: { role: "link", name: "v2.18.0" },
};
const VIEW = { digest: pure.snapshotDigest("tree-a"), refs: REFS };

test("the digest is content identity: the same text, the same digest; one byte, another", () => {
  assert.equal(pure.snapshotDigest("tree-a"), pure.snapshotDigest("tree-a"));
  assert.notEqual(pure.snapshotDigest("tree-a"), pure.snapshotDigest("tree-b"));
  assert.match(pure.snapshotDigest(""), /^sha256:[0-9a-f]{64}$/);
});

test("a11y-ref: the minting digest passes, and any other digest is ref_context_drift", async () => {
  const assertion = {
    kind: "a11y-ref",
    snapshotDigest: VIEW.digest,
    ref: "e28",
    expect: { role: "searchbox", name: "Find a release", visible: true },
  };

  const passed = await pure.evaluateA11yAssertion(assertion, VIEW, {
    visible: async (ref) => ({ command: `is visible @${ref}`, value: "true" }),
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.ref, "e28");

  // The reload case the packet's measurement recorded: the tree came back byte-identical, so the
  // digest is the same and the ref is evaluated normally rather than drifting.
  const afterIdenticalReload = await pure.evaluateA11yAssertion(
    assertion,
    { digest: pure.snapshotDigest("tree-a"), refs: { ...REFS } },
    { visible: async (ref) => ({ command: `is visible @${ref}`, value: "true" }) },
  );
  assert.equal(afterIdenticalReload.status, "passed");

  // A navigation changes the tree, so the digest changes and nothing may be read through the ref.
  const drifted = await pure.evaluateA11yAssertion(assertion, {
    digest: pure.snapshotDigest("tree-b"),
    refs: REFS,
  });
  assert.equal(drifted.status, "unverified");
  assert.equal(drifted.code, "ref_context_drift");
  assert.equal(drifted.expectedDigest, VIEW.digest);
  assert.match(drifted.reason, /assert by \{role, name\} instead/);
});

test("a11y-ref: a matching digest whose ref names another control is drift, not a failure", async () => {
  const renamed = {
    digest: VIEW.digest,
    refs: { ...REFS, e28: { role: "button", name: "Find a release" } },
  };
  const result = await pure.evaluateA11yAssertion(
    { kind: "a11y-ref", snapshotDigest: VIEW.digest, ref: "e28", expect: { role: "searchbox" } },
    renamed,
  );
  assert.equal(result.status, "unverified");
  assert.equal(result.code, "ref_context_drift");

  const absent = await pure.evaluateA11yAssertion(
    { kind: "a11y-ref", snapshotDigest: VIEW.digest, ref: "e99", expect: {} },
    VIEW,
  );
  assert.equal(absent.code, "ref_context_drift");
  assert.match(absent.reason, /ref minting is not reproducible/);
});

test("a11y-role: one match resolves, zero is missing, several are ambiguous with candidates", async () => {
  const unique = await pure.evaluateA11yAssertion(
    { kind: "a11y-role", role: "link", name: "Releases", expect: { visible: true } },
    VIEW,
    { visible: async (ref) => ({ command: `is visible @${ref}`, value: "true" }) },
  );
  assert.equal(unique.status, "passed");
  assert.equal(unique.ref, "e26");

  const missing = await pure.evaluateA11yAssertion(
    { kind: "a11y-role", role: "link", name: "Downloads" },
    VIEW,
  );
  assert.equal(missing.status, "unverified");
  assert.equal(missing.code, "role_name_missing");
  assert.match(missing.reason, /semanticCoverage/);

  const ambiguous = await pure.evaluateA11yAssertion(
    { kind: "a11y-role", role: "link", name: "v2.18.0" },
    VIEW,
  );
  assert.equal(ambiguous.status, "unverified");
  assert.equal(ambiguous.code, "role_name_ambiguous");
  assert.deepEqual(ambiguous.candidates, ["e40", "e41"]);

  assert.deepEqual(pure.findRefsByRoleName(REFS, "link", "v2.18.0"), ["e40", "e41"]);
});

test("an expectation nothing could read is unverified, never a silent pass", async () => {
  const result = await pure.evaluateA11yAssertion(
    { kind: "a11y-role", role: "link", name: "Releases", expect: { visible: true } },
    VIEW,
  );
  assert.equal(result.status, "unverified");
  assert.equal(result.code, "a11y_check_unavailable");

  for (const expectation of [{ text: "Releases" }, { attr: { href: "/releases" } }]) {
    const unread = await pure.evaluateA11yAssertion(
      { kind: "a11y-role", role: "link", name: "Releases", expect: expectation },
      VIEW,
    );
    assert.equal(unread.code, "a11y_check_unavailable");
  }
});

test("a read that disagrees with the expectation is a failure with the reading as evidence", async () => {
  const result = await pure.evaluateA11yAssertion(
    {
      kind: "a11y-role",
      role: "link",
      name: "Releases",
      expect: { role: "link", visible: true, text: "Releases", attr: { href: "/releases" } },
    },
    VIEW,
    {
      visible: async (ref) => ({ command: `is visible @${ref}`, value: "false" }),
      text: async (ref) => ({ command: `get text @${ref}`, value: "Release list" }),
      attr: async (ref, name) => ({ command: `get attr @${ref} ${name}`, value: "/tags" }),
    },
  );
  assert.equal(result.status, "failed");
  assert.match(result.reason, /visible is false/);
  assert.match(result.reason, /text is "Release list"/);
  assert.match(result.reason, /attr href is "\/tags"/);
  assert.ok(result.evidence.some((line) => line.includes("get attr @e26 href")));
});

test("a role that disagrees with the resolved node fails rather than resolving something else", async () => {
  const result = await pure.evaluateA11yAssertion(
    { kind: "a11y-role", role: "link", name: "Releases", expect: { role: "button" } },
    VIEW,
  );
  assert.equal(result.status, "failed");
  assert.match(result.reason, /role is link, expected button/);
});

test("a snapshot payload is mapped or refused; an empty tree is a failure, never a zero", () => {
  const good = pure.parseA11ySnapshotPayload({
    origin: "https://example.com/",
    refs: { e1: { role: "link", name: "More" } },
    snapshot: '- link "More" [ref=e1]',
  });
  assert.equal(good.reading.origin, "https://example.com/");

  assert.equal(pure.parseA11ySnapshotPayload(null).error, "snapshot_failed");
  assert.equal(pure.parseA11ySnapshotPayload({ refs: {} }).error, "snapshot_failed");
  assert.equal(
    pure.parseA11ySnapshotPayload({ snapshot: "x", refs: "nope" }).error,
    "snapshot_failed",
  );
  assert.equal(
    pure.parseA11ySnapshotPayload({ snapshot: "x", refs: { e1: { role: 1 } } }).error,
    "snapshot_failed",
  );
  assert.equal(
    pure.parseA11ySnapshotPayload({ origin: "https://example.com/", refs: {}, snapshot: "" }).error,
    "empty_snapshot",
  );
});

test("semanticCoverage measures the blind spot and never zeroes a probe that did not run", () => {
  const roles = pure.roleCountsFrom(REFS);
  const measured = pure.semanticCoverageFrom(roles, { anchors: 6, buttons: 4, inputs: 3 });
  assert.deepEqual(measured.semanticCoverage.anchors, { dom: 6, tree: 4 });
  assert.deepEqual(measured.semanticCoverage.buttons, { dom: 4, tree: 0 });
  // searchbox is one of the roles the tree can name for an `input,textarea,select` control.
  assert.deepEqual(measured.semanticCoverage.inputs, { dom: 3, tree: 1 });
  assert.deepEqual(pure.semanticCoverageGaps(measured.semanticCoverage), [
    { family: "anchors", missing: 2 },
    { family: "buttons", missing: 4 },
    { family: "inputs", missing: 2 },
  ]);

  const missing = pure.semanticCoverageFrom(roles, undefined);
  assert.equal(missing.coverageReason, "dom_probe_missing");
  assert.equal(missing.semanticCoverage, undefined);

  assert.deepEqual(
    pure.semanticCoverageGaps({
      anchors: { dom: 1, tree: 1 },
      buttons: { dom: 0, tree: 0 },
      inputs: { dom: 0, tree: 1 },
    }),
    [],
  );
});

test("the tester prompt hands over the tree, the gap and the rule that refs are not portable", () => {
  const artifact = {
    schemaVersion: 1,
    kind: "a11y-snapshot",
    channel: "agent-browser-cdp",
    tool: { command: "/home/x/.npm-global/bin/agent-browser", version: "0.35.1" },
    endpoint: { url: "http://127.0.0.1:9222", browser: "Chrome/152" },
    session: "test-capabilities-run-1",
    tab: { targetId: TARGET_ID, url: CAPTURE.url, title: "Releases" },
    sequence: 1,
    capturedAt: "2026-09-08T00:00:00.000Z",
    elapsedMs: 60,
    bytes: 10,
    refCount: 2,
    digest: VIEW.digest,
    refs: { e28: REFS.e28, e26: REFS.e26 },
    snapshot: '- searchbox "Find a release" [ref=e28]\n- link "Releases" [ref=e26]',
    roleCounts: { searchbox: 1, link: 1 },
    semanticCoverage: {
      anchors: { dom: 1, tree: 1 },
      buttons: { dom: 3, tree: 0 },
      inputs: { dom: 2, tree: 1 },
    },
    status: "captured",
  };

  const prompt = pure.renderTesterPromptInput(artifact);
  assert.match(prompt, /Accessibility snapshot \(agent-browser, 2 refs\)/);
  assert.match(prompt, /searchbox "Find a release" \[ref=e28\]/);
  assert.match(prompt, /semanticCoverage gap\): 3 buttons, 1 inputs/);
  assert.match(prompt, /do not emit eN refs/);
  assert.ok(prompt.includes(VIEW.digest));

  const truncated = pure.renderTesterPromptInput(artifact, { maxLines: 1 });
  assert.match(truncated, /1 more line\(s\)/);

  const noGap = pure.renderTesterPromptInput({
    ...artifact,
    semanticCoverage: {
      anchors: { dom: 1, tree: 1 },
      buttons: { dom: 0, tree: 0 },
      inputs: { dom: 1, tree: 1 },
    },
  });
  assert.doesNotMatch(noGap, /semanticCoverage gap/);

  const unmeasured = pure.renderTesterPromptInput({
    ...artifact,
    semanticCoverage: undefined,
    coverageReason: "dom_probe_missing",
  });
  assert.match(unmeasured, /not measured \(dom_probe_missing\)/);

  const unavailable = pure.renderTesterPromptInput({
    schemaVersion: 1,
    kind: "a11y-snapshot",
    channel: "agent-browser-cdp",
    status: "unavailable",
    reason: "cdp_endpoint_unreachable",
  });
  assert.match(unavailable, /unavailable \(cdp_endpoint_unreachable\)/);
  assert.match(unavailable, /Assert through surf selectors/);
});

test("the mode vocabulary is closed", () => {
  assert.deepEqual([...pure.A11Y_SNAPSHOT_MODES], ["off", "optional", "required"]);
  assert.ok(pure.isA11ySnapshotMode("required"));
  assert.ok(!pure.isA11ySnapshotMode("sometimes"));
  assert.ok(!pure.isA11ySnapshotMode(undefined));
});
