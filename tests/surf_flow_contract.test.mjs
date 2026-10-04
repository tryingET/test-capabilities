import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import {
  ax,
  CARD,
  cdpTree,
  EVIL,
  flowOf,
  LEAKED_CARD,
  MODEL,
  PAGE,
  receiptsIn,
  withFlowFakes as withFakes,
} from "./helpers/flow-harness.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * `surf flow` (AK #6164, slice F1): a closed step language run in the owned tab on one held
 * DevTools connection. Every act is a receipted ledger step guarded just before input - the
 * element's document origin must be allowlisted and a form-level control needs a declared,
 * approved submit step; read steps write no receipt. Without `--submit` a flow stops before its
 * first submit step.
 */
const { executeCliOperation } = await importRuntimeModule("core/operations.js");
const { parseFlow, flowApprovalToken } = await importRuntimeModule("core/flow-file.js");
const { FLOW_GATE } = await importRuntimeModule("core/cdp-flow-acts.js");

const flow = (input) => executeCliOperation({ command: "surf", action: "flow" }, input);
const acting = (surf) =>
  surf
    .calls()
    .map((call) => call[0])
    .filter((verb) => ["type", "select", "click", "key"].includes(verb));

const JOURNEY = [
  { id: "user", action: "fill", target: { role: "textbox", name: "User" }, value: "alice" },
  { action: "fill", target: "#card", value: CARD },
  { action: "select", target: "#country", value: "fr" },
  { action: "check", target: "#terms" },
  { action: "press", key: "Tab", target: "#card" },
  { action: "click", target: "#help" },
  { action: "wait", for: { selector: "#card" } },
  { action: "wait", for: { text: "Welcome" } },
  { action: "assert", that: { field: { target: "#card", equals: CARD } } },
  { action: "assert", that: { field: { target: "#terms", equals: "true" } } },
  { action: "assert", that: { url_prefix: PAGE } },
];

// ---------------------------------------------------------------- the file

test("a flow file is normalized: ids by position, and one token for one content", () => {
  const parsed = parseFlow(flowOf(JOURNEY), "flow.json");
  assert.deepEqual(
    parsed.steps.map((step) => step.id),
    ["user", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"],
  );
  const reordered = parseFlow({ steps: JOURNEY, url: PAGE, schema_version: 1 }, "flow.json");
  assert.equal(flowApprovalToken(parsed), flowApprovalToken(reordered));
  const changed = structuredClone(JOURNEY);
  changed[1].value = "4343";
  assert.notEqual(flowApprovalToken(parseFlow(flowOf(changed), "f")), flowApprovalToken(parsed));
  assert.match(flowApprovalToken(parsed), /^sha256:[0-9a-f]{64}$/);
});

for (const [why, steps, url] of [
  ["an unknown action", [{ action: "js", code: "1" }]],
  ["an unknown key", [{ action: "fill", target: "#a", value: "x", extra: 1 }]],
  [
    "duplicate ids",
    [
      { id: "a", action: "click", target: "#a" },
      { id: "a", action: "click", target: "#b" },
    ],
  ],
  ["a submit on a fill", [{ action: "fill", target: "#a", value: "x", submit: true }]],
  ["an expect without a submit", [{ action: "click", target: "#a", expect: { text: "ok" } }]],
  [
    "a role target in a read",
    [{ action: "wait", for: { selector: { role: "button", name: "x" } } }],
  ],
  ["a timeout over 30 s", [{ action: "click", target: "#a", timeout_ms: 30001 }]],
  ["a press with no target", [{ action: "press", key: "Enter" }]],
  ["a key this channel cannot press", [{ action: "press", key: "Hyper+Q", target: "#a" }]],
  ["no steps", []],
  ["a start URL that is not HTTP(S)", [{ action: "click", target: "#a" }], "file:///etc/passwd"],
  ["an empty shadow path segment", [{ action: "click", target: "#host >>> " }]],
]) {
  test(`a flow file with ${why} is refused before anything runs`, () => {
    assert.throws(() => parseFlow(flowOf(steps, url ?? PAGE), "flow.json"), {
      code: "config_invalid",
    });
  });
}

test("a flow file that is missing, not a regular file, or does not parse is refused", async () => {
  await withFakes(async ({ surf, dir, config, write }) => {
    await assert.rejects(flow({ file: path.join(dir, "absent.yaml"), config }), {
      code: "config_not_found",
    });
    await assert.rejects(flow({ file: dir, config }), { code: "config_invalid" });
    await assert.rejects(flow({ file: write("{ not json", "broken.json"), config }), {
      code: "config_invalid",
      message: /does not parse/,
    });
    await assert.rejects(flow({ file: write("steps: [", "broken.yaml"), config }), {
      code: "config_invalid",
    });
    await assert.rejects(flow({ file: write(flowOf([]), "empty.json"), url: PAGE, config }), {
      code: "unsupported_option",
    });
    assert.deepEqual(surf.calls(), [], "nothing reached surf");
  });
});

// ---------------------------------------------------------------- the run

test("a journey runs every action on one held connection, a receipt per act and none per read", async () => {
  await withFakes(async ({ surf, cdp, dir, config, write }) => {
    const yaml = [
      "schema_version: 1",
      `url: ${PAGE}`,
      "steps:",
      ...JOURNEY.map((step) => `  - ${JSON.stringify(step)}`),
    ].join("\n");
    const envelope = await flow({ file: write(yaml, "flow.yaml"), config });
    assert.equal(envelope.result.status, "completed");
    assert.equal(envelope.result.channel, "cdp");
    assert.match(envelope.flow.approvalToken, /^sha256:/);
    assert.deepEqual(
      envelope.result.steps.map((step) => [step.id, step.outcome]),
      JOURNEY.map((_, index) => [index === 0 ? "user" : `s${index + 1}`, "ok"]),
    );
    assert.deepEqual(cdp.values, { "#user": "alice", "#card": CARD, "#country": "fr" });
    assert.deepEqual(
      cdp.clicks.map((click) => click.selector),
      ["#terms", "#help"],
    );
    assert.deepEqual(acting(surf), [], "surf opened, gated and closed the tab and acted nowhere");
    assert.equal(cdp.socketsOpened(), 1, "one connection for the whole flow");
    const receipts = receiptsIn(dir);
    assert.equal(receipts.length, 6);
    for (const receipt of receipts) {
      assert.equal(receipt.outcome, "applied");
      assert.match(receipt.evidence[0], /in the page over the DevTools connection$/);
      assert.equal(receipt.details.flow_id, envelope.flow.approvalToken);
      assert.doesNotMatch(JSON.stringify(receipt), LEAKED_CARD, "values stay out of receipts");
      assert.doesNotMatch(JSON.stringify(receipt), /alice/, "values stay out of receipts");
    }
    assert.doesNotMatch(JSON.stringify(envelope), LEAKED_CARD, "values stay out of the envelope");
    assert.doesNotMatch(JSON.stringify(envelope), /alice/, "values stay out of the envelope");
    assert.equal(await cdp.drained(), 0, "the held connection was released");
  });
});

test("the library entry runs a flow too, and --receipt-out exports its receipts", async () => {
  const { executeSurfFlowOperation } = await importRuntimeModule("core/operations.js");
  await withFakes(async ({ dir, config, write }) => {
    const receiptOut = path.join(dir, "receipts-export.json");
    const envelope = await executeSurfFlowOperation({
      file: write(flowOf([{ action: "fill", target: "#card", value: CARD }])),
      config,
      receiptOut,
    });
    assert.equal(envelope.result.status, "completed");
    const exported = JSON.parse(readFileSync(receiptOut, "utf-8"));
    assert.equal(exported.artifact_kind, "test-capabilities.surf.flow.receipts");
    assert.equal(exported.flow_id, envelope.flow.approvalToken);
    assert.equal(exported.receipts.length, 1);
    assert.equal(envelope.receiptExport, receiptOut);
  });
});

test("an act on a document whose origin is not allowlisted is refused before input", async () => {
  await withFakes(async ({ cdp, dir, config, write }) => {
    const file = write(
      flowOf([
        { action: "click", target: "a.away" },
        { id: "card", action: "fill", target: "#card", value: CARD },
      ]),
    );
    await assert.rejects(flow({ file, config }), (error) => {
      assert.equal(error.code, "mutation_origin_not_allowed");
      assert.match(error.message, /step card/);
      assert.match(error.message, /https:\/\/evil\.example/);
      return true;
    });
    assert.deepEqual(cdp.values, {});
    const outcomes = receiptsIn(dir).map((receipt) => [receipt.details.step.id, receipt.outcome]);
    assert.deepEqual(outcomes.sort(), [
      ["card", "failed"],
      ["s1", "applied"],
    ]);
  });
});

for (const [why, step] of [
  ["a click on a form-level control", { id: "pay", action: "click", target: "#pay" }],
  ["Enter in a form's field", { id: "pay", action: "press", key: "Enter", target: "#card" }],
]) {
  test(`${why} that is not a declared submit is refused before input`, async () => {
    await withFakes(async ({ cdp, dir, config, write }) => {
      await assert.rejects(flow({ file: write(flowOf([step])), config }), (error) => {
        assert.equal(error.code, "flow_submit_undeclared");
        assert.match(error.message, /step pay/);
        return true;
      });
      assert.deepEqual(cdp.clicks, []);
      assert.equal(cdp.keys.filter((key) => key.key === "Enter").length, 0);
      assert.equal(receiptsIn(dir)[0].outcome, "failed");
    });
  });
}

test("without --submit a flow stops before its first submit step, having acted up to it", async () => {
  await withFakes(async ({ cdp, dir, config, write }) => {
    const file = write(
      flowOf([
        { action: "fill", target: "#card", value: CARD },
        { id: "pay", action: "click", target: "#pay", submit: true, expect: { text: "Paid" } },
        { action: "assert", that: { text: "Paid" } },
      ]),
    );
    const envelope = await flow({ file, config });
    assert.equal(envelope.result.status, "stopped_at_submit_gate");
    assert.deepEqual(
      envelope.result.steps.map((step) => step.outcome),
      ["ok", "not_run", "not_run"],
    );
    assert.equal(envelope.result.stoppedAt, "pay");
    assert.deepEqual(cdp.clicks, []);
    assert.equal(receiptsIn(dir).length, 1);
    await assert.rejects(flow({ file, config, confirmFlow: envelope.flow.approvalToken }), {
      code: "submit_gate_closed",
    });
  });
});

test("a start URL whose origin is not allowlisted is refused before a tab exists", async () => {
  await withFakes(
    async ({ surf, config, write }) => {
      const file = write(flowOf([{ action: "click", target: "#help" }]));
      await assert.rejects(flow({ file, config }), { code: "mutation_origin_not_allowed" });
      assert.deepEqual(
        surf.calls().filter((call) => call[0] === "tab.new"),
        [],
      );
    },
    { origins: ["https://other.example"] },
  );
});

test("a read-only flow needs no allowlisted origin", async () => {
  await withFakes(
    async ({ config, write }) => {
      const envelope = await flow({
        file: write(flowOf([{ action: "assert", that: { text: "Welcome" } }])),
        config,
      });
      assert.equal(envelope.result.status, "completed");
    },
    { origins: ["https://other.example"] },
  );
});

test("without the DevTools connection a flow refuses before its first step", async () => {
  await withFakes(
    async ({ surf, dir, config, write }) => {
      const file = write(flowOf([{ action: "fill", target: "#card", value: CARD }]));
      await assert.rejects(flow({ file, config }), (error) => {
        assert.equal(error.code, "cdp_endpoint_unreachable");
        assert.match(error.message, /No step ran/);
        return true;
      });
      assert.deepEqual(acting(surf), []);
      assert.deepEqual(receiptsIn(dir), []);
    },
    { cdp: false },
  );
});

test("a wait that never holds and an assertion that is false stop the flow, naming the step", async () => {
  await withFakes(async ({ config, write }) => {
    await assert.rejects(
      flow({
        file: write(
          flowOf([{ id: "late", action: "wait", for: { selector: "#never" }, timeout_ms: 200 }]),
        ),
        config,
      }),
      (error) => error.code === "flow_wait_timeout" && /step late/.test(error.message),
    );
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "says", action: "assert", that: { text: "Goodbye" } }])),
        config,
      }),
      (error) => error.code === "flow_assertion_failed" && /step says/.test(error.message),
    );
  });
});

test("a click is judged by what it reaches: a wrapper over a form's button is the button", async () => {
  await withFakes(async ({ cdp, tree, dir, config, write }) => {
    tree.elements["#wrap"] = {
      backendNodeId: 38,
      box: [10, 130, 60, 20],
      hitReaches: "#pay",
      contains: ["#pay"],
    };
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "wrap", action: "click", target: "#wrap" }])), config }),
      (error) => error.code === "flow_submit_undeclared" && /step wrap/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, []);
    assert.equal(receiptsIn(dir)[0].outcome, "failed");
  });
});

test("what a click would reach that cannot be read by the time of the check is refused before input", async () => {
  await withFakes(async ({ cdp, tree, dir, config, write }) => {
    // the actionability hit test reaches the button; by the guard's, a cover in another frame does
    tree.elements["#help"].hitOnce = true;
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "help", action: "click", target: "#help" }])), config }),
      (error) => error.code === "action_target_obscured" && /step help/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, []);
    assert.equal(receiptsIn(dir)[0].outcome, "failed");
  });
});

test("Enter or Space without a declared submit is refused wherever focus is, before focus moves", async () => {
  await withFakes(async ({ cdp, dir, config, write }) => {
    for (const [id, key] of [
      ["enter", "Enter"],
      ["space", "Space"],
    ]) {
      await assert.rejects(
        flow({ file: write(flowOf([{ id, action: "press", key, target: "#user" }])), config }),
        (error) =>
          error.code === "flow_submit_undeclared" && new RegExp(`step ${id}`).test(error.message),
      );
    }
    assert.equal(cdp.keys.length, 0);
    const envelope = await flow({
      file: write(flowOf([{ action: "press", key: "Tab", target: "#user" }])),
      config,
    });
    assert.equal(envelope.result.status, "completed");
    assert.ok(receiptsIn(dir).every((receipt) => receipt.outcome !== "unknown"));
  });
});

test("a click is judged by what a real pointer hits: an overlay that lets pointer events through", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#overlay"] = {
      backendNodeId: 40,
      box: [10, 130, 60, 20],
      pointerEventsNone: true,
      passesTo: "#pay",
      onTop: true,
    };
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "over", action: "click", target: "#overlay", timeout_ms: 300 }])),
        config,
      }),
      (error) =>
        ["action_target_obscured", "flow_submit_undeclared"].includes(error.code) &&
        /step over/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, []);
  });
});

test("a key is judged before focus: a host that would hand focus to a form's field", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#host"] = {
      backendNodeId: 39,
      box: [300, 10, 100, 20],
      delegatesFocusTo: "#card",
    };
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "enter", action: "press", key: "Enter", target: "#host" }])),
        config,
      }),
      (error) => error.code === "flow_submit_undeclared" && /step enter/.test(error.message),
    );
    assert.equal(cdp.keys.filter((key) => key.key === "Enter").length, 0);
  });
});

test("a target that cannot take focus is refused before input, and its receipt is failed", async () => {
  await withFakes(async ({ cdp, tree, dir, config, write }) => {
    tree.elements["#host"] = { backendNodeId: 39, box: [300, 10, 100, 20], unfocusable: true };
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "tab", action: "press", key: "Tab", target: "#host" }])),
        config,
      }),
      (error) => error.code === "action_target_unsuitable" && /step tab/.test(error.message),
    );
    assert.equal(cdp.keys.length, 0);
    assert.equal(receiptsIn(dir)[0].outcome, "failed");
  });
});

test("a focus that fails for another reason stays in doubt: it may have moved", async () => {
  await withFakes(async ({ tree, dir, config, write }) => {
    tree.elements["#host"] = {
      backendNodeId: 39,
      box: [300, 10, 100, 20],
      focusFails: "socket closed",
    };
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "tab", action: "press", key: "Tab", target: "#host" }])),
        config,
      }),
      { code: "mutation_outcome_unknown" },
    );
    assert.equal(receiptsIn(dir)[0].outcome, "unknown");
  });
});

test("a fill whose focus a handler moves elsewhere types nothing there, and stays in doubt", async () => {
  await withFakes(async ({ cdp, tree, dir, config, write }) => {
    tree.elements["#user"].focusMovesTo = "#card";
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "user", action: "fill", target: "#user", value: "alice" }])),
        config,
      }),
      (error) =>
        error.code === "mutation_outcome_unknown" &&
        /focus/.test(error.message) &&
        /step user/.test(error.message),
    );
    assert.deepEqual(cdp.values, {}, "no text reached the element that took focus");
    assert.equal(receiptsIn(dir)[0].outcome, "unknown");
  });
});

test("focus is kept only while the element's document holds the page's focus and each scope's focus is on it", async () => {
  const { FOCUS_KEPT } = await importRuntimeModule("core/cdp-element-functions.js");
  const kept = vm.runInNewContext(`(${FOCUS_KEPT})`);
  const doc = (focused, active) => ({ hasFocus: () => focused, activeElement: active });
  const field = { getRootNode: () => topDoc };
  const topDoc = doc(true, field);
  field.ownerDocument = topDoc;
  assert.equal(kept.call(field), true);
  // the frame still names the field, but the page's focus went to another frame
  const frameDoc = doc(false, null);
  const inFrame = { ownerDocument: frameDoc, getRootNode: () => frameDoc };
  frameDoc.activeElement = inFrame;
  assert.equal(kept.call(inFrame), false);
  // focus moved within the document
  const other = {};
  const movedDoc = doc(true, other);
  assert.equal(kept.call({ ownerDocument: movedDoc, getRootNode: () => movedDoc }), false);
  // inside an open shadow root: the root holds it, and the document holds the host
  const hostDoc = doc(true, null);
  const host = { getRootNode: () => hostDoc };
  hostDoc.activeElement = host;
  const root = { host, activeElement: null };
  const inner = { ownerDocument: hostDoc, getRootNode: () => root };
  root.activeElement = inner;
  assert.equal(kept.call(inner), true);
  root.activeElement = {};
  assert.equal(kept.call(inner), false);
});

test("a dialog a step opened is recorded without its URL either: a page may put a value there", async () => {
  await withFakes(async ({ tree, dir, config, write }) => {
    tree.elements["#card"].inputNavigatesTo = `${PAGE}?value=${CARD}`;
    tree.elements["#card"].inputDialog = { type: "alert", message: "saved" };
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "card", action: "fill", target: "#card", value: CARD }])),
        config,
      }),
      { code: "action_dialog_opened" },
    );
    const [receipt] = receiptsIn(dir);
    assert.match(JSON.stringify(receipt.evidence), /alert/);
    assert.doesNotMatch(JSON.stringify(receipt), LEAKED_CARD);
  });
});

test("a click on content a closed shadow root may take in is gated: no script can see where it goes", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#closedhost"] = {
      backendNodeId: 41,
      box: [300, 60, 60, 20],
      closedShadow: true,
    };
    tree.elements["#slotted"] = {
      backendNodeId: 42,
      box: [300, 90, 60, 20],
      lightPath: ["#closedhost"],
    };
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "slot", action: "click", target: "#slotted" }])), config }),
      (error) => error.code === "flow_submit_undeclared" && /step slot/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, []);
    const envelope = await flow({
      file: write(flowOf([{ action: "click", target: "#help" }]), "open.json"),
      config,
    });
    assert.equal(envelope.result.status, "completed", "a path with no closed root is not gated");
  });
});

test("the path a click takes, page-side: slots, parents and shadow hosts, up to the document", async () => {
  const { CLICK_PATH } = await importRuntimeModule("core/cdp-element-functions.js");
  const walk = vm.runInNewContext(`(${CLICK_PATH})`);
  const top = { host: undefined };
  const body = { parentElement: null, assignedSlot: null, getRootNode: () => top };
  const host = { parentElement: body, assignedSlot: null, getRootNode: () => top };
  const root = { host };
  const slot = { parentElement: null, assignedSlot: null, getRootNode: () => root };
  const light = { parentElement: host, assignedSlot: slot, getRootNode: () => top };
  const path = walk.call(light);
  assert.equal(path.length, 4);
  for (const [at, expected] of [light, slot, host, body].entries())
    assert.equal(path[at], expected);
});

test("a press that makes its control form-level is released away from it, and stays in doubt", async () => {
  await withFakes(async ({ cdp, tree, dir, config, write }) => {
    tree.elements["#help"].pressMakesGated = true;
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "help", action: "click", target: "#help" }])), config }),
      (error) =>
        error.code === "mutation_outcome_unknown" && /press made it form-level/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, [], "the release went outside the viewport: no click completed");
    assert.ok(
      cdp.input.some((event) => event.type === "mouseReleased" && event.x === -1 && event.y === -1),
    );
    assert.equal(receiptsIn(dir)[0].outcome, "unknown");
  });
});

test("a press whose control captured the pointer is still cancelled: capture released, click blocked", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#help"].pressMakesGated = true;
    tree.elements["#help"].capturesPointer = true;
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "help", action: "click", target: "#help" }])), config }),
      (error) =>
        error.code === "mutation_outcome_unknown" && /press made it form-level/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, [], "the captured release completed no click");
  });
});

test("a press that hands pointer capture to a form's button is cancelled: the release would click it", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#help"].pointerdownCaptures = "#pay";
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "help", action: "click", target: "#help" }])), config }),
      (error) =>
        error.code === "mutation_outcome_unknown" && /press made it form-level/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, [], "no click reached the button that took the capture");
  });
});

test("a click is judged again as it lands: a mouseup handler that makes its control form-level", async () => {
  await withFakes(async ({ cdp, tree, dir, config, write }) => {
    tree.elements["#help"].releaseMakesGated = true;
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "help", action: "click", target: "#help" }])), config }),
      (error) => error.code === "mutation_outcome_unknown" && /as it landed/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, [], "the landing click was prevented");
    assert.equal(receiptsIn(dir)[0].outcome, "unknown");
  });
});

test("a click handler that makes its own control form-level is judged once the handlers ran", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#help"].clickMakesGated = true;
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "help", action: "click", target: "#help" }])), config }),
      (error) => error.code === "mutation_outcome_unknown" && /as it landed/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, []);
  });
});

test("a key press is watched for the clicks it causes: one that lands on a form-level control is prevented", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    // an access key, or a keydown handler, that clicks the form's button
    tree.elements["#user"].keyClicks = "#pay";
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "tab", action: "press", key: "Tab", target: "#user" }])),
        config,
      }),
      (error) => error.code === "mutation_outcome_unknown" && /as it landed/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, []);
  });
});

test("a captor that cannot be looked up is judged gated: a click is let go only when it can be judged", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#help"].captorFails = true;
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "help", action: "click", target: "#help" }])), config }),
      (error) => error.code === "flow_submit_undeclared" && /step help/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, []);
  });
});

test("a captor slotted into a closed root is asked about over CDP, like the pointer's own path", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#closedhost"] = {
      backendNodeId: 41,
      box: [300, 60, 60, 20],
      closedShadow: true,
    };
    tree.elements["#slotted"] = {
      backendNodeId: 42,
      box: [300, 90, 60, 20],
      lightPath: ["#closedhost"],
    };
    tree.elements["#help"].pointerdownCaptures = "#slotted";
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "help", action: "click", target: "#help" }])), config }),
      (error) =>
        error.code === "mutation_outcome_unknown" && /press made it form-level/.test(error.message),
    );
    assert.deepEqual(cdp.clicks, []);
  });
});

test("a check after the press that cannot judge is a cancelled press, in doubt, not a clean refusal", async () => {
  await withFakes(async ({ cdp, tree, dir, config, write }) => {
    // the press covers the button with another frame: the second hit test cannot be read
    tree.elements["#help"].pressObscures = true;
    await assert.rejects(
      flow({ file: write(flowOf([{ id: "help", action: "click", target: "#help" }])), config }),
      (error) => error.code === "mutation_outcome_unknown",
    );
    assert.deepEqual(cdp.clicks, []);
    assert.equal(receiptsIn(dir)[0].outcome, "unknown", "the press was sent: the receipt says so");
  });
});

test("the pointer's captor, page-side: found in the document or an open root, and judged", async () => {
  const { CAPTOR_GATE } = await importRuntimeModule("core/cdp-flow-acts.js");
  const top = { host: undefined };
  const form = {
    tagName: "FORM",
    matches: (sel) => sel === "form",
    parentElement: null,
    assignedSlot: null,
    getRootNode: () => top,
  };
  const node = (tagName, extra) => ({
    tagName,
    type: "",
    form: null,
    parentElement: null,
    assignedSlot: null,
    getRootNode: () => top,
    matches(selector) {
      return selector
        .split(",")
        .map((part) => part.trim())
        .includes(this.tagName.toLowerCase());
    },
    hasPointerCapture: () => false,
    shadowRoot: null,
    ...extra,
  });
  const pay = node("BUTTON", {
    type: "submit",
    form,
    parentElement: form,
    hasPointerCapture: (id) => id === 1,
  });
  const root = { querySelectorAll: () => [pay] };
  const host = node("PAY-FORM", { shadowRoot: root });
  const help = node("BUTTON", { type: "button" });
  const doc = { querySelectorAll: () => [help, host] };
  const target = { ownerDocument: doc };
  assert.equal(vm.runInNewContext(`(${CAPTOR_GATE})`).call(target), true);
  pay.hasPointerCapture = () => false;
  assert.equal(
    vm.runInNewContext(`(${CAPTOR_GATE})`).call(target),
    false,
    "no captor: nothing to judge",
  );
});

test("the click-time guard, page-side: a form-level click target is prevented, another is let be", async () => {
  const { CLICK_GUARD, CLICK_GUARD_END } = await importRuntimeModule("core/cdp-flow-acts.js");
  const top = { host: undefined };
  const node = (tagName, extra) => ({
    tagName,
    nodeType: 1,
    type: "",
    form: null,
    parentElement: null,
    assignedSlot: null,
    getRootNode: () => top,
    matches(selector) {
      return selector
        .split(",")
        .map((part) => part.trim())
        .includes(this.tagName.toLowerCase());
    },
    ...extra,
  });
  const form = node("FORM");
  const pay = node("BUTTON", { type: "submit", form, parentElement: form });
  const plain = node("DIV");
  const listeners = [];
  const observers = [];
  const view = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn) => {
      const at = listeners.findIndex((entry) => entry.type === type && entry.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    // the page's own MutationObserver: records arrive in the microtask after a listener returns
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.connected = true;
        observers.push(this);
      }
      observe(node, options) {
        this.observed.push({ node, options });
      }
      disconnect() {
        this.connected = false;
      }
      mutate(node) {
        this.callback([{ type: "attributes", target: node }]);
      }
    },
  };
  const target = { ownerDocument: { defaultView: view } };
  const clickOn = (on) => ({
    prevented: false,
    composedPath: () => [on],
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {},
  });
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  // capture and bubble: judged before the page's handlers, and again after them, before activation
  assert.deepEqual(
    listeners.map((entry) => entry.capture),
    [true, false],
  );
  const harmless = clickOn(plain);
  listeners[0].fn(harmless);
  assert.equal(harmless.prevented, false);
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), false);
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const submitting = clickOn(pay);
  listeners[0].fn(submitting);
  assert.equal(submitting.prevented, true);
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), true);
  assert.equal(listeners.length, 0);
  // a target-phase handler that makes the control form-level: the bubble listener judges it
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const late = node("BUTTON", { type: "submit" });
  const lateClick = clickOn(late);
  listeners[0].fn(lateClick);
  assert.equal(lateClick.stopped ?? false, false, "not form-level when the click was dispatched");
  assert.equal(lateClick.prevented, false, "the page's handlers see the click as it was sent");
  late.form = form;
  listeners[1].fn(lateClick);
  assert.equal(lateClick.prevented, true, "form-level once the page's own handlers ran");
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), true);
  assert.equal(listeners.length, 0);
  // the path is the event's own, fixed when it was dispatched: a handler that removed the
  // clicked span from the submit button does not hide the button
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const detached = node("SPAN");
  const inButton = node("BUTTON", { type: "submit", form });
  const removed = { ...clickOn(detached), composedPath: () => [detached, inButton, form] };
  listeners[1].fn(removed);
  assert.equal(removed.prevented, true);
  vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target);
  // a listener the page adds after ours gives the button a form: its activation was prevented
  // anyway (a submit button with no form does nothing by default), and the end reports it
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const unowned = node("BUTTON", { type: "submit" });
  const later = clickOn(unowned);
  listeners[0].fn(later);
  assert.equal(later.prevented, false, "not before the page's handlers");
  listeners[1].fn(later);
  assert.equal(later.prevented, true, "a submitting control's activation is prevented unowned too");
  unowned.form = form;
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), true);
  // any button's activation is held (a later listener may make a type=button a submitter), and
  // nothing is reported for one that stayed a formless plain button
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const plainButton = node("BUTTON", { type: "button" });
  const plainClick = clickOn(plainButton);
  listeners[1].fn(plainClick);
  assert.equal(plainClick.prevented, true);
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), false);
  // one a later listener turned into a submitter with a form is reported
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const turned = node("BUTTON", { type: "button" });
  const turnedClick = clickOn(turned);
  listeners[1].fn(turnedClick);
  turned.type = "submit";
  turned.form = form;
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), true);
  // a link or a checkbox is not held
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const box = node("INPUT", { type: "checkbox" });
  const boxClick = clickOn(box);
  listeners[1].fn(boxClick);
  assert.equal(boxClick.prevented, false);
  vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target);
  // nor a click whose activation does more than reach a form - a popover or command target, or
  // a link around the button (Chromium follows it): holding it would lose what the page does
  const attributes = (names) => ({ hasAttribute: (name) => names.includes(name) });
  const kept = [
    ["popover target", [node("BUTTON", { popoverTargetElement: plain })]],
    ["command target", [node("BUTTON", { type: "button", commandForElement: plain })]],
    ["input popover target", [node("INPUT", { type: "button", popoverTargetElement: plain })]],
    ["link", [node("BUTTON", { type: "button" }), node("A", attributes(["href"]))]],
    ["svg link", [node("BUTTON", { type: "button" }), node("a", attributes(["xlink:href"]))]],
    ["area", [node("INPUT", { type: "button" }), node("AREA", attributes(["href"]))]],
  ];
  for (const [label, path] of kept) {
    vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
    const keptClick = { ...clickOn(path[0]), composedPath: () => path };
    listeners[0].fn(keptClick);
    listeners[1].fn(keptClick);
    assert.equal(keptClick.prevented, false, label);
    assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), false, label);
  }
  // what keeps its activation is judged after the page's handlers still: a handler that gave a
  // popover button a form made it form-level, and its click is stopped
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const popSubmit = node("BUTTON", { type: "submit", popoverTargetElement: plain });
  const popClick = clickOn(popSubmit);
  listeners[0].fn(popClick);
  assert.equal(popClick.prevented, false);
  popSubmit.form = form;
  listeners[1].fn(popClick);
  assert.equal(popClick.prevented, true);
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), true);
  // a popover target on what is no button does nothing (a checkbox inside a button)
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const oddPath = [
    node("INPUT", { type: "checkbox", popoverTargetElement: plain }),
    node("BUTTON", { type: "button" }),
  ];
  const oddClick = { ...clickOn(oddPath[0]), composedPath: () => oddPath };
  listeners[1].fn(oddClick);
  assert.equal(oddClick.prevented, true);
  vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target);
  // a later listener that turns any input or button on the path into a submitter with a form
  // (a checkbox made a submit input): the change is seen as the listener returns, while the
  // click still dispatches, and its activation is prevented then
  for (const [label, made] of [
    ["checkbox", node("INPUT", { type: "checkbox" })],
    ["text field", node("INPUT", { type: "text" })],
    ["popover button", node("BUTTON", { type: "button", popoverTargetElement: plain })],
  ]) {
    const before = observers.length;
    vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
    const observer = observers[before];
    assert.ok(observer, label);
    const madeClick = { ...clickOn(made), composedPath: () => [made, plain] };
    listeners[0].fn(madeClick);
    assert.deepEqual(
      observer.observed.map((entry) => entry.node),
      [top],
      `${label}: the tree the path's inputs and buttons live in is watched, once`,
    );
    const { attributeFilter, ...watched } = observer.observed[0].options;
    assert.deepEqual([...attributeFilter].sort(), ["form", "id", "type"], label);
    assert.deepEqual(
      JSON.parse(JSON.stringify(watched)),
      { subtree: true, childList: true, attributes: true },
      label,
    );
    listeners[1].fn(madeClick);
    assert.equal(madeClick.prevented, false, `${label}: nothing to hold yet`);
    observer.mutate(made);
    assert.equal(madeClick.prevented, false, `${label}: a change that makes no submitter`);
    made.type = "submit";
    observer.mutate(made);
    assert.equal(madeClick.prevented, false, `${label}: a submitter with no form does nothing`);
    made.form = form;
    observer.mutate(made);
    assert.equal(madeClick.prevented, true, `${label}: made a submitter of a form, held`);
    assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), true, label);
    assert.equal(observer.connected, false, `${label}: the watch ends with the guard`);
  }
  // whatever changed - a form given the id a popover button's form attribute names, a form
  // inserted, the button moved - the path is judged again: here a form took the id
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const named = node("BUTTON", { type: "submit", popoverTargetElement: plain });
  const namedClick = {
    ...clickOn(named),
    composedPath: () => [named, node("INPUT", { type: "text" }), plain],
  };
  listeners[0].fn(namedClick);
  assert.equal(observers[observers.length - 1].observed.length, 1, "one tree, watched once");
  listeners[1].fn(namedClick);
  assert.equal(namedClick.prevented, false, "a popover button with no form keeps its popover");
  named.form = form;
  observers[observers.length - 1].mutate(form);
  assert.equal(namedClick.prevented, true);
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), true);
  // a control moved into another tree (a shadow root's form) is followed there: the tree it now
  // lives in is watched from the next delivery on
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const mover = node("INPUT", { type: "checkbox" });
  const moverClick = { ...clickOn(mover), composedPath: () => [mover, plain] };
  listeners[0].fn(moverClick);
  const moverWatch = observers[observers.length - 1];
  const shadowTree = { host: plain };
  mover.getRootNode = () => shadowTree;
  moverWatch.mutate(mover);
  assert.deepEqual(
    moverWatch.observed.map((entry) => entry.node),
    [top, shadowTree],
  );
  assert.deepEqual(moverWatch.observed[1].options, moverWatch.observed[0].options);
  moverWatch.mutate(mover);
  assert.equal(moverWatch.observed.length, 2, "a tree is watched once");
  mover.type = "submit";
  mover.form = form;
  moverWatch.mutate(mover);
  assert.equal(moverClick.prevented, true);
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), true);
  // a path with no input or button watches nothing
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  listeners[0].fn(clickOn(plain));
  assert.deepEqual(observers[observers.length - 1].observed, []);
  vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target);
  // a click the page dispatches from a handler (el.click()) is judged too, and does not hide the
  // one still dispatching around it: a later change to that one's path still holds it
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const outerBox = node("INPUT", { type: "checkbox" });
  const outerClick = { ...clickOn(outerBox), composedPath: () => [outerBox] };
  listeners[0].fn(outerClick);
  const nestedClick = { ...clickOn(plain), composedPath: () => [plain] };
  listeners[0].fn(nestedClick);
  listeners[1].fn(nestedClick);
  nestedClick.eventPhase = 0;
  outerBox.type = "submit";
  outerBox.form = form;
  observers[observers.length - 1].mutate(outerBox);
  assert.equal(outerClick.prevented, true);
  assert.equal(nestedClick.prevented, false, "not the nested click: its path holds no such input");
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), true);
  // an input on the finished nested click's path only, made a submitter while the outer click
  // still dispatches, holds nothing: neither click can activate it any more
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const outerPlain = { ...clickOn(plain), composedPath: () => [plain] };
  listeners[0].fn(outerPlain);
  const nestedBox = node("INPUT", { type: "checkbox" });
  const nestedBoxClick = { ...clickOn(nestedBox), composedPath: () => [nestedBox] };
  listeners[0].fn(nestedBoxClick);
  nestedBoxClick.eventPhase = 0;
  nestedBox.type = "submit";
  nestedBox.form = form;
  observers[observers.length - 1].mutate(nestedBox);
  assert.equal(outerPlain.prevented, false);
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), false);
  // a change after the click was dispatched is no longer this click's
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const afterwards = node("INPUT", { type: "checkbox" });
  const doneClick = { ...clickOn(afterwards), composedPath: () => [afterwards] };
  listeners[0].fn(doneClick);
  doneClick.eventPhase = 0;
  afterwards.type = "submit";
  afterwards.form = form;
  observers[observers.length - 1].mutate(afterwards);
  assert.equal(doneClick.prevented, false);
  assert.equal(vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target), false);
  // an anchor with no href is no link
  vm.runInNewContext(`(${CLICK_GUARD})`).call(target);
  const inAnchor = node("BUTTON", { type: "button" });
  const anchorClick = {
    ...clickOn(inAnchor),
    composedPath: () => [inAnchor, node("A", attributes([]))],
  };
  listeners[1].fn(anchorClick);
  assert.equal(anchorClick.prevented, true);
  vm.runInNewContext(`(${CLICK_GUARD_END})`).call(target);
});

test("cancelling a press, page-side: every pointer capture is let go and the next click is blocked", async () => {
  const { CANCEL_CLICK, UNCANCEL_CLICK } = await importRuntimeModule(
    "core/cdp-element-functions.js",
  );
  const released = [];
  const listeners = [];
  const element = (name, captured, shadowRoot = null) => ({
    shadowRoot,
    hasPointerCapture: (id) => captured && id === 1,
    releasePointerCapture: (id) => released.push([name, id]),
  });
  const inner = element("inner", true);
  const host = element("host", false, { querySelectorAll: () => [inner] });
  const view = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn, capture) => {
      const at = listeners.findIndex(
        (entry) => entry.type === type && entry.fn === fn && entry.capture === capture,
      );
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  const doc = { defaultView: view, querySelectorAll: () => [element("button", true), host] };
  const target = { ownerDocument: doc };
  vm.runInNewContext(`(${CANCEL_CLICK})`).call(target);
  assert.deepEqual(
    released,
    [
      ["button", 1],
      ["inner", 1],
    ],
    "capture let go in the document and open roots",
  );
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, "click");
  assert.equal(listeners[0].capture, true);
  const event = {
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  };
  listeners[0].fn(event);
  assert.equal(event.prevented && event.stopped, true);
  vm.runInNewContext(`(${UNCANCEL_CLICK})`).call(target);
  assert.equal(listeners.length, 0, "the blocker is gone after the release");
});

test("focus is checked after every modifier: a handler on the first cannot take the second", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#user"].modifierMovesFocusTo = "#card";
    await assert.rejects(
      flow({
        file: write(
          flowOf([{ id: "two", action: "press", key: "Shift+Control+a", target: "#user" }]),
        ),
        config,
      }),
      (error) => error.code === "mutation_outcome_unknown" && /focus left/.test(error.message),
    );
    assert.equal(
      cdp.keys.filter((key) => key.key === "Control").filter((key) => key.type !== "keyUp").length,
      0,
    );
  });
});

test("a key after held modifiers checks focus again: a modifier's handler may move it", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#user"].modifierMovesFocusTo = "#card";
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "shift", action: "press", key: "Shift+a", target: "#user" }])),
        config,
      }),
      (error) => error.code === "mutation_outcome_unknown" && /focus left/.test(error.message),
    );
    assert.equal(cdp.keys.filter((key) => key.key === "a").length, 0);
  });
});

test("a frame refusal lists the page's frames by origin only", async () => {
  const withFrame = (url) => {
    const tree = cdpTree(url);
    const pay = {
      ...cdpTree(`https://pay.example/form?secret=${CARD}`),
      id: "PAYFRAME",
      owner: { backendNodeId: 50, box: [0, 200, 500, 300] },
    };
    pay.nodes = [ax("1", "RootWebArea", "", 0)];
    tree.nodes = [...tree.nodes, ax("9", "Iframe", "", 50)];
    tree.frames = [pay];
    return tree;
  };
  await withFakes(
    async ({ dir, config, write }) => {
      await assert.rejects(
        flow({
          file: write(
            flowOf([
              {
                id: "nowhere",
                action: "fill",
                target: "#card",
                value: "x",
                frame: "https://pay.example/other",
              },
            ]),
          ),
          config,
        }),
        (error) =>
          error.code === "action_frame_unknown" &&
          /https:\/\/pay\.example/.test(error.message) &&
          !LEAKED_CARD.test(`${error.message} ${JSON.stringify(error.details)}`),
      );
      assert.doesNotMatch(JSON.stringify(receiptsIn(dir)), LEAKED_CARD);
    },
    { tree: withFrame, origins: ["https://shop.example", "https://pay.example"] },
  );
});

test("a fill whose select handler moves focus types nothing there", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.elements["#user"].selectMovesFocusTo = "#card";
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "user", action: "fill", target: "#user", value: "alice" }])),
        config,
      }),
      (error) => error.code === "mutation_outcome_unknown" && /focus left/.test(error.message),
    );
    assert.deepEqual(cdp.values, {});
  });
});

test("a refusal names the page's origin, never a URL a page may have put a value into", async () => {
  await withFakes(async ({ tree, dir, config, write }) => {
    tree.elements["#card"].inputNavigatesTo = `${PAGE}?value=${CARD}`;
    await assert.rejects(
      flow({
        file: write(
          flowOf([
            { action: "fill", target: "#card", value: CARD },
            { id: "says", action: "assert", that: { text: "Nope" } },
          ]),
        ),
        config,
      }),
      (error) =>
        error.code === "flow_assertion_failed" &&
        !LEAKED_CARD.test(`${error.message} ${JSON.stringify(error.details)}`),
    );
    tree.url = PAGE;
    tree.elements["a.away"].navigatesTo = `${EVIL}?value=${CARD}`;
    await assert.rejects(
      flow({
        file: write(
          flowOf([
            { action: "click", target: "a.away" },
            { id: "card2", action: "fill", target: "#user", value: "x" },
          ]),
          "away.json",
        ),
        config,
      }),
      (error) =>
        error.code === "mutation_origin_not_allowed" &&
        !LEAKED_CARD.test(`${error.message} ${JSON.stringify(error.details)}`),
    );
    assert.doesNotMatch(JSON.stringify(receiptsIn(dir)), LEAKED_CARD);
  });
});

test("a dialog a step opened is recorded without its message: a page may echo a value", async () => {
  await withFakes(async ({ tree, dir, config, write }) => {
    tree.elements["#card"].inputDialog = { type: "alert", message: `you typed ${CARD}` };
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "card", action: "fill", target: "#card", value: CARD }])),
        config,
      }),
      { code: "action_dialog_opened" },
    );
    const [receipt] = receiptsIn(dir);
    assert.equal(receipt.outcome, "unknown");
    assert.match(JSON.stringify(receipt.evidence), /alert/);
    assert.doesNotMatch(JSON.stringify(receipt), LEAKED_CARD);
  });
});

test("a frame that navigated after the connection was held is found at its new address", async () => {
  const ONE = "https://pay.example/one";
  const TWO = "https://pay.example/two";
  const navigating = (url) => {
    const tree = cdpTree(url);
    const pay = {
      ...cdpTree(ONE),
      id: "PAYFRAME",
      owner: { backendNodeId: 50, box: [0, 200, 500, 300] },
    };
    pay.nodes = [ax("1", "RootWebArea", "", 0)];
    tree.nodes = [...tree.nodes, ax("9", "Iframe", "", 50)];
    tree.frames = [pay];
    tree.elements["#help"].navigatesFrame = { frame: pay, to: TWO };
    return tree;
  };
  await withFakes(
    async ({ config, write }) => {
      const envelope = await flow({
        file: write(
          flowOf([
            { action: "click", target: "#help" },
            { id: "card", action: "fill", target: "#card", value: CARD, frame: TWO },
          ]),
        ),
        config,
      });
      assert.equal(envelope.result.status, "completed");
    },
    { tree: navigating, origins: ["https://shop.example", "https://pay.example"] },
  );
});

test("a flow file that does not parse is refused without any of its content in the message", async () => {
  await withFakes(async ({ config, write }) => {
    const sentinel = "card-7731-must-not-leak";
    for (const [name, text] of [
      // js-yaml quotes the lines around its error position, and an alias's name in its reason
      ["leak.yaml", `schema_version: 1\nsteps:\n  - { value: "${sentinel}" \n  - x: [`],
      [
        "alias.yaml",
        `schema_version: 1\nsteps:\n  - { action: fill, target: "#card", value: *${sentinel} }`,
      ],
      ["leak.json", `{"schema_version": 1, "steps": [{"value": "${sentinel}"} oops]}`],
    ]) {
      await assert.rejects(flow({ file: write(text, name), config }), (error) => {
        assert.equal(error.code, "config_invalid");
        assert.doesNotMatch(
          `${error.message} ${JSON.stringify(error.details)}`,
          new RegExp(sentinel),
        );
        return true;
      });
    }
  });
});

test("a select whose value no option has is refused without the value in any record", async () => {
  await withFakes(async ({ dir, config, write }) => {
    const sentinel = "option-7731-must-not-leak";
    const file = write(
      flowOf([{ id: "pick", action: "select", target: "#country", value: sentinel }]),
    );
    await assert.rejects(flow({ file, config }), (error) => {
      assert.equal(error.code, "action_option_not_found");
      assert.doesNotMatch(
        `${error.message} ${JSON.stringify(error.details)}`,
        new RegExp(sentinel),
      );
      return true;
    });
    const [receipt] = receiptsIn(dir);
    assert.equal(receipt.outcome, "failed");
    assert.doesNotMatch(JSON.stringify(receipt), new RegExp(sentinel));
  });
});

test("an act that opens a dialog stops the flow as a dialog, its receipt unknown", async () => {
  await withFakes(async ({ dir, tree, config, write }) => {
    tree.elements["#help"].dialog = { type: "confirm", message: "Leave?" };
    const file = write(
      flowOf([
        { id: "help", action: "click", target: "#help" },
        { action: "fill", target: "#card", value: CARD },
      ]),
    );
    await assert.rejects(flow({ file, config }), (error) => {
      assert.equal(error.code, "action_dialog_opened");
      assert.match(error.message, /step help/);
      return true;
    });
    const receipts = receiptsIn(dir);
    assert.equal(receipts.length, 1, "the flow stopped at the dialog");
    assert.equal(receipts[0].outcome, "unknown");
  });
});

// When the page's own timer fires depends on how fast the step's last round trips go: the dialog
// stops the flow at whichever step sees it. That a dialog opened between two steps stops the next
// one - a read included - is proved deterministically at the transport, below.
test("a dialog the page opens on its own timer around a step stops the flow at the step that sees it", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    const file = write(
      flowOf([
        { id: "help", action: "click", target: "#help" },
        { id: "look", action: "assert", that: { text: "Welcome" } },
      ]),
    );
    // the page's own timer, after the click settled: the held connection still hears it
    tree.elements["#help"].laterDialog = { type: "alert", message: "Session expires" };
    await assert.rejects(flow({ file, config }), (error) => {
      assert.equal(error.code, "action_dialog_opened");
      assert.match(error.message, /step (help|look)/);
      return true;
    });
    assert.equal(cdp.dialogs.length, 1);
  });
});

test("an act left in doubt is never repeated by a rerun of the same flow", async () => {
  await withFakes(async ({ cdp, tree, config, write }) => {
    tree.inputFails = "mouseReleased";
    const file = write(flowOf([{ id: "help", action: "click", target: "#help" }]));
    await assert.rejects(flow({ file, config }), { code: "mutation_outcome_unknown" });
    delete tree.inputFails;
    const pressed = cdp.input.filter((event) => event.type === "mousePressed").length;
    await assert.rejects(flow({ file, config }), (error) => {
      assert.equal(error.code, "mutation_replay_refused");
      return true;
    });
    assert.equal(cdp.input.filter((event) => event.type === "mousePressed").length, pressed);
  });
});

test("a step names a frame by URL: it acts there, and the frame's origin must be allowlisted", async () => {
  const FRAME = "https://pay.example/form";
  const withFrame = (url) => {
    const pay = { ...cdpTree(FRAME), owner: { backendNodeId: 50, box: [0, 200, 500, 300] } };
    pay.nodes = [ax("1", "RootWebArea", "", 0)];
    return {
      url,
      nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "Iframe", "", 50)],
      elements: { "#pay-frame": { backendNodeId: 50, box: [0, 200, 500, 300], iframeIndex: 0 } },
      frames: [pay],
      form: structuredClone(MODEL),
    };
  };
  const steps = [
    { id: "card", action: "fill", target: "#card", value: CARD, frame: `${FRAME}?t=1` },
  ];
  await withFakes(
    async ({ config, write }) => {
      await assert.rejects(flow({ file: write(flowOf(steps)), config }), {
        code: "mutation_origin_not_allowed",
      });
    },
    { tree: withFrame },
  );
  await withFakes(
    async ({ config, write }) => {
      const envelope = await flow({ file: write(flowOf(steps)), config });
      assert.equal(envelope.result.status, "completed");
    },
    { tree: withFrame, origins: ["https://shop.example", "https://pay.example"] },
  );
});

test("a frame the page inserts after the flow started is found: a held connection reads frames afresh", async () => {
  const FRAME = "https://pay.example/form";
  const revealing = (url) => {
    const tree = cdpTree(url);
    const pay = {
      ...cdpTree(FRAME),
      id: "PAYFRAME",
      owner: { backendNodeId: 50, box: [0, 200, 500, 300] },
    };
    pay.nodes = [ax("1", "RootWebArea", "", 0)];
    tree.elements["#help"].revealsFrame = pay;
    return tree;
  };
  await withFakes(
    async ({ config, write }) => {
      const envelope = await flow({
        file: write(
          flowOf([
            { action: "click", target: "#help" },
            { id: "card", action: "fill", target: "#card", value: CARD, frame: FRAME },
          ]),
        ),
        config,
      });
      assert.equal(envelope.result.status, "completed");
    },
    { tree: revealing, origins: ["https://shop.example", "https://pay.example"] },
  );
});

test("a dialog the held connection heard before a step runs stops that step", async () => {
  const { holdCdpActions, releaseCdpActions, runStepInFrame } = await importRuntimeModule(
    "core/cdp-step-transport.js",
  );
  const tree = cdpTree(PAGE);
  const cdp = await startFakeCdp({ pages: { P1: { url: PAGE, tree } } });
  const env = { TEST_CAPABILITIES_CDP_ENDPOINT: cdp.url };
  const session = { url: PAGE, readiness: { href: PAGE } };
  try {
    await holdCdpActions(session, env);
    cdp.openDialog({ type: "alert", message: "Session expires" });
    const deadline = Date.now() + 2000;
    while (cdp.dialogs.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(cdp.dialogs.length, 1, "the held connection answered the dialog");
    const payload = {
      step: "look",
      condition: { text: "Welcome" },
      origins: [],
      submit: "undeclared",
    };
    await assert.rejects(
      runStepInFrame(session, env, {
        command: "flow.assert",
        args: [JSON.stringify(payload)],
        frame: "main",
        effect: "read_only",
      }),
      { code: "action_dialog_opened" },
    );
  } finally {
    await releaseCdpActions(session);
    await cdp.close();
  }
});

test("a frame's worlds are its session's: a frame that moved process gets new ones, never an old id", async () => {
  const { frameWorlds } = await importRuntimeModule("core/cdp-worlds.js");
  const sent = [];
  let next = 0;
  const stamps = new Map();
  const connection = {
    send: async (method, params, sessionId) => {
      sent.push([method, sessionId]);
      if (method === "Page.createIsolatedWorld") return { executionContextId: ++next };
      if (method === "Runtime.evaluate") {
        const stamp = /^globalThis\.__testCapabilitiesWorld = (".*")$/.exec(params.expression);
        if (stamp) stamps.set(params.contextId, JSON.parse(stamp[1]));
        return { result: { value: stamps.get(params.contextId) } };
      }
      return {};
    },
    on: (_event, handler) => {
      connection.handler = handler;
      return () => {};
    },
  };
  const { worldOf } = frameWorlds(connection, "test-capabilities");
  const frame = { url: "https://pay.example/form", frameId: "F1", sessionId: "S1" };
  const first = await worldOf(frame);
  assert.equal(await worldOf(frame), first, "the same session reuses its world");
  const moved = { ...frame, sessionId: "S2" };
  const second = await worldOf(moved);
  assert.notEqual(second, first, "another session makes its own world");
  assert.deepEqual(
    sent.filter(([method]) => method === "Page.createIsolatedWorld").map(([, id]) => id),
    ["S1", "S2"],
  );
});

test("a cached world proves it is ours before reuse: an id a new renderer reused is not trusted", async () => {
  const { frameWorlds } = await importRuntimeModule("core/cdp-worlds.js");
  let next = 0;
  const stamps = new Map(); // context id -> the token its world holds
  let recycled = false;
  const created = [];
  const listeners = {};
  const connection = {
    send: async (method, params) => {
      if (method === "Page.createIsolatedWorld") {
        next += 1;
        created.push(next);
        return { executionContextId: next };
      }
      if (method === "Runtime.evaluate") {
        const stamp = /^globalThis\.__testCapabilitiesWorld = (".*")$/.exec(params.expression);
        if (stamp) {
          stamps.set(params.contextId, JSON.parse(stamp[1]));
          return { result: { type: "string", value: JSON.parse(stamp[1]) } };
        }
        // a recycled id names another context now: it holds no stamp of ours
        const value = recycled ? undefined : stamps.get(params.contextId);
        return { result: { type: value === undefined ? "undefined" : "string", value } };
      }
      return {};
    },
    on: (event, handler) => {
      listeners[event] = handler;
      return () => {};
    },
  };
  const { worldOf } = frameWorlds(connection, "test-capabilities");
  const frame = { url: "https://shop.example/", frameId: "MAIN", sessionId: undefined };
  const first = await worldOf(frame);
  assert.equal(await worldOf(frame), first, "a world that still holds its stamp is reused");
  recycled = true;
  const second = await worldOf(frame);
  assert.notEqual(second, first, "an id that lost its stamp is replaced");
  assert.deepEqual(created, [1, 2]);
  assert.equal(
    typeof listeners["Page.frameNavigated"],
    "function",
    "page worlds are dropped on navigation",
  );
});

test("a page world is found again after its session reports a navigation", async () => {
  const { frameWorlds } = await importRuntimeModule("core/cdp-worlds.js");
  const handlers = {};
  let next = 10;
  let enables = 0;
  const connection = {
    send: async (method) => {
      if (method === "Runtime.enable") {
        enables += 1;
        next += 1;
        handlers["Runtime.executionContextCreated"]?.(
          { context: { id: next, auxData: { frameId: "MAIN", isDefault: true } } },
          undefined,
        );
      }
      return {};
    },
    on: (event, handler) => {
      handlers[event] = handler;
      return () => {};
    },
  };
  const { pageWorldOf } = frameWorlds(connection, "test-capabilities");
  const frame = { url: "https://shop.example/", frameId: "MAIN", sessionId: undefined };
  const first = await pageWorldOf(frame);
  assert.equal(await pageWorldOf(frame), first);
  assert.equal(enables, 1, "cached while the document stays");
  handlers["Page.frameNavigated"]({ frame: { id: "MAIN" } }, undefined);
  const second = await pageWorldOf(frame);
  assert.notEqual(second, first);
  assert.equal(enables, 2, "a navigation drops it, and it is found again");
});

// ---------------------------------------------------------------- the gate, page-side

test("the form-level control check: buttons of a form, labels for them, implicit submission", () => {
  // a node knows its parent element, its root (a shadow root has a host) and its assigned slot:
  // enough to walk the path a click's event takes, across shadow roots and through slots
  const documentRoot = { host: undefined };
  const node = (tagName, extra = {}) => {
    const self = {
      tagName,
      type: "",
      form: null,
      parentElement: null,
      assignedSlot: null,
      root: documentRoot,
      getRootNode() {
        return this.root;
      },
      getAttribute(name) {
        return name === "role" ? (this.role ?? null) : null;
      },
      matches(selector) {
        const tag = this.tagName.toLowerCase();
        return selector
          .split(",")
          .map((part) => part.trim())
          .some(
            (part) =>
              part === tag ||
              (part === '[role="button"]' && this.role === "button") ||
              (part.startsWith("input[type=") &&
                tag === "input" &&
                part.includes(`"${this.type}"`)),
          );
      },
      ...extra,
    };
    return self;
  };
  const gate = vm.runInNewContext(`(${FLOW_GATE})`);
  const form = node("FORM");
  const submit = node("BUTTON", { type: "submit", form, parentElement: form });
  const span = node("SPAN", { parentElement: submit });
  const field = node("INPUT", { type: "text", form, parentElement: form });
  const area = node("TEXTAREA", { form, parentElement: form });
  const link = node("A", { parentElement: form });
  const outside = node("BUTTON", { type: "button" });
  const label = node("LABEL", { control: submit, parentElement: form });
  const role = node("DIV", { role: "button", parentElement: form });
  const box = node("INPUT", { type: "checkbox", form, parentElement: form });
  // an icon's shadow tree inside the submit button: the click reaches the button
  const icon = node("MY-ICON", { parentElement: submit });
  const iconRoot = { host: icon };
  const inner = node("SPAN", { root: iconRoot });
  // light content slotted into a shadow button of a shadow form
  const shadowForm = node("FORM");
  const hostEl = node("PAY-BUTTON", {});
  const shadow = { host: hostEl };
  const shadowButton = node("BUTTON", {
    type: "submit",
    form: shadowForm,
    root: shadow,
    parentElement: shadowForm,
  });
  const slot = node("SLOT", { root: shadow, parentElement: shadowButton });
  const slotted = node("SPAN", { parentElement: hostEl, assignedSlot: slot });
  assert.equal(gate.call(submit, null), true);
  assert.equal(gate.call(span, null), true, "a click inside a form button is the button's");
  assert.equal(gate.call(inner, null), true, "and so is one inside a shadow tree within it");
  assert.equal(gate.call(slotted, null), true, "and one on content slotted into it");
  assert.equal(gate.call(label, null), true, "a label clicks its control");
  assert.equal(gate.call(role, null), true);
  assert.equal(gate.call(field, null), false);
  assert.equal(gate.call(area, null), false);
  assert.equal(gate.call(box, null), false);
  assert.equal(gate.call(link, null), false);
  assert.equal(gate.call(outside, null), false);
  // a button inside a label for a checkbox: the click is the button's, not the label's
  const labelForBox = node("LABEL", { control: box, parentElement: form });
  const buttonInLabel = node("BUTTON", { type: "submit", form, parentElement: labelForBox });
  assert.equal(gate.call(buttonInLabel, null), true);
  // a role=button inside a button of another form (form=): the outer button still submits
  const lonelyForm = node("FORM");
  const owned = node("BUTTON", { type: "submit", form: lonelyForm });
  const nested = node("SPAN", { role: "button", parentElement: owned });
  assert.equal(gate.call(nested, null), true);
  // what reaches a frame lands where the check cannot see: judged gated
  const frame = node("IFRAME", { parentElement: form });
  assert.equal(gate.call(frame, null), true);
  assert.equal(gate.call(node("FRAME"), null), true);
});

test("Enter and Space are activation keys, with or without modifiers, however they are spelled", async () => {
  const { isActivationKey } = await importRuntimeModule("core/cdp-flow-acts.js");
  for (const key of [
    "Enter",
    "Shift+Enter",
    "Control+Enter",
    "Space",
    " ",
    "Alt+Space",
    "Alt+s",
    "Control+Alt+s",
  ]) {
    assert.equal(isActivationKey(key), true, key);
  }
  for (const key of ["Tab", "Shift+Tab", "Escape", "ArrowDown", "a", "Backspace"]) {
    assert.equal(isActivationKey(key), false, key);
  }
});
