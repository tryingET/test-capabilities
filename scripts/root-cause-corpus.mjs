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

function cliShellNotFoundAgent(agent) {
  const id = `${agent}-shell-not-found`;
  const evidence = [`sh: 1: ${agent}-missing: not found`];
  return agentResult({
    findings: [
      finding({
        id,
        component: "cli",
        description: `CLI smoke command failed: ${agent}-missing --help`,
        evidence,
        recommendation: "Ensure the CLI command resolves and --help exits successfully.",
      }),
    ],
    observations: [
      observation({
        id: `${agent}-shell-not-found-errored`,
        agent,
        kind: "smoke",
        status: "errored",
        subject: "cli",
        component: "cli",
        summary: "CLI smoke shell reported command not found.",
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

function surfDomCoverageAgent(agent) {
  const id = `${agent}-surf-dom-coverage`;
  return agentResult({
    findings: [
      finding({
        id,
        component: "web",
        description: "Surf browser coverage found a DOM element missing during probe verification",
        evidence: ["browser-state present but DOM element missing during coverage probe"],
        recommendation: "Repair Surf runtime evidence before trusting coverage.",
      }),
    ],
    observations: [
      observation({
        id: `${agent}-dom-coverage-errored`,
        agent,
        kind: "coverage",
        status: "errored",
        subject: "web",
        component: "web",
        summary: "Surf browser coverage saw DOM element missing during probe verification.",
        evidence: ["browser-state present but DOM element missing during coverage probe"],
        findingIds: [id],
      }),
    ],
    coverage: { userFlows: 25 },
  });
}

function selectorDriftAgent(agent) {
  const id = `${agent}-selector-drift`;
  return agentResult({
    findings: [
      finding({
        id,
        component: "web",
        description:
          "Selector drift: CSS selector [data-testid='submit-order'] matched zero elements",
        evidence: [
          "css selector [data-testid='submit-order'] matched zero elements",
          "stale element reference at checkout submit",
        ],
        recommendation:
          "Update the selector or restore the stable data-testid before rerunning heal.",
        severity: "high",
      }),
    ],
    observations: [
      observation({
        id: `${agent}-selector-failed`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "web",
        component: "web",
        summary: "Selector locator drift observed for data-testid submit-order.",
        evidence: [
          "css selector [data-testid='submit-order'] matched zero elements",
          "stale element reference at checkout submit",
        ],
        findingIds: [id],
      }),
    ],
    coverage: { userFlows: 0 },
  });
}

function selectorContractDriftAgent(agent) {
  const id = `${agent}-selector-contract-drift`;
  return agentResult({
    findings: [
      finding({
        id,
        component: "web",
        description:
          "Selector contract changed: CSS selector [data-testid='submit-order'] matched zero elements",
        evidence: ["data-testid contract changed for checkout submit selector"],
        recommendation: "Update the selector contract or restore the stable data-testid.",
        severity: "high",
      }),
    ],
    observations: [
      observation({
        id: `${agent}-selector-contract-failed`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "web",
        component: "web",
        summary: "Selector contract changed for data-testid submit-order.",
        evidence: ["data-testid contract changed for checkout submit selector"],
        findingIds: [id],
      }),
    ],
    coverage: { userFlows: 0 },
  });
}

function domDriftAgent(agent) {
  const id = `${agent}-dom-drift`;
  return agentResult({
    findings: [
      finding({
        id,
        component: "web",
        description: "DOM drift: checkout submit node missing from rendered page",
        evidence: ["expected DOM node for submit action was removed from checkout"],
        recommendation: "Restore the submit node or update the flow before rerunning heal.",
        severity: "high",
      }),
    ],
    observations: [
      observation({
        id: `${agent}-dom-failed`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "web",
        component: "web",
        summary: "DOM drift observed: checkout submit node missing.",
        evidence: ["expected DOM node for submit action was removed from checkout"],
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

function bombadilRequiredPropertyAgent(agent) {
  const id = `${agent}-required-property`;
  return agentResult({
    findings: [
      finding({
        id,
        component: "web",
        description: "Bombadil found required property validation failure in generated state",
        evidence: ["property validation failed: required property id missing"],
        recommendation: "Review the Bombadil trace and repair the violated invariant.",
        severity: "high",
      }),
    ],
    observations: [
      observation({
        id: `${agent}-required-property-failed`,
        agent,
        kind: "property",
        status: "failed",
        subject: "web",
        component: "web",
        summary: "Bombadil property validation failed for required property id.",
        evidence: ["property validation failed: required property id missing"],
        findingIds: [id],
      }),
    ],
    coverage: { edgeCases: 100 },
  });
}

function apiContractViolationAgent(agent) {
  return agentResult({
    observations: [
      observation({
        id: `${agent}-api-contract-violation`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "api",
        component: "api",
        summary: "API contract violation observed during schema validation.",
        evidence: ["response body violates required schema contract"],
      }),
    ],
  });
}

function apiPayloadElementAgent(agent) {
  return agentResult({
    observations: [
      observation({
        id: `${agent}-api-payload-element-missing`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "api",
        component: "api",
        summary: "Response payload element missing from checkout response.",
        evidence: ["required payload element totalPrice was missing from JSON response"],
      }),
    ],
  });
}

function apiPropertyKindContractAgent(agent) {
  return agentResult({
    observations: [
      observation({
        id: `${agent}-api-property-contract`,
        agent,
        kind: "property",
        status: "failed",
        subject: "api",
        component: "api",
        summary: "API response payload required field id missing.",
        evidence: ["response payload required field id missing"],
      }),
    ],
  });
}

function apiPropertyKindRuntimeAgent(agent) {
  return agentResult({
    observations: [
      observation({
        id: `${agent}-api-property-runtime`,
        agent,
        kind: "property",
        status: "failed",
        subject: "api",
        component: "api",
        summary: "API property probe hit TypeError during request processing.",
        evidence: ["TypeError: cannot read properties of undefined"],
      }),
    ],
  });
}

function apiRuntimeExceptionAgent(agent) {
  return agentResult({
    observations: [
      observation({
        id: `${agent}-api-runtime-exception`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "api",
        component: "api",
        summary: "API handler threw TypeError during request processing.",
        evidence: ["TypeError: cannot read properties of undefined"],
      }),
    ],
  });
}

function apiLinkedRuntimeObservationAgent(agent) {
  return agentResult({
    observations: [
      observation({
        id: `${agent}-api-linked-runtime-exception`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "api",
        component: "api",
        summary: "API handler threw TypeError during request processing.",
        evidence: ["TypeError: cannot read properties of undefined"],
        findingIds: ["api-contract-drift"],
      }),
    ],
  });
}

function apiStackTraceExceptionAgent(agent) {
  return agentResult({
    observations: [
      observation({
        id: `${agent}-api-stack-trace-exception`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "api",
        component: "api",
        summary: "API handler threw TypeError with stack trace evidence.",
        evidence: ["stack trace: TypeError at handler.ts:12"],
      }),
    ],
  });
}

function apiValidationExceptionAgent(agent) {
  return agentResult({
    observations: [
      observation({
        id: `${agent}-api-validation-exception`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "api",
        component: "api",
        summary: "API handler raised ValidationError for invalid date input.",
        evidence: ["ValidationError: invalid date"],
      }),
    ],
  });
}

function apiSchemaExceptionAgent(agent) {
  return agentResult({
    observations: [
      observation({
        id: `${agent}-api-schema-exception`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: "api",
        component: "api",
        summary: "API handler raised SchemaError during request processing.",
        evidence: ["SchemaError: invalid schema configuration"],
      }),
    ],
  });
}

function componentFailureAgent(agent, component, findingId) {
  const evidence = [`${component} runtime raised TypeError during component health check`];
  return agentResult({
    findings: [
      finding({
        id: findingId,
        component,
        description: `${component} component health check failed during runtime probe`,
        evidence,
        recommendation: `Investigate ${component} runtime health before trusting downstream signals.`,
      }),
    ],
    observations: [
      observation({
        id: `${agent}-${component}-component-failed`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: component,
        component,
        summary: `${component} runtime failed during component health check.`,
        evidence,
        findingIds: [findingId],
      }),
    ],
    coverage: component === "web" ? { userFlows: 0 } : { edgeCases: 0 },
  });
}

function componentTimeoutAgent(agent, component, findingId) {
  const evidence = [`${component} health check timed out after 5000ms`];
  return agentResult({
    findings: [
      finding({
        id: findingId,
        component,
        description: `${component} component timed out during health check`,
        evidence,
        recommendation: `Investigate ${component} latency before treating the timeout as isolated.`,
      }),
    ],
    observations: [
      observation({
        id: `${agent}-${component}-timeout`,
        agent,
        kind: "runtime",
        status: "failed",
        subject: component,
        component,
        summary: `${component} runtime timed out during component health check.`,
        evidence,
        findingIds: [findingId],
      }),
    ],
    coverage: component === "web" ? { userFlows: 0 } : { edgeCases: 0 },
  });
}

function summarizeCoverage(entries) {
  const increment = (map, key) => {
    map[key] = (map[key] ?? 0) + 1;
  };
  const expectedClasses = {};
  const actualClasses = {};
  const subjects = {};

  for (const entry of entries) {
    const expectedRootCauses = entry.expectedRootCauses ?? [
      { subject: entry.subject, failureClass: entry.expected },
    ];
    const actualRootCauses = entry.actualRootCauses ?? [
      { subject: entry.subject, failureClass: entry.actual },
    ];

    for (const expectedRootCause of expectedRootCauses) {
      increment(expectedClasses, expectedRootCause.failureClass);
      if (expectedRootCause.subject) {
        increment(subjects, expectedRootCause.subject);
      }
    }
    for (const actualRootCause of actualRootCauses) {
      increment(actualClasses, actualRootCause.failureClass);
    }
  }

  return {
    total: entries.length,
    positiveRootCauseCases: entries.filter((entry) => entry.expected !== "none").length,
    noRootCauseCases: entries.filter((entry) => entry.expected === "none").length,
    highCalibrationRootCauseCases: entries.filter((entry) => {
      if (entry.expected === "none") {
        return false;
      }
      const calibrations = entry.calibrations ?? (entry.calibration ? [entry.calibration] : []);
      return (
        calibrations.length > 0 && calibrations.every((calibration) => calibration.level === "high")
      );
    }).length,
    expectedClasses,
    actualClasses,
    subjects,
  };
}

function assertCoverageFloors(coverage) {
  const requiredExpectedClasses = [
    "none",
    "browser_coverage_gap",
    "command_resolution",
    "component_failure_surface",
    "contract_mismatch",
    "property_violation",
    "selector_or_dom_drift",
    "timeout_or_latency",
  ];

  assert.equal(coverage.total, cases.length, "coverage summary must account for every case");
  assert.ok(coverage.total >= 35, "root-cause corpus must keep at least 35 cases");
  assert.ok(
    coverage.positiveRootCauseCases >= 20,
    "root-cause corpus must keep at least 20 positive root-cause cases",
  );
  assert.ok(
    coverage.noRootCauseCases >= 8,
    "root-cause corpus must keep at least 8 no-root-cause guardrail cases",
  );
  assert.equal(
    coverage.highCalibrationRootCauseCases,
    coverage.positiveRootCauseCases,
    "every positive root-cause case must remain highly calibrated",
  );
  for (const expectedClass of requiredExpectedClasses) {
    assert.ok(
      coverage.expectedClasses[expectedClass] > 0,
      `root-cause corpus must include expected class ${expectedClass}`,
    );
  }
  for (const subject of ["api", "cli", "web"]) {
    assert.ok(coverage.subjects[subject] > 0, `root-cause corpus must include subject ${subject}`);
  }
}

async function executeCase(definition) {
  const orchestrator = new TestCapabilitiesOrchestrator({
    ...baseConfig(definition.name),
    ...(definition.config ?? {}),
  });
  orchestrator.agents = new Map(Object.entries(definition.agents));
  const run = await orchestrator.run();
  const rootCauses = (run.observations ?? []).filter((entry) => entry.kind === "root_cause");
  const propagations = (run.observations ?? []).filter((entry) => entry.kind === "propagation");
  const rootCause = definition.subject
    ? rootCauses.find((entry) => entry.subject === definition.subject)
    : rootCauses[0];

  const failureClassFor = (entry) =>
    entry?.evidence?.find((item) => item.startsWith("failureClass:"))?.replace("failureClass:", "");
  const summarizeCalibration = (calibration) => ({
    level: calibration.level,
    signalCount: calibration.signalCount,
    sensorCount: calibration.sensorCount,
    findingCount: calibration.findingCount,
  });
  const assertRootCause = (entry, expectation) => {
    assert.ok(entry, `${definition.name}: expected ${expectation.subject} root_cause`);
    assert.match(
      entry.summary,
      new RegExp(`${expectation.failureClass} as the current failure surface`),
    );
    assert.equal(failureClassFor(entry), expectation.failureClass);
    assert.equal(entry.semantics?.calibration?.level, expectation.level);
    assert.equal(entry.semantics?.calibration?.signalCount, expectation.signalCount);
    assert.equal(entry.semantics?.calibration?.sensorCount, expectation.sensorCount);
    assert.equal(entry.semantics?.calibration?.findingCount, expectation.findingCount);
    if (expectation.findingIds) {
      assert.deepEqual([...entry.findingIds].sort(), [...expectation.findingIds].sort());
    }
    assert.equal(
      entry.findingIds.some((id) => id.startsWith("corr-")),
      false,
    );
    assert.doesNotMatch(
      `${entry.summary}\n${entry.semantics?.interpretation ?? ""}\n${entry.semantics?.nextStep ?? ""}`,
      /predict|probability|horizon|future|will fail/i,
    );
  };

  if (definition.expectRootCause === false) {
    assert.equal(
      rootCauses.length,
      0,
      `${definition.name}: unexpected root_cause ${rootCauses.map((entry) => entry.summary).join("; ")}`,
    );
  } else if (definition.expectedRootCauses) {
    assert.equal(
      rootCauses.length,
      definition.expectedRootCauses.length,
      `${definition.name}: expected ${definition.expectedRootCauses.length} root_cause observations, got ${rootCauses.length}`,
    );
    for (const expectation of definition.expectedRootCauses) {
      assertRootCause(
        rootCauses.find((entry) => entry.subject === expectation.subject),
        expectation,
      );
    }
  } else {
    assert.equal(
      rootCauses.length,
      1,
      `${definition.name}: expected exactly one root_cause, got ${rootCauses.length}`,
    );
    assertRootCause(rootCause, definition);
  }

  const actualFailureClass = failureClassFor(rootCause);
  const calibration = rootCause?.semantics?.calibration;
  const expectedRootCauses = definition.expectedRootCauses?.map((entry) => ({
    subject: entry.subject,
    failureClass: entry.failureClass,
  }));
  const actualRootCauses = definition.expectedRootCauses
    ? rootCauses.map((entry) => ({
        subject: entry.subject,
        failureClass: failureClassFor(entry) ?? "root_cause",
      }))
    : undefined;
  const calibrations = definition.expectedRootCauses
    ? rootCauses.map((entry) => summarizeCalibration(entry.semantics.calibration))
    : undefined;

  // Propagation assertions
  if (definition.expectNoPropagation === true) {
    assert.equal(
      propagations.length,
      0,
      `${definition.name}: unexpected propagation ${propagations.map((e) => e.summary).join("; ")}`,
    );
  }
  if (definition.expectPropagation) {
    const ep = definition.expectPropagation;
    assert.ok(
      propagations.some((p) => p.subject === ep.subject),
      `${definition.name}: expected propagation with subject ${ep.subject}, got subjects: ${propagations.map((p) => p.subject).join(", ")}`,
    );
    const propObs = propagations.find((p) => p.subject === ep.subject);
    if (ep.link) {
      assert.match(propObs.summary, new RegExp(ep.link, "i"));
    }
    assert.equal(
      propObs.semantics?.calibration?.level,
      "low",
      `${definition.name}: propagation calibration must be low (heuristic)`,
    );
    assert.match(
      propObs.evidence.join("\n"),
      /non-authoritative/i,
      `${definition.name}: propagation evidence must declare non-authoritative status`,
    );
    assert.doesNotMatch(
      `${propObs.summary}\n${propObs.semantics?.interpretation ?? ""}`,
      /predict|probability|horizon|future|will fail/i,
    );
  }

  results.push({
    status: "passed",
    name: definition.name,
    ...(definition.expectedRootCauses ? {} : { subject: definition.subject ?? rootCause?.subject }),
    expected:
      definition.expectRootCause === false
        ? "none"
        : definition.expectedRootCauses
          ? "multi"
          : definition.failureClass,
    actual: definition.expectedRootCauses
      ? "multi"
      : rootCause
        ? (actualFailureClass ?? "root_cause")
        : "none",
    rootCauseCount: rootCauses.length,
    ...(expectedRootCauses ? { expectedRootCauses } : {}),
    ...(actualRootCauses ? { actualRootCauses } : {}),
    ...(calibrations ? { calibrations } : {}),
    ...(!definition.expectedRootCauses && calibration
      ? {
          calibration: summarizeCalibration(calibration),
          findingIds: rootCause.findingIds,
        }
      : {}),
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
    name: "CLI shell not-found wording classifies command_resolution",
    subject: "cli",
    failureClass: "command_resolution",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      cliA: cliShellNotFoundAgent("cliA"),
      cliB: cliShellNotFoundAgent("cliB"),
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
    name: "Mixed CLI command-resolution and timeout evidence does not emit root_cause",
    subject: "cli",
    expectRootCause: false,
    agents: {
      cliMissing: cliFailureAgent("cliMissing", "command_resolution"),
      cliTimeout: cliFailureAgent("cliTimeout", "timeout_or_latency"),
    },
  },
  {
    name: "CLI app crash does not classify as command_resolution",
    subject: "cli",
    failureClass: "component_failure_surface",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      cliA: agentResult({
        findings: [
          finding({
            id: "cliA-app-crash",
            component: "cli",
            description: "CLI smoke command failed: app --help",
            evidence: ["TypeError: cannot read config"],
            recommendation: "Fix the runtime exception so --help exits successfully.",
          }),
        ],
        observations: [
          observation({
            id: "cliA-smoke-failed",
            agent: "cliA",
            kind: "smoke",
            status: "failed",
            subject: "cli",
            component: "cli",
            summary: "CLI smoke hit an application runtime exception.",
            evidence: ["TypeError: cannot read config"],
            findingIds: ["cliA-app-crash"],
          }),
        ],
      }),
      cliB: agentResult({
        findings: [
          finding({
            id: "cliB-app-crash",
            component: "cli",
            description: "CLI smoke command failed: app --help",
            evidence: ["TypeError: cannot read config"],
            recommendation: "Fix the runtime exception so --help exits successfully.",
          }),
        ],
        observations: [
          observation({
            id: "cliB-smoke-failed",
            agent: "cliB",
            kind: "smoke",
            status: "failed",
            subject: "cli",
            component: "cli",
            summary: "CLI smoke hit an application runtime exception.",
            evidence: ["TypeError: cannot read config"],
            findingIds: ["cliB-app-crash"],
          }),
        ],
      }),
    },
  },
  {
    name: "CLI diagnosis remains isolated from unrelated ambiguous web signals",
    subject: "cli",
    failureClass: "command_resolution",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
      surfA: surfFailureAgent("surfA"),
      bombadilA: bombadilFailureAgent("bombadilA"),
    },
  },
  {
    name: "Independent CLI and API failures emit component-scoped root_causes",
    expectedRootCauses: [
      {
        subject: "api",
        failureClass: "contract_mismatch",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 0,
        findingIds: [],
      },
      {
        subject: "cli",
        failureClass: "command_resolution",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["cliA-missing", "cliB-missing"],
      },
    ],
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
      apiA: apiContractViolationAgent("apiA"),
      apiB: apiContractViolationAgent("apiB"),
    },
  },
  {
    name: "CLI diagnosis survives suppressed API mixed-class ambiguity",
    subject: "cli",
    failureClass: "command_resolution",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    findingIds: ["cliA-missing", "cliB-missing"],
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
      apiContract: apiContractViolationAgent("apiContract"),
      apiRuntime: apiRuntimeExceptionAgent("apiRuntime"),
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
    name: "Surf DOM coverage wording without selector evidence classifies browser_coverage_gap",
    subject: "web",
    failureClass: "browser_coverage_gap",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      surfDomA: surfDomCoverageAgent("surfDomA"),
      surfDomB: surfDomCoverageAgent("surfDomB"),
    },
  },
  {
    name: "Selector drift with one observed agent does not emit root_cause",
    subject: "web",
    expectRootCause: false,
    agents: { selectorA: selectorDriftAgent("selectorA") },
  },
  {
    name: "Selector drift with two observed agents classifies selector_or_dom_drift",
    subject: "web",
    failureClass: "selector_or_dom_drift",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      selectorA: selectorDriftAgent("selectorA"),
      selectorB: selectorDriftAgent("selectorB"),
    },
  },
  {
    name: "Selector contract wording classifies selector_or_dom_drift",
    subject: "web",
    failureClass: "selector_or_dom_drift",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      selectorA: selectorContractDriftAgent("selectorA"),
      selectorB: selectorContractDriftAgent("selectorB"),
    },
  },
  {
    name: "DOM drift with two observed agents classifies selector_or_dom_drift",
    subject: "web",
    failureClass: "selector_or_dom_drift",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      domA: domDriftAgent("domA"),
      domB: domDriftAgent("domB"),
    },
  },
  {
    name: "Unobserved selector drift finding does not emit root_cause",
    subject: "web",
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
      selectorFindings: agentResult({
        findings: [
          finding({
            id: "web-selector-stale",
            severity: "high",
            component: "web",
            description: "Selector drift: stale locator for checkout submit button",
            evidence: ["stale selector finding from previous run"],
            recommendation: "Rerun selector sensors before diagnosing.",
          }),
        ],
      }),
    },
  },
  {
    name: "Same-component unobserved selector drift finding suppresses root_cause",
    subject: "web",
    expectRootCause: false,
    agents: {
      surfA: surfFailureAgent("surfA"),
      surfB: surfFailureAgent("surfB"),
      selectorFindings: agentResult({
        findings: [
          finding({
            id: "web-selector-stale",
            severity: "high",
            component: "web",
            description: "Selector drift: stale locator for checkout submit button",
            evidence: ["stale selector finding from previous run"],
            recommendation: "Rerun selector sensors before diagnosing.",
          }),
        ],
      }),
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
    name: "Bombadil required-property validation wording classifies property_violation",
    subject: "web",
    failureClass: "property_violation",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    agents: {
      bombadilA: bombadilRequiredPropertyAgent("bombadilA"),
      bombadilB: bombadilRequiredPropertyAgent("bombadilB"),
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
    name: "Majority Surf with conflicting Bombadil class does not emit root_cause",
    subject: "web",
    expectRootCause: false,
    agents: {
      surfA: surfFailureAgent("surfA"),
      surfB: surfFailureAgent("surfB"),
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
    name: "Mixed API contract and runtime evidence does not emit root_cause",
    subject: "api",
    expectRootCause: false,
    agents: {
      apiContract: apiContractViolationAgent("apiContract"),
      apiRuntime: apiRuntimeExceptionAgent("apiRuntime"),
    },
  },
  {
    name: "Linked API contract finding with runtime observations does not emit root_cause",
    subject: "api",
    expectRootCause: false,
    agents: {
      apiObserverA: apiLinkedRuntimeObservationAgent("apiObserverA"),
      apiObserverB: apiLinkedRuntimeObservationAgent("apiObserverB"),
      apiFindings: agentResult({
        findings: [
          finding({
            id: "api-contract-drift",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema validation mismatch",
            evidence: ["schema validation mismatch"],
            recommendation: "Align schema.",
          }),
        ],
      }),
    },
  },
  {
    name: "Observation-only API signals classify contract_mismatch",
    subject: "api",
    failureClass: "contract_mismatch",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 0,
    findingIds: [],
    agents: {
      apiObserverA: agentResult({
        observations: [
          observation({
            id: "api-observation-only-a",
            agent: "apiObserverA",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API schema mismatch observed by sensor A.",
            evidence: ["schema mismatch"],
          }),
        ],
      }),
      apiObserverB: agentResult({
        observations: [
          observation({
            id: "api-observation-only-b",
            agent: "apiObserverB",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API schema mismatch observed by sensor B.",
            evidence: ["schema mismatch"],
          }),
        ],
      }),
    },
  },
  {
    name: "Observation-only API contract violation wording classifies contract_mismatch",
    subject: "api",
    failureClass: "contract_mismatch",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 0,
    findingIds: [],
    agents: {
      apiViolationA: apiContractViolationAgent("apiViolationA"),
      apiViolationB: apiContractViolationAgent("apiViolationB"),
    },
  },
  {
    name: "Observation-only API response payload element missing classifies contract_mismatch",
    subject: "api",
    failureClass: "contract_mismatch",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 0,
    findingIds: [],
    agents: {
      apiPayloadA: apiPayloadElementAgent("apiPayloadA"),
      apiPayloadB: apiPayloadElementAgent("apiPayloadB"),
    },
  },
  {
    name: "API property-kind payload evidence classifies contract_mismatch",
    subject: "api",
    failureClass: "contract_mismatch",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 0,
    findingIds: [],
    agents: {
      apiPropertyA: apiPropertyKindContractAgent("apiPropertyA"),
      apiPropertyB: apiPropertyKindContractAgent("apiPropertyB"),
    },
  },
  {
    name: "API property-kind runtime exception without contract evidence classifies component_failure_surface",
    subject: "api",
    failureClass: "component_failure_surface",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 0,
    findingIds: [],
    agents: {
      apiPropertyRuntimeA: apiPropertyKindRuntimeAgent("apiPropertyRuntimeA"),
      apiPropertyRuntimeB: apiPropertyKindRuntimeAgent("apiPropertyRuntimeB"),
    },
  },
  {
    name: "API runtime exception without contract evidence classifies component_failure_surface",
    subject: "api",
    failureClass: "component_failure_surface",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 0,
    findingIds: [],
    agents: {
      apiRuntimeA: apiRuntimeExceptionAgent("apiRuntimeA"),
      apiRuntimeB: apiRuntimeExceptionAgent("apiRuntimeB"),
    },
  },
  {
    name: "API stack trace exception without property evidence classifies component_failure_surface",
    subject: "api",
    failureClass: "component_failure_surface",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 0,
    findingIds: [],
    agents: {
      apiTraceA: apiStackTraceExceptionAgent("apiTraceA"),
      apiTraceB: apiStackTraceExceptionAgent("apiTraceB"),
    },
  },
  {
    name: "API validation exception without contract evidence classifies component_failure_surface",
    subject: "api",
    failureClass: "component_failure_surface",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 0,
    findingIds: [],
    agents: {
      apiValidationA: apiValidationExceptionAgent("apiValidationA"),
      apiValidationB: apiValidationExceptionAgent("apiValidationB"),
    },
  },
  {
    name: "API schema exception without contract evidence classifies component_failure_surface",
    subject: "api",
    failureClass: "component_failure_surface",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 0,
    findingIds: [],
    agents: {
      apiSchemaA: apiSchemaExceptionAgent("apiSchemaA"),
      apiSchemaB: apiSchemaExceptionAgent("apiSchemaB"),
    },
  },
  {
    name: "API contract finding with browser-word observations classifies contract_mismatch",
    subject: "api",
    failureClass: "contract_mismatch",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 1,
    findingIds: ["api-contract-drift"],
    agents: {
      apiObserverA: agentResult({
        observations: [
          observation({
            id: "api-browser-word-observed-a",
            agent: "apiObserverA",
            kind: "coverage",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "Browser user-flow saw API schema validation mismatch.",
            evidence: ["browser-state included API schema validation mismatch"],
            findingIds: ["api-contract-drift"],
          }),
        ],
      }),
      apiObserverB: agentResult({
        observations: [
          observation({
            id: "api-browser-word-observed-b",
            agent: "apiObserverB",
            kind: "coverage",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "Browser user-flow saw API schema validation mismatch.",
            evidence: ["browser-state included API schema validation mismatch"],
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
            description: "API schema validation mismatch",
            evidence: ["schema validation mismatch"],
            recommendation: "Align schema.",
          }),
        ],
      }),
    },
  },
  {
    name: "Foreign observation finding IDs stay out of API root_cause",
    subject: "api",
    failureClass: "contract_mismatch",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    findingIds: ["api-contract-a", "api-contract-b"],
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
            summary: "API schema mismatch observed by sensor A.",
            evidence: ["schema mismatch"],
            findingIds: ["api-contract-a", "foreign-web-critical"],
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
            summary: "API schema mismatch observed by sensor B.",
            evidence: ["schema mismatch"],
            findingIds: ["api-contract-b"],
          }),
        ],
      }),
      apiFindings: agentResult({
        findings: [
          finding({
            id: "api-contract-a",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema mismatch A",
            evidence: ["schema mismatch"],
            recommendation: "Align schema.",
          }),
          finding({
            id: "api-contract-b",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema mismatch B",
            evidence: ["schema mismatch"],
            recommendation: "Align schema.",
          }),
          finding({
            id: "foreign-web-critical",
            type: "bug",
            severity: "critical",
            component: "web",
            description: "Web selector drift",
            evidence: ["selector drift"],
            recommendation: "Fix web selector.",
          }),
        ],
      }),
    },
  },
  {
    name: "Extra same-class unlinked API finding preserves contract_mismatch",
    subject: "api",
    failureClass: "contract_mismatch",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    findingIds: ["api-contract-a", "api-contract-b"],
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
            summary: "API schema mismatch observed by sensor A.",
            evidence: ["schema mismatch"],
            findingIds: ["api-contract-a"],
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
            summary: "API schema mismatch observed by sensor B.",
            evidence: ["schema mismatch"],
            findingIds: ["api-contract-b"],
          }),
        ],
      }),
      apiFindings: agentResult({
        findings: [
          finding({
            id: "api-contract-a",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema mismatch A",
            evidence: ["schema mismatch"],
            recommendation: "Align schema.",
          }),
          finding({
            id: "api-contract-b",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema mismatch B",
            evidence: ["schema mismatch"],
            recommendation: "Align schema.",
          }),
          finding({
            id: "api-contract-extra",
            type: "api_contract",
            severity: "high",
            component: "api",
            description: "API schema mismatch from an unlinked same-class sensor artifact",
            evidence: ["schema mismatch"],
            recommendation: "Keep diagnosis on observed current-run evidence.",
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
    name: "Two sensors plus unobserved conflicting finding do not emit root_cause",
    subject: "api",
    expectRootCause: false,
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
          finding({
            id: "api-timeout",
            type: "performance",
            severity: "high",
            component: "api",
            description: "API timed out without an observed current-run sensor link.",
            evidence: ["stale timeout finding"],
            recommendation: "Rerun timeout sensor before diagnosing.",
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
  // Three-sensor agreement proves calibration works beyond exactly-two
  {
    name: "Three sensors agreeing on CLI command_resolution emit high-calibration root_cause",
    subject: "cli",
    failureClass: "command_resolution",
    level: "high",
    signalCount: 3,
    sensorCount: 3,
    findingCount: 3,
    findingIds: ["cliA-missing", "cliB-missing", "cliC-missing"],
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
      cliC: cliFailureAgent("cliC", "command_resolution"),
    },
  },
  // Bombadil + CLI cross-component simultaneous diagnoses
  {
    name: "Independent Bombadil and CLI failures emit component-scoped root_causes",
    expectedRootCauses: [
      {
        subject: "cli",
        failureClass: "command_resolution",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["cliA-missing", "cliB-missing"],
      },
      {
        subject: "web",
        failureClass: "property_violation",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["bombadilA-property-violation", "bombadilB-property-violation"],
      },
    ],
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
      bombadilA: bombadilFailureAgent("bombadilA"),
      bombadilB: bombadilFailureAgent("bombadilB"),
    },
  },
  // Three-way simultaneous: web + cli + api all fail independently
  {
    name: "Three-way simultaneous Surf, CLI, and API failures emit three component-scoped root_causes",
    expectedRootCauses: [
      {
        subject: "api",
        failureClass: "contract_mismatch",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 0,
        findingIds: [],
      },
      {
        subject: "cli",
        failureClass: "command_resolution",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["cliA-missing", "cliB-missing"],
      },
      {
        subject: "web",
        failureClass: "browser_coverage_gap",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["surfA-surf-empty", "surfB-surf-empty"],
      },
    ],
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
      surfA: surfFailureAgent("surfA"),
      surfB: surfFailureAgent("surfB"),
      apiA: apiContractViolationAgent("apiA"),
      apiB: apiContractViolationAgent("apiB"),
    },
  },
  // Propagation synthesis cases
  {
    name: "Single root_cause does not emit propagation",
    subject: "cli",
    failureClass: "command_resolution",
    level: "high",
    signalCount: 2,
    sensorCount: 2,
    findingCount: 2,
    expectNoPropagation: true,
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
    },
  },
  {
    name: "Two independent root_causes on unrelated components do not emit propagation",
    expectedRootCauses: [
      {
        subject: "cli",
        failureClass: "command_resolution",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["cliA-missing", "cliB-missing"],
      },
      {
        subject: "web",
        failureClass: "property_violation",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["bombadilA-property-violation", "bombadilB-property-violation"],
      },
    ],
    expectNoPropagation: true,
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
      bombadilA: bombadilFailureAgent("bombadilA"),
      bombadilB: bombadilFailureAgent("bombadilB"),
    },
  },
  {
    name: "API timeout + web component_failure emits propagation via api-latency-cascade",
    expectedRootCauses: [
      {
        subject: "api",
        failureClass: "timeout_or_latency",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["api-timeout-a", "api-timeout-b"],
      },
      {
        subject: "web",
        failureClass: "component_failure_surface",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["web-fail-a", "web-fail-b"],
      },
    ],
    expectPropagation: {
      subject: "api-to-web",
      link: "api-latency-cascade",
    },
    agents: {
      apiTimeoutA: agentResult({
        findings: [
          finding({
            id: "api-timeout-a",
            component: "api",
            description: "API endpoint timed out during health check",
            evidence: ["timed out after 5000ms (SIGTERM)"],
            recommendation: "Investigate API latency.",
          }),
        ],
        observations: [
          observation({
            id: "api-timeout-obs-a",
            agent: "apiTimeoutA",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API smoke timed out before health could be established.",
            evidence: ["timed out after 5000ms (SIGTERM)"],
            findingIds: ["api-timeout-a"],
          }),
        ],
        coverage: { edgeCases: 0 },
      }),
      apiTimeoutB: agentResult({
        findings: [
          finding({
            id: "api-timeout-b",
            component: "api",
            description: "API endpoint timed out on second probe",
            evidence: ["timed out after 5000ms"],
            recommendation: "Investigate API latency.",
          }),
        ],
        observations: [
          observation({
            id: "api-timeout-obs-b",
            agent: "apiTimeoutB",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API smoke timed out on second probe.",
            evidence: ["timed out after 5000ms"],
            findingIds: ["api-timeout-b"],
          }),
        ],
        coverage: { edgeCases: 0 },
      }),
      webFailA: agentResult({
        findings: [
          finding({
            id: "web-fail-a",
            component: "web",
            description: "Web page failed to load due to backend unavailability",
            evidence: ["backend connection refused"],
            recommendation: "Check backend services.",
          }),
        ],
        observations: [
          observation({
            id: "web-fail-obs-a",
            agent: "webFailA",
            kind: "runtime",
            status: "failed",
            subject: "web",
            component: "web",
            summary: "Web runtime failed during page load.",
            evidence: ["backend connection refused"],
            findingIds: ["web-fail-a"],
          }),
        ],
        coverage: { userFlows: 0 },
      }),
      webFailB: agentResult({
        findings: [
          finding({
            id: "web-fail-b",
            component: "web",
            description: "Web page render failed from missing backend data",
            evidence: ["render error: no backend response"],
            recommendation: "Check backend services.",
          }),
        ],
        observations: [
          observation({
            id: "web-fail-obs-b",
            agent: "webFailB",
            kind: "runtime",
            status: "failed",
            subject: "web",
            component: "web",
            summary: "Web runtime failed during render.",
            evidence: ["render error: no backend response"],
            findingIds: ["web-fail-b"],
          }),
        ],
        coverage: { userFlows: 0 },
      }),
    },
  },
  {
    name: "Propagation observations do not make prediction claims",
    expectedRootCauses: [
      {
        subject: "api",
        failureClass: "timeout_or_latency",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["api-timeout-a", "api-timeout-b"],
      },
      {
        subject: "web",
        failureClass: "component_failure_surface",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["web-fail-a", "web-fail-b"],
      },
    ],
    expectPropagation: {
      subject: "api-to-web",
    },
    agents: {
      apiTimeoutA: agentResult({
        findings: [
          finding({
            id: "api-timeout-a",
            component: "api",
            description: "API endpoint timed out",
            evidence: ["timed out after 5000ms (SIGTERM)"],
            recommendation: "Investigate API latency.",
          }),
        ],
        observations: [
          observation({
            id: "api-timeout-obs-a",
            agent: "apiTimeoutA",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API smoke timed out.",
            evidence: ["timed out after 5000ms (SIGTERM)"],
            findingIds: ["api-timeout-a"],
          }),
        ],
        coverage: { edgeCases: 0 },
      }),
      apiTimeoutB: agentResult({
        findings: [
          finding({
            id: "api-timeout-b",
            component: "api",
            description: "API endpoint timed out on retry",
            evidence: ["timed out after 5000ms"],
            recommendation: "Investigate API latency.",
          }),
        ],
        observations: [
          observation({
            id: "api-timeout-obs-b",
            agent: "apiTimeoutB",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API smoke timed out on retry.",
            evidence: ["timed out after 5000ms"],
            findingIds: ["api-timeout-b"],
          }),
        ],
        coverage: { edgeCases: 0 },
      }),
      webFailA: agentResult({
        findings: [
          finding({
            id: "web-fail-a",
            component: "web",
            description: "Web page failed to load",
            evidence: ["backend connection refused"],
            recommendation: "Check backend services.",
          }),
        ],
        observations: [
          observation({
            id: "web-fail-obs-a",
            agent: "webFailA",
            kind: "runtime",
            status: "failed",
            subject: "web",
            component: "web",
            summary: "Web runtime failed during page load.",
            evidence: ["backend connection refused"],
            findingIds: ["web-fail-a"],
          }),
        ],
        coverage: { userFlows: 0 },
      }),
      webFailB: agentResult({
        findings: [
          finding({
            id: "web-fail-b",
            component: "web",
            description: "Web page render failed",
            evidence: ["render error: no backend response"],
            recommendation: "Check backend services.",
          }),
        ],
        observations: [
          observation({
            id: "web-fail-obs-b",
            agent: "webFailB",
            kind: "runtime",
            status: "failed",
            subject: "web",
            component: "web",
            summary: "Web runtime failed during render.",
            evidence: ["render error: no backend response"],
            findingIds: ["web-fail-b"],
          }),
        ],
        coverage: { userFlows: 0 },
      }),
    },
  },
  {
    name: "Same failure class across api and web emits propagation via shared-infra",
    expectedRootCauses: [
      {
        subject: "api",
        failureClass: "timeout_or_latency",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["api-timeout-a", "api-timeout-b"],
      },
      {
        subject: "web",
        failureClass: "timeout_or_latency",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["web-timeout-a", "web-timeout-b"],
      },
    ],
    expectPropagation: {
      subject: "api-to-web",
      link: "shared-infra",
    },
    agents: {
      apiTimeoutA: agentResult({
        findings: [
          finding({
            id: "api-timeout-a",
            component: "api",
            description: "API endpoint timed out",
            evidence: ["timed out after 5000ms (SIGTERM)"],
            recommendation: "Investigate API latency.",
          }),
        ],
        observations: [
          observation({
            id: "api-timeout-obs-a",
            agent: "apiTimeoutA",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API smoke timed out.",
            evidence: ["timed out after 5000ms (SIGTERM)"],
            findingIds: ["api-timeout-a"],
          }),
        ],
        coverage: { edgeCases: 0 },
      }),
      apiTimeoutB: agentResult({
        findings: [
          finding({
            id: "api-timeout-b",
            component: "api",
            description: "API endpoint timed out on retry",
            evidence: ["timed out after 5000ms"],
            recommendation: "Investigate API latency.",
          }),
        ],
        observations: [
          observation({
            id: "api-timeout-obs-b",
            agent: "apiTimeoutB",
            kind: "runtime",
            status: "failed",
            subject: "api",
            component: "api",
            summary: "API smoke timed out on retry.",
            evidence: ["timed out after 5000ms"],
            findingIds: ["api-timeout-b"],
          }),
        ],
        coverage: { edgeCases: 0 },
      }),
      webTimeoutA: agentResult({
        findings: [
          finding({
            id: "web-timeout-a",
            component: "web",
            description: "Web page load timed out waiting for backend",
            evidence: ["timed out after 10000ms"],
            recommendation: "Check backend responsiveness.",
          }),
        ],
        observations: [
          observation({
            id: "web-timeout-obs-a",
            agent: "webTimeoutA",
            kind: "runtime",
            status: "failed",
            subject: "web",
            component: "web",
            summary: "Web runtime timed out during page load.",
            evidence: ["timed out after 10000ms"],
            findingIds: ["web-timeout-a"],
          }),
        ],
        coverage: { userFlows: 0 },
      }),
      webTimeoutB: agentResult({
        findings: [
          finding({
            id: "web-timeout-b",
            component: "web",
            description: "Web page load timed out on second probe",
            evidence: ["timed out after 10000ms (SIGKILL)"],
            recommendation: "Check backend responsiveness.",
          }),
        ],
        observations: [
          observation({
            id: "web-timeout-obs-b",
            agent: "webTimeoutB",
            kind: "runtime",
            status: "failed",
            subject: "web",
            component: "web",
            summary: "Web runtime timed out on second probe.",
            evidence: ["timed out after 10000ms (SIGKILL)"],
            findingIds: ["web-timeout-b"],
          }),
        ],
        coverage: { userFlows: 0 },
      }),
    },
  },
  {
    name: "CLI command resolution plus API component failure emits propagation via cli-to-api",
    expectedRootCauses: [
      {
        subject: "cli",
        failureClass: "command_resolution",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["cliA-missing", "cliB-missing"],
      },
      {
        subject: "api",
        failureClass: "component_failure_surface",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["api-component-a", "api-component-b"],
      },
    ],
    expectPropagation: {
      subject: "cli-to-api",
      link: "cli-tool-failure-blocks-api-check",
    },
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
      apiComponentA: componentFailureAgent("apiComponentA", "api", "api-component-a"),
      apiComponentB: componentFailureAgent("apiComponentB", "api", "api-component-b"),
    },
  },
  {
    name: "CLI command resolution plus web component failure emits propagation via cli-to-web",
    expectedRootCauses: [
      {
        subject: "cli",
        failureClass: "command_resolution",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["cliA-missing", "cliB-missing"],
      },
      {
        subject: "web",
        failureClass: "component_failure_surface",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["web-component-a", "web-component-b"],
      },
    ],
    expectPropagation: {
      subject: "cli-to-web",
      link: "cli-tool-failure-blocks-web-check",
    },
    agents: {
      cliA: cliFailureAgent("cliA", "command_resolution"),
      cliB: cliFailureAgent("cliB", "command_resolution"),
      webComponentA: componentFailureAgent("webComponentA", "web", "web-component-a"),
      webComponentB: componentFailureAgent("webComponentB", "web", "web-component-b"),
    },
  },
  {
    name: "Custom propagation topology emits web-to-api when defaults are disabled",
    config: {
      intelligence: {
        correlation: true,
        propagationTopology: {
          includeDefaults: false,
          edges: [{ upstream: "web", downstream: "api" }],
        },
      },
    },
    expectedRootCauses: [
      {
        subject: "web",
        failureClass: "timeout_or_latency",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["web-config-timeout-a", "web-config-timeout-b"],
      },
      {
        subject: "api",
        failureClass: "timeout_or_latency",
        level: "high",
        signalCount: 2,
        sensorCount: 2,
        findingCount: 2,
        findingIds: ["api-config-timeout-a", "api-config-timeout-b"],
      },
    ],
    expectPropagation: {
      subject: "web-to-api",
      link: "shared-infra",
    },
    agents: {
      webTimeoutA: componentTimeoutAgent("webTimeoutA", "web", "web-config-timeout-a"),
      webTimeoutB: componentTimeoutAgent("webTimeoutB", "web", "web-config-timeout-b"),
      apiTimeoutA: componentTimeoutAgent("apiTimeoutA", "api", "api-config-timeout-a"),
      apiTimeoutB: componentTimeoutAgent("apiTimeoutB", "api", "api-config-timeout-b"),
    },
  },
];

try {
  for (const testCase of cases) {
    await executeCase(testCase);
  }

  const coverage = summarizeCoverage(results);
  assertCoverageFloors(coverage);

  const payload = {
    ok: true,
    total: results.length,
    passed: results.length,
    failed: 0,
    coverage,
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
