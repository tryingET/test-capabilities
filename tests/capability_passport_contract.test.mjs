import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import test from "node:test";

function loadPassport() {
  return JSON.parse(
    readFileSync(new URL("../governance/capability-passport.json", import.meta.url), "utf8"),
  );
}

test("capability passport projection exists and distinguishes present vs supported Bombadil state", () => {
  const passport = loadPassport();

  assert.equal(passport.schema_version, 1);
  assert.match(passport.projection_note, /Candidate future AK model/);

  const bombadilAgent = passport.capabilities.find((entry) => entry.id === "agent:bombadil");
  const bombadilTool = passport.capabilities.find((entry) => entry.id === "tool:bombadil-binary");
  const testCommand = passport.capabilities.find((entry) => entry.id === "cli:test");

  assert.equal(bombadilAgent?.presence_state, "present");
  assert.equal(bombadilAgent?.support_state, "parked");
  assert.equal(bombadilAgent?.verification_state, "present_only");
  assert.equal((bombadilAgent?.activation_requirements?.length ?? 0) > 0, true);

  assert.equal(bombadilTool?.presence_state, "present");
  assert.equal(bombadilTool?.support_state, "parked");

  assert.equal(testCommand?.support_state, "supported");
  assert.equal(testCommand?.verification_state, "verified");
});

test("capability passport generator stays in sync with the checked-in projection", () => {
  const generated = spawnSync("node", ["./scripts/generate-capability-passport.mjs", "--stdout"], {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
    env: process.env,
  });

  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  assert.deepEqual(JSON.parse(generated.stdout), loadPassport());
});
