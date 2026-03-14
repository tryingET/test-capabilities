import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("baseline: node22 + required scripts are present", () => {
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines?.node, ">=22");
  assert.equal(pkg.main, "./dist/index.js");
  assert.equal(pkg.types, "./dist/index.d.ts");
  assert.equal(pkg.exports?.["."]?.import, "./dist/index.js");
  assert.equal(pkg.bin?.["test-capabilities"], "./bin/test-capabilities");

  assert.equal(typeof pkg.scripts?.lint, "string");
  assert.equal(typeof pkg.scripts?.test, "string");
  assert.equal(typeof pkg.scripts?.["test:ci-targeted"], "string");
  assert.equal(typeof pkg.scripts?.["test:runtime"], "string");
  assert.equal(typeof pkg.scripts?.["consumer:smoke"], "string");
  assert.equal(typeof pkg.scripts?.["release:check"], "string");
  assert.equal(typeof pkg.scripts?.["release:check:quick"], "string");
  assert.equal(typeof pkg.scripts?.["capability:drill"], "string");
  assert.equal(typeof pkg.scripts?.["capability:passport"], "string");
  assert.equal(typeof pkg.scripts?.prepack, "string");
});
