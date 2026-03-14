import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function load(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("CLI docs reflect the fail-closed capability contract", () => {
  const cliDoc = load("docs/api/cli.md");

  assert.match(cliDoc, /Runtime capability summary/);
  assert.match(cliDoc, /`predict` \| unsupported/);
  assert.match(cliDoc, /`surf explore` \| implemented/);
  assert.doesNotMatch(cliDoc, /Run ML-powered failure prediction/);
});

test("getting-started docs no longer advertise unsupported autonomous flags as runnable examples", () => {
  const gettingStartedDoc = load("docs/api/getting-started.md");

  assert.match(gettingStartedDoc, /Node\.js 22\+/);
  assert.doesNotMatch(gettingStartedDoc, /test-capabilities test .*--autonomous/);
  assert.doesNotMatch(gettingStartedDoc, /Health Score: 94/);
});

test("config docs show the strict fail-closed surface instead of legacy top-level sections", () => {
  const configDoc = load("docs/api/config.md");

  assert.match(configDoc, /Rejected top-level keys/);
  assert.doesNotMatch(configDoc, /^reporting:/m);
  assert.doesNotMatch(configDoc, /^alerts:/m);
  assert.doesNotMatch(configDoc, /^execution:/m);
});
