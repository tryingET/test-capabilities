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
  const result = run("ak", ["direction", "list", "--repo", repoRoot]);
  if (result.status !== 0) {
    return;
  }

  const output = result.stdout;
  if (output.includes("SF1") || output.includes("IW1")) {
    assert.match(productPosture, /SF1/, "product_posture.md should mention AK direction SF1");
    assert.match(productPosture, /IW1/, "product_posture.md should mention AK direction IW1");
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
assertPassportGeneratedProjection();

console.log("capability-truth-gate: ok");
