import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeSurf } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const {
  assertSurfExploreMechanisms,
  parseCreatedTabId,
  parseSurfErrorOutput,
  parseSurfJsonOutput,
  resolveSurfRuntimeCommand,
  resolveSurfRuntimeResolution,
  translateSurfArgs,
} = await importRuntimeModule("core/surf-runtime.js");
const { probeSurfRuntime } = await importRuntimeModule("core/surf-adapter.js");

function withTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-surf-runtime-"));
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function executable(pathname) {
  mkdirSync(path.dirname(pathname), { recursive: true });
  writeFileSync(pathname, "#!/bin/sh\n", { mode: 0o755 });
}

function isolatedEnv(dir, overrides = {}) {
  return {
    PATH: path.join(dir, "empty-path"),
    HOME: path.join(dir, "home"),
    ...overrides,
  };
}

test("surf runtime resolves TEST_CAPABILITIES_SURF_BIN before PATH", () => {
  const tmp = withTempDir();
  try {
    const explicit = path.join(tmp.dir, "explicit", "surf");
    const onPath = path.join(tmp.dir, "path-bin", "surf");
    executable(explicit);
    executable(onPath);

    const resolution = resolveSurfRuntimeResolution(
      isolatedEnv(tmp.dir, {
        PATH: path.dirname(onPath),
        TEST_CAPABILITIES_SURF_BIN: explicit,
      }),
    );

    assert.equal(resolution.command, explicit);
    assert.equal(resolution.flavor, "surf");
    assert.equal(resolution.provider, "explicit_bin");
    assert.deepEqual(resolution.baseArgs, []);
    assert.deepEqual(resolution.resolutionNotes, []);
  } finally {
    tmp.cleanup();
  }
});

test("surf runtime falls back to surf on PATH, then ~/.local/bin/surf", () => {
  const tmp = withTempDir();
  try {
    const onPath = path.join(tmp.dir, "path-bin", "surf");
    const inHome = path.join(tmp.dir, "home", ".local", "bin", "surf");
    executable(onPath);
    executable(inHome);

    const fromPath = resolveSurfRuntimeResolution(
      isolatedEnv(tmp.dir, { PATH: path.dirname(onPath) }),
    );
    assert.equal(fromPath.command, onPath);
    assert.equal(fromPath.provider, "path_surf");

    const fromHome = resolveSurfRuntimeResolution(isolatedEnv(tmp.dir));
    assert.equal(fromHome.command, inHome);
    assert.equal(fromHome.provider, "home_local_bin");
    assert.match(fromHome.resolutionNotes.join("\n"), /not on PATH/);
  } finally {
    tmp.cleanup();
  }
});

test("surf runtime fails closed when no surf CLI exists", () => {
  const tmp = withTempDir();
  try {
    assert.throws(
      () => resolveSurfRuntimeResolution(isolatedEnv(tmp.dir)),
      /No surf CLI found\. Set TEST_CAPABILITIES_SURF_BIN, put 'surf' on PATH, or install nicobailon\/surf-cli/,
    );
  } finally {
    tmp.cleanup();
  }
});

test("surf runtime fails closed for a non-executable TEST_CAPABILITIES_SURF_BIN", () => {
  const tmp = withTempDir();
  try {
    assert.throws(
      () =>
        resolveSurfRuntimeResolution(
          isolatedEnv(tmp.dir, { TEST_CAPABILITIES_SURF_BIN: path.join(tmp.dir, "missing-surf") }),
        ),
      /TEST_CAPABILITIES_SURF_BIN points to .*missing-surf, but no executable surf CLI exists there/,
    );
  } finally {
    tmp.cleanup();
  }
});

test("surf runtime refuses retired surf-go env vars instead of silently ignoring them", () => {
  const tmp = withTempDir();
  try {
    const surf = path.join(tmp.dir, "path-bin", "surf");
    executable(surf);
    const env = isolatedEnv(tmp.dir, { PATH: path.dirname(surf) });

    assert.throws(
      () => resolveSurfRuntimeResolution({ ...env, TEST_CAPABILITIES_SURF_GO_BIN: "/opt/surf-go" }),
      /TEST_CAPABILITIES_SURF_GO_BIN is set, but the surf-go fork runtime was retired/,
    );
    assert.throws(
      () =>
        resolveSurfRuntimeResolution({
          ...env,
          TEST_CAPABILITIES_SURF_GO_BIN: "/opt/surf-go",
          TEST_CAPABILITIES_SURF_GO_REPO: "/opt/surf-cli-go",
        }),
      /TEST_CAPABILITIES_SURF_GO_BIN and TEST_CAPABILITIES_SURF_GO_REPO are set/,
    );
    // Empty values mean "unset", the way CI overlays clear them.
    assert.equal(
      resolveSurfRuntimeResolution({
        ...env,
        TEST_CAPABILITIES_SURF_GO_BIN: "",
        TEST_CAPABILITIES_SURF_GO_REPO: "",
      }).command,
      surf,
    );
  } finally {
    tmp.cleanup();
  }
});

test("surf runtime probe reports the version and the branch mechanisms", () => {
  const fake = createFakeSurf();
  try {
    const resolution = resolveSurfRuntimeResolution({
      PATH: "/nonexistent",
      HOME: fake.dir,
      TEST_CAPABILITIES_SURF_BIN: fake.path,
    });
    const probe = probeSurfRuntime(resolution, { cache: false });

    assert.equal(probe.version, "2.18.0");
    assert.equal(probe.versionOutput, "surf version 2.18.0");
    assert.deepEqual(probe.mechanisms, {
      waitReady: true,
      pageReadiness: true,
      extract: true,
      frameDiagnose: true,
    });
    assert.deepEqual(probe.missingExploreMechanisms, []);
    assert.doesNotThrow(() => assertSurfExploreMechanisms(resolution, probe));
    assert.deepEqual(
      fake.calls().map((call) => call[0]),
      ["--version", "--help-full"],
    );
  } finally {
    fake.cleanup();
  }
});

test("surf runtime probe detects an upstream build without the mechanisms and refuses explore", () => {
  const fake = createFakeSurf({ mode: "upstream" });
  try {
    const resolution = resolveSurfRuntimeResolution({
      PATH: "/nonexistent",
      HOME: fake.dir,
      TEST_CAPABILITIES_SURF_BIN: fake.path,
    });
    const probe = probeSurfRuntime(resolution, { cache: false });

    assert.equal(probe.version, "2.18.0");
    assert.deepEqual(probe.mechanisms, {
      waitReady: false,
      pageReadiness: false,
      extract: false,
      frameDiagnose: false,
    });
    assert.deepEqual(probe.missingExploreMechanisms, ["wait.ready", "extract"]);
    assert.throws(
      () => assertSurfExploreMechanisms(resolution, probe),
      /surf 2\.18\.0 via explicit_bin \(.*\) lacks wait\.ready and extract\. Surf explore requires the surf-cli build with typed page readiness/,
    );
  } finally {
    fake.cleanup();
  }
});

test("surf runtime probe fails closed when the binary does not answer --version", () => {
  const tmp = withTempDir();
  try {
    const broken = path.join(tmp.dir, "surf");
    writeFileSync(broken, "#!/bin/sh\necho 'not surf' >&2\nexit 3\n", { mode: 0o755 });
    const resolution = resolveSurfRuntimeResolution({
      PATH: "/nonexistent",
      HOME: tmp.dir,
      TEST_CAPABILITIES_SURF_BIN: broken,
    });
    assert.throws(
      () => probeSurfRuntime(resolution, { cache: false }),
      /did not answer --version: not surf/,
    );
  } finally {
    tmp.cleanup();
  }
});

test("surf command translation covers verified SurfClient and explore command shapes", () => {
  assert.deepEqual(translateSurfArgs("go", ["https://example.com"]), [
    "navigate",
    "https://example.com",
  ]);
  assert.deepEqual(translateSurfArgs("read", ["--depth", "3", "--compact"]), [
    "page.read",
    "--depth",
    "3",
    "--compact",
  ]);
  assert.deepEqual(translateSurfArgs("page.text"), ["page.text"]);
  assert.deepEqual(translateSurfArgs("page.state"), ["page.state", "--json"]);
  assert.deepEqual(translateSurfArgs("network"), ["network", "--json"]);
  assert.deepEqual(
    translateSurfArgs("network", ["--origin", "api.github.com", "--status", "4xx"]),
    ["network", "--origin", "api.github.com", "--status", "4xx", "--json"],
  );
  assert.deepEqual(translateSurfArgs("console"), ["console", "--json"]);
  assert.deepEqual(translateSurfArgs("tab.reload"), ["tab.reload"]);
  assert.deepEqual(translateSurfArgs("tab.reload", ["--hard"]), ["tab.reload", "--hard"]);
  assert.deepEqual(translateSurfArgs("tab.list"), ["tab.list", "--json"]);
  assert.deepEqual(translateSurfArgs("window.list"), ["window.list", "--json"]);
  assert.deepEqual(translateSurfArgs("tab.new", ["https://example.com"]), [
    "tab.new",
    "https://example.com",
  ]);
  assert.deepEqual(translateSurfArgs("tab.close", ["7"]), ["tab.close", "7"]);
  assert.deepEqual(translateSurfArgs("chatgpt", ["say ping", "--with-page"]), [
    "chatgpt",
    "say ping",
    "--with-page",
  ]);
  assert.deepEqual(translateSurfArgs("click", ["--selector", "button.login"]), [
    "click",
    "--selector",
    "button.login",
  ]);
  assert.deepEqual(translateSurfArgs("click", ["e5"]), ["click", "e5"]);
  assert.deepEqual(translateSurfArgs("click", ["100", "200"]), [
    "click",
    "--x",
    "100",
    "--y",
    "200",
  ]);
  assert.deepEqual(translateSurfArgs("type", ["hello", "--ref", "e1", "--submit"]), [
    "type",
    "hello",
    "--ref",
    "e1",
    "--submit",
  ]);
  assert.deepEqual(translateSurfArgs("type", ["hi", "--selector", "input[name=q]"]), [
    "type",
    "hi",
    "--into",
    "input[name=q]",
  ]);
  assert.deepEqual(translateSurfArgs("key", ["Enter"]), ["key", "Enter"]);
  assert.deepEqual(translateSurfArgs("scroll.down", ["down", "500"]), ["scroll", "down", "500"]);
  assert.deepEqual(translateSurfArgs("select", ["e5", "US", "--by", "label"]), [
    "select",
    "e5",
    "US",
    "--by",
    "label",
  ]);
  assert.deepEqual(translateSurfArgs("screenshot", ["--max-size", "777"]), [
    "screenshot",
    "--max-size",
    "777",
  ]);
  // Framework waits are milliseconds; upstream `wait <duration>` takes seconds.
  assert.deepEqual(translateSurfArgs("wait", ["1500"]), ["wait", "1.5"]);
  assert.deepEqual(translateSurfArgs("wait", ["0"]), ["wait", "0"]);
  assert.deepEqual(translateSurfArgs("wait", ["--element", "#ready"]), ["wait.element", "#ready"]);
  assert.deepEqual(translateSurfArgs("wait", ["--url", "/dashboard"]), ["wait.url", "/dashboard"]);
  assert.deepEqual(translateSurfArgs("wait", ["--network"]), ["wait.network"]);
  assert.deepEqual(translateSurfArgs("js", ["return document.title"]), [
    "js",
    "return document.title",
    "--json",
  ]);
  assert.deepEqual(translateSurfArgs("js", ["document.title", "--tab-id", "7"]), [
    "js",
    "document.title",
    "--tab-id",
    "7",
    "--json",
  ]);
  assert.deepEqual(
    translateSurfArgs("wait.ready", ["--tab-id", "7", "--accept", "login,not-found"]),
    ["wait.ready", "--tab-id", "7", "--accept", "login,not-found", "--json"],
  );
  assert.deepEqual(translateSurfArgs("page.readiness"), ["page.readiness", "--json"]);
  assert.deepEqual(translateSurfArgs("frame.diagnose"), ["frame.diagnose", "--json"]);
  assert.deepEqual(
    translateSurfArgs("extract", ["https://example.com/", "--code", "return []", "--allow-empty"]),
    ["extract", "https://example.com/", "--code", "return []", "--allow-empty", "--json"],
  );
  assert.deepEqual(translateSurfArgs("extract", ["--tab-id", "7", "--code", "return []"]), [
    "extract",
    "--tab-id",
    "7",
    "--code",
    "return []",
    "--json",
  ]);
  assert.deepEqual(translateSurfArgs("emulate.viewport", ["--width", "375", "--height", "812"]), [
    "emulate.viewport",
    "--width",
    "375",
    "--height",
    "812",
  ]);
  assert.deepEqual(translateSurfArgs("frame.switch", ["--index", "0"]), [
    "frame.switch",
    "--index",
    "0",
  ]);
  assert.deepEqual(
    translateSurfArgs("locate.role", ["button", "--name", "Submit", "--action", "click"]),
    ["locate.role", "button", "--name", "Submit", "--action", "click"],
  );
  assert.deepEqual(translateSurfArgs("do", ['go "https://example.com" | click e5']), [
    "do",
    'go "https://example.com" | click e5',
  ]);
  assert.deepEqual(translateSurfArgs("do", ["--file", "login.json", "--email", "x"]), [
    "do",
    "--file",
    "login.json",
    "--email",
    "x",
  ]);
});

test("surf command translation fails closed for unmapped commands and unverified flags", () => {
  assert.throws(
    () => translateSurfArgs("wait", ["--state", "idle"]),
    /Unsupported surf wait argument shape: --state is not a verified surf flag/,
  );
  assert.throws(
    () => translateSurfArgs("workflow.run", ["./flow.json"]),
    /Unsupported surf command mapping for 'workflow.run'/,
  );
  assert.throws(
    () => translateSurfArgs("click", ["--bogus", "x"]),
    /Unsupported surf click argument shape/,
  );
  assert.throws(
    () => translateSurfArgs("extract", ["https://example.com/"]),
    /one of --file or --code is required/,
  );
  assert.throws(
    () => translateSurfArgs("extract", ["--code", "return []"]),
    /a URL is required unless --tab-id or --session/,
  );
  assert.throws(() => translateSurfArgs("wait", ["-5"]), /duration must not be negative/);
  assert.throws(() => translateSurfArgs("gemini", ["hi"]), /Unsupported surf command mapping/);
});

test("surf error parsing reads the JSON error object and the [code] suffix", () => {
  const fromJson = parseSurfErrorOutput(
    JSON.stringify({
      error: {
        code: "page_login",
        message: "Page is not ready: login at https://github.com/login",
        details: { state: "login", evidence: ["1 visible password field(s)"] },
      },
    }),
    "Error: Page is not ready: login at https://github.com/login [page_login]",
    1,
    ["surf", "wait.ready"],
  );
  assert.equal(fromJson.code, "page_login");
  assert.equal(fromJson.message, "Page is not ready: login at https://github.com/login");
  assert.deepEqual(fromJson.details, { state: "login", evidence: ["1 visible password field(s)"] });

  const fromSuffix = parseSurfErrorOutput(
    "",
    "Error: Timed out after 20000ms waiting for a ready page [page_timeout]\nRecovery: pass --timeout",
    1,
    ["surf", "wait.ready"],
  );
  assert.equal(fromSuffix.code, "page_timeout");
  assert.equal(fromSuffix.message, "Timed out after 20000ms waiting for a ready page");

  const fromPlainError = parseSurfErrorOutput("", "Error: Request timed out (60s)", 1, ["surf"]);
  assert.equal(fromPlainError.code, "error");
  assert.equal(fromPlainError.message, "Request timed out (60s)");

  const fallback = parseSurfErrorOutput("", "surf exploded", 9, ["surf", "tab.new"]);
  assert.equal(fallback.code, "error");
  assert.equal(fallback.message, "surf exploded");

  const silent = parseSurfErrorOutput("", "", 2, ["/usr/bin/surf", "tab.new"]);
  assert.equal(silent.message, "/usr/bin/surf tab.new exited with code 2");
});

test("surf JSON parsing unwraps the explicit-target envelope and tolerates warning prefixes", () => {
  const wrapped = parseSurfJsonOutput(
    JSON.stringify({
      result: { state: "ready", evidence: [] },
      target: { tabId: 7, windowId: 1 },
      notice: null,
    }),
    "wait.ready",
  );
  assert.deepEqual(wrapped.data, { state: "ready", evidence: [] });
  assert.deepEqual(wrapped.target, { tabId: 7, windowId: 1 });

  const bare = parseSurfJsonOutput(
    'warning: devtools reconnecting\n{"modals":[],"loading":false}',
    "page.state",
  );
  assert.deepEqual(bare.data, { modals: [], loading: false });

  const keepsResultKeyPayloads = parseSurfJsonOutput(JSON.stringify({ result: 1, other: 2 }), "js");
  assert.deepEqual(keepsResultKeyPayloads.data, { result: 1, other: 2 });

  assert.throws(
    () => parseSurfJsonOutput("", "network"),
    /returned empty output where JSON was expected/,
  );
  assert.throws(
    () => parseSurfJsonOutput("warning: capture disabled", "network"),
    /Invalid JSON output from surf network: warning: capture disabled/,
  );
});

test("parseCreatedTabId reads the tab.new text reply in every mode", () => {
  assert.equal(parseCreatedTabId("Created tab 1555385315: https://example.com/"), 1555385315);
  assert.equal(parseCreatedTabId(JSON.stringify("Created tab 42: https://example.com/")), 42);
  assert.equal(parseCreatedTabId(JSON.stringify({ tabId: 9, url: "https://example.com/" })), 9);
  assert.equal(parseCreatedTabId("Opened something else"), undefined);
  assert.equal(parseCreatedTabId(""), undefined);
});

test("resolveSurfRuntimeCommand composes the resolved binary with the mapped argv", () => {
  const tmp = withTempDir();
  try {
    const surf = path.join(tmp.dir, "surf");
    executable(surf);

    const runtime = resolveSurfRuntimeCommand("go", ["https://example.com"], {
      ...isolatedEnv(tmp.dir),
      TEST_CAPABILITIES_SURF_BIN: surf,
    });

    assert.equal(runtime.command, surf);
    assert.equal(runtime.flavor, "surf");
    assert.equal(runtime.provider, "explicit_bin");
    assert.deepEqual(runtime.args, ["navigate", "https://example.com"]);
    assert.deepEqual(runtime.commandDisplay, [surf, "navigate", "https://example.com"]);
  } finally {
    tmp.cleanup();
  }
});
