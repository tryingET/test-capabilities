import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { collectFiles } = await importRuntimeModule("healing/collect-files-core.js");

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
