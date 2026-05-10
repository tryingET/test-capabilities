import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runtimeEnv } from "./helpers/runtime-dist.mjs";

const scriptPath = new URL("../scripts/root-cause-corpus.mjs", import.meta.url).pathname;
const repoRoot = new URL("..", import.meta.url).pathname;

test("root-cause corpus dogfoods calibrated diagnosis invariants", { timeout: 20000 }, () => {
  const result = spawnSync("node", [scriptPath], {
    encoding: "utf8",
    cwd: repoRoot,
    env: runtimeEnv(),
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(
    result.stdout,
    /\[pass\] CLI missing command with one observed agent does not emit root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] CLI timeout with two observed agents classifies timeout_or_latency/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Two sensors linked to the same finding classify contract_mismatch/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Single sensor with multiple linked findings does not emit root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Partial observed\/unobserved finding pair does not emit root_cause/,
  );
  assert.match(result.stdout, /\[pass\] root-cause corpus complete \(10 cases\)/);
});

test("root-cause corpus emits machine-readable dogfood results", { timeout: 20000 }, () => {
  const result = spawnSync("node", [scriptPath, "--json"], {
    encoding: "utf8",
    cwd: repoRoot,
    env: runtimeEnv(),
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.total, 10);
  assert.equal(payload.failed, 0);
  assert.equal(
    payload.cases.some(
      (entry) =>
        entry.name ===
        "Bombadil property violations with two observed agents classify property_violation",
    ),
    true,
  );
});
