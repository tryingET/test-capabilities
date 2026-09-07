import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { resolveRuntimeDistRoot, runtimeEnv } from "./helpers/runtime-dist.mjs";

// Regression for adjudication fact 1: importing dispatch.js first in a fresh
// process threw "Cannot access 'CLI_ROUTE_MANIFEST' before initialization"
// because of the capabilities -> operations -> dispatch -> demo ->
// orchestrator -> capabilities cycle. Every runtime module under dist/ must be
// importable as the first import of a fresh process.

const distRoot = resolveRuntimeDistRoot();

function listRuntimeModules(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listRuntimeModules(full));
    } else if (entry.endsWith(".js")) {
      files.push(full);
    }
  }
  return files.sort();
}

function importFirstInFreshProcess(modulePath) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(modulePath).href)});`,
      ],
      { env: runtimeEnv(), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ modulePath, code, stderr }));
  });
}

test("dispatch.js imports cleanly as the first import of a fresh process (no TDZ on CLI_ROUTE_MANIFEST)", async () => {
  const result = await importFirstInFreshProcess(
    path.join(distRoot, "core", "operations", "dispatch.js"),
  );
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /before initialization/);
});

test("every runtime module under dist/ imports cleanly as the first import of a fresh process", async () => {
  const modules = listRuntimeModules(distRoot);
  assert.ok(modules.length > 20, `unexpectedly few runtime modules: ${modules.length}`);
  const results = await Promise.all(modules.map(importFirstInFreshProcess));
  const failures = results.filter((result) => result.code !== 0);
  assert.deepEqual(
    failures.map(
      (result) => `${path.relative(distRoot, result.modulePath)}: ${result.stderr.trim()}`,
    ),
    [],
  );
});

test("capability-matrix.js and config.js are leaves that import nothing under operations/", () => {
  for (const leaf of ["capability-matrix.js", "config.js"]) {
    const source = readFileSync(path.join(distRoot, "core", leaf), "utf8");
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    assert.ok(specifiers.length > 0, `${leaf} has no imports to check`);
    assert.deepEqual(
      specifiers.filter((specifier) => /(^|\/)operations(\/|\.js$)/.test(specifier)),
      [],
      `${leaf} must not import operations/`,
    );
    assert.doesNotMatch(source, /orchestrator\.js/, `${leaf} must not import the orchestrator`);
  }
});
