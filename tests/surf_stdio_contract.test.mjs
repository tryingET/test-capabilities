import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createFakeSurf, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule, runtimeModuleUrl } from "./helpers/runtime-dist.mjs";

/**
 * `surf --stdio` as a session's transport (AK #6221, #6222): when surf's help lists it, every
 * surf command of a SurfSession goes through one long-lived surf process, and each answer is the
 * same raw result a spawned surf returns. A command the session refuses runs as its own process;
 * a session that never became ready leaves everything to processes; one that ends while a command
 * runs leaves that command in doubt and terminalizes the owning session (AK #6545).
 */

const { executeCliOperation } = await importRuntimeModule("core/operations.js");
const { resetSurfRuntimeProbeCache } = await importRuntimeModule("core/surf-adapter.js");

const FORM = "https://shop.example/pay";
const FORM_MODEL = {
  title: "Pay",
  fields: {
    "#card": { value: "", name: "card", label: "Card number", form: "#pay-form" },
    "#country": {
      kind: "select",
      value: "de",
      name: "country",
      label: "Country",
      form: "#pay-form",
    },
  },
  controls: [{ selector: "#pay", kind: "submit", text: "Pay", form: "#pay-form" }],
};
const FIELDS = ["label:Card number=4242", "label:Country=fr"];

function writeConfig(dir) {
  const file = path.join(dir, "tc.yaml");
  writeFileSync(
    file,
    [
      "receipts:",
      `  dir: ${path.join(dir, "receipts")}`,
      "  ephemeral: true",
      "mutation:",
      "  allow_origins:",
      '    - "https://shop.example"',
      "",
    ].join("\n"),
  );
  return file;
}

function receiptsIn(dir) {
  const root = path.join(dir, "receipts");
  let runs;
  try {
    runs = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return runs
    .filter((entry) => entry.isDirectory())
    .flatMap((run) =>
      readdirSync(path.join(root, run.name))
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => JSON.parse(readFileSync(path.join(root, run.name, entry), "utf-8"))),
    )
    .filter((artifact) => artifact.artifact_kind === "test-capabilities.mutation.receipt");
}

/** Fake surf with the form, and no DevTools endpoint: every step runs on surf. */
async function withFakes(body, surfOptions = {}) {
  resetSurfRuntimeProbeCache();
  const surf = createFakeSurf({
    pages: { [FORM]: { ...structuredClone(FORM_MODEL), readiness: "ready", links: [] } },
    ...surfOptions,
  });
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-stdio-"));
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  process.env.TEST_CAPABILITIES_CDP_ENDPOINT = "http://127.0.0.1:1";
  try {
    await withFakeSurfEnv(surf.path, async () => {
      await body({ surf, dir, out: path.join(dir, "plan.json"), config: writeConfig(dir) });
    });
  } finally {
    if (previous === undefined) delete process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
    else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = previous;
    surf.cleanup();
    rmSync(dir, { recursive: true, force: true });
    resetSurfRuntimeProbeCache();
  }
}

const plan = (input) => executeCliOperation({ command: "surf", action: "plan" }, input);
const apply = (input) => executeCliOperation({ command: "surf", action: "apply" }, input);
const planContent = (out) => {
  const { plan_id, generated_at, approval_token, ...content } = JSON.parse(
    readFileSync(out, "utf-8"),
  );
  return content;
};
const commandsOf = (calls) => calls.map((call) => call[0]);

test("a run's surf commands go through one surf --stdio process, and plan the same", async () => {
  let asProcesses;
  await withFakes(async ({ surf, out, config }) => {
    await plan({ url: FORM, field: FIELDS, out, config });
    asProcesses = planContent(out);
    assert.equal(commandsOf(surf.calls()).includes("--stdio"), false);
  });
  await withFakes(
    async ({ surf, out, config }) => {
      const envelope = await plan({ url: FORM, field: FIELDS, out, config });
      assert.deepEqual(planContent(out), asProcesses, "the same page read either way");
      assert.equal(
        commandsOf(surf.calls()).filter((command) => command === "--stdio").length,
        1,
        "one session process",
      );
      assert.deepEqual(commandsOf(surf.stdioCalls()), ["tab.new", "wait.ready", "js", "tab.close"]);
      // the runtime probe stays a process of its own; the session was closed and ended
      assert.equal(commandsOf(surf.calls())[0], "--help-full");
      assert.equal(commandsOf(surf.calls()).at(-1), "--stdio:end");
      assert.equal(
        envelope.notes.some((note) => /surf --stdio/.test(note)),
        false,
        "the session ran to the end",
      );
    },
    { stdio: true },
  );
});

test("an apply through the session sets, reads back and receipts the same as through processes", async () => {
  const run = async (surfOptions) => {
    let seen;
    await withFakes(async ({ surf, dir, out, config }) => {
      await plan({ url: FORM, field: FIELDS, out, config });
      const envelope = await apply({ plan: out, config });
      seen = {
        fields: envelope.result.fields.map((field) => [field.id, field.matched]),
        receipts: receiptsIn(dir)
          .map((receipt) => [receipt.intent, receipt.outcome])
          .sort(),
        stdio: commandsOf(surf.stdioCalls()),
      };
    }, surfOptions);
    return seen;
  };
  const viaProcesses = await run({});
  const viaStdio = await run({ stdio: true });
  assert.deepEqual(viaStdio.fields, viaProcesses.fields);
  assert.deepEqual(viaStdio.receipts, viaProcesses.receipts);
  assert.ok(viaStdio.stdio.includes("type") && viaStdio.stdio.includes("select"));
});

test("a command the session refuses runs as its own surf process", async () => {
  await withFakes(
    async ({ surf, out, config }) => {
      await plan({ url: FORM, field: FIELDS, out, config });
      assert.ok(commandsOf(surf.stdioCalls()).includes("wait.ready"), "the session was asked");
      assert.equal(
        commandsOf(surf.calls()).filter((command) => command === "wait.ready").length,
        1,
        "and it ran once, as a process",
      );
    },
    { stdio: true, stdioRefuse: "wait.ready" },
  );
});

test("a session that ends before it is ready leaves every command to processes, and says so", async () => {
  await withFakes(
    async ({ surf, out, config }) => {
      const envelope = await plan({ url: FORM, field: FIELDS, out, config });
      assert.equal(envelope.result.channel, "surf");
      assert.deepEqual(surf.stdioCalls(), []);
      assert.ok(commandsOf(surf.calls()).includes("tab.close"));
      assert.ok(envelope.notes.some((note) => /surf --stdio ended early \(it exited/.test(note)));
    },
    { stdio: "broken" },
  );
});

for (const [label, knob, expected] of [
  ["dies while a command runs", { stdioDieOn: "type" }, /signal_SESSION_EXIT/],
  ["answers a command as timed out", { stdioTimeoutOn: "type" }, /timed out|timeout/],
]) {
  test(`a session that ${label} leaves that command in doubt, never closes a stale tab`, async () => {
    await withFakes(
      async ({ surf, dir, out, config }) => {
        await plan({ url: FORM, field: FIELDS, out, config });
        const callsBefore = surf.calls().length;
        const sentBefore = surf.stdioCalls().length;
        await assert.rejects(apply({ plan: out, config }), (error) => {
          assert.equal(error.code, "mutation_outcome_unknown");
          assert.match(`${error.message} ${JSON.stringify(receiptsIn(dir))}`, expected);
          return true;
        });
        // the fill in flight when the session went is the one receipt in doubt
        assert.deepEqual(
          receiptsIn(dir).map((receipt) => receipt.outcome),
          ["unknown"],
        );
        // Lost ownership must not close a tab id another browser may have reused.
        assert.equal(commandsOf(surf.calls().slice(callsBefore)).includes("tab.close"), false);
        assert.equal(commandsOf(surf.stdioCalls().slice(sentBefore)).includes("tab.close"), false);
      },
      { stdio: true, ...knob },
    );
  });
}

test("a session that does not answer is given up past the command's budget: that command timed out", async () => {
  const { startSurfStdio } = await importRuntimeModule("core/surf-adapter.js");
  const surf = createFakeSurf({ stdio: true, stdioSilentOn: "tab.list" });
  try {
    const stdio = startSurfStdio({ command: surf.path, baseArgs: [] });
    const started = Date.now();
    const answer = await stdio.run(["tab.list", "--json"], 100);
    assert.equal(answer.raw.timedOut, true);
    assert.equal(answer.raw.exitCode, null);
    assert.ok(Date.now() - started >= 2000, "the budget and its grace");
    assert.match(stdio.endedEarly(), /did not answer within 2100 ms/);
    // a session given up is not asked again: the next command runs as its own process
    assert.deepEqual(await stdio.run(["tab.list"], 100), { refused: true });
    await stdio.close();
  } finally {
    surf.cleanup();
  }
});

test("an idle session keeps nothing alive: a process that never closes it still ends", async () => {
  const surf = createFakeSurf({ stdio: true });
  const script = `
    const { startSurfStdio } = await import(${JSON.stringify(runtimeModuleUrl("core/surf-adapter.js"))});
    const stdio = startSurfStdio({ command: ${JSON.stringify(surf.path)}, baseArgs: [] });
    // a budget past this test's bound: nothing of it - the wait for ready, the command's own
    // wait for its answer - may outlast the answer
    const answer = await stdio.run(["--version"], 20000);
    console.log(answer.raw.stdout.trim());
  `;
  try {
    const started = Date.now();
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf-8",
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "surf version 2.18.0");
    assert.ok(Date.now() - started < 10_000, "it ended without closing the session");
  } finally {
    surf.cleanup();
  }
});

test("a session that never started keeps nothing alive either", async () => {
  const script = `
    const { startSurfStdio } = await import(${JSON.stringify(runtimeModuleUrl("core/surf-adapter.js"))});
    const stdio = startSurfStdio({ command: "/nonexistent/surf", baseArgs: [] });
    // its wait for ready would outlast this test's bound: it ends when the session does
    console.log(JSON.stringify(await stdio.run(["tab.list"], 20000)));
  `;
  const started = Date.now();
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '{"refused":true}');
  assert.ok(Date.now() - started < 10_000, "nothing of the session outlived it");
});

test("a session whose tab never opened still ends its surf --stdio process", async () => {
  await withFakes(
    async ({ surf, out, config }) => {
      await assert.rejects(plan({ url: FORM, field: FIELDS, out, config }));
      assert.deepEqual(commandsOf(surf.stdioCalls()), ["tab.new"]);
      assert.equal(commandsOf(surf.calls()).at(-1), "--stdio:end");
    },
    { stdio: true, failOn: "tab.new" },
  );
});

test("a session that cannot start runs nothing: every command goes to its own process", async () => {
  const { startSurfStdio } = await importRuntimeModule("core/surf-adapter.js");
  const stdio = startSurfStdio({ command: "/nonexistent/surf", baseArgs: [] });
  assert.deepEqual(await stdio.run(["tab.list"], 1000), { refused: true });
  assert.match(stdio.endedEarly(), /it did not start \(spawn \/nonexistent\/surf ENOENT\)/);
  await stdio.close();
});

test("a line on the session's stdout that is no reply is ignored", async () => {
  const { startSurfStdio } = await importRuntimeModule("core/surf-adapter.js");
  const surf = createFakeSurf({ stdio: true, stdioNoise: true });
  try {
    const stdio = startSurfStdio({ command: surf.path, baseArgs: [] });
    const answer = await stdio.run(["--version"], 5000);
    assert.equal(answer.raw.stdout, "surf version 2.18.0\n");
    assert.equal(answer.raw.exitCode, 0);
    await stdio.close();
    assert.equal(stdio.endedEarly(), undefined);
  } finally {
    surf.cleanup();
  }
});

test("what a session printed before it died is the in-doubt command's stderr", async () => {
  const { startSurfStdio } = await importRuntimeModule("core/surf-adapter.js");
  const surf = createFakeSurf({ stdio: true, stdioDieOn: "tab.list" });
  try {
    const stdio = startSurfStdio({ command: surf.path, baseArgs: [] });
    const answer = await stdio.run(["tab.list"], 5000);
    assert.equal(answer.raw.exitCode, null);
    assert.equal(answer.raw.signal, "SESSION_EXIT");
    assert.match(
      answer.raw.stderr,
      /surf --stdio ended while this command ran: it exited \(code 137\)/,
    );
    assert.match(answer.raw.stderr, /session crashed/);
    await stdio.close();
  } finally {
    surf.cleanup();
  }
});

/**
 * A `surf --stdio` child in memory: what the client writes, what signals it sends, and a hand
 * to answer with - for what a real session cannot be made to do on cue.
 */
function childDouble({ ready = true, obeys = true } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  for (const pipe of [child.stdin, child.stdout, child.stderr]) {
    pipe.ref = () => {};
    pipe.unref = () => {};
  }
  child.signals = [];
  child.sent = [];
  child.ref = () => {};
  child.unref = () => {};
  let pending = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => {
    pending += chunk;
    for (let at = pending.indexOf("\n"); at >= 0; at = pending.indexOf("\n")) {
      child.sent.push(JSON.parse(pending.slice(0, at)));
      pending = pending.slice(at + 1);
    }
  });
  // as Node reports a child: its exit, then - its pipes drained - its close
  child.exit = (code, signal = null) => {
    child.emit("exit", code, signal);
    setImmediate(() => child.emit("close", code, signal));
  };
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGKILL" || obeys) setImmediate(() => child.exit(null, signal));
    return true;
  };
  child.answer = (reply) => child.stdout.write(`${JSON.stringify(reply)}\n`);
  if (ready) setImmediate(() => child.answer({ id: null, ready: true }));
  return child;
}
const settledSoon = async (promise, ms = 50) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("pending"), ms))]);

for (const exit of [0, 2]) {
  test(`repair: sent timeout remains loss when SIGTERM is handled with exit ${exit}`, async () => {
    const { runSurfCommand } = await importRuntimeModule("core/surf-adapter.js");
    const { spawnStepSync } = await importRuntimeModule("core/spawn-step.js");
    const { surfTransportLost } = await importRuntimeModule("core/surf-session-interruption.js");
    const script = `process.on("SIGTERM", () => process.exit(${exit})); setInterval(() => {}, 1000);`;
    const input = {
      command: process.execPath,
      args: ["-e", script],
      source: "surf",
      timeoutMs: 300,
    };
    const native = spawnSync(input.command, input.args, { encoding: "utf8", timeout: 300 });
    assert.equal(native.error?.code, "ETIMEDOUT");
    assert.equal(native.status, exit, "SIGTERM handler actually ran");
    assert.equal(native.signal, null);
    const raw = spawnStepSync(input);
    assert.equal(raw.exitCode, null, "handled timeout is not a complete answer");
    assert.equal(raw.timedOut, true);
    assert.equal(raw.spawnFailure, undefined);
    for (const effect of ["read_only", "mutating"]) {
      const result = runSurfCommand({ command: input.command, baseArgs: input.args }, [], {
        effect,
        timeoutMs: 300,
      });
      assert.equal(result.ok, false);
      assert.equal(result.failure.code, "timeout");
      assert.equal(surfTransportLost(result), true);
      if (effect === "mutating") assert.equal(result.outcome.basis, "indeterminate");
    }
  });
}

for (const exit of [0, 2]) {
  test(`repair: ENOBUFS remains sent loss when SIGTERM is handled with exit ${exit}`, async () => {
    const { runSurfCommand } = await importRuntimeModule("core/surf-adapter.js");
    const { spawnStepSync } = await importRuntimeModule("core/spawn-step.js");
    const { surfTransportLost } = await importRuntimeModule("core/surf-session-interruption.js");
    // Register the handler before flooding. Async writes allow the buffer-kill
    // signal to be handled, followed by an ordinary exit status.
    // The parent may close the pipe while sending SIGTERM; prevent an EPIPE
    // exception from racing the handler this fixture is specifically exercising.
    const script = `process.stdout.on("error", () => {});
      process.on("SIGTERM", () => process.exit(${exit}));
      setInterval(() => process.stdout.write("x".repeat(65536)), 1);`;
    const input = {
      command: process.execPath,
      args: ["-e", script],
      source: "surf",
      timeoutMs: 5000,
    };
    const native = spawnSync(input.command, input.args, { encoding: "utf8", timeout: 5000 });
    assert.equal(native.error?.code, "ENOBUFS", "actual buffer overflow, not timeout");
    assert.equal(native.status, exit, "SIGTERM handler actually ran");
    assert.equal(native.signal, null);
    const raw = spawnStepSync(input);
    assert.equal(raw.exitCode, null, "normal child exit cannot erase sent loss");
    assert.equal(raw.signal, "SIGTERM");
    assert.equal(raw.spawnFailure, undefined);
    for (const effect of ["read_only", "mutating"]) {
      const result = runSurfCommand({ command: input.command, baseArgs: input.args }, [], {
        effect,
        timeoutMs: 5000,
      });
      assert.equal(result.ok, false);
      assert.equal(result.failure.code, "signal_SIGTERM");
      assert.equal(surfTransportLost(result), true);
      if (effect === "mutating") assert.equal(result.outcome.basis, "indeterminate");
    }
  });
}

test("a session is sent one command at a time, each timed from when it was sent", async () => {
  const { SurfStdio } = await importRuntimeModule("core/surf-stdio.js");
  const child = childDouble();
  const stdio = SurfStdio.attach(child);
  const first = stdio.run(["tab.list"], 5000);
  // the session is ready and runs the first when the second is asked for
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(child.sent.length, 1);
  const second = stdio.run(["read"], 100);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(
    child.sent.map((request) => request.argv),
    [["tab.list"]],
    "the second waits for the first: surf runs them in order anyway",
  );
  // the first takes longer than the second's budget and grace: the second was not yet sent,
  // so its time had not started, and nothing is given up
  await new Promise((resolve) => setTimeout(resolve, 2300));
  child.answer({ id: child.sent[0].id, code: 0, stdout: "one\n", stderr: "" });
  assert.equal((await first).raw.stdout, "one\n");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(
    child.sent.map((request) => request.argv),
    [["tab.list"], ["read"]],
  );
  child.answer({ id: child.sent[1].id, code: 0, stdout: "two\n", stderr: "" });
  assert.equal((await second).raw.exitCode, 0);
  assert.deepEqual(child.signals, []);
  assert.equal(stdio.endedEarly(), undefined);
});

for (const [label, end] of [
  [
    "answers the running one as timed out",
    (child) =>
      child.answer({ id: child.sent[0].id, code: null, stdout: "", stderr: "", timedOut: true }),
  ],
  ["exits while the running one runs", (child) => child.exit(137)],
]) {
  test(`a session that ${label} never ran the waiting ones: they go to their own processes`, async () => {
    const { SurfStdio } = await importRuntimeModule("core/surf-stdio.js");
    const child = childDouble();
    const stdio = SurfStdio.attach(child);
    const running = stdio.run(["click", "#pay"], 5000);
    const waiting = stdio.run(["type", "x"], 5000);
    await new Promise((resolve) => setTimeout(resolve, 30));
    end(child);
    const inDoubt = await running;
    assert.equal(inDoubt.raw.exitCode, null, "the running one is in doubt");
    assert.deepEqual(await settledSoon(waiting), { refused: true });
    assert.deepEqual(
      child.sent.map((request) => request.argv),
      [["click", "#pay"]],
    );
    child.exit(124);
  });
}

test("what a session wrote before it exited is read before it counts as ended", async () => {
  const { SurfStdio } = await importRuntimeModule("core/surf-stdio.js");
  const child = childDouble();
  const stdio = SurfStdio.attach(child);
  const running = stdio.run(["tab.list"], 5000);
  await new Promise((resolve) => setTimeout(resolve, 30));
  // Node may report the exit before the pipe is drained of the last reply
  child.emit("exit", 124, null);
  child.answer({ id: child.sent[0].id, code: null, stdout: "", stderr: "", timedOut: true });
  setImmediate(() => child.emit("close", 124, null));
  const answer = await running;
  assert.equal(answer.raw.timedOut, true, "its own answer, not the exit's");
  assert.equal(answer.raw.signal, undefined);
});

test("a session whose pipes stay open after it exited is ended within its bound", async () => {
  const { SurfStdio } = await importRuntimeModule("core/surf-stdio.js");
  const child = childDouble();
  const stdio = SurfStdio.attach(child);
  const running = stdio.run(["tab.list"], 5000);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const started = Date.now();
  child.emit("exit", 137, null);
  const answer = await running;
  assert.equal(answer.raw.signal, "SESSION_EXIT");
  assert.ok(Date.now() - started < 3000);
});

test("a session not ready within the first command's budget was sent nothing: it runs as a process", async () => {
  const { SurfStdio } = await importRuntimeModule("core/surf-stdio.js");
  const child = childDouble({ ready: false });
  const stdio = SurfStdio.attach(child);
  const answer = await stdio.run(["click", "#pay"], 100);
  assert.deepEqual(answer, { refused: true });
  assert.deepEqual(child.sent, [], "nothing of ours reached it");
  assert.deepEqual(child.signals, ["SIGKILL"]);
  assert.match(stdio.endedEarly(), /was not ready within 2100 ms/);
});

test("a session that will not end when closed is ended", async () => {
  const { SurfStdio } = await importRuntimeModule("core/surf-stdio.js");
  const child = childDouble({ obeys: false });
  const stdio = SurfStdio.attach(child);
  await stdio.close();
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("a session's reply of any size is the result a spawned surf's output makes", async () => {
  const { runSurfCommand, runSurfCommandVia } = await importRuntimeModule("core/surf-adapter.js");
  // cut to the same length; and past spawnSync's buffer, stdout and stderr together, the same
  // failure: the command killed before it reported
  for (const [out, err] of [
    [70_000, 10],
    [1_048_576, 0],
    [524_288, 524_289],
    [1_200_000, 5],
  ]) {
    const script = `process.stdout.write("x".repeat(${out})); process.stderr.write("y".repeat(${err}))`;
    const resolution = { command: process.execPath, baseArgs: ["-e", script] };
    const stdio = {
      run: async () => ({
        raw: {
          source: "surf",
          exitCode: 0,
          stdout: "x".repeat(out),
          stderr: "y".repeat(err),
          durationMs: 1,
        },
      }),
    };
    // how long each took is the one thing that may differ
    const shape = ({ ok, code, stdout, stderr, failure, outcome }) =>
      JSON.parse(
        JSON.stringify({ ok, code, stdout, stderr, failure, outcome }).replace(
          /(durationMs\W*)\d+/g,
          (_, key) => `${key}0`,
        ),
      );
    for (const effect of ["read_only", "mutating"]) {
      assert.deepEqual(
        shape(await runSurfCommandVia(stdio, resolution, [], { effect })),
        shape(runSurfCommand(resolution, [], { effect })),
        `${out} + ${err} characters, ${effect}`,
      );
    }
  }
});

test("a command whose output passes spawnSync's buffer ends there in the session too, and the session ends", async () => {
  const { startSurfStdio, runSurfCommand, runSurfCommandVia } =
    await importRuntimeModule("core/surf-adapter.js");
  // it prints 2,000,000 characters and, 100 ms later, a diagnostic a spawn never reads
  const surf = createFakeSurf({ stdio: true, floodOn: "tab.list" });
  try {
    const resolution = { command: surf.path, baseArgs: [] };
    const shape = ({ ok, code, stdout, stderr, failure, outcome }) =>
      JSON.parse(
        JSON.stringify({ ok, code, stdout, stderr, failure, outcome }).replace(
          /(durationMs\W*)\d+/g,
          (_, key) => `${key}0`,
        ),
      );
    await withFakeSurfEnv(surf.path, async () => {
      const stdio = startSurfStdio(resolution);
      const viaSession = await runSurfCommandVia(stdio, resolution, ["tab.list"], {
        effect: "mutating",
      });
      const viaProcess = runSurfCommand(resolution, ["tab.list"], { effect: "mutating" });
      assert.equal(viaProcess.failure.code, "signal_SIGTERM");
      assert.doesNotMatch(viaSession.stderr, /late diagnostic/);
      assert.deepEqual(shape(viaSession), shape(viaProcess));
      assert.match(stdio.endedEarly(), /output passed/);
      assert.deepEqual(await stdio.run(["tab.list"], 1000), { refused: true });
      await stdio.close();
    });
  } finally {
    surf.cleanup();
  }
});

test(
  "repair: adapter overflow is sent loss while genuine startup failure stays unsent",
  { timeout: 10000 },
  async () => {
    const { runSurfCommand, runSurfCommandVia, startSurfStdio, settleSurfAttempt } =
      await importRuntimeModule("core/surf-adapter.js");
    const { surfTransportLost } = await importRuntimeModule("core/surf-session-interruption.js");
    const { SurfCommandError } = await importRuntimeModule("core/surf-runtime.js");
    const missing = { command: "/nonexistent/surf", baseArgs: [] };
    const stdio = startSurfStdio(missing);
    try {
      const startup = await runSurfCommandVia(stdio, missing, ["type", "x"], {
        effect: "mutating",
      });
      assert.equal(startup.failure.code, "spawn_failed");
      assert.equal(surfTransportLost(startup), false, "nothing was dispatched to a child");
      assert.equal(runSurfCommand(missing, ["type", "x"]).failure.code, "spawn_failed");
    } finally {
      await stdio.close();
    }
    const wholeReply = {
      run: async () => ({
        raw: {
          source: "surf",
          exitCode: 0,
          stdout: "x".repeat(1_200_000),
          stderr: "",
          durationMs: 1,
        },
      }),
    };
    const overflow = await runSurfCommandVia(wholeReply, missing, ["type", "x"], {
      effect: "mutating",
    });
    assert.equal(overflow.failure.code, "signal_SIGTERM");
    assert.equal(overflow.outcome.code, "signal_SIGTERM");
    assert.equal(overflow.outcome.basis, "indeterminate");
    assert.equal(surfTransportLost(overflow), true);
    assert.equal(
      settleSurfAttempt({ attempt: 1, error: new SurfCommandError(overflow) }).outcome,
      "unknown",
    );
  },
);
