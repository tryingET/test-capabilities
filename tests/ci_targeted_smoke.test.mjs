import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function typecheckCommandArgs(repoRoot, extraArgs) {
  const tsgoEntrypoint = path.join(
    repoRoot,
    "node_modules",
    "@typescript",
    "native-preview",
    "bin",
    "tsgo.js",
  );
  assert.equal(existsSync(tsgoEntrypoint), true, "tsgo must be installed for type fixtures");
  return [process.execPath, [tsgoEntrypoint, "--ignoreConfig", ...extraArgs]];
}

test("packed type entrypoint accepts documented propagation topology input shapes", () => {
  const repoRoot = new URL("..", import.meta.url).pathname;
  const tempRoot = path.join(repoRoot, ".tmp");
  mkdirSync(tempRoot, { recursive: true });
  const tempDir = mkdtempSync(path.join(tempRoot, "test-capabilities-types-"));
  const fixture = path.join(tempDir, "consumer.ts");
  writeFileSync(
    fixture,
    [
      'import { createTestCapabilities } from "../../dist/index.js";',
      'import type { IntelligenceConfig, PropagationEdge, PropagationTopology, TestCapabilitiesConfig } from "../../dist/index.js";',
      'const edge: PropagationEdge = { upstream: "api", downstream: "web" };',
      "const topology: PropagationTopology = { edges: [edge] };",
      "const intelligence: IntelligenceConfig = { correlation: true, propagationTopology: topology };",
      'const config: TestCapabilitiesConfig = { version: "2.0", name: "typed", targets: { cli: "node" }, agents: { cli: { type: "cli-tester" } }, intelligence };',
      "createTestCapabilities(config);",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const [typecheckCommand, typecheckArgs] = typecheckCommandArgs(repoRoot, [
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--skipLibCheck",
      fixture,
    ]);
    const result = spawnSync(typecheckCommand, typecheckArgs, {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("baseline: node22 + required scripts are present", () => {
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines?.node, ">=22");
  assert.equal(pkg.main, "./dist/index.js");
  assert.equal(pkg.types, "./dist/index.d.ts");
  assert.equal(pkg.exports?.["."]?.import, "./dist/index.js");
  assert.equal(pkg.exports?.["."]?.default, "./dist/index.js");
  assert.equal(pkg.exports?.["."]?.types, "./dist/index.d.ts");
  assert.equal(pkg.bin?.["test-capabilities"], "./bin/test-capabilities");
  assert.deepEqual(pkg.files, ["bin/", "dist/", "README.md", "test-capabilities.yaml"]);

  assert.equal(typeof pkg.scripts?.lint, "string");
  assert.equal(typeof pkg.scripts?.test, "string");
  assert.equal(typeof pkg.scripts?.["test:ci-targeted"], "string");
  assert.equal(typeof pkg.scripts?.["test:runtime"], "string");
  assert.equal(typeof pkg.scripts?.["typecheck:fallback"], "undefined");
  assert.equal(pkg.devDependencies?.typescript, undefined);
  assert.equal(typeof pkg.devDependencies?.["@typescript/native-preview"], "string");
  assert.equal(typeof pkg.scripts?.["consumer:smoke"], "string");
  assert.equal(typeof pkg.scripts?.["release:check"], "string");
  assert.equal(typeof pkg.scripts?.["release:check:quick"], "string");
  assert.equal(typeof pkg.scripts?.["capability:drill"], "string");
  assert.equal(typeof pkg.scripts?.["bombadil:smoke"], "string");
  assert.equal(typeof pkg.scripts?.["capability:passport"], "string");
  assert.equal(typeof pkg.scripts?.prepack, "string");
});
