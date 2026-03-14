import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";

const binPath = new URL("../bin/test-capabilities", import.meta.url).pathname;

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

test("CLI test command rejects URL overrides when no supported web consumer is enabled", () => {
  const result = runCli([
    "test",
    "--config",
    new URL("../test-capabilities.yaml", import.meta.url).pathname,
    "--target",
    "https://example.com",
    "--quick",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /URL targets for 'test' require a real web-consuming runtime path/,
  );
});

test("CLI surf explore rejects flags that are not wired to runtime behavior", () => {
  const result = runCli(["surf", "explore", "--url", "https://example.com", "--record"]);

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Unsupported option\(s\) for 'surf explore': --record/,
  );
});

test("CLI surf command rejects unknown actions with a contract error", () => {
  const result = runCli(["surf", "typo", "--url", "https://example.com"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported surf action\(s\): typo/);
});

test("CLI quantum command rejects invalid branch counts", () => {
  const result = runCli(["quantum", "--target", "https://example.com", "--branches", "0"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Invalid value for --branches: 0/);
});

test("CLI heal command fails closed when the target directory is missing", () => {
  const result = runCli(["heal", "--dir", "/tmp/definitely-missing-heal-dir"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Heal directory not found:/);
});

test("unsupported CLI commands fail clearly instead of emitting placeholders", () => {
  const result = runCli(["predict"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported CLI command\(s\): predict/);
});
