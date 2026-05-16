import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { MAX_HEAL_SOURCE_FILE_BYTES, collectFiles } = await importRuntimeModule(
  "healing/collect-files-core.js",
);

test("collectFiles fails closed when the target directory is missing", () => {
  assert.throws(
    () => collectFiles("/tmp/test-capabilities-definitely-missing-collect-files"),
    /Heal directory not found:/,
  );
});

test("collectFiles fails closed when the target path is not a directory", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-collect-files-file-"));
  const filePath = path.join(dir, "not-a-directory.ts");
  writeFileSync(filePath, "export const fileOnly = true;\n", "utf8");

  try {
    assert.throws(() => collectFiles(filePath), /Heal directory is not a directory:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectFiles rejects a symlink scan root", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-collect-files-root-"));
  const linkPath = `${dir}-link`;

  try {
    symlinkSync(dir, linkPath, "dir");
    assert.throws(() => collectFiles(linkPath), /Heal directory must not be a symlink:/);
  } finally {
    rmSync(linkPath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectFiles rejects symlink entries instead of silently scanning escaped paths", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-collect-files-symlink-"));
  const outsideDir = mkdtempSync(
    path.join(os.tmpdir(), "test-capabilities-collect-files-outside-"),
  );
  const linkPath = path.join(dir, "linked-tests");
  writeFileSync(path.join(outsideDir, "escaped.test.ts"), "export const escaped = true;\n", "utf8");

  try {
    symlinkSync(outsideDir, linkPath, "dir");
    assert.throws(() => collectFiles(dir), /Heal path must not be a symlink:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("collectFiles rejects oversized source candidates before healing reads them", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-collect-files-large-"));
  const filePath = path.join(dir, "huge.test.ts");
  writeFileSync(filePath, `${"x".repeat(MAX_HEAL_SOURCE_FILE_BYTES + 1)}\n`, "utf8");

  try {
    assert.throws(() => collectFiles(dir), /Heal source file exceeds maximum size/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collectFiles ignores generated directories and returns sorted source candidates", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-collect-files-"));
  const nestedDir = path.join(dir, "nested");
  const ignoredDirs = [
    path.join(dir, ".git"),
    path.join(dir, "coverage"),
    path.join(dir, "dist"),
    path.join(dir, "node_modules"),
  ];

  mkdirSync(nestedDir, { recursive: true });
  for (const ignoredDir of ignoredDirs) {
    mkdirSync(ignoredDir, { recursive: true });
  }

  const keepA = path.join(dir, "alpha.ts");
  const keepB = path.join(nestedDir, "beta.mjs");
  const keepC = path.join(nestedDir, "gamma.cts");
  writeFileSync(keepA, "export const alpha = true;\n", "utf8");
  writeFileSync(keepB, "export const beta = true;\n", "utf8");
  writeFileSync(keepC, "export const gamma = true;\n", "utf8");
  writeFileSync(path.join(dir, "readme.md"), "ignore me\n", "utf8");
  writeFileSync(
    path.join(dir, "node_modules", "ignored.ts"),
    "export const ignored = true;\n",
    "utf8",
  );
  writeFileSync(path.join(dir, "dist", "ignored.js"), "export const ignored = true;\n", "utf8");

  try {
    assert.deepEqual(collectFiles(dir), [keepA, keepB, keepC]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
