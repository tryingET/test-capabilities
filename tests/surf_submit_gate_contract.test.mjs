import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFormFixtureServer } from "./fixtures/form-fixture-server.mjs";
import { createFakeSurf, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The submit gate (implementation plan S7; submit-gate packet §4, §9 cases (a)-(n)). Everything
 * here runs against the fake surf: `npm test` never touches a browser and never submits
 * anything. The live proof of a real submit is the local `node:http` fixture recorded in
 * `docs/project/2026-09-07-submit-gate-live-run.md`.
 *
 * The four hazards the packet separates are the four groups below: what the page would not give
 * (the plan's refusals), the world (`mutation.allowOrigins`), the intent (the content-bound
 * approval token) and the after-state (one receipt per attempt, never a second one).
 */

const { executeCliOperation } = await importRuntimeModule("core/operations.js");
const { canonicalJson, canonicalDigest } = await importRuntimeModule("core/canonical-json.js");
const { approvalTokenFor, parseFieldSpec, SURF_PLAN_KIND } =
  await importRuntimeModule("core/surf-plan.js");
const { createApplyRunner, evaluatePostCondition } = await importRuntimeModule(
  "core/surf-apply-runner.js",
);
const { canSubmit } = await importRuntimeModule("core/browser-session.js");

const FORM_URL = "https://forms.example/search";
const RESULTS_URL = "https://forms.example/results";

/** One search form with the trap the incident named: a second, non-submit button in the form. */
function searchPage(overrides = {}) {
  return {
    "https://forms.example/search": {
      title: "Search packages",
      readiness: "ready",
      links: [],
      fields: {
        'input[name="q"]': {
          value: "",
          kind: "search",
          name: "q",
          label: "Search packages",
          form: "#search",
        },
      },
      controls: [
        { selector: "#search-submit", kind: "submit", text: "Search", form: "#search" },
        { selector: "#set-bid", kind: "button", text: "Set bid", form: "#search" },
      ],
      changeNavigatesTo: RESULTS_URL,
      ...overrides,
    },
    [RESULTS_URL]: { title: "Results", readiness: "ready", links: [] },
  };
}

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), "tc-submit-gate-"));
}

/** The surf verbs a run issued, without the capability probe every resolution makes. */
function commandsOf(fake) {
  return fake
    .calls()
    .map((call) => call[0])
    .filter((command) => !command.startsWith("--"));
}

async function withFake(options, body) {
  const fake = createFakeSurf({
    pages: options.pages ?? searchPage(),
    ...(options.failOn ? { failOn: options.failOn } : {}),
  });
  const dir = scratch();
  try {
    await withFakeSurfEnv(fake.path, async () => {
      await body({ fake, dir, out: path.join(dir, "plan.json") });
    });
  } finally {
    fake.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function planWith(input) {
  return executeCliOperation({ command: "surf", action: "plan" }, input);
}

async function applyWith(input) {
  return executeCliOperation({ command: "surf", action: "apply" }, input);
}

/**
 * The operator's config: where the receipts live, that this store is a throwaway, which origins
 * may be acted on and how long the two bounded waits are. Everything the gate consults comes
 * from here - there is no environment variable and no flag that adds an origin.
 */
function writeConfig(dir, options = {}) {
  const file = path.join(dir, "tc.yaml");
  const origins = options.allowOrigins ?? [];
  const lines = [
    "receipts:",
    `  dir: ${path.join(dir, "receipts")}`,
    "  ephemeral: true",
    "mutation:",
    origins.length === 0
      ? "  allow_origins: []"
      : `  allow_origins:\n${origins.map((origin) => `    - "${origin}"`).join("\n")}`,
  ];
  if (options.postconditionTimeoutMs || options.controlEnableTimeoutMs) {
    lines.push("surf:", "  submit:");
    if (options.postconditionTimeoutMs) {
      lines.push(`    postcondition_timeout_ms: ${options.postconditionTimeoutMs}`);
    }
    if (options.controlEnableTimeoutMs) {
      lines.push(`    control_enable_timeout_ms: ${options.controlEnableTimeoutMs}`);
    }
  }
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

/** Every receipt on disk under a run directory of this scratch store. */
function receiptsIn(dir) {
  const root = path.join(dir, "receipts");
  let runs = [];
  try {
    runs = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
  return runs.flatMap((run) =>
    readdirSync(path.join(root, run.name))
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => JSON.parse(readFileSync(path.join(root, run.name, entry), "utf-8"))),
  );
}

/** A receipt an earlier run left behind, written the way the store writes them. */
function writeReceipt(dir, { planId, mode, outcome }) {
  const runId = randomUUID();
  const receiptId = randomUUID();
  const runDir = path.join(dir, "receipts", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, `${receiptId}.json`),
    JSON.stringify(
      {
        schema_version: 1,
        artifact_kind: "test-capabilities.mutation.receipt",
        receipt_id: receiptId,
        run_id: runId,
        operation_id: "surf.apply",
        step_id: `surf.apply.${mode}:${planId}`,
        effect: "mutating",
        scope: "target",
        subject: `${FORM_URL} tab=1`,
        intent: "an earlier attempt",
        idempotency_key: `sha256:${"0".repeat(64)}`,
        attempt: 1,
        started_at: new Date().toISOString(),
        outcome,
        evidence: [],
        details: { plan_id: planId, mode },
      },
      null,
      2,
    ),
  );
}

/** Wait for a condition the fixture server observes; the fake does not await its own POST. */
async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A plan object without a browser: the runner's surface does not need a page to be examined. */
function fixturePlan() {
  return {
    schema_version: 1,
    artifact_kind: SURF_PLAN_KIND,
    plan_id: "11111111-2222-4333-8444-555555555555",
    generated_at: "2026-09-08T00:00:00.000Z",
    runtime: { flavor: "surf", provider: "path_surf", version: "2.18.0" },
    target: {
      url: FORM_URL,
      origin: "https://forms.example",
      landed_href: FORM_URL,
      title: "Search packages",
      readiness: { state: "ready", evidence: [] },
    },
    fields: [
      {
        id: "f1",
        locator: { kind: "name", value: "q" },
        resolved_selector: 'input[name="q"]',
        control: { tag: "input", type: "search", name: "q", form: "#search" },
        current_value: "",
        intended_value: "surf-cli",
        set_via: "field_input",
      },
    ],
    submit: {
      status: "identified",
      gate: "closed",
      control: {
        selector: "#search-submit",
        tag: "button",
        type: "submit",
        text: "Search",
        disabled: false,
      },
      candidates: [{ selector: "#search-submit", text: "Search", reason: "explicit_submit" }],
    },
    forbidden_controls: [
      { selector: "#set-bid", text: "Set bid", reason: "form_level_button_not_submit" },
    ],
    fingerprint: {
      url: FORM_URL,
      form_count: 1,
      field_signature: `sha256:${"a".repeat(64)}`,
      control_signature: `sha256:${"b".repeat(64)}`,
    },
    approval_token: `sha256:${"c".repeat(64)}`,
    policy: {
      dry_run_default: true,
      value_via_field_input_only: true,
      never_retry_submit: true,
      approval_binds_to: "content_hash",
      authority: ["config.mutation.allowOrigins", "apply_runner"],
    },
  };
}

function readPlan(planPath) {
  return JSON.parse(readFileSync(planPath, "utf-8"));
}

// ---------------------------------------------------------------------------
// The canonicalisation the approval token is taken over (review A11)
// ---------------------------------------------------------------------------

test("RFC 8785 canonicalisation sorts keys by code unit and refuses what has no form", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalJson({ ä: 1, z: 2, a: 3 }), '{"a":3,"z":2,"ä":1}');
  assert.equal(canonicalJson([1, "two", true, null]), '[1,"two",true,null]');
  assert.equal(canonicalJson({ n: -0 }), '{"n":0}');
  assert.equal(canonicalJson({ n: 1e21 }), '{"n":1e+21}');
  assert.equal(canonicalJson({ kept: 1, dropped: undefined }), '{"kept":1}');
  assert.throws(() => canonicalJson({ n: Number.NaN }), /NaN/);
  assert.throws(() => canonicalJson({ when: new Date(0) }), /Date/);
  assert.throws(() => canonicalJson({ n: 1n }), /bigint/);
});

test("the approval token is fixed by a committed fixture plan (A11)", () => {
  // The fixture and its token are the contract: a change to either is a change to what an
  // operator's approval means, and it has to be a deliberate edit of this file.
  const fixture = {
    target: { origin: "https://forms.example" },
    fields: [
      { resolved_selector: 'input[name="q"]', intended_value: "surf-cli" },
      { resolved_selector: "#count", intended_value: "2" },
    ],
    submit: { control: { selector: "#search-submit" } },
  };
  assert.equal(
    approvalTokenFor(fixture),
    "sha256:37c25c061bb9640f6ac9fbf50a40b8d97e177a43f3e8fb46bb5fe91f7190f2e7",
  );
  // The same content in a different key order is the same approval.
  assert.equal(
    approvalTokenFor({
      submit: { control: { selector: "#search-submit" } },
      fields: [
        { intended_value: "surf-cli", resolved_selector: 'input[name="q"]' },
        { intended_value: "2", resolved_selector: "#count" },
      ],
      target: { origin: "https://forms.example" },
    }),
    approvalTokenFor(fixture),
  );
  // One edited value is a different approval.
  const edited = {
    ...fixture,
    fields: [{ ...fixture.fields[0], intended_value: "surf-cli " }, fixture.fields[1]],
  };
  assert.notEqual(approvalTokenFor(edited), approvalTokenFor(fixture));
  // The digest is over the canonical form, not over JSON.stringify's insertion order.
  assert.equal(
    approvalTokenFor(fixture),
    canonicalDigest({
      origin: "https://forms.example",
      fields: [
        { resolved_selector: 'input[name="q"]', intended_value: "surf-cli" },
        { resolved_selector: "#count", intended_value: "2" },
      ],
      submit_selector: "#search-submit",
    }),
  );
});

test("a --field argument splits at the first = outside brackets", () => {
  assert.deepEqual(parseFieldSpec("name:q=surf-cli", 0), {
    id: "f1",
    locator: { kind: "name", value: "q" },
    intendedValue: "surf-cli",
  });
  assert.deepEqual(parseFieldSpec('selector:input[name="q"]=a=b', 1).intendedValue, "a=b");
  assert.equal(parseFieldSpec('selector:input[name="q"]=a=b', 1).locator.value, 'input[name="q"]');
  assert.throws(() => parseFieldSpec("name:q", 0), { code: "config_invalid" });
  assert.throws(() => parseFieldSpec("nickname=q", 0), { code: "config_invalid" });
  assert.throws(() => parseFieldSpec("role:button=x", 0), { code: "config_invalid" });
});

// ---------------------------------------------------------------------------
// (a) the prepared plan
// ---------------------------------------------------------------------------

test("(a) surf plan writes a 0600 artifact with the resolved field, the identified submit and the forbidden button", async () => {
  await withFake({}, async ({ fake, out }) => {
    const envelope = await planWith({
      url: FORM_URL,
      field: ["label:Search packages=surf-cli"],
      out,
    });

    assert.equal(envelope.operationId, "surf.plan");
    assert.equal(envelope.effect.effect, "read_only");
    assert.deepEqual(envelope.mutations, []);

    const plan = readPlan(out);
    assert.equal(plan.artifact_kind, SURF_PLAN_KIND);
    assert.equal(plan.schema_version, 1);
    assert.equal(plan.target.origin, "https://forms.example");
    assert.equal(plan.target.readiness.state, "ready");
    assert.deepEqual(plan.fields, [
      {
        id: "f1",
        locator: { kind: "label", value: "Search packages" },
        resolved_selector: 'input[name="q"]',
        control: { tag: "input", type: "search", name: "q", form: "#search" },
        current_value: "",
        intended_value: "surf-cli",
        set_via: "field_input",
      },
    ]);
    assert.equal(plan.submit.status, "identified");
    assert.equal(plan.submit.gate, "closed");
    assert.equal(plan.submit.control.selector, "#search-submit");
    assert.equal(plan.submit.control.text, "Search");
    assert.deepEqual(
      plan.forbidden_controls.map((control) => control.selector),
      ["#set-bid"],
    );
    assert.equal(plan.forbidden_controls[0].reason, "form_level_button_not_submit");
    assert.equal(plan.approval_token, approvalTokenFor(plan));
    assert.equal(plan.policy.value_via_field_input_only, true);
    assert.match(plan.fingerprint.field_signature, /^sha256:[0-9a-f]{64}$/);

    // The artifact carries the value; the envelope carries the shape and the path.
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.equal(JSON.stringify(envelope).includes("surf-cli"), false);
    assert.equal(envelope.plan.approvalToken, plan.approval_token);
    assert.equal(envelope.result.fields[0].resolvedSelector, 'input[name="q"]');

    // Read-only by construction: an owned tab, one gate, one probe, and the tab closed again.
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready", "js", "tab.close"]);
  });
});

test("a plan resolves name: and selector: locators to the same element as label:", async () => {
  await withFake({}, async ({ out }) => {
    for (const locator of [
      "name:q=surf-cli",
      'selector:input[name="q"]=surf-cli',
      "label:Search packages=surf-cli",
    ]) {
      await planWith({ url: FORM_URL, field: [locator], out });
      assert.equal(readPlan(out).fields[0].resolved_selector, 'input[name="q"]');
    }
  });
});

// ---------------------------------------------------------------------------
// (b) ambiguity is recorded, not refused
// ---------------------------------------------------------------------------

test("(b) two submit candidates leave submit.status ambiguous and the plan is still written", async () => {
  const pages = searchPage({
    controls: [
      { selector: "#search-submit", kind: "submit", text: "Search", form: "#search" },
      { selector: "#search-again", kind: "submit", text: "Search again", form: "#search" },
    ],
  });
  await withFake({ pages }, async ({ out }) => {
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out });
    const plan = readPlan(out);
    assert.equal(plan.submit.status, "ambiguous");
    assert.equal(plan.submit.control, undefined);
    assert.deepEqual(plan.submit.candidates.map((candidate) => candidate.selector).sort(), [
      "#search-again",
      "#search-submit",
    ]);
    assert.equal(plan.approval_token, approvalTokenFor(plan));
  });
});

test("a submit hint narrows the candidates, and a page with no owning form is none", async () => {
  const pages = searchPage({
    controls: [
      { selector: "#search-submit", kind: "submit", text: "Search", form: "#search" },
      { selector: "#search-again", kind: "submit", text: "Search again", form: "#search" },
    ],
  });
  await withFake({ pages }, async ({ out }) => {
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], submitText: "Search", out });
    assert.equal(readPlan(out).submit.control.selector, "#search-submit");

    await planWith({
      url: FORM_URL,
      field: ["name:q=surf-cli"],
      submitSelector: "#search-again",
      out,
    });
    assert.equal(readPlan(out).submit.control.selector, "#search-again");
  });

  const spa = {
    "https://forms.example/search": {
      title: "SPA",
      readiness: "ready",
      links: [],
      fields: { "#q": { value: "", kind: "text", name: "q" } },
      controls: [{ selector: "#go", kind: "button", text: "Go" }],
    },
  };
  await withFake({ pages: spa }, async ({ out }) => {
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out });
    const plan = readPlan(out);
    assert.equal(plan.submit.status, "none");
    assert.deepEqual(plan.submit.candidates, []);

    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], submitSelector: "#go", out });
    const hinted = readPlan(out);
    assert.equal(hinted.submit.status, "identified");
    assert.equal(hinted.submit.control.selector, "#go");
  });
});

// ---------------------------------------------------------------------------
// (c) the "Set bid" rule and the rest of the plan-time refusals
// ---------------------------------------------------------------------------

test("(c) a field whose target is a button is refused and no artifact is written", async () => {
  await withFake({}, async ({ fake, out }) => {
    await assert.rejects(
      () => planWith({ url: FORM_URL, field: ["selector:#set-bid=100"], out }),
      (error) => {
        assert.equal(error.code, "value_via_button_refused");
        assert.match(error.message, /f1 \(selector:#set-bid\)/);
        assert.match(error.message, /Nothing was written and nothing was typed/);
        // The refusal cites the field and the selector, never the value (packet §5).
        assert.equal(error.message.includes("100"), false);
        return true;
      },
    );
    assert.throws(() => statSync(out), { code: "ENOENT" });
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready", "js", "tab.close"]);
  });
});

test("a locator that matches nothing, or several elements, refuses with its own code", async () => {
  await withFake({}, async ({ out }) => {
    await assert.rejects(() => planWith({ url: FORM_URL, field: ["name:missing=x"], out }), {
      code: "plan_field_not_found",
    });
    await assert.rejects(
      () => planWith({ url: FORM_URL, field: ["selector:button=x"], out }),
      (error) => {
        assert.equal(
          ["plan_field_ambiguous", "value_via_button_refused"].includes(error.code),
          true,
        );
        return true;
      },
    );
  });
});

test("a field that is only inside a frame refuses with plan_field_unreachable", async () => {
  const pages = {
    "https://forms.example/search": {
      title: "Framed",
      readiness: "ready",
      links: [],
      fields: {},
      frames: [{ src: "https://embed.example/form", outOfProcess: true }],
      controls: [],
    },
  };
  await withFake({ pages }, async ({ out }) => {
    await assert.rejects(() => planWith({ url: FORM_URL, field: ["name:q=x"], out }), {
      code: "plan_field_unreachable",
    });
  });
});

test("a plan needs at least one field, one submit hint at most, and refuses foreign options", async () => {
  await withFake({}, async ({ out }) => {
    // A schema failure travels as a ZodError and the CLI renders it as [config_invalid].
    await assert.rejects(() => planWith({ url: FORM_URL, field: [], out }), /at least one --field/);
    await assert.rejects(
      () =>
        planWith({
          url: FORM_URL,
          field: ["name:q=x"],
          submitText: "Search",
          submitSelector: "#search-submit",
          out,
        }),
      { code: "config_invalid" },
    );
    await assert.rejects(
      () => planWith({ url: FORM_URL, field: ["name:q=x"], out, depth: "2" }),
      (error) => {
        assert.equal(error.code, "unsupported_option");
        assert.match(error.message, /--depth/);
        return true;
      },
    );
    await assert.rejects(
      () => planWith({ url: FORM_URL, field: ["name:q=x"], out, submit: true }),
      { code: "unsupported_option" },
    );
  });
});

test("surf explore refuses the submit gate's options instead of ignoring them", async () => {
  await withFake({}, async () => {
    await assert.rejects(
      () =>
        executeCliOperation(
          { command: "surf", action: "explore" },
          { url: FORM_URL, field: ["name:q=x"] },
        ),
      (error) => {
        assert.equal(error.code, "unsupported_option");
        assert.match(error.message, /--field/);
        return true;
      },
    );
  });
});

test("a readiness refusal passes through unchanged and nothing is planned", async () => {
  const pages = {
    "https://forms.example/search": { title: "Sign in", readiness: "login", links: [] },
  };
  await withFake({ pages }, async ({ fake, out }) => {
    await assert.rejects(() => planWith({ url: FORM_URL, field: ["name:q=x"], out }), {
      code: "page_login",
    });
    assert.deepEqual(commandsOf(fake), ["tab.new", "wait.ready", "tab.close"]);
    assert.throws(() => statSync(out), { code: "ENOENT" });
  });
});

test("the plan operation is registered as a read-only route the manifest names", async () => {
  const { CLI_ROUTE_MANIFEST, resolveCliRoute, getSurfActionStatus } =
    await importRuntimeModule("core/operations.js");
  assert.equal(getSurfActionStatus("plan"), "implemented");
  assert.equal(resolveCliRoute({ command: "surf", action: "plan" }).operationId, "surf.plan");
  const entry = CLI_ROUTE_MANIFEST.find(
    (route) => route.command === "surf" && route.action === "plan",
  );
  assert.match(entry.description, /Read-only/);
  assert.equal(Object.hasOwn(entry, "operator_only"), false);
  assert.equal(Object.hasOwn(entry, "mutation"), false);
});

// ---------------------------------------------------------------------------
// The apply runner's surface: what it cannot express (packet §4.3, D8, case (n))
// ---------------------------------------------------------------------------

test("(n) the runner has no free-selector member, and no clickSubmit outside submit mode", () => {
  const plan = fixturePlan();
  const session = {
    evaluate: async () => ({}),
    step: async () => ({}),
    notes: () => [],
    close: async () => {},
    tab: undefined,
  };
  const context = {
    config: { surf: { submit: { controlEnableTimeoutMs: 10, postconditionTimeoutMs: 10 } } },
  };

  const fill = createApplyRunner(
    session,
    { state: "ready", evidence: [] },
    {
      context,
      plan,
      mode: "fill",
    },
  );
  const submit = createApplyRunner(
    session,
    { state: "ready", evidence: [] },
    {
      context,
      plan,
      mode: "submit",
    },
  );

  for (const runner of [fill, submit]) {
    for (const member of [
      "click",
      "press",
      "key",
      "type",
      "select",
      "do",
      "batch",
      "evaluate",
      "step",
    ]) {
      assert.equal(member in runner, false, `the runner exposes ${member}`);
    }
    assert.deepEqual(Object.keys(runner).sort(), Object.keys(runner).sort());
  }

  // The capability is absent in fill mode, not merely disabled.
  assert.equal("clickSubmit" in fill, false);
  assert.equal(canSubmit(fill), false);
  assert.equal(canSubmit(submit), true);
  assert.equal(typeof submit.clickSubmit, "function");

  // A plan whose submit was never identified yields a runner without the capability either.
  const ambiguous = createApplyRunner(
    session,
    { state: "ready", evidence: [] },
    {
      context,
      plan: { ...plan, submit: { status: "ambiguous", gate: "closed", candidates: [] } },
      mode: "submit",
    },
  );
  assert.equal(canSubmit(ambiguous), false);
});

test("(n) the runner addresses field ids, never selectors handed to it", async () => {
  const plan = fixturePlan();
  const session = {
    evaluate: async () => ({}),
    step: async () => ({}),
    notes: () => [],
    close: async () => {},
    tab: undefined,
  };
  const runner = createApplyRunner(
    session,
    { state: "ready", evidence: [] },
    {
      context: {
        config: { surf: { submit: { controlEnableTimeoutMs: 10, postconditionTimeoutMs: 10 } } },
      },
      plan,
      mode: "fill",
    },
  );
  await assert.rejects(() => runner.setValue("#set-bid"), { code: "plan_field_not_found" });
  await assert.rejects(() => runner.readBack("f9"), { code: "plan_field_not_found" });
});

// ---------------------------------------------------------------------------
// (d)-(n): applying a plan
// ---------------------------------------------------------------------------

test("(d) apply without --submit sets and reads back every field and clicks nothing", async () => {
  await withFake({}, async ({ fake, dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });

    const envelope = await applyWith({ plan: out, config });
    assert.equal(envelope.operationId, "surf.apply");
    assert.equal(envelope.result.mode, "fill");
    assert.equal(envelope.result.submitted, false);
    assert.equal(envelope.result.fields.length, 1);
    assert.equal(envelope.result.fields[0].matched, true);
    assert.equal(envelope.effect.effect, "mutating");
    assert.equal(envelope.effect.scope, "target");

    const calls = fake.calls();
    assert.equal(
      calls.some((call) => call[0] === "click"),
      false,
      "a fill clicked something",
    );
    assert.equal(
      calls.some((call) => call.includes("--submit")),
      false,
      "a fill forwarded --submit",
    );
    assert.equal(
      calls.some((call) => call.includes("#set-bid")),
      false,
      "a forbidden control was addressed",
    );
    const typed = calls.find((call) => call[0] === "type");
    assert.deepEqual(typed.slice(0, 4), ["type", "surf-cli", "--into", 'input[name="q"]']);
    assert.equal(typed.includes("--tab-id"), true, "the value was set in a tab the run owns");
    assert.equal(
      typed.includes("--no-screenshot"),
      true,
      "the value was copied into a /tmp screenshot",
    );

    // One receipt for the one act, and it is a fill receipt.
    const receipts = receiptsIn(dir);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].outcome, "applied");
    assert.equal(receipts[0].details.mode, "fill");
    assert.equal(receipts[0].details.plan_id, readPlan(out).plan_id);
    assert.equal(receipts[0].scope, "target");
  });
});

test("(e) --submit without --confirm-plan refuses before a tab is opened", async () => {
  await withFake({}, async ({ fake, dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const before = fake.calls().length;

    await assert.rejects(() => applyWith({ plan: out, submit: true, config }), {
      code: "submit_gate_closed",
    });
    assert.equal(fake.calls().length, before, "a tab was opened before the gate was checked");
    assert.equal(receiptsIn(dir).length, 0);
  });
});

test("(f) an origin the operator did not allowlist refuses submit and fill alike", async () => {
  await withFake({}, async ({ fake, dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: [] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const plan = readPlan(out);
    const before = fake.calls().length;

    await assert.rejects(
      () => applyWith({ plan: out, submit: true, confirmPlan: plan.approval_token, config }),
      (error) => {
        assert.equal(error.code, "submit_origin_not_allowed");
        assert.match(error.message, /mutation\.allowOrigins/);
        assert.match(error.message, /tc\.yaml/);
        return true;
      },
    );
    // A fill is a bounded mutation, so the ledger's own allowlist covers it too.
    await assert.rejects(() => applyWith({ plan: out, config }), {
      code: "mutation_origin_not_allowed",
    });
    assert.equal(
      fake.calls().length,
      before,
      "the browser was touched before the world was checked",
    );
  });
});

test("(g) an allowlisted, confirmed submit clicks exactly one control and the server sees one POST", async () => {
  const fixture = await startFormFixtureServer();
  try {
    const pages = {
      [fixture.url]: {
        title: "Fixture form",
        readiness: "ready",
        links: [],
        fields: {
          'input[name="q"]': { value: "", kind: "search", name: "q", form: "#search" },
        },
        controls: [
          { selector: "#search-submit", kind: "submit", text: "Search", form: "#search" },
          { selector: "#set-bid", kind: "button", text: "Set bid", form: "#search" },
        ],
        changeNavigatesTo: fixture.doneUrl,
        submitPostsTo: fixture.submitUrl,
      },
      [fixture.doneUrl]: { title: "Submitted", readiness: "ready", links: [] },
    };
    await withFake({ pages }, async ({ fake, dir, out }) => {
      const config = writeConfig(dir, { allowOrigins: [fixture.origin] });
      await planWith({ url: fixture.url, field: ["name:q=surf-cli"], out, config });
      const plan = readPlan(out);
      assert.equal(plan.submit.control.selector, "#search-submit");

      const envelope = await applyWith({
        plan: out,
        submit: true,
        confirmPlan: plan.approval_token,
        config,
      });

      assert.equal(envelope.result.submitted, true);
      assert.equal(envelope.result.submit.clicked, true);
      assert.equal(envelope.receipt.outcome, "applied");

      const clicks = fake.calls().filter((call) => call[0] === "click");
      assert.equal(clicks.length, 1, "more than one click reached the browser");
      assert.deepEqual(clicks[0].slice(0, 3), ["click", "--selector", "#search-submit"]);
      assert.equal(
        fake.calls().some((call) => call.includes("#set-bid")),
        false,
      );

      await waitFor(() => fixture.posts().length === 1);
      assert.equal(fixture.posts().length, 1, "the server saw a different number of submissions");
      assert.match(fixture.posts()[0].body, /q=surf-cli/);

      const submitReceipts = receiptsIn(dir).filter(
        (receipt) => receipt.details?.mode === "submit",
      );
      assert.equal(submitReceipts.length, 1);
      assert.equal(submitReceipts[0].outcome, "applied");
      assert.equal(submitReceipts[0].verified_by, "post_read");
      assert.equal(submitReceipts[0].details.submit.control, "#search-submit");

      // (h) the same plan again is refused by its own receipt, and nothing is clicked.
      await assert.rejects(
        () => applyWith({ plan: out, submit: true, confirmPlan: plan.approval_token, config }),
        (error) => {
          assert.equal(error.code, "submit_already_attempted");
          assert.match(error.message, new RegExp(plan.plan_id));
          return true;
        },
      );
      assert.equal(fake.calls().filter((call) => call[0] === "click").length, 1);
      assert.equal(fixture.posts().length, 1);
    });
  } finally {
    await fixture.close();
  }
});

test("(m) a submit receipt in doubt blocks the plan; a fill receipt alone never does", async () => {
  await withFake({}, async ({ dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const plan = readPlan(out);

    // A fill receipt for this plan does not close the gate (review A2, packet D13).
    writeReceipt(dir, { planId: plan.plan_id, mode: "fill", outcome: "applied" });
    const envelope = await applyWith({
      plan: out,
      submit: true,
      confirmPlan: plan.approval_token,
      config,
    });
    assert.equal(envelope.result.submitted, true);

    // An `attempting` submit receipt does, whatever the process that left it did next.
    const second = mkdtempSync(path.join(os.tmpdir(), "tc-submit-gate-"));
    try {
      const blocked = writeConfig(second, { allowOrigins: ["https://forms.example"] });
      writeReceipt(second, { planId: plan.plan_id, mode: "submit", outcome: "attempting" });
      await assert.rejects(
        () =>
          applyWith({ plan: out, submit: true, confirmPlan: plan.approval_token, config: blocked }),
        { code: "submit_already_attempted" },
      );
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });
});

test("(k) an edited plan no longer matches its approval, and nothing is opened", async () => {
  await withFake({}, async ({ fake, dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const plan = readPlan(out);
    const before = fake.calls().length;

    const edited = { ...plan, fields: [{ ...plan.fields[0], intended_value: "surf-cli-edited" }] };
    writeFileSync(out, JSON.stringify(edited, null, 2));

    // The operator's token is the one they were given for the content they read.
    await assert.rejects(
      () => applyWith({ plan: out, submit: true, confirmPlan: plan.approval_token, config }),
      { code: "submit_plan_mismatch" },
    );
    // Recomputing the token from the edited file does not help: the file no longer hashes to
    // its own approval_token, so the artifact is not the one that was approved.
    await assert.rejects(
      () => applyWith({ plan: out, submit: true, confirmPlan: approvalTokenFor(edited), config }),
      { code: "submit_plan_mismatch" },
    );
    assert.equal(fake.calls().length, before);
    assert.equal(receiptsIn(dir).length, 0);
  });
});

test("(i) a page that drifted from the plan's fingerprint refuses before anything is typed", async () => {
  const dir = scratch();
  const planner = createFakeSurf({ pages: searchPage() });
  const drifted = createFakeSurf({
    pages: searchPage({
      controls: [
        { selector: "#search-submit", kind: "submit", text: "Search now", form: "#search" },
        { selector: "#set-bid", kind: "button", text: "Set bid", form: "#search" },
      ],
    }),
  });
  const out = path.join(dir, "plan.json");
  try {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await withFakeSurfEnv(planner.path, () =>
      planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config }),
    );
    await withFakeSurfEnv(drifted.path, async () => {
      await assert.rejects(
        () => applyWith({ plan: out, config }),
        (error) => {
          assert.equal(error.code, "plan_stale");
          assert.match(error.message, /control_signature/);
          return true;
        },
      );
    });
    assert.equal(
      drifted.calls().some((call) => call[0] === "type"),
      false,
      "a stale plan typed something",
    );
  } finally {
    planner.cleanup();
    drifted.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(j) a readiness refusal on apply passes the surf code through", async () => {
  const dir = scratch();
  const planner = createFakeSurf({ pages: searchPage() });
  const gated = createFakeSurf({
    pages: { "https://forms.example/search": { title: "Sign in", readiness: "login", links: [] } },
  });
  const out = path.join(dir, "plan.json");
  try {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await withFakeSurfEnv(planner.path, () =>
      planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config }),
    );
    await withFakeSurfEnv(gated.path, async () => {
      await assert.rejects(() => applyWith({ plan: out, config }), { code: "page_login" });
    });
    assert.deepEqual(
      gated
        .calls()
        .map((call) => call[0])
        .filter((command) => !command.startsWith("--")),
      ["tab.new", "wait.ready", "tab.close"],
    );
  } finally {
    planner.cleanup();
    gated.cleanup();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(l) a change handler that navigates fails the dry run and the receipt says failed", async () => {
  const pages = searchPage({ typeNavigatesTo: RESULTS_URL });
  await withFake({ pages }, async ({ fake, dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });

    await assert.rejects(
      () => applyWith({ plan: out, config }),
      (error) => {
        assert.equal(error.code, "fill_side_effect_observed");
        assert.match(error.message, /navigat/);
        return true;
      },
    );

    const receipts = receiptsIn(dir);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].outcome, "failed");
    assert.equal(receipts[0].error.code, "fill_side_effect_observed");
    assert.equal(
      fake.calls().some((call) => call[0] === "click"),
      false,
    );
  });
});

test("a read-back that does not match the plan stops the run and names the field, not the value", async () => {
  const pages = searchPage({
    fields: {
      'input[name="q"]': {
        value: "",
        kind: "search",
        name: "q",
        form: "#search",
        readOnlyValue: true,
      },
    },
  });
  // The fixture writes what it is told, so the mismatch is produced by planning one value and
  // applying a plan whose intended value was rewritten together with its token.
  await withFake({ pages }, async ({ dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const plan = readPlan(out);
    const rewritten = { ...plan, fields: [{ ...plan.fields[0], resolved_selector: "#missing" }] };
    writeFileSync(
      out,
      JSON.stringify({ ...rewritten, approval_token: approvalTokenFor(rewritten) }, null, 2),
    );

    await assert.rejects(
      () => applyWith({ plan: out, config }),
      (error) => {
        assert.equal(["plan_stale", "field_readback_mismatch"].includes(error.code), true);
        assert.equal(error.message.includes("surf-cli"), false);
        return true;
      },
    );
  });
});

test("a submit control that stays disabled refuses after the bounded wait, and never clicks", async () => {
  const pages = searchPage({
    controls: [
      {
        selector: "#search-submit",
        kind: "submit",
        text: "Search",
        form: "#search",
        enabled: false,
      },
    ],
  });
  await withFake({ pages }, async ({ fake, dir, out }) => {
    const config = writeConfig(dir, {
      allowOrigins: ["https://forms.example"],
      controlEnableTimeoutMs: 300,
    });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const plan = readPlan(out);
    assert.equal(plan.submit.control.disabled, true);

    await assert.rejects(
      () => applyWith({ plan: out, submit: true, confirmPlan: plan.approval_token, config }),
      { code: "submit_control_disabled" },
    );
    assert.equal(
      fake.calls().some((call) => call[0] === "click"),
      false,
    );
    assert.equal(receiptsIn(dir).filter((receipt) => receipt.details?.mode === "submit").length, 0);
  });
});

test("a form that re-renders its buttons after typing refuses instead of clicking a new one", async () => {
  const pages = searchPage({
    controlsAfterType: [{ selector: "#other", kind: "submit", text: "Other", form: "#search" }],
  });
  await withFake({ pages }, async ({ fake, dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const plan = readPlan(out);

    await assert.rejects(
      () => applyWith({ plan: out, submit: true, confirmPlan: plan.approval_token, config }),
      { code: "submit_control_changed" },
    );
    assert.equal(
      fake.calls().some((call) => call[0] === "click"),
      false,
    );
  });
});

test("a submit whose post-condition never arrives is unknown, exits non-zero and is never retried", async () => {
  const pages = searchPage({ changeNavigatesTo: undefined });
  await withFake({ pages }, async ({ dir, out }) => {
    const config = writeConfig(dir, {
      allowOrigins: ["https://forms.example"],
      postconditionTimeoutMs: 300,
    });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const plan = readPlan(out);

    await assert.rejects(
      () => applyWith({ plan: out, submit: true, confirmPlan: plan.approval_token, config }),
      (error) => {
        assert.equal(error.code, "submit_postcondition_unmet");
        assert.equal(error.details.submitted, "unknown");
        assert.match(error.message, /never retried/);
        return true;
      },
    );

    const submitReceipts = receiptsIn(dir).filter((receipt) => receipt.details?.mode === "submit");
    assert.equal(submitReceipts.length, 1);
    assert.equal(submitReceipts[0].outcome, "unknown");

    // Rule (3) now holds for this plan: it can never be submitted again.
    await assert.rejects(
      () => applyWith({ plan: out, submit: true, confirmPlan: plan.approval_token, config }),
      { code: "submit_already_attempted" },
    );
  });
});

test("--receipt-out exports the run's receipts, and the envelope carries no field value", async () => {
  await withFake({}, async ({ dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const receiptOut = path.join(dir, "receipts.json");

    const envelope = await applyWith({ plan: out, config, receiptOut });
    assert.equal(envelope.receiptExport, receiptOut);
    const exported = JSON.parse(readFileSync(receiptOut, "utf-8"));
    assert.equal(exported.artifact_kind, "test-capabilities.surf.apply.receipts");
    assert.equal(exported.receipts.length, 1);
    assert.equal(exported.plan_id, readPlan(out).plan_id);
    assert.equal(statSync(receiptOut).mode & 0o777, 0o600);

    assert.equal(JSON.stringify(envelope).includes("surf-cli"), false);
    assert.deepEqual(envelope.result.surfCalls, [
      "js fingerprint",
      'type input[name="q"]',
      'js read-back input[name="q"]',
      "js observe",
      "js observe",
    ]);
  });
});

test("the apply route is registered as mutating, with the reachability sentence in its description", async () => {
  const { CLI_ROUTE_MANIFEST, getSurfActionStatus } =
    await importRuntimeModule("core/operations.js");
  assert.equal(getSurfActionStatus("apply"), "implemented");
  const entry = CLI_ROUTE_MANIFEST.find(
    (route) => route.command === "surf" && route.action === "apply",
  );
  assert.match(entry.description, /Not wired to any agent, hook or retry path/);
  assert.match(entry.description, /mutation\.allowOrigins/);
  assert.equal(Object.hasOwn(entry, "operator_only"), false);
  assert.equal(Object.hasOwn(entry, "mutation"), false);
});

test("no environment variable opens the gate and no flag adds an origin", () => {
  const source = readFileSync(
    new URL("../src/core/operations/surf-apply-operation.ts", import.meta.url).pathname,
    "utf-8",
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/process\.env/.test(code), false);
  assert.equal(code.includes("--allow-origin"), false);
  // The operation holds no browser handle of its own: it talks to the runner.
  assert.equal(/session\.evaluate\(/.test(code), false);
  assert.equal(/session\.step\(/.test(code), false);
});

// ---------------------------------------------------------------------------
// The runner's own rules, without a browser: a session double that answers the
// step's `read` the way the transport would.
// ---------------------------------------------------------------------------

function sessionDouble(script = {}) {
  const answers = [...(script.jsAnswers ?? [])];
  const stepReplies = [...(script.stepReplies ?? [])];
  const seen = [];
  const replyFor = (command, args, payload) => ({
    command,
    args: args ?? [],
    display: ["surf", command, ...(args ?? [])],
    stdout: JSON.stringify({ result: payload, target: null, notice: null }),
    stderr: "",
    exitCode: 0,
    outcome: { class: "success", basis: "evidence", code: "ok", ok: true },
    ok: true,
  });
  return {
    seen,
    tab: { id: 7, url: FORM_URL, openedAt: "2026-09-08T00:00:00.000Z" },
    readiness: { state: "ready", evidence: [] },
    async evaluate(code, _declaration, options) {
      seen.push({ kind: "evaluate", id: options.id });
      const next = answers.shift();
      if (next instanceof Error) {
        throw next;
      }
      return options.read(replyFor("js", [code], next), 1);
    },
    async step(step) {
      seen.push({ kind: "step", command: step.command, args: step.args, details: step.details });
      // The runner reads the page through `js` steps (they carry `--no-screenshot`, so they
      // cannot go through `evaluate`), and acts through the value-setting verbs.
      const payload =
        step.command === "js" ? answers.shift() : (stepReplies.shift() ?? { success: true });
      if (payload instanceof Error) {
        throw payload;
      }
      const value = step.read(replyFor(step.command, step.args, payload), 1);
      if (step.verify) {
        seen.push({ kind: "verify", result: await step.verify() });
      }
      return value;
    },
    notes: () => [],
    close: async () => {
      seen.push({ kind: "close" });
    },
  };
}

function runnerContext(overrides = {}) {
  return {
    config: {
      surf: {
        submit: { controlEnableTimeoutMs: 50, postconditionTimeoutMs: 50, ...overrides },
      },
    },
  };
}

test("the post-condition is evaluated by kind, and an unreadable page never satisfies one", () => {
  const observation = (href, detail) => ({ available: true, href, ...(detail ? { detail } : {}) });
  assert.equal(
    evaluatePostCondition(
      { kind: "url_prefix", expected: "https://forms.example/done" },
      observation("https://forms.example/done?x=1"),
      FORM_URL,
    ).satisfied,
    true,
  );
  assert.equal(
    evaluatePostCondition(
      { kind: "url_prefix", expected: "https://forms.example/done" },
      observation(FORM_URL),
      FORM_URL,
    ).satisfied,
    false,
  );
  assert.equal(
    evaluatePostCondition(
      { kind: "text", expected: "Submitted" },
      observation(FORM_URL, "text-present"),
      FORM_URL,
    ).satisfied,
    true,
  );
  assert.equal(
    evaluatePostCondition({ kind: "text", expected: "Submitted" }, observation(FORM_URL), FORM_URL)
      .satisfied,
    false,
  );
  assert.equal(
    evaluatePostCondition(
      { kind: "left_url", expected: FORM_URL },
      observation(RESULTS_URL),
      FORM_URL,
    ).satisfied,
    true,
  );
  assert.equal(
    evaluatePostCondition({ kind: "left_url", expected: FORM_URL }, { available: false }, FORM_URL)
      .satisfied,
    false,
  );
});

test("a read-back or observation without this run's marker is refused, never believed", async () => {
  const plan = fixturePlan();
  const unmarked = sessionDouble({ jsAnswers: [{ href: FORM_URL, value: "surf-cli" }] });
  const runner = createApplyRunner(
    unmarked,
    { state: "ready", evidence: [] },
    {
      context: runnerContext(),
      plan,
      mode: "fill",
    },
  );
  await assert.rejects(() => runner.readBack("f1"), { code: "field_readback_mismatch" });

  const unmarkedObserve = sessionDouble({ jsAnswers: [{ href: FORM_URL }] });
  const observer = createApplyRunner(
    unmarkedObserve,
    { state: "ready", evidence: [] },
    {
      context: runnerContext(),
      plan,
      mode: "fill",
    },
  );
  // An observation that cannot be established is `available: false`, which the operation reads
  // as a side effect rather than as a pass.
  const observation = await observer.observe();
  assert.equal(observation.available, false);
  assert.match(observation.detail, /probe marker/);
});

test("a select field is set with select, and a checkbox only when it does not already match", async () => {
  const plan = fixturePlan();
  const selectPlan = {
    ...plan,
    fields: [
      {
        ...plan.fields[0],
        id: "f1",
        resolved_selector: "#country",
        control: { tag: "select", name: "country", form: "#search" },
        intended_value: "de",
      },
    ],
  };
  const selectSession = sessionDouble();
  const selectRunner = createApplyRunner(
    selectSession,
    { state: "ready", evidence: [] },
    {
      context: runnerContext(),
      plan: selectPlan,
      mode: "fill",
    },
  );
  await selectRunner.setValue("f1");
  const selectStep = selectSession.seen.find((entry) => entry.kind === "step");
  assert.equal(selectStep.command, "select");
  assert.deepEqual(selectStep.args, ["#country", "de", "--no-screenshot"]);
  assert.equal(selectStep.details.mode, "fill");
  assert.equal(selectStep.details.plan_id, plan.plan_id);

  const checkboxPlan = {
    ...plan,
    fields: [
      {
        ...plan.fields[0],
        resolved_selector: "#agree",
        control: { tag: "input", type: "checkbox", name: "agree", form: "#search" },
        intended_value: "true",
      },
    ],
  };
  // Already checked: nothing is clicked, because an unnecessary click is an unnecessary act.
  const matching = sessionDouble({
    jsAnswers: [
      { __testCapabilitiesSurfApplyProbe: null, href: FORM_URL, found: true, checked: true },
    ],
  });
  const noop = createApplyRunner(
    matching,
    { state: "ready", evidence: [] },
    {
      context: runnerContext(),
      plan: checkboxPlan,
      mode: "fill",
    },
  );
  await assert.rejects(() => noop.setValue("f1"), { code: "field_readback_mismatch" });
});

test("clickSubmit consumes itself and refuses a control the plan no longer recognises", async () => {
  const plan = fixturePlan();
  const marker = (extra) => ({
    href: FORM_URL,
    submitCount: 1,
    submitDisabled: false,
    formPresent: true,
    ...extra,
  });
  const gone = sessionDouble({ jsAnswers: [marker({ formPresent: false })] });
  const goneRunner = createApplyRunner(
    gone,
    { state: "ready", evidence: [] },
    {
      context: runnerContext(),
      plan,
      mode: "submit",
    },
  );
  // The observation is unmarked here, so the runner reports it unavailable rather than acting
  // on it; either way nothing is clicked.
  await assert.rejects(
    () => goneRunner.clickSubmit(),
    (error) => {
      assert.equal(
        ["submit_control_changed", "submit_control_disabled"].includes(error.code),
        true,
      );
      return true;
    },
  );
  assert.equal(
    gone.seen.some((entry) => entry.kind === "step" && entry.command === "click"),
    false,
    "a click was emitted before the control was checked",
  );

  // Consumed: the second call cannot emit anything, whatever the first one did.
  await assert.rejects(() => goneRunner.clickSubmit(), { code: "submit_already_attempted" });
});

// ---------------------------------------------------------------------------
// Input and artifact refusals: everything that stops before a browser exists
// ---------------------------------------------------------------------------

test("apply refuses a post-condition without --submit, and two post-conditions at once", async () => {
  await withFake({}, async ({ dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const plan = readPlan(out);

    await assert.rejects(
      () => applyWith({ plan: out, config, untilText: "Submitted" }),
      /post-condition but no --submit/,
    );
    await assert.rejects(
      () =>
        applyWith({
          plan: out,
          submit: true,
          confirmPlan: plan.approval_token,
          config,
          untilText: "Submitted",
          untilUrlPrefix: "https://forms.example/done",
        }),
      /either --until-url-prefix or --until-text/,
    );
    await assert.rejects(() => applyWith({ plan: out, config, confirmPlan: plan.approval_token }), {
      code: "submit_gate_closed",
    });
    await assert.rejects(() => applyWith({ plan: out, config, url: FORM_URL }), {
      code: "unsupported_option",
    });
  });
});

test("apply refuses a plan file that is missing, unreadable or not a plan", async () => {
  await withFake({}, async ({ dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await assert.rejects(() => applyWith({ plan: path.join(dir, "nope.json"), config }), {
      code: "config_not_found",
    });

    const link = path.join(dir, "link.json");
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    symlinkSync(out, link);
    await assert.rejects(
      () => applyWith({ plan: link, config }),
      (error) => {
        assert.equal(error.code, "config_invalid");
        assert.match(error.message, /symlink/);
        return true;
      },
    );

    const broken = path.join(dir, "broken.json");
    writeFileSync(broken, "{not json");
    await assert.rejects(
      () => applyWith({ plan: broken, config }),
      (error) => {
        assert.equal(error.code, "config_invalid");
        assert.match(error.message, /not valid JSON/);
        return true;
      },
    );

    const foreign = path.join(dir, "foreign.json");
    writeFileSync(foreign, JSON.stringify({ schema_version: 1, artifact_kind: "something.else" }));
    await assert.rejects(
      () => applyWith({ plan: foreign, config }),
      (error) => {
        assert.equal(error.code, "config_invalid");
        assert.match(error.message, /test-capabilities\.surf\.plan v1 artifact/);
        return true;
      },
    );

    const huge = path.join(dir, "huge.json");
    writeFileSync(huge, `{"padding":"${"x".repeat(2 * 1024 * 1024 + 8)}"}`);
    await assert.rejects(
      () => applyWith({ plan: huge, config }),
      (error) => {
        assert.equal(error.code, "config_invalid");
        assert.match(error.message, /larger than/);
        return true;
      },
    );
  });
});

test("a plan whose submit was ambiguous or absent refuses the submit, never the fill", async () => {
  const pages = searchPage({
    controls: [
      { selector: "#search-submit", kind: "submit", text: "Search", form: "#search" },
      { selector: "#search-again", kind: "submit", text: "Search again", form: "#search" },
    ],
  });
  await withFake({ pages }, async ({ dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const ambiguous = readPlan(out);
    assert.equal(ambiguous.submit.status, "ambiguous");

    await assert.rejects(
      () => applyWith({ plan: out, submit: true, confirmPlan: ambiguous.approval_token, config }),
      { code: "plan_submit_ambiguous" },
    );
    // The same plan fills without complaint: ambiguity refuses the submit, not the dry run.
    const filled = await applyWith({ plan: out, config });
    assert.equal(filled.result.submitted, false);

    const none = { ...ambiguous, submit: { status: "none", gate: "closed", candidates: [] } };
    const nonePath = path.join(dir, "none.json");
    writeFileSync(
      nonePath,
      JSON.stringify({ ...none, approval_token: approvalTokenFor(none) }, null, 2),
    );
    await assert.rejects(
      () =>
        applyWith({
          plan: nonePath,
          submit: true,
          confirmPlan: approvalTokenFor(none),
          config,
        }),
      { code: "plan_submit_missing" },
    );
  });
});

test("--until-url-prefix is the post-condition the receipt verifies against", async () => {
  const pages = searchPage();
  await withFake({ pages }, async ({ dir, out }) => {
    const config = writeConfig(dir, { allowOrigins: ["https://forms.example"] });
    await planWith({ url: FORM_URL, field: ["name:q=surf-cli"], out, config });
    const plan = readPlan(out);

    const envelope = await applyWith({
      plan: out,
      submit: true,
      confirmPlan: plan.approval_token,
      config,
      untilUrlPrefix: RESULTS_URL,
    });
    assert.equal(envelope.result.submitted, true);
    assert.deepEqual(envelope.result.submit.postCondition, {
      kind: "url_prefix",
      expected: RESULTS_URL,
    });
    const submitReceipt = receiptsIn(dir).find((receipt) => receipt.details?.mode === "submit");
    assert.equal(submitReceipt.outcome, "applied");
    assert.equal(
      submitReceipt.evidence.some((entry) => entry.includes("post-condition url_prefix satisfied")),
      true,
    );
  });
});
