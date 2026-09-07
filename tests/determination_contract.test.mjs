import assert from "node:assert/strict";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const {
  countOutcomeBases,
  countOutcomeClasses,
  determineRun,
  DETERMINATION_VALUES,
  outcomeEvidenceLines,
  worstOutcome,
} = await importRuntimeModule("core/determination.js");
const { classifyResult, OUTCOME_BASES, OUTCOME_CLASSES } = await importRuntimeModule(
  "core/result-classification.js",
);

/** A classified outcome with the given basis, built through the real classifier. */
function outcomeWith(basis) {
  switch (basis) {
    case "evidence":
      return classifyResult({ source: "cli", exitCode: 0, stdout: "usage: tool", stderr: "" });
    case "fault":
      return classifyResult({ source: "cli", exitCode: 3, stdout: "", stderr: "boom" });
    case "no_evidence":
      return classifyResult({ source: "cli", exitCode: 0, stdout: "   ", stderr: "" });
    case "contradiction":
      return classifyResult(
        { source: "cli", exitCode: 0, stdout: '{"error":{"code":"x","message":"y"}}', stderr: "" },
        { payload: "json", declaredBy: "config:agents.cli.expect" },
      );
    default:
      return classifyResult({
        source: "surf",
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: true,
        effect: "mutating",
      });
  }
}

test("every basis fixture really classifies to the basis it is named for", () => {
  for (const basis of OUTCOME_BASES) {
    assert.equal(outcomeWith(basis).basis, basis, `fixture for ${basis} drifted`);
  }
});

test("a run with no classified step falls back to the legacy coverage and finding signal", () => {
  const verified = determineRun([], { coverage: 100, blockingFindings: 0 });
  assert.equal(verified.value, "verified");
  assert.equal(verified.basis, "evidence");
  assert.match(verified.reason, /no classified step/);

  const failed = determineRun([], { coverage: 100, blockingFindings: 1 });
  assert.equal(failed.value, "failed");
  assert.equal(failed.basis, "fault");

  const unmeasured = determineRun([], { coverage: 0, blockingFindings: 0 });
  assert.equal(unmeasured.value, "unverified");
  assert.equal(unmeasured.basis, "no_evidence");
});

test("evidence with coverage is the only path to verified", () => {
  const determination = determineRun([outcomeWith("evidence")], {
    coverage: 100,
    blockingFindings: 0,
  });
  assert.equal(determination.value, "verified");
  assert.deepEqual(determination.candidates, ["verified"]);
  assert.match(determination.reason, /Every classified step produced evidence/);
  assert.match(determination.reason, /evidence:1/);

  // The same evidence without measured coverage claims nothing.
  const withoutCoverage = determineRun([outcomeWith("evidence")], {
    coverage: 0,
    blockingFindings: 0,
  });
  assert.equal(withoutCoverage.value, "unverified");
  assert.deepEqual(withoutCoverage.candidates, ["unverified", "verified"]);
});

test("an undeclared empty payload is unverified, never failed", () => {
  const determination = determineRun([outcomeWith("no_evidence")], {
    coverage: 0,
    blockingFindings: 0,
  });
  assert.equal(determination.value, "unverified");
  assert.equal(determination.basis, "no_evidence");
  assert.match(determination.reason, /no evidence either way/);
  assert.doesNotMatch(determination.reason, /evidence of a fault/);
});

test("a self-contradictory reply is unverified with a contradiction basis", () => {
  const determination = determineRun([outcomeWith("contradiction")], { coverage: 0 });
  assert.equal(determination.value, "unverified");
  assert.equal(determination.basis, "contradiction");
});

test("an unknown mutating step is indeterminate and outranks unverified", () => {
  const determination = determineRun([outcomeWith("indeterminate"), outcomeWith("no_evidence")], {
    coverage: 0,
  });
  assert.equal(determination.value, "indeterminate");
  assert.equal(determination.basis, "indeterminate");
  assert.deepEqual(determination.candidates, ["indeterminate", "unverified"]);
  assert.match(determination.reason, /nothing about the target is known/);
});

test("a proven fault outranks an unknown effect and keeps both visible", () => {
  // Peer consultation, slice S4: fail-closed means refusing to claim success without proof,
  // not weakening a proof of failure into uncertainty.
  const determination = determineRun([outcomeWith("fault"), outcomeWith("indeterminate")], {
    coverage: 0,
  });
  assert.equal(determination.value, "failed");
  assert.equal(determination.basis, "fault");
  assert.deepEqual(determination.candidates, ["failed", "indeterminate", "unverified"]);
  assert.match(determination.reason, /fault:1/);
  assert.match(determination.reason, /indeterminate:1/);
});

test("declarations in force are named in the reason and never change the value", () => {
  const expectations = [
    { output: "empty", declaredBy: "operation:surf.explore.links" },
    { output: "empty", declaredBy: "config:agents.cli-smoke.expect" },
  ];
  const withDeclarations = determineRun([outcomeWith("evidence")], {
    coverage: 100,
    expectations,
  });
  const without = determineRun([outcomeWith("evidence")], { coverage: 100 });
  assert.equal(withDeclarations.value, without.value);
  assert.match(
    withDeclarations.reason,
    /declarations: config:agents\.cli-smoke\.expect, operation:surf\.explore\.links\./,
  );
  assert.doesNotMatch(without.reason, /declarations:/);
});

test("the value set is closed and every value is reachable", () => {
  assert.deepEqual([...DETERMINATION_VALUES].sort(), [
    "failed",
    "indeterminate",
    "unverified",
    "verified",
  ]);
  const reached = new Set([
    determineRun([outcomeWith("evidence")], { coverage: 100 }).value,
    determineRun([outcomeWith("fault")], { coverage: 0 }).value,
    determineRun([outcomeWith("no_evidence")], { coverage: 0 }).value,
    determineRun([outcomeWith("indeterminate")], { coverage: 0 }).value,
  ]);
  assert.deepEqual([...reached].sort(), ["failed", "indeterminate", "unverified", "verified"]);
});

test("the counts carry every key of the closed sets, zeros included", () => {
  const outcomes = [outcomeWith("evidence"), outcomeWith("fault"), outcomeWith("fault")];
  const classes = countOutcomeClasses(outcomes);
  const bases = countOutcomeBases(outcomes);

  assert.deepEqual(Object.keys(classes).sort(), [...OUTCOME_CLASSES].sort());
  assert.deepEqual(Object.keys(bases).sort(), [...OUTCOME_BASES].sort());
  assert.equal(classes.success, 1);
  assert.equal(classes.error, 2);
  assert.equal(classes.declared_empty, 0);
  assert.equal(bases.evidence, 1);
  assert.equal(bases.fault, 2);
  assert.equal(bases.indeterminate, 0);
  assert.equal(countOutcomeClasses([]).success, 0);
});

test("the worst outcome is the one that claims the most, and it renders two lines", () => {
  assert.equal(worstOutcome([]), undefined);
  assert.deepEqual(outcomeEvidenceLines(undefined), []);

  const evidence = outcomeWith("evidence");
  const empty = outcomeWith("no_evidence");
  const fault = outcomeWith("fault");
  assert.equal(worstOutcome([evidence, empty]).basis, "no_evidence");
  assert.equal(worstOutcome([empty, fault]).basis, "fault");
  assert.equal(worstOutcome([evidence]).basis, "evidence");
  assert.deepEqual(outcomeEvidenceLines(fault), ["outcome:error:exit_3", "basis:fault"]);
});
