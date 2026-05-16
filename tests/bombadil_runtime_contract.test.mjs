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
      resolution.resolutionNotes.some((note) => note.includes("no longer requires esbuild")),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runBombadil forwards Bombadil 0.5 web options fail-closed", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-options-"));
  const fakeBinary = path.join(tempDir, "bombadil");
  writeExecutable(
    fakeBinary,
    "#!/bin/sh\necho 'starting test' >&2\necho \"args: $*\" >&2\nexit 0\n",
  );

  try {
    const result = await runBombadil({
      origin: "https://example.com",
      durationMs: 50,
      env: {
        TEST_CAPABILITIES_BOMBADIL_BIN: fakeBinary,
      },
      options: {
        outputPath: path.join(tempDir, "trace-output"),
        headers: {
          Authorization: "Bearer test-token",
          "X-Test-Capabilities": "bombadil-0.5",
        },
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        instrumentJavaScript: ["files"],
        chromeGrantPermissions: ["local-network-access"],
        noSandbox: true,
      },
    });

    assert.equal(result.status, "completed");
    assert.deepEqual(result.command.slice(1), [
      "test",
      "--output-path",
      path.join(tempDir, "trace-output"),
      "--header",
      "Authorization=Bearer test-token",
      "--header",
      "X-Test-Capabilities=bombadil-0.5",
      "--width",
      "1280",
      "--height",
      "720",
      "--device-scale-factor",
      "1",
      "--instrument-javascript",
      "files",
      "--chrome-grant-permissions",
      "local-network-access",
      "--exit-on-violation",
      "--headless",
      "--no-sandbox",
      "https://example.com",
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runBombadil supports Bombadil 0.5 trace reproduction without exit-on-violation", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-reproduce-"));
  const fakeBinary = path.join(tempDir, "bombadil");
  const traceFile = path.join(tempDir, "trace.jsonl");
  writeExecutable(fakeBinary, "#!/bin/sh\necho 'starting test' >&2\nexit 0\n");
  writeFileSync(traceFile, "{}\n", "utf8");

  try {
    const result = await runBombadil({
      origin: "https://example.com",
      durationMs: 50,
      env: {
        TEST_CAPABILITIES_BOMBADIL_BIN: fakeBinary,
      },
      options: {
        reproduceTracePath: traceFile,
      },
    });

    assert.equal(result.status, "completed");
    assert.deepEqual(result.command.slice(1), [
      "test",
      "--reproduce",
      traceFile,
      "--headless",
      "https://example.com",
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runBombadil rejects no-op binaries that exit successfully without Bombadil evidence", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-noop-"));
  const noopBinary = path.join(tempDir, "bombadil");
  writeExecutable(noopBinary, "#!/bin/sh\nexit 0\n");

  try {
    const result = await runBombadil({
      origin: "https://example.com",
      durationMs: 50,
      env: {
        TEST_CAPABILITIES_BOMBADIL_BIN: noopBinary,
      },
    });

    assert.equal(result.status, "runtime_error");
    assert.equal(result.binaryProvider, "explicit_bin");
    assert.equal(result.exitCode, 0);
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
    assert.equal(result.stderr.includes("no longer requires esbuild"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
