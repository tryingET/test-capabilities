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
 * - `type <text> --into|--selector <sel>`, `select <sel> <value...>`, `click --selector <sel>`
 *   (the target-mutating verbs the submit gate may emit; nothing else acts on a page)
 * - `frame.diagnose --json`, `page.readiness --json`
 * - every failure: exit 1, stderr `Error: <message> [code]`, stdout `{"error": {...}}` under --json
 *
 * Page model (slice S6 schema bump; the fake never learns a verb from prose, review A17):
 *
 *   {
 *     title, readyState, readiness, evidence[], links[], counts{}, jsResult, jsThrows,
 *     frames: [{ src, outOfProcess?, reachable? }],  // frame.diagnose topology (S8 reads it)
 *     fields: { "<selector>": { value, kind?, checked?, name?, id?, label?, form?, hidden? } },
 *                                  // state a step may write and read; name/id/label/form are
 *                                  // what a locator resolves through, form is a form selector
 *     controls: [{ selector, kind?, enabled?, text?, form?, id?, name?, visible? }],
 *                                  // what a click may target; kind is the `type` attribute,
 *                                  // absent kind on a <button> is an implicit submit
 *     forbidden: ["click", ...],   // verbs this page refuses, so a test can prove none ran
 *     changeNavigatesTo: "<url>",  // where a click (or `type --submit`) sends the tab
 *     typeNavigatesTo: "<url>",    // a change handler that navigates when a value is set
 *     submitPostsTo: "<url>",      // a control click POSTs the field values there, so a test
 *                                  // can count how many submissions reached a real server
 *     controlsAfterType: [...],    // the controls the page shows once a value has been typed:
 *                                  // a form that re-renders its buttons on input
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
import { request as httpRequest } from "node:http";
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
    "--into",
    "--by",
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
  // Per-field merge: a `type` writes `value` (or `checked`) and must not drop the identity the
  // page model declared for that field (its kind, name, label or owning form).
  const fields = {};
  for (const [selector, field] of Object.entries(page.fields || {})) {
    fields[selector] = { ...field };
  }
  for (const [selector, written] of Object.entries(state?.fields?.[page.url || url] || {})) {
    fields[selector] = { ...(fields[selector] || {}), ...written };
  }
  // A form that re-renders its buttons once a value was typed: the state file records that a
  // field was written, which is the only "after input" signal this fixture has.
  const typed = Boolean(state?.fields?.[page.url || url]);
  const controls = (typed && page.controlsAfterType ? page.controlsAfterType : page.controls) || [];
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
    typeNavigatesTo: page.typeNavigatesTo,
    submitPostsTo: page.submitPostsTo,
    navigatesAfterGate: page.navigatesAfterGate,
    extractAttempts: page.extractAttempts ?? 1,
    counts: {
      anchors: (page.links || []).length,
      buttons: controls.length > 0 ? controls.length : 1,
      forms: formSelectorsOf(fields, controls).length,
      inputs: Object.keys(fields).length,
      iframes: frames.length,
      ...(page.counts || {}),
    },
    jsResult: page.jsResult,
    jsThrows: page.jsThrows,
  };
}

/** Every distinct owning form named by a field or a control, in declaration order. */
function formSelectorsOf(fields, controls) {
  const seen = [];
  for (const field of Object.values(fields)) {
    if (field.form && !seen.includes(field.form)) seen.push(field.form);
  }
  for (const control of controls) {
    if (control.form && !seen.includes(control.form)) seen.push(control.form);
  }
  return seen;
}

/** Field values a `type` wrote in this state file; the page model holds the initial values. */
function writeFieldValue(state, url, selector, value) {
  state.fields = state.fields || {};
  state.fields[url] = state.fields[url] || {};
  const current = state.fields[url][selector] || {};
  state.fields[url][selector] = { ...current, value };
}

/** The checked state a `click` on a checkbox or radio input toggled. */
function writeFieldChecked(state, url, selector, checked) {
  state.fields = state.fields || {};
  state.fields[url] = state.fields[url] || {};
  const current = state.fields[url][selector] || {};
  state.fields[url][selector] = { ...current, checked };
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

/**
 * A DOM stub with a small selector engine.
 *
 * The plan probe of the submit gate reads a form the way a browser presents one - tag names,
 * `[name="..."]`, `#id`, `<label>` and its `control`, `el.form`, layout boxes - so the fixture
 * has to model those, not a lookup table of selector strings. What is modelled is a documented
 * subset: comma lists, a tag name, `#id`, `[attr="value"]` and `tag[attr="value"]`, plus the
 * page model's own selector key as an exact match. Anything else matches nothing, which is the
 * fail-closed direction: a probe that needs more than this fails loudly in a test rather than
 * quietly passing against a fixture that guessed.
 */
function parseSelector(selector) {
  return String(selector)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const attributes = [];
      let rest = part;
      let id = null;
      rest = rest.replace(
        /\[([A-Za-z_:][-\w:.]*)(?:([~^$*|]?=)"?([^\]"]*)"?)?\]/g,
        (_, name, operator, value) => {
          attributes.push({ name, value: operator ? value : undefined });
          return "";
        },
      );
      rest = rest.replace(/#([A-Za-z][-\w]*)/, (_, value) => {
        id = value;
        return "";
      });
      const tag = rest.trim().toLowerCase();
      return { raw: part, tag: tag === "" || tag === "*" ? null : tag, id, attributes };
    });
}

function nodeAttribute(node, name) {
  if (name === "name") return node.name;
  if (name === "id") return node.id;
  if (name === "type") return node.type;
  if (name === "href") return node.href;
  if (name === "role") return node.role;
  if (name === "value") return node.value;
  if (name === "aria-label") return node.ariaLabel;
  return undefined;
}

function matchesSimpleSelector(node, parsed) {
  if (node.selector && node.selector === parsed.raw) return true;
  if (parsed.tag && String(node.tagName || "").toLowerCase() !== parsed.tag) return false;
  if (parsed.id && node.id !== parsed.id) return false;
  for (const attribute of parsed.attributes) {
    const actual = nodeAttribute(node, attribute.name);
    if (actual === undefined || actual === null || actual === "") return false;
    if (attribute.value !== undefined && String(actual) !== attribute.value) return false;
  }
  return parsed.tag !== null || parsed.id !== null || parsed.attributes.length > 0;
}

function domNode(base) {
  const node = {
    id: undefined,
    name: undefined,
    type: undefined,
    role: undefined,
    ariaLabel: undefined,
    textContent: "",
    hidden: false,
    disabled: false,
    ...base,
  };
  node.getAttribute = (attribute) => {
    const value = nodeAttribute(node, attribute);
    return value === undefined ? null : value;
  };
  node.getBoundingClientRect = () =>
    node.hidden || node.visible === false ? { width: 0, height: 0 } : { width: 120, height: 24 };
  node.offsetParent = node.hidden || node.visible === false ? null : {};
  return node;
}

function idFromSelector(selector, declared) {
  if (declared) return declared;
  const match = /^#([A-Za-z][-\w]*)$/.exec(String(selector));
  return match ? match[1] : undefined;
}

function stubDocument(page) {
  const forms = new Map();
  const formNode = (selector) => {
    if (!selector) return null;
    if (!forms.has(selector)) {
      forms.set(
        selector,
        domNode({ tagName: "FORM", selector, id: idFromSelector(selector, undefined) }),
      );
    }
    return forms.get(selector);
  };
  for (const selector of formSelectorsOf(page.fields, page.controls)) {
    formNode(selector);
  }

  const anchors = page.links.map((href) =>
    domNode({ tagName: "A", href, selector: null, textContent: href }),
  );
  const repeat = (count, tagName) =>
    Array.from({ length: count }, () => domNode({ tagName, selector: null }));

  const fieldNodes = Object.entries(page.fields).map(([selector, field]) =>
    domNode({
      tagName: (field.kind || "text") === "select" ? "SELECT" : "INPUT",
      type: field.kind || "text",
      value: field.value ?? "",
      checked: field.checked ?? false,
      name: field.name,
      id: idFromSelector(selector, field.id),
      ariaLabel: field.ariaLabel,
      hidden: field.hidden === true,
      disabled: field.disabled === true,
      form: formNode(field.form),
      selector,
    }),
  );

  const controlNodes = page.controls.map((control) =>
    domNode({
      tagName: control.tag ? String(control.tag).toUpperCase() : "BUTTON",
      type: control.kind,
      textContent: control.text ?? "",
      disabled: control.enabled === false,
      visible: control.visible,
      name: control.name,
      id: idFromSelector(control.selector, control.id),
      role: control.role,
      form: formNode(control.form),
      selector: control.selector,
    }),
  );

  const labelNodes = Object.entries(page.fields)
    .filter(([, field]) => typeof field.label === "string" && field.label !== "")
    .map(([selector, field]) =>
      domNode({
        tagName: "LABEL",
        textContent: field.label,
        selector: null,
        control: fieldNodes.find((node) => node.selector === selector) ?? null,
      }),
    );

  const iframeNodes = page.frames.map((frame) =>
    domNode({ tagName: "IFRAME", selector: null, src: frame.src }),
  );

  const all = [
    ...fieldNodes,
    ...controlNodes,
    ...labelNodes,
    ...anchors,
    ...iframeNodes,
    ...forms.values(),
  ];

  return {
    title: page.title,
    readyState: page.readyState,
    getElementById(id) {
      return all.find((node) => node.id === id) ?? null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const parsed = parseSelector(selector);
      const matched = all.filter((node) =>
        parsed.some((part) => matchesSimpleSelector(node, part)),
      );
      if (matched.length > 0) return matched;
      // Pages that declare only counts (the S3 capture corpus) still answer count queries.
      const text = String(selector);
      if (text.startsWith("a[href]")) return anchors;
      if (text.startsWith("button")) return repeat(page.counts.buttons, "BUTTON");
      if (text.startsWith("form")) return repeat(page.counts.forms, "FORM");
      if (text.startsWith("input")) return repeat(page.counts.inputs, "INPUT");
      if (text.startsWith("iframe")) return repeat(page.counts.iframes, "IFRAME");
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

/**
 * A control click that reaches a server. The submit gate's proof is "exactly one POST", and a
 * fixture that only writes to a log file cannot make that claim; this one opens a socket.
 */
async function postSubmission(target, fields) {
  const body = new URLSearchParams(fields).toString();
  const url = new URL(target);
  // The submission is sent, not awaited: a real browser does not block a click on the server's
  // reply, and the caller of this fake is inside a synchronous spawn, so waiting for a response
  // from a server in that same process would deadlock. Resolving on `finish` means the bytes
  // are on the socket.
  await new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body),
      },
    });
    request.on("error", reject);
    request.on("finish", () => {
      // The reply is never read, so the pending socket must not keep this process alive: the
      // caller is a synchronous spawn and would wait for its whole budget.
      request.socket?.unref();
      resolve();
    });
    request.end(body);
  });
}

/** Where a `type` or `click` sends the tab, when the page model says it navigates. */
function applyNavigation(page, tab, target) {
  if (!target) {
    return page.url;
  }
  state.tabs[tab.id] = { url: target };
  saveState(state);
  return target;
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
    // `--into` is the upstream flag; `--selector` is accepted because the runtime's argv
    // mapping used it before the submit gate taught the translation to emit `--into`.
    const selector = flag("--into") ?? flag("--selector");
    if (text === undefined) fail("usage", "type requires text");
    if (!selector) fail("usage", "type requires --into in this fixture");
    if (!page.fields[selector]) fail("no_element", `No element matches ${selector}`);
    writeFieldValue(state, page.url, selector, text);
    saveState(state);
    // A page whose change handler acts on its own: setting a value moves the tab, which is
    // what `fill_side_effect_observed` exists for.
    const url = applyNavigation(
      page,
      tab,
      hasFlag("--submit") ? page.changeNavigatesTo : page.typeNavigatesTo,
    );
    emit({ success: true, selector, value: text, url }, targetMeta(tab));
    break;
  }
  case "select": {
    const tab = resolveTab(state);
    const page = pageFor(tab.url, state);
    assertNotForbidden(page);
    const [selector, ...values] = positionals();
    if (!selector) fail("usage", "select requires a ref or selector");
    if (values.length === 0) fail("usage", "select requires at least one value");
    if (!page.fields[selector]) fail("no_element", `No element matches ${selector}`);
    writeFieldValue(state, page.url, selector, values[0]);
    saveState(state);
    const url = applyNavigation(page, tab, page.typeNavigatesTo);
    emit({ success: true, selector, value: values[0], url }, targetMeta(tab));
    break;
  }
  case "click": {
    const tab = resolveTab(state);
    const page = pageFor(tab.url, state);
    assertNotForbidden(page);
    const selector = flag("--selector") ?? positionals()[0];
    if (!selector) fail("usage", "click requires a ref or --selector");
    const field = page.fields[selector];
    if (field) {
      // A click on the input control itself: how a checkbox or radio is set (packet D3).
      const checked = !(field.checked ?? false);
      writeFieldChecked(state, page.url, selector, checked);
      saveState(state);
      emit(
        { success: true, selector, checked, url: applyNavigation(page, tab, page.typeNavigatesTo) },
        targetMeta(tab),
      );
      break;
    }
    const control = page.controls.find((entry) => entry.selector === selector);
    if (!control) fail("no_element", `No element matches ${selector}`);
    if (control.enabled === false) fail("element_disabled", `${selector} is disabled`);
    if (page.submitPostsTo) {
      const values = Object.fromEntries(
        Object.entries(page.fields).map(([key, field]) => [field.name || key, field.value ?? ""]),
      );
      await postSubmission(page.submitPostsTo, values);
    }
    emit(
      { success: true, selector, url: applyNavigation(page, tab, page.changeNavigatesTo) },
      targetMeta(tab),
    );
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
