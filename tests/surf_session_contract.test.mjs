import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { createFakeSurf, readyPages, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The kernel `Session` and its surf implementation (implementation plan S6; architecture review
 * A8; adjudication claim 22; mutation-safety packet). Everything here runs against the fake surf
 * fed by the live capture corpus - `npm test` never touches a browser.
 *
 * The cases the packet asks for: the tab closes on every path, observers run after the steps and
 * are torn down before the tab goes, an observer that would act is refused at registration,
 * every surf command answers to the class table, the `js` denylist refuses a dishonest read-only
 * claim before a process exists, a mutating browser step runs once behind a receipt, a step the
 * framework had to kill is `unknown` and locks the key, and a read-only step whose own evidence
 * shows the page moved forfeits its budget.
 */

const { SurfSession, settleSurfAttempt } = await importRuntimeModule("core/surf-session.js");
const { findJsMutationSignals, JS_MUTATION_SIGNALS, SESSION_LIFECYCLE_EFFECT } =
  await importRuntimeModule("core/browser-session.js");
const { createRunContext } = await importRuntimeModule("core/run-context.js");
const { surfEffect } = await importRuntimeModule("core/surf-adapter.js");

const URL_UNDER_TEST = "https://example.com/";

const READ_ONLY_JS = {
  effect: "read_only",
  reason: "reads document.title and nothing else",
};
const MUTATING_JS = {
  effect: "mutating",
  scope: "target",
  reason: "assigns document.title on the page under test",
};

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), "tc-surf-session-"));
}

/**
 * A run whose receipts live in `dir`. The store is inside `$TMPDIR`, which is the ephemeral case
 * operator decision D5 refuses, so these tests accept it explicitly - the way an operator would.
 */
function sessionContext(dir, options = {}) {
  return createRunContext({
    operationId: "surf.explore",
    effect: SESSION_LIFECYCLE_EFFECT,
    env: {
      ...process.env,
      TEST_CAPABILITIES_RECEIPTS_DIR: dir,
      TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    },
    config: { mutation: { allowOrigins: [] } },
    ...options,
  });
}

/** The surf verbs a run issued, without the capability probe every resolution makes. */
function commandsOf(fake) {
  return fake
    .calls()
    .map((call) => call[0])
    .filter((command) => !command.startsWith("--"));
}

function receiptFiles(dir) {
  const runs = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return runs.flatMap((run) =>
    readdirSync(path.join(dir, run.name))
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => JSON.parse(readFileSync(path.join(dir, run.name, entry), "utf8"))),
  );
}

const TITLE_STEP = {
  id: "test.read-title",
  command: "js",
  args: ["document.title"],
  intent: "read the page title",
  declare: READ_ONLY_JS,
  read: (reply) => reply.stdout,
};

/**
 * Drive one session against a fake surf. The session is always closed, so a test that forgets
 * to close still proves the tab was released.
 */
async function withSession(options, body) {
  const fake = createFakeSurf({
    pages: options.pages ?? readyPages({ [URL_UNDER_TEST]: { links: [] } }),
    ...(options.failOn ? { failOn: options.failOn } : {}),
    ...(options.hangOn ? { hangOn: options.hangOn } : {}),
    ...(options.signalOn ? { signalOn: options.signalOn } : {}),
  });
  const dir = scratch();
  try {
    await withFakeSurfEnv(fake.path, async () => {
      const context = sessionContext(dir, options.context ?? {});
      const session = new SurfSession({
        context,
        url: options.url ?? URL_UNDER_TEST,
        idPrefix: "test.session",
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      });
      try {
        if (options.open !== false) {
          await session.open();
        }
        if (options.gate === true) {
          await session.gate();
        }
        await body({ session, fake, context, dir });
      } finally {
        await session.close();
      }
    });
  } finally {
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test("a session opens one tab, gates it once, closes it, and receipts none of that", async () => {
  await withSession({ gate: true }, async ({ session, fake, context }) => {
    assert.equal(session.tab.id, 100);
    assert.equal(session.tab.url, URL_UNDER_TEST);
    assert.equal(session.runId, context.runId);

    await session.close();
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready", "tab.close"]);
    // The run's own tab lifecycle is browser_session scope: nothing about the target changed,
    // so there is nothing to receipt (mutation-safety packet, decision log 2026-09-07).
    assert.deepEqual(context.ledger.receipts(), []);
    assert.deepEqual(
      context.ledger.attempts().map((entry) => entry.code),
      ["ok", "ok", "ok"],
    );
  });
});

test("the tab is closed even when a step threw, and closing twice is one close", async () => {
  await withSession({ gate: true, failOn: ["js"] }, async ({ session, fake }) => {
    await assert.rejects(async () => session.step(TITLE_STEP), /surf exploded/);
    await session.close();
    await session.close();
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready", "js", "tab.close"]);
  });
});

test("a tab that will not close is a note, not a thrown error", async () => {
  await withSession({ gate: true, failOn: ["tab.close"] }, async ({ session }) => {
    await session.close();
    assert.equal(session.notes().length, 1);
    assert.match(session.notes()[0], /could not close owned tab 100/);
  });
});

test("a session refuses a second tab and refuses to work after it closed", async () => {
  await withSession({}, async ({ session }) => {
    await assert.rejects(async () => session.open(), /already owns tab 100/);
    await session.close();
    await assert.rejects(
      async () => session.step(TITLE_STEP),
      /Refusing to run 'js' on a session that is already closed/,
    );
  });
});

test("a step before open() is refused: a run reads only in a tab it created", async () => {
  await withSession({ open: false }, async ({ session, fake }) => {
    await assert.rejects(async () => session.step(TITLE_STEP), {
      code: "owned_tab_required",
      message: /ran before this session opened a tab/,
    });
    assert.deepEqual(commandsOf(fake), []);
  });
});

// ---------------------------------------------------------------------------
// The class table
// ---------------------------------------------------------------------------

test("the adapter's static map answers for every command the packet names", () => {
  const readOnly = [
    "read",
    "page.read",
    "page.state",
    "wait.ready",
    "screenshot",
    "tab.list",
    "network",
    "console",
    "cookie.list",
    "frame.list",
    "frame.diagnose",
    "extract",
    "scroll.down",
    "emulate.device",
  ];
  for (const command of readOnly) {
    assert.equal(surfEffect(command).effect, "read_only", `${command} should be read-only`);
  }

  for (const command of ["tab.new", "tab.close", "tab.switch", "window.new", "frame.switch"]) {
    const effect = surfEffect(command);
    assert.equal(effect.effect, "mutating", `${command} should be mutating`);
    assert.equal(effect.scope, "browser_session", `${command} should be browser_session scope`);
  }

  for (const command of ["click", "type", "key", "select", "do", "go", "tab.reload"]) {
    const effect = surfEffect(command);
    assert.equal(effect.effect, "mutating", `${command} should be mutating`);
    assert.equal(effect.scope, "target", `${command} should act on the target`);
  }

  for (const command of ["js", "wander.aimlessly"]) {
    assert.equal(surfEffect(command).effect, "unclassified", `${command} should carry no class`);
  }
});

test("the session owns the browser lifecycle, so a step may not open or close tabs", async () => {
  await withSession({ gate: true }, async ({ session, fake }) => {
    for (const command of ["tab.new", "tab.close", "tab.switch", "window.close"]) {
      await assert.rejects(
        async () =>
          session.step({
            id: `test.${command}`,
            command,
            args: ["1"],
            intent: "take the browser somewhere else",
            read: (reply) => reply,
          }),
        { code: "owned_tab_required", message: /open\(\) and close\(\) are the only ways in/ },
      );
    }
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready"]);
  });
});

test("a read-only command with no --tab-id mapping is refused rather than run untargeted", async () => {
  await withSession({ gate: true }, async ({ session, fake }) => {
    await assert.rejects(
      async () =>
        session.step({
          id: "test.read",
          command: "read",
          intent: "read whatever is in front",
          read: (reply) => reply,
        }),
      { code: "owned_tab_required", message: /carries no --tab-id/ },
    );
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready"]);
  });
});

test("a step that names another tab is refused; one that names the owned tab passes", async () => {
  await withSession({ gate: true }, async ({ session, fake }) => {
    await assert.rejects(
      async () => session.step({ ...TITLE_STEP, args: ["document.title", "--tab-id", "999"] }),
      { code: "owned_tab_required", message: /this run owns tab 100/ },
    );

    await session.step({ ...TITLE_STEP, args: ["document.title", "--tab-id", "100"] });
    const jsCalls = fake.calls().filter((call) => call[0] === "js");
    assert.equal(jsCalls.length, 1);
    assert.deepEqual(jsCalls[0].slice(-3), ["--tab-id", "100", "--json"]);
  });
});

test("the session points every step at the tab it owns without being asked", async () => {
  await withSession({ gate: true }, async ({ session, fake }) => {
    await session.step(TITLE_STEP);
    const jsCall = fake.calls().find((call) => call[0] === "js");
    assert.ok(jsCall.includes("--tab-id"));
    assert.equal(jsCall[jsCall.indexOf("--tab-id") + 1], "100");
  });
});

test("an unclassified command needs a declaration, and a classified one refuses to take it", async () => {
  await withSession({ gate: true }, async ({ session, fake }) => {
    await assert.rejects(async () => session.step({ ...TITLE_STEP, declare: undefined }), {
      code: "effect_unclassified",
      message: /the surf command 'js' did not declare/,
    });

    await assert.rejects(
      async () =>
        session.step({
          id: "test.extract-as-mutating",
          command: "extract",
          args: ["--code", "return { rows: [] }"],
          intent: "call a read-only command a mutating one",
          declare: MUTATING_JS,
          read: (reply) => reply,
        }),
      {
        code: "effect_declaration_invalid",
        message: /the surf adapter classifies it as 'read_only'/,
      },
    );

    await assert.rejects(
      async () =>
        session.step({
          ...TITLE_STEP,
          declare: { effect: "mutating", scope: "browser_session", reason: "not the target" },
        }),
      { code: "effect_declaration_invalid", message: /declare scope "target"/ },
    );

    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready"]);
  });
});

// ---------------------------------------------------------------------------
// The js denylist
// ---------------------------------------------------------------------------

test("every denylist signal is detected, and the explore probes pass", () => {
  const cases = [
    ["location_assignment", "location.href = 'https://elsewhere.example/'"],
    ["location_assignment", "window.location = target"],
    ["cookie_assignment", "document.cookie = 'a=b'"],
    ["document_assignment", "document.title = 'renamed'"],
    ["field_assignment", "document.querySelector('#q').value = 'surf'"],
    ["field_assignment", "box.checked = true"],
    ["form_submit", "document.forms[0].submit()"],
    ["element_click", "document.querySelector('#go').click()"],
    ["dispatch_event", "el.dispatchEvent(new Event('input'))"],
    ["fetch", "fetch('/api', { method: 'POST' })"],
    ["xhr", "new XMLHttpRequest()"],
    ["storage", "localStorage.setItem('k', 'v')"],
    ["storage", "sessionStorage.clear()"],
    ["storage", "indexedDB.deleteDatabase('x')"],
    ["history", "history.pushState({}, '', '/next')"],
  ];
  for (const [id, code] of cases) {
    const hits = findJsMutationSignals(code);
    assert.ok(
      hits.some((hit) => hit.id === id),
      `${code} should hit ${id}, got ${JSON.stringify(hits)}`,
    );
  }

  const honest = [
    "document.title",
    "(() => ({ href: location.href, title: document.title, readyState: document.readyState }))()",
    "(() => ({ anchors: document.querySelectorAll('a[href]').length, buttons: document.querySelectorAll('button,[role=button],input[type=submit]').length }))()",
    "return (() => { const seen = new Set(); const rows = Array.from(document.querySelectorAll('a[href]')).map((a) => new URL(a.getAttribute('href'), location.href).href).filter((href) => { const url = new URL(href); if (url.origin !== location.origin) return false; url.hash = ''; if (seen.has(url.href)) return false; seen.add(url.href); return true; }).map((href) => ({ href })); return { rows }; })();",
    "document.title === 'x'",
    "el.value !== '' && el.checked === false",
  ];
  for (const code of honest) {
    assert.deepEqual(findJsMutationSignals(code), [], `${code} should pass the denylist`);
  }

  assert.equal(new Set(JS_MUTATION_SIGNALS.map((signal) => signal.id)).size, 11);
});

test("a dishonest read_only script is refused before a process exists", async () => {
  await withSession({ gate: true }, async ({ session, fake }) => {
    await assert.rejects(
      async () => session.evaluate("document.title = 'tc-mutation'", READ_ONLY_JS),
      { code: "read_only_violation", message: /assigns to a document property/ },
    );
    await assert.rejects(
      async () =>
        session.step({
          id: "test.extract-clicks",
          command: "extract",
          args: ["--code", "document.querySelector('#go').click(); return { rows: [] }"],
          intent: "an extract script that clicks",
          read: (reply) => reply,
        }),
      { code: "read_only_violation", message: /clicks an element/ },
    );
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready"]);
  });
});

// ---------------------------------------------------------------------------
// Mutating browser steps
// ---------------------------------------------------------------------------

test("a declared-mutating script runs once behind a receipt, and the key is spent", async () => {
  await withSession(
    {
      gate: true,
      context: { config: { mutation: { allowOrigins: ["https://example.com"] } } },
    },
    async ({ session, fake, context, dir }) => {
      const value = await session.evaluate("document.title = 'tc-session-dogfood'", MUTATING_JS, {
        id: "test.assign-title",
        intent: "assign the page title",
      });
      assert.equal(value, "tc-session-dogfood");

      const receipts = context.ledger.receipts();
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0].outcome, "applied");
      assert.equal(receipts[0].effect, "mutating");
      assert.equal(receipts[0].scope, "target");
      assert.equal(receipts[0].subject, `${URL_UNDER_TEST} tab=100`);
      assert.equal(receiptFiles(dir).length, 1);

      await assert.rejects(
        async () =>
          session.evaluate("document.title = 'tc-session-dogfood'", MUTATING_JS, {
            id: "test.assign-title",
            intent: "assign the page title",
          }),
        { code: "mutation_replay_refused" },
      );
      assert.equal(fake.calls().filter((call) => call[0] === "js").length, 1);
    },
  );
});

test("a mutating script on an origin the operator did not name never reaches the browser", async () => {
  await withSession({ gate: true }, async ({ session, fake }) => {
    await assert.rejects(async () => session.evaluate("document.title = 'nope'", MUTATING_JS), {
      code: "mutation_origin_not_allowed",
      message: /mutation\.allowOrigins does not name it/,
    });
    assert.equal(fake.calls().filter((call) => call[0] === "js").length, 0);
  });
});

test("a mutating script the framework had to kill is unknown, and the receipt locks the key", async () => {
  const fake = createFakeSurf({
    pages: readyPages({ [URL_UNDER_TEST]: { links: [] } }),
    hangOn: ["js"],
  });
  const dir = scratch();
  try {
    await withFakeSurfEnv(fake.path, async () => {
      const allowOrigins = { config: { mutation: { allowOrigins: ["https://example.com"] } } };
      const first = sessionContext(dir, allowOrigins);
      const session = new SurfSession({
        context: first,
        url: URL_UNDER_TEST,
        idPrefix: "test.session",
        timeoutMs: 700,
      });
      await session.open();
      await assert.rejects(
        async () =>
          session.evaluate("document.title = 'tc-hang'", MUTATING_JS, { id: "test.hang" }),
        { code: "mutation_outcome_unknown", message: /--supersede-receipt/ },
      );
      await session.close();

      const [receipt] = receiptFiles(dir);
      assert.equal(receipt.outcome, "unknown");
      assert.ok(
        receipt.evidence.some((line) => line === "basis:indeterminate"),
        `the receipt should record the indeterminate basis: ${JSON.stringify(receipt.evidence)}`,
      );

      // A second run, a new run id, the same store: the in-doubt receipt refuses the repeat.
      const second = sessionContext(dir, allowOrigins);
      const rerun = new SurfSession({
        context: second,
        url: URL_UNDER_TEST,
        idPrefix: "test.session",
        timeoutMs: 700,
      });
      await rerun.open();
      await assert.rejects(
        async () => rerun.evaluate("document.title = 'tc-hang'", MUTATING_JS, { id: "test.hang" }),
        { code: "mutation_replay_refused", message: new RegExp(receipt.receipt_id) },
      );
      await rerun.close();
      assert.equal(receiptFiles(dir).length, 1);
    });
  } finally {
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a mutating script whose process died on a signal is unknown, not failed", async () => {
  await withSession(
    {
      gate: true,
      signalOn: ["js"],
      context: { config: { mutation: { allowOrigins: ["https://example.com"] } } },
    },
    async ({ session, context, dir }) => {
      await assert.rejects(
        async () =>
          session.evaluate("document.title = 'tc-signal'", MUTATING_JS, { id: "test.signal" }),
        { code: "mutation_outcome_unknown" },
      );
      const [receipt] = receiptFiles(dir);
      assert.equal(receipt.outcome, "unknown");
      assert.equal(receipt.error.code, "signal_SIGTERM");
      assert.ok(receipt.evidence.includes("basis:indeterminate"));
      assert.equal(context.ledger.receipts()[0].outcome, "unknown");
    },
  );
});

test("settleSurfAttempt keeps an unattributable reply out of the failed column", () => {
  assert.deepEqual(settleSurfAttempt({ attempt: 1, value: "ok" }), { outcome: "applied" });
  assert.equal(settleSurfAttempt({ attempt: 1, error: new Error("boom") }).outcome, "failed");
});

// ---------------------------------------------------------------------------
// Read-only budget and revocation
// ---------------------------------------------------------------------------

test("a read-only step retries within its budget and every attempt is in the ledger", async () => {
  await withSession(
    {
      gate: true,
      pages: readyPages({ [URL_UNDER_TEST]: { links: [], jsThrows: "the page blew up" } }),
    },
    async ({ session, fake, context }) => {
      await assert.rejects(
        async () => session.step({ ...TITLE_STEP, maxAttempts: 2 }),
        /the page blew up/,
      );
      assert.equal(fake.calls().filter((call) => call[0] === "js").length, 2);
      const attempts = context.ledger.attempts().filter((entry) => entry.stepId === TITLE_STEP.id);
      assert.deepEqual(attempts, [
        { stepId: TITLE_STEP.id, attempt: 1, code: "browser_error" },
        { stepId: TITLE_STEP.id, attempt: 2, code: "browser_error" },
      ]);
    },
  );
});

test("a read-only attempt whose evidence shows the page moved forfeits the rest of its budget", async () => {
  await withSession({ gate: true }, async ({ session, fake, context }) => {
    class Moved extends Error {}
    await assert.rejects(
      async () =>
        session.step({
          ...TITLE_STEP,
          maxAttempts: 3,
          read: () => {
            throw new Moved("the probe answered from https://elsewhere.example/");
          },
          observe: (attempt) =>
            attempt.error instanceof Moved ? attempt.error.message : undefined,
        }),
      {
        code: "read_only_violation_observed",
        message: /remaining retry budget is forfeit after attempt 1/,
      },
    );
    // Observation cannot prevent the first attempt; it prevents the repeat.
    assert.equal(fake.calls().filter((call) => call[0] === "js").length, 1);
    assert.equal(context.ledger.receipts().length, 0);
  });
});

// ---------------------------------------------------------------------------
// Observers
// ---------------------------------------------------------------------------

test("observers run after the steps and are torn down before the tab closes", async () => {
  const order = [];
  await withSession({ gate: true }, async ({ session, fake }) => {
    session.observe("first", {
      effect: { effect: "read_only", reason: "reads what the steps left" },
      intent: "first observation",
      run: async () => {
        order.push("run:first");
        return { seen: true };
      },
      teardown: async () => {
        order.push("teardown:first");
      },
    });
    session.observe("second", {
      effect: { effect: "read_only", reason: "reads what the steps left" },
      intent: "second observation",
      run: async () => {
        order.push("run:second");
      },
      teardown: async () => {
        order.push("teardown:second");
      },
    });

    await session.step(TITLE_STEP);
    order.push("step");
    const observations = await session.runObservers();
    assert.deepEqual(
      observations.map((observation) => [observation.name, observation.status]),
      [
        ["first", "ok"],
        ["second", "ok"],
      ],
    );
    assert.deepEqual(observations[0].value, { seen: true });

    await session.close();
    assert.deepEqual(order, [
      "step",
      "run:first",
      "run:second",
      "teardown:second",
      "teardown:first",
    ]);
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready", "js", "tab.close"]);
  });
});

test("an observer that would act is refused at registration, and so is a duplicate name", async () => {
  await withSession({ gate: true }, async ({ session }) => {
    assert.throws(
      () =>
        session.observe("mutating", {
          effect: { effect: "mutating", scope: "target", reason: "clicks around" },
          intent: "act during observation",
          run: async () => undefined,
        }),
      { code: "effect_declaration_invalid", message: /An observer audits/ },
    );
    assert.throws(
      () =>
        session.observe("unclassified", {
          effect: undefined,
          intent: "no class at all",
          run: async () => undefined,
        }),
      { code: "effect_unclassified" },
    );

    const observer = {
      effect: { effect: "read_only", reason: "reads" },
      intent: "once",
      run: async () => undefined,
    };
    session.observe("only-once", observer);
    assert.throws(() => session.observe("only-once", observer), {
      code: "unsupported_surf_action",
      message: /register the observer 'only-once' twice/,
    });
  });
});

test("an optional observer that fails is unavailable; a required one fails the run", async () => {
  await withSession({ gate: true }, async ({ session }) => {
    session.observe("optional", {
      effect: { effect: "read_only", reason: "reads" },
      intent: "optional channel",
      run: async () => {
        throw new Error("the channel is not installed");
      },
    });
    const observations = await session.runObservers();
    assert.equal(observations[0].status, "unavailable");
    assert.match(observations[0].error, /not installed/);
    assert.deepEqual(session.observations(), observations);
  });

  await withSession({ gate: true }, async ({ session }) => {
    session.observe("required", {
      effect: { effect: "read_only", reason: "reads" },
      intent: "required channel",
      required: true,
      run: async () => {
        throw new Error("the channel is not installed");
      },
    });
    await assert.rejects(async () => session.runObservers(), /not installed/);
    assert.equal(session.observations()[0].status, "failed");
  });
});

// ---------------------------------------------------------------------------
// Seams later slices fill
// ---------------------------------------------------------------------------

test("the seams S8 fills refuse loudly instead of guessing", async () => {
  await withSession({ gate: true }, async ({ session, fake }) => {
    for (const call of [
      () => session.apply({ plan: { plan_id: "p1" }, mode: "fill" }),
      () => session.explainUnreachable("#submit"),
    ]) {
      await assert.rejects(call, {
        code: "unsupported_surf_action",
        message: /declared but not implemented in this build/,
      });
    }
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready"]);
  });
});

test("plan refuses on a session that was never gated, before any page is read", async () => {
  await withSession({ gate: false }, async ({ session, fake }) => {
    await assert.rejects(() => session.plan({ fields: [] }), {
      code: "page_not_ready",
      message: /before the readiness gate ran/,
    });
    assert.deepEqual(commandsOf(fake), ["tab.new"]);
  });
});
