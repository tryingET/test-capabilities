import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;
const srcRoot = path.join(repoRoot, "src");

/** The one module allowed to start a process. */
const TRANSPORT = "src/core/spawn-step.ts";

// A bare call, never a method call (`pattern.exec(...)` is a regexp, not a process).
const PROCESS_CALL = /(?<![.\w$])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/;
const CHILD_PROCESS_IMPORT = /from\s+"node:child_process"|require\(\s*"node:child_process"\s*\)/;

function listSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listSourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

test("only the kernel spawn transport imports node:child_process", () => {
  const offenders = listSourceFiles(srcRoot)
    .filter((file) => CHILD_PROCESS_IMPORT.test(readFileSync(file, "utf8")))
    .map(relative);

  assert.deepEqual(
    offenders,
    [TRANSPORT],
    `node:child_process must be imported by ${TRANSPORT} only; every other caller goes through Adapter.invoke`,
  );
});

test("no module outside the spawn transport calls a process-starting function", () => {
  const offenders = [];
  for (const file of listSourceFiles(srcRoot)) {
    const name = relative(file);
    if (name === TRANSPORT) {
      continue;
    }
    // Comments are prose about processes, not processes.
    const lines = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""));
    for (const [index, line] of lines.entries()) {
      if (PROCESS_CALL.test(line)) {
        offenders.push(`${name}:${index + 1}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a process may only be started by src/core/spawn-step.ts; route the call through the adapter's invoke",
  );
});

test("the spawn transport is reachable from the adapters and from nothing else", () => {
  const importers = listSourceFiles(srcRoot)
    .filter((file) => /from\s+"\.[^"]*spawn-step\.js"/.test(readFileSync(file, "utf8")))
    .map(relative)
    .sort();

  assert.deepEqual(importers, [
    "src/core/bombadil-runtime.ts",
    "src/core/cli-adapter.ts",
    "src/core/surf-adapter.ts",
  ]);
});
