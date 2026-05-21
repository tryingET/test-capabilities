import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { importRuntimeModule, runtimeEnv } from "./helpers/runtime-dist.mjs";

const binPath = new URL("../bin/test-capabilities", import.meta.url).pathname;

const {
  createReplacementValidationPlan,
  REPLACEMENT_VALIDATION_REQUEST_SCHEMA_VERSION,
  REPLACEMENT_VALIDATION_RESULT_SCHEMA_VERSION,
} = await importRuntimeModule("index.js");

const schemaPaths = [
  "schemas/testcapabilities.replacement-validation-request.v1.schema.json",
  "schemas/testcapabilities.replacement-validation-result.v1.schema.json",
];

function validRequest(overrides = {}) {
  return {
    schemaVersion: REPLACEMENT_VALIDATION_REQUEST_SCHEMA_VERSION,
    target: { repositoryPath: "." },
    candidateChangeRef: {
      kind: "dep-surgeon-plan",
      path: "out/dep-surgeon/chalk-plan.json",
    },
    evidenceRefs: [
      {
        kind: "dep-diet-review-program",
        path: "out/depdiet/dependency-review-program.v1.json",
      },
    ],
    impactScope: {
      packageNames: ["chalk"],
      changedPaths: ["bin/test-capabilities"],
      requiredProofCodes: [
        "terminal-rendering-equivalence",
        "impact-scoped-tests",
      ],
      validationCommands: [
        "node --test tests/dependency_intelligence_chalk_proof.test.mjs",
      ],
    },
    dryRun: true,
    ...overrides,
  };
}

for (const schemaPath of schemaPaths) {
  test(`${schemaPath} is a parseable interop schema with authority boundaries`, () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    assert.equal(schema["$schema"], "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    if (schemaPath.includes("request")) {
      assert.deepEqual(schema.required, ["schemaVersion", "candidateChangeRef", "impactScope"]);
      assert.deepEqual(schema.properties.impactScope.required, ["packageNames", "validationCommands"]);
      assert.equal(schema.properties.impactScope.properties.packageNames.minItems, 1);
      assert.equal(schema.properties.impactScope.properties.validationCommands.minItems, 1);
    }
    if (schemaPath.includes("result")) {
      const nonAuthorizations = schema.properties.nonAuthorizations.properties;
      assert.equal(nonAuthorizations.mutationAuthority.const, false);
      assert.equal(nonAuthorizations.dependencyChangeAuthority.const, false);
      assert.equal(nonAuthorizations.replacementAuthority.const, false);
      assert.equal(nonAuthorizations.mergeAuthority.const, false);
      assert.equal(nonAuthorizations.releaseAuthority.const, false);
      assert.equal(nonAuthorizations.exploitabilityAuthority.const, false);
      assert.equal(nonAuthorizations.disclosureAuthority.const, false);
      assert.equal(nonAuthorizations.trustCertificationAuthority.const, false);
      assert.equal(schema.properties.execution.properties.executed.const, false);
    }
  });
}

test("replacement validation membrane plans explicit target-owned commands without executing them", () => {
  const result = createReplacementValidationPlan(validRequest());

  assert.equal(result.schemaVersion, REPLACEMENT_VALIDATION_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, "planned");
  assert.equal(result.execution.executed, false);
  assert.deepEqual(result.requestSummary.packageNames, ["chalk"]);
  assert.deepEqual(result.selectedCommands.map((entry) => entry.command), [
    "node --test tests/dependency_intelligence_chalk_proof.test.mjs",
  ]);
  assert.equal(
    result.selectedCommands.every((entry) => entry.mode === "planned-not-executed"),
    true,
  );
  assert.equal(result.nonAuthorizations.mutationAuthority, false);
  assert.equal(result.nonAuthorizations.dependencyChangeAuthority, false);
  assert.equal(result.nonAuthorizations.replacementAuthority, false);
  assert.equal(result.nonAuthorizations.mergeAuthority, false);
  assert.equal(result.nonAuthorizations.releaseAuthority, false);
  assert.equal(result.nonAuthorizations.exploitabilityAuthority, false);
  assert.equal(result.nonAuthorizations.disclosureAuthority, false);
  assert.equal(result.nonAuthorizations.trustCertificationAuthority, false);
  assert.match(result.authority, /does not authorize mutation/);
});

test("replacement validation membrane fails closed without a dep-surgeon candidate ref", () => {
  const request = validRequest({ candidateChangeRef: undefined });
  const result = createReplacementValidationPlan(request);

  assert.equal(result.status, "unsupported");
  assert.deepEqual(result.selectedCommands, []);
  assert.equal(result.execution.executed, false);
  assert.equal(
    result.diagnostics.some(
      (entry) => entry.code === "replacementValidation.candidateChangeRefRequired",
    ),
    true,
  );
});

test("replacement validation membrane rejects non dep-surgeon candidate refs", () => {
  const result = createReplacementValidationPlan(
    validRequest({
      candidateChangeRef: {
        kind: "dep-diet-review-program",
        path: "out/depdiet/dependency-review-program.v1.json",
      },
    }),
  );

  assert.equal(result.status, "unsupported");
  assert.equal(
    result.diagnostics.some(
      (entry) => entry.code === "replacementValidation.depSurgeonRefRequired",
    ),
    true,
  );
});

test("replacement-validation CLI plans from a dep-surgeon request without executing commands", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-replacement-validation-"));
  const requestPath = path.join(tempDir, "request.json");
  const resultPath = path.join(tempDir, "result.json");

  try {
    writeFileSync(requestPath, `${JSON.stringify(validRequest(), null, 2)}\n`, "utf8");
    const result = spawnSync(
      process.execPath,
      [binPath, "replacement-validation", "plan", "--request", requestPath, "--out", resultPath, "--json"],
      {
        encoding: "utf8",
        env: runtimeEnv({ PATH: path.dirname(process.execPath) }),
      },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr.trim(), "");
    const envelope = JSON.parse(result.stdout);
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(envelope.operationId, "replacement-validation");
    assert.equal(envelope.result.status, "planned");
    assert.equal(envelope.result.execution.executed, false);
    assert.deepEqual(written, envelope.result);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("replacement-validation CLI writes unsupported results and exits non-zero for incomplete requests", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-replacement-validation-unsupported-"));
  const requestPath = path.join(tempDir, "request.json");
  const resultPath = path.join(tempDir, "result.json");

  try {
    writeFileSync(requestPath, `${JSON.stringify({
      schemaVersion: REPLACEMENT_VALIDATION_REQUEST_SCHEMA_VERSION,
      impactScope: {
        packageNames: ["chalk"],
        validationCommands: ["node --test tests/dependency_intelligence_chalk_proof.test.mjs"],
      },
    }, null, 2)}\n`, "utf8");
    const result = spawnSync(
      process.execPath,
      [binPath, "replacement-validation", "plan", "--request", requestPath, "--out", resultPath, "--json"],
      {
        encoding: "utf8",
        env: runtimeEnv({ PATH: path.dirname(process.execPath) }),
      },
    );

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr.trim(), "");
    const envelope = JSON.parse(result.stdout);
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(envelope.operationId, "replacement-validation");
    assert.equal(envelope.result.status, "unsupported");
    assert.deepEqual(written, envelope.result);
    assert.equal(envelope.result.execution.executed, false);
    assert.equal(
      envelope.result.diagnostics.some(
        (entry) => entry.code === "replacementValidation.candidateChangeRefRequired",
      ),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("replacement validation membrane fails closed without explicit impact scope commands", () => {
  const result = createReplacementValidationPlan(
    validRequest({
      impactScope: {
        packageNames: ["chalk"],
        validationCommands: [],
      },
    }),
  );

  assert.equal(result.status, "unsupported");
  assert.deepEqual(result.selectedCommands, []);
  assert.equal(
    result.diagnostics.some((entry) => entry.code === "replacementValidation.commandsRequired"),
    true,
  );
});
