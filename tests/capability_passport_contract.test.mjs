import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runtimeEnv } from "./helpers/runtime-dist.mjs";

function loadPassport() {
  return JSON.parse(
    readFileSync(new URL("../governance/capability-passport.json", import.meta.url), "utf8"),
  );
}

test("capability passport projection records supported Bombadil runtime separately from the vendored tool boundary", () => {
  const passport = loadPassport();

  assert.equal(passport.schema_version, 1);
  assert.match(passport.projection_note, /Candidate future AK model/);

  const apiFuzzerAgent = passport.capabilities.find((entry) => entry.id === "agent:api-fuzzer");
  const bombadilAgent = passport.capabilities.find((entry) => entry.id === "agent:bombadil");
  const bombadilTool = passport.capabilities.find((entry) => entry.id === "tool:bombadil-binary");
  const testCommand = passport.capabilities.find((entry) => entry.id === "cli:test");

  assert.equal(apiFuzzerAgent?.presence_state, "absent");
  assert.equal(apiFuzzerAgent?.support_state, "unsupported");

  assert.equal(bombadilAgent?.presence_state, "present");
  assert.equal(bombadilAgent?.support_state, "supported");
  assert.equal(bombadilAgent?.verification_state, "verified");
  assert.equal(bombadilAgent?.notes?.includes("TEST_CAPABILITIES_BOMBADIL_BIN"), true);
  assert.equal(bombadilAgent?.notes?.includes("TEST_CAPABILITIES_BOMBADIL_REPO"), true);

  assert.equal(bombadilTool?.presence_state, "present");
  assert.equal(bombadilTool?.support_state, "parked");
  assert.equal(bombadilTool?.notes?.includes("packed consumers still need"), true);
  assert.equal(
    bombadilTool?.notes?.includes(
      "built source checkout referenced by TEST_CAPABILITIES_BOMBADIL_REPO",
    ),
    true,
  );

  assert.equal(testCommand?.support_state, "supported");
  assert.equal(testCommand?.verification_state, "verified");
});

test("capability passport marks quantum and prediction as parked (D1)", () => {
  const passport = loadPassport();
  const quantumCommand = passport.capabilities.find((entry) => entry.id === "cli:quantum");
  const quantumLibrary = passport.capabilities.find(
    (entry) => entry.id === "library:QuantumSimulator",
  );
  const predictionLibrary = passport.capabilities.find(
    (entry) => entry.id === "library:PredictionEngine",
  );

  for (const entry of [quantumCommand, quantumLibrary, predictionLibrary]) {
    assert.equal(entry?.support_state, "parked", `${entry?.id} must be parked`);
    assert.equal(entry?.presence_state, "present");
    assert.match(entry?.notes ?? "", /produces no target evidence/);
    assert.match(entry?.notes ?? "", /never writes? a Finding or Observation/);
  }
  assert.equal(
    passport.capabilities.find((entry) => entry.id === "cli:test")?.support_state,
    "supported",
  );
});

test("capability passport carries no SurfClient row after the 0.4.0 removal", () => {
  const passport = loadPassport();

  assert.equal(passport.package_version, "0.4.0");
  assert.equal(
    passport.capabilities.some((entry) => entry.id === "library:SurfClient"),
    false,
    "library:SurfClient must leave the passport with the export (D2)",
  );
  assert.equal(
    passport.capabilities.some((entry) => entry.id === "library:executeCliOperation"),
    true,
  );
});

test("capability passport entries use declared vocabulary values", () => {
  const passport = loadPassport();

  for (const capability of passport.capabilities) {
    assert.equal(
      passport.support_state_vocabulary.includes(capability.support_state),
      true,
      `${capability.id} support_state '${capability.support_state}' is not declared`,
    );
    assert.equal(
      passport.verification_state_vocabulary.includes(capability.verification_state),
      true,
      `${capability.id} verification_state '${capability.verification_state}' is not declared`,
    );
  }
});

test("capability passport generator stays in sync with the checked-in projection", () => {
  const generated = spawnSync("node", ["./scripts/generate-capability-passport.mjs", "--stdout"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
    env: runtimeEnv(),
  });

  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  const checkedIn = readFileSync(
    new URL("../governance/capability-passport.json", import.meta.url),
    "utf8",
  );
  assert.equal(generated.stdout, checkedIn);
  assert.deepEqual(JSON.parse(generated.stdout), loadPassport());
});
