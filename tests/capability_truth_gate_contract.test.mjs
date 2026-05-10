import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runtimeEnv } from "./helpers/runtime-dist.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const nodeOnlyPath = path.dirname(process.execPath);

function runTruthGate({ requireAkDirection, pathOverride = nodeOnlyPath }) {
  return spawnSync(process.execPath, ["./scripts/capability-truth-gate.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...runtimeEnv(),
      PATH: pathOverride,
      TEST_CAPABILITIES_REQUIRE_AK_DIRECTION: requireAkDirection ? "1" : "0",
    },
  });
}

function withFakeAk(scriptBody, callback) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-fake-ak-"));
  const akPath = path.join(tempDir, "ak");
  writeFileSync(akPath, scriptBody, { mode: 0o755 });
  try {
    return callback(`${tempDir}${path.delimiter}${nodeOnlyPath}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test("portable truth gate does not require workstation AK direction state", () => {
  const result = runTruthGate({ requireAkDirection: false });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /AK direction check skipped/);
  assert.match(result.stdout, /capability-truth-gate: ok/);
});

test("portable truth gate skips mismatched AK direction output", () => {
  const result = withFakeAk("#!/bin/sh\nexit 0\n", (pathOverride) =>
    runTruthGate({ requireAkDirection: false, pathOverride }),
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /AK direction check skipped \(portable mode\)/);
  assert.match(result.stdout, /capability-truth-gate: ok/);
});

test("local truth gate can require workstation AK direction state", () => {
  const result = runTruthGate({ requireAkDirection: true });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /AK direction check is required/);
});

test("local truth gate rejects mismatched AK direction output", () => {
  const result = withFakeAk("#!/bin/sh\nexit 0\n", (pathOverride) =>
    runTruthGate({ requireAkDirection: true, pathOverride }),
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /AK direction should keep SF1 active/);
});
