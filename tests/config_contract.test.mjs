import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import test from "node:test";
import yaml from "js-yaml";

const buildResult = spawnSync("npm", ["run", "build", "--silent"], {
  encoding: "utf8",
});
assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

const { TestCapabilitiesConfigSchema, TestCapabilitiesOrchestrator } = await import(
  "../dist/index.js"
);

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
});
