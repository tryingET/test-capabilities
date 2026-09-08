import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
