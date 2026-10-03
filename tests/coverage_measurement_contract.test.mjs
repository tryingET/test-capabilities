import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import yaml from "js-yaml";
import { collectCoverage } from "../scripts/quality/coverage-ratchet.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);

for (const mode of ["missing", "malformed", "interrupted"]) {
  test(`Given ${mode} detailed coverage evidence, When collection completes, Then no passing measurement is fabricated`, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "coverage-report-refusal-"));
    const original = childProcess.spawnSync;
    try {
      mkdirSync(path.join(dir, "tests"), { recursive: true });
      mkdirSync(path.join(dir, "node_modules/c8/bin"), { recursive: true });
      writeFileSync(path.join(dir, "tests/probe.test.mjs"), "");
      writeFileSync(path.join(dir, "node_modules/c8/bin/c8.js"), "");
      writeFileSync(path.join(dir, "node_modules/c8/package.json"), '{"version":"fixture"}');
      const report = path.join(dir, "coverage");
      childProcess.spawnSync = (command) => {
        if (command === "npm") return { status: 0 };
        const row = { pct: 100, covered: 1, total: 1 };
        writeFileSync(
          path.join(report, "coverage-summary.json"),
          JSON.stringify({
            total: {
              lines: row,
              branches: row,
              functions: row,
            },
          }),
        );
        writeFileSync(
          path.join(report, "lcov.info"),
          `TN:\nSF:${dir}/src/probe.ts\nDA:1,1\nend_of_record\n`,
        );
        if (mode === "malformed") writeFileSync(path.join(report, "coverage-final.json"), "[]");
        return mode === "interrupted"
          ? { status: null, stdout: "", stderr: "controlled interrupted collector" }
          : { status: 0, stdout: "# tests 1\n# pass 1\n# fail 0\n# skipped 0\n", stderr: "" };
      };
      syncBuiltinESMExports();
      assert.throws(
        () => collectCoverage({ root: dir, baseline: {}, reportDir: report }),
        /report|function|test run|coverage/i,
      );
    } finally {
      childProcess.spawnSync = original;
      syncBuiltinESMExports();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("Given inherited compile-cache settings, When the coverage collector launches c8, Then only measurement disables cache through descendants", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "coverage-measurement-contract-"));
  const originalSpawn = childProcess.spawnSync;
  const previousDisable = process.env.NODE_DISABLE_COMPILE_CACHE;
  const previousCache = process.env.NODE_COMPILE_CACHE;
  let measuredEnv;
  try {
    mkdirSync(path.join(dir, "tests"), { recursive: true });
    mkdirSync(path.join(dir, "node_modules/c8/bin"), { recursive: true });
    writeFileSync(path.join(dir, "tests/probe.test.mjs"), "");
    writeFileSync(path.join(dir, "node_modules/c8/bin/c8.js"), "");
    writeFileSync(path.join(dir, "node_modules/c8/package.json"), '{"version":"fixture"}');
    const report = path.join(dir, "coverage");
    process.env.NODE_COMPILE_CACHE = path.join(dir, "compile-cache");
    process.env.NODE_DISABLE_COMPILE_CACHE = "0";
    childProcess.spawnSync = (command, args, options) => {
      if (command === "npm") return { status: 0, stdout: "", stderr: "" };
      measuredEnv = options.env;
      const row = { pct: 100, covered: 1, total: 1 };
      writeFileSync(
        path.join(report, "coverage-summary.json"),
        JSON.stringify({
          total: { lines: row, branches: row, functions: row },
        }),
      );
      writeFileSync(
        path.join(report, "lcov.info"),
        `TN:\nSF:${dir}/src/probe.ts\nDA:1,1\nend_of_record\n`,
      );
      assert.ok(args.includes("--all"), "unloaded functions remain part of the ratchet");
      writeFileSync(
        path.join(report, "coverage-final.json"),
        JSON.stringify({
          [path.join(dir, "src/probe.ts")]: { fnMap: { 0: { name: "observed" } }, f: { 0: 1 } },
        }),
      );
      assert.ok(
        args.includes("--reporter=json"),
        "retain per-function evidence for failed hosted runs",
      );
      return { status: 0, stdout: "# tests 1\n# pass 1\n# fail 0\n# skipped 0\n", stderr: "" };
    };
    syncBuiltinESMExports();
    collectCoverage({ root: dir, baseline: {}, reportDir: report });
    assert.equal(measuredEnv.NODE_DISABLE_COMPILE_CACHE, "1");
    assert.equal(
      measuredEnv.NODE_COMPILE_CACHE,
      process.env.NODE_COMPILE_CACHE,
      "measurement disables reuse; it does not delete cache or change ordinary runtime settings",
    );
    assert.equal(process.env.NODE_DISABLE_COMPILE_CACHE, "0", "parent environment untouched");
  } finally {
    childProcess.spawnSync = originalSpawn;
    syncBuiltinESMExports();
    if (previousDisable === undefined) delete process.env.NODE_DISABLE_COMPILE_CACHE;
    else process.env.NODE_DISABLE_COMPILE_CACHE = previousDisable;
    if (previousCache === undefined) delete process.env.NODE_COMPILE_CACHE;
    else process.env.NODE_COMPILE_CACHE = previousCache;
  }
  try {
    const probe = path.join(dir, "probe.mjs");
    writeFileSync(
      probe,
      `import { enableCompileCache, constants } from 'node:module';
      console.log(JSON.stringify({ status: enableCompileCache().status,
        disabled: constants.compileCacheStatus.DISABLED }));`,
    );
    const actual = spawnSync(process.execPath, [probe], { env: measuredEnv, encoding: "utf8" });
    assert.equal(actual.status, 0, actual.stderr);
    const result = JSON.parse(actual.stdout);
    assert.equal(
      result.status,
      result.disabled,
      "actual Node honors collector's inherited disabling flag",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Given a failed hosted measurement, When CI retains evidence, Then summary and per-function reports remain available without bypassing failure", () => {
  const ci = yaml.load(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
  for (const job of Object.values(ci.jobs)) {
    const upload = job.steps.find((step) => step.name === "Retain coverage measurement evidence");
    assert.ok(upload, "every measured lane retains failure evidence");
    assert.equal(upload.if, "always()");
    assert.match(upload.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/);
    for (const filename of ["coverage-summary.json", "coverage-final.json", "lcov.info"]) {
      assert.ok(upload.with.path.includes(`coverage/${filename}`));
    }
    assert.equal(upload.with["if-no-files-found"], "warn");
    assert.equal(
      upload["continue-on-error"],
      undefined,
      "coverage floor still controls job status",
    );
  }
});
