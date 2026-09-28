import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { runInStub } from "./fixtures/stub-dom.mjs";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { createFakeSurf, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * Fields in open shadow roots (AK #6163). `label:` and `name:` find a field in the document or
 * any open shadow root; the plan records a shadow path (`host >>> field`), which the token and
 * the fingerprint bind like any selector; apply resolves it exactly, page-side for reads and in
 * the isolated world for acts, on the DevTools connection only - surf's selectors do not pierce.
 * Closed roots cannot be read, and nothing says they were searched.
 */

const { executeCliOperation } = await importRuntimeModule("core/operations.js");
const { approvalTokenFor, parsePlanArtifact } = await importRuntimeModule("core/surf-plan.js");
const { SHADOW_QUERY_FUNCTION } = await importRuntimeModule("core/shadow-path.js");
const { SAME_NODE } = await importRuntimeModule("core/cdp-actionability.js");

const PAGE = "https://shop.example/shadow";
const DONE = "https://shop.example/paid";
const ax = (id, role, name, backendDOMNodeId, children = []) => ({
  nodeId: id,
  role: { value: role },
  ...(name ? { name: { value: name } } : {}),
  ...(backendDOMNodeId ? { backendDOMNodeId } : {}),
  childIds: children,
});

/** The page: a note and a document field, a payment form in `pay-form#payhost`'s open root. */
const MODEL = {
  title: "Shadow pay",
  shadowHosts: { "#payhost": { tag: "pay-form" } },
  fields: {
    "#email": { value: "", name: "email", label: "Email" },
    "#payhost >>> #card": {
      value: "",
      name: "card",
      label: "Card number",
      form: "#payhost >>> #pay-form",
    },
    "#payhost >>> #country": {
      kind: "select",
      value: "de",
      name: "country",
      label: "Country",
      form: "#payhost >>> #pay-form",
    },
  },
  controls: [
    { selector: "#payhost >>> #pay", kind: "submit", text: "Pay", form: "#payhost >>> #pay-form" },
    {
      selector: "#payhost >>> #save",
      kind: "button",
      text: "Save card",
      form: "#payhost >>> #pay-form",
    },
  ],
};

function cdpTree(url) {
  return {
    url,
    nodes: [ax("1", "RootWebArea", "Shadow pay", 0)],
    elements: {
      "#payhost >>> #card": { backendNodeId: 21, box: [10, 10, 200, 20] },
      "#payhost >>> #country": {
        backendNodeId: 22,
        box: [10, 40, 100, 20],
        options: [
          { value: "de", label: "Germany" },
          { value: "fr", label: "France" },
        ],
      },
      "#payhost >>> #pay": { backendNodeId: 23, box: [10, 70, 60, 20], navigatesTo: DONE },
      "#payhost >>> #save": { backendNodeId: 24, box: [100, 70, 60, 20] },
    },
    form: structuredClone(MODEL),
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

async function withFakes(body, { cdp: withCdp = true, model = MODEL } = {}) {
  const surf = createFakeSurf({
    pages: {
      [PAGE]: { ...structuredClone(model), readiness: "ready", links: [] },
      [DONE]: { title: "Done", readiness: "ready", links: [] },
    },
  });
  const tree = cdpTree(PAGE);
  const cdp = withCdp ? await startFakeCdp({ pages: { P1: { url: PAGE, tree } } }) : undefined;
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-shadow-"));
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  if (cdp) process.env.TEST_CAPABILITIES_CDP_ENDPOINT = cdp.url;
  else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = "http://127.0.0.1:1";
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
const acting = (surf) =>
  surf
    .calls()
    .map((call) => call[0])
    .filter((verb) => ["type", "select", "click"].includes(verb));

test("a form in an open shadow root is planned by label: paths, one submit, forbidden, token", async () => {
  await withFakes(async ({ out, config }) => {
    await plan({ url: PAGE, field: FIELDS, out, config });
    const written = readPlan(out);
    assert.deepEqual(
      written.fields.map((field) => [field.resolved_selector, field.control.form]),
      [
        ["#payhost >>> #card", "#payhost >>> #pay-form"],
        ["#payhost >>> #country", "#payhost >>> #pay-form"],
      ],
    );
    assert.equal(written.submit.status, "identified");
    assert.equal(written.submit.control.selector, "#payhost >>> #pay");
    assert.deepEqual(
      written.forbidden_controls.map((control) => control.selector),
      ["#payhost >>> #save"],
    );
    // the token binds the host: the same selectors in the document are another approval
    const flat = structuredClone(written);
    for (const field of flat.fields)
      field.resolved_selector = field.resolved_selector.split(" >>> ")[1];
    flat.submit.control.selector = "#pay";
    assert.notEqual(approvalTokenFor(flat), written.approval_token);
    assert.equal(approvalTokenFor(written), written.approval_token);
  });
});

test("a label in the document and one in an open shadow root is ambiguous, never guessed", async () => {
  const model = structuredClone(MODEL);
  model.fields["#payhost >>> #email2"] = { value: "", name: "email2", label: "Email" };
  await withFakes(
    async ({ out, config }) => {
      await assert.rejects(plan({ url: PAGE, field: ["label:Email=a@b.c"], out, config }), {
        code: "plan_field_ambiguous",
        message: /matched 2 elements/,
      });
    },
    { model },
  );
});

test("a field in a closed shadow root is refused, and the refusal does not claim it was searched", async () => {
  const model = structuredClone(MODEL);
  model.fields["closed-form >>> #secret"] = { value: "", name: "secret", label: "Secret code" };
  model.closedShadowHosts = ["closed-form"];
  await withFakes(
    async ({ out, config }) => {
      await assert.rejects(
        plan({ url: PAGE, field: ["label:Secret code=x"], out, config }),
        (error) => {
          assert.equal(error.code, "plan_field_not_found");
          assert.match(error.message, /1 open shadow root/);
          assert.match(error.message, /Closed shadow roots cannot be read/);
          return true;
        },
      );
    },
    { model },
  );
});

test("fields in nested open roots are found by label, through hosts named by their tag", async () => {
  const model = structuredClone(MODEL);
  model.fields["outer-el >>> inner-el >>> #deep"] = {
    value: "",
    name: "deep",
    label: "Deep field",
  };
  await withFakes(
    async ({ out, config }) => {
      await plan({ url: PAGE, field: ["label:Deep field=x", "name:email=a@b.c"], out, config });
      assert.deepEqual(
        readPlan(out).fields.map((field) => field.resolved_selector),
        ["outer-el >>> inner-el >>> #deep", "#email"],
      );
    },
    { model },
  );
});

test("selector: is an exact path: plain CSS stays in the document, >>> descends", async () => {
  await withFakes(async ({ out, config }) => {
    await assert.rejects(plan({ url: PAGE, field: ["selector:#card=4242"], out, config }), {
      code: "plan_field_not_found",
    });
    await plan({
      url: PAGE,
      field: ['selector:#payhost >>> input[name="card"]=4242'],
      out,
      config,
    });
    assert.equal(readPlan(out).fields[0].resolved_selector, "#payhost >>> #card");
    await plan({
      url: PAGE,
      field: FIELDS,
      submitSelector: "#payhost >>> #pay",
      out,
      config,
    });
    assert.equal(readPlan(out).submit.control.selector, "#payhost >>> #pay");
  });
});

test("a fill sets and reads back the shadow fields over the DevTools connection, never on surf", async () => {
  await withFakes(async ({ surf, cdp, dir, out, config }) => {
    await plan({ url: PAGE, field: FIELDS, out, config });
    const envelope = await apply({ plan: out, config });
    assert.equal(envelope.result.channel, "cdp");
    assert.deepEqual(
      envelope.result.fields.map((field) => field.matched),
      [true, true],
    );
    assert.deepEqual(cdp.values, { "#payhost >>> #card": "4242", "#payhost >>> #country": "fr" });
    assert.deepEqual(acting(surf), []);
    const receipts = receiptsIn(dir);
    assert.equal(receipts.length, 2);
    for (const receipt of receipts) {
      assert.equal(receipt.outcome, "applied");
      assert.match(receipt.evidence[0], /in the page over the DevTools connection$/);
    }
  });
});

test("a submit clicks the one shadow control through the gate and is verified", async () => {
  await withFakes(async ({ cdp, dir, out, config }) => {
    await plan({ url: PAGE, field: FIELDS, out, config });
    const token = readPlan(out).approval_token;
    const envelope = await apply({ plan: out, submit: true, confirmPlan: token, config });
    assert.equal(envelope.result.submitted, true);
    assert.deepEqual(
      cdp.clicks.map((click) => [click.frame, click.selector]),
      [["main", "#payhost >>> #pay"]],
    );
    const submit = receiptsIn(dir).find((receipt) => receipt.details.mode === "submit");
    assert.equal(submit.outcome, "applied");
  });
});

test("without the DevTools connection a shadow plan refuses before anything is typed", async () => {
  await withFakes(
    async ({ surf, dir, out, config }) => {
      await plan({ url: PAGE, field: FIELDS, out, config });
      await assert.rejects(apply({ plan: out, config }), (error) => {
        assert.equal(error.code, "cdp_endpoint_unreachable");
        assert.match(error.message, /shadow root/);
        assert.match(error.message, /Nothing was typed/);
        return true;
      });
      assert.deepEqual(acting(surf), []);
      assert.deepEqual(receiptsIn(dir), []);
    },
    { cdp: false },
  );
});

test("a host that no longer holds the planned field is plan_stale, and nothing is typed", async () => {
  await withFakes(async ({ cdp, tree, out, config }) => {
    await plan({ url: PAGE, field: FIELDS, out, config });
    const card = tree.form.fields["#payhost >>> #card"];
    delete tree.form.fields["#payhost >>> #card"];
    tree.form.fields["#otherhost >>> #card"] = card;
    await assert.rejects(apply({ plan: out, config }), { code: "plan_stale" });
    assert.deepEqual(cdp.values, {});
  });
});

test("a path that reaches two elements when the act runs is refused before input", async () => {
  await withFakes(async ({ cdp, tree, dir, out, config }) => {
    await plan({ url: PAGE, field: FIELDS, out, config });
    tree.shadowCounts = { "#payhost >>> #card": 2 };
    const started = Date.now();
    await assert.rejects(apply({ plan: out, config }), { code: "action_target_ambiguous" });
    assert.ok(Date.now() - started < 3000, "an ambiguous path is refused at once, not waited on");
    assert.deepEqual(cdp.values, {});
    const [receipt] = receiptsIn(dir);
    assert.equal(receipt.outcome, "failed");
  });
});

test("an edited host no longer matches the approval token", async () => {
  await withFakes(async ({ out, config }) => {
    await plan({ url: PAGE, field: FIELDS, out, config });
    const written = readPlan(out);
    const token = written.approval_token;
    written.fields[0].resolved_selector = "#evilhost >>> #card";
    writeFileSync(out, JSON.stringify(written));
    await assert.rejects(apply({ plan: out, submit: true, confirmPlan: token, config }), {
      code: "submit_plan_mismatch",
    });
  });
});

test("the schema refuses a shadow path with an empty segment", () => {
  const written = {
    schema_version: 1,
    artifact_kind: "test-capabilities.surf.plan",
    plan_id: "p",
    generated_at: "now",
    runtime: { flavor: "surf", provider: "fake" },
    target: {
      url: PAGE,
      origin: "https://shop.example",
      landed_href: PAGE,
      title: "",
      readiness: { state: "ready", evidence: [] },
    },
    fields: [
      {
        id: "f1",
        locator: { kind: "label", value: "Card number" },
        resolved_selector: "#payhost >>> ",
        control: { tag: "input" },
        current_value: "",
        intended_value: "4242",
        set_via: "field_input",
      },
    ],
    submit: { status: "none", gate: "closed", candidates: [] },
    forbidden_controls: [],
    fingerprint: { url: PAGE, form_count: 0, field_signature: "x", control_signature: "y" },
    approval_token: "t",
    policy: {
      dry_run_default: true,
      value_via_field_input_only: true,
      never_retry_submit: true,
      approval_binds_to: "content_hash",
      authority: [],
    },
  };
  assert.throws(() => parsePlanArtifact(written, "plan.json"), {
    code: "config_invalid",
    message: /fields\.0\.resolved_selector/,
  });
});

test("the page-side resolver: exact per root, nested, closed and ambiguous hosts", () => {
  const page = {
    url: PAGE,
    title: "",
    readyState: "complete",
    links: [],
    frames: [],
    counts: {},
    closedShadowHosts: ["closed-form"],
    fields: {
      "#card": { name: "doc" },
      "#payhost >>> #card": { name: "shadow" },
      "outer-el >>> inner-el >>> #deep": { name: "deep" },
      "closed-form >>> #secret": { name: "secret" },
      "twin-el#a >>> #x": { name: "x1" },
      "twin-el#b >>> #y": { name: "y1" },
    },
    controls: [],
  };
  const query = (selector) =>
    JSON.parse(
      JSON.stringify(
        runInStub(
          `(() => { const q = (${SHADOW_QUERY_FUNCTION})(${JSON.stringify(selector)}); return { count: q.count, names: q.found.map((el) => el.name) }; })()`,
          page,
        ),
      ),
    );
  assert.deepEqual(query("#card"), { count: 1, names: ["doc"] });
  assert.deepEqual(query("#payhost >>> #card"), { count: 1, names: ["shadow"] });
  assert.deepEqual(query("outer-el >>> inner-el >>> #deep"), { count: 1, names: ["deep"] });
  assert.deepEqual(query("closed-form >>> #secret"), { count: 0, names: [] });
  assert.deepEqual(query("twin-el >>> #x"), { count: 2, names: [] });
  assert.deepEqual(query("#payhost >>> ::bad("), { count: 0, names: [] });
});

test("the hit test accepts a hit inside the target's own shadow tree, and nothing outside it", () => {
  const same = new Function(`return (${SAME_NODE});`)(); // ubs:ignore -- own constant under test
  const document = { nodeType: 9, parentNode: null };
  const host = { nodeType: 1, parentNode: document };
  const root = { nodeType: 11, parentNode: null, host };
  const inner = { nodeType: 1, parentNode: root };
  const cover = { nodeType: 1, parentNode: document };
  const fragment = { nodeType: 11, parentNode: null };
  const loose = { nodeType: 1, parentNode: fragment };
  assert.equal(same.call(host, host), true);
  assert.equal(same.call(host, inner), true);
  assert.equal(same.call(inner, host), false);
  assert.equal(same.call(host, cover), false);
  assert.equal(same.call(host, loose), false);
});

for (const inShadow of [false, true]) {
  test(`a select's input event leaves a shadow root, and a document select's is unchanged (inShadow=${inShadow})`, async () => {
    const { SELECT_OPTION } = await importRuntimeModule("core/cdp-element-functions.js");
    const events = [];
    const ownerDocument = {};
    const element = {
      options: [
        { value: "de", label: "Germany" },
        { value: "fr", label: "France" },
      ],
      value: "de",
      ownerDocument,
      getRootNode: () => (inShadow ? { host: {} } : ownerDocument),
      dispatchEvent: (event) =>
        events.push({ type: event.type, bubbles: event.bubbles, composed: event.composed }),
    };
    const select = new Function(`return (${SELECT_OPTION});`)(); // ubs:ignore -- own constant under test
    assert.equal(select.call(element, "France"), true);
    assert.equal(element.value, "fr");
    assert.deepEqual(events, [
      { type: "input", bubbles: true, composed: inShadow },
      { type: "change", bubbles: true, composed: false },
    ]);
  });
}

test("a shadow form inside a frame is planned and filled there, through its host", async () => {
  const SHOP = "https://shop.example/checkout";
  const PAY = "https://pay.example/form";
  const pay = { ...cdpTree(PAY), owner: { backendNodeId: 50, box: [0, 100, 500, 300] } };
  pay.nodes = [ax("1", "RootWebArea", "", 0)];
  const tree = {
    url: SHOP,
    nodes: [ax("1", "RootWebArea", "", 0, ["2"]), ax("2", "Iframe", "", 50)],
    elements: { "#pay-frame": { backendNodeId: 50, box: [0, 100, 500, 300], iframeIndex: 0 } },
    frames: [pay],
  };
  const surf = createFakeSurf({
    pages: {
      [SHOP]: {
        title: "Checkout",
        readiness: "ready",
        links: [],
        frames: [{ src: PAY, outOfProcess: true, crossOrigin: true }],
      },
    },
  });
  const cdp = await startFakeCdp({ pages: { P1: { url: SHOP, tree } } });
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-shadow-frame-"));
  const config = writeConfig(dir);
  writeFileSync(
    config,
    readFileSync(config, "utf-8").replace(
      '    - "https://shop.example"',
      '    - "https://shop.example"\n    - "https://pay.example"',
    ),
  );
  const previous = process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
  process.env.TEST_CAPABILITIES_CDP_ENDPOINT = cdp.url;
  try {
    await withFakeSurfEnv(surf.path, async () => {
      const out = path.join(dir, "plan.json");
      await plan({ url: SHOP, frame: PAY, field: FIELDS, out, config });
      const written = readPlan(out);
      assert.equal(written.target.frame.url, PAY);
      assert.equal(written.fields[0].resolved_selector, "#payhost >>> #card");
      assert.equal(written.submit.control.selector, "#payhost >>> #pay");
      const envelope = await apply({ plan: out, config });
      assert.deepEqual(
        envelope.result.fields.map((field) => field.matched),
        [true, true],
      );
      assert.deepEqual(cdp.values, { "#payhost >>> #card": "4242", "#payhost >>> #country": "fr" });
      assert.deepEqual(acting(surf), []);
    });
  } finally {
    if (previous === undefined) delete process.env.TEST_CAPABILITIES_CDP_ENDPOINT;
    else process.env.TEST_CAPABILITIES_CDP_ENDPOINT = previous;
    surf.cleanup();
    await cdp.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a read addresses one element: a plain selector's first match, a shadow path's only one", async () => {
  const { SHADOW_ONE_FUNCTION } = await importRuntimeModule("core/shadow-path.js");
  const page = {
    url: PAGE,
    title: "",
    readyState: "complete",
    links: [],
    frames: [],
    counts: {},
    fields: {
      'input[name="twin"]': { name: "twin", id: "one" },
      "#host >>> #x": { name: "x" },
    },
    controls: [],
  };
  page.fields["#other"] = { name: "twin", id: "other" };
  const one = (selector) =>
    runInStub(
      `(() => { const el = (${SHADOW_ONE_FUNCTION})(${JSON.stringify(selector)}); return el ? el.id || el.name : null; })()`,
      page,
    );
  assert.equal(one('input[name="twin"]'), "one");
  assert.equal(one("#host >>> #x"), "x");
  const twins = { ...page, fields: { ...page.fields, "#host >>> #y": { name: "x" } } };
  const oneIn = (selector) =>
    runInStub(
      `(() => { const el = (${SHADOW_ONE_FUNCTION})(${JSON.stringify(selector)}); return el ? el.name : null; })()`,
      twins,
    );
  assert.equal(oneIn('#host >>> input[name="x"]'), null);
  assert.equal(oneIn("#host >>> #x"), "x");
});

test("review: a shadow label never outranks a document field's aria-label; both is ambiguous", async () => {
  const model = structuredClone(MODEL);
  model.fields["#email"] = { value: "", name: "email", ariaLabel: "Email" };
  model.fields["#payhost >>> #email2"] = { value: "", name: "email2", label: "Email" };
  await withFakes(
    async ({ out, config }) => {
      await assert.rejects(plan({ url: PAGE, field: ["label:Email=a@b.c"], out, config }), {
        code: "plan_field_ambiguous",
        message: /matched 2 elements/,
      });
    },
    { model },
  );
});

test("review: ' >>> ' inside a quoted attribute value is plain CSS, not a shadow path", async () => {
  const { isShadowPath, splitShadowPath, isWellFormedShadowPath } =
    await importRuntimeModule("core/shadow-path.js");
  const tricky = 'input[aria-label="a >>> b"]';
  assert.equal(isShadowPath(tricky), false);
  assert.deepEqual(splitShadowPath(`#host >>> ${tricky}`), ["#host", tricky]);
  assert.deepEqual(splitShadowPath("#a >>> [title='x >>> y'] >>> #b"), [
    "#a",
    "[title='x >>> y']",
    "#b",
  ]);
  assert.deepEqual(splitShadowPath(":is(#a >>> #b) >>> #c"), [":is(#a >>> #b)", "#c"]);
  assert.deepEqual(splitShadowPath('[title="q\\" >>> r"] >>> #c'), ['[title="q\\" >>> r"]', "#c"]);
  assert.deepEqual(splitShadowPath('[title="] >>> x"]'), ['[title="] >>> x"]']);
  assert.deepEqual(splitShadowPath('input/* >>> */[name="email"]'), [
    'input/* >>> */[name="email"]',
  ]);
  assert.deepEqual(splitShadowPath("#a /* ' */ >>> #b"), ["#a /* ' */", "#b"]);
  assert.equal(isWellFormedShadowPath(tricky), true);
  const model = structuredClone(MODEL);
  model.fields["#tricky"] = { value: "", name: "tricky", ariaLabel: "a >>> b" };
  await withFakes(
    async ({ out, config }) => {
      await plan({ url: PAGE, field: [`selector:${tricky}=x`], out, config });
      assert.equal(readPlan(out).fields[0].resolved_selector, "#tricky");
    },
    { model },
  );
  const page = {
    url: PAGE,
    title: "",
    readyState: "complete",
    links: [],
    frames: [],
    counts: {},
    fields: { "#tricky": { ariaLabel: "a >>> b", name: "t" } },
    controls: [],
  };
  const count = runInStub(`(${SHADOW_QUERY_FUNCTION})(${JSON.stringify(tricky)}).count`, page);
  assert.equal(count, 1);
});
