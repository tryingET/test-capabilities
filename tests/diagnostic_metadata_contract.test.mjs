import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { TestCapabilitiesOrchestrator } = await importRuntimeModule("core/orchestrator.js");
const observedAt = new Date("2026-01-01T00:00:00.000Z");
const rootsOf = (run) => run.observations.filter((item) => item.kind === "root_cause");

async function diagnose(evidence) {
  const orchestrator = new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "diagnostic-metadata-contract",
    targets: { cli: process.execPath },
    agents: { seed: { enabled: true, type: "cli-tester" } },
  });
  // Same failed signals, independently observed; vary only the evidence under test.
  orchestrator.agents = new Map(
    ["sensorA", "sensorB"].map((agent) => {
      const id = `${agent}-failed`;
      return [
        agent,
        {
          execute: async () => ({
            findings: [
              {
                id,
                type: "bug",
                severity: "critical",
                component: "cli",
                description: "CLI smoke command failed [exit_127]",
                evidence: [...evidence],
                recommendation: "Inspect the command failure.",
                timestamp: observedAt,
              },
            ],
            observations: [
              {
                protocol: "observation.v1",
                id: `${agent}-smoke`,
                timestamp: observedAt,
                agent,
                kind: "smoke",
                status: "errored",
                subject: "cli",
                summary: "CLI smoke did not complete successfully.",
                evidence: [...evidence],
                findingIds: [id],
                semantics: { component: "cli" },
              },
            ],
            coverage: {},
          }),
        },
      ];
    }),
  );
  const run = await orchestrator.run();
  const roots = rootsOf(run);
  assert.equal(roots.length, 1, "independent agreeing failures must still synthesize");
  assert.equal(roots[0].semantics.calibration.level, "high");
  assert.equal(roots[0].semantics.calibration.sensorCount, 2);
  assert.equal(roots[0].semantics.calibration.findingCount, 2);
  for (const finding of run.findings.filter((item) => !item.id.startsWith("corr-"))) {
    assert.deepEqual(finding.evidence, evidence, "primary evidence must remain intact");
  }
  for (const observation of run.observations.filter((item) => item.agent !== "orchestrator")) {
    assert.deepEqual(observation.evidence, evidence);
  }
  assert.equal(run.predictions.length, 0);
  return roots[0].semantics.failureClass;
}

const genericExit = ["outcome:error:exit_127", "error:exit_code:exit_127: operation failed"];

for (const metadata of [
  "transport:exit:127 durationMs:4",
  "transport:exit:127 durationMs:30000",
  "duration:4",
  "duration = 4ms",
  "durationMs=4",
  "duration:1500ms",
  "duration:4ms payloadBytes=8 > 0",
  "duration = 4ms payloadBytes=8 > 0",
  "enduration 1500ms > 1000ms budget",
  "transport:exit:127 durationMs:4 payloadBytes:8 > 0",
]) {
  test(`Given a generic exit failure; When ${metadata} is added; Then measurement alone is not a timing fault`, async () => {
    assert.equal(await diagnose(genericExit), "component_failure_surface", "no-metadata control");
    assert.equal(await diagnose([...genericExit, metadata]), "component_failure_surface");
  });
}

for (const signal of [
  "duration > 1000ms",
  "duration 1500ms > 1000ms budget",
  "duration : 1.5s > 1s budget",
  "duration\t:\t1500ms\t>\t1000ms budget",
  "latency 1500ms > 1000ms budget",
  "timed out after 50ms",
  "timeout after 50ms",
  "slow command response",
  "signal:SIGTERM",
  "signal:SIGKILL",
]) {
  test(`Given ${signal}; When durationMs metadata is present; Then genuine timing evidence keeps its class`, async () => {
    assert.equal(await diagnose([...genericExit, signal]), "timeout_or_latency");
    assert.equal(
      await diagnose([...genericExit, signal, "transport:exit:127 durationMs:4"]),
      "timeout_or_latency",
    );
  });
}

test("Given duration:1500ms is only a measurement; When its adjacent budget comparison is recorded; Then genuine timing evidence is retained", async () => {
  assert.equal(await diagnose([...genericExit, "duration: 1500ms"]), "component_failure_surface");
  assert.equal(
    await diagnose([...genericExit, "duration: 1500ms > 1000ms budget"]),
    "timeout_or_latency",
  );
});

test("Given durationMs=4 is only metadata; When a different field gains a comparator; Then it is still not a timing fault", async () => {
  assert.equal(await diagnose([...genericExit, "durationMs=4"]), "component_failure_surface");
  assert.equal(
    await diagnose([...genericExit, "durationMs=4 payloadBytes=8 > 0"]),
    "component_failure_surface",
  );
});

async function runCliFixture(source, duration) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "ak6602-cli-"));
  try {
    const fixture = path.join(scratch, "fixture.mjs");
    await writeFile(fixture, source);
    return await new TestCapabilitiesOrchestrator({
      version: "2.0",
      name: "diagnostic-metadata-real-cli",
      targets: { cli: `${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}` },
      agents: {
        cliA: { enabled: true, type: "cli-tester", duration },
        cliB: { enabled: true, type: "cli-tester", duration },
      },
    }).run();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function assertRealRoot(run, code, failureClass) {
  const sensors = run.findings.filter((finding) => finding.outcome !== undefined);
  assert.equal(sensors.length, 2);
  assert.deepEqual(
    sensors.map((finding) => finding.outcome.code),
    [code, code],
  );
  for (const finding of sensors) {
    assert.equal(finding.outcome.class, code === "timeout" ? "timeout" : "error");
    assert.equal(typeof finding.outcome.transport.durationMs, "number");
    assert.match(finding.evidence.join("\n"), /durationMs:\d+/);
  }
  const roots = rootsOf(run);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].semantics.failureClass, failureClass);
  assert.equal(roots[0].semantics.calibration.level, "high");
  assert.equal(roots[0].semantics.calibration.sensorCount, 2);
}

test("Given real generic CLI exits; When transport records durationMs; Then they are not timing failures", async () => {
  const run = await runCliFixture(
    "process.stderr.write('operation failed'); process.exit(127);",
    "2s",
  );
  assertRealRoot(run, "exit_127", "component_failure_surface");
  for (const finding of run.findings.filter((item) => item.outcome !== undefined)) {
    assert.equal(finding.outcome.transport.exitCode, 127);
    assert.equal(finding.outcome.transport.stderr, "operation failed");
  }
});

test("Given hanging CLI processes; When the framework enforces its deadline; Then actual timeouts retain their class", async () => {
  const run = await runCliFixture("setInterval(() => {}, 1000);", "25ms");
  assertRealRoot(run, "timeout", "timeout_or_latency");
  for (const finding of run.findings.filter((item) => item.outcome !== undefined)) {
    assert.match(finding.evidence.join("\n"), /timeout|timed out/i);
  }
});
