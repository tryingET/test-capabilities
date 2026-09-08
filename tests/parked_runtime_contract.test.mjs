import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * Operator decision D1 keeps the quantum simulator and the prediction exports in the runtime as
 * *parked* code. Parked means present and tested, and it means one thing about behaviour: they
 * produce no target evidence. This file is the pin. If a future edit lets either of them write a
 * Finding or an Observation, or reach `TestResult.passed` or the run determination, exactly
 * these assertions fail.
 */

const {
  executeCliOperation,
  executeQuantumOperation,
  executeTestOperation,
  TestCapabilitiesOrchestrator,
} = await importRuntimeModule("index.js");

const QUANTUM_INPUT = { target: "https://example.com", branches: "4", collapse: true };

/** Every key anywhere in a structure, so a verdict cannot hide one level down. */
function deepKeys(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepKeys(entry, found);
    }
    return found;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      found.add(key);
      deepKeys(entry, found);
    }
  }
  return found;
}

function suiteConfig(cliTarget, extra = {}) {
  return {
    version: "2.0",
    name: "Parked Runtime",
    targets: { cli: cliTarget, web: "https://example.com" },
    agents: { cli: { enabled: true, type: "cli-tester", intensity: "normal" } },
    ...extra,
  };
}

test("the quantum envelope declares read_only with the parked reason and carries no evidence", async () => {
  const envelope = await executeQuantumOperation(QUANTUM_INPUT);

  assert.deepEqual(envelope.effect, {
    effect: "read_only",
    reason: "parked; produces no target evidence",
  });
  assert.deepEqual(envelope.mutations, []);
  assert.match(envelope.runId, /^[0-9a-f-]{36}$/);

  const keys = deepKeys(envelope);
  for (const forbidden of ["findings", "observations", "determination", "passed", "outcomes"]) {
    assert.equal(keys.has(forbidden), false, `the quantum envelope must not carry '${forbidden}'`);
  }
  // the simulator reports its own branch coverage, which is a property of the simulation and
  // never of a target: it carries none of the run coverage report's dimensions
  const simulated = deepKeys(envelope.result.coverage);
  for (const dimension of ["userFlows", "apiEndpoints", "edgeCases", "overall", "status"]) {
    assert.equal(simulated.has(dimension), false, `simulated coverage must not claim ${dimension}`);
  }
});

test("the quantum route through the kernel is the same read_only declaration", async () => {
  const envelope = await executeCliOperation({ command: "quantum" }, QUANTUM_INPUT);
  assert.equal(envelope.operationId, "quantum");
  assert.equal(envelope.effect.effect, "read_only");
  assert.equal(envelope.effect.reason, "parked; produces no target evidence");
  assert.deepEqual(envelope.mutations, []);
  assert.equal(deepKeys(envelope).has("determination"), false);
});

test("enabling the simulator cannot move a verdict in either direction", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-parked-"));
  const target = path.join(dir, "cli.mjs");
  writeFileSync(target, "#!/usr/bin/env node\nconsole.log('usage: cli [options]');\n");

  const command = `${process.execPath} ${target}`;
  const without = await new TestCapabilitiesOrchestrator(suiteConfig(command)).run();
  const withQuantum = await new TestCapabilitiesOrchestrator(
    suiteConfig(command, { quantum: { enabled: true, branches: 4, maxDepth: 3 } }),
  ).run();

  // the simulator adds its own insights and nothing else
  assert.equal(without.quantumInsights, undefined);
  assert.equal(withQuantum.quantumInsights.universesSimulated > 0, true);

  assert.equal(withQuantum.passed, without.passed);
  assert.deepEqual(withQuantum.determination, without.determination);
  const verdictShape = (result) =>
    result.outcomes.map((outcome) => [outcome.class, outcome.ok, outcome.basis, outcome.code]);
  assert.deepEqual(verdictShape(withQuantum), verdictShape(without));
  assert.deepEqual(withQuantum.findings, without.findings);
  assert.deepEqual(
    withQuantum.observations.map((observation) => observation.kind),
    without.observations.map((observation) => observation.kind),
  );
  assert.deepEqual(withQuantum.predictions, []);

  // and the same holds when the run is failing: the verdict comes from the sensor, not from
  // the simulation that ran beside it
  const failing = `${process.execPath} ${path.join(dir, "missing.mjs")}`;
  const failedWithQuantum = await new TestCapabilitiesOrchestrator(
    suiteConfig(failing, { quantum: { enabled: true, branches: 4, maxDepth: 3 } }),
  ).run();
  const failedWithout = await new TestCapabilitiesOrchestrator(suiteConfig(failing)).run();
  assert.equal(failedWithQuantum.passed, false);
  assert.deepEqual(failedWithQuantum.determination, failedWithout.determination);
  assert.equal(failedWithQuantum.findings.length, failedWithout.findings.length);
});

test("the summary reports the simulation as a count, never as coverage or health", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-parked-summary-"));
  const target = path.join(dir, "cli.mjs");
  writeFileSync(target, "#!/usr/bin/env node\nconsole.log('usage: cli [options]');\n");
  const configPath = path.join(dir, "tc.yaml");
  writeFileSync(
    configPath,
    [
      "version: '2.0'",
      "name: 'Parked Summary'",
      "targets:",
      `  cli: '${process.execPath} ${target}'`,
      "  web: 'https://example.com'",
      "agents:",
      "  cli:",
      "    enabled: true",
      "    type: cli-tester",
      "quantum:",
      "  enabled: true",
      "  branches: 4",
      "  max_depth: 3",
      "",
    ].join("\n"),
  );

  const envelope = await executeTestOperation({ config: configPath });
  assert.equal(envelope.summary.health, "pass");
  assert.equal(envelope.summary.determination.value, "verified");
  assert.equal(envelope.summary.quantumUniverses > 0, true);
  assert.equal(envelope.summary.coverage.userFlows, 0);
  // the run is read-only: no agent it enables changes anything
  assert.equal(envelope.effect.effect, "read_only");
  assert.deepEqual(envelope.mutations, []);
});

test("prediction stays refused by the capability matrix and never reaches a verdict", async () => {
  assert.throws(
    () =>
      new TestCapabilitiesOrchestrator(
        suiteConfig(process.execPath, {
          intelligence: {
            selfHealing: false,
            prediction: true,
            correlation: true,
            collective: false,
          },
        }),
      ),
    (error) => {
      assert.equal(error.code, "unsupported_intelligence");
      assert.match(error.message, /prediction/);
      return true;
    },
  );
});
