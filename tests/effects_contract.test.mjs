import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import {
  importRuntimeModule,
  resolveRuntimeDistRoot,
  runtimeModuleUrl,
} from "./helpers/runtime-dist.mjs";

const {
  MutationError,
  MutationLedger,
  idempotencyKeyFor,
  resolveEffectDeclaration,
  webOriginOf,
  worstEffect,
} = await importRuntimeModule("core/effects.js");
const { createRunContext } = await importRuntimeModule("core/run-context.js");
const { FrameworkError } = await importRuntimeModule("core/runtime-contract.js");

/** The real carrier: a fabricated error shape would not prove anything about the ledger. */
function framework(code, message = `raised ${code}`, details) {
  return new FrameworkError(code, message, details);
}

const READ_ONLY = { effect: "read_only", reason: "reads the page" };
const MUTATING = { effect: "mutating", scope: "target", reason: "clicks the button" };
const WORKSPACE = { effect: "mutating", scope: "workspace", reason: "rewrites the file" };

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), "tc-effects-"));
}

/**
 * A run whose receipts live in `dir`. The store is inside `$TMPDIR`, which is exactly the
 * ephemeral case operator decision D5 refuses, so the tests that are not about D5 accept it
 * explicitly - the same way an operator would.
 */
function contextFor(dir, extra = {}) {
  return createRunContext({
    operationId: "heal",
    effect: MUTATING,
    env: {
      ...process.env,
      TEST_CAPABILITIES_RECEIPTS_DIR: dir,
      TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    },
    config: { mutation: { allowOrigins: ["https://example.com"] } },
    ...extra,
  });
}

function step(overrides = {}) {
  return {
    id: "step.one",
    effect: MUTATING,
    subject: "https://example.com/ tab=7",
    intent: "assign the title",
    run: async () => "done",
    ...overrides,
  };
}

function storedReceipts(dir) {
  const runs = readdirSync(dir);
  return runs.flatMap((run) =>
    readdirSync(path.join(dir, run)).map((file) =>
      JSON.parse(readFileSync(path.join(dir, run, file), "utf8")),
    ),
  );
}

test("a step without one of the two classes is refused before anything runs", async () => {
  const context = contextFor(scratch(), { config: { mutation: { allowOrigins: [] } } });
  let ran = false;
  await assert.rejects(
    context.ledger.runStep(
      step({
        effect: undefined,
        run: async () => {
          ran = true;
        },
      }),
    ),
    (error) => {
      assert.equal(error.code, "effect_unclassified");
      assert.match(error.message, /no default class/);
      return true;
    },
  );
  assert.equal(ran, false);

  assert.throws(() => resolveEffectDeclaration({ effect: "maybe", reason: "x" }, "operation 'x'"), {
    code: "effect_unclassified",
  });
  assert.throws(() => resolveEffectDeclaration({ effect: "mutating", reason: "x" }, "step 'x'"), {
    code: "effect_declaration_invalid",
  });
  assert.throws(() => resolveEffectDeclaration({ effect: "read_only", reason: "" }, "step 'x'"), {
    code: "effect_declaration_invalid",
  });
  assert.throws(
    () => resolveEffectDeclaration({ effect: "read_only", scope: "target", reason: "x" }, "step"),
    { code: "effect_declaration_invalid" },
  );
  assert.deepEqual(resolveEffectDeclaration(READ_ONLY, "step 'x'"), READ_ONLY);
  assert.deepEqual(
    resolveEffectDeclaration(
      { effect: "read_only", scope: "browser_session", reason: "owns its tab" },
      "step",
    ).scope,
    "browser_session",
  );
});

test("a mutating step may not declare a retry budget", async () => {
  const context = contextFor(scratch());
  for (const overrides of [{ maxAttempts: 2 }, { retryOn: ["timeout"] }]) {
    await assert.rejects(context.ledger.runStep(step(overrides)), (error) => {
      assert.equal(error.code, "mutation_retry_refused");
      assert.match(error.message, /attempted exactly once/);
      return true;
    });
  }
});

test("a read-only step may not carry a precondition, a verify or an unbounded budget", async () => {
  const context = contextFor(scratch());
  for (const overrides of [
    { effect: READ_ONLY, precondition: "sha256:aa" },
    { effect: READ_ONLY, verify: async () => ({ result: "applied", evidence: ["x"] }) },
    { effect: READ_ONLY, maxAttempts: 4 },
  ]) {
    await assert.rejects(context.ledger.runStep(step(overrides)), {
      code: "effect_declaration_invalid",
    });
  }

  await assert.rejects(
    context.ledger.runStep(step({ effect: MUTATING, precondition: "sha256:aa" })),
    (error) => {
      assert.equal(error.code, "effect_declaration_invalid");
      assert.match(error.message, /only workspace writes/);
      return true;
    },
  );
  await assert.rejects(
    context.ledger.runStep(step({ effect: WORKSPACE, precondition: "sha256:aa" })),
    (error) => {
      assert.match(error.message, /no way to re-read it/);
      return true;
    },
  );
});

test("a read-only step retries only on a transient code and never past its budget", async () => {
  const context = contextFor(scratch());
  const attemptsFor = async (code, failUntil, maxAttempts = 3) => {
    const seen = [];
    const promise = context.ledger.runStep(
      step({
        id: `read.${code}.${maxAttempts}`,
        effect: READ_ONLY,
        maxAttempts,
        run: async (attempt) => {
          seen.push(attempt);
          if (attempt < failUntil) {
            throw framework(code);
          }
          return `settled on attempt ${attempt}`;
        },
      }),
    );
    return { seen, promise };
  };

  const transient = await attemptsFor("browser_error", 2);
  assert.equal(await transient.promise, "settled on attempt 2");
  assert.deepEqual(transient.seen, [1, 2]);

  for (const code of ["page_login", "empty_result", "probe_unverified"]) {
    const refusal = await attemptsFor(code, 3);
    await assert.rejects(refusal.promise, { code });
    assert.deepEqual(refusal.seen, [1], `${code} is a settled answer, not a transient failure`);
  }

  const exhausted = await attemptsFor("timeout", 9, 2);
  await assert.rejects(exhausted.promise, { code: "timeout" });
  assert.deepEqual(exhausted.seen, [1, 2], "the declared budget is the whole budget");

  assert.deepEqual(
    context.ledger.attempts().filter((entry) => entry.stepId === "read.browser_error.3"),
    [
      { stepId: "read.browser_error.3", attempt: 1, code: "browser_error" },
      { stepId: "read.browser_error.3", attempt: 2, code: "ok" },
    ],
  );
  assert.equal(context.ledger.receipts().length, 0, "a read-only step writes no receipt");
});

test("the attempting receipt is on disk before the step runs and is rewritten after it", async () => {
  const dir = scratch();
  const context = contextFor(dir);
  let duringAct;
  const value = await context.ledger.runStep(
    step({
      run: async () => {
        duringAct = storedReceipts(dir);
        return "clicked";
      },
    }),
  );

  assert.equal(value, "clicked");
  assert.equal(duringAct.length, 1, "the receipt must exist before the act, not after it");
  assert.equal(duringAct[0].outcome, "attempting");
  assert.equal(duringAct[0].finished_at, undefined);
  assert.equal(duringAct[0].ephemeral_store, true, "an accepted ephemeral store is recorded");

  const after = storedReceipts(dir);
  assert.equal(after.length, 1, "the finalising write replaces the same receipt");
  assert.equal(after[0].receipt_id, duringAct[0].receipt_id);
  assert.equal(after[0].outcome, "applied");
  assert.match(after[0].finished_at, /^\d{4}-/);
  assert.equal(after[0].evidence[0], "declared: clicks the button");
  assert.equal(context.ledger.receipts().length, 1);
  assert.equal(context.ledger.envelopeReceipts()[0].path.endsWith(".json"), true);
});

test("the attempting receipt is fsynced before the act", async () => {
  const dir = scratch();
  const context = contextFor(dir);
  const realFsync = fs.fsyncSync;
  let syncsBeforeAct = 0;
  let syncs = 0;
  fs.fsyncSync = (descriptor) => {
    syncs += 1;
    return realFsync(descriptor);
  };
  try {
    await context.ledger.runStep(
      step({
        run: async () => {
          syncsBeforeAct = syncs;
          return "ok";
        },
      }),
    );
  } finally {
    fs.fsyncSync = realFsync;
  }
  assert.equal(syncsBeforeAct, 2, "file and directory are fsynced before the step runs");
});

test("the same key twice in one run is refused, even after a definite failure", async () => {
  const dir = scratch();
  const context = contextFor(dir);
  const failing = step({
    run: async () => {
      throw new Error("the target refused");
    },
  });

  await assert.rejects(context.ledger.runStep(failing), /the target refused/);
  assert.equal(storedReceipts(dir)[0].outcome, "failed");
  assert.equal(storedReceipts(dir)[0].error.code, "unclassified_error");

  await assert.rejects(context.ledger.runStep(step()), (error) => {
    assert.equal(error.code, "mutation_replay_refused");
    assert.match(error.message, /in this run/);
    return true;
  });
});

test("an in-doubt receipt from an earlier run refuses the next one until it is superseded", async () => {
  const dir = scratch();
  const first = contextFor(dir);
  await assert.rejects(
    first.ledger.runStep(
      step({
        run: async () => {
          throw framework("timeout", "surf timed out");
        },
      }),
    ),
    (error) => {
      assert.equal(error.code, "mutation_outcome_unknown");
      assert.match(error.message, /nothing is known/i);
      assert.match(error.message, /--supersede-receipt /);
      assert.equal(error.receipts.length, 1);
      assert.equal(error.receipts[0].outcome, "unknown");
      return true;
    },
  );
  const [inDoubt] = storedReceipts(dir);
  assert.equal(inDoubt.outcome, "unknown");

  const second = contextFor(dir);
  await assert.rejects(second.ledger.runStep(step()), (error) => {
    assert.equal(error.code, "mutation_replay_refused");
    assert.match(error.message, new RegExp(`--supersede-receipt ${inDoubt.receipt_id}`));
    assert.equal(error.details.supersede_with, `--supersede-receipt ${inDoubt.receipt_id}`);
    return true;
  });

  const superseding = contextFor(dir, { supersedeReceiptId: inDoubt.receipt_id });
  assert.equal(await superseding.ledger.runStep(step()), "done");
  const receipts = storedReceipts(dir);
  assert.equal(receipts.length, 2, "the superseded receipt is never deleted or rewritten");
  const written = receipts.find((receipt) => receipt.receipt_id !== inDoubt.receipt_id);
  assert.equal(written.supersedes, inDoubt.receipt_id);
  assert.equal(written.outcome, "applied");
  assert.deepEqual(
    storedReceipts(dir).find((receipt) => receipt.receipt_id === inDoubt.receipt_id),
    inDoubt,
  );
});

test("a definite outcome does not block a later run", async () => {
  const dir = scratch();
  const first = contextFor(dir);
  await assert.rejects(
    first.ledger.runStep(
      step({
        run: async () => {
          throw new Error("the target refused");
        },
      }),
    ),
  );
  const second = contextFor(dir);
  assert.equal(await second.ledger.runStep(step()), "done");
});

test("a verify may promote unknown to applied and may never produce failed", async () => {
  const dir = scratch();
  const promoted = await contextFor(dir).ledger.runStep(
    step({
      settle: () => ({ outcome: "unknown", evidence: ["the tab navigated away"] }),
      verify: async () => ({ result: "applied", evidence: ["title: tc-mutation-dogfood"] }),
    }),
  );
  assert.equal(promoted, "done");
  const [receipt] = storedReceipts(dir);
  assert.equal(receipt.outcome, "applied");
  assert.equal(receipt.verified_by, "post_read");
  assert.deepEqual(receipt.evidence.slice(-2), ["verify: applied", "title: tc-mutation-dogfood"]);

  const indeterminateDir = scratch();
  await assert.rejects(
    contextFor(indeterminateDir).ledger.runStep(
      step({
        settle: () => ({ outcome: "unknown" }),
        verify: async () => ({ result: "indeterminate", evidence: ["title: Example Domain"] }),
      }),
    ),
    { code: "mutation_outcome_unknown" },
  );
  assert.equal(storedReceipts(indeterminateDir)[0].outcome, "unknown");
  assert.equal(storedReceipts(indeterminateDir)[0].verified_by, undefined);

  await assert.rejects(
    contextFor(scratch()).ledger.runStep(
      step({
        settle: () => ({ outcome: "unknown" }),
        verify: async () => ({ result: "applied", evidence: [] }),
      }),
    ),
    (error) => {
      assert.equal(error.code, "effect_declaration_invalid");
      assert.match(error.message, /evidence specific to the intent/);
      return true;
    },
  );
});

test("settle may not turn a returned value into a failure or a thrown step into a success", async () => {
  await assert.rejects(
    contextFor(scratch()).ledger.runStep(step({ settle: () => ({ outcome: "failed" }) })),
    (error) => {
      assert.match(error.message, /a step that knows it failed throws/i);
      return true;
    },
  );
  await assert.rejects(
    contextFor(scratch()).ledger.runStep(
      step({
        run: async () => {
          throw new Error("nope");
        },
        settle: () => ({ outcome: "applied" }),
      }),
    ),
    (error) => {
      assert.match(error.message, /only a verify\(\) post-read may promote/i);
      return true;
    },
  );
});

test("a workspace write is conditional on the content it was planned against", async () => {
  const dir = scratch();
  const file = path.join(dir, "login.spec.ts");
  writeFileSync(file, "page.click('#btn')\n");
  let wrote = false;
  await assert.rejects(
    contextFor(dir).ledger.runStep(
      step({
        id: `heal.apply:${file}`,
        effect: WORKSPACE,
        subject: file,
        precondition: "sha256:planned",
        readPrecondition: async () => "sha256:drifted",
        run: async () => {
          wrote = true;
        },
      }),
    ),
    (error) => {
      assert.equal(error.code, "precondition_failed");
      assert.match(error.message, /Nothing was written/);
      return true;
    },
  );
  assert.equal(wrote, false);
  assert.deepEqual(
    readdirSync(dir).filter((entry) => entry !== "login.spec.ts"),
    [],
    "a refusal that changed nothing leaves no locked key behind",
  );
});

test("a mutating step on a web origin outside mutation.allowOrigins never spawns", async () => {
  const dir = scratch();
  let ran = false;
  const refusing = contextFor(dir, { config: { mutation: { allowOrigins: [] } } });
  await assert.rejects(
    refusing.ledger.runStep(
      step({
        run: async () => {
          ran = true;
        },
      }),
    ),
    (error) => {
      assert.equal(error.code, "mutation_origin_not_allowed");
      assert.match(error.message, /mutation\.allowOrigins does not name it/);
      assert.equal(error.details.origin, "https://example.com");
      return true;
    },
  );
  assert.equal(ran, false);
  assert.deepEqual(readdirSync(dir), [], "no receipt is written for a step that never ran");

  assert.equal(await contextFor(dir).ledger.runStep(step()), "done");

  // a workspace subject is not a web origin and never consults the allowlist
  assert.equal(webOriginOf("/abs/tests/login.spec.ts"), undefined);
  assert.equal(webOriginOf("https://example.com/a/b tab=3"), "https://example.com");
});

test("a read-only step whose own evidence shows the target moved forfeits its budget", async () => {
  const context = contextFor(scratch());
  let attempts = 0;
  await assert.rejects(
    context.ledger.runStep(
      step({
        effect: READ_ONLY,
        maxAttempts: 3,
        run: async () => {
          attempts += 1;
          return { href: "https://example.com/checkout/done" };
        },
        observe: ({ value }) =>
          value.href.startsWith("https://example.com/checkout/done")
            ? `href left the accepted set: ${value.href}`
            : undefined,
      }),
    ),
    (error) => {
      assert.equal(error.code, "read_only_violation_observed");
      assert.match(error.message, /observation cannot prevent the first attempt/);
      return true;
    },
  );
  assert.equal(attempts, 1);
  assert.deepEqual(context.ledger.attempts(), [{ stepId: "step.one", attempt: 1, code: "ok" }]);
});

test("an ephemeral receipt store refuses a mutating step unless the operator accepted it", async () => {
  const dir = scratch();
  const refusing = createRunContext({
    operationId: "heal",
    effect: WORKSPACE,
    env: { ...process.env, TEST_CAPABILITIES_RECEIPTS_DIR: dir, CI: "", TMPDIR: os.tmpdir() },
    config: { mutation: { allowOrigins: [] } },
  });
  assert.match(refusing.config.receipts.ephemeralDetected, /temporary directory/);

  let ran = false;
  await assert.rejects(
    refusing.ledger.runStep(
      step({
        subject: "/abs/file.ts",
        effect: WORKSPACE,
        run: async () => {
          ran = true;
        },
      }),
    ),
    (error) => {
      assert.equal(error.code, "mutation_receipts_ephemeral");
      assert.match(error.message, /receipts\.ephemeral: true/);
      assert.match(error.message, /TEST_CAPABILITIES_RECEIPTS_EPHEMERAL=1/);
      assert.match(error.message, /is not an interlock/);
      return true;
    },
  );
  assert.equal(ran, false);
  assert.deepEqual(readdirSync(dir), []);
});

test("a receipt survives a process that is killed mid-step and refuses the rerun", () => {
  const dir = scratch();
  const script = path.join(dir, "die-mid-step.mjs");
  writeFileSync(
    script,
    `import { createRunContext } from ${JSON.stringify(runtimeModuleUrl("core/run-context.js"))};
const context = createRunContext({
  operationId: "heal",
  effect: { effect: "mutating", scope: "target", reason: "clicks the button" },
  env: { ...process.env, TEST_CAPABILITIES_RECEIPTS_DIR: ${JSON.stringify(`${dir}/receipts`)}, TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1" },
  config: { mutation: { allowOrigins: ["https://example.com"] } },
});
await context.ledger.runStep({
  id: "step.one",
  effect: { effect: "mutating", scope: "target", reason: "clicks the button" },
  subject: "https://example.com/ tab=7",
  intent: "assign the title",
  run: async () => {
    process.kill(process.pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  },
});
`,
  );

  assert.throws(() => execFileSync(process.execPath, [script], { stdio: "pipe" }));

  const stranded = storedReceipts(path.join(dir, "receipts"));
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0].outcome, "attempting", "the record outlives the process that made it");

  const next = createRunContext({
    operationId: "heal",
    effect: { effect: "mutating", scope: "target", reason: "clicks the button" },
    env: {
      ...process.env,
      TEST_CAPABILITIES_RECEIPTS_DIR: path.join(dir, "receipts"),
      TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
    },
    config: { mutation: { allowOrigins: ["https://example.com"] } },
  });
  return assert.rejects(next.ledger.runStep(step()), (error) => {
    assert.equal(error.code, "mutation_replay_refused");
    assert.match(error.message, new RegExp(`--supersede-receipt ${stranded[0].receipt_id}`));
    return true;
  });
});

test("the idempotency key and the worst class are derived, not declared", () => {
  const key = idempotencyKeyFor("heal", { id: "a", subject: "b", intent: "c" });
  assert.match(key, /^sha256:[0-9a-f]{64}$/);
  assert.equal(key, idempotencyKeyFor("heal", { id: "a", subject: "b", intent: "c" }));
  assert.notEqual(key, idempotencyKeyFor("heal", { id: "a", subject: "b", intent: "d" }));

  assert.deepEqual(worstEffect([READ_ONLY, MUTATING, READ_ONLY]), MUTATING);
  assert.deepEqual(worstEffect([READ_ONLY]), READ_ONLY);
  assert.equal(worstEffect([]).effect, "read_only");
});

test("the ledger reads the store back for the submit gate's per-plan rule", async () => {
  const dir = scratch();
  const context = contextFor(dir);
  await context.ledger.runStep(step({ details: { plan_id: "plan-1", mode: "submit" } }));
  assert.equal((await context.ledger.listReceipts({ planId: "plan-1", mode: "submit" })).length, 1);
  assert.equal((await context.ledger.listReceipts({ planId: "plan-2" })).length, 0);
  assert.equal(new MutationLedger(context).receipts().length, 0);
  assert.equal(typeof resolveRuntimeDistRoot(), "string");
  assert.equal(new MutationError("effect_unclassified", "x").receipts.length, 0);
});
