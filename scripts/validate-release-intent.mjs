#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const releaseTag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? "";
const expectedTag = `v${pkg.version}`;

assert.equal(pkg.name, "test-capabilities", "package name must remain test-capabilities");
assert.notEqual(pkg.private, true, "package must not be private for public release");
assert.equal(pkg.license, "MIT", "license metadata must match the public MIT license pattern");
assert.ok(existsSync(path.join(repoRoot, "LICENSE")), "LICENSE file is required");
assert.equal(pkg.repository?.url, "git+https://github.com/tryingET/test-capabilities.git");
assert.equal(pkg.publishConfig?.access, "public");
assert.equal(pkg.publishConfig?.registry, "https://registry.npmjs.org/");
assert.ok(pkg.bin?.["test-capabilities"], "test-capabilities bin entry is required");
assert.ok(pkg.bin?.tc, "tc bin entry is required");
assert.ok(pkg.exports?.["."], "root package export is required");

if (releaseTag) {
  assert.equal(
    releaseTag,
    expectedTag,
    `release tag must match package version exactly (${expectedTag})`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      packageName: pkg.name,
      version: pkg.version,
      expectedTag,
      releaseTag: releaseTag || undefined,
      publishConfig: pkg.publishConfig,
    },
    null,
    2,
  ),
);
