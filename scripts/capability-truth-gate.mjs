import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function typecheckCommandArgs(extraArgs) {
  const tsgoEntrypoint = path.join(
    repoRoot,
    "node_modules",
    "@typescript",
    "native-preview",
    "bin",
    "tsgo.js",
  );
  assert.equal(
    existsSync(tsgoEntrypoint),
    true,
    "tsgo wrapper must be installed for type fixtures",
  );
  const smoke = run(process.execPath, [tsgoEntrypoint, "--version"]);
  assert.equal(
    smoke.status,
    0,
    `tsgo native compiler must be executable for type fixtures. Install optional native dependencies without --omit=optional. ${smoke.stdout}\n${smoke.stderr}`,
  );
  return [process.execPath, [tsgoEntrypoint, "--ignoreConfig", ...extraArgs]];
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
  assert.match(output, /IW2\s+work_wave\s+done/, "AK direction should keep IW2 done");
  assert.match(output, /IW3\s+work_wave\s+done/, "AK direction should keep IW3 done");
  assert.match(
    output,
    /IW4\s+work_wave\s+done/,
    "AK direction should keep IW4 done after the validated propagation-linkage slice",
  );
  for (const directionId of ["SF1", "IW1", "IW2", "IW3", "IW4"]) {
    assert.match(
      productPosture,
      new RegExp(`\\b${directionId}\\b`),
      `product_posture.md should mention AK direction ${directionId}`,
    );
  }
}

function assertPackedTypeSurface() {
  const sourceIndex = readText("src/index.ts");
  const distTypes = readText("dist/index.d.ts");
  const docsTypes = readText("docs/api/types.md");

  for (const typeName of [
    "AgentConfig",
    "IntelligenceConfig",
    "PropagationEdge",
    "PropagationTopology",
    "TestCapabilitiesConfig",
  ]) {
    assert.match(
      sourceIndex,
      new RegExp(`\\b${typeName}\\b`),
      `src/index.ts should re-export ${typeName}`,
    );
    assert.match(
      distTypes,
      new RegExp(`\\b${typeName}\\b`),
      `dist/index.d.ts should expose ${typeName}`,
    );
    assert.match(
      docsTypes,
      new RegExp(`\\b${typeName}\\b`),
      `docs/api/types.md should document ${typeName}`,
    );
  }

  assert.match(docsTypes, /propagationTopology\?: PropagationTopology;/);

  const tempRoot = path.join(repoRoot, ".tmp");
  mkdirSync(tempRoot, { recursive: true });
  const tempDir = mkdtempSync(path.join(tempRoot, "truth-gate-types-"));
  const fixture = path.join(tempDir, "consumer.ts");
  try {
    writeFileSync(
      fixture,
      [
        'import { createTestCapabilities } from "../../dist/index.js";',
        'import type { IntelligenceConfig, PropagationEdge, PropagationTopology, TestCapabilitiesConfig } from "../../dist/index.js";',
        'const edge: PropagationEdge = { upstream: "api", downstream: "web" };',
        "const topology: PropagationTopology = { edges: [edge] };",
        "const intelligence: IntelligenceConfig = { correlation: true, propagationTopology: topology };",
        'const config: TestCapabilitiesConfig = { version: "2.0", name: "typed", targets: { cli: "node" }, agents: { cli: { type: "cli-tester" } }, intelligence };',
        "createTestCapabilities(config);",
        "",
      ].join("\n"),
      "utf8",
    );
    const [typecheckCommand, typecheckArgs] = typecheckCommandArgs([
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--skipLibCheck",
      fixture,
    ]);
    const result = run(typecheckCommand, typecheckArgs);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertVisionCurrentRuntimeAlignment() {
  const vision = readText("docs/project/vision.md");
  assert.match(
    vision,
    /Current supported runtime surfaces[^\n]+low-calibration non-authoritative `propagation` observations/,
    "vision current-runtime section should mention supported propagation observations",
  );
  assert.match(
    vision,
    /Propagation output is diagnostic linkage, not causal proof, prediction, or repair-order authority/,
    "vision should preserve propagation authority boundaries",
  );
  assert.match(
    vision,
    /guardrails against causal, predictive, or repair-order overclaims/,
    "vision Phase 1 deliverables should include propagation overclaim guardrails",
  );
}

function assertCurrentSurfaceAvoidsCausalityOverclaim({ readme, productPosture, passport }) {
  const surfaces = {
    "README.md": readme,
    "docs/project/product_posture.md": productPosture,
    "docs/api/config.md": readText("docs/api/config.md"),
    "docs/api/types.md": readText("docs/api/types.md"),
    "src/core/orchestrator.ts": readText("src/core/orchestrator.ts"),
    "governance/capability-passport.json": JSON.stringify(passport),
  };
  for (const [surface, text] of Object.entries(surfaces)) {
    assert.doesNotMatch(
      text,
      /likely caused|plausible causal link|plausible causal mechanism|\bcascad(?:es|ed|ing)\s+(?:to|into)\b|\brepair\b.{0,40}\bfirst\b/i,
      `${surface} should describe propagation as non-authoritative linkage, not causal proof`,
    );
  }
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
  // Exact corpus counts are intentional truth locks, not inferred floors: fixture changes must
  // update this gate and the corpus contract test together.
  assert.equal(payload.total, 58, "root-cause corpus should include the current fixture set");
  assert.equal(
    payload.coverage?.expectedClasses?.contract_mismatch,
    12,
    "root-cause corpus should preserve API contract ambiguity coverage",
  );
  assert.equal(
    payload.coverage?.positivePropagationCases,
    7,
    "root-cause corpus should preserve positive propagation coverage",
  );
  assert.equal(
    payload.coverage?.noPropagationGuardrailCases,
    6,
    "root-cause corpus should preserve no-propagation guardrail coverage",
  );
  assert.deepEqual(
    payload.coverage?.propagationSubjects,
    { "api-to-web": 4, "cli-to-api": 1, "cli-to-web": 1, "web-to-api": 1 },
    "root-cause corpus should expose propagation subject coverage in machine-readable output",
  );
  assert.deepEqual(
    payload.coverage?.propagationLinks,
    {
      "api-latency-cascade": 2,
      "api-schema-drift-to-ui": 1,
      "shared-infra (timeout_or_latency on both)": 2,
      "cli-tool-failure-blocks-api-check": 1,
      "cli-tool-failure-blocks-web-check": 1,
    },
    "root-cause corpus should expose propagation link coverage in machine-readable output",
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
  assert.equal(
    payload.cases?.some(
      (entry) =>
        entry.name === "CLI diagnosis remains isolated from unrelated ambiguous web signals" &&
        entry.actual === "command_resolution" &&
        entry.rootCauseCount === 1,
    ),
    true,
    "root-cause corpus should guard component-isolated diagnosis under unrelated ambiguity",
  );
  assert.equal(
    payload.cases?.some(
      (entry) =>
        entry.name === "CLI diagnosis survives suppressed API mixed-class ambiguity" &&
        entry.actual === "command_resolution" &&
        entry.rootCauseCount === 1,
    ),
    true,
    "root-cause corpus should guard diagnosis beside a suppressed ambiguous component",
  );
  const simultaneousCase = payload.cases?.find(
    (entry) => entry.name === "Independent CLI and API failures emit component-scoped root_causes",
  );
  assert.equal(
    simultaneousCase?.actual,
    "multi",
    "root-cause corpus should mark simultaneous component diagnoses as multi",
  );
  assert.equal(
    simultaneousCase?.rootCauseCount,
    2,
    "root-cause corpus should report two simultaneous component-scoped diagnoses",
  );
  assert.deepEqual(
    simultaneousCase?.actualRootCauses,
    [
      { subject: "api", failureClass: "contract_mismatch" },
      { subject: "cli", failureClass: "command_resolution" },
    ],
    "root-cause corpus should preserve simultaneous diagnosis subjects and classes",
  );
  assert.equal(
    Object.hasOwn(simultaneousCase ?? {}, "subject"),
    false,
    "multi-root corpus cases should not expose scalar subject",
  );
  assert.equal(
    Object.hasOwn(simultaneousCase ?? {}, "calibration"),
    false,
    "multi-root corpus cases should not expose scalar calibration",
  );
  assert.equal(
    Object.hasOwn(simultaneousCase ?? {}, "findingIds"),
    false,
    "multi-root corpus cases should not expose scalar findingIds",
  );
  assert.equal(
    payload.cases?.some(
      (entry) =>
        entry.name ===
          "Mixed CLI command-resolution and timeout evidence does not emit root_cause" &&
        entry.actual === "none" &&
        entry.rootCauseCount === 0,
    ),
    true,
    "root-cause corpus should guard same-component mixed CLI class suppression",
  );
  assert.equal(
    payload.cases?.some(
      (entry) =>
        entry.name === "Mixed API contract and runtime evidence does not emit root_cause" &&
        entry.actual === "none" &&
        entry.rootCauseCount === 0,
    ),
    true,
    "root-cause corpus should guard same-component mixed API class suppression",
  );
  assert.equal(
    payload.cases?.some(
      (entry) =>
        entry.name ===
          "Linked API contract finding with runtime observations does not emit root_cause" &&
        entry.actual === "none" &&
        entry.rootCauseCount === 0,
    ),
    true,
    "root-cause corpus should guard linked-finding/current-run evidence disagreement",
  );
  // Three-sensor agreement
  assert.equal(
    payload.cases?.some(
      (entry) =>
        entry.name ===
          "Three sensors agreeing on CLI command_resolution emit high-calibration root_cause" &&
        entry.actual === "command_resolution" &&
        entry.rootCauseCount === 1 &&
        entry.calibration?.sensorCount === 3,
    ),
    true,
    "root-cause corpus should guard three-sensor agreement calibration",
  );
  // Bombadil + CLI cross-component simultaneous
  const bombadilCliCase = payload.cases?.find(
    (entry) =>
      entry.name === "Independent Bombadil and CLI failures emit component-scoped root_causes",
  );
  assert.equal(
    bombadilCliCase?.actual,
    "multi",
    "root-cause corpus should mark Bombadil+CLI simultaneous diagnoses as multi",
  );
  assert.equal(
    bombadilCliCase?.rootCauseCount,
    2,
    "root-cause corpus should report two simultaneous Bombadil+CLI component-scoped diagnoses",
  );
  // Three-way simultaneous
  const threeWayCase = payload.cases?.find(
    (entry) =>
      entry.name ===
      "Three-way simultaneous Surf, CLI, and API failures emit three component-scoped root_causes",
  );
  assert.equal(
    threeWayCase?.actual,
    "multi",
    "root-cause corpus should mark three-way simultaneous diagnoses as multi",
  );
  assert.equal(
    threeWayCase?.rootCauseCount,
    3,
    "root-cause corpus should report three simultaneous component-scoped diagnoses",
  );

  // Propagation synthesis assertions
  const noPropagationCase = payload.cases?.find(
    (entry) => entry.name === "Single root_cause does not emit propagation",
  );
  assert.ok(
    noPropagationCase,
    "root-cause corpus should include a single-root_cause-no-propagation guardrail case",
  );

  const unrelatedNoPropagationCase = payload.cases?.find(
    (entry) =>
      entry.name === "Two independent root_causes on unrelated components do not emit propagation",
  );
  assert.ok(
    unrelatedNoPropagationCase,
    "root-cause corpus should include an unrelated-components-no-propagation guardrail case",
  );

  const genericComponentNoPropagationCase = payload.cases?.find(
    (entry) =>
      entry.name === "Generic API and web component failures do not emit shared-infra propagation",
  );
  assert.ok(
    genericComponentNoPropagationCase,
    "root-cause corpus should guard against generic component-failure propagation overclaim",
  );

  const samePropertyNoPropagationCase = payload.cases?.find(
    (entry) =>
      entry.name ===
      "Same property violations across api and web do not emit shared-infra propagation",
  );
  assert.ok(
    samePropertyNoPropagationCase,
    "root-cause corpus should guard against non-latency same-class shared-infra propagation overclaim",
  );

  const propagationCascadeCase = payload.cases?.find(
    (entry) =>
      entry.name ===
      "API timeout + web component_failure emits propagation via api-latency-cascade",
  );
  assert.ok(
    propagationCascadeCase,
    "root-cause corpus should include a positive propagation cascade case",
  );
  assert.equal(
    propagationCascadeCase?.propagationCount,
    1,
    "root-cause corpus should report positive propagation counts per case",
  );
  assert.deepEqual(
    propagationCascadeCase?.actualPropagations,
    [
      {
        subject: "api-to-web",
        link: "api-latency-cascade",
        calibration: { level: "low", signalCount: 2, sensorCount: 4, findingCount: 4 },
      },
    ],
    "root-cause corpus should expose positive propagation details per case",
  );

  const latencySurfNoPropagationCase = payload.cases?.find(
    (entry) =>
      entry.name === "API timeout + Surf browser coverage gap does not emit latency propagation",
  );
  assert.ok(
    latencySurfNoPropagationCase,
    "root-cause corpus should guard against latency propagation into Surf evidence gaps",
  );
  assert.equal(
    latencySurfNoPropagationCase?.propagationCount,
    0,
    "root-cause corpus should report zero propagation for Surf evidence-gap guardrails",
  );

  const schemaDriftPropagationCase = payload.cases?.find(
    (entry) =>
      entry.name ===
      "API contract mismatch + web component failure emits propagation via api-schema-drift-to-ui",
  );
  assert.ok(
    schemaDriftPropagationCase,
    "root-cause corpus should cover api-schema-drift-to-ui propagation",
  );

  const schemaDriftSurfNoPropagationCase = payload.cases?.find(
    (entry) =>
      entry.name ===
      "API contract mismatch + Surf browser coverage gap does not emit schema-drift propagation",
  );
  assert.ok(
    schemaDriftSurfNoPropagationCase,
    "root-cause corpus should guard against schema-drift propagation into Surf evidence gaps",
  );

  const propagationNoPredictionCase = payload.cases?.find(
    (entry) => entry.name === "Propagation observations do not make prediction claims",
  );
  assert.ok(
    propagationNoPredictionCase,
    "root-cause corpus should verify propagation does not make prediction claims",
  );

  const cliToApiCase = payload.cases?.find(
    (entry) =>
      entry.name ===
      "CLI command resolution plus API component failure emits propagation via cli-to-api",
  );
  assert.ok(cliToApiCase, "root-cause corpus should cover cli-to-api propagation");

  const cliToWebCase = payload.cases?.find(
    (entry) =>
      entry.name ===
      "CLI command resolution plus web component failure emits propagation via cli-to-web",
  );
  assert.ok(cliToWebCase, "root-cause corpus should cover cli-to-web propagation");

  const customTopologyCase = payload.cases?.find(
    (entry) =>
      entry.name === "Custom propagation topology emits web-to-api when defaults are disabled",
  );
  assert.ok(
    customTopologyCase,
    "root-cause corpus should cover operator-configurable propagation topology",
  );
  assert.deepEqual(
    customTopologyCase?.actualPropagations?.[0],
    {
      subject: "web-to-api",
      link: "shared-infra (timeout_or_latency on both)",
      calibration: { level: "low", signalCount: 2, sensorCount: 4, findingCount: 4 },
    },
    "root-cause corpus should report custom topology propagation details",
  );
}

function assertRootCauseCorpusDogfood(packageJson, readme, productPosture, passport) {
  const consumerSmoke = readText("scripts/consumer_contract_smoke.mjs");
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
  assert.match(
    packageJson.scripts?.["consumer:smoke"] ?? "",
    /consumer_contract_smoke\.mjs/,
    "package.json should expose the packed-consumer smoke",
  );
  assert.match(
    packageJson.scripts?.["release:check:quick"] ?? "",
    /consumer:smoke/,
    "release:check:quick should run the packed-consumer smoke",
  );
  assert.match(
    packageJson.scripts?.["release:check"] ?? "",
    /release:check:quick/,
    "release:check should include packed-consumer smoke through release:check:quick",
  );
  assert.match(consumerSmoke, /packed-root-cause-invariant/);
  assert.match(consumerSmoke, /packed-propagation-invariant/);
  assert.match(consumerSmoke, /kind === "propagation"/);
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
  assert.equal(
    observationProtocol.evidence?.commands?.includes("npm run consumer:smoke"),
    true,
    "observation protocol passport evidence should include npm run consumer:smoke",
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
assertPackedTypeSurface();
assertVisionCurrentRuntimeAlignment();
const passport = readJson("governance/capability-passport.json");
assertCurrentSurfaceAvoidsCausalityOverclaim({ readme, productPosture, passport });

assertPackedBombadilContract(packageJson, readme, productPosture);
assertRootCauseCorpusDogfood(packageJson, readme, productPosture, passport);
assertRootCauseCorpusExecutes();
assertPassportVocabulary(passport);
assertPassportGeneratedProjection();

console.log("capability-truth-gate: ok");
