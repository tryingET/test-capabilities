import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import fc from "fast-check";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { TestCapabilitiesConfigSchema, TestCapabilitiesOrchestrator } =
  await importRuntimeModule("index.js");
const { validateCapabilityContract } = await importRuntimeModule("core/capabilities.js");
const { CLI_ROUTE_MANIFEST, resolveCliRoute } = await importRuntimeModule(
  "core/operations/dispatch-manifest.js",
);
const { requireManifestEntry, requireRegisteredOperation } = await importRuntimeModule(
  "core/operations/dispatch-execution.js",
);

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "version",
  "name",
  "targets",
  "agents",
  "intelligence",
  "quantum",
  "chaos",
]);

const KNOWN_COMMANDS = [...new Set(CLI_ROUTE_MANIFEST.map((entry) => entry.command))];
const KNOWN_SURF_ACTIONS = CLI_ROUTE_MANIFEST.filter(
  (entry) => entry.command === "surf" && typeof entry.action === "string",
).map((entry) => entry.action);
const KNOWN_SURF_ACTION_SET = new Set(KNOWN_SURF_ACTIONS);
const SEVERITY_WEIGHT = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const configNameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 -]{0,31}$/);
const unknownTopLevelKeyArb = fc
  .stringMatching(/^[a-z][a-z0-9_-]{0,12}$/)
  .filter((key) => !KNOWN_TOP_LEVEL_KEYS.has(key));
const unknownCommandArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,10}$/)
  .filter((command) => !KNOWN_COMMANDS.includes(command));
const unknownSurfActionArb = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,10}$/)
  .filter((action) => !KNOWN_SURF_ACTION_SET.has(action));
const findingDescriptionArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .:/_-]{0,40}$/);
const findingEvidenceArb = fc.stringMatching(/^[A-Za-z0-9 .:/_-]{1,30}$/);
const componentArb = fc.constantFrom("cli", "web", "api", "checkout", "auth");
const severityArb = fc.constantFrom("low", "medium", "high", "critical");
const findingTypeArb = fc.constantFrom(
  "bug",
  "performance",
  "security",
  "accessibility",
  "ux",
  "api_contract",
  "race_condition",
  "memory_leak",
  "visual_regression",
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBaseSupportedConfig(name = "Property Config") {
  return {
    version: "2.0",
    name,
    targets: { cli: process.execPath },
    agents: {
      cli: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
    },
  };
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round(sum / values.length);
}

function calculateExpectedCoverage(results) {
  const collect = (selector) =>
    results.map(selector).filter((value) => typeof value === "number" && Number.isFinite(value));

  const dimensionValues = {
    userFlows: collect((result) => result.coverage.userFlows),
    apiEndpoints: collect((result) => result.coverage.apiEndpoints),
    edgeCases: collect((result) => result.coverage.edgeCases),
  };

  const userFlows = average(dimensionValues.userFlows);
  const apiEndpoints = average(dimensionValues.apiEndpoints);
  const edgeCases = average(dimensionValues.edgeCases);
  const measuredDimensions = Object.entries(dimensionValues)
    .filter(([, values]) => values.length > 0)
    .map(([dimension]) => dimension);
  const unmeasuredDimensions = Object.keys(dimensionValues).filter(
    (dimension) => !measuredDimensions.includes(dimension),
  );
  const coverageByDimension = {
    userFlows,
    apiEndpoints,
    edgeCases,
  };
  const overall = average(measuredDimensions.map((dimension) => coverageByDimension[dimension]));
  const status =
    measuredDimensions.length === 0
      ? "unmeasured"
      : unmeasuredDimensions.length > 0
        ? "partial"
        : "verified";

  return {
    userFlows,
    apiEndpoints,
    edgeCases,
    overall,
    measuredDimensions,
    unmeasuredDimensions,
    status,
  };
}

function getHighestSeverity(findings) {
  return findings.reduce(
    (highest, finding) =>
      SEVERITY_WEIGHT[finding.severity] > SEVERITY_WEIGHT[highest] ? finding.severity : highest,
    "low",
  );
}

function calculateExpectedCorrelations(findings) {
  const correlations = [];
  const byComponent = new Map();

  for (const finding of findings) {
    const existing = byComponent.get(finding.component) ?? [];
    existing.push(finding);
    byComponent.set(finding.component, existing);
  }

  for (const [component, componentFindings] of byComponent) {
    if (componentFindings.length <= 1) {
      continue;
    }

    const apiFinding = componentFindings.find((finding) => finding.type === "api_contract");
    const uiFinding = componentFindings.find((finding) => finding.type === "bug");

    if (apiFinding && uiFinding) {
      correlations.push({
        id: `corr-${component}`,
        type: "bug",
        severity: "high",
        component,
        description: "Cross-domain issue: API validation differs from UI handling",
        evidence: [apiFinding.description, uiFinding.description],
        recommendation: `Align API and UI validation for ${component}`,
      });
      continue;
    }

    correlations.push({
      id: `corr-${component}`,
      type: "bug",
      severity: getHighestSeverity(componentFindings),
      component,
      description: `Correlated findings indicate a systemic issue in ${component}`,
      evidence: [...new Set(componentFindings.map((finding) => finding.description))],
      recommendation: `Investigate ${component} as one systemic failure surface instead of isolated finding(s).`,
    });
  }

  return correlations;
}

function comparableFinding(finding) {
  return {
    id: finding.id,
    type: finding.type,
    severity: finding.severity,
    component: finding.component,
    description: finding.description,
    evidence: finding.evidence,
    recommendation: finding.recommendation,
  };
}

function sortById(left, right) {
  return left.id.localeCompare(right.id);
}

test("property: schema alias normalization stays stable across snake_case and camelCase config shapes", async () => {
  await fc.assert(
    fc.property(
      fc.record({
        name: configNameArb,
        includeIntelligence: fc.boolean(),
        selfHealing: fc.boolean(),
        prediction: fc.boolean(),
        correlation: fc.boolean(),
        collective: fc.boolean(),
        includeQuantum: fc.boolean(),
        quantumEnabled: fc.boolean(),
        branches: fc.integer({ min: 1, max: 300 }),
        collapseStrategy: fc.constantFrom("significance", "diversity", "coverage"),
        maxDepth: fc.integer({ min: 1, max: 50 }),
        timeout: fc.option(
          fc.oneof(
            fc.integer({ min: 1, max: 120_000 }),
            fc.constantFrom("50ms", "1s", "2m", "30s"),
          ),
          { nil: undefined },
        ),
      }),
      (shape) => {
        const baseConfig = buildBaseSupportedConfig(shape.name);
        const intelligenceSnake = shape.includeIntelligence
          ? {
              self_healing: shape.selfHealing,
              prediction: shape.prediction,
              correlation: shape.correlation,
              collective: shape.collective,
            }
          : undefined;
        const intelligenceCamel = shape.includeIntelligence
          ? {
              selfHealing: shape.selfHealing,
              prediction: shape.prediction,
              correlation: shape.correlation,
              collective: shape.collective,
            }
          : undefined;
        const quantumSnake = shape.includeQuantum
          ? {
              enabled: shape.quantumEnabled,
              branches: shape.branches,
              collapse_strategy: shape.collapseStrategy,
              max_depth: shape.maxDepth,
              timeout: shape.timeout,
            }
          : undefined;
        const quantumCamel = shape.includeQuantum
          ? {
              enabled: shape.quantumEnabled,
              branches: shape.branches,
              collapseStrategy: shape.collapseStrategy,
              maxDepth: shape.maxDepth,
              timeout: shape.timeout,
            }
          : undefined;
        const targets = {
          ...baseConfig.targets,
          ...(shape.includeQuantum && shape.quantumEnabled ? { web: "https://example.com" } : {}),
        };

        const rawSnake = {
          ...baseConfig,
          targets,
          ...(intelligenceSnake ? { intelligence: intelligenceSnake } : {}),
          ...(quantumSnake ? { quantum: quantumSnake } : {}),
        };
        const rawCamel = {
          ...baseConfig,
          targets,
          ...(intelligenceCamel ? { intelligence: intelligenceCamel } : {}),
          ...(quantumCamel ? { quantum: quantumCamel } : {}),
        };

        const parsedSnake = TestCapabilitiesConfigSchema.parse(rawSnake);
        const parsedCamel = TestCapabilitiesConfigSchema.parse(rawCamel);

        assert.deepEqual(parsedSnake, parsedCamel);

        if (shape.includeIntelligence) {
          assert.equal(parsedSnake.intelligence?.selfHealing, shape.selfHealing);
          assert.equal(parsedSnake.intelligence?.prediction, shape.prediction);
          assert.equal(parsedSnake.intelligence?.correlation, shape.correlation);
          assert.equal(parsedSnake.intelligence?.collective, shape.collective);
          assert.equal(Object.hasOwn(parsedSnake.intelligence ?? {}, "self_healing"), false);
        } else {
          assert.equal(parsedSnake.intelligence, undefined);
        }

        if (shape.includeQuantum) {
          assert.equal(parsedSnake.quantum?.enabled, shape.quantumEnabled);
          assert.equal(parsedSnake.quantum?.branches, shape.branches);
          assert.equal(parsedSnake.quantum?.collapseStrategy, shape.collapseStrategy);
          assert.equal(parsedSnake.quantum?.maxDepth, shape.maxDepth);
          assert.equal(Object.hasOwn(parsedSnake.quantum ?? {}, "collapse_strategy"), false);
          assert.equal(Object.hasOwn(parsedSnake.quantum ?? {}, "max_depth"), false);
        } else {
          assert.equal(parsedSnake.quantum, undefined);
        }

        const unsupportedIntelligenceEnabled =
          shape.includeIntelligence && (shape.selfHealing || shape.prediction || shape.collective);

        if (unsupportedIntelligenceEnabled) {
          assert.throws(
            () => validateCapabilityContract(parsedSnake),
            /Unsupported intelligence capability\/capabilities/,
          );
        } else {
          assert.doesNotThrow(() => validateCapabilityContract(parsedSnake));
        }
      },
    ),
    { numRuns: 60 },
  );
});

test("property: schema stays strict for unknown top-level keys", async () => {
  await fc.assert(
    fc.property(
      unknownTopLevelKeyArb,
      fc.oneof(fc.boolean(), fc.integer(), fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/)),
      (unknownKey, value) => {
        const raw = {
          ...buildBaseSupportedConfig("Strict Config"),
          [unknownKey]: value,
        };

        assert.throws(() => TestCapabilitiesConfigSchema.parse(raw));
      },
    ),
    { numRuns: 30 },
  );
});

test("property: route selection stays aligned with the manifest and registry", async () => {
  await fc.assert(
    fc.property(
      fc.oneof(fc.constantFrom(...KNOWN_COMMANDS), unknownCommandArb),
      fc.option(fc.oneof(fc.constantFrom(...KNOWN_SURF_ACTIONS), unknownSurfActionArb), {
        nil: undefined,
      }),
      (command, action) => {
        const route = action === undefined ? { command } : { command, action };
        const manifestEntry = resolveCliRoute(route);

        if (command === "surf" && action === undefined) {
          assert.throws(
            () => requireManifestEntry(route),
            /Unsupported surf action\(s\): \(missing action\)/,
          );
          return;
        }

        if (command === "surf" && action !== undefined && !KNOWN_SURF_ACTION_SET.has(action)) {
          assert.equal(manifestEntry, undefined);
          assert.throws(
            () => requireManifestEntry(route),
            new RegExp(`Unsupported surf action\\(s\\): ${escapeRegExp(action)}`),
          );
          return;
        }

        if (!manifestEntry) {
          assert.throws(
            () => requireManifestEntry(route),
            new RegExp(`Unsupported CLI command\\(s\\): ${escapeRegExp(command)}`),
          );
          return;
        }

        assert.deepEqual(requireManifestEntry(route), manifestEntry);

        if (manifestEntry.status === "implemented" && manifestEntry.operationId) {
          assert.equal(requireRegisteredOperation(manifestEntry).id, manifestEntry.operationId);
        } else {
          assert.throws(
            () => requireRegisteredOperation(manifestEntry),
            /Unsupported (CLI command|surf action)\(s\):/,
          );
        }
      },
    ),
    { numRuns: 80 },
  );
});

test("property: orchestrator coverage and correlation invariants stay stable for arbitrary agent mixes", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          findings: fc.array(
            fc.record({
              idSuffix: fc.integer({ min: 0, max: 10_000 }),
              type: findingTypeArb,
              severity: severityArb,
              component: componentArb,
              description: findingDescriptionArb,
              evidence: fc.array(findingEvidenceArb, { minLength: 1, maxLength: 3 }),
              recommendation: findingDescriptionArb,
            }),
            { maxLength: 4 },
          ),
          coverage: fc.record({
            userFlows: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
            apiEndpoints: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
            edgeCases: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
          }),
        }),
        { minLength: 1, maxLength: 4 },
      ),
      async (agentResultsInput) => {
        const agentResults = agentResultsInput.map((result, agentIndex) => ({
          findings: result.findings.map((finding, findingIndex) => ({
            id: `gen-${agentIndex}-${findingIndex}-${finding.idSuffix}`,
            type: finding.type,
            severity: finding.severity,
            component: finding.component,
            description: finding.description,
            evidence: finding.evidence,
            recommendation: finding.recommendation,
            timestamp: new Date("2026-01-01T00:00:00.000Z"),
          })),
          coverage: result.coverage,
        }));

        const orchestrator = new TestCapabilitiesOrchestrator(
          buildBaseSupportedConfig("Generated Agent Results"),
        );
        orchestrator.agents = new Map(
          agentResults.map((result, index) => [
            `fake-${index}`,
            {
              execute: async () => result,
            },
          ]),
        );

        const run = await orchestrator.run();
        const rawFindings = agentResults.flatMap((result) => result.findings);
        const expectedCorrelations = calculateExpectedCorrelations(rawFindings);
        const expectedCoverage = calculateExpectedCoverage(agentResults);
        const expectedFindings = [...rawFindings, ...expectedCorrelations];
        const actualCorrelationFindings = run.findings
          .filter((finding) => finding.id.startsWith("corr-"))
          .map(comparableFinding)
          .sort(sortById);
        const comparableExpectedCorrelations = expectedCorrelations
          .map(comparableFinding)
          .sort(sortById);
        const hasBlockingFinding = expectedFindings.some(
          (finding) => finding.severity === "high" || finding.severity === "critical",
        );

        assert.deepEqual(run.coverage, expectedCoverage);
        assert.equal(run.findings.length, expectedFindings.length);
        assert.deepEqual(actualCorrelationFindings, comparableExpectedCorrelations);
        assert.equal(
          run.findings.filter((finding) => finding.id.startsWith("corr-")).length,
          expectedCorrelations.length,
        );
        assert.equal(run.quantumInsights, undefined);
        assert.equal(run.predictions?.length ?? 0, 0);
        assert.deepEqual(run.observations, []);
        assert.equal(run.passed, !hasBlockingFinding && expectedCoverage.overall > 0);

        for (const finding of rawFindings) {
          assert.equal(
            run.findings.some((candidate) => candidate.id === finding.id),
            true,
          );
        }
      },
    ),
    { numRuns: 40 },
  );
});
