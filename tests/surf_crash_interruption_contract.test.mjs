import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { createFakeSurf, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import {
  cdpTree,
  DONE,
  flowOf,
  MODEL,
  PAGE,
  receiptsIn,
  writeConfig,
} from "./helpers/flow-harness.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { SurfSession } = await importRuntimeModule("core/surf-session.js");
const { createRunContext } = await importRuntimeModule("core/run-context.js");
const { SESSION_LIFECYCLE_EFFECT } = await importRuntimeModule("core/browser-session.js");
const { bindsOverCdp, holdCdpActions, invalidateSessionCdp, releaseCdpActions, runStepInFrame } =
  await importRuntimeModule("core/cdp-step-transport.js");
const { CdpConnection } = await importRuntimeModule("core/a11y-cdp.js");
const { executeCliOperation } = await importRuntimeModule("core/operations.js");
const { flowApprovalToken, parseFlow } = await importRuntimeModule("core/flow-file.js");
const READ = { effect: "read_only", reason: "reads the page title" };
const READ_STEP = {
  id: "crash.read",
  command: "js",
  args: ["document.title"],
  intent: "read title",
  declare: READ,
  read: (reply) => reply.stdout,
};
const PLAN_REQUEST = {
  fields: [{ id: "card", locator: { kind: "selector", value: "#card" }, intendedValue: "4242" }],
  submitSelector: "#pay",
  channel: "cdp",
};
const commands = (surf) => surf.calls().map((call) => call[0]);
const reinit = { code: "surf_session_interrupted", message: /new.*session|reinitializ/i };

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), "condition became true within the fixture bound");
}

async function withFakes(body, surfOptions = {}, cdpOptions = {}) {
  const surf = createFakeSurf({
    stdio: true,
    pages: { [PAGE]: { ...structuredClone(MODEL), readiness: "ready", links: [] } },
    ...surfOptions,
  });
  const tree = cdpTree(PAGE);
  const pages = { P1: { url: PAGE, tree } };
  const cdp = await startFakeCdp({ pages, ...cdpOptions });
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-crash-"));
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  process.env.TEST_CAPABILITIES_CDP_ENDPOINT = cdp.url;
  const sessions = [];
  const originalOpen = SurfSession.prototype.open;
  SurfSession.prototype.open = async function () {
    if (!sessions.includes(this)) sessions.push(this);
    return originalOpen.call(this);
  };
  try {
    await withFakeSurfEnv(surf.path, async () => {
      const context = createRunContext({
        operationId: "surf.apply",
        effect: SESSION_LIFECYCLE_EFFECT,
        env: {
          ...process.env,
          TEST_CAPABILITIES_RECEIPTS_DIR: path.join(dir, "receipts"),
          TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
        },
        config: { mutation: { allowOrigins: ["https://shop.example"] } },
      });
      const makeSession = () => new SurfSession({ context, url: PAGE });
      await body({
        surf,
        cdp,
        tree,
        pages,
        dir,
        config: writeConfig(dir),
        context,
        sessions,
        makeSession,
      });
    });
  } finally {
    for (const session of sessions) {
      await releaseCdpActions(session);
      await session.close();
    }
    SurfSession.prototype.open = originalOpen;
    if (previous === undefined) delete process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
    else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = previous;
    await cdp.close();
    surf.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function assertTerminal(session, surf, cdp) {
  assert.equal(session.tab, undefined, "owned tab invalidated");
  assert.equal(session.readiness, undefined, "readiness invalidated");
  const before = {
    commands: commands(surf),
    sent: surf.stdioCalls(),
    methods: [...cdp.methods],
    requests: [...cdp.requests],
  };
  for (const call of [
    () => session.open(),
    () => session.gate(),
    () => session.step(READ_STEP),
    () => session.evaluate("document.title", READ),
    () => session.plan(PLAN_REQUEST),
    () => session.apply({ plan: undefined, mode: "fill" }),
    () => session.runObservers(),
    () => session.inFrame(1, async () => {}),
    () => session.explainUnreachable("#card"),
    () => holdCdpActions(session),
    () =>
      runStepInFrame(session, process.env, {
        command: "js",
        args: ["document.title"],
        frame: "main",
        effect: "read_only",
      }),
  ])
    await assert.rejects(call(), reinit);
  assert.throws(() => session.observe("later", { effect: READ, run: async () => {} }), reinit);
  assert.equal((await bindsOverCdp(session)).code, "surf_session_interrupted");
  await releaseCdpActions(session);
  await session.close();
  assert.deepEqual(
    commands(surf).filter((command) => command !== "--stdio:end"),
    before.commands.filter((command) => command !== "--stdio:end"),
  );
  assert.deepEqual(surf.stdioCalls(), before.sent, "no post-loss surf commands");
  assert.deepEqual(cdp.methods, before.methods, "no post-loss CDP commands");
  assert.deepEqual(cdp.requests, before.requests, "no automatic probe/rebind");
  assert.equal(commands(surf).includes("tab.close"), false, "never close a stale/reused tab id");
}

test("idle unexpected CDP disconnect invalidates tab, target/frame pins and observers; a NEW session binds fresh", async () => {
  await withFakes(async ({ surf, cdp, tree, pages, makeSession }) => {
    const session = makeSession();
    await session.open();
    await session.gate();
    await holdCdpActions(session);
    let tornDown = 0;
    session.observe("audit", {
      effect: READ,
      run: async () => "never",
      teardown: async () => {
        tornDown++;
      },
    });
    cdp.disconnectUnexpectedly();
    await cdp.drained();
    await until(() => session.tab === undefined);
    await assertTerminal(session, surf, cdp);
    assert.equal(tornDown, 1);
    assert.ok(commands(surf).includes("--stdio:end"), "stdio cleanup still completed");
    delete pages.P1;
    pages.FRESH = { url: PAGE, tree: { ...tree, id: "FRESH" } };
    const fresh = makeSession();
    await fresh.open();
    await fresh.gate();
    await holdCdpActions(fresh);
    await fresh.step({ ...READ_STEP, frame: "main" });
    assert.equal(fresh.tab.id, 101);
    assert.equal(cdp.socketsOpened(), 2, "fresh owned-page initialization binds a new target");
  });
});

test("CDP plan read reply loss preserves the original read error and forbids read retries", async () => {
  await withFakes(async ({ surf, cdp, makeSession }) => {
    const session = makeSession();
    await session.open();
    await session.gate();
    await holdCdpActions(session);
    cdp.dropReplyAfterHandled(
      (message) =>
        message.method === "Runtime.evaluate" &&
        message.params.expression.includes("__testCapabilitiesSurfPlanProbe"),
    );
    await assert.rejects(session.plan(PLAN_REQUEST), /DevTools socket (closed|failed)/);
    await assertTerminal(session, surf, cdp);
  });
});

test("sent read timeout through surf preserves FIRST timeout despite a retry budget", async () => {
  await withFakes(
    async ({ surf, cdp, makeSession }) => {
      const session = makeSession();
      await session.open();
      await session.gate();
      await assert.rejects(session.step({ ...READ_STEP, maxAttempts: 3, retryOn: ["timeout"] }), {
        code: "timeout",
      });
      assert.equal(surf.stdioCalls().filter((call) => call[0] === "js").length, 1);
      assert.equal(surf.calls().filter((call) => call[0] === "js").length, 0);
      await assertTerminal(session, surf, cdp);
    },
    { stdioTimeoutOn: "js" },
  );
});

test("apply input handled BEFORE CDP reply loss is unknown, one send, existing runner blocked; ledger spans NEW sessions", async () => {
  await withFakes(async ({ surf, cdp, makeSession, context }) => {
    const session = makeSession();
    await session.open();
    await session.gate();
    await holdCdpActions(session);
    const plan = await session.plan(PLAN_REQUEST);
    const runner = await session.apply({ plan, mode: "fill", channel: "cdp" });
    cdp.dropReplyAfterHandled((message) => message.method === "Input.insertText");
    await assert.rejects(runner.setValue("card"), { code: "mutation_outcome_unknown" });
    assert.equal(cdp.values["#card"], "4242", "input actually handled before answer was lost");
    assert.equal(cdp.methods.filter((method) => method === "Input.insertText").length, 1);
    const receipt = context.ledger.receipts()[0];
    assert.equal(receipt.outcome, "unknown");
    assert.equal(
      receipt.error.code,
      "mutation_outcome_unknown",
      "original pending act not replaced by reinit refusal",
    );
    assert.match(receipt.error.message, /DevTools socket (closed|failed)/);
    await assert.rejects(runner.setValue("card"), reinit);
    await assert.rejects(runner.readBack("card"), reinit);
    await assert.rejects(runner.fingerprint(), reinit);
    await assertTerminal(session, surf, cdp);
    const fresh = makeSession();
    await fresh.open();
    await fresh.gate();
    await holdCdpActions(fresh);
    const next = await fresh.apply({ plan, mode: "fill", channel: "cdp" });
    await assert.rejects(next.setValue("card"), { code: "mutation_replay_refused" });
    assert.equal(cdp.methods.filter((method) => method === "Input.insertText").length, 1);
  });
});

for (const [label, fault] of [
  ["signal", { stdioDieOn: "type" }],
  ["timeout", { stdioTimeoutOn: "type" }],
]) {
  test(`surf-only SENT unanswered ${label} terminalizes while preserving unknown mutation`, async () => {
    await withFakes(async ({ surf, cdp, makeSession, context }) => {
      const session = makeSession();
      await session.open();
      await session.gate();
      await assert.rejects(
        session.step({
          id: "fill",
          command: "type",
          args: ["4242", "--selector", "#card"],
          intent: "fill",
          read: (reply) => reply,
        }),
        { code: "mutation_outcome_unknown" },
      );
      const receipt = context.ledger.receipts()[0];
      assert.equal(receipt.outcome, "unknown");
      assert.match(receipt.error.code, label === "signal" ? /^signal_/ : /^timeout$/);
      assert.equal(surf.stdioCalls().filter((call) => call[0] === "type").length, 1);
      assert.equal(surf.calls().filter((call) => call[0] === "type").length, 0);
      await assertTerminal(session, surf, cdp);
    }, fault);
  });
}

test(
  "CDP sent input that is handled but never answered terminalizes at the command budget",
  { timeout: 22000 },
  async () => {
    await withFakes(async ({ surf, cdp, makeSession, context }) => {
      const session = makeSession();
      await session.open();
      await session.gate();
      await holdCdpActions(session);
      const plan = await session.plan(PLAN_REQUEST);
      const runner = await session.apply({ plan, mode: "fill", channel: "cdp" });
      cdp.dropReplyAfterHandled((message) => message.method === "Input.insertText", {
        disconnect: false,
      });
      await assert.rejects(runner.setValue("card"), { code: "mutation_outcome_unknown" });
      assert.equal(cdp.values["#card"], "4242");
      assert.equal(cdp.methods.filter((method) => method === "Input.insertText").length, 1);
      assert.equal(context.ledger.receipts()[0].outcome, "unknown");
      assert.match(context.ledger.receipts()[0].error.message, /did not answer within 15000 ms/);
      await assertTerminal(session, surf, cdp);
    });
  },
);

test("a queued UNSENT command cannot fall back after the preceding SENT command lost its reply", async () => {
  await withFakes(
    async ({ surf, cdp, makeSession }) => {
      const session = makeSession();
      await session.open();
      await session.gate();
      const pending = session.step(READ_STEP);
      const queued = session.step({
        ...READ_STEP,
        id: "queued",
        command: "tab.list",
        args: [],
        declare: undefined,
      });
      const [first, second] = await Promise.allSettled([pending, queued]);
      assert.equal(first.status, "rejected");
      assert.equal(first.reason.code, "timeout");
      assert.equal(second.status, "rejected");
      assert.equal(second.reason.code, "surf_session_interrupted");
      assert.equal(surf.stdioCalls().filter((call) => call[0] === "js").length, 1);
      assert.equal(commands(surf).includes("tab.list"), false);
      assert.equal(
        surf.stdioCalls().some((call) => call[0] === "tab.list"),
        false,
      );
      await assertTerminal(session, surf, cdp);
    },
    { stdioTimeoutOn: "js" },
  );
});

test("inFrame loss preserves the first mutation error without restoring the stale frame context", async () => {
  await withFakes(
    async ({ surf, cdp, makeSession }) => {
      const session = makeSession();
      await session.open();
      await session.gate();
      await assert.rejects(
        session.inFrame(0, async () =>
          session.step({
            id: "frame-fill",
            command: "type",
            args: ["4242", "--selector", "#card"],
            intent: "fill",
            read: (reply) => reply,
          }),
        ),
        { code: "mutation_outcome_unknown" },
      );
      assert.equal(commands(surf).includes("frame.main"), false);
      assert.equal(
        surf.stdioCalls().some((call) => call[0] === "frame.main"),
        false,
      );
      await assertTerminal(session, surf, cdp);
    },
    {
      stdioDieOn: "type",
      pages: {
        [PAGE]: {
          ...structuredClone(MODEL),
          readiness: "ready",
          links: [],
          frames: [{ src: "https://shop.example/frame" }],
        },
      },
    },
  );
});

test("loss during frame.main keeps its original pending error, never claims a stale tab was closed", async () => {
  await withFakes(
    async ({ surf, cdp, makeSession }) => {
      const session = makeSession();
      await session.open();
      await session.gate();
      await assert.rejects(
        session.inFrame(0, async () => "read complete"),
        { code: "signal_SESSION_EXIT" },
      );
      await assertTerminal(session, surf, cdp);
    },
    {
      stdioDieOn: "frame.main",
      pages: {
        [PAGE]: {
          ...structuredClone(MODEL),
          readiness: "ready",
          links: [],
          frames: [{ src: "https://shop.example/frame" }],
        },
      },
    },
  );
});

test("surf no_tab invalidates a missing tab rather than closing its reused id", async () => {
  await withFakes(async ({ surf, cdp, makeSession }) => {
    const session = makeSession();
    await session.open();
    await session.gate();
    const file = path.join(surf.dir, "state", "tabs.json");
    const state = JSON.parse(readFileSync(file, "utf8"));
    delete state.tabs[session.tab.id];
    writeFileSync(file, JSON.stringify(state));
    await assert.rejects(session.step(READ_STEP), { code: "no_tab" });
    state.tabs[100] = { url: PAGE };
    writeFileSync(file, JSON.stringify(state));
    await assertTerminal(session, surf, cdp);
  });
});

for (const [label, fault] of [
  ["pre-ready failure", { stdio: "broken" }],
  ["unsent refusal", { stdioRefuse: "type" }],
]) {
  test(`${label} retains CLI fallback and normal owned-tab teardown`, async () => {
    await withFakes(async ({ surf, makeSession, context }) => {
      const session = makeSession();
      await session.open();
      await session.gate();
      await session.step({
        id: "fill",
        command: "type",
        args: ["4242", "--selector", "#card"],
        intent: "fill",
        read: (reply) => reply,
      });
      assert.equal(context.ledger.receipts()[0].outcome, "applied");
      assert.ok(session.tab);
      assert.ok(session.readiness);
      assert.equal(surf.calls().filter((call) => call[0] === "type").length, 1);
      await session.close();
      assert.equal(commands(surf).filter((command) => command === "tab.close").length, 1);
    }, fault);
  });
}

test("flow fill reply loss stops at the first act; no close old tab, no second field", async () => {
  await withFakes(async ({ surf, cdp, dir, config, sessions }) => {
    const file = path.join(dir, "flow.json");
    writeFileSync(
      file,
      JSON.stringify(
        flowOf([
          { action: "fill", target: "#card", value: "4242" },
          { action: "fill", target: "#user", value: "later" },
        ]),
      ),
    );
    cdp.dropReplyAfterHandled((message) => message.method === "Input.insertText");
    await assert.rejects(
      executeCliOperation({ command: "surf", action: "flow" }, { file, config }),
      { code: "mutation_outcome_unknown" },
    );
    assert.equal(cdp.values["#card"], "4242");
    assert.equal(cdp.values["#user"], undefined);
    assert.equal(cdp.methods.filter((method) => method === "Input.insertText").length, 1);
    assert.equal(receiptsIn(dir).at(-1).outcome, "unknown");
    await assertTerminal(sessions[0], surf, cdp);
  });
});

test("submit mouse release handled BEFORE lost reply is unknown; replay refused across operation sessions", async () => {
  await withFakes(async ({ surf, cdp, tree, dir, config, sessions }) => {
    tree.elements["#pay"].navigatesTo = DONE;
    const content = flowOf([
      { id: "pay", action: "click", target: "#pay", submit: true, expect: { url_prefix: DONE } },
    ]);
    const file = path.join(dir, "flow.json");
    writeFileSync(file, JSON.stringify(content));
    const input = {
      file,
      config,
      submit: true,
      confirmFlow: flowApprovalToken(parseFlow(content, file)),
    };
    cdp.dropReplyAfterHandled(
      (message) =>
        message.method === "Input.dispatchMouseEvent" && message.params.type === "mouseReleased",
    );
    await assert.rejects(executeCliOperation({ command: "surf", action: "flow" }, input), {
      code: "submit_postcondition_unmet",
      message: /unknown/,
    });
    assert.equal(cdp.clicks.length, 1);
    assert.equal(tree.url, DONE);
    assert.equal(cdp.methods.filter((method) => method === "Input.dispatchMouseEvent").length, 3);
    const submit = receiptsIn(dir).filter((receipt) => receipt.details.mode === "submit");
    assert.ok(submit.length > 0);
    assert.ok(submit.every((receipt) => receipt.outcome === "unknown"));
    const pending = submit.find((receipt) => receipt.error);
    assert.equal(pending.error.code, "mutation_outcome_unknown");
    assert.match(pending.error.message, /DevTools socket (closed|failed)/);
    await assertTerminal(sessions[0], surf, cdp);
    const before = commands(surf);
    await assert.rejects(executeCliOperation({ command: "surf", action: "flow" }, input), {
      code: "submit_already_attempted",
    });
    assert.deepEqual(commands(surf), before);
    assert.equal(cdp.clicks.length, 1);
  });
});

test("intentional CDP close and closeAndWait never notify unexpected disconnect", async () => {
  await withFakes(async ({ cdp }) => {
    for (const wait of [false, true]) {
      const connection = await CdpConnection.open(
        `${cdp.url.replace("http:", "ws:")}/devtools/page/P1`,
      );
      let lost = 0;
      connection.onDisconnect(() => {
        lost++;
      });
      if (wait) await connection.closeAndWait();
      else connection.close();
      await cdp.drained();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(lost, 0);
    }
  });
});

test("normal held binding teardown does not terminalize or prevent a later deliberate bind", async () => {
  await withFakes(async ({ surf, cdp, makeSession }) => {
    const session = makeSession();
    await session.open();
    await session.gate();
    assert.equal((await bindsOverCdp(session, process.env, { hold: true })).binds, true);
    await releaseCdpActions(session);
    assert.ok(session.readiness);
    assert.ok(session.tab);
    await holdCdpActions(session);
    await session.step({ ...READ_STEP, frame: "main" });
    await releaseCdpActions(session);
    await session.close();
    assert.equal(commands(surf).filter((command) => command === "tab.close").length, 1);
    assert.equal(cdp.socketsOpened(), 2);
  });
});

// Reviewer blockers: causal gates, not wall-clock sleeps, select the revocation/error point.
const fillStep = {
  command: "type",
  args: ["late", "--selector", "#card"],
  frame: "main",
  effect: "mutating",
};
const outcomeOf = (pending) =>
  pending.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function blockerPeer(t, options = {}) {
  const cdp = await startFakeCdp({ pages: { P1: { url: PAGE, tree: cdpTree(PAGE) } }, ...options });
  t.after(() => cdp.close());
  return { cdp, env: { TEST_CAPABILITIES_CDP_ENDPOINT: cdp.url }, session: { url: PAGE } };
}

for (const point of ["before frame resolution", "after handled focus before reply"]) {
  test(
    `revocation ${point} prevents every later async input continuation`,
    { timeout: 5000 },
    async (t) => {
      const { cdp, env, session } = await blockerPeer(t);
      await holdCdpActions(session, env);
      const gate = point.startsWith("after")
        ? cdp.gateReplyAfterHandled((message) => message.method === "DOM.focus")
        : undefined;
      const pending = outcomeOf(runStepInFrame(session, env, fillStep));
      if (gate) await gate.handled;
      const sentAtRevocation = [...cdp.methods];
      invalidateSessionCdp(session);
      gate?.release();
      const { error } = await pending;
      assert.equal(cdp.values["#card"], undefined, "no text may be sent after revocation");
      assert.deepEqual(
        cdp.methods,
        sentAtRevocation,
        "no post-revocation RPC, including cleanup probes",
      );
      assert.equal(error.code, "mutation_outcome_unknown");
      await releaseCdpActions(session);
      assert.equal(cdp.closeResponse.frames, 1);
      assert.equal(await cdp.drained(), 0);
      await assert.rejects(holdCdpActions(session, env), reinit);
      assert.equal(cdp.socketsOpened(), 1, "no automatic new binding");
    },
  );
}

for (const fault of ["handled input reply error", "throwing mutating script"]) {
  test(
    `non-held ${fault} keeps its primary unknown despite withheld native close`,
    { timeout: 5000 },
    async (t) => {
      const { cdp, env, session } = await blockerPeer(t, { holdCloseReply: true });
      const gate = fault.startsWith("handled")
        ? cdp.gateReplyAfterHandled((message) => message.method === "Input.insertText", {
            error: "handled-input-primary",
          })
        : undefined;
      const step = gate
        ? fillStep
        : {
            command: "js",
            args: ["throw new Error('script-primary')"],
            frame: "main",
            effect: "mutating",
          };
      const pending = outcomeOf(runStepInFrame(session, env, step));
      if (gate) {
        await gate.handled;
        invalidateSessionCdp(session);
        gate.release();
      }
      const { error } = await pending;
      assert.equal(cdp.closeResponse.frames, 1, "bounded cleanup was attempted");
      assert.equal(cdp.closeResponse.replies, 0);
      assert.equal(cdp.openSockets(), 1, "timeout is not forced socket teardown");
      assert.equal(error.code, "mutation_outcome_unknown");
      assert.match(error.message, gate ? /handled-input-primary/ : /script-primary/);
      assert.match(JSON.stringify(error.details.cleanup_errors), /did not close within 1000 ms/);
      if (gate) {
        assert.equal(cdp.values["#card"], "late");
        assert.equal(cdp.methods.filter((method) => method === "Input.insertText").length, 1);
      }
      cdp.closeResponse.release();
      assert.equal(await cdp.drained(), 0);
    },
  );
}

test(
  "failed startup read preserves its error while awaiting bounded native cleanup",
  { timeout: 5000 },
  async (t) => {
    const { cdp, env, session } = await blockerPeer(t, { holdCloseReply: true });
    const gate = cdp.gateReplyAfterHandled(
      (message) => message.method === "Accessibility.getFullAXTree",
      { error: "startup-read-primary" },
    );
    const pending = outcomeOf(holdCdpActions(session, env));
    await gate.handled;
    invalidateSessionCdp(session);
    gate.release();
    const { error } = await pending;
    await cdp.closeResponse.received;
    assert.match(error.message, /startup-read-primary/);
    assert.match(JSON.stringify(error.cleanupErrors), /did not close within 1000 ms/);
    assert.equal(cdp.openSockets(), 1, "bounded waiter does not force native socket teardown");
    cdp.closeResponse.release();
    assert.equal(await cdp.drained(), 0);
  },
);

test(
  "owned-tab proof failure keeps the original error identity and secondary close timeout",
  { timeout: 5000 },
  async (t) => {
    const { cdp, env, session } = await blockerPeer(t, { holdCloseReply: true });
    const primary = new Error("owned-tab-proof-primary");
    session.evaluate = async () => {
      throw primary;
    };
    const { error } = await outcomeOf(holdCdpActions(session, env));
    assert.equal(cdp.closeResponse.frames, 1);
    assert.equal(cdp.openSockets(), 1);
    assert.strictEqual(error, primary, "cleanup cannot overwrite the original proof error");
    assert.match(JSON.stringify(error.cleanupErrors), /did not close within 1000 ms/);
    cdp.closeResponse.release();
    assert.equal(await cdp.drained(), 0);
  },
);

for (const phase of [
  "initial acquired actions",
  "pinned target acquired actions",
  "pending owned-tab proof",
]) {
  test(
    `revoked ${phase} releases the failed binding without leaking its socket`,
    { timeout: 5000 },
    async (t) => {
      const { cdp, env, session } = await blockerPeer(t);
      if (phase.startsWith("pinned")) {
        await holdCdpActions(session, env);
        await releaseCdpActions(session);
      }
      const proofEntered = deferred();
      const proofAnswer = deferred();
      if (phase.startsWith("pending"))
        session.evaluate = async () => {
          proofEntered.resolve();
          return proofAnswer.promise;
        };
      const gate = phase.startsWith("pending")
        ? undefined
        : cdp.gateReplyAfterHandled((message) => message.method === "Page.enable");
      const pending = outcomeOf(holdCdpActions(session, env));
      if (gate) await gate.handled;
      else await proofEntered.promise;
      const sentAtRevocation = [...cdp.methods];
      const closesBefore = cdp.closeResponse.frames;
      invalidateSessionCdp(session);
      if (gate) gate.release();
      else proofAnswer.resolve("owned-proof");
      const { error } = await pending;
      await releaseCdpActions(session);
      assert.equal(error.code, "surf_session_interrupted");
      assert.deepEqual(
        cdp.methods,
        sentAtRevocation,
        "no proof or binding RPC may continue after revocation",
      );
      assert.equal(
        cdp.closeResponse.frames,
        closesBefore + 1,
        "the newly acquired binding was closed",
      );
      assert.equal(await cdp.drained(), 0, "no abandoned socket");
      assert.equal(cdp.socketsOpened(), phase.startsWith("pinned") ? 2 : 1);
    },
  );
}

test(
  "repair: CDP revocation while stdio refuses fences the unsent CLI fallback",
  { timeout: 10000 },
  async () => {
    const { SurfStdio } = await importRuntimeModule("core/surf-stdio.js");
    await withFakes(
      async ({ surf, cdp, makeSession, context }) => {
        const session = makeSession();
        await session.open();
        await session.gate();
        await holdCdpActions(session);
        const refused = deferred();
        const resume = deferred();
        const original = SurfStdio.prototype.run;
        SurfStdio.prototype.run = async function (argv, timeoutMs) {
          const answer = await original.call(this, argv, timeoutMs);
          if (argv[0] === "type") {
            assert.deepEqual(answer, { refused: true }, "the stdio command was never executed");
            refused.resolve();
            await resume.promise;
          }
          return answer;
        };
        try {
          const pending = outcomeOf(
            session.step({
              id: "revoked-refusal",
              command: "type",
              args: ["late", "--selector", "#card"],
              intent: "fill",
              read: (reply) => reply,
            }),
          );
          await refused.promise;
          cdp.disconnectUnexpectedly();
          await cdp.drained();
          await until(() => session.tab === undefined);
          const sentAtRevocation = commands(surf);
          resume.resolve();
          const { error } = await pending;
          assert.deepEqual(commands(surf), sentAtRevocation, "no CLI fallback after revocation");
          assert.equal(error.code, "surf_session_interrupted");
          assert.equal(
            context.ledger.receipts()[0].outcome,
            "failed",
            "unsent mutation did nothing",
          );
          const state = JSON.parse(readFileSync(path.join(surf.dir, "state", "tabs.json"), "utf8"));
          assert.equal(state.fields?.[PAGE]?.["#card"], undefined);
          await assertTerminal(session, surf, cdp);
        } finally {
          resume.resolve();
          SurfStdio.prototype.run = original;
        }
      },
      { stdioRefuse: "type" },
    );
  },
);

test(
  "repair: acknowledged non-held mutation with failed cleanup remains unknown and blocks cross-run replay",
  { timeout: 10000 },
  async () => {
    await withFakes(
      async ({ surf, cdp, makeSession, context, dir }) => {
        const session = makeSession();
        await session.open();
        await session.gate();
        const step = {
          id: "cleanup-fill",
          command: "type",
          args: ["late", "--selector", "#card"],
          frame: "main",
          intent: "fill",
          idempotencyKey: "cleanup-acknowledged-fill",
          read: (reply) => reply,
        };
        const gate = cdp.gateReplyAfterHandled((message) => message.method === "Input.insertText");
        const pending = outcomeOf(session.step(step));
        try {
          await gate.handled;
          assert.equal(cdp.values["#card"], "late", "input handled before successful answer");
          gate.release();
          await cdp.closeResponse.received;
          const { error } = await pending;
          const receipt = context.ledger.receipts()[0];
          assert.equal(receipt.outcome, "unknown");
          assert.equal(error.code, "mutation_outcome_unknown");
          assert.equal(receipt.error.code, "mutation_outcome_unknown");
          assert.match(receipt.error.message, /acknowledged.*cleanup/i);
          assert.match(receipt.error.message, /did not close within 1000 ms/);
          assert.equal(
            receiptsIn(dir).find((entry) => entry.receipt_id === receipt.receipt_id).outcome,
            "unknown",
          );
          cdp.closeResponse.release();
          assert.equal(await cdp.drained(), 0);
          const nextContext = createRunContext({
            operationId: "surf.apply",
            effect: SESSION_LIFECYCLE_EFFECT,
            config: {
              receipts: { dir: path.join(dir, "receipts"), ephemeral: true },
              mutation: { allowOrigins: ["https://shop.example"] },
            },
          });
          assert.notEqual(nextContext.runId, context.runId);
          const next = new SurfSession({ context: nextContext, url: PAGE });
          await next.open();
          await next.gate();
          const before = [...cdp.methods];
          await assert.rejects(next.step(step), { code: "mutation_replay_refused" });
          assert.deepEqual(cdp.methods, before, "replay refused before any CDP dispatch");
          assert.equal(cdp.methods.filter((method) => method === "Input.insertText").length, 1);
          assert.equal(
            surf.stdioCalls().some((call) => call[0] === "type"),
            false,
          );
        } finally {
          cdp.closeResponse.release();
        }
      },
      {},
      { holdCloseReply: true },
    );
  },
);

for (const stdio of [true, false]) {
  test(
    `repair: sent ${stdio ? "stdio" : "CLI"} output overflow terminalizes after handled mutation`,
    { timeout: 10000 },
    async () => {
      await withFakes(
        async ({ surf, cdp, makeSession, context }) => {
          const session = makeSession();
          await session.open();
          await session.gate();
          const pending = outcomeOf(
            session.step({
              id: "overflow-fill",
              command: "type",
              args: ["late", "--selector", "#card"],
              intent: "fill",
              read: (reply) => reply,
            }),
          );
          const { error } = await pending;
          const state = JSON.parse(readFileSync(path.join(surf.dir, "state", "tabs.json"), "utf8"));
          assert.equal(state.fields[PAGE]["#card"].value, "late", "mutation preceded buffer kill");
          assert.equal(session.tab, undefined, "sent overflow revokes the owned tab");
          assert.equal(error.code, "mutation_outcome_unknown");
          const receipt = context.ledger.receipts()[0];
          assert.equal(receipt.outcome, "unknown");
          assert.equal(receipt.error.code, "signal_SIGTERM");
          assert.ok(receipt.evidence.includes("basis:indeterminate"));
          assert.equal(surf.calls().filter((call) => call[0] === "type").length, 1);
          assert.equal(
            surf.stdioCalls().filter((call) => call[0] === "type").length,
            stdio ? 1 : 0,
          );
          await assertTerminal(session, surf, cdp);
        },
        { stdio, floodOn: "type" },
      );
    },
  );
}

test(
  "repair control: acknowledged non-held read cleanup rejection is not a mutation-unknown error",
  { timeout: 10000 },
  async (t) => {
    const { cdp, env, session } = await blockerPeer(t, { holdCloseReply: true });
    const pending = outcomeOf(
      runStepInFrame(session, env, {
        command: "js",
        args: ["document.title"],
        frame: "main",
        effect: "read_only",
      }),
    );
    try {
      await cdp.closeResponse.received;
      const { error } = await pending;
      assert.equal(error.code, undefined);
      assert.match(error.message, /did not close within 1000 ms/);
    } finally {
      cdp.closeResponse.release();
    }
    assert.equal(await cdp.drained(), 0);
  },
);
