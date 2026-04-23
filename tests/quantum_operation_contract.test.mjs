import assert from "node:assert/strict";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { executeQuantumOperation } = await importRuntimeModule(
  "core/operations/quantum-operation.js",
);

test("executeQuantumOperation requires an explicit quantum target", async () => {
  await assert.rejects(
    async () => executeQuantumOperation({ branches: "1" }),
    /Quantum simulation requires --target with a valid URL/,
  );
});

test("executeQuantumOperation rejects invalid quantum targets", async () => {
  await assert.rejects(
    async () => executeQuantumOperation({ target: "not-a-url", branches: "1" }),
    /Quantum target must be a valid URL/,
  );
});

test("executeQuantumOperation rejects invalid quantum branch counts", async () => {
  await assert.rejects(
    async () => executeQuantumOperation({ target: "https://example.com", branches: "0" }),
    /Invalid value for --branches: 0/,
  );
});

test("executeQuantumOperation returns a normalized quantum result envelope", async () => {
  const result = await executeQuantumOperation({ target: "https://example.com", branches: "2" });

  assert.equal(result.operationId, "quantum");
  assert.equal(result.input.target, "https://example.com");
  assert.equal(result.input.branches, "2");
  assert.equal(result.input.collapse, false);
  assert.equal(result.result.branchesSimulated, 2);
});
