import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import test from "node:test";
import yaml from "js-yaml";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { TestCapabilitiesConfigSchema, TestCapabilitiesOrchestrator } =
  await importRuntimeModule("index.js");

test("config schema accepts bounded propagation topology overrides", () => {
  const parsed = TestCapabilitiesConfigSchema.parse({
    version: "2.0",
    name: "Topology Override",
    targets: { cli: process.execPath },
    agents: {
      cli: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
    },
    intelligence: {
      correlation: true,
      propagation_topology: {
        include_defaults: false,
        edges: [{ upstream: "web", downstream: "api" }],
      },
    },
  });

  assert.equal(parsed.intelligence?.propagationTopology?.includeDefaults, false);
  assert.deepEqual(parsed.intelligence?.propagationTopology?.edges, [
    { upstream: "web", downstream: "api" },
  ]);
});

test("config schema rejects self-referential propagation topology edges", () => {
  assert.throws(
    () =>
      TestCapabilitiesConfigSchema.parse({
        version: "2.0",
        name: "Invalid Topology",
        targets: { cli: process.execPath },
        agents: {
          cli: {
            enabled: true,
            type: "cli-tester",
          },
        },
        intelligence: {
          correlation: true,
          propagationTopology: {
            includeDefaults: false,
            edges: [{ upstream: "api", downstream: "api" }],
          },
        },
      }),
    /distinct upstream and downstream components/,
  );
});

test("canonical YAML config parses through the fail-closed schema", async () => {
  const raw = yaml.load(
    readFileSync(new URL("../test-capabilities.yaml", import.meta.url), "utf8"),
  );
  const parsed = TestCapabilitiesConfigSchema.parse(raw);

  assert.equal(parsed.version, "2.0");
  assert.equal(parsed.intelligence?.selfHealing, false);
  assert.equal(parsed.intelligence?.prediction, false);
  assert.equal(parsed.intelligence?.correlation, true);
  assert.equal(parsed.quantum?.collapseStrategy, "significance");
  assert.equal(parsed.quantum?.maxDepth, 20);
  assert.equal(parsed.chaos?.enabled, false);

  const result = await new TestCapabilitiesOrchestrator({
    ...parsed,
    targets: { cli: process.execPath },
    agents: {
      cli: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
    },
    quantum: {
      ...(parsed.quantum ?? {}),
      enabled: false,
    },
  }).run();

  assert.equal(result.passed, true);
  assert.equal(result.coverage.overall > 0, true);
  assert.equal(result.coverage.status, "partial");
});

function surfConfig(agent) {
  return {
    version: "2.0",
    name: "Ready Selector",
    targets: { web: "https://example.com/" },
    agents: { web: agent },
  };
}

test("agents.<name>.readySelector parses on a surf agent, under either spelling (AK #5568)", () => {
  const camel = TestCapabilitiesConfigSchema.parse(
    surfConfig({ type: "surf", readySelector: "#play" }),
  );
  assert.equal(camel.agents.web.readySelector, "#play");

  const snake = TestCapabilitiesConfigSchema.parse(
    surfConfig({ type: "surf", ready_selector: "#play" }),
  );
  assert.equal(snake.agents.web.readySelector, "#play");
  assert.equal("ready_selector" in snake.agents.web, false);

  // absent stays absent: a config written before the key parses to the shape it always had
  const plain = TestCapabilitiesConfigSchema.parse(surfConfig({ type: "surf" }));
  assert.equal("readySelector" in plain.agents.web, false);
});

test("agents.<name>.readySelector refuses an empty selector and any non-surf agent", () => {
  assert.throws(
    () => TestCapabilitiesConfigSchema.parse(surfConfig({ type: "surf", readySelector: "" })),
    /readySelector/,
  );
  for (const type of ["bombadil", "cli-tester", "terminal-fuzzer"]) {
    assert.throws(
      () => TestCapabilitiesConfigSchema.parse(surfConfig({ type, readySelector: "#play" })),
      /readySelector is read only by 'surf' agents/,
      type,
    );
  }
});

test("agents.<name>.frameHint parses beside a readySelector, under either spelling (AK #5885)", () => {
  const camel = TestCapabilitiesConfigSchema.parse(
    surfConfig({ type: "surf", readySelector: "#play", frameHint: "urlPrefix=https://embed/" }),
  );
  assert.equal(camel.agents.web.frameHint, "urlPrefix=https://embed/");

  const snake = TestCapabilitiesConfigSchema.parse(
    surfConfig({ type: "surf", ready_selector: "#play", frame_hint: "selector=iframe#player" }),
  );
  assert.equal(snake.agents.web.frameHint, "selector=iframe#player");
  assert.equal("frame_hint" in snake.agents.web, false);
});

test("agents.<name>.frameHint refuses without a readySelector, off surf, and in a shape it cannot read", () => {
  assert.throws(
    () =>
      TestCapabilitiesConfigSchema.parse(
        surfConfig({ type: "surf", frameHint: "urlPrefix=https://embed/" }),
      ),
    /frameHint needs readySelector/,
  );
  assert.throws(
    () =>
      TestCapabilitiesConfigSchema.parse(
        surfConfig({ type: "bombadil", readySelector: "#p", frameHint: "urlPrefix=https://e/" }),
      ),
    /frameHint is read only by 'surf' agents/,
  );
  for (const shape of ["https://embed/", "url=https://embed/", "selector=", ""]) {
    assert.throws(
      () =>
        TestCapabilitiesConfigSchema.parse(
          surfConfig({ type: "surf", readySelector: "#play", frameHint: shape }),
        ),
      /frameHint must be 'urlPrefix=<prefix>' or 'selector=<css>'/,
      shape,
    );
  }
});
