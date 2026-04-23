import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import process from "node:process";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { applyTargetOverride, assertMeaningfulTestTargetOverride } = await importRuntimeModule(
  "core/operations/config-targets-core.js",
);
const { applyQuickMode } = await importRuntimeModule("core/operations/config-quick-mode-core.js");
const { loadConfig } = await importRuntimeModule("core/operations/config-load-core.js");

test("applyTargetOverride preserves config when no target is supplied", () => {
  const config = {
    version: "2.0",
    name: "No Override",
    targets: { cli: process.execPath },
    quantum: { enabled: false, branches: 100, collapseStrategy: "significance", maxDepth: 20 },
  };

  assert.deepEqual(applyTargetOverride(config), config);
});

test("applyTargetOverride routes CLI paths to targets.cli and URLs to targets.web", () => {
  const baseConfig = {
    version: "2.0",
    name: "Override Routing",
    targets: { cli: "node" },
    quantum: { enabled: false, branches: 100, collapseStrategy: "significance", maxDepth: 20 },
  };

  const cliOverride = applyTargetOverride(baseConfig, process.execPath);
  const webOverride = applyTargetOverride(baseConfig, "https://example.com");

  assert.equal(cliOverride.targets?.cli, process.execPath);
  assert.equal(cliOverride.targets?.web, undefined);
  assert.equal(webOverride.targets?.cli, "node");
  assert.equal(webOverride.targets?.web, "https://example.com");
});

test("assertMeaningfulTestTargetOverride fails closed only for inert URL targets", () => {
  const quantumDisabled = {
    version: "2.0",
    name: "Quantum Disabled",
    targets: { cli: process.execPath },
    quantum: { enabled: false, branches: 100, collapseStrategy: "significance", maxDepth: 20 },
  };
  const quantumEnabled = {
    ...quantumDisabled,
    quantum: {
      ...quantumDisabled.quantum,
      enabled: true,
    },
  };

  assert.doesNotThrow(() => assertMeaningfulTestTargetOverride(process.execPath, quantumDisabled));
  assert.doesNotThrow(() =>
    assertMeaningfulTestTargetOverride("https://example.com", quantumEnabled),
  );
  assert.throws(
    () => assertMeaningfulTestTargetOverride("https://example.com", quantumDisabled),
    /URL targets for 'test' require a real web-consuming runtime path/,
  );
});

test("applyQuickMode disables quantum and prediction while preserving other runtime intent", () => {
  const config = {
    version: "2.0",
    name: "Quick Mode",
    targets: { cli: process.execPath, web: "https://example.com" },
    intelligence: {
      selfHealing: false,
      prediction: true,
      correlation: true,
      collective: false,
    },
    quantum: {
      enabled: true,
      branches: 25,
      collapseStrategy: "coverage",
      maxDepth: 12,
      timeout: "5s",
    },
  };

  const quickMode = applyQuickMode(config);

  assert.equal(quickMode.intelligence?.prediction, false);
  assert.equal(quickMode.intelligence?.correlation, true);
  assert.equal(quickMode.quantum?.enabled, false);
  assert.equal(quickMode.quantum?.branches, 25);
  assert.equal(quickMode.quantum?.collapseStrategy, "coverage");
  assert.equal(quickMode.targets?.cli, process.execPath);
});

test("applyQuickMode falls back to default intelligence and quantum baselines when absent", () => {
  const quickMode = applyQuickMode({
    version: "2.0",
    name: "Quick Mode Defaults",
    targets: { cli: process.execPath },
  });

  assert.equal(quickMode.intelligence?.selfHealing, false);
  assert.equal(quickMode.intelligence?.prediction, false);
  assert.equal(quickMode.intelligence?.correlation, true);
  assert.equal(quickMode.quantum?.enabled, false);
  assert.equal(quickMode.quantum?.branches, 100);
  assert.equal(quickMode.quantum?.collapseStrategy, "significance");
});

test("loadConfig parses the canonical YAML, tolerates empty YAML, and fails clearly when the file is missing", () => {
  const parsed = loadConfig(new URL("../test-capabilities.yaml", import.meta.url).pathname);

  assert.equal(parsed.version, "2.0");
  assert.equal(parsed.intelligence?.correlation, true);
  assert.equal(parsed.quantum?.collapseStrategy, "significance");

  const emptyConfigPath = new URL("../tmp/test-capabilities-empty-config.yaml", import.meta.url)
    .pathname;
  try {
    writeFileSync(emptyConfigPath, "\n", "utf8");
    assert.throws(() => loadConfig(emptyConfigPath), /Required/);
  } finally {
    try {
      unlinkSync(emptyConfigPath);
    } catch {}
  }

  assert.throws(
    () => loadConfig("/tmp/definitely-missing-test-capabilities-config.yaml"),
    /Config file not found/,
  );
});
