import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { createFakeSurf, readyPages, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * Feature: effect-aware context recovery (AK6587)
 *   Given an owned frame and an explicitly declared effect
 *   When the provider handles a script but reports a lost context instead of its result
 *   Then an arbitrary/mutating script is dispatched once, never recovered by replay
 *   And its durable receipt stays unknown and refuses same-run and fresh-run replay
 *
 * Read-only bodies may retry a recognized stale-context error once. Acquiring a context is
 * separate from dispatching a script. An isolated world is NOT a read-only declaration.
 * These are executable Given/When/Then scenarios in the native contract-test runner;
 * fake CDP handler effects are witnessed before the gated reply, not live-browser proof.
 */
const { openCdpActions } = await importRuntimeModule("core/cdp-actions.js");
const { CdpConnection } = await importRuntimeModule("core/a11y-cdp.js");
const { frameWorlds } = await importRuntimeModule("core/cdp-worlds.js");
const { SurfSession } = await importRuntimeModule("core/surf-session.js");
const { createRunContext } = await importRuntimeModule("core/run-context.js");
const { SESSION_LIFECYCLE_EFFECT } = await importRuntimeModule("core/browser-session.js");
const { runFlowAct } = await importRuntimeModule("core/cdp-flow-acts.js");
const { FrameworkError } = await importRuntimeModule("core/runtime-contract.js");
const PAGE = "https://context.example/form";
const SCRIPT = "globalThis.__fixtureCounter += 1";
const READ_SCRIPT = "document.title";
const CONTEXT_LOST = "Execution context was destroyed.";
const READ = { effect: "read_only", reason: "reads the fixture page" };
const MUTATE = { effect: "mutating", scope: "target", reason: "increments the fixture counter" };
const outcomeOf = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
const requestCount = (cdp, expression = SCRIPT) =>
  cdp.rpc.filter(
    ({ method, params }) => method === "Runtime.evaluate" && params.expression === expression,
  ).length;

function fixtureTree() {
  let handled = 0;
  const evals = {};
  // The provider records the simulated target effect while handling Runtime.evaluate,
  // before fake-cdp's reply gate can replace the answer with a protocol error.
  Object.defineProperty(evals, SCRIPT, { get: () => ++handled });
  Object.defineProperty(evals, READ_SCRIPT, {
    get: () => {
      handled++;
      return "fixture";
    },
  });
  const tree = {
    url: PAGE,
    nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, childIds: [] }],
    elements: {},
    evals,
  };
  return { tree, handled: () => handled };
}

/** Observe the real CDP send path without substituting results or changing fixture handlers. */
function traceRpc(cdp) {
  cdp.rpc = [];
  const original = CdpConnection.prototype.send;
  CdpConnection.prototype.send = function (method, params, sessionId) {
    cdp.rpc.push({ method, params, sessionId });
    return original.call(this, method, params, sessionId);
  };
  return () => {
    CdpConnection.prototype.send = original;
  };
}

async function givenActions(t) {
  const fixture = fixtureTree();
  const cdp = await startFakeCdp({ pages: { P1: { url: PAGE, tree: fixture.tree } } });
  const restore = traceRpc(cdp);
  let actions;
  t.after(async () => {
    try {
      await actions?.close();
    } finally {
      await cdp.close();
      restore();
    }
  });
  actions = await openCdpActions(PAGE, { TEST_CAPABILITIES_CDP_ENDPOINT: cdp.url });
  return { ...fixture, cdp, actions };
}

for (const world of ["page", "isolated"]) {
  for (const effect of [undefined, "mutating"]) {
    test(
      `Scenario: Given ${effect ?? "undeclared"} ${world} script; When handled then context lost; Then no replay`,
      { timeout: 10000 },
      async (t) => {
        // Given an available replacement context does not prove that the first script did nothing.
        const { cdp, actions, handled } = await givenActions(t);
        const gate = cdp.gateReplyAfterHandled(
          ({ method, params }) => method === "Runtime.evaluate" && params.expression === SCRIPT,
          { error: CONTEXT_LOST },
        );
        const pending = outcomeOf(actions.evaluate(SCRIPT, { world }, effect));
        // When the handler really ran, and only its answer is replaced (socket stays live).
        await gate.handled;
        assert.equal(handled(), 1);
        gate.release();
        const { error } = await pending;
        // Then execution-world choice cannot silently confer body-retry permission.
        assert.equal(error?.message, CONTEXT_LOST);
        assert.equal(requestCount(cdp), 1);
        assert.equal(handled(), 1);
      },
    );
  }
}

for (const world of ["page", "isolated"]) {
  test(
    `Scenario: Given declared ${world} read; When one recognized context is lost; Then recover once`,
    { timeout: 10000 },
    async (t) => {
      const { cdp, actions, handled } = await givenActions(t);
      const gate = cdp.gateReplyAfterHandled(
        ({ method, params }) => method === "Runtime.evaluate" && params.expression === READ_SCRIPT,
        { error: "Cannot find context with specified id" },
      );
      const pending = outcomeOf(actions.evaluate(READ_SCRIPT, { world }, "read_only"));
      await gate.handled;
      gate.release();
      const result = await pending;
      assert.equal(result.error, undefined);
      assert.equal(handled(), 2, "counts read observations in this declared-read scenario");
      const contexts = cdp.rpc
        .filter(
          ({ method, params }) =>
            method === "Runtime.evaluate" && params.expression === READ_SCRIPT,
        )
        .map(({ params }) => params.contextId);
      assert.equal(contexts.length, 2);
      assert.notEqual(contexts[0], contexts[1], "fresh context, not blind same-context retry");
    },
  );
}

test(
  "Scenario: Given a declared read; When both context replies fail; Then stop after one recovery",
  { timeout: 10000 },
  async (t) => {
    const { cdp, actions, handled } = await givenActions(t);
    const matches = ({ method, params }) =>
      method === "Runtime.evaluate" && params.expression === READ_SCRIPT;
    const first = cdp.gateReplyAfterHandled(matches, { error: CONTEXT_LOST });
    const pending = outcomeOf(actions.evaluate(READ_SCRIPT, { world: "page" }, "read_only"));
    const firstRequest = await first.handled;
    // The fake's send gate also sees a released reply; exclude the first request explicitly.
    const second = cdp.gateReplyAfterHandled(
      (message) => message.id !== firstRequest.id && matches(message),
      { error: CONTEXT_LOST },
    );
    first.release();
    await second.handled;
    second.release();
    assert.equal((await pending).error?.message, CONTEXT_LOST);
    assert.equal(handled(), 2);
    assert.equal(requestCount(cdp, READ_SCRIPT), 2);
  },
);

test(
  "Scenario: Given a declared read; When permission error mentions context; Then never retry it",
  { timeout: 10000 },
  async (t) => {
    const { cdp, actions, handled } = await givenActions(t);
    const message = "Permission denied in context: fixture policy";
    const gate = cdp.gateReplyAfterHandled(
      ({ method, params }) => method === "Runtime.evaluate" && params.expression === READ_SCRIPT,
      { error: message },
    );
    const pending = outcomeOf(actions.evaluate(READ_SCRIPT, { world: "page" }, "read_only"));
    await gate.handled;
    gate.release();
    assert.equal((await pending).error?.message, message);
    assert.equal(handled(), 1);
    assert.equal(requestCount(cdp, READ_SCRIPT), 1);
  },
);

for (const world of ["page", "isolated"]) {
  test(
    `Scenario: Given a ${world} mutation not yet dispatched; When acquisition loses context; Then recover before one script`,
    { timeout: 10000 },
    async (t) => {
      const { cdp, actions, handled } = await givenActions(t);
      const method = world === "page" ? "Runtime.enable" : "Page.createIsolatedWorld";
      const gate = cdp.gateReplyAfterHandled(({ method: sent }) => sent === method, {
        error: CONTEXT_LOST,
      });
      const pending = outcomeOf(actions.evaluate(SCRIPT, { world }, "mutating"));
      await gate.handled;
      assert.equal(handled(), 0, "no arbitrary body was sent during failed acquisition");
      gate.release();
      const result = await pending;
      assert.equal(result.error, undefined);
      assert.equal(requestCount(cdp), 1);
      assert.equal(handled(), 1);
      assert.equal(cdp.rpc.filter(({ method: sent }) => sent === method).length, 2);
    },
  );
}

test("Scenario: Given a script exception saying context; When JS reports exceptionDetails; Then retain ordinary exception without replay", async (t) => {
  const { tree, cdp, actions } = await givenActions(t);
  tree.form = { title: "fixture", fields: {}, controls: [] };
  const expression = "(() => { throw new Error('Execution context was destroyed'); })()";
  await assert.rejects(actions.evaluate(expression), {
    code: "action_evaluate_failed",
    message: /Execution context was destroyed/,
  });
  assert.equal(requestCount(cdp, expression), 1);
});

function diskReceipts(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(path.join(dir, entry.name))
        .filter((name) => name.endsWith(".json"))
        .map((name) => JSON.parse(readFileSync(path.join(dir, entry.name, name), "utf8"))),
    )
    .filter((entry) => entry.artifact_kind === "test-capabilities.mutation.receipt");
}

async function givenSession(body) {
  const fixture = fixtureTree();
  const cdp = await startFakeCdp({ pages: { P1: { url: PAGE, tree: fixture.tree } } });
  const restore = traceRpc(cdp);
  const surf = createFakeSurf({ pages: readyPages({ [PAGE]: { links: [] } }) });
  const dir = mkdtempSync(path.join(os.tmpdir(), "cdp-context-receipts-"));
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  process.env.TEST_CAPABILITIES_CDP_ENDPOINT = cdp.url;
  const sessions = [];
  try {
    await withFakeSurfEnv(surf.path, async () => {
      const makeSession = () => {
        const context = createRunContext({
          operationId: "surf.apply",
          effect: SESSION_LIFECYCLE_EFFECT,
          env: {
            ...process.env,
            TEST_CAPABILITIES_RECEIPTS_DIR: dir,
            TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
          },
          config: { mutation: { allowOrigins: ["https://context.example"] } },
        });
        const session = new SurfSession({ context, url: PAGE });
        sessions.push(session);
        return { session, context };
      };
      const initial = makeSession();
      await initial.session.open();
      await initial.session.gate();
      await body({ ...fixture, ...initial, makeSession, cdp, surf, dir });
    });
  } finally {
    for (const session of sessions) await session.close();
    if (previous === undefined) delete process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
    else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = previous;
    surf.cleanup();
    await cdp.close();
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
}

const scriptStep = (declare = MUTATE) => ({
  id: "context.once",
  command: "js",
  args: [declare.effect === "read_only" ? READ_SCRIPT : SCRIPT],
  frame: "main",
  declare,
  intent: "increments the fixture counter once",
  read: (reply) => JSON.parse(reply.stdout),
});

for (const replacement of ["available", "missing"]) {
  test(
    `Scenario: Given owned mutating step and ${replacement} replacement; When handled before context error; Then unknown receipt locks replay`,
    { timeout: 10000 },
    async () => {
      await givenSession(
        async ({ session, context, makeSession, cdp, tree, handled, surf, dir }) => {
          const gate = cdp.gateReplyAfterHandled(
            ({ method, params }) => method === "Runtime.evaluate" && params.expression === SCRIPT,
            { error: CONTEXT_LOST },
          );
          const pending = outcomeOf(session.step(scriptStep()));
          await gate.handled;
          assert.equal(handled(), 1, "simulated target effect preceded answer loss");
          assert.equal(
            context.ledger.receipts()[0].outcome,
            "attempting",
            "write-ahead receipt already exists",
          );
          if (replacement === "missing") tree.noPageWorld = true;
          gate.release();
          const { error } = await pending;
          const [receipt] = context.ledger.receipts();
          assert.equal(
            receipt.outcome,
            "unknown",
            "possible execution is neither applied nor definitely failed",
          );
          assert.equal(error?.code, "mutation_outcome_unknown");
          // The ledger's public error directs the operator to the receipt; the receipt
          // must retain the original CDP cause, not a later fresh-acquisition refusal.
          assert.match(error.message, /Receipt .*records the attempt/i);
          assert.equal(handled(), 1);
          assert.equal(requestCount(cdp), 1);
          assert.equal(receipt.error.code, "mutation_outcome_unknown");
          assert.match(
            receipt.error.message,
            /Execution context was destroyed/,
            "fresh-acquisition failure cannot mask the original possible execution",
          );
          assert.equal(
            diskReceipts(dir).find((entry) => entry.receipt_id === receipt.receipt_id).outcome,
            "unknown",
          );
          await assert.rejects(session.step(scriptStep()), { code: "mutation_replay_refused" });
          tree.noPageWorld = false;
          const fresh = makeSession();
          assert.notEqual(fresh.context.runId, context.runId);
          await fresh.session.open();
          await fresh.session.gate();
          const before = { requests: cdp.rpc.length, calls: surf.calls().length };
          await assert.rejects(fresh.session.step(scriptStep()), {
            code: "mutation_replay_refused",
          });
          assert.equal(cdp.rpc.length, before.requests, "cross-run refusal before CDP dispatch");
          assert.equal(surf.calls().length, before.calls, "no CLI fallback replay");
          assert.equal(handled(), 1);
        },
      );
    },
  );
}

test("Scenario: Given no page context before a mutation; When acquisition refuses; Then failed receipt and zero script sends", async () => {
  await givenSession(async ({ session, context, cdp, tree, handled }) => {
    tree.noPageWorld = true;
    await assert.rejects(session.step(scriptStep()), { code: "action_frame_unknown" });
    assert.equal(context.ledger.receipts()[0].outcome, "failed");
    assert.equal(requestCount(cdp), 0);
    assert.equal(handled(), 0);
  });
});

test(
  "Scenario: Given declared session read; When its context is lost; Then read recovers without a mutation receipt",
  { timeout: 10000 },
  async () => {
    await givenSession(async ({ session, context, cdp, handled }) => {
      const gate = cdp.gateReplyAfterHandled(
        ({ method, params }) => method === "Runtime.evaluate" && params.expression === READ_SCRIPT,
        { error: CONTEXT_LOST },
      );
      const pending = outcomeOf(session.step(scriptStep(READ)));
      await gate.handled;
      gate.release();
      assert.equal((await pending).error, undefined);
      assert.equal(handled(), 2);
      assert.equal(requestCount(cdp, READ_SCRIPT), 2);
      assert.deepEqual(context.ledger.receipts(), []);
    });
  },
);

test(
  "Scenario: Given flow condition read; When context is stale; Then explicit read recovery preserves the observer",
  { timeout: 10000 },
  async (t) => {
    const { cdp, actions, tree } = await givenActions(t);
    tree.form = { title: "fixture", fields: {}, controls: [] };
    const gate = cdp.gateReplyAfterHandled(
      ({ method, params }) =>
        method === "Runtime.evaluate" && params.expression.includes("const condition ="),
      { error: CONTEXT_LOST },
    );
    const pending = outcomeOf(
      runFlowAct(
        actions,
        "flow.observe",
        {
          step: "condition",
          condition: { url_prefix: "https://context.example" },
          origins: [],
          submit: "undeclared",
        },
        "main",
      ),
    );
    await gate.handled;
    gate.release();
    assert.equal((await pending).error, undefined);
    assert.equal(
      cdp.rpc.filter(
        ({ method, params }) =>
          method === "Runtime.evaluate" && params.expression.includes("const condition ="),
      ).length,
      2,
    );
  },
);

for (const effect of [undefined, "mutating"]) {
  test(`Scenario: Given ${effect ?? "undeclared"} helper body; When it throws after invocation; Then preserve identity without reacquisition`, async () => {
    const { inContext } = frameWorlds({ on: () => () => {} }, "fixture");
    const original = new Error(CONTEXT_LOST);
    const replacement = new FrameworkError(
      "action_frame_unknown",
      "replacement page world missing",
    );
    let acquisitions = 0,
      bodies = 0;
    const acquire = async () => {
      if (++acquisitions > 1) throw replacement;
      return 1;
    };
    const body = async () => {
      bodies++;
      throw original;
    };
    await assert.rejects(
      inContext(acquire, { url: PAGE, frameId: "P1" }, body, effect),
      (error) => error === original,
    );
    assert.equal(bodies, 1);
    assert.equal(acquisitions, 1);
  });
}

test("Scenario: Given a lost read answer; When fresh acquisition refuses; Then retain the original read error", async () => {
  const { inContext } = frameWorlds({ on: () => () => {} }, "fixture");
  const original = new Error(CONTEXT_LOST);
  let acquisitions = 0,
    bodies = 0;
  const acquire = async () => {
    if (++acquisitions > 1) throw new FrameworkError("action_frame_unknown", "replacement missing");
    return 1;
  };
  const body = async () => {
    bodies++;
    throw original;
  };
  await assert.rejects(
    inContext(acquire, { url: PAGE, frameId: "P1" }, body, "read_only"),
    (error) => error === original,
  );
  assert.equal(acquisitions, 2);
  assert.equal(bodies, 1);
});

test("Scenario: Given acquisition already recovered; When a read body then loses context; Then do not spend a second recovery", async () => {
  const { inContext } = frameWorlds({ on: () => () => {} }, "fixture");
  const original = new Error(CONTEXT_LOST);
  let acquisitions = 0,
    bodies = 0;
  const acquire = async () => {
    if (++acquisitions === 1) throw original;
    return 1;
  };
  const body = async () => {
    bodies++;
    throw original;
  };
  await assert.rejects(
    inContext(acquire, { url: PAGE, frameId: "P1" }, body, "read_only"),
    (error) => error === original,
  );
  assert.equal(acquisitions, 2);
  assert.equal(bodies, 1);
});

test("Scenario: Given acquisition permission failure mentions context; When acquiring; Then no recovery or arbitrary body", async () => {
  const { inContext } = frameWorlds({ on: () => () => {} }, "fixture");
  const original = new Error("Permission denied in context: fixture policy");
  let acquisitions = 0,
    bodies = 0;
  const acquire = async () => {
    if (++acquisitions === 1) throw original;
    return 1;
  };
  const body = async () => {
    bodies++;
    return "not authorized";
  };
  await assert.rejects(
    inContext(acquire, { url: PAGE, frameId: "P1" }, body, "read_only"),
    (error) => error === original,
  );
  assert.equal(acquisitions, 1);
  assert.equal(bodies, 0);
});

test("Scenario: Given stale stamp then stale read; When acquisition already recovered; Then no hidden second recovery", async () => {
  let creates = 0,
    bodies = 0,
    stale = false;
  const original = new Error(CONTEXT_LOST);
  const connection = {
    on: () => () => {},
    send: async (method, params) => {
      if (method === "Page.createIsolatedWorld") return { executionContextId: ++creates };
      if (params.expression === "globalThis.__testCapabilitiesWorld" && stale)
        throw new Error(CONTEXT_LOST);
      return { result: {} };
    },
  };
  const { worldOf, inContext } = frameWorlds(connection, "fixture");
  const frame = { url: PAGE, frameId: "P1" };
  await worldOf(frame);
  stale = true;
  const body = async () => {
    if (++bodies === 1) throw original;
    return "hidden replay";
  };
  await assert.rejects(inContext(worldOf, frame, body, "read_only"), (error) => error === original);
  assert.equal(creates, 2, "one replacement world, not inner plus outer recovery");
  assert.equal(bodies, 1);
});

for (const effect of ["mutating", "read_only"]) {
  test(`Scenario: Given missing ownership stamp; When ${effect} body loses context; Then obey effect policy, not world replacement count`, async () => {
    let creates = 0,
      bodies = 0;
    const original = new Error(CONTEXT_LOST);
    const connection = {
      on: () => () => {},
      send: async (method) => {
        if (method === "Page.createIsolatedWorld") return { executionContextId: ++creates };
        return { result: { value: undefined } }; // stamp read succeeds but ownership proof fails
      },
    };
    const { worldOf, inContext } = frameWorlds(connection, "fixture");
    const frame = { url: PAGE, frameId: "P1" };
    await worldOf(frame);
    const body = async () => {
      if (++bodies === 1) throw original;
      return "read recovered";
    };
    const pending = inContext(worldOf, frame, body, effect);
    if (effect === "mutating") {
      await assert.rejects(pending, (error) => error === original);
      assert.equal(creates, 2);
      assert.equal(bodies, 1);
    } else {
      assert.equal(await pending, "read recovered");
      assert.equal(creates, 3);
      assert.equal(bodies, 2);
    }
  });
}

test("Scenario: Given a stamped cached world; When its read hits terminal transport; Then no hidden acquisition and original error", async () => {
  let creates = 0;
  const original = new FrameworkError("surf_session_interrupted", "transport revoked");
  const connection = {
    on: () => () => {},
    send: async (method, params) => {
      if (method === "Page.createIsolatedWorld") return { executionContextId: ++creates };
      if (params.expression === "globalThis.__testCapabilitiesWorld") throw original;
      return {};
    },
  };
  const { worldOf } = frameWorlds(connection, "fixture");
  const frame = { url: PAGE, frameId: "P1" };
  assert.equal(await worldOf(frame), 1);
  await assert.rejects(worldOf(frame), (error) => error === original);
  assert.equal(creates, 1);
});
