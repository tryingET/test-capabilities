import test from "node:test";
import assert from "node:assert/strict";

import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const {
  createReplacementValidationPlan,
  REPLACEMENT_VALIDATION_REQUEST_SCHEMA_VERSION,
  REPLACEMENT_VALIDATION_RESULT_SCHEMA_VERSION,
} = await importRuntimeModule("index.js");

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
