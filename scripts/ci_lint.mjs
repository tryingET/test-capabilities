import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function ensureNode20() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`Node >=20 is required, found ${process.version}`);
  }
}

function collectMjsFiles(rootDir) {
  const files = [];

  function walk(currentDir) {
    for (const entry of readdirSync(currentDir)) {
      const fullPath = path.join(currentDir, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (fullPath.endsWith(".mjs")) {
        files.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return files.sort();
}

function syntaxCheck(filePath) {
  const result = spawnSync(process.execPath, ["--check", filePath], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Syntax check failed: ${filePath}`);
  }
}

function main() {
  ensureNode20();

  const scanRoots = ["src", "scripts", "tests"];
  const mjsFiles = scanRoots.flatMap((root) => collectMjsFiles(root));

  if (mjsFiles.length === 0) {
    throw new Error("No .mjs files found under src/, scripts/, tests/");
  }

  for (const filePath of mjsFiles) {
    syntaxCheck(filePath);
  }

  process.stdout.write(`ok: lint (${mjsFiles.length} files)\n`);
}

main();
