#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
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
const predictionLanguage =
  /predict|probability|horizon|future|will fail|causal proof|repair order/i;
const results = [];

function quoteCommandPart(value) {
  return JSON.stringify(value);
}

function cliTargetFor(scriptPath) {
  return `${quoteCommandPart(process.execPath)} ${quoteCommandPart(scriptPath)}`;
}

function executableTargetFor(executablePath) {
  return quoteCommandPart(executablePath);
}

function baseConfig(name, target, agents, intelligence = { correlation: true }) {
  return {
    version: "2.0",
    name,
    targets: { cli: target },
    agents,
    intelligence,
  };
}

function cliAgents(count, duration = "200ms") {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `cli${index + 1}`,
      { enabled: true, type: "cli-tester", duration },
    ]),
  );
}

function rootCauses(run) {
  return (run.observations ?? []).filter((observation) => observation.kind === "root_cause");
}

function assertNoPredictionLanguage(name, run) {
  const rendered = JSON.stringify(
    {
      findings: run.findings,
      observations: run.observations,
    },
    null,
    2,
  );
  assert.equal(
    run.predictions?.length ?? 0,
    0,
    `${name}: runtime diagnostic corpus must not emit predictions`,
  );
  assert.equal(
    predictionLanguage.test(rendered),
    false,
    `${name}: diagnostic output must not imply prediction, causal proof, or repair order`,
  );
}

function assertUniqueObservationIds(name, run) {
  const ids = (run.observations ?? []).map((observation) => observation.id);
  assert.equal(new Set(ids).size, ids.length, `${name}: observation IDs must be unique`);
  assert.equal(
    ids.some((id) => /^corr-/.test(id)),
    false,
    `${name}: observations must not use synthetic corr-* IDs`,
  );
}

function summarizeRootCause(rootCause) {
  const calibration = rootCause.semantics?.calibration;
  return {
    subject: rootCause.subject,
    failureClass: rootCause.semantics?.failureClass,
    calibration: calibration?.level ?? calibration,
    signalCount: calibration?.signalCount ?? rootCause.semantics?.signalCount,
    sensorCount: calibration?.sensorCount ?? rootCause.semantics?.sensorCount,
  };
}

async function runCase(definition) {
  const run = await new TestCapabilitiesOrchestrator(definition.config).run();
  const roots = rootCauses(run);

  definition.assert({ run, roots });
  assertUniqueObservationIds(definition.name, run);
  assertNoPredictionLanguage(definition.name, run);

  const entry = {
    name: definition.name,
    rootCauseCount: roots.length,
    expected: definition.expected,
    actualRootCauses: roots.map(summarizeRootCause),
  };
  results.push(entry);

  if (!jsonMode) {
    console.log(`[pass] ${definition.name}`);
  }
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "test-capabilities-runtime-diagnostic-"));

try {
  const missingExecutable = path.join(tempRoot, "missing executable; echo not-run");

  const timeoutFixture = path.join(tempRoot, "timeout-fixture.mjs");
  await writeFile(
    timeoutFixture,
    ["#!/usr/bin/env node", "setInterval(() => {}, 1000);", ""].join("\n"),
    { mode: 0o700 },
  );

  const mixedFixture = path.join(tempRoot, "mixed-fixture.mjs");
  const mixedLock = path.join(tempRoot, "mixed-first.lock");
  await writeFile(
    mixedFixture,
    [
      "#!/usr/bin/env node",
      "import { mkdirSync } from 'node:fs';",
      `const lock = ${JSON.stringify(mixedLock)};`,
      "try {",
      "  mkdirSync(lock);",
      "  console.error('spawn /definitely-missing-test-capabilities-runtime-fixture ENOENT');",
      "  process.exit(127);",
      "} catch {",
      "  setInterval(() => {}, 1000);",
      "}",
      "",
    ].join("\n"),
    { mode: 0o700 },
  );

  const cases = [
    {
      name: "Real single CLI smoke failure does not emit root_cause",
      expected: { rootCauseCount: 0 },
      config: baseConfig(
        "runtime-single-missing",
        executableTargetFor(missingExecutable),
        cliAgents(1),
      ),
      assert: ({ roots }) => assert.equal(roots.length, 0),
    },
    {
      name: "Real independent CLI smoke failures classify command_resolution",
      expected: { rootCauseCount: 1, failureClass: "command_resolution" },
      config: baseConfig(
        "runtime-two-missing",
        executableTargetFor(missingExecutable),
        cliAgents(2),
      ),
      assert: ({ roots }) => {
        assert.equal(roots.length, 1);
        assert.equal(roots[0].subject, "cli");
        assert.equal(roots[0].semantics?.failureClass, "command_resolution");
        assert.equal(roots[0].semantics?.calibration?.level, "high");
        assert.equal(roots[0].semantics?.calibration?.sensorCount, 2);
      },
    },
    {
      name: "Real CLI timeout failures classify timeout_or_latency",
      expected: { rootCauseCount: 1, failureClass: "timeout_or_latency" },
      config: baseConfig("runtime-two-timeout", cliTargetFor(timeoutFixture), cliAgents(2, "25ms")),
      assert: ({ roots }) => {
        assert.equal(roots.length, 1);
        assert.equal(roots[0].subject, "cli");
        assert.equal(roots[0].semantics?.failureClass, "timeout_or_latency");
        assert.equal(roots[0].semantics?.calibration?.level, "high");
        assert.equal(roots[0].semantics?.calibration?.sensorCount, 2);
      },
    },
    {
      name: "Real same-component mixed CLI evidence suppresses root_cause",
      expected: { rootCauseCount: 0 },
      config: baseConfig("runtime-mixed-cli", cliTargetFor(mixedFixture), cliAgents(2, "200ms")),
      assert: ({ roots }) => assert.equal(roots.length, 0),
    },
    {
      name: "Real CLI correlation disabled emits no synthesized diagnosis",
      expected: { rootCauseCount: 0, correlation: false },
      config: baseConfig(
        "runtime-correlation-disabled",
        executableTargetFor(missingExecutable),
        cliAgents(2),
        { correlation: false },
      ),
      assert: ({ run, roots }) => {
        assert.equal(roots.length, 0);
        assert.equal(
          (run.observations ?? []).some((observation) => observation.kind === "correlation"),
          false,
        );
      },
    },
  ];

  for (const corpusCase of cases) {
    await runCase(corpusCase);
  }

  const coverage = {
    cases: results.length,
    positiveRootCauseCases: results.filter((entry) => entry.rootCauseCount > 0).length,
    noRootCauseGuardrailCases: results.filter((entry) => entry.rootCauseCount === 0).length,
    failureClasses: [
      ...new Set(
        results
          .flatMap((entry) => entry.actualRootCauses.map((root) => root.failureClass))
          .filter(Boolean),
      ),
    ].sort(),
  };

  assert.equal(
    coverage.cases,
    5,
    "runtime diagnostic corpus must keep the bounded five-case proof lane",
  );
  assert.equal(
    coverage.positiveRootCauseCases,
    2,
    "runtime diagnostic corpus must keep two positive root-cause cases",
  );
  assert.equal(
    coverage.noRootCauseGuardrailCases,
    3,
    "runtime diagnostic corpus must keep three no-root-cause guardrail cases",
  );
  assert.deepEqual(coverage.failureClasses, ["command_resolution", "timeout_or_latency"]);

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, coverage, cases: results }, null, 2));
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
