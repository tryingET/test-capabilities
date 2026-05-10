import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runtimeEnv } from "./helpers/runtime-dist.mjs";

const scriptPath = new URL("../scripts/root-cause-corpus.mjs", import.meta.url).pathname;
const repoRoot = new URL("..", import.meta.url).pathname;

test("root-cause corpus dogfoods calibrated diagnosis invariants", { timeout: 20000 }, () => {
  const result = spawnSync("node", [scriptPath], {
    encoding: "utf8",
    cwd: repoRoot,
    env: runtimeEnv(),
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(
    result.stdout,
    /\[pass\] CLI missing command with one observed agent does not emit root_cause/,
  );
  assert.match(result.stdout, /\[pass\] CLI shell not-found wording classifies command_resolution/);
  assert.match(
    result.stdout,
    /\[pass\] CLI timeout with two observed agents classifies timeout_or_latency/,
  );
  assert.match(result.stdout, /\[pass\] CLI app crash does not classify as command_resolution/);
  assert.match(
    result.stdout,
    /\[pass\] Bombadil required-property validation wording classifies property_violation/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Mixed Surf and Bombadil failure classes do not emit root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Majority Surf with conflicting Bombadil class does not emit root_cause/,
  );
  assert.match(result.stdout, /\[pass\] Observation-only API signals classify contract_mismatch/);
  assert.match(
    result.stdout,
    /\[pass\] Observation-only API contract violation wording classifies contract_mismatch/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Observation-only API response payload element missing classifies contract_mismatch/,
  );
  assert.match(
    result.stdout,
    /\[pass\] API property-kind payload evidence classifies contract_mismatch/,
  );
  assert.match(
    result.stdout,
    /\[pass\] API property-kind runtime exception without contract evidence classifies component_failure_surface/,
  );
  assert.match(
    result.stdout,
    /\[pass\] API runtime exception without contract evidence classifies component_failure_surface/,
  );
  assert.match(
    result.stdout,
    /\[pass\] API stack trace exception without property evidence classifies component_failure_surface/,
  );
  assert.match(
    result.stdout,
    /\[pass\] API validation exception without contract evidence classifies component_failure_surface/,
  );
  assert.match(
    result.stdout,
    /\[pass\] API schema exception without contract evidence classifies component_failure_surface/,
  );
  assert.match(
    result.stdout,
    /\[pass\] API contract finding with browser-word observations classifies contract_mismatch/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Surf DOM coverage wording without selector evidence classifies browser_coverage_gap/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Selector drift with two observed agents classifies selector_or_dom_drift/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Selector contract wording classifies selector_or_dom_drift/,
  );
  assert.match(
    result.stdout,
    /\[pass\] DOM drift with two observed agents classifies selector_or_dom_drift/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Unobserved selector drift finding does not emit root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Same-component unobserved selector drift finding suppresses root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Foreign observation finding IDs stay out of API root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Extra same-class unlinked API finding preserves contract_mismatch/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Two sensors linked to the same finding classify contract_mismatch/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Two sensors plus unobserved conflicting finding do not emit root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Two passing sensors linked to the same finding do not emit root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Single sensor with multiple linked findings does not emit root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Partial observed\/unobserved finding pair does not emit root_cause/,
  );
  assert.match(result.stdout, /\[pass\] root-cause corpus complete \(36 cases\)/);
});

test("root-cause corpus emits machine-readable dogfood results", { timeout: 20000 }, () => {
  const result = spawnSync("node", [scriptPath, "--json"], {
    encoding: "utf8",
    cwd: repoRoot,
    env: runtimeEnv(),
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.total, 36);
  assert.equal(payload.failed, 0);
  assert.equal(payload.coverage.total, 36);
  assert.equal(payload.coverage.noRootCauseCases, 12);
  assert.equal(payload.coverage.positiveRootCauseCases, 24);
  assert.equal(payload.coverage.highCalibrationRootCauseCases, 24);
  assert.equal(payload.coverage.expectedClasses.none, 12);
  assert.equal(payload.coverage.expectedClasses.contract_mismatch, 8);
  assert.equal(payload.coverage.expectedClasses.component_failure_surface, 6);
  assert.equal(payload.coverage.subjects.api, 18);
  assert.equal(payload.coverage.subjects.cli, 5);
  assert.equal(payload.coverage.subjects.web, 13);
  const sameClassExtraCase = payload.cases.find(
    (entry) => entry.name === "Extra same-class unlinked API finding preserves contract_mismatch",
  );
  assert.equal(sameClassExtraCase?.expected, "contract_mismatch");
  assert.equal(sameClassExtraCase?.actual, "contract_mismatch");
  assert.deepEqual(sameClassExtraCase?.findingIds, ["api-contract-a", "api-contract-b"]);
  assert.equal(sameClassExtraCase?.rootCauseCount, 1);
  assert.equal(
    payload.cases.some(
      (entry) =>
        entry.name ===
        "Bombadil property violations with two observed agents classify property_violation",
    ),
    true,
  );
  const selectorCase = payload.cases.find(
    (entry) =>
      entry.name === "Selector drift with two observed agents classifies selector_or_dom_drift",
  );
  assert.equal(selectorCase?.expected, "selector_or_dom_drift");
  assert.equal(selectorCase?.actual, "selector_or_dom_drift");
  assert.equal(selectorCase?.rootCauseCount, 1);
  assert.equal(selectorCase?.calibration?.level, "high");
  assert.equal(selectorCase?.calibration?.signalCount, 2);
  assert.equal(selectorCase?.calibration?.sensorCount, 2);
  assert.equal(selectorCase?.calibration?.findingCount, 2);

  const singleSensorCase = payload.cases.find(
    (entry) => entry.name === "Selector drift with one observed agent does not emit root_cause",
  );
  assert.equal(singleSensorCase?.expected, "none");
  assert.equal(singleSensorCase?.actual, "none");
  assert.equal(singleSensorCase?.rootCauseCount, 0);
});
