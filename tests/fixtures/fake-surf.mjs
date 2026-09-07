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
 * - `frame.diagnose --json`, `page.readiness --json`
 * - every failure: exit 1, stderr `Error: <message> [code]`, stdout `{"error": {...}}` under --json
 *
 * Configuration (environment):
 * - FAKE_SURF_STATE_DIR   directory for tabs.json (required for tab/js/extract commands)
 * - FAKE_SURF_PAGES       JSON map url -> {title, readiness, evidence[], links[], counts{}}
 * - FAKE_SURF_MODE        "branch" (default) | "upstream" (v2.18.0 without the mechanisms)
 * - FAKE_SURF_DOCTOR      "ok" (default) | "socket-missing"
 * - FAKE_SURF_FAIL_ON     comma list of commands that exit 9 with "surf exploded" on stderr
 * - FAKE_SURF_EMPTY_ON    comma list of commands that exit 0 with no output
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
if (explode.includes(command)) {
  console.error("surf exploded");
  process.exit(9);
}
if (silent.includes(command)) {
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

function pageFor(url) {
  const key = Object.keys(pages).find(
    (candidate) => candidate === url || candidate.replace(/\/$/, "") === url.replace(/\/$/, ""),
  );
  const page = key ? pages[key] : {};
  return {
    url: page.url || url,
    title: page.title || "Fake page",
    readyState: page.readyState || "complete",
    readiness: page.readiness || "ready",
    evidence: page.evidence || ["document.readyState is complete"],
    links: page.links || [],
    counts: {
      anchors: (page.links || []).length,
      buttons: 1,
      forms: 0,
      inputs: 0,
      iframes: 0,
      ...(page.counts || {}),
    },
    jsResult: page.jsResult,
    jsThrows: page.jsThrows,
  };
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

function targetMeta(tab) {
  return tab.explicit ? { tabId: tab.id, windowId: 1, admission: "explicit" } : undefined;
}

// ---------------------------------------------------------------- readiness

const READINESS_CODES = {
  login: "page_login",
  challenge: "page_challenge",
  "not-found": "page_not_found",
  error: "page_error",
  loading: "page_timeout",
};

function readinessResult(page) {
  return {
    state: page.readiness,
    evidence: page.evidence,
    href: page.url,
    title: page.title,
    readyState: page.readyState,
    tabStatus: "complete",
    polls: 1,
    waited: 1,
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
  return {
    title: page.title,
    readyState: page.readyState,
    querySelectorAll(selector) {
      if (selector.startsWith("a[href]")) return anchors;
      if (selector.startsWith("button")) return repeat(page.counts.buttons);
      if (selector.startsWith("form")) return repeat(page.counts.forms);
      if (selector.startsWith("input")) return repeat(page.counts.inputs);
      if (selector.startsWith("iframe")) return repeat(page.counts.iframes);
      return [];
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

// ---------------------------------------------------------------- commands

const state = loadState();

switch (command) {
  case "tab.list": {
    const tabs = Object.entries(state.tabs).map(([id, tab], index, all) => ({
      id: Number(id),
      title: pageFor(tab.url).title,
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
    emit(readinessGate(pageFor(tab.url), tab, { wait: false }), targetMeta(tab));
    break;
  }
  case "wait.ready": {
    const tab = resolveTab(state);
    const accept = (flag("--accept") || "").split(",").filter(Boolean);
    emit(readinessGate(pageFor(tab.url), tab, { accept }), targetMeta(tab));
    break;
  }
  case "js": {
    const tab = resolveTab(state);
    const code = positionals()[0];
    if (!code) fail("usage", "js requires code");
    const value = jsonClone(
      evaluateScript(
        code,
        pageFor(tab.url),
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
    const page = pageFor(tab.url);
    const readiness = readinessGate(page, tab);
    // Like the real CLI, extract always prefixes the SURF_OPTIONS prelude, so the script runs in
    // statement mode and a bare expression yields nothing (no_output).
    const options = flag("--options") ? JSON.parse(flag("--options")) : {};
    const prelude = `const SURF_OPTIONS = Object.freeze(${JSON.stringify(options)});\n`;
    const data = jsonClone(evaluateScript(prelude + code, page, options));
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
    const payload = {
      data,
      rows,
      rowCount: Array.isArray(rows) ? rows.length : null,
      attempts: 1,
      readiness,
      mode,
      url: url ?? null,
      tabId: mode === "owned-tab" && !hasFlag("--keep-tab") ? null : tab.id,
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
    const page = pageFor(tab.url);
    emit(
      {
        mainPage: { url: page.url, title: page.title },
        counts: {
          domIframes: page.counts.iframes,
          extensionFrames: page.counts.iframes,
          cdpFrames: 1 + page.counts.iframes,
        },
        domIframes: Array.from({ length: page.counts.iframes }, (_, index) => ({
          index,
          src: `${page.url}#frame-${index}`,
        })),
        extensionFrames: [],
        cdpFrames: [{ frameId: "MAIN", isMain: true, url: page.url }],
        warnings:
          page.counts.iframes > 0
            ? [`frame 0 is out-of-process: missing from this tab's CDP frame tree`]
            : [],
      },
      targetMeta(tab),
    );
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
