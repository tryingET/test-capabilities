import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createFakeSurf } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The fake surf must speak the shapes the real CLI speaks. The corpus under
 * `tests/fixtures/captures/surf/` was captured live against Chromium (Agent) with surf 2.18.0
 * (owned tabs, no logins); this test replays each capture's command against the fake and
 * compares the *shape* of the reply - key sets, types, exit code and the `Error: <message>
 * [code]` stderr contract - so the fake can never learn a verb from prose (review A17).
 */

const capturesDir = new URL("./fixtures/captures/surf/", import.meta.url).pathname;

function loadCapture(name) {
  return JSON.parse(readFileSync(path.join(capturesDir, `${name}.json`), "utf8"));
}

/** A structural fingerprint: key sets and leaf types, never the captured values. */
function shapeOf(value) {
  if (Array.isArray(value)) {
    return value.length === 0 ? "array<empty>" : `array<${shapeOf(value[0])}>`;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, shapeOf(value[key])]),
    );
  }
  return typeof value;
}

function runFake(fake, args) {
  const result = spawnSync(fake.path, args, { encoding: "utf8" });
  let stdout;
  try {
    stdout = JSON.parse(result.stdout);
  } catch {
    stdout = result.stdout;
  }
  return { status: result.status, stdout, stderr: result.stderr, rawStdout: result.stdout };
}

const LINKS_SCRIPT =
  'return (() => { const rows = Array.from(document.querySelectorAll("a[href]")).map((a) => new URL(a.getAttribute("href"), location.href).href).filter((h) => new URL(h).origin === location.origin).map((href) => ({ href })); return { __testCapabilitiesSurfExploreProbe: "fidelity", href: location.href, title: document.title, readyState: document.readyState, kind: "links", rows }; })();';

function pagesWithLinks(links) {
  return {
    "https://example.com/": {
      title: "Example Domain",
      readiness: "ready",
      links,
    },
    "https://github.com/login": {
      title: "Sign in to GitHub",
      readiness: "login",
      evidence: ["1 visible password field(s)", "URL path /login looks like a login route"],
      links: [],
    },
  };
}

function openTab(fake, url) {
  const created = runFake(fake, ["tab.new", url]);
  const match = /^Created tab (\d+):/.exec(created.rawStdout);
  assert.ok(match, `tab.new did not answer with the captured text reply: ${created.rawStdout}`);
  return match[1];
}

test("the capture corpus is well formed and records its provenance", () => {
  const files = readdirSync(capturesDir).filter((entry) => entry.endsWith(".json"));
  assert.equal(files.length >= 6, true, "the corpus lost captures");

  for (const file of files) {
    const capture = JSON.parse(readFileSync(path.join(capturesDir, file), "utf8"));
    assert.equal(capture.capture_version, 1, file);
    assert.equal(capture.tool.name, "surf", file);
    assert.match(capture.tool.version, /^\d+\.\d+\.\d+$/, file);
    assert.match(capture.tool.browser, /Chromium \(Agent\)/, file);
    assert.equal(Array.isArray(capture.command), true, file);
    assert.equal(typeof capture.exitCode, "number", file);
    assert.equal(["json", "text"].includes(capture.stdoutKind), true, file);
    assert.equal(typeof capture.stderr, "string", file);
  }
});

test("fake wait.ready answers the captured ready shape on an explicit tab", () => {
  const capture = loadCapture("wait-ready-ready");
  const fake = createFakeSurf({ pages: pagesWithLinks([]) });

  try {
    const tab = openTab(fake, "https://example.com/");
    const reply = runFake(fake, ["wait.ready", "--tab-id", tab, "--json"]);

    assert.equal(reply.status, capture.exitCode);
    assert.deepEqual(shapeOf(reply.stdout), shapeOf(capture.stdout));
    assert.equal(reply.stdout.result.state, capture.stdout.result.state);
    assert.equal(reply.stdout.notice, null);
    assert.equal(reply.stdout.target.source, capture.stdout.target.source);
  } finally {
    fake.cleanup();
  }
});

test("fake wait.ready refuses a login page with the captured error envelope and [code] line", () => {
  const capture = loadCapture("wait-ready-login");
  const fake = createFakeSurf({ pages: pagesWithLinks([]) });

  try {
    const tab = openTab(fake, "https://github.com/login");
    const reply = runFake(fake, ["wait.ready", "--tab-id", tab, "--json"]);

    assert.equal(reply.status, capture.exitCode);
    assert.equal(reply.status, 1);
    assert.equal(reply.stdout.error.code, capture.stdout.error.code);
    assert.equal(typeof reply.stdout.error.message, "string");
    assert.match(reply.stderr, /^Error: .*\[page_login\]$/m);
    assert.match(capture.stderr, /^Error: .*\[page_login\]$/m);
  } finally {
    fake.cleanup();
  }
});

test("fake extract answers the captured target-mode shape with rows", () => {
  const capture = loadCapture("extract-rows");
  const fake = createFakeSurf({
    pages: pagesWithLinks(["https://example.com/a", "https://example.com/b"]),
  });

  try {
    const tab = openTab(fake, "https://example.com/");
    const reply = runFake(fake, [
      "extract",
      "--tab-id",
      tab,
      "--code",
      LINKS_SCRIPT,
      "--allow-empty",
      "--json",
    ]);

    assert.equal(reply.status, capture.exitCode);
    assert.deepEqual(Object.keys(reply.stdout).sort(), Object.keys(capture.stdout).sort());
    assert.deepEqual(shapeOf(reply.stdout.readiness), shapeOf(capture.stdout.readiness));
    assert.deepEqual(shapeOf(reply.stdout.rows), shapeOf(capture.stdout.rows));
    assert.equal(reply.stdout.mode, capture.stdout.mode);
    assert.equal(reply.stdout.url, capture.stdout.url);
    assert.equal(reply.stdout.rowCount, reply.stdout.rows.length);
    assert.equal(reply.stdout.attempts, capture.stdout.attempts);
  } finally {
    fake.cleanup();
  }
});

test("fake extract answers the captured owned-tab shape, which carries tabId", () => {
  const capture = loadCapture("extract-owned-tab");
  const fake = createFakeSurf({
    pages: pagesWithLinks(["https://example.com/a"]),
  });

  try {
    const reply = runFake(fake, [
      "extract",
      "https://example.com/",
      "--code",
      LINKS_SCRIPT,
      "--allow-empty",
      "--json",
    ]);

    assert.equal(reply.status, capture.exitCode);
    assert.deepEqual(Object.keys(reply.stdout).sort(), Object.keys(capture.stdout).sort());
    assert.equal(reply.stdout.mode, "owned-tab");
    assert.equal(reply.stdout.tabId, capture.stdout.tabId);
    assert.equal(reply.stdout.url, "https://example.com/");
  } finally {
    fake.cleanup();
  }
});

test("fake extract accepts zero rows with --allow-empty, exactly like the capture", () => {
  const capture = loadCapture("extract-empty");
  const fake = createFakeSurf({ pages: pagesWithLinks([]) });

  try {
    const tab = openTab(fake, "https://example.com/");
    const reply = runFake(fake, [
      "extract",
      "--tab-id",
      tab,
      "--code",
      LINKS_SCRIPT,
      "--allow-empty",
      "--json",
    ]);

    assert.equal(reply.status, capture.exitCode);
    assert.equal(reply.status, 0);
    assert.deepEqual(reply.stdout.rows, []);
    assert.equal(reply.stdout.rowCount, 0);
    assert.deepEqual(capture.stdout.rows, []);
    assert.equal(capture.stdout.rowCount, 0);
  } finally {
    fake.cleanup();
  }
});

test("fake extract refuses zero rows without --allow-empty with the captured empty_result envelope", () => {
  const capture = loadCapture("extract-empty-refused");
  const fake = createFakeSurf({ pages: pagesWithLinks([]) });

  try {
    const tab = openTab(fake, "https://example.com/");
    const reply = runFake(fake, ["extract", "--tab-id", tab, "--code", LINKS_SCRIPT, "--json"]);

    assert.equal(reply.status, capture.exitCode);
    assert.equal(reply.status, 1);
    assert.equal(reply.stdout.error.code, "empty_result");
    assert.equal(capture.stdout.error.code, "empty_result");
    assert.match(reply.stdout.error.message, /--allow-empty/);
    assert.match(capture.stdout.error.message, /--allow-empty/);
    assert.equal(typeof reply.stdout.error.details, "object");
  } finally {
    fake.cleanup();
  }
});

test("fake tab.new and tab.close answer the captured text replies", () => {
  const newCapture = loadCapture("tab-new");
  const closeCapture = loadCapture("tab-close");
  const fake = createFakeSurf({ pages: pagesWithLinks([]) });

  try {
    const created = runFake(fake, ["tab.new", "https://example.com/"]);
    assert.equal(created.status, newCapture.exitCode);
    assert.match(created.rawStdout, /^Created tab \d+: https:\/\/example\.com\/\n$/);
    assert.match(newCapture.stdout, /^Created tab \d+: https:\/\/example\.com\/\n$/);

    const tab = /^Created tab (\d+):/.exec(created.rawStdout)[1];
    const closed = runFake(fake, ["tab.close", tab]);
    assert.equal(closed.status, closeCapture.exitCode);
    assert.match(closed.rawStdout, /^Closed tab \d+\n$/);
    assert.match(closeCapture.stdout, /^Closed tab \d+\n$/);
  } finally {
    fake.cleanup();
  }
});

test("the zero-rows and bookkeeping-only knobs produce the two payloads the classifier needs", () => {
  const zeroRows = createFakeSurf({
    pages: pagesWithLinks(["https://example.com/a"]),
    zeroRowsOn: ["extract"],
  });
  try {
    const tab = openTab(zeroRows, "https://example.com/");
    const reply = runFake(zeroRows, [
      "extract",
      "--tab-id",
      tab,
      "--code",
      LINKS_SCRIPT,
      "--allow-empty",
      "--json",
    ]);
    assert.equal(reply.status, 0);
    assert.deepEqual(reply.stdout.rows, []);
    assert.equal(reply.stdout.rowCount, 0);
  } finally {
    zeroRows.cleanup();
  }

  const bookkeeping = createFakeSurf({
    pages: pagesWithLinks([]),
    bookkeepingOnlyOn: ["wait.ready"],
  });
  try {
    const reply = runFake(bookkeeping, ["wait.ready", "--json"]);
    assert.equal(reply.status, 0);
    assert.deepEqual(Object.keys(reply.stdout).sort(), [
      "_hint",
      "_resolvedTabId",
      "_resolvedWindowId",
      "id",
    ]);
  } finally {
    bookkeeping.cleanup();
  }
});

test("the classifier reads the captured payloads exactly as it reads the fake's", async () => {
  const { classifyResult } = await importRuntimeModule("core/result-classification.js");

  const rows = loadCapture("extract-rows");
  const withRows = classifyResult({
    source: "surf",
    exitCode: rows.exitCode,
    stdout: JSON.stringify(rows.stdout),
    stderr: rows.stderr,
  });
  assert.equal(withRows.class, "success");
  assert.equal(withRows.payload.kind, "rows");
  assert.equal(withRows.payload.rowCount, rows.stdout.rowCount);

  const empty = loadCapture("extract-empty");
  const withoutRows = classifyResult({
    source: "surf",
    exitCode: empty.exitCode,
    stdout: JSON.stringify(empty.stdout),
    stderr: empty.stderr,
  });
  assert.equal(withoutRows.class, "empty");
  assert.equal(withoutRows.basis, "no_evidence");

  const declared = classifyResult(
    {
      source: "surf",
      exitCode: empty.exitCode,
      stdout: JSON.stringify(empty.stdout),
      stderr: empty.stderr,
    },
    { output: "empty", declaredBy: "operation:surf.explore.links" },
  );
  assert.equal(declared.class, "declared_empty");
  assert.equal(declared.ok, true);

  const refused = loadCapture("extract-empty-refused");
  const refusedOutcome = classifyResult({
    source: "surf",
    exitCode: refused.exitCode,
    stdout: JSON.stringify(refused.stdout),
    stderr: refused.stderr,
  });
  assert.equal(refusedOutcome.class, "error");
  assert.equal(refusedOutcome.code, "empty_result");
  assert.equal(refusedOutcome.error.origin, "json_error_object");

  const login = loadCapture("wait-ready-login");
  const loginOutcome = classifyResult({
    source: "surf",
    exitCode: login.exitCode,
    stdout: JSON.stringify(login.stdout),
    stderr: login.stderr,
  });
  assert.equal(loginOutcome.class, "error");
  assert.equal(loginOutcome.code, "page_login");
  assert.equal(loginOutcome.basis, "fault");

  const ready = loadCapture("wait-ready-ready");
  const readyOutcome = classifyResult({
    source: "surf",
    exitCode: ready.exitCode,
    stdout: JSON.stringify(ready.stdout),
    stderr: ready.stderr,
  });
  assert.equal(readyOutcome.class, "success");
  assert.equal(readyOutcome.payload.kind, "json");
});

// ---------------------------------------------------------------------------
// Slice S6 page-model schema bump: frames, fields, controls, forbidden,
// changeNavigatesTo and the hang knob. The shapes stay the ones the captured
// commands answer with; what is new is the state a page may carry.
// ---------------------------------------------------------------------------

const FORM_PAGES = {
  "https://forms.example/": {
    title: "Form",
    readiness: "ready",
    links: [],
    fields: { "#q": { value: "", kind: "text" } },
    controls: [{ selector: "#go", kind: "submit" }],
    changeNavigatesTo: "https://forms.example/results",
  },
  "https://forms.example/results": { title: "Results", readiness: "ready", links: [] },
};

test("the page model carries fields a type writes and a script reads back", () => {
  const fake = createFakeSurf({ pages: FORM_PAGES });
  try {
    const tab = openTab(fake, "https://forms.example/");
    const before = runFake(fake, [
      "js",
      'return document.querySelector("#q").value',
      "--tab-id",
      tab,
      "--json",
    ]);
    assert.equal(before.status, 0);
    assert.equal(before.stdout.result, "");

    const typed = runFake(fake, [
      "type",
      "surf-cli",
      "--selector",
      "#q",
      "--tab-id",
      tab,
      "--json",
    ]);
    assert.equal(typed.status, 0);
    assert.equal(typed.stdout.result.value, "surf-cli");

    const after = runFake(fake, [
      "js",
      'return document.querySelector("#q").value',
      "--tab-id",
      tab,
      "--json",
    ]);
    assert.equal(after.stdout.result, "surf-cli");
  } finally {
    fake.cleanup();
  }
});

test("a control click follows changeNavigatesTo, and a missing control refuses", () => {
  const fake = createFakeSurf({ pages: FORM_PAGES });
  try {
    const tab = openTab(fake, "https://forms.example/");
    const missing = runFake(fake, ["click", "--selector", "#nope", "--tab-id", tab, "--json"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No element matches #nope \[no_element\]/);

    const clicked = runFake(fake, ["click", "--selector", "#go", "--tab-id", tab, "--json"]);
    assert.equal(clicked.status, 0);
    assert.equal(clicked.stdout.result.url, "https://forms.example/results");

    const tabs = runFake(fake, ["tab.list", "--json"]);
    assert.equal(tabs.stdout[0].url, "https://forms.example/results");
  } finally {
    fake.cleanup();
  }
});

test("a page may forbid a verb, so a test proves the framework never issued it", () => {
  const fake = createFakeSurf({
    pages: {
      "https://readonly.example/": {
        title: "Read only",
        readiness: "ready",
        links: [],
        forbidden: ["click", "type"],
        controls: [{ selector: "#go" }],
      },
    },
  });
  try {
    const tab = openTab(fake, "https://readonly.example/");
    const clicked = runFake(fake, ["click", "--selector", "#go", "--tab-id", tab, "--json"]);
    assert.equal(clicked.status, 1);
    assert.match(clicked.stderr, /click is not permitted on .* \[forbidden_command\]/);
    assert.equal(clicked.stdout.error.code, "forbidden_command");
  } finally {
    fake.cleanup();
  }
});

test("frame.diagnose answers the shape captured live, from the page model's frames", () => {
  // The specification is the live MDN capture: three out-of-process, shadow-hosted iframes plus
  // a nested about:srcdoc frame whose content script does not answer.
  const capture = JSON.parse(
    readFileSync(path.join(capturesDir, "..", "frame-diagnose", "mdn-iframe.json"), "utf8"),
  );
  const fake = createFakeSurf({
    pages: {
      "https://frames.example/": {
        title: "Frames",
        readiness: "ready",
        links: [],
        frames: [
          {
            src: "https://a1.embed.example/runner.html",
            outOfProcess: true,
            shadowHost: "interactive-example > mdn-play-runner",
            sandbox: "allow-scripts allow-same-origin",
          },
          {
            src: "https://a2.embed.example/runner.html",
            outOfProcess: true,
            shadowHost: "interactive-example > mdn-play-runner",
            sandbox: "allow-scripts allow-same-origin",
          },
          { src: "https://frames.example/b", id: "local" },
          { src: "about:srcdoc", nestedUnder: 1, reachable: false },
        ],
      },
    },
  });
  try {
    const tab = openTab(fake, "https://frames.example/");
    const reply = runFake(fake, ["frame.diagnose", "--tab-id", tab, "--json"]);
    assert.equal(reply.status, capture.exitCode);

    // key sets and leaf types, never values
    assert.deepEqual(shapeOf(reply.stdout.target), shapeOf(capture.stdout.target));
    assert.deepEqual(
      Object.keys(reply.stdout.result).sort(),
      Object.keys(capture.stdout.result).sort(),
    );
    assert.deepEqual(
      Object.keys(reply.stdout.result.domIframes[0]).sort(),
      Object.keys(capture.stdout.result.domIframes[0]).sort(),
    );
    assert.deepEqual(shapeOf(reply.stdout.result.counts), shapeOf(capture.stdout.result.counts));
    assert.deepEqual(
      shapeOf(reply.stdout.result.cdpFrames[0]),
      shapeOf(capture.stdout.result.cdpFrames[0]),
    );

    // the same structural facts the capture carries: the nested frame is not a DOM iframe, it
    // is not in the CDP tree, and its content script does not answer
    const diagnosis = reply.stdout.result;
    assert.equal(diagnosis.counts.domIframes, 3);
    assert.equal(diagnosis.counts.extensionFrames, 5);
    assert.equal(diagnosis.counts.cdpFrames, 2, "main plus the one in-process frame");
    const nested = diagnosis.extensionFrames.find((frame) => frame.url === "about:srcdoc");
    assert.equal(nested.parentFrameId !== 0, true);
    assert.equal(nested.contentScriptReachable, false);
    assert.equal(
      diagnosis.domIframes.filter((frame) => frame.crossOrigin && frame.cdpFrameIds.length === 0)
        .length,
      2,
    );
    assert.equal(
      diagnosis.warnings.some((warning) => warning.includes("is out-of-process")),
      true,
    );
  } finally {
    fake.cleanup();
  }
});

test("a hanging command never answers, so the caller's own budget decides", () => {
  const fake = createFakeSurf({ pages: pagesWithLinks([]), hangOn: ["js"] });
  try {
    const tab = openTab(fake, "https://example.com/");
    const result = spawnSync(fake.path, ["js", "1", "--tab-id", tab, "--json"], {
      encoding: "utf8",
      timeout: 400,
    });
    assert.equal(result.status, null, "a hanging command must not exit on its own");
    assert.equal(result.stdout, "");
  } finally {
    fake.cleanup();
  }
});
