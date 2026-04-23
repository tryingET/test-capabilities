import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { resolveBombadilBinaryResolution, runBombadil } = await importRuntimeModule(
  "core/bombadil-runtime.js",
);

function writeExecutable(filePath, script = "#!/bin/sh\nexit 0\n") {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, script, { mode: 0o755 });
}

test("explicit Bombadil binary env wins over all other providers", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-resolution-"));
  const explicitBinary = path.join(tempDir, "custom-bombadil");
  const packageRoot = path.join(tempDir, "softwareco", "owned", "test-capabilities");
  const vendoredBinary = path.join(packageRoot, "external", "bombadil");
  const contribBinary = path.join(
    tempDir,
    "softwareco",
    "contrib",
    "bombadil",
    "target",
    "release",
    "bombadil",
  );

  writeExecutable(explicitBinary);
  writeExecutable(vendoredBinary);
  writeExecutable(contribBinary);

  try {
    const resolution = resolveBombadilBinaryResolution({
      TEST_CAPABILITIES_BOMBADIL_BIN: explicitBinary,
      TEST_CAPABILITIES_PACKAGE_ROOT: packageRoot,
    });

    assert.equal(resolution.provider, "explicit_bin");
    assert.equal(resolution.binaryPath, explicitBinary);
    assert.deepEqual(resolution.resolutionNotes, []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("explicit Bombadil repo env resolves built release/debug binaries", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-repo-"));
  const repoRoot = path.join(tempDir, "bombadil");
  const debugBinary = path.join(repoRoot, "target", "debug", "bombadil");

  writeExecutable(debugBinary);

  try {
    const resolution = resolveBombadilBinaryResolution({
      TEST_CAPABILITIES_BOMBADIL_REPO: repoRoot,
    });

    assert.equal(resolution.provider, "explicit_repo_build");
    assert.equal(resolution.binaryPath, debugBinary);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workspace contrib Bombadil build is preferred over vendored binary", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-workspace-"));
  const packageRoot = path.join(tempDir, "softwareco", "owned", "test-capabilities");
  const vendoredBinary = path.join(packageRoot, "external", "bombadil");
  const contribBinary = path.join(
    tempDir,
    "softwareco",
    "contrib",
    "bombadil",
    "target",
    "release",
    "bombadil",
  );

  writeExecutable(vendoredBinary);
  writeExecutable(contribBinary);

  try {
    const resolution = resolveBombadilBinaryResolution({
      TEST_CAPABILITIES_PACKAGE_ROOT: packageRoot,
    });

    assert.equal(resolution.provider, "workspace_contrib_build");
    assert.equal(resolution.binaryPath, contribBinary);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workspace contrib Bombadil checkout without a build falls back to vendored binary with guidance", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-fallback-"));
  const packageRoot = path.join(tempDir, "softwareco", "owned", "test-capabilities");
  const vendoredBinary = path.join(packageRoot, "external", "bombadil");
  const contribRepo = path.join(tempDir, "softwareco", "contrib", "bombadil");

  mkdirSync(contribRepo, { recursive: true });
  writeExecutable(vendoredBinary);

  try {
    const resolution = resolveBombadilBinaryResolution({
      TEST_CAPABILITIES_PACKAGE_ROOT: packageRoot,
    });

    assert.equal(resolution.provider, "vendored");
    assert.equal(resolution.binaryPath, vendoredBinary);
    assert.equal(
      resolution.resolutionNotes.some((note) =>
        note.includes("Workspace contrib Bombadil checkout"),
      ),
      true,
    );
    assert.equal(
      resolution.resolutionNotes.some((note) => note.includes("trunk")),
      true,
    );
    assert.equal(
      resolution.resolutionNotes.some((note) => note.includes("esbuild")),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runBombadil surfaces missing-build guidance when TEST_CAPABILITIES_BOMBADIL_REPO points at an unbuilt checkout", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-run-"));
  const repoRoot = path.join(tempDir, "bombadil");
  mkdirSync(repoRoot, { recursive: true });

  try {
    const result = await runBombadil({
      origin: "https://example.com",
      durationMs: 50,
      env: {
        TEST_CAPABILITIES_BOMBADIL_REPO: repoRoot,
      },
    });

    assert.equal(result.status, "runtime_error");
    assert.equal(result.binaryProvider, "vendored");
    assert.equal(result.stderr.includes("Build Bombadil first"), true);
    assert.equal(result.stderr.includes("trunk"), true);
    assert.equal(result.stderr.includes("esbuild"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
