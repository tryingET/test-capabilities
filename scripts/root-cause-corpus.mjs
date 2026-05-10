#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.resolve(
  process.env.TEST_CAPABILITIES_DIST_ROOT ?? path.join(repoRoot, "dist"),
);
const orchestratorModule = await import(
  pathToFileURL(path.join(distRoot, "core", "orchestrator.js")).href
);
const { TestCapabilitiesOrchestrator } = orchestratorModule;

const jsonMode = process.argv.includes("--json");
const observedAt = new Date("2026-01-01T00:00:00.000Z");
const results = [];

function finding({
  id,
  type = "bug",
  severity = "critical",
  component,
  description,
  evidence,
  recommendation,
}) {
  return {
    id,
    type,
    severity,
    component,
    description,
    evidence,
    recommendation,
    timestamp: observedAt,
  };
}

function observation({
  id,
  agent,
  kind,
  status,
  subject,
  component,
  summary,
  evidence = [],
  findingIds = [],
}) {
  return {
    protocol: "observation.v1",
    id,
    agent,
    kind,
    status,
    subject,
    summary,
    evidence,
    semantics: { component, interpretation: summary },
    findingIds,
    timestamp: observedAt,
  };
}

function agentResult({ findings = [], observations = [], coverage = {} }) {
  return {
    execute: async () => ({ findings, observations, coverage }),
  };
}

function baseConfig(name) {
  return {
    version: "2.0",
    name,
    targets: { cli: process.execPath },
    agents: {
      seed: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
    },
  };
}

function cliFailureAgent(agent, failureClass) {
  const timeout = failureClass === "timeout_or_latency";
  const id = `${agent}-${timeout ? "timeout" : "missing"}`;
  const description = timeout
    ? `CLI smoke command failed: ${agent} --help`
    : `CLI smoke command failed: /missing/${agent} --help`;
  const evidence = timeout
    ? [`timed out after 50ms (SIGKILL)`]
    : [`spawn /missing/${agent} ENOENT`];
  const summary = timeout
    ? "CLI smoke timed out before executable health could be established."
    : "CLI smoke could not resolve the configured executable.";

  return agentResult({
    findings: [
      finding({
        id,
        component: "cli",
        description,
        evidence,
        recommendation: timeout
          ? "Increase timeout or repair the command so --help exits promptly."
          : "Ensure the CLI command resolves and --help exits successfully.",
      }),
    ],
    observations: [
      observation({
        id: `${agent}-smoke-errored`,
        agent,
        kind: "smoke",
        status: "errored",
        subject: "cli",
        component: "cli",
        summary,
        evidence,
        findingIds: [id],
      }),
    ],
    coverage: { edgeCases: 0 },
  });
}

function surfFailureAgent(agent) {
  const id = `${agent}-surf-empty`;
  return agentResult({
    findings: [
      finding({
        id,
        component: "web",
        description: "Surf exploration produced no verified browser evidence",
        evidence: ["produced no runtime evidence"],
        recommendation: "Repair Surf runtime evidence before trusting coverage.",
      }),
    ],
    observations: [
      observation({
        id: `${agent}-coverage-errored`,
        agent,
        kind: "coverage",
        status: "errored",
        subject: "web",
        component: "web",
        summary: "Surf exploration did not produce verified browser-state coverage.",
        evidence: ["produced no runtime evidence"],
        findingIds: [id],
      }),
    ],
    coverage: { userFlows: 0 },
  });
}

function bombadilFailureAgent(agent) {
  const id = `${agent}-property-violation`;
  return agentResult({
    findings: [
      finding({
        id,
        component: "web",
        description: "Bombadil found a property violation while exploring https://example.com",
        evidence: ["violation: invariant failed", "trace: /tmp/fake-bombadil-trace"],
        recommendation: "Review the Bombadil trace and repair the violated behavior.",
        severity: "high",
      }),
    ],
    observations: [
      observation({
        id: `${agent}-property-failed`,
        agent,
        kind: "property",
        status: "failed",
        subject: "web",
        component: "web",
        summary: "Bombadil exploration surfaced a property violation.",
        evidence: ["violation: invariant failed"],
        findingIds: [id],
      }),
    ],
    coverage: { edgeCases: 100 },
  });
}

async function executeCase(definition) {
  const orchestrator = new TestCapabilitiesOrchestrator(baseConfig(definition.name));
  orchestrator.agents = new Map(Object.entries(definition.agents));
  const run = await orchestrator.run();
  const rootCauses = (run.observations ?? []).filter((entry) => entry.kind === "root_cause");
  const rootCause = definition.subject
    ? rootCauses.find((entry) => entry.subject === definition.subject)
    : rootCauses[0];

  if (definition.expectRootCause === false) {
    assert.equal(
      rootCause,
      undefined,
      `${definition.name}: unexpected root_cause ${rootCause?.summary ?? ""}`,
    );
  } else {
    assert.ok(rootCause, `${definition.name}: expected root_cause`);
    assert.match(
      rootCause.summary,
      new RegExp(`${definition.failureClass} as the current failure surface`),
    );
    assert.equal(rootCause.semantics?.calibration?.level, definition.level);
    assert.equal(rootCause.semantics?.calibration?.signalCount, definition.signalCount);
    assert.equal(rootCause.semantics?.calibration?.sensorCount, definition.sensorCount);
    assert.equal(rootCause.semantics?.calibration?.findingCount, definition.findingCount);
    assert.equal(
      rootCause.findingIds.some((id) => id.startsWith("corr-")),
      false,
    );
    assert.doesNotMatch(
      `${rootCause.summary}\n${rootCause.semantics?.interpretation ?? ""}\n${rootCause.semantics?.nextStep ?? ""}`,
      /predict|probability|horizon|future|will fail/i,
    );
  }

  results.push({
    status: "passed",
    name: definition.name,
    expected: definition.expectRootCause === false ? "none" : definition.failureClass,
  });

  if (!jsonMode) {
    console.log(`[pass] ${definition.name}`);
  }
}

const cases = [
  {
    name: "CLI missing command with one observed agent does not emit root_cause",
    subject: "cli",
    expectRootCause: false,
    agents: { cliA: cliFailureAgent("cliA", "command_resolution") },
  },
  {
    name: "CLI missing command with two observed agents classifies command_resolution",
    subject: "cli",
    failureClass: "command_resolution",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
    },
  },
  {
    name: "CLI timeout with two observed agents classifies timeout_or_latency",
    subject: "cli",
    failureClass: "timeout_or_latency",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      cliA: cliFailureAgent("cliA", "timeout_or_latency"),
      cliB: cliFailureAgent("cliB", "timeout_or_latency"),
    },
  },
  {
    name: "Surf fake coverage with one observed agent does not emit root_cause",
    subject: "web",
    expectRootCause: false,
    agents: { surfA: surfFailureAgent("surfA") },
  },
  {
    name: "Surf fake coverage with two observed agents classifies browser_coverage_gap",
    subject: "web",
    failureClass: "browser_coverage_gap",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      surfA: surfFailureAgent("surfA"),
      surfB: surfFailureAgent("surfB"),
    },
  },
  {
    name: "Bombadil property violations with two observed agents classify property_violation",
    subject: "web",
    failureClass: "property_violation",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      bombadilA: bombadilFailureAgent("bombadilA"),
      bombadilB: bombadilFailureAgent("bombadilB"),
    },
  },
  {
    name: "Mixed Surf and Bombadil failure classes do not emit root_cause",
    subject: "web",
    expectRootCause: false,
    agents: {
      surfA: surfFailureAgent("surfA"),
      bombadilA: bombadilFailureAgent("bombadilA"),
    },
  },
  {
    name: "Finding-only component does not emit root_cause",
    subject: "api",
    expectRootCause: false,
    agents: {
      otherObserved: agentResult({
        observations: [
          observation({
            id: "other-runtime-passed",
            agent: "otherObserved",
            kind: "runtime",
            status: "passed",
            subject: "other",
            component: "other",
            summary: "Other component passed.",
          }),
        ],
      }),
      apiFindings: agentResult({
        findings: [
          finding({
            id: "api-contract-drift",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema drift",
            evidence: ["schema mismatch"],
            recommendation: "Align schema.",
          }),
          finding({
            id: "api-validation-mismatch",
            component: "api",
            description: "API validation mismatch",
            evidence: ["validation mismatch"],
            recommendation: "Align validation.",
          }),
        ],
      }),
    },
  },
  {
    name: "Two sensors linked to the same finding classify contract_mismatch",
    subject: "api",
    failureClass: "contract_mismatch",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 1,
    agents: {
      apiObserverA: agentResult({
        observations: [
          observation({
            id: "api-contract-observed-a",
            agent: "apiObserverA",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API schema drift observed by sensor A.",
            findingIds: ["api-contract-drift"],
          }),
        ],
      }),
      apiObserverB: agentResult({
        observations: [
          observation({
            id: "api-contract-observed-b",
            agent: "apiObserverB",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API schema drift observed by sensor B.",
            findingIds: ["api-contract-drift"],
          }),
        ],
      }),
      apiFindings: agentResult({
        findings: [
          finding({
            id: "api-contract-drift",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema drift",
            evidence: ["schema mismatch"],
            recommendation: "Align schema.",
          }),
        ],
      }),
    },
  },
  {
    name: "Two passing sensors linked to the same finding do not emit root_cause",
    subject: "api",
    expectRootCause: false,
    agents: {
      apiObserverA: agentResult({
        observations: [
          observation({
            id: "api-contract-passed-a",
            agent: "apiObserverA",
            kind: "runtime",
            status: "passed",
            subject: "api",
            component: "api",
            summary: "API schema probe passed for sensor A.",
            findingIds: ["api-contract-drift"],
          }),
        ],
      }),
      apiObserverB: agentResult({
        observations: [
          observation({
            id: "api-contract-passed-b",
            agent: "apiObserverB",
            kind: "runtime",
            status: "passed",
            subject: "api",
            component: "api",
            summary: "API schema probe passed for sensor B.",
            findingIds: ["api-contract-drift"],
          }),
        ],
      }),
      apiFindings: agentResult({
        findings: [
          finding({
            id: "api-contract-drift",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema drift",
            evidence: ["stale schema mismatch"],
            recommendation: "Reconcile stale finding links before diagnosing.",
          }),
        ],
      }),
    },
  },
  {
    name: "Single sensor with multiple linked findings does not emit root_cause",
    subject: "api",
    expectRootCause: false,
    agents: {
      apiObserved: agentResult({
        observations: [
          observation({
            id: "api-multi-finding-observed",
            agent: "apiObserved",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API contract and validation drift observed by one sensor.",
            findingIds: ["api-contract-drift", "api-validation-mismatch"],
          }),
        ],
      }),
      apiFindings: agentResult({
        findings: [
          finding({
            id: "api-contract-drift",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema drift",
            evidence: ["schema mismatch"],
            recommendation: "Align schema.",
          }),
          finding({
            id: "api-validation-mismatch",
            component: "api",
            description: "API validation mismatch",
            evidence: ["validation mismatch"],
            recommendation: "Align validation.",
          }),
        ],
      }),
    },
  },
  {
    name: "Partial observed/unobserved finding pair does not emit root_cause",
    subject: "api",
    expectRootCause: false,
    agents: {
      apiObserved: agentResult({
        observations: [
          observation({
            id: "api-contract-observed",
            agent: "apiObserved",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API contract drift observed.",
            findingIds: ["api-contract-drift"],
          }),
        ],
      }),
      apiFindings: agentResult({
        findings: [
          finding({
            id: "api-contract-drift",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema drift",
            evidence: ["schema mismatch"],
            recommendation: "Align schema.",
          }),
          finding({
            id: "api-validation-mismatch",
            component: "api",
            description: "API validation mismatch",
            evidence: ["validation mismatch"],
            recommendation: "Align validation.",
          }),
        ],
      }),
    },
  },
];

try {
  for (const testCase of cases) {
    await executeCase(testCase);
  }

  const payload = {
    ok: true,
    total: results.length,
    passed: results.length,
    failed: 0,
    cases: results,
  };

  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`[pass] root-cause corpus complete (${results.length} cases)`);
  }
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          total: cases.length,
          passed: results.length,
          failed: 1,
          error: message,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(`[fail] root-cause corpus`);
    console.error(message);
  }
  process.exit(1);
}
