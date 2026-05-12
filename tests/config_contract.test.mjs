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
