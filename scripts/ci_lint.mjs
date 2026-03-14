import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function ensureNode22() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 22) {
    throw new Error(`Node >=22 is required, found ${process.version}`);
  }
}

function shouldSyntaxCheck(fullPath) {
  return fullPath.endsWith(".mjs") || fullPath.endsWith(".js");
}

function collectSyntaxFiles(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const files = [];

  function walk(currentDir) {
    for (const entry of readdirSync(currentDir)) {
      const fullPath = path.join(currentDir, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (shouldSyntaxCheck(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return files;
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
  ensureNode22();

  const scanRoots = ["scripts", "tests"];
  const syntaxFiles = scanRoots.flatMap((root) => collectSyntaxFiles(root));
  const explicitFiles = ["bin/test-capabilities"].filter((filePath) => existsSync(filePath));
  const files = [...new Set([...syntaxFiles, ...explicitFiles])].sort();

  if (files.length === 0) {
    throw new Error("No syntax-checkable files found under scripts/, tests/, or bin/");
  }

  for (const filePath of files) {
    syntaxCheck(filePath);
  }

  process.stdout.write(`ok: lint (${files.length} files)\n`);
}

main();
