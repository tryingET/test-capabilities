import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { createFakeSurf, readyPages } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { assertAdapterInvocation, assertRawResult, invokeAdapter } =
  await importRuntimeModule("core/adapter.js");
const { appendCappedOutput, DEFAULT_MAX_OUTPUT_CHARS, spawnStep, spawnStepSync } =
  await importRuntimeModule("core/spawn-step.js");
const { cliAdapter, parseCommandLine } = await importRuntimeModule("core/cli-adapter.js");
const { resetSurfRuntimeProbeCache, surfAdapter, surfEffect } =
  await importRuntimeModule("core/surf-adapter.js");
const { bombadilAdapter } = await importRuntimeModule("core/bombadil-runtime.js");
const { isTransientCode, TRANSIENT_CODES } = await importRuntimeModule(
  "core/result-classification.js",
);

function tempDir(label) {
  return mkdtempSync(path.join(os.tmpdir(), `test-capabilities-kernel-${label}-`));
}

function writeScript(filePath, script) {
  writeFileSync(filePath, script, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

test("the spawn transport reports a completed process as a RawResult", async () => {
  const dir = tempDir("ok");
  const script = writeScript(
    path.join(dir, "ok.sh"),
    "#!/bin/sh\necho 'payload'\necho 'diagnostics' >&2\nexit 0\n",
  );

  try {
    const raw = await spawnStep({ source: "cli", command: script, args: [], timeoutMs: 5_000 });
    assert.equal(raw.source, "cli");
    assert.equal(raw.exitCode, 0);
    assert.equal(raw.signal, null);
    assert.equal(raw.stdout.trim(), "payload");
    assert.equal(raw.stderr.trim(), "diagnostics");
    assert.equal(raw.timedOut, false);
    assert.equal(raw.spawnFailure, undefined);
    assert.equal(typeof raw.durationMs, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the spawn transport reports a non-zero exit without throwing", async () => {
  const dir = tempDir("exit");
  const script = writeScript(path.join(dir, "fail.sh"), "#!/bin/sh\necho 'boom' >&2\nexit 7\n");

  try {
    const raw = await spawnStep({ source: "cli", command: script, args: [], timeoutMs: 5_000 });
    assert.equal(raw.exitCode, 7);
    assert.equal(raw.stderr.trim(), "boom");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the spawn transport reports a process that cannot start as a spawn failure", async () => {
  const raw = await spawnStep({
    source: "cli",
    command: "definitely-missing-test-capabilities-binary",
    args: ["--help"],
    timeoutMs: 5_000,
  });

  assert.equal(raw.exitCode, null);
  assert.equal(typeof raw.spawnFailure, "string");
  assert.match(raw.spawnFailure, /ENOENT/);
});

test("the spawn transport kills the process tree at the budget and escalates to SIGKILL", async () => {
  const dir = tempDir("timeout");
  const script = writeScript(
    path.join(dir, "hang.sh"),
    "#!/bin/sh\ntrap '' TERM\necho 'started' >&2\nsleep 30\n",
  );

  try {
    const startedAt = Date.now();
    const raw = await spawnStep({ source: "cli", command: script, args: [], timeoutMs: 150 });
    assert.equal(raw.timedOut, true);
    assert.equal(raw.stderr.trim(), "started");
    assert.equal(raw.exitCode === null || raw.exitCode !== 0, true);
    // SIGTERM is ignored, so the force kill after the grace period is what ends it.
    assert.equal(Date.now() - startedAt >= 150, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the spawn transport caps the output it keeps", async () => {
  const dir = tempDir("cap");
  const script = writeScript(
    path.join(dir, "noisy.sh"),
    "#!/bin/sh\ni=0\nwhile [ $i -lt 200 ]; do echo '0123456789'; i=$((i+1)); done\n",
  );

  try {
    const raw = await spawnStep({
      source: "cli",
      command: script,
      args: [],
      timeoutMs: 5_000,
      maxOutputChars: 100,
    });
    assert.equal(
      raw.stdout.length <= 100 + "\n[output truncated after 100 characters]".length,
      true,
    );
    assert.match(raw.stdout, /\[output truncated after 100 characters\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendCappedOutput marks the cut once and then keeps nothing", () => {
  assert.equal(appendCappedOutput("", "abc", 10), "abc");
  assert.equal(appendCappedOutput("abcdefghij", "more", 10), "abcdefghij");
  assert.match(appendCappedOutput("abcdefgh", "ijkl", 10), /^abcdefghij\n\[output truncated/);
  assert.equal(DEFAULT_MAX_OUTPUT_CHARS, 64_000);
});

test("the synchronous transport answers with the same RawResult shape", () => {
  const dir = tempDir("sync");
  const script = writeScript(path.join(dir, "sync.sh"), "#!/bin/sh\necho 'sync-payload'\nexit 0\n");

  try {
    const raw = spawnStepSync({ source: "surf", command: script, args: [], timeoutMs: 5_000 });
    assert.equal(raw.source, "surf");
    assert.equal(raw.exitCode, 0);
    assert.equal(raw.stdout.trim(), "sync-payload");
    assert.equal(raw.timedOut, false);

    const missing = spawnStepSync({
      source: "surf",
      command: path.join(dir, "not-there.sh"),
      args: [],
      timeoutMs: 5_000,
    });
    assert.equal(missing.exitCode, null);
    assert.match(missing.spawnFailure, /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the synchronous transport reports its own timeout as timedOut, not as a spawn failure", () => {
  const dir = tempDir("sync-timeout");
  const script = writeScript(path.join(dir, "hang.sh"), "#!/bin/sh\nsleep 30\n");

  try {
    const raw = spawnStepSync({ source: "surf", command: script, args: [], timeoutMs: 150 });
    assert.equal(raw.timedOut, true);
    assert.equal(raw.spawnFailure, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the transport refuses a step without a command or a budget", async () => {
  await assert.rejects(
    async () => spawnStep({ source: "cli", command: "  ", args: [], timeoutMs: 10 }),
    /non-empty command/,
  );
  assert.throws(
    () => spawnStepSync({ source: "cli", command: "node", args: [], timeoutMs: 0 }),
    /positive timeout budget/,
  );
});

test("the boundary refuses an invocation an adapter did not translate properly", () => {
  assert.throws(
    () => assertAdapterInvocation({ command: "", args: [], timeoutMs: 1 }, "cli"),
    /without a command/,
  );
  assert.throws(
    () => assertAdapterInvocation({ command: "node", args: "--help", timeoutMs: 1 }, "cli"),
    /without an argv list/,
  );
  assert.throws(
    () => assertAdapterInvocation({ command: "node", args: [], timeoutMs: 0 }, "cli"),
    /positive timeout budget/,
  );
  assert.doesNotThrow(() =>
    assertAdapterInvocation({ command: "node", args: [], timeoutMs: 1 }, "cli"),
  );
});

test("the boundary refuses a transport reply that is not a RawResult", () => {
  assert.throws(() => assertRawResult(undefined, "surf"), /not a RawResult/);
  assert.throws(() => assertRawResult({ source: "surf" }, "surf"), /not a RawResult/);
  assert.throws(
    () => assertRawResult({ source: "surf", stdout: "", stderr: "", exitCode: "0" }, "surf"),
    /not a RawResult/,
  );
  assert.doesNotThrow(() =>
    assertRawResult({ source: "surf", stdout: "", stderr: "", exitCode: null }, "surf"),
  );
});

test("invokeAdapter composes resolve, translate, effects and invoke exactly once", async () => {
  const calls = [];
  const fakeAdapter = {
    id: "cli",
    resolve(env) {
      calls.push(`resolve:${env?.MARKER ?? "none"}`);
      return { marker: env?.MARKER ?? "none" };
    },
    probe() {
      calls.push("probe");
      return { probed: true };
    },
    translate(step, resolution) {
      calls.push(`translate:${step.command}:${resolution.marker}`);
      return {
        source: "cli",
        command: "node",
        args: ["--version"],
        timeoutMs: 5_000,
        display: ["node", "--version"],
      };
    },
    effects() {
      calls.push("effects");
      return { effect: "read_only", reason: "test double" };
    },
    invoke(invocation) {
      calls.push(`invoke:${invocation.display.join(" ")}`);
      return Promise.resolve({
        source: "cli",
        exitCode: 0,
        signal: null,
        stdout: "v1",
        stderr: "",
      });
    },
  };

  const outcome = await invokeAdapter(
    fakeAdapter,
    { id: "t", command: "version" },
    {
      env: { MARKER: "m" },
    },
  );

  assert.deepEqual(calls, ["resolve:m", "translate:version:m", "effects", "invoke:node --version"]);
  assert.equal(outcome.raw.stdout, "v1");
  assert.deepEqual(outcome.effect, { effect: "read_only", reason: "test double" });
  assert.deepEqual(outcome.resolution, { marker: "m" });
  assert.deepEqual(outcome.invocation.args, ["--version"]);
});

test("invokeAdapter refuses an adapter whose invoke answers with the wrong shape", async () => {
  const brokenAdapter = {
    id: "surf",
    resolve: () => ({}),
    probe: () => ({}),
    translate: () => ({
      source: "surf",
      command: "surf",
      args: [],
      timeoutMs: 10,
      display: ["surf"],
    }),
    effects: () => ({ effect: "read_only", reason: "test double" }),
    invoke: () => Promise.resolve({ ok: true }),
  };

  await assert.rejects(
    async () => invokeAdapter(brokenAdapter, { id: "t", command: "noop" }),
    /not a RawResult/,
  );
});

test("the cli adapter resolves, probes honestly, translates and declares its effect", async () => {
  const resolution = cliAdapter.resolve({ MARKER: "cli" });
  assert.equal(resolution.env.MARKER, "cli");
  assert.equal(cliAdapter.resolve().env, process.env);

  const probe = cliAdapter.probe(resolution);
  assert.equal(probe.versionProbed, false);
  assert.equal(probe.notes.length, 1);

  const invocation = cliAdapter.translate(
    { id: "s", command: '"/tmp/my tools/fake cli.sh" --flag', args: ["--help"], timeoutMs: 42 },
    resolution,
  );
  assert.equal(invocation.source, "cli");
  assert.equal(invocation.command, "/tmp/my tools/fake cli.sh");
  assert.deepEqual(invocation.args, ["--flag", "--help"]);
  assert.equal(invocation.timeoutMs, 42);
  assert.deepEqual(invocation.display, ["/tmp/my tools/fake cli.sh", "--flag", "--help"]);

  const defaults = cliAdapter.translate({ id: "s", command: "node" }, resolution);
  assert.equal(defaults.timeoutMs, 10_000);
  assert.deepEqual(defaults.args, []);

  assert.deepEqual(cliAdapter.effects({ id: "s", command: "node" }), {
    effect: "read_only",
    reason: "runs the configured command with --help only; assumed read-only, not verified",
  });

  const raw = await cliAdapter.invoke(
    cliAdapter.translate({ id: "s", command: process.execPath, args: ["--version"] }, resolution),
  );
  assert.equal(raw.exitCode, 0);
  assert.match(raw.stdout.trim(), /^v\d+\./);
});

test("parseCommandLine keeps quoted paths and refuses broken command lines", () => {
  assert.deepEqual(parseCommandLine("node --version"), {
    command: "node",
    args: ["--version"],
  });
  assert.deepEqual(parseCommandLine(`'/tmp/a b/cli' -x`), {
    command: "/tmp/a b/cli",
    args: ["-x"],
  });
  assert.deepEqual(parseCommandLine("cli a\\ b"), { command: "cli", args: ["a b"] });
  assert.deepEqual(parseCommandLine("cli trailing\\"), { command: "cli", args: ["trailing\\"] });
  assert.throws(() => parseCommandLine('node "--version'), /Unterminated quote/);
  assert.throws(() => parseCommandLine("   "), /CLI target command is empty/);
});

test("the surf effect map classifies reads, session steps, target mutations and the unknown", () => {
  assert.deepEqual(surfEffect("extract"), {
    effect: "read_only",
    reason: "surf extract reads the page without acting on it",
  });
  assert.equal(surfEffect("wait.ready").effect, "read_only");
  assert.equal(surfEffect("frame.diagnose").effect, "read_only");
  assert.deepEqual(surfEffect("tab.new"), {
    effect: "mutating",
    scope: "browser_session",
    reason: "surf tab.new changes the runtime's own browser session, not the target",
  });
  assert.equal(surfEffect("tab.close").scope, "browser_session");
  assert.deepEqual(surfEffect("click"), {
    effect: "mutating",
    scope: "target",
    reason: "surf click acts on the target page",
  });
  assert.equal(surfEffect("tab.reload").scope, "target");
  // `js` is deliberately unclassified: the caller declares an effect for page-side script.
  assert.equal(surfEffect("js").effect, "unclassified");
  assert.equal(surfEffect("some.future.verb").effect, "unclassified");
});

test("the surf adapter resolves, probes, translates and invokes through the one transport", async () => {
  const fake = createFakeSurf({
    pages: readyPages({ "https://example.com/": { links: [] } }),
  });
  resetSurfRuntimeProbeCache();

  try {
    const resolution = surfAdapter.resolve({ TEST_CAPABILITIES_SURF_BIN: fake.path });
    assert.equal(resolution.command, fake.path);
    assert.equal(resolution.flavor, "surf");

    const probe = surfAdapter.probe(resolution);
    assert.equal(probe.version, "2.18.0");
    assert.equal(probe.mechanisms.waitReady, true);

    const step = { id: "s", command: "tab.new", args: ["https://example.com/"], timeoutMs: 5_000 };
    const invocation = surfAdapter.translate(step, resolution);
    assert.equal(invocation.source, "surf");
    assert.equal(invocation.command, fake.path);
    assert.deepEqual(invocation.args, ["tab.new", "https://example.com/"]);
    assert.equal(invocation.timeoutMs, 5_000);

    assert.deepEqual(surfAdapter.effects(step), {
      effect: "mutating",
      scope: "browser_session",
      reason: "surf tab.new changes the runtime's own browser session, not the target",
    });

    const raw = await surfAdapter.invoke(invocation);
    assert.equal(raw.source, "surf");
    assert.equal(raw.exitCode, 0);
    assert.match(raw.stdout, /^Created tab \d+: https:\/\/example\.com\//m);
  } finally {
    resetSurfRuntimeProbeCache();
    fake.cleanup();
  }
});

test("the bombadil adapter declares a mutating target effect and translates through its resolution", () => {
  const dir = tempDir("bombadil-adapter");
  const binary = writeScript(path.join(dir, "bombadil"), "#!/bin/sh\nexit 0\n");

  try {
    const resolution = bombadilAdapter.resolve({ TEST_CAPABILITIES_BOMBADIL_BIN: binary });
    assert.equal(resolution.binaryPath, binary);

    const probe = bombadilAdapter.probe(resolution);
    assert.equal(probe.versionProbed, false);
    assert.equal(probe.binaryPath, binary);

    const invocation = bombadilAdapter.translate(
      { id: "s", command: "test", args: ["test", "--headless", "https://example.com"] },
      resolution,
    );
    assert.equal(invocation.command, binary);
    assert.deepEqual(invocation.args, ["test", "--headless", "https://example.com"]);
    assert.equal(invocation.timeoutMs, 10_000);

    assert.deepEqual(bombadilAdapter.effects({ id: "s", command: "test" }), {
      effect: "mutating",
      scope: "target",
      reason: "bounded fuzz against the configured web origin",
    });
    assert.equal(
      bombadilAdapter.effects({ id: "s", command: "terminal" }).reason,
      "bounded terminal fuzz against the configured command",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the transient code list is the one the retry policy reads", () => {
  assert.deepEqual(
    [...TRANSIENT_CODES],
    ["timeout", "spawn_failed", "browser_error", "page_timeout"],
  );
  assert.equal(isTransientCode("timeout"), true);
  assert.equal(isTransientCode("page_login"), false);
});
