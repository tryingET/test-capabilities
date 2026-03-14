import assert from "node:assert/strict";
import test from "node:test";
import { QuantumSimulator } from "../src/quantum/simulator.ts";

function createInitialState() {
  return {
    url: "https://example.com",
    elements: ["button.login", "input.email", "a.about"],
    forms: ["login-form"],
    errors: [],
    network: {
      requestCount: 0,
      errorCount: 0,
      avgLatency: 1200,
      slowRequests: [],
    },
    performance: {
      tti: 1000,
      fcp: 500,
      lcp: 700,
      cls: 0.01,
    },
  };
}

function comparable(result) {
  return {
    branchesSimulated: result.branchesSimulated,
    uniquePaths: result.uniquePaths,
    collapsedFindings: result.collapsedFindings,
    edgeCases: result.edgeCases,
    rareBugs: result.rareBugs,
    coverage: result.coverage,
  };
}

test("QuantumSimulator does not mutate caller state and is deterministic for a fixed seed", async () => {
  const initialState = createInitialState();
  const snapshot = JSON.parse(JSON.stringify(initialState));
  const simulator = new QuantumSimulator({
    branches: 3,
    maxDepth: 6,
    seed: 42,
    collapseStrategy: "coverage",
  });

  const first = await simulator.simulate(initialState);
  const second = await simulator.simulate(initialState);

  assert.deepEqual(initialState, snapshot);
  assert.deepEqual(comparable(first), comparable(second));
  assert.equal(first.coverage.paths > 0, true);
});

test("QuantumSimulator significance mode surfaces high-severity latency findings", async () => {
  const simulator = new QuantumSimulator({
    branches: 2,
    maxDepth: 4,
    seed: 42,
    collapseStrategy: "significance",
  });

  const result = await simulator.simulate(createInitialState());

  assert.equal(result.collapsedFindings.length > 0, true);
  assert.equal(
    result.collapsedFindings.some((finding) => finding.type === "performance_issue"),
    true,
  );
});

test("QuantumSimulator surfaces non-empty edge-case findings for real edge heuristics", async () => {
  const simulator = new QuantumSimulator({
    branches: 1,
    maxDepth: 20,
    seed: 42,
    collapseStrategy: "coverage",
  });

  const result = await simulator.simulate(createInitialState());

  assert.equal(result.edgeCases.length > 0, true);
  assert.equal(
    result.edgeCases.every((finding) => finding.type === "edge_case"),
    true,
  );
});

test("QuantumSimulator rare bug output is deduplicated by semantic finding", async () => {
  const simulator = new QuantumSimulator({
    branches: 1,
    maxDepth: 20,
    seed: 42,
    collapseStrategy: "coverage",
  });

  const result = await simulator.simulate(createInitialState());
  const descriptions = result.rareBugs.map((finding) => finding.description);

  assert.equal(new Set(descriptions).size, descriptions.length);
});

test("QuantumSimulator reports only branches that actually entered simulation", async () => {
  const simulator = new QuantumSimulator({
    branches: 5,
    maxDepth: 1,
    timeout: 0,
    seed: 42,
  });

  const result = await simulator.simulate(createInitialState());

  assert.equal(result.branchesSimulated, 0);
  assert.equal(result.uniquePaths, 0);
});
