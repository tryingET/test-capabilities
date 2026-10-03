import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { createFakeSurf, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * `surf apply` on a top-document form over the DevTools connection (AK #6157). When the
 * connection binds the owned tab, the plan's steps run in the page's own frame through the
 * frame path of CDP program S3 - every act checked against its document just before input - and
 * the tab is pinned by its target id, so the observation after a submit that navigates it still
 * reaches it. Without the connection the steps run on surf, as before, and the envelope says so.
 * `surf plan` reads a top-document form the same way (AK #6165): its probe runs over the
 * connection when it binds the owned tab, on surf otherwise, and `result.channel` says which.
 */

const { executeCliOperation } = await importRuntimeModule("core/operations.js");
const { openCdpActions } = await importRuntimeModule("core/cdp-actions.js");
const { CdpConnection } = await importRuntimeModule("core/a11y-cdp.js");
const { SurfSession } = await importRuntimeModule("core/surf-session.js");

const FORM = "https://shop.example/pay";
const LANDED = "https://shop.example/pay?step=1";
const DONE = "https://shop.example/done";
const ax = (id, role, name, backendDOMNodeId, children = []) => ({
  nodeId: id,
  role: { value: role },
  ...(name ? { name: { value: name } } : {}),
  ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
  childIds: children,
});

/** One form, as both fakes see it: the stub-DOM model, and elements with boxes for input. */
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
  controls: [
    { selector: "#pay", kind: "submit", text: "Pay", form: "#pay-form" },
    { selector: "#save", kind: "button", text: "Save card", form: "#pay-form" },
  ],
};

function cdpTree(url) {
  return {
    url,
    nodes: [ax("1", "RootWebArea", "Pay", 0)],
    elements: {
      "#card": { backendNodeId: 21, box: [10, 10, 200, 20] },
      "#country": {
        backendNodeId: 22,
        box: [10, 40, 100, 20],
        options: [
          { value: "de", label: "Germany" },
          { value: "fr", label: "France" },
        ],
      },
      "#pay": { backendNodeId: 23, box: [10, 70, 60, 20], navigatesTo: DONE },
      "#save": { backendNodeId: 24, box: [100, 70, 60, 20] },
    },
    form: structuredClone(FORM_MODEL),
  };
}

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
      "surf:",
      "  submit:",
      "    postcondition_timeout_ms: 600",
      "",
    ].join("\n"),
  );
  return file;
}

function receiptsIn(dir) {
  const root = path.join(dir, "receipts");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((run) =>
      readdirSync(path.join(root, run.name))
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => JSON.parse(readFileSync(path.join(root, run.name, entry), "utf-8"))),
    )
    .filter((artifact) => artifact.artifact_kind === "test-capabilities.mutation.receipt");
}

/**
 * A fake surf with the form at FORM (landing at `landed`), and - unless `cdp: false` - a fake
 * DevTools endpoint holding the same page at the URL the tab landed on.
 */
async function withFakes(
  body,
  {
    cdp: withCdp = true,
    landed = FORM,
    otherTab = false,
    surfFailOn,
    stdio,
    log,
    holdCloseReply,
  } = {},
) {
  const surf = createFakeSurf({
    ...(surfFailOn ? { failOn: surfFailOn } : {}),
    ...(stdio ? { stdio } : {}),
    ...(log ? { log } : {}),
    pages: {
      [FORM]: {
        ...structuredClone(FORM_MODEL),
        url: landed,
        readiness: "ready",
        links: [],
        changeNavigatesTo: DONE,
      },
      [DONE]: { title: "Done", readiness: "ready", links: [] },
    },
  });
  const tree = cdpTree(landed);
  // another tab at the same URL: the one the endpoint lists is not the document surf opened
  if (otherTab) tree.timeOrigin = 1;
  const cdp = withCdp
    ? await startFakeCdp({
        pages: { P1: { url: landed, tree } },
        ...(log ? { log } : {}),
        holdCloseReply,
      })
    : undefined;
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-apply-cdp-"));
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  if (cdp) process.env.TEST_CAPABILITIES_CDP_ENDPOINT = cdp.url;
  try {
    await withFakeSurfEnv(surf.path, async () => {
      await body({
        surf,
        cdp,
        tree,
        dir,
        out: path.join(dir, "plan.json"),
        config: writeConfig(dir),
      });
    });
  } finally {
    if (previous === undefined) delete process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
    else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = previous;
    surf.cleanup();
    await cdp?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const plan = (input) => executeCliOperation({ command: "surf", action: "plan" }, input);
const apply = (input) => executeCliOperation({ command: "surf", action: "apply" }, input);
const readPlan = (out) => JSON.parse(readFileSync(out, "utf-8"));
const TAB_PROOF = "String(performance.timeOrigin)";
const verbs = (surf) =>
  surf
    .calls()
    // the one read that proves the DevTools target is the owned tab is set apart: `proofs`
    .filter((call) => call[1] !== TAB_PROOF)
    .map((call) => call[0])
    .filter((command) => !command.startsWith("--"));
const proofs = (surf) => surf.calls().filter((call) => call[1] === TAB_PROOF).length;
const ACTING = ["js", "type", "select", "click"];

test("a press dialog cancels held input away from the submit control", async () => {
  await withFakes(async ({ cdp, tree, dir, out, config }) => {
    await plan({ url: FORM, field: FIELDS, out, config });
    tree.elements["#pay"].pressDialog = { type: "confirm", message: "Press?" };
    await assert.rejects(
      apply({ plan: out, submit: true, confirmPlan: readPlan(out).approval_token, config }),
      { code: "action_dialog_opened" },
    );
    assert.equal(cdp.clicks.length, 0);
    assert.equal(tree.url, FORM);
    assert.ok(
      cdp.input.some((event) => event.type === "mouseReleased" && event.x === -1 && event.y === -1),
    );
    assert.equal(
      receiptsIn(dir).find((entry) => entry.details.mode === "submit").outcome,
      "unknown",
    );
  });
});

for (const failedAnswer of [false, true]) {
  test(`a focus dialog stops before text input, reports its actual answer, and stays private (failedAnswer=${failedAnswer})`, async () => {
    await withFakes(async ({ cdp, tree, dir, out, config }) => {
      await plan({ url: FORM, field: FIELDS, out, config });
      const secret = `private-card sha256:${"a".repeat(64)}`;
      tree.elements["#card"].focusDialog = { type: "prompt", message: secret };
      tree.dialogHandleFails = failedAnswer;
      await assert.rejects(apply({ plan: out, config }), (error) => {
        assert.equal(error.code, "action_dialog_opened");
        assert.doesNotMatch(JSON.stringify(error), /private-card/);
        return true;
      });
      const [receipt] = receiptsIn(dir);
      assert.equal(receipt.outcome, "unknown");
      const [dialog] = JSON.parse(
        receipt.evidence.find((line) => line.startsWith("dialogs:")).slice(8),
      );
      assert.equal(dialog.message, secret);
      assert.equal(dialog.answer, failedAnswer ? "unanswered" : "dismissed");
      assert.deepEqual(cdp.values, {});
    });
  });
}

for (const navigates of [false, true]) {
  test(`a submit dialog is reported and never promoted (navigation=${navigates})`, async () => {
    await withFakes(async ({ cdp, tree, dir, out, config }) => {
      await plan({ url: FORM, field: FIELDS, out, config });
      tree.elements["#pay"].dialog = { type: navigates ? "alert" : "confirm", message: "Pay?" };
      if (!navigates) delete tree.elements["#pay"].navigatesTo;
      const input = { plan: out, submit: true, confirmPlan: readPlan(out).approval_token, config };
      await assert.rejects(apply(input), (error) => {
        assert.match(error.message, /dialog|Pay\?/);
        return true;
      });
      const receipt = receiptsIn(dir).find((entry) => entry.details.mode === "submit");
      assert.equal(receipt.outcome, "unknown");
      assert.equal(receipt.verified_by, undefined);
      assert.equal(receipt.error.code, "action_dialog_opened");
      const dialog = receipt.evidence.find((line) => line.startsWith("dialogs:"));
      assert.deepEqual(JSON.parse(dialog.slice("dialogs:".length)), [
        {
          type: navigates ? "alert" : "confirm",
          message: "Pay?",
          url: navigates ? DONE : FORM,
          answer: "dismissed",
        },
      ]);
      assert.equal(cdp.dialogs[0].accept, false);
      assert.equal(cdp.clicks.length, 1);
      await assert.rejects(apply(input), { code: "submit_already_attempted" });
      assert.equal(cdp.clicks.length, 1);
    });
  });
}

test("a fill dialog stops before the next field or submit, with an unknown receipt", async () => {
  await withFakes(async ({ cdp, tree, dir, out, config }) => {
    await plan({ url: FORM, field: FIELDS, out, config });
    tree.elements["#card"].inputDialog = { type: "prompt", message: "Continue?" };
    await assert.rejects(apply({ plan: out, config }), {
      code: "action_dialog_opened",
      message: /dialog/,
    });
    const receipts = receiptsIn(dir);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].outcome, "unknown");
    assert.match(receipts[0].evidence.join("\n"), /dialogs:.*Continue\?/);
    assert.deepEqual(cdp.values, { "#card": "4242" });
    assert.equal(cdp.clicks.length, 0);
    assert.equal(cdp.dialogs[0].accept, false);
  });
});

test("with the DevTools connection bound, a fill runs in the page over it and says so", async () => {
  await withFakes(async ({ surf, cdp, dir, out, config }) => {
    await plan({ url: FORM, field: FIELDS, out, config });
    const planned = verbs(surf).length;
    const proven = proofs(surf);
    const envelope = await apply({ plan: out, config });
    assert.equal(envelope.result.channel, "cdp");
    assert.deepEqual(
      envelope.result.fields.map((field) => field.matched),
      [true, true],
    );
    assert.deepEqual(cdp.values, { "#card": "4242", "#country": "fr" });
    assert.deepEqual(
      verbs(surf)
        .slice(planned)
        .filter((verb) => ACTING.includes(verb)),
      [],
      "surf opened, gated and closed the tab; it read and set nothing",
    );
    assert.equal(
      proofs(surf) - proven,
      1,
      "apply's tab was proven once, before the connection was bound",
    );
    for (const receipt of receiptsIn(dir)) {
      assert.match(
        receipt.evidence[0],
        /^declared: (type|select) acts on the target page, in the page over the DevTools connection$/,
      );
    }
  });
});

test("a submit that navigates the page is observed through the pinned tab, and verified", async () => {
  await withFakes(async ({ cdp, tree, dir, out, config }) => {
    await plan({ url: FORM, field: FIELDS, out, config });
    const { approval_token: token } = readPlan(out);
    const envelope = await apply({ plan: out, submit: true, confirmPlan: token, config });
    assert.equal(envelope.result.channel, "cdp");
    assert.equal(envelope.result.submitted, true);
    assert.deepEqual(
      cdp.clicks.map((click) => [click.frame, click.selector]),
      [["main", "#pay"]],
    );
    // the tab now lists at DONE: only its pinned target id still finds it
    assert.equal(tree.url, DONE);
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "applied");
    assert.ok(submit.evidence.some((line) => line.includes(DONE)));
  });
});

test("the tab is bound where the readiness gate saw it land, not at the URL asked for", async () => {
  await withFakes(
    async ({ cdp, out, config }) => {
      await plan({ url: FORM, field: FIELDS, out, config });
      assert.equal(readPlan(out).target.landed_href, LANDED);
      const envelope = await apply({ plan: out, config });
      assert.equal(envelope.result.channel, "cdp");
      assert.equal(cdp.values["#card"], "4242");
    },
    { landed: LANDED },
  );
});

test("without a DevTools connection the steps run on surf, and the envelope says why", async () => {
  await withFakes(
    async ({ surf, out, config }) => {
      await plan({ url: FORM, field: FIELDS, out, config });
      const envelope = await apply({ plan: out, config });
      assert.equal(envelope.result.channel, "surf");
      assert.ok(
        envelope.notes.some((note) =>
          /ran on surf: the DevTools connection did not bind the owned tab \(cdp_endpoint_unreachable\)/.test(
            note,
          ),
        ),
      );
      assert.ok(verbs(surf).includes("type"));
    },
    { cdp: false },
  );
});

test("a pinned tab that is gone is refused by its id, never found again by URL", async (t) => {
  const tree = cdpTree(FORM);
  const fake = await startFakeCdp({ pages: { P1: { url: FORM, tree } } });
  t.after(() => fake.close());
  const env = { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url };
  const bound = await openCdpActions(FORM, env);
  assert.equal(bound.targetId, "P1");
  await bound.close();
  await assert.rejects(openCdpActions(FORM, env, { targetId: "P2" }), {
    code: "tab_bind_ambiguous",
    message: /P2 this run bound for https:\/\/shop\.example\/pay is no longer/,
  });
});

test("a tab at the owned tab's URL that is not the owned tab is never bound: the steps run on surf", async () => {
  await withFakes(
    async ({ surf, cdp, out, config }) => {
      await plan({ url: FORM, field: FIELDS, out, config });
      const envelope = await apply({ plan: out, config });
      assert.equal(envelope.result.channel, "surf");
      assert.ok(
        envelope.notes.some((note) =>
          /did not bind the owned tab \(tab_bind_ambiguous\)/.test(note),
        ),
      );
      assert.deepEqual(cdp.values, {}, "nothing was set in the other tab");
      assert.ok(verbs(surf).includes("type"), "surf set the values in the tab it owns");
      assert.equal(await cdp.drained(), 0, "the refused bind closed its connection");
    },
    { otherTab: true },
  );
});

test("an open that fails part-way closes its own connection", async (t) => {
  const tree = cdpTree(FORM);
  tree.error = "Target crashed";
  const fake = await startFakeCdp({ pages: { P1: { url: FORM, tree } } });
  t.after(() => fake.close());
  await assert.rejects(openCdpActions(FORM, { TEST_CAPABILITIES_CDP_ENDPOINT: fake.url }));
  assert.equal(await fake.drained(), 0);
});

/** A plan without what differs between two runs: its id, its time, and the token over both. */
const planContent = (out) => {
  const { plan_id, generated_at, approval_token, ...content } = readPlan(out);
  return content;
};

test("with the DevTools connection bound, the plan's probe reads the page over it and says so", async () => {
  let overSurf;
  await withFakes(
    async ({ out, config }) => {
      const envelope = await plan({ url: FORM, field: FIELDS, out, config });
      assert.equal(envelope.result.channel, "surf");
      overSurf = planContent(out);
    },
    { cdp: false },
  );
  await withFakes(async ({ surf, out, config }) => {
    const envelope = await plan({ url: FORM, field: FIELDS, out, config });
    assert.equal(envelope.result.channel, "cdp");
    assert.deepEqual(envelope.notes, []);
    assert.deepEqual(
      verbs(surf).filter((verb) => ACTING.includes(verb)),
      [],
      "surf opened, gated and closed the tab; it read no form",
    );
    assert.equal(
      proofs(surf),
      1,
      "the tab was proven once, before the probe ran over the connection",
    );
    assert.deepEqual(planContent(out), overSurf, "the same page read either way is the same plan");
  });
});

test("without a DevTools connection the plan's probe runs on surf, and the envelope says why", async () => {
  await withFakes(
    async ({ surf, out, config }) => {
      const envelope = await plan({ url: FORM, field: FIELDS, out, config });
      assert.equal(envelope.result.channel, "surf");
      assert.ok(
        envelope.notes.some((note) =>
          /probe ran on surf: the DevTools connection did not bind the owned tab \(cdp_endpoint_unreachable\)/.test(
            note,
          ),
        ),
      );
      assert.ok(verbs(surf).includes("js"), "surf read the form");
    },
    { cdp: false },
  );
});

test("a tab at the owned tab's URL that is not the owned tab is never read: the probe runs on surf", async () => {
  await withFakes(
    async ({ surf, cdp, out, config }) => {
      const envelope = await plan({ url: FORM, field: FIELDS, out, config });
      assert.equal(envelope.result.channel, "surf");
      assert.ok(
        envelope.notes.some((note) =>
          /did not bind the owned tab \(tab_bind_ambiguous\)/.test(note),
        ),
      );
      assert.ok(verbs(surf).includes("js"), "surf read the tab it owns");
      assert.equal(await cdp.drained(), 0, "the refused bind closed its connection");
    },
    { otherTab: true },
  );
});

test("a probe that fails over a bound connection is that failure, never read again on surf", async () => {
  await withFakes(async ({ surf, tree, out, config }) => {
    // the tab is proven and bound, and then the page answers no probe over the connection
    tree.probeFails = true;
    await assert.rejects(plan({ url: FORM, field: FIELDS, out, config }));
    assert.equal(proofs(surf), 1, "the tab was proven, so the connection was bound");
    assert.deepEqual(
      verbs(surf).filter((verb) => ACTING.includes(verb)),
      [],
      "surf read nothing",
    );
  });
});

test("a bind whose tab proof cannot be read closes the connection it opened, and binds nothing", async () => {
  await withFakes(
    async ({ cdp, out, config }) => {
      // surf reads nothing in this tab: neither the proof nor, on the fallback, the form
      await assert.rejects(plan({ url: FORM, field: FIELDS, out, config }));
      assert.equal(await cdp.drained(), 0, "the connection opened before the proof was closed");
    },
    { surfFailOn: ["js"] },
  );
});

for (const [label, arrange, expectPlan] of [
  ["a plan", () => {}, true],
  [
    "a probe that fails",
    (tree) => {
      tree.probeFails = true;
    },
    false,
  ],
  [
    "a plan refused after its probe",
    (tree) => {
      tree.form.fields["#card"].label = "Something else";
    },
    false,
  ],
]) {
  test(`the plan's bind and its probe share one connection, and let it go: ${label}`, async () => {
    await withFakes(async ({ cdp, tree, out, config }) => {
      arrange(tree);
      const planned = plan({ url: FORM, field: FIELDS, out, config });
      if (expectPlan) assert.equal((await planned).result.channel, "cdp");
      else await assert.rejects(planned);
      assert.equal(cdp.socketsOpened(), 1, "the tab was proven and read on one connection");
      assert.equal(await cdp.drained(), 0, "and it was let go");
    });
  });
}

test("a dialog the page opens while its tab is proven is answered and does not stop the plan, as before", async () => {
  await withFakes(async ({ tree, out, config }) => {
    tree.proofDialog = { type: "alert", message: "Welcome back" };
    const envelope = await plan({ url: FORM, field: FIELDS, out, config });
    assert.equal(envelope.result.channel, "cdp");
    assert.equal(readPlan(out).fields.length, 2);
  });
});

test("a bind that held its connection hands a later hold no baseline: its first dialog stops a step", async (t) => {
  const { bindsOverCdp, holdCdpActions, releaseCdpActions, runStepInFrame } =
    await importRuntimeModule("core/cdp-step-transport.js");
  const tree = cdpTree(FORM);
  tree.proofDialog = { type: "alert", message: "Welcome back" };
  const cdp = await startFakeCdp({ pages: { P1: { url: FORM, tree } } });
  t.after(() => cdp.close());
  const env = { TEST_CAPABILITIES_CDP_ENDPOINT: cdp.url };
  const { DEFAULT_TIME_ORIGIN } = await import("./fixtures/stub-dom.mjs");
  // the owned tab answers the time-origin proof, as a SurfSession reads it through surf
  const session = {
    url: FORM,
    readiness: { href: FORM },
    evaluate: async () => String(DEFAULT_TIME_ORIGIN),
  };
  const read = { command: "js", args: ["1"], frame: "main", effect: "read_only" };
  // the plan's bind: the dialog during its proof is answered and not reported
  const answered = async (count) => {
    const deadline = Date.now() + 2000;
    while (cdp.dialogs.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return cdp.dialogs.length;
  };
  assert.deepEqual(await bindsOverCdp(session, env, { hold: true }), { binds: true });
  assert.equal(await answered(1), 1, "the proof's dialog was answered");
  await runStepInFrame(session, env, read);
  await releaseCdpActions(session);
  // a flow's hold on the same session counts every dialog its own connection sees
  delete tree.proofDialog;
  await holdCdpActions(session, env);
  cdp.openDialog({ type: "alert", message: "Later" });
  assert.equal(await answered(2), 2, "the new connection answered the later dialog");
  await assert.rejects(runStepInFrame(session, env, read), { code: "action_dialog_opened" });
  await releaseCdpActions(session);
});

test(
  "the plan waits for client close completion before surf closes the tab (AK #6221)",
  { timeout: 5000 },
  async (t) => {
    // Observe the client's result and tab-close invocation in this process, not server TCP timing.
    const closeAndWait = CdpConnection.prototype.closeAndWait;
    let clientCompleted = false;
    let tabAttempted = false;
    let completion;
    if (closeAndWait)
      t.mock.method(CdpConnection.prototype, "closeAndWait", function (...args) {
        completion = closeAndWait.apply(this, args).then(() => {
          clientCompleted = true;
        });
        return completion;
      });
    const closeTab = SurfSession.prototype.close;
    t.mock.method(SurfSession.prototype, "close", async function () {
      const completedBeforeTab = clientCompleted;
      tabAttempted = true;
      await closeTab.call(this);
      assert.equal(completedBeforeTab, true, "client completion precedes the tab-close invocation");
    });
    try {
      await withFakes(
        async ({ surf, cdp, out, config }) => {
          let finished = false;
          const planned = plan({ url: FORM, field: FIELDS, out, config });
          planned.then(
            () => {
              finished = true;
            },
            () => {
              finished = true;
            },
          );
          await Promise.race([
            cdp.closeResponse.received,
            planned.then(() => {
              throw new Error("the plan ended without a close frame");
            }),
          ]);
          assert.equal(finished, false);
          assert.equal(tabAttempted, false);
          assert.ok(
            !surf.stdioCalls().some((call) => call[0] === "tab.close"),
            "the tab stays owned until the peer replies",
          );
          cdp.closeResponse.release();
          const envelope = await planned;
          assert.equal(envelope.result.channel, "cdp");
          assert.ok(surf.stdioCalls().some((call) => call[0] === "tab.close"));
          assert.equal(clientCompleted, true);
        },
        { stdio: true, holdCloseReply: true },
      );
    } finally {
      // Even a failed mutation witness leaves no outstanding mock completion.
      await completion?.catch(() => undefined);
    }
  },
);

for (const operation of ["plan", "flow"]) {
  for (const primaryFailure of [false, true]) {
    test(
      `${operation}: withheld close reply still cleans owned tab${primaryFailure ? " and preserves primary refusal over both cleanup failures" : " and reports timeout"}`,
      { timeout: 5000 },
      async (t) => {
        const closeAndWait = CdpConnection.prototype.closeAndWait;
        t.mock.method(CdpConnection.prototype, "closeAndWait", function () {
          return closeAndWait.call(this, 80); // only the fixture's socket deadline is shortened
        });
        let tabAttempted = false;
        const closeTab = SurfSession.prototype.close;
        t.mock.method(SurfSession.prototype, "close", async function () {
          tabAttempted = true;
          await closeTab.call(this);
          if (primaryFailure) throw new Error("secondary tab cleanup failure");
        });
        await withFakes(
          async ({ surf, cdp, tree, dir, out, config }) => {
            let running;
            if (operation === "plan") {
              if (primaryFailure) tree.form.fields["#card"].label = "Something else";
              running = plan({ url: FORM, field: FIELDS, out, config });
            } else {
              if (primaryFailure) tree.elements["#pay"].gated = true;
              const file = path.join(dir, "flow.json");
              writeFileSync(
                file,
                JSON.stringify({
                  schema_version: 1,
                  url: FORM,
                  steps: primaryFailure
                    ? [{ action: "click", target: "#pay" }]
                    : [{ action: "assert", that: { url_prefix: FORM } }],
                }),
              );
              running = executeCliOperation({ command: "surf", action: "flow" }, { file, config });
            }
            // Observe rejection immediately, before waiting for the frame witness.
            const rejected = assert.rejects(
              running,
              primaryFailure
                ? { code: operation === "plan" ? "plan_field_not_found" : "flow_submit_undeclared" }
                : /DevTools socket did not close within 80 ms/,
            );
            await cdp.closeResponse.received;
            const frameAt = performance.now();
            await rejected;
            assert.ok(
              performance.now() - frameAt < 1500,
              "bounded socket wait reaches tab cleanup",
            );
            assert.equal(tabAttempted, true);
            assert.ok(surf.stdioCalls().some((call) => call[0] === "tab.close"));
            assert.equal(cdp.closeResponse.replies, 0);
            assert.equal(cdp.openSockets(), 1, "native timeout is not forced peer teardown");
          },
          { stdio: true, holdCloseReply: true },
        );
      },
    );
  }
}
