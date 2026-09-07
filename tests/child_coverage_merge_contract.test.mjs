import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveRuntimeDistRoot, runtimeEnv } from "./helpers/runtime-dist.mjs";

// Acceptance for the child-process-only runtime module (adjudication claim 42):
// test-operation.js runs only inside CLI child processes, so a coverage floor
// is meaningful only if a child inherits NODE_V8_COVERAGE and leaves hits the
// parent's report can merge. This test proves that mechanism directly.

const binPath = fileURLToPath(new URL("../bin/test-capabilities", import.meta.url));
const childOnlyModule = path.join(
  resolveRuntimeDistRoot(),
  "core",
  "operations",
  "test-operation.js",
);

function readCoverageEntries(coverageDir) {
  const entries = [];
  for (const name of readdirSync(coverageDir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const payload = JSON.parse(readFileSync(path.join(coverageDir, name), "utf8"));
    for (const scriptCoverage of payload.result ?? []) {
      if (!scriptCoverage.url?.startsWith("file://")) {
        continue;
      }
      entries.push({
        file: fileURLToPath(scriptCoverage.url),
        functions: scriptCoverage.functions ?? [],
      });
    }
  }
  return entries;
}

test("a CLI child run under NODE_V8_COVERAGE leaves hits for the child-only test-operation module", () => {
  const coverageDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-child-coverage-"));
  const noSurfHome = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-no-surf-home-"));

  try {
    const result = spawnSync(
      process.execPath,
      [binPath, "test", "--config", "examples/demo/test-capabilities.yaml", "--json"],
      {
        encoding: "utf8",
        env: runtimeEnv({
          NODE_V8_COVERAGE: coverageDir,
          PATH: path.dirname(process.execPath),
          TEST_CAPABILITIES_SURF_BIN: "",
          HOME: noSurfHome,
          TEST_CAPABILITIES_BOMBADIL_BIN: "",
          TEST_CAPABILITIES_BOMBADIL_REPO: "",
        }),
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).operationId, "test");

    const entries = readCoverageEntries(coverageDir);
    assert.ok(entries.length > 0, "the child process wrote no V8 coverage file");

    const childOnly = entries.filter((entry) => entry.file === childOnlyModule);
    assert.ok(
      childOnly.length > 0,
      `no coverage entry for ${childOnlyModule}; files seen: ${[...new Set(entries.map((entry) => entry.file))].join(", ")}`,
    );

    // runTestOperation is the executor the CLI route dispatches to; a hit
    // count on it (not only on the module's top level) proves the child's
    // precise coverage reaches the parent's NODE_V8_COVERAGE directory.
    const executed = childOnly.flatMap((entry) =>
      entry.functions.filter(
        (fn) => fn.functionName === "runTestOperation" && fn.ranges?.[0]?.count > 0,
      ),
    );
    assert.ok(
      executed.length > 0,
      `runTestOperation was loaded but never counted as executed in the child's coverage: ${JSON.stringify(
        childOnly.flatMap((entry) =>
          entry.functions.map((fn) => [fn.functionName, fn.ranges?.[0]?.count]),
        ),
      )}`,
    );
  } finally {
    rmSync(coverageDir, { recursive: true, force: true });
    rmSync(noSurfHome, { recursive: true, force: true });
  }
});

test("dist/ is self-consistent about source maps: a map file exists exactly for the modules that reference one", () => {
  // The default build emits no sourceMappingURL comment and no map; the
  // TEST_CAPABILITIES_BUILD_SOURCEMAP=1 build emits both. Either way the two
  // must agree, so a coverage build can be remapped and a default build never
  // carries a dangling reference. The npm pack never contains a map
  // (scripts/consumer_contract_smoke.mjs asserts it on the packed file list).
  const operationsDir = path.join(resolveRuntimeDistRoot(), "core", "operations");
  const entries = readdirSync(operationsDir);
  const scripts = entries.filter((name) => name.endsWith(".js"));
  const maps = new Set(entries.filter((name) => name.endsWith(".js.map")));
  assert.ok(scripts.length > 0, "no built operation modules found");
  for (const script of scripts) {
    const source = readFileSync(path.join(operationsDir, script), "utf8");
    const referencesMap = /\/\/# sourceMappingURL=/.test(source);
    assert.equal(
      maps.has(`${script}.map`),
      referencesMap,
      `${script}: sourceMappingURL comment (${referencesMap}) and map file (${maps.has(`${script}.map`)}) disagree`,
    );
  }
});
