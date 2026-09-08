import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runtimeEnv } from "./helpers/runtime-dist.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const nodeOnlyPath = path.dirname(process.execPath);

function runTruthGate({ requireAkDirection, pathOverride = nodeOnlyPath }) {
  return spawnSync(process.execPath, ["./scripts/capability-truth-gate.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...runtimeEnv(),
      PATH: pathOverride,
      TEST_CAPABILITIES_REQUIRE_AK_DIRECTION: requireAkDirection ? "1" : "0",
    },
  });
}

function withFakeAk(scriptBody, callback) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-fake-ak-"));
  const akPath = path.join(tempDir, "ak");
  writeFileSync(akPath, scriptBody, { mode: 0o755 });
  try {
    return callback(`${tempDir}${path.delimiter}${nodeOnlyPath}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test("portable truth gate does not require workstation AK direction state", () => {
  const result = runTruthGate({ requireAkDirection: false });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /AK direction check skipped/);
  assert.match(result.stdout, /capability-truth-gate: ok/);
});

test("portable truth gate skips mismatched AK direction output", () => {
  const result = withFakeAk("#!/bin/sh\nexit 0\n", (pathOverride) =>
    runTruthGate({ requireAkDirection: false, pathOverride }),
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /AK direction check skipped \(portable mode\)/);
  assert.match(result.stdout, /capability-truth-gate: ok/);
});

test("local truth gate can require workstation AK direction state", () => {
  const result = runTruthGate({ requireAkDirection: true });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /AK direction check is required/);
});

test("local truth gate rejects mismatched AK direction output", () => {
  const result = withFakeAk("#!/bin/sh\nexit 0\n", (pathOverride) =>
    runTruthGate({ requireAkDirection: true, pathOverride }),
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /AK direction should keep SF1 active/);
});

// ---------------------------------------------------------------------------
// Slice S8: the overclaim grep, re-read against the frame vocabulary (review A15)
// ---------------------------------------------------------------------------

const { CAUSALITY_OVERCLAIM_PATTERN } = await import("../scripts/capability-truth-gate.mjs");

test("the overclaim grep still catches a causal claim written about a frame boundary", () => {
  // The guard fixture: S8 adds a failure class named `frame_boundary` and a determination named
  // `confirmed`, and the risk is that "confirmed" invites prose that claims a cause the run
  // never established. Each of these would be that mistake, and the gate's own pattern catches
  // each one.
  for (const sentence of [
    "A confirmed frame_boundary is the likely caused failure on this page.",
    "frame_boundary establishes a plausible causal link between the frame and the miss.",
    "A suspected determination gives a plausible causal mechanism for the selector miss.",
    "The frame boundary cascades into the selector failure downstream.",
    "Repair the frame boundary first, then rerun the suite.",
  ]) {
    assert.match(sentence, CAUSALITY_OVERCLAIM_PATTERN, sentence);
  }
});

test("the vocabulary the frame slice actually ships is not an overclaim", () => {
  for (const sentence of [
    "determination=confirmed means the hint resolved to exactly one reachable candidate.",
    "frame_boundary is a test-defect locus: the repair is a structural change to the step.",
    "A suspected determination is reported as browser_coverage_gap with the diagnosis attached.",
    "The presence of a frame on the page is not evidence that this selector targeted it.",
  ]) {
    assert.doesNotMatch(sentence, CAUSALITY_OVERCLAIM_PATTERN, sentence);
  }
});
