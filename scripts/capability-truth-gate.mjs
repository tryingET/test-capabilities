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

function assertRootCauseCorpusExecutes() {
  const result = run("node", ["./scripts/root-cause-corpus.mjs", "--json"]);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true, "root-cause corpus should pass in truth gate");
  assert.equal(payload.failed, 0, "root-cause corpus should have zero failed cases");
  assert.equal(payload.total, 36, "root-cause corpus should include the current fixture set");
  assert.equal(
    payload.coverage?.expectedClasses?.contract_mismatch,
    8,
    "root-cause corpus should preserve API contract ambiguity coverage",
  );
  assert.equal(
    payload.cases?.some(
      (entry) =>
        entry.name === "Extra same-class unlinked API finding preserves contract_mismatch" &&
        entry.actual === "contract_mismatch",
    ),
    true,
    "root-cause corpus should guard same-class unlinked finding tolerance",
  );
}

function assertRootCauseCorpusDogfood(packageJson, readme, productPosture, passport) {
  assert.match(
    packageJson.scripts?.["root-cause:corpus"] ?? "",
    /root-cause-corpus\.mjs/,
    "package.json should expose the root-cause corpus dogfood command",
  );
  assert.match(
    packageJson.scripts?.["release:check"] ?? "",
    /root-cause:corpus/,
    "release:check should run the root-cause corpus dogfood lane explicitly",
  );
  assert.match(readme, /root-cause:corpus/);
  assert.match(productPosture, /root-cause:corpus/);

  const observationProtocol = passport.capabilities.find(
    (capability) => capability.id === "protocol:observation-v1",
  );
  assert.ok(observationProtocol, "capability passport should include protocol:observation-v1");
  assert.equal(
    observationProtocol.evidence?.tests?.includes("tests/root_cause_corpus_contract.test.mjs"),
    true,
    "observation protocol passport evidence should include the root-cause corpus contract test",
  );
  assert.equal(
    observationProtocol.evidence?.commands?.includes("npm run root-cause:corpus"),
    true,
    "observation protocol passport evidence should include npm run root-cause:corpus",
  );
}

function assertPassportGeneratedProjection() {
  const generated = run("node", ["./scripts/generate-capability-passport.mjs", "--stdout"]);
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  assert.equal(
    generated.stdout,
    readText("governance/capability-passport.json"),
    "capability passport --stdout must be byte-identical to the checked-in projection",
  );
  assert.deepEqual(JSON.parse(generated.stdout), readJson("governance/capability-passport.json"));
}

const packageJson = readJson("package.json");
const readme = readText("README.md");
const productPosture = readText("docs/project/product_posture.md");

assertNoStaleDirectionClaims(productPosture);
assertDirectionDocsTrackAk(productPosture);
const passport = readJson("governance/capability-passport.json");

assertPackedBombadilContract(packageJson, readme, productPosture);
assertRootCauseCorpusDogfood(packageJson, readme, productPosture, passport);
assertRootCauseCorpusExecutes();
assertPassportVocabulary(passport);
assertPassportGeneratedProjection();

console.log("capability-truth-gate: ok");
