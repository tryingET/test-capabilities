import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const buildResult = spawnSync("npm", ["run", "build", "--silent"], {
  encoding: "utf8",
});
assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

const { CAPABILITY_MATRIX } = await import("../dist/core/capabilities.js");
const {
  CLI_OPERATION_REGISTRY,
  CLI_ROUTE_MANIFEST,
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

test("executeCliOperation fails clearly for registered but unsupported routes", async () => {
  await assert.rejects(
    async () => executeCliOperation({ command: "surf", action: "flow" }, {}),
    /Unsupported surf action\(s\): flow/,
  );

  await assert.rejects(
    async () => executeCliOperation({ command: "predict" }, {}),
    /Unsupported CLI command\(s\): predict/,
  );
});
