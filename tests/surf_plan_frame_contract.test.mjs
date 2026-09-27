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
 * Forms inside frames (CDP program S3, AK #6145). `surf plan --frame <url>` reads a form that
 * lives in a cross-origin frame, and `surf apply` fills and submits it there - every read and act
 * a frame step (S4) inside the same ledger steps, receipts and gates as a top-document form. The
 * fake surf opens and gates the page; the fake DevTools endpoint holds the payment frame, whose
 * form model is the same stub DOM the fake surf evaluates its scripts against.
 */

const { executeCliOperation } = await importRuntimeModule("core/operations.js");
const { approvalTokenFor } = await importRuntimeModule("core/surf-plan.js");
const { planFromSession } = await importRuntimeModule("core/surf-plan-probe.js");
const { createApplyRunner } = await importRuntimeModule("core/surf-apply-runner.js");
const { createRunContext } = await importRuntimeModule("core/run-context.js");
const { SurfSession } = await importRuntimeModule("core/surf-session.js");
const { frameOriginPath } = await importRuntimeModule("core/frame-address.js");

test("frame addressing does not require URL.parse (absent on supported Node 22.0)", () => {
  const parse = URL.parse;
  try {
    URL.parse = undefined;
    assert.equal(frameOriginPath("https://pay.example/form?token=one"), "https://pay.example/form");
    assert.equal(frameOriginPath("not a URL"), undefined);
  } finally {
    URL.parse = parse;
  }
});

test("a frame navigating to another address during the plan probe cannot produce a plan", async () => {
  const session = {
    url: "https://shop.example/",
    readiness: { state: "ready", evidence: [] },
    runtime: { resolution: { provider: "fake" }, probe: {} },
    step: async () => ({
      href: "https://evil.example/form",
      fields: [],
      controls: [],
      formCount: 0,
      frameCount: 0,
    }),
  };
  await assert.rejects(
    planFromSession(session, { fields: [], frame: "https://pay.example/form" }),
    { code: "action_document_changed" },
  );
});

const SHOP = "https://shop.example/checkout";
const PAY = "https://pay.example/form";
const PAID = "https://pay.example/paid";
const ax = (id, role, name, backendDOMNodeId, children = []) => ({
  nodeId: id,
  role: { value: role },
  ...(name ? { name: { value: name } } : {}),
  ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
  childIds: children,
});

/** The shop page as surf sees it: a checkout page with the payment frame and no form of its own. */
const surfPages = () => ({
  [SHOP]: {
    title: "Checkout",
    readiness: "ready",
    links: [],
    frames: [{ src: PAY, outOfProcess: true, crossOrigin: true }],
  },
});

/** The same page over the DevTools endpoint: the payment frame and its form. */
function cdpTree() {
  const pay = {
    url: PAY,
    owner: { backendNodeId: 50, box: [0, 100, 500, 300] },
    nodes: [ax("1", "RootWebArea", "", 0)],
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
      "#pay": { backendNodeId: 23, box: [10, 70, 60, 20], navigatesTo: PAID },
      "#save": { backendNodeId: 24, box: [100, 70, 60, 20] },
    },
    form: {
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
    },
  };
  return {
    url: SHOP,
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "Iframe", "", 50)],
    elements: { "#pay-frame": { backendNodeId: 50, box: [0, 100, 500, 300], iframeIndex: 0 } },
    frames: [pay],
  };
}

const FIELDS = ["label:Card number=4242", "label:Country=fr"];

for (const href of [`${PAY}?other=token`, `${PAY}#changed`]) {
  test(`a read-back from a transiently different document is refused (${href})`, async () => {
    await withFakes(async ({ cdp, tree, dir, out }) => {
      const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
      await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
      tree.frames[0].readbackHref = href;
      await assert.rejects(apply({ plan: out, config }), { code: "fill_side_effect_observed" });
      assert.deepEqual(cdp.values, { "#card": "4242" });
      assert.equal(tree.frames[0].url, PAY, "later observation would see the original URL again");
    });
  });
}

test("a submit may be verified by a fragment change only after the click, using the full run URL", async () => {
  await withFakes(async ({ tree, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    tree.frames[0].elements["#pay"].navigatesTo = `${PAY}#paid`;
    const result = await apply({
      plan: out,
      submit: true,
      confirmPlan: readPlan(out).approval_token,
      config,
    });
    assert.equal(result.result.submitted, true);
  });
});

function writeConfig(dir, allowOrigins) {
  const file = path.join(dir, "tc.yaml");
  const origins = allowOrigins.map((origin) => `    - "${origin}"`).join("\n");
  writeFileSync(
    file,
    [
      "receipts:",
      `  dir: ${path.join(dir, "receipts")}`,
      "  ephemeral: true",
      "mutation:",
      allowOrigins.length === 0 ? "  allow_origins: []" : `  allow_origins:\n${origins}`,
      "surf:",
      "  submit:",
      "    postcondition_timeout_ms: 600",
      "    control_enable_timeout_ms: 2000",
      "",
    ].join("\n"),
  );
  return file;
}

function receiptsIn(dir) {
  const root = path.join(dir, "receipts");
  let runs = [];
  try {
    runs = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  return runs
    .flatMap((run) =>
      readdirSync(path.join(root, run.name))
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => JSON.parse(readFileSync(path.join(root, run.name, entry), "utf-8"))),
    )
    .filter((artifact) => artifact.artifact_kind === "test-capabilities.mutation.receipt");
}

/** One fake surf and one fake DevTools endpoint describing the same page, for one test. */
async function withFakes(body, { tree = cdpTree() } = {}) {
  const surf = createFakeSurf({ pages: surfPages() });
  const cdp = await startFakeCdp({ pages: { P1: { url: SHOP, tree } } });
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-plan-frame-"));
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  process.env.TEST_CAPABILITIES_CDP_ENDPOINT = cdp.url;
  try {
    await withFakeSurfEnv(surf.path, async () => {
      await body({ surf, cdp, tree, dir, out: path.join(dir, "plan.json") });
    });
  } finally {
    if (previous === undefined) delete process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
    else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = previous;
    surf.cleanup();
    await cdp.close();
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
test("frame origin+path accepts only HTTP(S), strips token and fragment, and keeps exact path", () => {
  assert.equal(frameOriginPath("https://PAY.example:443/form?a=one#x"), PAY);
  for (const invalid of ["f1", "about:blank", "file:///form"])
    assert.equal(frameOriginPath(invalid), undefined);
});

for (const suffix of ["?session=three", "?session=two#changed"]) {
  test(`a run freezes its full document and never rebinds (${suffix})`, async () => {
    await withFakes(async ({ cdp, tree, dir, out }) => {
      await plan({ url: SHOP, field: FIELDS, frame: PAY, out });
      const planned = readPlan(out);
      const context = createRunContext({
        operationId: "surf.apply",
        effect: { effect: "mutating", scope: "target", reason: "test apply" },
        env: {
          ...process.env,
          TEST_CAPABILITIES_RECEIPTS_DIR: dir,
          TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
        },
        config: { mutation: { allowOrigins: ["https://shop.example", "https://pay.example"] } },
      });
      const session = new SurfSession({ context, url: SHOP, idPrefix: "test.binding" });
      try {
        await session.open();
        await session.gate();
        tree.frames[0].url = `${PAY}?session=two`;
        const runner = createApplyRunner(session, session.readiness, {
          context,
          plan: planned,
          mode: "fill",
        });
        assert.equal(runner.documentHref, undefined);
        assert.deepEqual((await runner.fingerprint()).drift, []);
        assert.equal(runner.documentHref, `${PAY}?session=two`);
        tree.frames[0].url = `${PAY}${suffix}`;
        assert.match((await runner.fingerprint()).drift.join(";"), /url/);
        assert.equal(runner.documentHref, `${PAY}?session=two`);
        await assert.rejects(runner.setValue("f1"), { code: "action_document_changed" });
        assert.deepEqual(cdp.values, {});
        assert.deepEqual(cdp.input, []);
        tree.frames[0].url = "https://evil.example/form";
        assert.ok((await runner.fingerprint()).drift.includes("frame origin+path changed"));
      } finally {
        await session.close();
      }
    });
  });
}

for (const navigates of [false, true]) {
  test(`tokenized frames bind origin+path across runs, with an exact run baseline (navigates=${navigates})`, async () => {
    await withFakes(async ({ cdp, tree, dir, out }) => {
      const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
      tree.frames[0].url = `${PAY}?session=one`;
      await plan({ url: SHOP, field: FIELDS, frame: `${PAY}?session=old#fragment`, out, config });
      const first = readPlan(out);
      assert.deepEqual(first.target.frame, {
        url: PAY,
        origin: "https://pay.example",
        landed_href: `${PAY}?session=one`,
        match: "origin_path",
      });
      tree.frames[0].url = `${PAY}?session=two`;
      await plan({ url: SHOP, field: FIELDS, frame: PAY, out: `${out}.new`, config });
      assert.equal(readPlan(`${out}.new`).approval_token, first.approval_token);
      if (!navigates) delete tree.frames[0].elements["#pay"].navigatesTo;
      const applying = apply({
        plan: out,
        submit: true,
        confirmPlan: first.approval_token,
        config,
      });
      if (navigates) assert.equal((await applying).result.submitted, true);
      else await assert.rejects(applying, { code: "submit_postcondition_unmet" });
      assert.deepEqual(cdp.values, { "#card": "4242", "#country": "fr" });
      const submit = receiptsIn(dir).find((entry) => entry.details.mode === "submit");
      assert.equal(submit.outcome, navigates ? "applied" : "unknown");
      assert.equal(submit.details.submit.post_condition.expected, `${PAY}?session=two`);
      assert.equal(cdp.clicks.length, 1);
    });
  });
}

test("two frames at one origin+path are ambiguous even when one has the old exact URL", async () => {
  await withFakes(async ({ cdp, tree, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    const other = structuredClone(tree.frames[0]);
    other.url = `${PAY}?session=other`;
    other.owner.backendNodeId = 51;
    tree.frames.push(other);
    await assert.rejects(apply({ plan: out, config }), { code: "action_frame_ambiguous" });
    assert.deepEqual(cdp.values, {});
    assert.deepEqual(cdp.input, []);
  });
});

for (const changed of ["https://evil.example/form", "https://pay.example/form-extra"]) {
  test(`origin+path is exact, not a prefix: ${changed}`, async () => {
    await withFakes(async ({ cdp, tree, dir, out }) => {
      const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
      await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
      tree.frames[0].url = changed;
      await assert.rejects(apply({ plan: out, config }), { code: "action_frame_unknown" });
      assert.deepEqual(cdp.input, []);
    });
  });
}

test("query changes after the run binds its frame are not allowed to reach a later field", async () => {
  await withFakes(async ({ cdp, tree, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    tree.frames[0].url = `${PAY}?session=two`;
    tree.frames[0].elements["#card"].inputNavigatesTo = `${PAY}?session=three`;
    await assert.rejects(apply({ plan: out, config }), { code: "fill_side_effect_observed" });
    assert.deepEqual(cdp.values, { "#card": "4242" });
    assert.deepEqual(cdp.clicks, []);
  });
});

test("legacy frame plans keep exact URL matching and their original token content", async () => {
  await withFakes(async ({ cdp, tree, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    const legacy = readPlan(out);
    delete legacy.target.frame.match;
    legacy.approval_token = approvalTokenFor(legacy);
    writeFileSync(out, JSON.stringify(legacy));
    tree.frames[0].url = `${PAY}?session=two`;
    await assert.rejects(apply({ plan: out, config }), { code: "action_frame_unknown" });
    assert.deepEqual(cdp.input, []);
    tree.frames[0].url = PAY;
    assert.equal(
      (await apply({ plan: out, config })).result.fields.every((field) => field.matched),
      true,
    );
  });
});

test("frame schema and approval bind matching mode, canonical origin+path, and landing", async () => {
  await withFakes(async ({ cdp, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    const original = readPlan(out);
    for (const mode of [undefined, "exact"]) {
      const edited = structuredClone(original);
      edited.target.frame.match = mode;
      assert.notEqual(approvalTokenFor(edited), original.approval_token);
    }
    for (const change of [
      (p) => {
        p.target.frame.url += "?session=forged";
      },
      (p) => {
        p.target.frame.landed_href = p.fingerprint.url = "https://evil.example/form";
      },
      (p) => {
        p.target.frame.landed_href = p.fingerprint.url = `${PAY}/other`;
      },
    ]) {
      const edited = structuredClone(original);
      change(edited);
      writeFileSync(out, JSON.stringify(edited));
      await assert.rejects(apply({ plan: out, config }), { code: "config_invalid" });
    }
    const changedPath = structuredClone(original);
    changedPath.target.frame.url =
      changedPath.target.frame.landed_href =
      changedPath.fingerprint.url =
        `${PAY}/other`;
    assert.notEqual(approvalTokenFor(changedPath), original.approval_token);
    const changedOrigin = structuredClone(original);
    changedOrigin.target.frame.url =
      changedOrigin.target.frame.landed_href =
      changedOrigin.fingerprint.url =
        "https://evil.example/form";
    changedOrigin.target.frame.origin = "https://evil.example";
    assert.notEqual(approvalTokenFor(changedOrigin), original.approval_token);
    assert.deepEqual(cdp.input, []);
  });
});

test("surf plan --frame reads a form in a cross-origin frame and binds the plan to that frame", async () => {
  await withFakes(async ({ surf, cdp, out }) => {
    const envelope = await plan({ url: SHOP, field: FIELDS, frame: PAY, out });
    const written = readPlan(out);
    assert.deepEqual(written.target.frame, {
      match: "origin_path",
      url: PAY,
      origin: "https://pay.example",
      landed_href: PAY,
    });
    // the page is the shop; the form, its fingerprint and its origin of action are the frame's
    assert.equal(written.target.landed_href, SHOP);
    assert.equal(written.target.title, "Checkout");
    assert.equal(written.fingerprint.url, PAY);
    assert.deepEqual(
      written.fields.map((field) => [field.resolved_selector, field.current_value]),
      [
        ["#card", ""],
        ["#country", "de"],
      ],
    );
    assert.equal(written.submit.status, "identified");
    assert.equal(written.submit.control.selector, "#pay");
    assert.deepEqual(
      written.forbidden_controls.map((control) => control.selector),
      ["#save"],
    );
    // the approval binds to the frame: the same fields in the top document are another plan
    assert.equal(written.approval_token, approvalTokenFor(written));
    const { frame: _frame, ...topTarget } = written.target;
    assert.notEqual(approvalTokenFor({ ...written, target: topTarget }), written.approval_token);
    assert.deepEqual(envelope.result.target.frame, {
      match: "origin_path",
      url: PAY,
      origin: "https://pay.example",
      landedHref: PAY,
    });
    // surf opened and gated the page; the probe ran in the frame's isolated world
    assert.deepEqual(verbs(surf), ["tab.new", "wait.ready", "tab.close"]);
    assert.ok(cdp.worlds.some((world) => world.frame === PAY));
    assert.deepEqual(cdp.input, []);
  });
});

test("a field the frame does not have is not found in that frame, with no frame diagnosis", async () => {
  await withFakes(async ({ surf, out }) => {
    await assert.rejects(plan({ url: SHOP, field: ["label:CVC=123"], frame: PAY, out }), {
      code: "plan_field_not_found",
      message: /in frame https:\/\/pay\.example\/form/,
    });
    assert.equal(verbs(surf).includes("frame.diagnose"), false);
  });
});

test("a plan names its frame by URL; apply refuses --frame, which the plan decides", async () => {
  await withFakes(async ({ dir, out }) => {
    await assert.rejects(plan({ url: SHOP, field: FIELDS, frame: "f1", out }), /by its URL/);
    // a library caller past the operation's schema: refused before the session is asked anything
    const asked = [];
    const session = {
      url: SHOP,
      readiness: { state: "ready", evidence: [], href: SHOP, title: "Checkout" },
      runtime: { resolution: { provider: "fake" }, probe: {} },
      step: async (step) => asked.push(step),
    };
    await assert.rejects(planFromSession(session, { fields: [], frame: "f1" }), {
      code: "config_invalid",
      message: /names its frame by URL/,
    });
    assert.deepEqual(asked, []);
    await assert.rejects(apply({ plan: out, frame: PAY, config: writeConfig(dir, []) }), {
      code: "unsupported_option",
    });
  });
});

test("apply fills the form in the frame through the frame's own inputs, and clicks nothing", async () => {
  await withFakes(async ({ surf, cdp, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    const envelope = await apply({ plan: out, config });
    assert.equal(envelope.result.submitted, false);
    assert.deepEqual(
      envelope.result.fields.map((field) => [field.id, field.matched]),
      [
        ["f1", true],
        ["f2", true],
      ],
    );
    assert.deepEqual(cdp.values, { "#card": "4242", "#country": "fr" });
    assert.deepEqual(cdp.clicks, []);
    const receipts = receiptsIn(dir);
    assert.deepEqual(
      receipts.map((receipt) => [receipt.outcome, receipt.details.mode]),
      [
        ["applied", "fill"],
        ["applied", "fill"],
      ],
    );
    // a receipt says where the act happened and over which channel; surf did not type this
    for (const receipt of receipts) {
      assert.match(
        receipt.evidence[0],
        /^declared: (type|select) acts on the target page, in frame https:\/\/pay\.example\/form over the DevTools connection$/,
      );
    }
    // surf acted on nothing: it opened, gated and closed the page
    assert.deepEqual(
      verbs(surf).filter((verb) => ["js", "type", "select", "click"].includes(verb)),
      [],
    );
  });
});

test("the frame's origin has to be allowlisted as well as the page's, before anything is opened", async () => {
  await withFakes(async ({ surf, cdp, dir, out }) => {
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out });
    const planned = verbs(surf).length;
    const config = writeConfig(dir, ["https://shop.example"]);
    await assert.rejects(apply({ plan: out, config }), {
      code: "mutation_origin_not_allowed",
      message: /https:\/\/pay\.example \(the frame the form is in\)/,
    });
    const written = readPlan(out);
    await assert.rejects(
      apply({ plan: out, submit: true, confirmPlan: written.approval_token, config }),
      { code: "submit_origin_not_allowed", message: /the frame the form is in/ },
    );
    const pageOnly = writeConfig(dir, ["https://pay.example"]);
    await assert.rejects(apply({ plan: out, config: pageOnly }), {
      code: "mutation_origin_not_allowed",
      message: /on https:\/\/shop\.example:/,
    });
    assert.equal(verbs(surf).length, planned, "no tab was opened");
    assert.deepEqual(cdp.input, []);
  });
});

test("a confirmed submit clicks the one control in the frame, and the frame leaving its URL verifies it", async () => {
  await withFakes(async ({ cdp, tree, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    const { approval_token: token } = readPlan(out);
    const envelope = await apply({ plan: out, submit: true, confirmPlan: token, config });
    assert.equal(envelope.result.submitted, true);
    assert.equal(envelope.receipt.outcome, "applied");
    assert.deepEqual(
      cdp.clicks.map((click) => [click.frame, click.selector]),
      [[PAY, "#pay"]],
    );
    // the frame navigated: the observation still reached it (pinned by id), and saw it leave
    assert.equal(tree.frames[0].url, PAID);
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "applied");
    assert.equal(submit.verified_by, "post_read");
    assert.ok(submit.evidence.some((line) => line.includes(PAID)));
    // the receipt records the baseline the check used: where the frame was, not the page
    assert.deepEqual(submit.details.submit.post_condition, { kind: "left_url", expected: PAY });
  });
});

test("a frame whose form drifted after the plan refuses before anything is typed", async () => {
  await withFakes(async ({ cdp, tree, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    // the frame re-renders its form: the card field is renamed under the same selector
    tree.frames[0].form.fields["#card"].name = "pan";
    await assert.rejects(apply({ plan: out, config }), {
      code: "plan_stale",
      message: /field_signature/,
    });
    assert.deepEqual(cdp.values, {});
    assert.deepEqual(cdp.input, []);
  });
});

test("a submit whose frame stays where it was is unknown: the page's own URL is never the baseline", async () => {
  const tree = cdpTree();
  // the payment frame answers in place (a postMessage to the shop), its URL unchanged; judged
  // against the shop's URL it would look like it had left, and the receipt would lie
  delete tree.frames[0].elements["#pay"].navigatesTo;
  await withFakes(
    async ({ cdp, dir, out }) => {
      const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
      await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
      const { approval_token: token } = readPlan(out);
      await assert.rejects(apply({ plan: out, submit: true, confirmPlan: token, config }), {
        code: "submit_postcondition_unmet",
      });
      assert.equal(cdp.clicks.length, 1);
      const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
      assert.equal(submit.outcome, "unknown");
    },
    { tree },
  );
});

test("a plan whose frame origin was edited to an allowlisted one is not a plan", async () => {
  await withFakes(async ({ cdp, dir, out }) => {
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out });
    const edited = readPlan(out);
    // the token binds the frame's URL, not the recorded origin: an edit of the origin alone
    // would keep the token and pass the allowlist while the acts land on pay.example
    edited.target.frame.origin = "https://shop.example";
    writeFileSync(out, JSON.stringify(edited));
    const config = writeConfig(dir, ["https://shop.example"]);
    await assert.rejects(apply({ plan: out, config }), {
      code: "config_invalid",
      message: /target\.frame\.origin/,
    });
    await assert.rejects(
      apply({ plan: out, submit: true, confirmPlan: edited.approval_token, config }),
      { code: "config_invalid" },
    );
    assert.deepEqual(cdp.input, []);
  });
});

test("a frame that moves while the submit waits to be enabled is never clicked", async () => {
  const tree = cdpTree();
  const control = tree.frames[0].form.controls[0];
  await withFakes(
    async ({ cdp, dir, out }) => {
      const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
      await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
      const { approval_token: token } = readPlan(out);
      // the reviewed Pay is disabled until the form validates; once the fields are set, the
      // frame is replaced by another document with the same form and an enabled Pay
      control.enabled = false;
      const swap = setInterval(() => {
        if (cdp.values["#country"] !== "fr") return;
        clearInterval(swap);
        setTimeout(() => {
          tree.frames[0].url = "https://pay.example/other";
          control.enabled = true;
        }, 150);
      }, 10);
      try {
        await assert.rejects(apply({ plan: out, submit: true, confirmPlan: token, config }), {
          code: "submit_control_changed",
          message: /https:\/\/pay\.example\/other/,
        });
      } finally {
        clearInterval(swap);
      }
      assert.deepEqual(cdp.clicks, []);
    },
    { tree },
  );
});

test("a frame that moves to the page's own URL while filling is a side effect, not the page", async () => {
  const tree = cdpTree();
  tree.frames[0].elements["#card"].inputNavigatesTo = SHOP;
  await withFakes(
    async ({ cdp, dir, out }) => {
      const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
      await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
      await assert.rejects(apply({ plan: out, config }), {
        code: "fill_side_effect_observed",
        message: /read-back.*different document URL/,
      });
      assert.deepEqual(cdp.values, { "#card": "4242" }, "nothing after the move was set");
    },
    { tree },
  );
});

test("a plan's recorded landing is its fingerprint's: a forged baseline is refused", async () => {
  await withFakes(async ({ cdp, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    const planned = readPlan(out);
    // the frame's landing moved alone: the plan is not a plan
    const alone = structuredClone(planned);
    alone.target.frame.landed_href = PAID;
    writeFileSync(out, JSON.stringify(alone));
    await assert.rejects(apply({ plan: out, config }), {
      code: "config_invalid",
      message: /landed_href/,
    });
    // moved together with the fingerprint: the address-bound schema now refuses it outright
    const both = structuredClone(planned);
    both.target.frame.landed_href = PAID;
    both.fingerprint.url = PAID;
    writeFileSync(out, JSON.stringify(both));
    await assert.rejects(
      apply({ plan: out, submit: true, confirmPlan: both.approval_token, config }),
      {
        code: "config_invalid",
        message: /landed_href/,
      },
    );
    // a top-document plan's landing is held to its fingerprint the same way
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    const top = structuredClone(readPlan(out));
    delete top.target.frame;
    top.target.landed_href = PAID;
    writeFileSync(out, JSON.stringify(top));
    await assert.rejects(apply({ plan: out, config }), { code: "config_invalid" });
    assert.deepEqual(cdp.input, []);
  });
});

test("every fill and the click name the documents the frame may hold; the reads follow the frame", async () => {
  await withFakes(async ({ dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    const planned = readPlan(out);
    // Keep the legacy runner contract here; tokenized runs bind through fingerprint first.
    delete planned.target.frame.match;
    // a stub session: it records every step and answers each script with its own marker
    const steps = [];
    const session = {
      url: SHOP,
      tab: undefined,
      notes: () => [],
      close: async () => {},
      step: async (step) => {
        steps.push(step);
        const marker = /__testCapabilitiesSurf(?:Apply|Plan)Probe"?: ?"([^"]+)"/.exec(
          step.args[0],
        )?.[1];
        const answer = {
          __testCapabilitiesSurfApplyProbe: marker,
          href: PAY,
          submitCount: 1,
          submitDisabled: false,
          formPresent: true,
          found: true,
          value: "",
        };
        const stdout = JSON.stringify({ result: answer, target: {} });
        return step.read({ command: step.command, args: step.args, stdout, display: [] }, {});
      },
    };
    const context = createRunContext({
      operationId: "surf.apply",
      effect: { effect: "mutating", scope: "target", reason: "a stub run" },
      env: {
        ...process.env,
        TEST_CAPABILITIES_RECEIPTS_DIR: dir,
        TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
      },
      config: { mutation: { allowOrigins: ["https://shop.example", "https://pay.example"] } },
    });
    const runner = createApplyRunner(
      session,
      { state: "ready", evidence: [] },
      {
        context,
        plan: planned,
        mode: "submit",
        postconditionTimeoutMs: 1,
      },
    );
    for (const field of planned.fields) await runner.setValue(field.id);
    await runner.readBack(planned.fields[0].id);
    await runner.clickSubmit();
    const acts = steps.filter((step) => step.command !== "js");
    assert.deepEqual(
      acts.map((step) => step.command),
      ["type", "select", "click"],
    );
    for (const step of acts) {
      assert.deepEqual(step.frame, { name: PAY, documents: [PAY] }, step.command);
    }
    const reads = steps.filter((step) => step.command === "js");
    assert.ok(reads.length > 0);
    for (const step of reads) assert.equal(step.frame, PAY, "a read follows the frame");
  });
});

test("every origin the plan acts on is allowlisted: where the frame landed, and where the page landed", async () => {
  await withFakes(async ({ surf, cdp, dir, out }) => {
    const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
    await plan({ url: SHOP, field: FIELDS, frame: PAY, out, config });
    const opened = verbs(surf).length;
    // the frame was named on pay.example and landed on another origin (a cross-origin redirect)
    const landed = readPlan(out);
    delete landed.target.frame.match; // legacy redirect plans retain the original allowlist checks
    landed.target.frame.landed_href = "https://psp.example/form";
    landed.fingerprint.url = "https://psp.example/form";
    writeFileSync(out, JSON.stringify(landed));
    await assert.rejects(apply({ plan: out, config }), {
      code: "mutation_origin_not_allowed",
      message: /https:\/\/psp\.example \(where the frame landed\)/,
    });
    // a top-document plan whose page landed on another origin (http -> https, a login bounce)
    const top = readPlan(out);
    delete top.target.frame;
    top.target.landed_href = "https://login.example/form";
    top.fingerprint.url = "https://login.example/form";
    writeFileSync(out, JSON.stringify(top));
    await assert.rejects(
      apply({ plan: out, submit: true, confirmPlan: top.approval_token, config }),
      {
        code: "submit_origin_not_allowed",
        message: /https:\/\/login\.example \(where the page landed\)/,
      },
    );
    assert.equal(verbs(surf).length, opened, "no tab was opened");
    assert.deepEqual(cdp.input, []);
  });
});

test("a frame plan never acts in a tab at the page's URL that is not the owned tab", async () => {
  const tree = cdpTree();
  tree.timeOrigin = 1;
  await withFakes(
    async ({ cdp, dir, out }) => {
      const config = writeConfig(dir, ["https://shop.example", "https://pay.example"]);
      await assert.rejects(plan({ url: SHOP, field: FIELDS, frame: PAY, out, config }), {
        code: "tab_bind_ambiguous",
        message: /not the tab this run opened/,
      });
      assert.deepEqual(
        cdp.worlds.filter((world) => world.frame === PAY),
        [],
      );
    },
    { tree },
  );
});
