import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  assert.equal(
    existsSync(tsgoEntrypoint),
    true,
    "tsgo wrapper must be installed for type fixtures",
  );
  const smoke = spawnSync(process.execPath, [tsgoEntrypoint, "--version"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(
    smoke.status,
    0,
    `tsgo native compiler must be executable for type fixtures. Install optional native dependencies without --omit=optional. ${smoke.stdout}\n${smoke.stderr}`,
  );
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
      'import { ROOT_CAUSE_FAILURE_CLASSES, createTestCapabilities } from "../../dist/index.js";',
      'import type { IntelligenceConfig, ObservationSemantics, PropagationEdge, PropagationTopology, RootCauseFailureClass, TestCapabilitiesConfig } from "../../dist/index.js";',
      'if (!ROOT_CAUSE_FAILURE_CLASSES.includes("auth_or_permission")) throw new Error("missing auth root-cause class");',
      'const failureClass: RootCauseFailureClass = "auth_or_permission";',
      'const semantics: ObservationSemantics = { component: "api", interpretation: "typed", failureClass, propagationLink: "api-latency-cascade" };',
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
  const buildScript = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");

  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines?.node, ">=22");
  assert.equal(pkg.main, "./dist/index.js");
  assert.equal(pkg.types, "./dist/index.d.ts");
  assert.equal(pkg.exports?.["."]?.import, "./dist/index.js");
  assert.equal(pkg.exports?.["."]?.default, "./dist/index.js");
  assert.equal(pkg.exports?.["."]?.types, "./dist/index.d.ts");
  assert.equal(pkg.bin?.["test-capabilities"], "bin/test-capabilities");
  assert.deepEqual(pkg.files, [
    "bin/",
    "dist/",
    "examples/demo/",
    "README.md",
    "test-capabilities.yaml",
  ]);

  assert.equal(typeof pkg.scripts?.lint, "string");
  assert.equal(typeof pkg.scripts?.test, "string");
  assert.match(
    pkg.scripts?.["test:ci-targeted"] ?? "",
    /npm run build --silent && node \.\/scripts\/run_ci_targeted_tests\.mjs/,
  );
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

  const lockedBuildSection = buildScript.slice(
    buildScript.indexOf("try {"),
    buildScript.indexOf("} finally"),
  );

  assert.match(buildScript, /mkdtempSync\(path\.join\(tmpRoot, "build-"\)\)/);
  assert.match(buildScript, /build\.lock/);
  assert.match(buildScript, /randomUUID\(\)/);
  assert.match(buildScript, /readBuildLockOwner\(\)\?\.token === token/);
  assert.doesNotMatch(buildScript, /breakStaleBuildLock/);
  assert.doesNotMatch(buildScript, /isProcessAlive/);
  assert.match(buildScript, /assertSafeGeneratedDirectory\(distDir, "dist"\)/);
  assert.match(buildScript, /TEST_CAPABILITIES_BUILD_DIST_DIR overrides must stay under \.tmp\//);
  assert.match(buildScript, /assertNoSymlinksInside/);
  assert.match(buildScript, /publishDist\(path\.join\(stagingRoot, "dist"\)\)/);
  assert.match(buildScript, /finally\s*\{[\s\S]*releaseLock\?\.\(\);[\s\S]*\}/);
  assert.match(buildScript, /process\.exit\(exitCode\);/);
  assert.doesNotMatch(lockedBuildSection, /process\.exit\(/);
  assert.doesNotMatch(buildScript, /rmSync\(distDir/);
});

function writeBlockingBuildLock(repoRoot) {
  const lockDir = path.join(repoRoot, ".tmp", "build.lock");
  assert.equal(existsSync(lockDir), false, "test fixture must not remove an existing build lock");
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(
    path.join(lockDir, "owner.json"),
    JSON.stringify({ pid: process.pid, token: "other-owner", startedAt: new Date().toISOString() }),
    "utf8",
  );
  return lockDir;
}

test("build fails closed instead of breaking another owner's lock", () => {
  const repoRoot = new URL("..", import.meta.url).pathname;
  const lockDir = writeBlockingBuildLock(repoRoot);

  try {
    const result = spawnSync(process.execPath, ["./scripts/build.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, TEST_CAPABILITIES_BUILD_LOCK_TIMEOUT_MS: "50" },
    });

    assert.notEqual(result.status, 0, "build should fail while another owner holds the lock");
    assert.match(result.stderr, /timed out waiting for another build/);
    assert.equal(existsSync(lockDir), true, "build should not remove another owner's lock");
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
});

test("build refuses to publish through a dist symlink", () => {
  const repoRoot = new URL("..", import.meta.url).pathname;
  const tempRoot = mkdtempSync(path.join(repoRoot, ".tmp", "dist-symlink-test-"));
  const distLink = path.join(tempRoot, "dist-link");
  const symlinkTarget = path.join(tempRoot, "outside-target");
  mkdirSync(symlinkTarget, { recursive: true });
  const marker = path.join(symlinkTarget, "outside-marker.txt");
  writeFileSync(marker, "preserve", "utf8");
  symlinkSync(symlinkTarget, distLink, "dir");

  try {
    const result = spawnSync(process.execPath, ["./scripts/build.mjs"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_CAPABILITIES_BUILD_DIST_DIR: path.relative(repoRoot, distLink),
      },
    });

    assert.notEqual(result.status, 0, "build should fail when dist is a symlink");
    assert.match(result.stderr, /refusing to publish to dist because it is a symbolic link/);
    assert.equal(readFileSync(marker, "utf8"), "preserve");
    assert.equal(existsSync(path.join(repoRoot, "dist", "index.js")), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
