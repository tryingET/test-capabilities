import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const FAKE_AGENT_BROWSER_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "fake-agent-browser.mjs",
);

export const AGENT_BROWSER_CAPTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "captures",
  "agent-browser",
  "snapshot-releases.json",
);

/** The committed live capture: the page every fake answers with unless a test says otherwise. */
export function releasesCapture() {
  return JSON.parse(readFileSync(AGENT_BROWSER_CAPTURE, "utf8"));
}

const ENV_KEYS = [
  "FAKE_AB_STATE_DIR",
  "FAKE_AB_PAGES",
  "FAKE_AB_VERSION",
  "FAKE_AB_FAIL_ON",
  "FAKE_AB_EMPTY_ON",
  "FAKE_AB_TAB_GONE_ON",
  "FAKE_AB_ORIGIN",
  "FAKE_AB_LOG",
];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Write an `agent-browser` wrapper script that runs the fake fixture with its configuration
 * baked in, so both in-process callers and child CLI processes see the same fake tool.
 *
 * options: { pages, version, failOn, emptyOn, tabGoneOn, origin, name, log }
 */
export function createFakeAgentBrowser(options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-fake-ab-"));
  const stateDir = path.join(dir, "state");
  // A string `log` points both fakes at one file, so a test can prove the order two tools
  // acted in (the a11y channel's teardown before surf closes the tab).
  const logFile =
    options.log === false
      ? undefined
      : typeof options.log === "string"
        ? options.log
        : path.join(dir, "calls.log");
  const env = {
    FAKE_AB_STATE_DIR: stateDir,
    FAKE_AB_PAGES: options.pages ? JSON.stringify(options.pages) : undefined,
    FAKE_AB_VERSION: options.version,
    FAKE_AB_FAIL_ON: Array.isArray(options.failOn) ? options.failOn.join(",") : options.failOn,
    FAKE_AB_EMPTY_ON: Array.isArray(options.emptyOn) ? options.emptyOn.join(",") : options.emptyOn,
    FAKE_AB_TAB_GONE_ON: Array.isArray(options.tabGoneOn)
      ? options.tabGoneOn.join(",")
      : options.tabGoneOn,
    FAKE_AB_ORIGIN: options.origin,
    FAKE_AB_LOG: logFile,
  };
  const exports = ENV_KEYS.filter((key) => env[key] !== undefined)
    .map((key) => `export ${key}=${shellQuote(env[key])}`)
    .join("\n");
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, options.name ?? "agent-browser");
  writeFileSync(
    binPath,
    `#!/bin/sh\n${exports}\nexec ${shellQuote(process.execPath)} ${shellQuote(FAKE_AGENT_BROWSER_FIXTURE)} "$@"\n`,
    { mode: 0o755 },
  );

  return {
    dir,
    binDir,
    path: binPath,
    logFile,
    calls() {
      if (!logFile) {
        return [];
      }
      try {
        return readFileSync(logFile, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    },
    /** the verbs the run issued, with the global options stripped */
    verbs() {
      return this.calls()
        .map((call) => call.filter((_arg, index) => !isGlobal(call, index)))
        .map((call) => call[0])
        .filter((verb) => verb !== undefined && !verb.startsWith("-"));
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function isGlobal(call, index) {
  const arg = call[index];
  const previous = call[index - 1];
  return (
    arg === "--cdp" ||
    arg === "--session" ||
    arg === "--pin-tab" ||
    previous === "--cdp" ||
    previous === "--session"
  );
}

/**
 * A fake Chromium DevTools endpoint on `127.0.0.1:0`, serving `/json/version` and `/json/list`
 * (precedent: `scripts/capability-fixture-server.mjs`). It is what makes the probe, the loopback
 * rule, the tab binding and `tab_bind_ambiguous` testable without a browser.
 */
export async function startFakeCdpEndpoint(options = {}) {
  const state = {
    browser: options.browser ?? "Chrome/152.0.7977.64",
    targets: options.targets ?? [],
    versionBody: options.versionBody,
    versionStatus: options.versionStatus ?? 200,
  };
  const requests = [];
  let listRequests = 0;

  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/json/version") {
      response.writeHead(state.versionStatus, { "content-type": "application/json" });
      response.end(
        state.versionBody ??
          JSON.stringify({
            Browser: state.browser,
            "Protocol-Version": "1.3",
            webSocketDebuggerUrl: "ws://127.0.0.1:0/devtools/browser/fake",
          }),
      );
      return;
    }
    if (request.url === "/json/list") {
      response.writeHead(200, { "content-type": "application/json" });
      // `listSequence` answers the n-th request with its n-th entry (the last one repeats), which
      // is how a page appearing between the channel's `before` and `after` reads is staged.
      const sequence = options.listSequence;
      const listed = sequence
        ? sequence[Math.min(listRequests, sequence.length - 1)]
        : state.targets;
      listRequests += 1;
      response.end(JSON.stringify(listed));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    setTargets(targets) {
      state.targets = targets;
    },
    setBrowser(browser) {
      state.browser = browser;
    },
    setVersionBody(body, status = 200) {
      state.versionBody = body;
      state.versionStatus = status;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** One `/json/list` page target, in the shape Chromium answers with. */
export function pageTarget(id, url, title = "") {
  return {
    description: "",
    id,
    title,
    type: "page",
    url,
    webSocketDebuggerUrl: `ws://127.0.0.1:0/devtools/page/${id}`,
  };
}
