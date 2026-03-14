import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";

const binPath = new URL("../bin/test-capabilities", import.meta.url).pathname;

const buildResult = spawnSync("npm", ["run", "build", "--silent"], {
  encoding: "utf8",
});
assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

function runCli(args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
  });
}

test("CLI test command fails when the config file is missing", () => {
  const result = runCli(["test", "--config", "/tmp/definitely-missing-test-capabilities.yaml"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Config file not found/);
});

test("CLI test command rejects unsupported flags", () => {
  const result = runCli([
    "test",
    "--config",
    new URL("../test-capabilities.yaml", import.meta.url).pathname,
    "--predict",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported option\(s\) for 'test'/);
});

test("unsupported CLI commands fail clearly instead of emitting placeholders", () => {
  const result = runCli(["predict"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported CLI command\(s\): predict/);
});
