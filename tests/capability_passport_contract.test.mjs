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

  const bombadilAgent = passport.capabilities.find((entry) => entry.id === "agent:bombadil");
  const bombadilTool = passport.capabilities.find((entry) => entry.id === "tool:bombadil-binary");
  const testCommand = passport.capabilities.find((entry) => entry.id === "cli:test");

  assert.equal(bombadilAgent?.presence_state, "present");
  assert.equal(bombadilAgent?.support_state, "supported");
  assert.equal(bombadilAgent?.verification_state, "verified");
  assert.equal(bombadilAgent?.notes?.includes("TEST_CAPABILITIES_BOMBADIL_BIN"), true);
  assert.equal(bombadilAgent?.notes?.includes("TEST_CAPABILITIES_BOMBADIL_REPO"), true);

  assert.equal(bombadilTool?.presence_state, "present");
  assert.equal(bombadilTool?.support_state, "parked");
  assert.equal(bombadilTool?.notes?.includes("packed consumers still need"), true);
  assert.equal(bombadilTool?.notes?.includes("softwareco/contrib/bombadil"), true);

  assert.equal(testCommand?.support_state, "supported");
  assert.equal(testCommand?.verification_state, "verified");
});

test("capability passport generator stays in sync with the checked-in projection", () => {
  const generated = spawnSync("node", ["./scripts/generate-capability-passport.mjs", "--stdout"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
    env: runtimeEnv(),
  });

  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  assert.deepEqual(JSON.parse(generated.stdout), loadPassport());
});
