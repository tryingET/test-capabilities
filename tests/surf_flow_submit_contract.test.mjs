import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  CARD,
  cdpTree,
  DONE,
  flowOf,
  LEAKED_CARD,
  PAGE,
  receiptsIn,
  withFlowFakes,
} from "./helpers/flow-harness.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * `surf flow` submit authorization (AK #6164, slice F2). A step that acts on a form-level control
 * must be declared `submit: true`, and the run must present `--submit` with the flow's approval
 * token; before a tab exists the flow must declare such a step, the token must match its content,
 * and no submit may have been attempted for it before. The submit settles `unknown` until its
 * `expect` is observed; unobserved, the flow stops there and never runs it again.
 */
const { executeCliOperation } = await importRuntimeModule("core/operations.js");
const { flowApprovalToken, parseFlow } = await importRuntimeModule("core/flow-file.js");

const flow = (input) => executeCliOperation({ command: "surf", action: "flow" }, input);
/** The shop's pay button submits its form: the page lands on DONE. */
const submitTree = (url) => {
  const tree = cdpTree(url);
  tree.elements["#pay"].navigatesTo = DONE;
  return tree;
};
const withFakes = (body, options = {}) => withFlowFakes(body, { tree: submitTree, ...options });
const tokenOf = (content) => flowApprovalToken(parseFlow(content, "flow.json"));

const PAY = [
  { action: "fill", target: "#card", value: CARD },
  { id: "pay", action: "click", target: "#pay", submit: true, expect: { url_prefix: DONE } },
  { id: "after", action: "assert", that: { url_prefix: DONE } },
];

test("--submit with the flow's token runs its declared submit, verified, and the steps after it", async () => {
  await withFakes(async ({ cdp, dir, config, write }) => {
    const content = flowOf(PAY);
    const envelope = await flow({
      file: write(content),
      config,
      submit: true,
      confirmFlow: tokenOf(content),
    });
    assert.equal(envelope.result.status, "completed");
    assert.equal(envelope.result.submitted, true);
    assert.deepEqual(
      envelope.result.steps.map((step) => step.outcome),
      ["ok", "ok", "ok"],
    );
    assert.deepEqual(
      cdp.clicks.map((click) => click.selector),
      ["#pay"],
    );
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "applied");
    assert.equal(submit.verified_by, "post_read");
    assert.ok(submit.evidence.some((line) => line.includes(DONE)));
    assert.equal(envelope.receipt.outcome, "applied");
  });
});

test("a flow is submitted at most once: any earlier submit receipt refuses it before a tab", async () => {
  await withFakes(async ({ surf, cdp, config, write }) => {
    const content = flowOf(PAY);
    const file = write(content);
    await flow({ file, config, submit: true, confirmFlow: tokenOf(content) });
    const tabs = surf.calls().filter((call) => call[0] === "tab.new").length;
    await assert.rejects(flow({ file, config, submit: true, confirmFlow: tokenOf(content) }), {
      code: "submit_already_attempted",
    });
    assert.equal(surf.calls().filter((call) => call[0] === "tab.new").length, tabs);
    assert.equal(cdp.clicks.length, 1);
  });
});

test("at most once is per flow: another flow's submit receipt closes nothing here", async () => {
  await withFakes(async ({ tree, config, write }) => {
    const first = flowOf(PAY);
    await flow({ file: write(first), config, submit: true, confirmFlow: tokenOf(first) });
    tree.url = PAGE;
    const other = flowOf([{ ...PAY[0], value: "5555" }, PAY[1], PAY[2]]);
    const envelope = await flow({
      file: write(other, "other.json"),
      config,
      submit: true,
      confirmFlow: tokenOf(other),
    });
    assert.equal(envelope.result.submitted, true);
  });
});

test("the gate before a tab: --confirm-flow is required, must match, and needs a submit step", async () => {
  await withFakes(async ({ surf, config, write }) => {
    const content = flowOf(PAY);
    const file = write(content);
    await assert.rejects(flow({ file, config, submit: true }), { code: "submit_gate_closed" });
    await assert.rejects(
      flow({ file, config, submit: true, confirmFlow: `sha256:${"0".repeat(64)}` }),
      { code: "flow_approval_mismatch" },
    );
    const edited = flowOf([{ ...PAY[0], value: "5555" }, PAY[1], PAY[2]]);
    await assert.rejects(
      flow({
        file: write(edited, "edited.json"),
        config,
        submit: true,
        confirmFlow: tokenOf(content),
      }),
      { code: "flow_approval_mismatch" },
      "an approval names the content it was given for",
    );
    const plain = flowOf([PAY[0]]);
    await assert.rejects(
      flow({ file: write(plain, "plain.json"), config, submit: true, confirmFlow: tokenOf(plain) }),
      { code: "config_invalid", message: /no submit step/ },
    );
    assert.deepEqual(
      surf.calls().filter((call) => call[0] === "tab.new"),
      [],
    );
  });
});

test("authorization covers the declared submit only: another form-level act is still refused", async () => {
  await withFakes(async ({ cdp, config, write }) => {
    const content = flowOf([
      { id: "enter", action: "press", key: "Enter", target: "#card" },
      { id: "pay", action: "click", target: "#pay", submit: true, expect: { url_prefix: DONE } },
    ]);
    await assert.rejects(
      flow({ file: write(content), config, submit: true, confirmFlow: tokenOf(content) }),
      (error) => error.code === "flow_submit_undeclared" && /step enter/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, []);
  });
});

test("a submit whose expect never shows is unknown, stops the flow, and is never run again", async () => {
  await withFakes(async ({ cdp, tree, dir, config, write }) => {
    delete tree.elements["#pay"].navigatesTo;
    const content = flowOf(PAY);
    const file = write(content);
    await assert.rejects(
      flow({ file, config, submit: true, confirmFlow: tokenOf(content) }),
      (error) => error.code === "submit_postcondition_unmet" && /step pay/.test(error.message),
    );
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "unknown");
    assert.equal(cdp.clicks.length, 1);
    await assert.rejects(flow({ file, config, submit: true, confirmFlow: tokenOf(content) }), {
      code: "submit_already_attempted",
    });
  });
});

test("the default expect is that the page leaves where the submit started", async () => {
  await withFakes(async ({ dir, config, write }) => {
    const content = flowOf([{ id: "pay", action: "click", target: "#pay", submit: true }]);
    const envelope = await flow({
      file: write(content),
      config,
      submit: true,
      confirmFlow: tokenOf(content),
    });
    assert.equal(envelope.result.submitted, true);
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "applied");
    assert.ok(submit.evidence.some((line) => line.includes("left_url")));
  });
});

test("a submit that opens a dialog is reported as the dialog and never promoted", async () => {
  await withFakes(async ({ dir, tree, config, write }) => {
    tree.elements["#pay"].dialog = { type: "alert", message: "Paying" };
    const content = flowOf(PAY);
    await assert.rejects(
      flow({ file: write(content), config, submit: true, confirmFlow: tokenOf(content) }),
      { code: "action_dialog_opened" },
    );
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "unknown");
    assert.equal(submit.verified_by, undefined);
  });
});

test("a declared submit may press Enter in the form's field", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#card"].enterNavigatesTo = DONE;
    const content = flowOf([
      { action: "fill", target: "#card", value: CARD },
      {
        id: "enter",
        action: "press",
        key: "Enter",
        target: "#card",
        submit: true,
        expect: { url_prefix: DONE },
      },
    ]);
    const envelope = await flow({
      file: write(content),
      config,
      submit: true,
      confirmFlow: tokenOf(content),
    });
    assert.equal(envelope.result.submitted, true);
    assert.equal(cdp.keys.filter((key) => key.key === "Enter").length > 0, true);
  });
});

test("without --submit the stopped flow still reports the token the operator approves", async () => {
  await withFakes(async ({ config, write }) => {
    const content = flowOf(PAY);
    const envelope = await flow({ file: write(content), config });
    assert.equal(envelope.result.status, "stopped_at_submit_gate");
    assert.equal(envelope.flow.approvalToken, tokenOf(content));
    assert.equal(envelope.result.submitted, false);
    assert.ok(PAGE);
  });
});

test("a submit's receipt names its expect, never the address the page landed on", async () => {
  await withFakes(async ({ dir, tree, config, write }) => {
    // a GET form puts what was typed into the address it lands on
    tree.elements["#pay"].navigatesTo = `${DONE}?card=${CARD}`;
    const content = flowOf(PAY);
    const envelope = await flow({
      file: write(content),
      config,
      submit: true,
      confirmFlow: tokenOf(content),
    });
    assert.equal(envelope.result.submitted, true);
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "applied");
    assert.doesNotMatch(JSON.stringify(submit), LEAKED_CARD);
    assert.doesNotMatch(JSON.stringify(envelope), LEAKED_CARD);
  });
});

test("a text expect is looked for in the page's text, and unseen leaves the submit unknown", async () => {
  await withFakes(async ({ dir, config, write }) => {
    const seen = flowOf([
      { id: "pay", action: "click", target: "#pay", submit: true, expect: { text: "Welcome" } },
    ]);
    const envelope = await flow({
      file: write(seen),
      config,
      submit: true,
      confirmFlow: tokenOf(seen),
    });
    assert.equal(envelope.result.submitted, true);
    const applied = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(applied.outcome, "applied");
    assert.ok(applied.evidence.some((line) => line.includes("text")));
    assert.ok(!applied.evidence.some((line) => line.includes("Welcome")), "the text stays out");
  });
  await withFakes(async ({ config, write }) => {
    const unseen = flowOf([
      { id: "pay", action: "click", target: "#pay", submit: true, expect: { text: "Receipt no." } },
    ]);
    await assert.rejects(
      flow({
        file: write(unseen, "unseen.json"),
        config,
        submit: true,
        confirmFlow: tokenOf(unseen),
      }),
      { code: "submit_postcondition_unmet" },
    );
  });
});

test("a flow with two submit steps runs both under one approval, each verified", async () => {
  await withFakes(async ({ cdp, tree, dir, config, write }) => {
    tree.elements["#help"].navigatesTo = `${DONE}/second`;
    tree.elements["#help"].gated = true;
    const content = flowOf([
      { id: "help", action: "click", target: "#help", submit: true, expect: { url_prefix: DONE } },
      { id: "pay", action: "click", target: "#pay", submit: true },
    ]);
    const envelope = await flow({
      file: write(content),
      config,
      submit: true,
      confirmFlow: tokenOf(content),
    });
    assert.equal(envelope.result.submitted, true);
    assert.deepEqual(
      cdp.clicks.map((click) => click.selector),
      ["#help", "#pay"],
    );
    assert.deepEqual(
      receiptsIn(dir)
        .filter((receipt) => receipt.details.mode === "submit")
        .map((receipt) => receipt.outcome),
      ["applied", "applied"],
    );
  });
});

test("only a submit receipt closes the gate: the flow's other acts never block its submit", async () => {
  await withFakes(async ({ tree, dir, config, write }) => {
    const content = flowOf(PAY);
    const file = write(content);
    // without --submit: the fill runs and is receipted, the flow stops at the gate
    const first = await flow({ file, config });
    assert.equal(first.result.status, "stopped_at_submit_gate");
    assert.ok(receiptsIn(dir).some((receipt) => receipt.details.mode === "act"));
    const submitted = await flow({ file, config, submit: true, confirmFlow: tokenOf(content) });
    assert.equal(submitted.result.submitted, true);
    // and once submitted, a run without --submit still acts up to the gate: nothing is submitted
    tree.url = PAGE;
    const again = await flow({ file, config });
    assert.equal(again.result.status, "stopped_at_submit_gate");
    assert.equal(again.result.submitted, false);
  });
});

test("a page between documents answers the expect later: a failed observation is asked again", async () => {
  await withFakes(async ({ tree, dir, config, write }) => {
    tree.elements["#pay"].betweenDocuments = 4;
    const content = flowOf(PAY);
    const envelope = await flow({
      file: write(content),
      config,
      submit: true,
      confirmFlow: tokenOf(content),
    });
    assert.equal(envelope.result.submitted, true);
    // more failed reads than the connection retries on its own: the verify asks again
    assert.equal(tree.betweenDocuments, 0, "every failed read was asked");
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "applied");
  });
});

test("a submit's verify never promotes after a dialog, nor a left_url with no start", async () => {
  const { submitStepOf } = await importRuntimeModule("core/operations/surf-flow-submit.js");
  const { FrameworkError } = await importRuntimeModule("core/runtime-contract.js");
  const base = {
    id: "surf.flow.step:t:pay",
    frame: "main",
    command: "flow.click",
    args: [],
    intent: "pay",
    declare: { effect: "mutating", scope: "target", reason: "test" },
    read: (reply) => reply,
  };
  const pay = { id: "pay", action: "click", target: "#pay", submit: true };
  // wherever it looks, the page is elsewhere and every expect holds
  const away = async () => ({ held: true, href: DONE });
  const dialog = submitStepOf(base, { ...pay, expect: { url_prefix: DONE } }, away, 50);
  dialog.settle({ error: new FrameworkError("action_dialog_opened", "a dialog opened") });
  assert.equal((await dialog.verify()).result, "indeterminate");
  // the act failed before its read: where it started is unknown, so nothing it left is seen
  const noStart = submitStepOf(base, pay, away, 50);
  noStart.settle({ error: new FrameworkError("cdp_endpoint_unreachable", "gone") });
  assert.equal((await noStart.verify()).result, "indeterminate");
  const started = submitStepOf(base, pay, away, 50);
  started.read({ href: PAGE }, 1);
  assert.equal(started.settle({ value: { href: PAGE } }).outcome, "unknown");
  assert.equal((await started.verify()).result, "applied");
});

test("two runs race to one submit: the other run's reservation refuses this one before input", async () => {
  const { executeSurfFlowOperation, SURF_FLOW_OPERATION_EFFECT, SurfFlowOperationInputSchema } =
    await importRuntimeModule("core/operations/surf-flow-operation.js");
  const { mintOperationContext } = await importRuntimeModule("core/run-context.js");
  const { FileReceiptStore } = await importRuntimeModule("core/artifacts.js");
  const raced = async (makeStore, check) => {
    await withFakes(async ({ cdp, surf, dir, config, write }) => {
      const content = flowOf(PAY);
      const input = { file: write(content), config, submit: true, confirmFlow: tokenOf(content) };
      const store = makeStore(new FileReceiptStore(path.join(dir, "receipts")));
      const context = mintOperationContext(
        "surf.flow",
        SURF_FLOW_OPERATION_EFFECT,
        SurfFlowOperationInputSchema.parse(input),
        { receiptStore: store },
      );
      await check(executeSurfFlowOperation(input, context), { cdp, surf });
    });
  };
  // the other run passed the same scan, then reserved the submit first: nothing is clicked
  await raced(
    (store) => ({
      dir: store.dir,
      append: (receipt) => store.append(receipt),
      list: async () => [],
      reservation: async () => undefined,
      reserve: async () => false,
    }),
    async (running, { cdp }) => {
      await assert.rejects(running, { code: "submit_already_attempted" });
      assert.deepEqual(cdp.clicks, []);
    },
  );
  // a run that reserved and stopped before its receipt was written: refused before a tab
  await raced(
    (store) => ({
      dir: store.dir,
      append: (receipt) => store.append(receipt),
      list: async () => [],
      reservation: async () => ({ run_id: "run-0" }),
      reserve: async () => false,
    }),
    async (running, { surf }) => {
      await assert.rejects(running, { code: "submit_already_attempted" });
      assert.deepEqual(
        surf.calls().filter((call) => call[0] === "tab.new"),
        [],
      );
    },
  );
  // a store that cannot reserve cannot hold at most once: nothing is submitted
  await raced(
    (store) => ({
      dir: store.dir,
      append: (receipt) => store.append(receipt),
      list: (filter) => store.list(filter),
    }),
    async (running, { cdp }) => {
      await assert.rejects(running, { code: "mutation_receipt_write_failed" });
      assert.deepEqual(cdp.clicks, []);
    },
  );
});

test("a dialog that opens while the expect is looked for is reported as the dialog, never promoted", async () => {
  await withFakes(async ({ tree, dir, config, write }) => {
    tree.elements["#pay"].dialogOnRead = { type: "alert", message: "Paid 42" };
    const content = flowOf(PAY);
    await assert.rejects(
      flow({ file: write(content), config, submit: true, confirmFlow: tokenOf(content) }),
      (error) =>
        error.code === "action_dialog_opened" &&
        !/Paid 42/.test(`${error.message} ${JSON.stringify(error.details)}`),
    );
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "unknown");
    assert.equal(submit.verified_by, undefined);
    assert.doesNotMatch(JSON.stringify(submit), /Paid 42/);
  });
});

test("an expect seen only after the deadline promotes nothing", async () => {
  const { submitStepOf } = await importRuntimeModule("core/operations/surf-flow-submit.js");
  const base = {
    id: "surf.flow.step:t:pay",
    frame: "main",
    command: "flow.click",
    args: [],
    intent: "pay",
    declare: { effect: "mutating", scope: "target", reason: "test" },
    read: (reply) => reply,
  };
  const pay = {
    id: "pay",
    action: "click",
    target: "#pay",
    submit: true,
    expect: { url_prefix: DONE },
  };
  // the page shows the expect only from 30 ms on, after the 20 ms deadline
  const from = Date.now();
  const late = submitStepOf(
    base,
    pay,
    async () => ({ held: Date.now() - from >= 30, href: DONE }),
    20,
  );
  late.settle({ value: {} });
  assert.equal((await late.verify()).result, "indeterminate");
  // held, but the one look ends after the deadline
  const slow = submitStepOf(
    base,
    pay,
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { held: true, href: DONE };
    },
    20,
  );
  slow.settle({ value: {} });
  assert.equal((await slow.verify()).result, "indeterminate");
  // held within the deadline
  const inTime = submitStepOf(base, pay, async () => ({ held: true, href: DONE }), 1000);
  inTime.settle({ value: {} });
  assert.equal((await inTime.verify()).result, "applied");
});
