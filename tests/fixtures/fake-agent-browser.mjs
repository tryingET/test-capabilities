#!/usr/bin/env node
/**
 * Fake `agent-browser` executable for contract tests. It speaks the 0.35.1 CLI/JSON shapes the
 * a11y snapshot channel uses, without a browser and without a daemon:
 *
 * - `--version`                       -> "agent-browser <version>"
 * - `tab <targetId>`                  -> binds the pinned session to a target it knows
 * - `tab list --json`                 -> `{success, data:{tabs:[{targetId, url, title, type}]}}`
 * - `snapshot -i --json`              -> `{success, data:{origin, refs, snapshot}}` for the bound
 *                                        target, fed by `FAKE_AB_PAGES`
 * - `get text|attr|url|title|count @ref`, `is visible|enabled|checked @ref`
 * - `close`                           -> ends the session (prints "Browser closed"), which is
 *                                        what the real binary does to a session attached over CDP
 * - every other verb                  -> exit 1 with `{"success":false,...}`: the fake never
 *                                        learns an action verb, so a test can prove none ran
 *
 * Page model (`FAKE_AB_PAGES`, a JSON map keyed by CDP target id):
 *
 *   { "<targetId>": { origin, refs: { "e1": {role, name}, ... }, snapshot: "<text>" } }
 *
 * The default page is the committed live capture
 * (`tests/fixtures/captures/agent-browser/snapshot-releases.json`), so the fidelity test can
 * assert that what the fake answers is what the real tool answered.
 *
 * Configuration (environment):
 * - FAKE_AB_STATE_DIR      directory for the per-session binding (required for tab/snapshot)
 * - FAKE_AB_PAGES          JSON map targetId -> page model above
 * - FAKE_AB_VERSION        what `--version` prints (default 0.35.1)
 * - FAKE_AB_FAIL_ON        comma list of verbs that exit 9 with a stderr line
 * - FAKE_AB_EMPTY_ON       comma list of verbs whose payload is an empty tree
 * - FAKE_AB_TAB_GONE_ON    comma list of verbs that answer `{"success":false,"error":"tab_gone"}`
 * - FAKE_AB_ORIGIN         override the origin the snapshot reports (the mismatch case)
 * - FAKE_AB_LOG            file that receives one JSON line per invocation (argv)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);

if (process.env.FAKE_AB_LOG) {
  appendFileSync(process.env.FAKE_AB_LOG, `${JSON.stringify(argv)}\n`);
}

const CAPTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "captures",
  "agent-browser",
  "snapshot-releases.json",
);

function listOf(name) {
  return (process.env[name] || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function fail(message, code = 1) {
  process.stdout.write(`${JSON.stringify({ success: false, data: null, error: message })}\n`);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(code);
}

function ok(data) {
  process.stdout.write(`${JSON.stringify({ success: true, data, error: null })}\n`);
  process.exit(0);
}

/** Strip the global options the channel always passes, and remember them. */
const globals = { cdp: undefined, session: undefined, pinTab: false };
const rest = [];
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (arg === "--cdp") {
    globals.cdp = argv[index + 1];
    index += 1;
  } else if (arg === "--session") {
    globals.session = argv[index + 1];
    index += 1;
  } else if (arg === "--pin-tab") {
    globals.pinTab = true;
  } else {
    rest.push(arg);
  }
}

const command = rest[0];

if (argv.includes("--version") || command === "--version") {
  process.stdout.write(`agent-browser ${process.env.FAKE_AB_VERSION || "0.35.1"}\n`);
  process.exit(0);
}

if (!command) {
  fail("no command given");
}

if (listOf("FAKE_AB_FAIL_ON").includes(command)) {
  process.stderr.write("agent-browser exploded\n");
  process.exit(9);
}
if (listOf("FAKE_AB_TAB_GONE_ON").includes(command)) {
  fail("tab_gone: the pinned tab is no longer open");
}

// Every command below acts on the pinned session, so both globals are mandatory: the channel
// never uses the shared default session and never lets agent-browser launch a browser.
if (!globals.cdp) {
  fail("the fake agent-browser refuses an invocation without --cdp: it would launch a browser");
}
if (!globals.session) {
  fail("the fake agent-browser refuses an invocation without --session");
}

const stateDir = process.env.FAKE_AB_STATE_DIR;
if (!stateDir) {
  fail("FAKE_AB_STATE_DIR is not set");
}
mkdirSync(stateDir, { recursive: true });
const bindingFile = path.join(stateDir, `${globals.session.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);

function pages() {
  if (process.env.FAKE_AB_PAGES) {
    return JSON.parse(process.env.FAKE_AB_PAGES);
  }
  const capture = JSON.parse(readFileSync(CAPTURE, "utf8"));
  return { "82FF618C514C4D95C04EFD4AAF478A48": capture.stdout.data };
}

function readBinding() {
  if (!existsSync(bindingFile)) {
    return undefined;
  }
  return JSON.parse(readFileSync(bindingFile, "utf8")).targetId;
}

const model = pages();

switch (command) {
  case "tab": {
    const argument = rest[1];
    if (argument === "list") {
      ok({
        tabs: Object.entries(model).map(([targetId, page], index) => ({
          active: index === 0,
          tabId: `t${index + 1}`,
          targetId,
          title: page.title ?? "",
          type: "page",
          url: page.origin ?? "",
        })),
      });
    }
    if (!argument) {
      fail("tab needs a target id");
    }
    if (!model[argument]) {
      fail(`tab_gone: no target ${argument}`);
    }
    writeFileSync(bindingFile, JSON.stringify({ targetId: argument }), { mode: 0o600 });
    ok({ targetId: argument, url: model[argument].origin ?? "" });
    break;
  }
  case "snapshot": {
    const targetId = readBinding();
    if (!targetId) {
      fail("no tab is bound to this session");
    }
    const page = model[targetId];
    if (!page) {
      fail(`tab_gone: no target ${targetId}`);
    }
    if (listOf("FAKE_AB_EMPTY_ON").includes("snapshot")) {
      ok({ origin: page.origin ?? "", refs: {}, snapshot: "" });
    }
    ok({
      origin: process.env.FAKE_AB_ORIGIN ?? page.origin ?? "",
      refs: page.refs ?? {},
      snapshot: page.snapshot ?? "",
    });
    break;
  }
  case "get":
  case "is": {
    const what = rest[1];
    const ref = (rest[2] || "").replace(/^@/, "");
    const targetId = readBinding();
    const page = targetId ? model[targetId] : undefined;
    if (!page) {
      fail("no tab is bound to this session");
    }
    const node = page.refs?.[ref];
    if (!node) {
      fail(`Unknown ref: ${ref}`);
    }
    if (command === "is") {
      ok({ origin: page.origin ?? "", [what]: node[what] ?? what === "visible" });
    }
    if (what === "url") {
      ok({ url: page.origin ?? "" });
    }
    if (what === "attr") {
      ok({ origin: page.origin ?? "", attr: node.attr?.[rest[3]] ?? "" });
    }
    ok({ origin: page.origin ?? "", [what]: node[what] ?? node.name ?? "" });
    break;
  }
  case "close": {
    // The real binary ends the session and leaves an attached browser running (measured
    // 2026-09-08); it does not close the tabs it strayed into.
    if (existsSync(bindingFile)) {
      writeFileSync(bindingFile, JSON.stringify({ closed: true }), { mode: 0o600 });
    }
    process.stdout.write("✓ Browser closed\n");
    process.exit(0);
    break;
  }
  default:
    fail(`the fake agent-browser refuses '${command}': it is not on the read-only allowlist`);
}
