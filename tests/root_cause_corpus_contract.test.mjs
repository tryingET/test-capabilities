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
  assert.match(
    result.stdout,
    /\[pass\] Mixed CLI command-resolution and timeout evidence does not emit root_cause/,
  );
  assert.match(result.stdout, /\[pass\] CLI app crash does not classify as command_resolution/);
  assert.match(
    result.stdout,
    /\[pass\] CLI diagnosis remains isolated from unrelated ambiguous web signals/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Independent CLI and API failures emit component-scoped root_causes/,
  );
  assert.match(
    result.stdout,
    /\[pass\] CLI diagnosis survives suppressed API mixed-class ambiguity/,
  );
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
  assert.match(
    result.stdout,
    /\[pass\] Mixed API contract and runtime evidence does not emit root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Linked API contract finding with runtime observations does not emit root_cause/,
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
  assert.match(
    result.stdout,
    /\[pass\] Three sensors agreeing on CLI command_resolution emit high-calibration root_cause/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Independent Bombadil and CLI failures emit component-scoped root_causes/,
  );
  assert.match(
    result.stdout,
    /\[pass\] Three-way simultaneous Surf, CLI, and API failures emit three component-scoped root_causes/,
  );
  assert.match(result.stdout, /\[pass\] root-cause corpus complete \(50 cases\)/);
  // Propagation synthesis assertions
  assert.match(result.stdout, /\[pass\] Single root_cause does not emit propagation/);
  assert.match(
    result.stdout,
    /\[pass\] Two independent root_causes on unrelated components do not emit propagation/,
  );
  assert.match(
    result.stdout,
    /\[pass\] API timeout \+ web component_failure emits propagation via api-latency-cascade/,
  );
  assert.match(result.stdout, /\[pass\] Propagation observations do not make prediction claims/);
  assert.match(
    result.stdout,
    /\[pass\] Same failure class across api and web emits propagation via shared-infra/,
  );
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
  // Exact corpus counts are intentional truth locks: fixture changes must update both
  // machine-readable coverage expectations and named guardrail assertions.
  assert.equal(payload.total, 50);
  assert.equal(payload.failed, 0);
  assert.equal(payload.coverage.total, 50);
  assert.equal(payload.coverage.noRootCauseCases, 15);
  assert.equal(payload.coverage.positiveRootCauseCases, 35);
  assert.equal(payload.coverage.highCalibrationRootCauseCases, 35);
  assert.equal(payload.coverage.expectedClasses.none, 15);
  assert.equal(payload.coverage.expectedClasses.command_resolution, 10);
  assert.equal(payload.coverage.expectedClasses.timeout_or_latency, 5);
  assert.equal(payload.coverage.expectedClasses.contract_mismatch, 10);
  assert.equal(payload.coverage.expectedClasses.component_failure_surface, 8);
  assert.equal(payload.coverage.expectedClasses.browser_coverage_gap, 3);
  assert.equal(payload.coverage.expectedClasses.selector_or_dom_drift, 3);
  assert.equal(payload.coverage.expectedClasses.property_violation, 4);
  assert.equal(payload.coverage.subjects.api, 25);
  assert.equal(payload.coverage.subjects.cli, 14);
  assert.equal(payload.coverage.subjects.web, 19);
  const mixedCliCase = payload.cases.find(
    (entry) =>
      entry.name === "Mixed CLI command-resolution and timeout evidence does not emit root_cause",
  );
  assert.equal(mixedCliCase?.expected, "none");
  assert.equal(mixedCliCase?.actual, "none");
  assert.equal(mixedCliCase?.rootCauseCount, 0);

  const mixedApiCase = payload.cases.find(
    (entry) => entry.name === "Mixed API contract and runtime evidence does not emit root_cause",
  );
  assert.equal(mixedApiCase?.expected, "none");
  assert.equal(mixedApiCase?.actual, "none");
  assert.equal(mixedApiCase?.rootCauseCount, 0);

  const linkedApiRuntimeCase = payload.cases.find(
    (entry) =>
      entry.name ===
      "Linked API contract finding with runtime observations does not emit root_cause",
  );
  assert.equal(linkedApiRuntimeCase?.expected, "none");
  assert.equal(linkedApiRuntimeCase?.actual, "none");
  assert.equal(linkedApiRuntimeCase?.rootCauseCount, 0);

  const suppressedApiAmbiguityCase = payload.cases.find(
    (entry) => entry.name === "CLI diagnosis survives suppressed API mixed-class ambiguity",
  );
  assert.equal(suppressedApiAmbiguityCase?.expected, "command_resolution");
  assert.equal(suppressedApiAmbiguityCase?.actual, "command_resolution");
  assert.deepEqual(suppressedApiAmbiguityCase?.findingIds, ["cliA-missing", "cliB-missing"]);
  assert.equal(suppressedApiAmbiguityCase?.rootCauseCount, 1);

  const isolatedCliCase = payload.cases.find(
    (entry) => entry.name === "CLI diagnosis remains isolated from unrelated ambiguous web signals",
  );
  assert.equal(isolatedCliCase?.expected, "command_resolution");
  assert.equal(isolatedCliCase?.actual, "command_resolution");
  assert.deepEqual(isolatedCliCase?.findingIds, ["cliA-missing", "cliB-missing"]);
  assert.equal(isolatedCliCase?.rootCauseCount, 1);

  const multiComponentCase = payload.cases.find(
    (entry) => entry.name === "Independent CLI and API failures emit component-scoped root_causes",
  );
  assert.equal(multiComponentCase?.expected, "multi");
  assert.equal(multiComponentCase?.actual, "multi");
  assert.equal(multiComponentCase?.rootCauseCount, 2);
  assert.deepEqual(multiComponentCase?.actualRootCauses, [
    { subject: "api", failureClass: "contract_mismatch" },
    { subject: "cli", failureClass: "command_resolution" },
  ]);
  assert.deepEqual(multiComponentCase?.calibrations, [
    { level: "high", signalCount: 2, sensorCount: 2, findingCount: 0 },
    { level: "high", signalCount: 2, sensorCount: 2, findingCount: 2 },
  ]);
  assert.equal(Object.hasOwn(multiComponentCase ?? {}, "subject"), false);
  assert.equal(Object.hasOwn(multiComponentCase ?? {}, "calibration"), false);
  assert.equal(Object.hasOwn(multiComponentCase ?? {}, "findingIds"), false);

  // Three-sensor agreement case
  const threeSensorCase = payload.cases.find(
    (entry) =>
      entry.name ===
      "Three sensors agreeing on CLI command_resolution emit high-calibration root_cause",
  );
  assert.equal(threeSensorCase?.expected, "command_resolution");
  assert.equal(threeSensorCase?.actual, "command_resolution");
  assert.equal(threeSensorCase?.rootCauseCount, 1);
  assert.equal(threeSensorCase?.calibration?.level, "high");
  assert.equal(threeSensorCase?.calibration?.signalCount, 3);
  assert.equal(threeSensorCase?.calibration?.sensorCount, 3);
  assert.equal(threeSensorCase?.calibration?.findingCount, 3);

  // Bombadil + CLI cross-component simultaneous
  const bombadilCliCase = payload.cases.find(
    (entry) =>
      entry.name === "Independent Bombadil and CLI failures emit component-scoped root_causes",
  );
  assert.equal(bombadilCliCase?.expected, "multi");
  assert.equal(bombadilCliCase?.actual, "multi");
  assert.equal(bombadilCliCase?.rootCauseCount, 2);
  assert.deepEqual(bombadilCliCase?.actualRootCauses, [
    { subject: "cli", failureClass: "command_resolution" },
    { subject: "web", failureClass: "property_violation" },
  ]);

  // Three-way simultaneous
  const threeWayCase = payload.cases.find(
    (entry) =>
      entry.name ===
      "Three-way simultaneous Surf, CLI, and API failures emit three component-scoped root_causes",
  );
  assert.equal(threeWayCase?.expected, "multi");
  assert.equal(threeWayCase?.actual, "multi");
  assert.equal(threeWayCase?.rootCauseCount, 3);
  assert.deepEqual(threeWayCase?.actualRootCauses, [
    { subject: "api", failureClass: "contract_mismatch" },
    { subject: "cli", failureClass: "command_resolution" },
    { subject: "web", failureClass: "browser_coverage_gap" },
  ]);
  assert.deepEqual(threeWayCase?.calibrations, [
    { level: "high", signalCount: 2, sensorCount: 2, findingCount: 0 },
    { level: "high", signalCount: 2, sensorCount: 2, findingCount: 2 },
    { level: "high", signalCount: 2, sensorCount: 2, findingCount: 2 },
  ]);

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
