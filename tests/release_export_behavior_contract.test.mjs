import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { createTestCapabilities, TestCapabilitiesOrchestrator, assertSupportedSurfAction } =
  await importRuntimeModule("index.js");
const { surfAdapter } = await importRuntimeModule("core/surf-adapter.js");

const config = {
  version: "2.0",
  name: "public-factory-release-contract",
  targets: { cli: JSON.stringify(process.execPath) },
  agents: { smoke: { enabled: true, type: "cli-tester", duration: "2s" } },
  intelligence: { correlation: false },
};

test("Given the package's named factory and valid CLI config, When used directly in process, Then canonical orchestration produces real verified evidence", async () => {
  const engine = createTestCapabilities(config);
  assert.ok(engine instanceof TestCapabilitiesOrchestrator);
  const run = await engine.run();
  assert.equal(run.passed, true);
  assert.equal(run.determination.value, "verified");
  assert.equal(run.findings.length, 0);
  assert.ok(run.observations.some((item) => item.agent === "smoke" && item.status === "passed"));
});

test("Given a named factory with unsupported agent intent, When constructed, Then it refuses before any target invocation", () => {
  assert.throws(
    () =>
      createTestCapabilities({
        ...config,
        agents: { unsupported: { enabled: true, type: "api-fuzzer" } },
      }),
    { code: "unsupported_agent_type" },
  );
});

test("Given Surf action capability declarations, When checked directly, Then supported preparation verbs pass and unsupported intents keep registered refusals", () => {
  for (const action of ["explore", "plan", "apply"])
    assert.doesNotThrow(() => assertSupportedSurfAction(action));
  for (const action of ["assert", "compare", "replay", "unrecognized"]) {
    assert.throws(() => assertSupportedSurfAction(action), { code: "unsupported_surf_action" });
  }
});

test("Given the Surf normalization seam, When exit zero has no payload or a sent mutation loses its reply, Then verdicts preserve no-evidence and indeterminacy", () => {
  const empty = surfAdapter.normalize({
    source: "surf",
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 1,
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.basis, "no_evidence");
  const lost = surfAdapter.normalize({
    source: "surf",
    exitCode: null,
    signal: "SESSION_EXIT",
    stdout: "",
    stderr: "controlled lost reply",
    durationMs: 1,
    effect: "mutating",
  });
  assert.equal(lost.ok, false);
  assert.equal(lost.basis, "indeterminate");
  assert.equal(lost.code, "signal_SESSION_EXIT");
});
