#!/usr/bin/env node
/**
 * Fake `surf` executable for contract tests. It speaks the CLI/JSON shapes of the surf-cli
 * branch `feat/site-independent-mechanisms` (v2.18.0 + typed readiness, extract,
 * frame.diagnose) without a browser:
 *
 * - `--version` / `--help-full`  (mechanism probe)
 * - `doctor --browser <b> --json` (socket/manifest state)
 * - `tab.new <url>` -> "Created tab <id>: <url>", `tab.close <id>`, `tab.list --json`
 * - `wait.ready [--tab-id N] [--accept ...] --json` with typed states and `page_*` error codes
 * - `js <code> [--tab-id N] --json` evaluated in expression mode first, statement mode second,
 *   against a stub DOM for the tab's page
 * - `extract [url] [--tab-id N] --code <code> [--allow-empty] --json` with the extract contract
 *   (`{data, rows, rowCount, attempts, readiness, mode, url, tabId}`, `empty_result`,
 *   `no_output`, `rows_key_missing`)
 * - `type <text> --selector <sel>` / `click --selector <sel>` (minimal target-mutating verbs)
 * - `frame.diagnose --json`, `page.readiness --json`
 * - every failure: exit 1, stderr `Error: <message> [code]`, stdout `{"error": {...}}` under --json
 *
 * Page model (slice S6 schema bump; the fake never learns a verb from prose, review A17):
 *
 *   {
 *     title, readyState, readiness, evidence[], links[], counts{}, jsResult, jsThrows,
 *     frames: [{ src, outOfProcess?, reachable? }],  // frame.diagnose topology (S8 reads it)
 *     fields: { "<selector>": { value, kind?, checked? } },  // state a step may write and read
 *     controls: [{ selector, kind?, enabled? }],             // what a click may target
 *     forbidden: ["click", ...],   // verbs this page refuses, so a test can prove none ran
 *     changeNavigatesTo: "<url>",  // where a type/click sends the tab (post-condition, drift)
 *     navigatesAfterGate: "<url>", // the page moves once wait.ready settled: a probe answering
 *                                  // from somewhere the gate never saw
 *     extractAttempts: <n>         // what extract claims in `attempts` (the caller asked for 1)
 *   }
 *
 * Configuration (environment):
 * - FAKE_SURF_STATE_DIR   directory for tabs.json (required for tab/js/extract commands)
 * - FAKE_SURF_PAGES       JSON map url -> the page model above
 * - FAKE_SURF_MODE        "branch" (default) | "upstream" (v2.18.0 without the mechanisms)
 * - FAKE_SURF_DOCTOR      "ok" (default) | "socket-missing"
 * - FAKE_SURF_FAIL_ON     comma list of commands that exit 9 with "surf exploded" on stderr
 * - FAKE_SURF_EMPTY_ON    comma list of commands that exit 0 with no output
 * - FAKE_SURF_HANG_ON     comma list of commands that never answer, so the caller's own budget
 *                         kills them: exit code null plus a signal, which is the `unknown` shape
 * - FAKE_SURF_SIGNAL_ON   comma list of commands that die on SIGTERM before answering: no exit
 *                         code, a signal, and nothing said about the target
 * - FAKE_SURF_ZERO_ROWS_ON       comma list of commands whose extract payload has zero rows
 * - FAKE_SURF_BOOKKEEPING_ONLY_ON comma list of commands that answer with bookkeeping keys only
 * - FAKE_SURF_LOG         file that receives one JSON line per invocation (argv)
 * - FAKE_SURF_ECHO        "1": echo argv (one per line) for every command except version/help/doctor
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const argv = process.argv.slice(2);
const mode = process.env.FAKE_SURF_MODE || "branch";
const wantJson = argv.includes("--json");

if (process.env.FAKE_SURF_LOG) {
  appendFileSync(process.env.FAKE_SURF_LOG, `${JSON.stringify(argv)}\n`);
}

function flag(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function hasFlag(name) {
  return argv.includes(name);
}

function positionals() {
  const out = [];
  const valueFlags = new Set([
    "--tab-id",
    "--code",
    "--file",
    "--options",
    "--accept",
    "--timeout",
    "--interval",
    "--selector",
    "--text",
    "--url-prefix",
    "--empty-text",
    "--ready-selector",
    "--ready-text",
    "--ready-url-prefix",
    "--ready-timeout",
    "--rows",
    "--retry",
    "--retry-delay-ms",
    "--browser",
    "--session",
    "--options-file",
    "--socket",
    "--target",
    "--connect-timeout",
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      if (valueFlags.has(arg)) index += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}

function fail(code, message, details) {
  console.error(`Error: ${message} [${code}]`);
  if (wantJson) {
    console.log(
      JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }, null, 2),
    );
  }
  process.exit(1);
}

function emit(data, target) {
  if (wantJson) {
    console.log(JSON.stringify(target ? { result: data, target, notice: null } : data, null, 2));
  } else if (typeof data === "string") {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

const command = argv[0];
const explode = (process.env.FAKE_SURF_FAIL_ON || "").split(",").filter(Boolean);
const silent = (process.env.FAKE_SURF_EMPTY_ON || "").split(",").filter(Boolean);
const hang = (process.env.FAKE_SURF_HANG_ON || "").split(",").filter(Boolean);
const signalled = (process.env.FAKE_SURF_SIGNAL_ON || "").split(",").filter(Boolean);
const zeroRows = (process.env.FAKE_SURF_ZERO_ROWS_ON || "").split(",").filter(Boolean);
const bookkeepingOnly = (process.env.FAKE_SURF_BOOKKEEPING_ONLY_ON || "")
  .split(",")
  .filter(Boolean);
if (explode.includes(command)) {
  console.error("surf exploded");
  process.exit(9);
}
if (silent.includes(command)) {
  process.exit(0);
}
// Never answer: the caller's own budget must kill this process, which is the only way a real
// step ends without an exit code - the shape a mutating step settles as `unknown`.
if (hang.includes(command)) {
  // The timer holds the event loop open; without it Node would exit 13 on the unsettled await.
  setInterval(() => undefined, 1_000);
  await new Promise(() => undefined);
}
// Die on a signal before answering: exit code null plus a signal, and the caller's budget was
// never the reason. A mutating step that ends here knows nothing about the target.
if (signalled.includes(command)) {
  process.kill(process.pid, "SIGTERM");
  await new Promise(() => undefined);
}
// Exit 0 with nothing but the transport's own bookkeeping keys: the HOSTERR shape.
if (bookkeepingOnly.includes(command)) {
  console.log(
    JSON.stringify({ id: 1, _resolvedWindowId: 2, _resolvedTabId: 3, _hint: "cached" }, null, 2),
  );
  process.exit(0);
}

// Echo mode: print the argv one entry per line and exit 0, for argv-mapping assertions.
if (
  process.env.FAKE_SURF_ECHO &&
  !["--version", "-v", "--help", "--help-full", "doctor"].includes(command)
) {
  console.log(argv.join("\n"));
  process.exit(0);
}

const BRANCH_COMMANDS = ["page.readiness", "wait.ready", "extract", "frame.diagnose"];
if (mode === "upstream" && BRANCH_COMMANDS.includes(command)) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (command === "--version" || command === "-v") {
  console.log("surf version 2.18.0");
  process.exit(0);
}

if (command === "--help-full" || command === "--help") {
  const lines = [
    "surf v2.18.0 - Browser automation CLI",
    "",
    "TAB - Tab management",
    "  tab.list                      List all open tabs",
    "  tab.new <url>                 Open new tab",
    "  tab.close <id>                Close tab by ID or name",
    "",
    "PAGE - Page inspection",
    "  page.read                     Get accessibility tree + visible text",
    "  page.state                    Get page state (modals, loading, etc.)",
  ];
  if (mode !== "upstream") {
    lines.push(
      "  page.readiness                Classify the page once: ready, empty, loading, login, challenge, not-found, error",
    );
  }
  lines.push(
    "",
    "WAIT - Waiting",
    "  wait <duration>               Wait N seconds",
    "  wait.element <selector>       Wait for element to appear",
  );
  if (mode !== "upstream") {
    lines.push(
      "  wait.ready                    Wait until the page is ready, or fail fast with a typed state (challenge, login, not-found, error)",
    );
    lines.push(
      "",
      "EXTRACT - Read-only extraction in an owned tab",
      "  extract <url>                 Open a URL in a fresh tab, wait until it is ready, run a page-side script that returns JSON, print rows",
    );
  }
  lines.push(
    "",
    "JS - JavaScript execution",
    "  js <code>                     Execute JavaScript (use 'return' for values)",
  );
  lines.push(
    "",
    "HEALTH - Health checks",
    "  doctor                        Diagnose native host manifests and socket connectivity",
  );
  lines.push(
    "",
    "FRAME - Iframe handling",
    "  frame.list                    List all frames in page",
  );
  if (mode !== "upstream") {
    lines.push(
      "  frame.diagnose                Explain frame mismatches: DOM iframes, extension frames with content-script reachability, CDP frame tree",
    );
  }
  lines.push(
    "",
    "Options:",
    "  --tab-id <id>     Target specific tab",
    "  --json            Output raw JSON including target metadata",
  );
  console.log(lines.join("\n"));
  process.exit(0);
}

if (command === "doctor") {
  const browser = flag("--browser") || "chrome";
  const socketMissing = (process.env.FAKE_SURF_DOCTOR || "ok") === "socket-missing";
  const manifestPath = `/fake/.config/${browser}/NativeMessagingHosts/surf.browser.host.json`;
  const checks = [
    socketMissing
      ? {
          id: "socket-file",
          status: "fail",
          message: "Socket path does not exist: /tmp/surf.sock",
          path: "/tmp/surf.sock",
        }
      : {
          id: "socket-file",
          status: "pass",
          message: "Socket path exists: /tmp/surf.sock",
          path: "/tmp/surf.sock",
        },
    socketMissing
      ? {
          id: "socket-connect",
          status: "fail",
          message: "Could not connect to socket: connect ENOENT /tmp/surf.sock",
          code: "ENOENT",
        }
      : { id: "socket-connect", status: "pass", message: "Connected to socket: /tmp/surf.sock" },
    {
      id: "manifest-file",
      status: "pass",
      message: `Manifest found: ${manifestPath}`,
      path: manifestPath,
      browser,
    },
  ];
  const failCount = checks.filter((check) => check.status === "fail").length;
  const payload = {
    ok: failCount === 0,
    summary: { pass: checks.length - failCount, warn: 0, fail: failCount },
    environment: {
      platform: "linux",
      socketPath: "/tmp/surf.sock",
      surfSocketSet: false,
      browsers: [browser],
    },
    manifests: [
      { browser, name: browser, path: manifestPath, supported: true, checks: checks.slice(2) },
    ],
    checks,
    recommendations:
      failCount > 0
        ? [
            "Make sure the browser is running with the Surf extension enabled, then restart the browser after install changes.",
          ]
        : [],
  };
  if (wantJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `Surf doctor\n\nSocket: /tmp/surf.sock\n${checks.map((check) => `[${check.status.toUpperCase()}] ${check.message}`).join("\n")}\n\nDoctor result: ${failCount === 0 ? "ok" : "issues found"}`,
    );
  }
  process.exit(failCount === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- state

const stateDir = process.env.FAKE_SURF_STATE_DIR;
if (!stateDir) {
  fail("usage", `fake surf needs FAKE_SURF_STATE_DIR for '${command}'`);
}
mkdirSync(stateDir, { recursive: true });
const stateFile = path.join(stateDir, "tabs.json");

function loadState() {
  if (!existsSync(stateFile)) {
    return { nextId: 100, tabs: {} };
  }
  return JSON.parse(readFileSync(stateFile, "utf8"));
}

function saveState(state) {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

const pages = process.env.FAKE_SURF_PAGES ? JSON.parse(process.env.FAKE_SURF_PAGES) : {};

function pageFor(url, state) {
  const key = Object.keys(pages).find(
    (candidate) => candidate === url || candidate.replace(/\/$/, "") === url.replace(/\/$/, ""),
  );
  const page = key ? pages[key] : {};
  const frames = page.frames || [];
  const fields = { ...(page.fields || {}), ...(state?.fields?.[page.url || url] || {}) };
  const controls = page.controls || [];
  return {
    url: page.url || url,
    title: page.title || "Fake page",
    readyState: page.readyState || "complete",
    readiness: page.readiness || "ready",
    evidence: page.evidence || ["document.readyState is complete"],
    links: page.links || [],
    frames,
    fields,
    controls,
    forbidden: page.forbidden || [],
    changeNavigatesTo: page.changeNavigatesTo,
    navigatesAfterGate: page.navigatesAfterGate,
    extractAttempts: page.extractAttempts ?? 1,
    counts: {
      anchors: (page.links || []).length,
      buttons: controls.length > 0 ? controls.length : 1,
      forms: 0,
      inputs: Object.keys(fields).length,
      iframes: frames.length,
      ...(page.counts || {}),
    },
    jsResult: page.jsResult,
    jsThrows: page.jsThrows,
  };
}

/** Field values a `type` wrote in this state file; the page model holds the initial values. */
function writeFieldValue(state, url, selector, value) {
  state.fields = state.fields || {};
  state.fields[url] = state.fields[url] || {};
  const current = state.fields[url][selector] || {};
  state.fields[url][selector] = { ...current, value };
}

function resolveTab(state) {
  const tabId = flag("--tab-id");
  if (tabId !== undefined) {
    const tab = state.tabs[tabId];
    if (!tab) {
      fail("no_tab", `No tab with id ${tabId}`);
    }
    return { id: Number(tabId), ...tab, explicit: true };
  }
  const ids = Object.keys(state.tabs);
  if (ids.length === 0) {
    fail("no_tab", "No active tab; open one with tab.new");
  }
  const lastId = ids[ids.length - 1];
  return { id: Number(lastId), ...state.tabs[lastId], explicit: false };
}

// Shape from the captures' `target` block (explicit-tab admission).
function targetMeta(tab) {
  return tab.explicit
    ? {
        source: "explicit-tab",
        tabId: tab.id,
        windowId: 1,
        browserEpoch: "00000000-0000-4000-8000-000000000000",
        queuedMs: 0,
      }
    : undefined;
}

// ---------------------------------------------------------------- readiness

const READINESS_CODES = {
  login: "page_login",
  challenge: "page_challenge",
  "not-found": "page_not_found",
  error: "page_error",
  loading: "page_timeout",
};

// Shape from tests/fixtures/captures/surf/wait-ready-ready.json (surf 2.18.0, live capture).
function readinessResult(page) {
  return {
    accepted: false,
    state: page.readiness,
    evidence: page.evidence,
    href: page.url,
    title: page.title,
    readyState: page.readyState,
    tabStatus: "complete",
    polls: 1,
    waited: 1,
    timeout: 20000,
    interval: 400,
  };
}

function readinessGate(page, tab, { accept = [], wait = true } = {}) {
  const result = readinessResult(page);
  if (!wait) {
    return result;
  }
  if (["ready", "empty"].includes(page.readiness)) {
    return result;
  }
  if (accept.includes(page.readiness)) {
    return { ...result, accepted: true };
  }
  const code = READINESS_CODES[page.readiness] || "page_error";
  const message =
    page.readiness === "loading"
      ? `Timed out after 1ms waiting for a ready page; last state loading at ${page.url}`
      : `Page is not ready: ${page.readiness} at ${page.url}`;
  fail(code, message, {
    state: page.readiness,
    evidence: page.evidence,
    href: page.url,
    title: page.title,
  });
  return undefined;
}

// ---------------------------------------------------------------- js evaluation against a stub DOM

function stubDocument(page) {
  const anchors = page.links.map((href) => ({
    getAttribute: (name) => (name === "href" ? href : null),
    href,
  }));
  const repeat = (count) => Array.from({ length: count }, () => ({}));
  // A field a script may read back: `value`/`checked` are the state a `type` wrote.
  const fieldNode = (selector, field) => ({
    tagName: (field.kind || "text") === "select" ? "SELECT" : "INPUT",
    type: field.kind || "text",
    value: field.value ?? "",
    checked: field.checked ?? false,
    getAttribute: (name) => (name === "value" ? (field.value ?? "") : null),
    selector,
  });
  const fieldNodes = Object.entries(page.fields).map(([selector, field]) =>
    fieldNode(selector, field),
  );
  const controlNodes = page.controls.map((control) => ({
    tagName: "BUTTON",
    type: control.kind || "submit",
    disabled: control.enabled === false,
    selector: control.selector,
  }));
  return {
    title: page.title,
    readyState: page.readyState,
    querySelector(selector) {
      return (
        fieldNodes.find((node) => node.selector === selector) ??
        controlNodes.find((node) => node.selector === selector) ??
        null
      );
    },
    querySelectorAll(selector) {
      if (selector.startsWith("a[href]")) return anchors;
      if (selector.startsWith("button")) {
        return controlNodes.length > 0 ? controlNodes : repeat(page.counts.buttons);
      }
      if (selector.startsWith("form")) return repeat(page.counts.forms);
      if (selector.startsWith("input")) {
        return fieldNodes.length > 0 ? fieldNodes : repeat(page.counts.inputs);
      }
      if (selector.startsWith("iframe")) return repeat(page.counts.iframes);
      const single = this.querySelector(selector);
      return single ? [single] : [];
    },
  };
}

function evaluateScript(code, page, options) {
  if (page.jsThrows) {
    fail("browser_error", page.jsThrows);
  }
  if (page.jsResult !== undefined) {
    return page.jsResult;
  }
  const sandbox = {
    document: stubDocument(page),
    location: { href: page.url, origin: new URL(page.url).origin },
    URL,
    Set,
    Array,
    SURF_OPTIONS: Object.freeze(options || {}),
    console,
  };
  const context = vm.createContext(sandbox);
  // Expression mode first (`return (<code>)`), statement mode second: the same order as the CLI.
  try {
    return vm.runInContext(`(() => { 'use strict'; return (\n${code}\n); })()`, context);
  } catch (error) {
    // vm contexts have their own SyntaxError class; compare by name.
    if (!(error instanceof SyntaxError) && error?.name !== "SyntaxError") {
      fail("browser_error", String(error?.message ? error.message : error));
    }
  }
  try {
    return vm.runInContext(`(() => { 'use strict'; ${code} })()`, context);
  } catch (error) {
    fail("browser_error", String(error?.message ? error.message : error));
  }
  return undefined;
}

function jsonClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * A page may declare verbs it refuses. A framework that is supposed never to issue one gets a
 * loud failure instead of a silent success, so "nothing clicked" is proved by the fixture and
 * not only by reading the call log.
 */
function assertNotForbidden(page) {
  if (page.forbidden.includes(command)) {
    fail("forbidden_command", `${command} is not permitted on ${page.url} by this fixture`);
  }
}

/** Where a `type` or `click` sends the tab, when the page model says it navigates. */
function applyNavigation(page, tab) {
  if (!page.changeNavigatesTo) {
    return page.url;
  }
  state.tabs[tab.id] = { url: page.changeNavigatesTo };
  saveState(state);
  return page.changeNavigatesTo;
}

// ---------------------------------------------------------------- commands

const state = loadState();

switch (command) {
  case "tab.list": {
    const tabs = Object.entries(state.tabs).map(([id, tab], index, all) => ({
      id: Number(id),
      title: pageFor(tab.url, state).title,
      url: tab.url,
      active: index === all.length - 1,
      windowId: 1,
    }));
    emit(wantJson ? tabs : JSON.stringify(tabs, null, 2));
    break;
  }
  case "tab.new": {
    const url = positionals()[0];
    if (!url) fail("usage", "tab.new requires a URL");
    const id = state.nextId;
    state.nextId += 1;
    state.tabs[id] = { url };
    saveState(state);
    // The real CLI prints this text even under --json.
    emit(`Created tab ${id}: ${url}`);
    break;
  }
  case "tab.close": {
    const id = positionals()[0];
    if (!id || !state.tabs[id]) fail("no_tab", `No tab with id ${id}`);
    delete state.tabs[id];
    saveState(state);
    emit(`Closed tab ${id}`);
    break;
  }
  case "navigate":
  case "go": {
    const url = positionals()[0];
    const tab = resolveTab(state);
    state.tabs[tab.id] = { url };
    saveState(state);
    emit({ success: true, url }, targetMeta(tab));
    break;
  }
  case "page.readiness": {
    const tab = resolveTab(state);
    emit(readinessGate(pageFor(tab.url, state), tab, { wait: false }), targetMeta(tab));
    break;
  }
  case "wait.ready": {
    const tab = resolveTab(state);
    const page = pageFor(tab.url, state);
    const accept = (flag("--accept") || "").split(",").filter(Boolean);
    emit(readinessGate(page, tab, { accept }), targetMeta(tab));
    // The page moves once the gate settled: whatever reads it next answers from somewhere the
    // gate never saw, which is the only signal a read-only step has that the target moved.
    if (page.navigatesAfterGate) {
      state.tabs[tab.id] = { url: page.navigatesAfterGate };
      saveState(state);
    }
    break;
  }
  case "type": {
    const tab = resolveTab(state);
    const page = pageFor(tab.url, state);
    assertNotForbidden(page);
    const text = positionals()[0];
    const selector = flag("--selector");
    if (text === undefined) fail("usage", "type requires text");
    if (!selector) fail("usage", "type requires --selector in this fixture");
    if (!page.fields[selector]) fail("no_element", `No element matches ${selector}`);
    writeFieldValue(state, page.url, selector, text);
    saveState(state);
    const url = hasFlag("--submit") ? applyNavigation(page, tab) : page.url;
    emit({ success: true, selector, value: text, url }, targetMeta(tab));
    break;
  }
  case "click": {
    const tab = resolveTab(state);
    const page = pageFor(tab.url, state);
    assertNotForbidden(page);
    const selector = flag("--selector") ?? positionals()[0];
    if (!selector) fail("usage", "click requires a ref or --selector");
    const control = page.controls.find((entry) => entry.selector === selector);
    if (!control) fail("no_element", `No element matches ${selector}`);
    if (control.enabled === false) fail("element_disabled", `${selector} is disabled`);
    emit({ success: true, selector, url: applyNavigation(page, tab) }, targetMeta(tab));
    break;
  }
  case "js": {
    const tab = resolveTab(state);
    const code = positionals()[0];
    if (!code) fail("usage", "js requires code");
    assertNotForbidden(pageFor(tab.url, state));
    const value = jsonClone(
      evaluateScript(
        code,
        pageFor(tab.url, state),
        flag("--options") ? JSON.parse(flag("--options")) : undefined,
      ),
    );
    emit(value === undefined ? "undefined" : value, targetMeta(tab));
    break;
  }
  case "extract": {
    const url = positionals()[0];
    const code = flag("--code");
    if (!code) fail("usage", "extract requires --code or --file");
    let tab;
    let mode = "owned-tab";
    if (flag("--tab-id") !== undefined) {
      tab = resolveTab(state);
      mode = "target";
      if (url) {
        state.tabs[tab.id] = { url };
        saveState(state);
        tab = { ...tab, url };
      }
    } else {
      if (!url)
        fail(
          "usage",
          "a URL is required unless --tab-id, --window-id or --session names the page to read",
        );
      const id = state.nextId;
      state.nextId += 1;
      state.tabs[id] = { url };
      saveState(state);
      tab = { id, url, explicit: false };
    }
    const page = pageFor(tab.url, state);
    assertNotForbidden(page);
    const readiness = readinessGate(page, tab);
    const forceZeroRows = zeroRows.includes(command);
    // Like the real CLI, extract always prefixes the SURF_OPTIONS prelude, so the script runs in
    // statement mode and a bare expression yields nothing (no_output).
    const options = flag("--options") ? JSON.parse(flag("--options")) : {};
    const prelude = `const SURF_OPTIONS = Object.freeze(${JSON.stringify(options)});\n`;
    const data = forceZeroRows
      ? { rows: [], rowCount: 0, mode }
      : jsonClone(evaluateScript(prelude + code, page, options));
    if (data === undefined) {
      fail(
        "no_output",
        "The extraction script returned nothing. End it with return { rows: [...] } or return [...].",
      );
    }
    const rowsKey = flag("--rows");
    let rows = null;
    if (Array.isArray(data)) rows = data;
    else if (rowsKey) {
      if (!Array.isArray(data?.[rowsKey]))
        fail("rows_key_missing", `The script result has no array at "${rowsKey}"`);
      rows = data[rowsKey];
    } else if (data && typeof data === "object") {
      rows = ["rows", "items", "results"].map((key) => data[key]).find(Array.isArray) ?? null;
    }
    if (
      Array.isArray(rows) &&
      rows.length === 0 &&
      !hasFlag("--allow-empty") &&
      readiness.state !== "empty"
    ) {
      if (mode === "owned-tab") delete state.tabs[tab.id];
      saveState(state);
      fail(
        "empty_result",
        `The extraction script returned zero rows for ${tab.url}; pass --allow-empty or --empty-text to accept an empty result`,
        { attempts: 1 },
      );
    }
    if (mode === "owned-tab" && !hasFlag("--keep-tab")) {
      delete state.tabs[tab.id];
      saveState(state);
    }
    // Key order and shape from tests/fixtures/captures/surf/extract-{rows,owned-tab}.json:
    // owned-tab replies carry `tabId` (null once the tab is closed), target replies do not.
    const payload = {
      data,
      rows,
      readiness,
      rowCount: Array.isArray(rows) ? rows.length : null,
      attempts: page.extractAttempts,
      mode,
      url: url ?? null,
      ...(mode === "owned-tab" ? { tabId: hasFlag("--keep-tab") ? tab.id : null } : {}),
    };
    if (wantJson) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(
        `# Extraction from ${tab.url}\n\n${Array.isArray(rows) ? `${rows.length} rows` : JSON.stringify(data)}`,
      );
    }
    break;
  }
  case "frame.diagnose": {
    const tab = resolveTab(state);
    const page = pageFor(tab.url, state);
    // The topology comes from the page model's `frames`, so a fixture can describe an
    // out-of-process or unreachable frame instead of the fake inventing one from a count.
    const frames =
      page.frames.length > 0
        ? page.frames
        : Array.from({ length: page.counts.iframes }, (_, index) => ({
            src: `${page.url}#frame-${index}`,
          }));
    const inProcess = frames.filter((frame) => frame.outOfProcess !== true);
    emit(
      {
        mainPage: { url: page.url, title: page.title },
        counts: {
          domIframes: frames.length,
          extensionFrames: frames.filter((frame) => frame.reachable !== false).length,
          cdpFrames: 1 + inProcess.length,
        },
        domIframes: frames.map((frame, index) => ({
          index,
          src: frame.src ?? `${page.url}#frame-${index}`,
        })),
        extensionFrames: frames
          .map((frame, index) => ({ index, src: frame.src, reachable: frame.reachable !== false }))
          .filter((frame) => frame.reachable),
        cdpFrames: [
          { frameId: "MAIN", isMain: true, url: page.url },
          ...inProcess.map((frame, index) => ({
            frameId: `FRAME_${index}`,
            isMain: false,
            url: frame.src ?? page.url,
          })),
        ],
        warnings: frames
          .map((frame, index) =>
            frame.outOfProcess === true
              ? `frame ${index} is out-of-process: missing from this tab's CDP frame tree`
              : undefined,
          )
          .filter(Boolean),
      },
      targetMeta(tab),
    );
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
