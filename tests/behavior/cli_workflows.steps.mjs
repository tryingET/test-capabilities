import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { After, Before, Given, setDefaultTimeout, Then, When } from "@cucumber/cucumber";

setDefaultTimeout(20_000);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliEntrypoint = path.join(repoRoot, "bin", "test-capabilities");

function normalizeOutput(value) {
  return value.replace(/\r/g, "\n");
}

Before(function () {
  this.tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bdd-"));
  this.cwd = this.tempDir;
  this.env = { ...process.env };
  this.runResult = undefined;
});

After(function () {
  if (this.tempDir) {
    rmSync(this.tempDir, { recursive: true, force: true });
  }
});

Given("the docs file {string} contains {string}", (relativePath, snippet) => {
  const text = readFileSync(path.join(repoRoot, relativePath), "utf8");
  assert.equal(text.includes(snippet), true, `Expected ${relativePath} to include: ${snippet}`);
});

Given(
  "a temporary config file named {string} targets the CLI command {string}",
  function (filename, cliTarget) {
    const configText = `version: '2.0'
name: 'Behavior CLI Smoke'

targets:
  cli: '${cliTarget}'

agents:
  cli:
    enabled: true
    type: cli-tester
    intensity: normal

intelligence:
  self_healing: false
  prediction: false
  correlation: true
  collective: false

quantum:
  enabled: false

chaos:
  enabled: false
`;

    writeFileSync(path.join(this.cwd, filename), configText, "utf8");
  },
);

Given("a fake surf executable is on PATH that prints:", function (scriptBody) {
  const binDir = path.join(this.cwd, "bin");
  mkdirSync(binDir, { recursive: true });
  const surfPath = path.join(binDir, "surf");
  writeFileSync(surfPath, `#!/bin/sh\n${scriptBody.trim()}\n`, { mode: 0o755 });
  this.env.PATH = `${binDir}${path.delimiter}${this.env.PATH ?? ""}`;
});

When("I run the TEST-CAPABILITIES CLI with:", function (dataTable) {
  const args = dataTable
    .raw()
    .flat()
    .map((value) => value.trim())
    .filter(Boolean);
  const result = spawnSync(process.execPath, [cliEntrypoint, ...args], {
    cwd: this.cwd,
    env: this.env,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = normalizeOutput(result.stdout ?? "");
  const stderr = normalizeOutput(result.stderr ?? "");

  this.runResult = {
    status: result.status,
    stdout,
    stderr,
    output: `${stdout}\n${stderr}`,
  };
});

Then("the command exits with code {int}", function (expectedCode) {
  assert.ok(this.runResult, "Expected a command to have been run first.");
  assert.equal(this.runResult.status, expectedCode);
});

Then("the combined output contains {string}", function (snippet) {
  assert.ok(this.runResult, "Expected a command to have been run first.");
  assert.equal(
    this.runResult.output.includes(snippet),
    true,
    `Expected combined output to include: ${snippet}\n--- output ---\n${this.runResult.output}`,
  );
});
