import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assertNoStaleDirectionClaims(productPosture) {
  assert.equal(
    /no strong AK-native direction frame/i.test(productPosture),
    false,
    "product_posture.md contains stale AK direction wording",
  );
}

function assertDirectionDocsTrackAk(productPosture) {
  const requireAkDirection = process.env.TEST_CAPABILITIES_REQUIRE_AK_DIRECTION === "1";
  const result = run("ak", ["direction", "list", "--repo", repoRoot]);
  if (!requireAkDirection) {
    const detail =
      result.status === 0 ? "portable mode" : `unavailable. ${result.stderr || result.stdout}`;
    console.warn(
      `capability-truth-gate: AK direction check skipped (${detail}); run npm run truth:gate:local for repo-local AK validation.`,
    );
    return;
  }

  assert.equal(
    result.status,
    0,
    `AK direction check is required for the repo-local truth gate. ${result.stderr || result.stdout}`,
  );

  const output = result.stdout;
  assert.match(output, /SF1\s+strategic_frame\s+active/, "AK direction should keep SF1 active");
  assert.match(output, /IW1\s+work_wave\s+done/, "AK direction should keep IW1 done");
  assert.match(output, /IW2\s+work_wave\s+next/, "AK direction should keep IW2 next");
  assert.match(productPosture, /SF1/, "product_posture.md should mention AK direction SF1");
  assert.match(productPosture, /IW1/, "product_posture.md should mention AK direction IW1");
  assert.match(productPosture, /IW2/, "product_posture.md should mention AK direction IW2");
}

function assertPassportVocabulary(passport) {
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
}

function assertPackedBombadilContract(packageJson, readme, productPosture) {
  const packageFiles = packageJson.files ?? [];
  assert.equal(
    packageFiles.some((entry) => entry === "external/" || entry.startsWith("external/")),
    false,
    "package files must not include repo-local external/bombadil unless distribution posture changes",
  );
  assert.match(readme, /external tool requirement/i);
  assert.match(productPosture, /external Bombadil/i);
}

function assertPassportGeneratedProjection() {
  const generated = run("node", ["./scripts/generate-capability-passport.mjs", "--stdout"]);
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  assert.deepEqual(JSON.parse(generated.stdout), readJson("governance/capability-passport.json"));
}

const packageJson = readJson("package.json");
const readme = readText("README.md");
const productPosture = readText("docs/project/product_posture.md");

assertNoStaleDirectionClaims(productPosture);
assertDirectionDocsTrackAk(productPosture);
assertPackedBombadilContract(packageJson, readme, productPosture);
assertPassportVocabulary(readJson("governance/capability-passport.json"));
assertPassportGeneratedProjection();

console.log("capability-truth-gate: ok");
