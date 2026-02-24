import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("baseline: node20 + required scripts are present", () => {
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines?.node, ">=20");

  assert.equal(typeof pkg.scripts?.lint, "string");
  assert.equal(typeof pkg.scripts?.test, "string");
  assert.equal(typeof pkg.scripts?.["test:ci-targeted"], "string");
  assert.equal(typeof pkg.scripts?.["test:runtime"], "string");
});
