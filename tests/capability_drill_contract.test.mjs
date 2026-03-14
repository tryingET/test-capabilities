import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";

const scriptPath = new URL("../scripts/capability-drill.sh", import.meta.url).pathname;

test(
  "capability drill script exercises shipped capabilities with the surf shim",
  { timeout: 20000 },
  () => {
    const result = spawnSync("bash", [scriptPath, "--skip-build", "--surf-mode", "shim"], {
      encoding: "utf8",
      cwd: new URL("..", import.meta.url).pathname,
      env: process.env,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[pass\] test command succeeds on a real CLI smoke target/);
    assert.match(result.stdout, /\[pass\] quantum command simulates an explicit target/);
    assert.match(
      result.stdout,
      /\[pass\] heal dry-run proposes selector fixes without mutating payload literals/,
    );
    assert.match(
      result.stdout,
      /\[pass\] surf explore exercises the shipped wrapper path \(shim\)/,
    );
    assert.match(result.stdout, /\[pass\] capability drill complete \(9 checks, surf_mode=shim\)/);
  },
);

test("capability drill script emits machine-readable JSON", { timeout: 20000 }, () => {
  const result = spawnSync("bash", [scriptPath, "--skip-build", "--surf-mode", "shim", "--json"], {
    encoding: "utf8",
    cwd: new URL("..", import.meta.url).pathname,
    env: process.env,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.surfMode, "shim");
  assert.equal(payload.summary.total, 9);
  assert.equal(payload.summary.failed, 0);
  assert.equal(
    payload.checks.some(
      (check) =>
        check.label === "prediction engine accepts complete metrics and rejects partial payloads",
    ),
    true,
  );
});
