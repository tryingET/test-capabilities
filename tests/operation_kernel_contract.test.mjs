import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const { CAPABILITY_MATRIX } = await import("../dist/core/capabilities.js");
const {
  CLI_OPERATION_REGISTRY,
  CLI_ROUTE_MANIFEST,
  SURF_EXPLORE_OPTION_SUPPORT,
  TEST_OPTION_SUPPORT,
  executeCliOperation,
  resolveCliRoute,
} = await import("../dist/core/operations.js");

function withFakeSurf(script) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-operation-kernel-"));
  const surfPath = path.join(dir, "surf");
  writeFileSync(surfPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });

  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("operation kernel registry and capability matrix stay aligned", () => {
  const implementedOperationIds = CLI_ROUTE_MANIFEST.filter(
    (entry) => entry.status === "implemented" && entry.operationId,
  )
    .map((entry) => entry.operationId)
    .sort();

  const registryOperationIds = Object.values(CLI_OPERATION_REGISTRY)
    .map((definition) => definition.id)
    .sort();

  assert.deepEqual(implementedOperationIds, registryOperationIds);
  assert.deepEqual(CAPABILITY_MATRIX.cli.testOptions, TEST_OPTION_SUPPORT);
  assert.deepEqual(CAPABILITY_MATRIX.cli.surfExploreOptions, SURF_EXPLORE_OPTION_SUPPORT);
  assert.equal(CAPABILITY_MATRIX.cli.commands.surf, "implemented");
  assert.equal(
    resolveCliRoute({ command: "surf", action: "explore" })?.operationId,
    "surf.explore",
  );
  assert.equal(resolveCliRoute({ command: "predict" })?.status, "unsupported");
});

test("executeCliOperation routes the test verb through the typed operation kernel", async () => {
  const result = await executeCliOperation(
    { command: "test" },
    {
      config: new URL("../test-capabilities.yaml", import.meta.url).pathname,
      target: process.execPath,
      quick: true,
    },
  );

  assert.equal(result.operationId, "test");
  assert.equal(result.summary.health, "pass");
  assert.equal(result.result.passed, true);
  assert.equal(result.input.quick, true);
  assert.equal(result.effectiveConfig.targets.cli, process.execPath);
});

test("executeCliOperation rejects URL test targets when no supported web consumer is enabled", async () => {
  await assert.rejects(
    async () =>
      executeCliOperation(
        { command: "test" },
        {
          config: new URL("../test-capabilities.yaml", import.meta.url).pathname,
          target: "https://example.com",
          quick: true,
        },
      ),
    /URL targets for 'test' require a real web-consuming runtime path/,
  );
});

test("executeCliOperation routes surf explore through the typed operation kernel", async () => {
  const fake = withFakeSurf('printf "surf:%s\\n" "$1"\nprintf "%s\\n" "$2"');
  const previousPath = process.env.PATH;
  process.env.PATH = `${fake.dir}:${process.env.PATH ?? ""}`;

  try {
    const result = await executeCliOperation(
      { command: "surf", action: "explore" },
      { url: "https://example.com" },
    );

    assert.equal(result.operationId, "surf.explore");
    assert.deepEqual(result.result.args, ["go", "https://example.com"]);
    assert.match(result.result.stdout, /surf:go/);
    assert.match(result.result.stdout, /https:\/\/example\.com/);
  } finally {
    process.env.PATH = previousPath;
    fake.cleanup();
  }
});

test("executeCliOperation rejects surf explore flags that are not wired to runtime behavior", async () => {
  await assert.rejects(
    async () =>
      executeCliOperation(
        { command: "surf", action: "explore" },
        { url: "https://example.com", record: true },
      ),
    /Unsupported option\(s\) for 'surf explore': --record/,
  );
});

test("executeCliOperation rejects invalid quantum branch counts", async () => {
  await assert.rejects(
    async () =>
      executeCliOperation({ command: "quantum" }, { target: "https://example.com", branches: "0" }),
    /Invalid value for --branches: 0/,
  );
});

test("executeCliOperation rejects invalid quantum targets", async () => {
  await assert.rejects(
    async () => executeCliOperation({ command: "quantum" }, { target: "not-a-url", branches: "1" }),
    /Quantum target must be a valid URL/,
  );
});

test("executeCliOperation fails closed when the heal directory is missing", async () => {
  await assert.rejects(
    async () =>
      executeCliOperation({ command: "heal" }, { dir: "/tmp/definitely-missing-heal-dir" }),
    /Heal directory not found:/,
  );
});

test("executeCliOperation heal ignores generated and dependency directories", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-scan-"));
  const srcDir = path.join(dir, "src");
  const ignoredDir = path.join(dir, "node_modules");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(ignoredDir, { recursive: true });
  writeFileSync(path.join(srcDir, "sample.test.ts"), "export const ok = true;\n", "utf8");

  const unreadableFile = path.join(ignoredDir, "ignored.test.ts");
  writeFileSync(unreadableFile, "export const ignored = true;\n", { mode: 0o000 });
  chmodSync(unreadableFile, 0o000);

  try {
    const result = await executeCliOperation({ command: "heal" }, { dir, dryRun: true });

    assert.equal(result.proposals.length, 0);
  } finally {
    chmodSync(unreadableFile, 0o644);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal applies multiple same-line proposals in one pass", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-atomic-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('multi', async () => { await page.locator('#old-login'); await page.locator('#deprecated-submit'); });\n",
    "utf8",
  );

  try {
    const result = await executeCliOperation({ command: "heal" }, { dir, dryRun: false });
    const updated = readFileSync(file, "utf8");

    assert.equal(result.appliedCount, 2);
    assert.match(updated, /locator\('#login'\)/);
    assert.match(updated, /locator\('#submit'\)/);
    assert.doesNotMatch(updated, /#old-login/);
    assert.doesNotMatch(updated, /#deprecated-submit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation fails clearly for unsupported or unknown routes", async () => {
  await assert.rejects(
    async () => executeCliOperation({ command: "surf", action: "flow" }, {}),
    /Unsupported surf action\(s\): flow/,
  );

  await assert.rejects(
    async () => executeCliOperation({ command: "surf", action: "typo" }, {}),
    /Unsupported surf action\(s\): typo/,
  );

  await assert.rejects(
    async () => executeCliOperation({ command: "surf" }, {}),
    /Unsupported surf action\(s\): \(missing action\)/,
  );

  await assert.rejects(
    async () => executeCliOperation({ command: "predict" }, {}),
    /Unsupported CLI command\(s\): predict/,
  );

  await assert.rejects(
    async () => executeCliOperation({ command: "typo" }, {}),
    /Unsupported CLI command\(s\): typo/,
  );
});
