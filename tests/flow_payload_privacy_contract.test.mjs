import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CARD,
  DONE,
  flowOf,
  LEAKED_CARD,
  PAGE,
  receiptsIn,
  withFlowFakes,
} from "./helpers/flow-harness.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { executeCliOperation } = await importRuntimeModule("core/operations.js");
const { flowApprovalToken, parseFlow } = await importRuntimeModule("core/flow-file.js");
const flow = (input) => executeCliOperation({ command: "surf", action: "flow" }, input);

// Receipt from hosted run 37147746663, unchanged: the only "4242" is in run_id.
const RECORDED_RECEIPT = {
  schema_version: 1,
  artifact_kind: "test-capabilities.mutation.receipt",
  receipt_id: "82c731fa-01c2-49ae-935e-6a8b96d441d6",
  run_id: "765727c2-52c7-4242-aa23-ba1cbf89a733",
  operation_id: "surf.flow",
  step_id:
    "surf.flow.step:sha256:bddb4d35619a2e65ce4dd46769d3c933d01c80d21d3eb463d5d15e659b7db270:card",
  effect: "mutating",
  scope: "target",
  subject: "https://shop.example/flow tab=100",
  intent: "flow step card: fill #card",
  idempotency_key: "sha256:a7515e7b3aa58036353fe3aac51a47f9d3084d9aa07843d5f27976c56ec11faa",
  attempt: 1,
  started_at: "2026-10-03T19:27:36.369Z",
  outcome: "unknown",
  evidence: [
    "declared: flow fill acts on the target page, in the page over the DevTools connection",
    'dialogs:[{"type":"alert","answer":"dismissed"}]',
  ],
  ephemeral_store: true,
  details: {
    flow_id: "sha256:bddb4d35619a2e65ce4dd46769d3c933d01c80d21d3eb463d5d15e659b7db270",
    mode: "act",
    step: { id: "card", action: "fill", target: "#card" },
  },
  error: {
    code: "action_dialog_opened",
    message:
      "flow.fill opened a dialog; dismissal was requested. Input may already have taken effect; inspect the receipt for the answer before proceeding.",
  },
  finished_at: "2026-10-03T19:27:36.396Z",
};

test("Given the recorded UUID collision and a payload-free receipt; When the whole receipt is scanned; Then no payload echo is reported", () => {
  assert.equal(RECORDED_RECEIPT.run_id, "765727c2-52c7-4242-aa23-ba1cbf89a733");
  assert.equal(JSON.stringify(RECORDED_RECEIPT).split("4242").length - 1, 1);
  assert.doesNotMatch(JSON.stringify(RECORDED_RECEIPT), LEAKED_CARD);
});

test("Given the private fill fixture; When its marker is inspected; Then it is a strong literal impossible in UUIDs or hex digests", () => {
  assert.ok(CARD.length >= 24);
  assert.match(CARD, /[^0-9a-f-]/);
  assert.equal(LEAKED_CARD.source, CARD);
  assert.equal(LEAKED_CARD.flags, "");
  assert.match(CARD, LEAKED_CARD);
  assert.match(`a${CARD}f`, LEAKED_CARD, "hex neighbours cannot hide a real echo");
  assert.match(`-${CARD}-`, LEAKED_CARD, "hyphens cannot hide a real echo");
});

const LEAKS = [
  ["data", (value) => ({ result: { data: { value } } })],
  ["error message", (value) => ({ error: { message: `typed ${value}` } })],
  ["error details", (value) => ({ error: { details: { value } } })],
  ["URL query", (value) => ({ url: `${PAGE}?token=${value}` })],
  ["URL fragment", (value) => ({ url: `${PAGE}#${value}` })],
  ["evidence", (value) => ({ evidence: [`dialogs:${JSON.stringify({ message: value })}`] })],
  ["identifier", (value) => ({ receipt_id: `${RECORDED_RECEIPT.run_id}-${value}` })],
];

for (const [surface, leak] of LEAKS) {
  test(`Given an actual payload echo in ${surface}; When the whole record is scanned; Then the no-echo assertion rejects it`, () => {
    const record = { ...RECORDED_RECEIPT, ...leak(CARD) };
    const serialized = JSON.stringify(record);
    assert.ok(serialized.includes(CARD), "the leak must be present before checking detection");
    assert.throws(() => assert.doesNotMatch(serialized, LEAKED_CARD), { code: "ERR_ASSERTION" });
  });
}

test("Given deterministic UUID/digest fixtures; When real payload echoes are inserted; Then every echo is caught without stripping identifiers", () => {
  for (let seed = 0; seed < 32; seed++) {
    const digest = createHash("sha256").update(`flow-privacy:${seed}`).digest("hex");
    const uuid = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4242-a${digest.slice(12, 15)}-${digest.slice(16, 28)}`;
    const clean = { ...RECORDED_RECEIPT, run_id: uuid, idempotency_key: `sha256:${digest}` };
    assert.doesNotMatch(JSON.stringify(clean), LEAKED_CARD);
    for (const [surface, leak] of LEAKS) {
      const value = seed % 2 ? `a${CARD}f` : `-${CARD}-`;
      const serialized = JSON.stringify({ ...clean, ...leak(value) });
      assert.ok(serialized.includes(value), `${seed}:${surface} must cause the echo`);
      assert.throws(() => assert.doesNotMatch(serialized, LEAKED_CARD), { code: "ERR_ASSERTION" });
    }
  }
});

test("Given a private fill and field readback; When the flow completes; Then the typed value is withheld from the envelope, receipts and export", async () => {
  await withFlowFakes(async ({ cdp, dir, config, write }) => {
    const receiptOut = path.join(dir, "export.json");
    const envelope = await flow({
      file: write(
        flowOf([
          { action: "fill", target: "#card", value: CARD },
          { action: "assert", that: { field: { target: "#card", equals: CARD } } },
        ]),
      ),
      config,
      receiptOut,
    });
    assert.equal(cdp.values["#card"], CARD, "the private payload actually reached the field");
    assert.equal(envelope.result.status, "completed");
    assert.deepEqual(
      envelope.result.steps.map((step) => step.outcome),
      ["ok", "ok"],
    );
    const receipts = receiptsIn(dir);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].outcome, "applied");
    const exported = JSON.parse(readFileSync(receiptOut, "utf-8"));
    assert.equal(exported.receipts.length, 1);
    for (const record of [envelope, receipts, exported]) {
      assert.doesNotMatch(JSON.stringify(record), LEAKED_CARD);
    }
  });
});

test("Given a typed payload echoed in the page URL and dialog; When the dialog stops the flow; Then error and evidence withhold it", async () => {
  await withFlowFakes(async ({ cdp, tree, dir, config, write }) => {
    const url = `${PAGE}?value=${CARD}`;
    tree.elements["#card"].inputNavigatesTo = url;
    tree.elements["#card"].inputDialog = { type: "alert", message: `you typed ${CARD}` };
    await assert.rejects(
      flow({
        file: write(flowOf([{ id: "card", action: "fill", target: "#card", value: CARD }])),
        config,
      }),
      (error) => {
        assert.equal(cdp.values["#card"], CARD, "input must happen before the withheld error");
        assert.equal(tree.url, url, "the URL echo was actually caused");
        assert.equal(error.code, "action_dialog_opened");
        assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details)}`, LEAKED_CARD);
        return true;
      },
    );
    const receipts = receiptsIn(dir);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].outcome, "unknown");
    assert.match(JSON.stringify(receipts[0].evidence), /alert/);
    assert.doesNotMatch(JSON.stringify(receipts), LEAKED_CARD);
  });
});

test("Given a private fill and approved GET submit; When the payload reaches the destination URL; Then submit evidence and envelope withhold it", async () => {
  await withFlowFakes(async ({ cdp, tree, dir, config, write }) => {
    const url = `${DONE}?card=${CARD}`;
    tree.elements["#pay"].navigatesTo = url;
    const content = flowOf([
      { action: "fill", target: "#card", value: CARD },
      { id: "pay", action: "click", target: "#pay", submit: true, expect: { url_prefix: DONE } },
    ]);
    const envelope = await flow({
      file: write(content),
      config,
      submit: true,
      confirmFlow: flowApprovalToken(parseFlow(content, "flow.json")),
    });
    assert.equal(cdp.values["#card"], CARD);
    assert.equal(tree.url, url, "the submitted URL contains the actual payload");
    assert.equal(envelope.result.submitted, true);
    const receipts = receiptsIn(dir);
    const submit = receipts.find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "applied");
    assert.equal(submit.verified_by, "post_read");
    assert.ok(submit.evidence.some((line) => line.includes(DONE)));
    assert.doesNotMatch(JSON.stringify(receipts), LEAKED_CARD);
    assert.doesNotMatch(JSON.stringify(envelope), LEAKED_CARD);
  });
});
