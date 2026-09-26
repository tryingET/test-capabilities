import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The a11y channel's producer-independent contract (a11y-snapshot packet; slice S9): the digest,
 * the ref and role resolution, the evaluator, the payload mapping, semantic coverage and the
 * tester prompt. Moved here from the agent-browser runtime suite when surf `page.read --nodes`
 * became the producer (AK #5915); the payload cases now speak surf's shape, and the fidelity case
 * pins the committed live capture.
 */

const pure = await importRuntimeModule("core/a11y-snapshot.js");

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

test("a surf page.read --nodes payload is mapped or refused; an empty tree is a failure", () => {
  const good = pure.parseA11ySnapshotPayload({
    pageContent: 'link "More" [e1]\n\n[Viewport: 800x600]',
    nodes: [{ ref: "e1", role: "link", name: "More", depth: 0 }],
    url: "https://example.com/",
    title: "Example",
  });
  assert.equal(good.reading.origin, "https://example.com/");
  assert.deepEqual(good.reading.refs, { e1: { role: "link", name: "More" } });
  // the window size is not the page: the viewport line is never part of the digest input
  assert.equal(good.reading.snapshot, 'link "More" [e1]');

  assert.equal(pure.parseA11ySnapshotPayload(null).error, "snapshot_failed");
  assert.equal(
    pure.parseA11ySnapshotPayload({ pageContent: "x", nodes: "nope" }).error,
    "snapshot_failed",
  );
  assert.equal(pure.parseA11ySnapshotPayload({ nodes: [] }).error, "snapshot_failed");
  assert.equal(
    pure.parseA11ySnapshotPayload({ pageContent: "x", nodes: [{ ref: "e1", role: 1 }] }).error,
    "snapshot_failed",
  );
  assert.equal(
    pure.parseA11ySnapshotPayload({ pageContent: "", nodes: [], url: "https://example.com/" })
      .error,
    "empty_snapshot",
  );
  // a surf without --nodes answers text, or an object without nodes: that is unsupported, not empty
  assert.equal(
    pure.parseA11ySnapshotPayload('link "More" [e1]').error,
    "surf_page_read_unsupported",
  );
  assert.equal(
    pure.parseA11ySnapshotPayload({ pageContent: "x" }).error,
    "surf_page_read_unsupported",
  );
});

test("the committed live capture maps to the recorded digest, refs and bytes (fidelity, review A17)", () => {
  const capture = JSON.parse(
    readFileSync(
      new URL("./fixtures/captures/surf-page-read/releases.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = pure.parseA11ySnapshotPayload(capture.stdout.result);
  assert.equal(pure.snapshotDigest(parsed.reading.snapshot), capture.digest);
  assert.equal(Object.keys(parsed.reading.refs).length, capture.refCount);
  assert.equal(Buffer.byteLength(parsed.reading.snapshot, "utf8"), capture.bytes);
  const roles = pure.roleCountsFrom(parsed.reading.refs);
  assert.ok(roles.heading > 0 && roles.navigation > 0, "structure: headings and landmarks are in");
  const coverage = pure.semanticCoverageFrom(roles, capture.domCounts);
  assert.equal(coverage.semanticCoverage.anchors.dom, 233);
  assert.equal(coverage.semanticCoverage.anchors.tree, roles.link);
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
    channel: "surf-page-read",
    tool: {
      command: "surf page.read --structure --full-page --no-text --nodes",
      version: "2.20.0",
    },
    tab: {
      surfTabId: 7,
      url: "https://github.com/nicobailon/surf-cli/releases",
      title: "Releases",
    },
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
  assert.match(prompt, /Accessibility snapshot \(surf-page-read, 2 refs\)/);
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
    channel: "surf-page-read",
    status: "unavailable",
    reason: "surf_page_read_unsupported",
  });
  assert.match(unavailable, /unavailable \(surf_page_read_unsupported\)/);
  assert.match(unavailable, /Assert through surf selectors/);
});

test("the mode vocabulary is closed", () => {
  assert.deepEqual([...pure.A11Y_SNAPSHOT_MODES], ["off", "optional", "required"]);
  assert.ok(pure.isA11ySnapshotMode("required"));
  assert.ok(!pure.isA11ySnapshotMode("sometimes"));
  assert.ok(!pure.isA11ySnapshotMode(undefined));
});
