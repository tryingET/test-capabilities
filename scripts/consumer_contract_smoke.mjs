import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const localTempRoot = path.join(repoRoot, ".tmp");
mkdirSync(localTempRoot, { recursive: true });
const tempDir = mkdtempSync(path.join(localTempRoot, "test-capabilities-consumer-"));
let tarballPath;

function runRaw(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function renderResult(command, args, result) {
  const renderedCommand = [command, ...args].join(" ");
  const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return `${renderedCommand} failed\n${details}`.trim();
}

function run(command, args, options = {}) {
  const result = runRaw(command, args, options);

  if (result.status !== 0) {
    throw new Error(renderResult(command, args, result));
  }

  return result;
}

function runFailure(command, args, expected, options = {}) {
  const result = runRaw(command, args, options);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

  if (result.status === 0) {
    throw new Error(`${[command, ...args].join(" ")} unexpectedly succeeded\n${output}`.trim());
  }

  assert.match(output, expected);
  return result;
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
  const smoke = runRaw(process.execPath, [tsgoEntrypoint, "--version"]);
  assert.equal(
    smoke.status,
    0,
    `tsgo native compiler must be executable for type fixtures. Install optional native dependencies without --omit=optional. ${smoke.stdout}\n${smoke.stderr}`,
  );
  return [process.execPath, [tsgoEntrypoint, "--ignoreConfig", ...extraArgs]];
}

function sanitizedExternalToolEnv(packageRoot, nodeBinDir) {
  const env = { ...process.env, PATH: nodeBinDir, TEST_CAPABILITIES_PACKAGE_ROOT: packageRoot };
  delete env.TEST_CAPABILITIES_BOMBADIL_BIN;
  delete env.TEST_CAPABILITIES_BOMBADIL_REPO;
  return env;
}

try {
  const packResult = run("npm", ["pack", "--json"]);
  const packOutput = JSON.parse(packResult.stdout);
  const packEntry = packOutput[0];
  const tarballName = packEntry?.filename;
  const packedFiles = Array.isArray(packEntry?.files)
    ? packEntry.files.map((entry) => entry?.path).filter((value) => typeof value === "string")
    : [];

  assert.equal(typeof tarballName, "string", "npm pack did not return a tarball filename");
  assert.ok(packedFiles.includes("package.json"), "packed artifact missing package.json");
  assert.ok(packedFiles.includes("README.md"), "packed artifact missing README.md");
  assert.ok(
    packedFiles.includes("bin/test-capabilities"),
    "packed artifact missing CLI entrypoint",
  );
  assert.ok(packedFiles.includes("dist/index.js"), "packed artifact missing dist/index.js");
  assert.ok(packedFiles.includes("dist/index.d.ts"), "packed artifact missing dist/index.d.ts");
  assert.ok(
    packedFiles.includes("test-capabilities.yaml"),
    "packed artifact missing sample config",
  );
  assert.ok(
    packedFiles.includes("examples/demo/cli-demo.mjs"),
    "packed artifact missing built-in demo CLI fixture",
  );
  assert.ok(
    packedFiles.includes("examples/demo/test-capabilities.yaml"),
    "packed artifact missing built-in demo config fixture",
  );
  assert.ok(
    packedFiles.includes("examples/demo/README.md"),
    "packed artifact missing built-in demo first-use guide",
  );
  assert.equal(
    packedFiles.some((packedPath) => packedPath.startsWith("external/")),
    false,
    "packed artifact intentionally excludes the repo-local Bombadil binary",
  );
  assert.equal(
    packedFiles.some((packedPath) => packedPath.startsWith("docs/")),
    false,
    "packed artifact should exclude repo docs",
  );
  assert.equal(
    packedFiles.some((packedPath) => packedPath.startsWith("prompts/")),
    false,
    "packed artifact should exclude prompt authoring assets",
  );
  assert.equal(
    packedFiles.some((packedPath) => packedPath.startsWith("flows/")),
    false,
    "packed artifact should exclude repo-only flow fixtures",
  );
  assert.equal(
    packedFiles.some((packedPath) => packedPath.startsWith("policy/")),
    false,
    "packed artifact should exclude repo-only policy metadata",
  );
  assert.equal(
    packedFiles.some((packedPath) => packedPath.endsWith(".map")),
    false,
    "packed artifact should exclude JS and declaration source maps",
  );

  tarballPath = path.join(repoRoot, tarballName);
  assert.ok(existsSync(tarballPath), `tarball missing: ${tarballPath}`);

  run("npm", ["init", "-y"], { cwd: tempDir });
  run("npm", ["install", tarballPath], { cwd: tempDir });

  const installedConfig = path.join(
    tempDir,
    "node_modules",
    "test-capabilities",
    "test-capabilities.yaml",
  );
  assert.ok(existsSync(installedConfig), `installed config missing: ${installedConfig}`);

  const installedTypes = path.join(
    tempDir,
    "node_modules",
    "test-capabilities",
    "dist",
    "index.d.ts",
  );
  assert.ok(existsSync(installedTypes), `installed type entrypoint missing: ${installedTypes}`);
  const installedTypeSurface = readFileSync(installedTypes, "utf8");
  const installedOrchestratorTypes = readFileSync(
    path.join(tempDir, "node_modules", "test-capabilities", "dist", "core", "orchestrator.d.ts"),
    "utf8",
  );
  assert.match(installedTypeSurface, /IntelligenceConfig/);
  assert.match(installedTypeSurface, /PropagationEdge/);
  assert.match(installedTypeSurface, /PropagationTopology/);
  assert.match(installedTypeSurface, /ROOT_CAUSE_FAILURE_CLASSES/);
  assert.match(installedTypeSurface, /RootCauseFailureClass/);
  assert.match(installedOrchestratorTypes, /failureClass\?: RootCauseFailureClass/);
  assert.match(installedOrchestratorTypes, /propagationLink\?: string/);

  const typeConsumer = path.join(tempDir, "consumer-types.ts");
  writeFileSync(
    typeConsumer,
    [
      'import { ROOT_CAUSE_FAILURE_CLASSES, createTestCapabilities } from "test-capabilities";',
      'import type { IntelligenceConfig, ObservationSemantics, PropagationEdge, PropagationTopology, RootCauseFailureClass, TestCapabilitiesConfig } from "test-capabilities";',
      'if (!ROOT_CAUSE_FAILURE_CLASSES.includes("auth_or_permission")) throw new Error("missing auth root-cause class");',
      'const failureClass: RootCauseFailureClass = "auth_or_permission";',
      'const semantics: ObservationSemantics = { component: "api", interpretation: "typed", failureClass, propagationLink: "api-latency-cascade" };',
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
    typeConsumer,
  ]);
  run(typecheckCommand, typecheckArgs, { cwd: tempDir });

  const binPath = path.join(
    tempDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "test-capabilities.cmd" : "test-capabilities",
  );
  assert.ok(existsSync(binPath), `installed CLI missing: ${binPath}`);

  const smokeConfig = path.join(tempDir, "consumer-smoke.yaml");
  writeFileSync(
    smokeConfig,
    [
      "version: '2.0'",
      "name: 'Consumer CLI Smoke'",
      "targets:",
      `  cli: '${binPath.replace(/\\/g, "/")}'`,
      "agents:",
      "  cli:",
      "    enabled: true",
      "    type: cli-tester",
      "    intensity: normal",
      "intelligence:",
      "  self_healing: false",
      "  prediction: false",
      "  correlation: true",
      "  collective: false",
      "quantum:",
      "  enabled: false",
      "chaos:",
      "  enabled: false",
      "",
    ].join("\n"),
    "utf8",
  );

  run(binPath, ["--help"], { cwd: tempDir });
  const doctorSmoke = run(binPath, ["doctor", "--json"], { cwd: tempDir });
  const doctorPayload = JSON.parse(doctorSmoke.stdout);
  assert.equal(doctorPayload.operationId, "doctor");
  assert.equal(doctorPayload.status, "pass");
  assert.equal(doctorPayload.summary.requiredFailed, 0);
  const demoSmoke = run(binPath, ["demo", "--json"], { cwd: tempDir });
  const demoPayload = JSON.parse(demoSmoke.stdout);
  assert.equal(demoPayload.operationId, "demo");
  assert.equal(demoPayload.summary.health, "pass");
  assert.equal(demoPayload.result.passed, true);
  assert.match(demoPayload.demo.cliFixture, /examples\/demo\/cli-demo\.mjs$/);
  assert.equal(demoPayload.coreUseCase.id, "cli-smoke-observation");
  assert.equal(
    demoPayload.coreUseCase.proves.includes(
      "the orchestrator records a passing observation.v1 smoke signal",
    ),
    true,
  );
  const demoText = run(binPath, ["demo"], { cwd: tempDir });
  assert.match(demoText.stdout, /Core use case: CLI smoke \+ observation diagnostics/);
  run(binPath, ["test", "--quick", "--config", smokeConfig], {
    cwd: tempDir,
  });
  const testJsonSmoke = run(binPath, ["test", "--quick", "--config", smokeConfig, "--json"], {
    cwd: tempDir,
  });
  const testJsonPayload = JSON.parse(testJsonSmoke.stdout);
  assert.equal(testJsonPayload.operationId, "test");
  assert.equal(testJsonPayload.input.json, true);
  assert.equal(testJsonPayload.summary.health, "pass");
  assert.equal(testJsonPayload.result.passed, true);

  const installedPackageRoot = path.join(tempDir, "node_modules", "test-capabilities");
  const nodeOnlyBin = path.join(tempDir, "node-only-bin");
  mkdirSync(nodeOnlyBin, { recursive: true });
  const nodeShimPath = path.join(nodeOnlyBin, process.platform === "win32" ? "node.cmd" : "node");
  if (process.platform === "win32") {
    writeFileSync(nodeShimPath, `@echo off\r\n"${process.execPath}" %*\r\n`, "utf8");
  } else {
    symlinkSync("/bin/sh", path.join(nodeOnlyBin, "sh"));
    writeFileSync(nodeShimPath, `#!/usr/bin/env sh\nexec "${process.execPath}" "$@"\n`, "utf8");
    chmodSync(nodeShimPath, 0o755);
  }

  const bombadilConfig = path.join(tempDir, "consumer-bombadil.yaml");
  writeFileSync(
    bombadilConfig,
    [
      "version: '2.0'",
      "name: 'Consumer Bombadil External Binary Contract'",
      "targets:",
      "  web: 'https://example.com'",
      "agents:",
      "  web:",
      "    enabled: true",
      "    type: bombadil",
      "    intensity: gentle",
      "    duration: 10ms",
      "intelligence:",
      "  self_healing: false",
      "  prediction: false",
      "  correlation: true",
      "  collective: false",
      "quantum:",
      "  enabled: false",
      "chaos:",
      "  enabled: false",
      "",
    ].join("\n"),
    "utf8",
  );

  const externalToolEnv = sanitizedExternalToolEnv(installedPackageRoot, nodeOnlyBin);
  const bombadilFailure = runFailure(
    binPath,
    ["test", "--quick", "--config", bombadilConfig],
    /Health:\s+fail/,
    {
      cwd: tempDir,
      env: externalToolEnv,
    },
  );
  assert.match(bombadilFailure.stdout, /Findings:\s+1/);

  const bombadilProgram = `
    import assert from "node:assert/strict";
    import { createTestCapabilities } from "test-capabilities";

    const result = await createTestCapabilities({
      version: "2.0",
      name: "Packed Consumer Bombadil External Requirement",
      targets: { web: "https://example.com" },
      agents: {
        web: {
          enabled: true,
          type: "bombadil",
          intensity: "gentle",
          duration: "10ms",
        },
      },
      intelligence: {
        selfHealing: false,
        prediction: false,
        correlation: true,
        collective: false,
      },
      quantum: { enabled: false },
      chaos: { enabled: false },
    }).run();

    const finding = result.findings[0];
    assert.equal(result.passed, false);
    assert.match(finding.description, /Bombadil runtime could not complete/);
    assert.match(finding.recommendation, /TEST_CAPABILITIES_BOMBADIL_BIN/);
    assert.match(finding.evidence.join("\\n"), /provider: path/);
    console.log("packed-consumer-bombadil-external-contract: ok");
  `;

  const bombadilProgramResult = run("node", ["--input-type=module", "-e", bombadilProgram], {
    cwd: tempDir,
    env: externalToolEnv,
  });
  assert.match(bombadilProgramResult.stdout, /packed-consumer-bombadil-external-contract: ok/);

  const smokeProgram = `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import yaml from "js-yaml";
    import {
      CLI_OPERATION_REGISTRY,
      CLI_ROUTE_MANIFEST,
      VERSION,
      NexusOrchestrator,
      TestCapabilitiesConfigSchema,
      createNexus,
      createTestCapabilities,
      executeCliOperation,
      executeDemoOperation,
    } from "test-capabilities";

    const sampleConfigPath = new URL("./node_modules/test-capabilities/test-capabilities.yaml", import.meta.url);
    const sampleConfig = yaml.load(fs.readFileSync(sampleConfigPath, "utf8"));
    const parsedSample = TestCapabilitiesConfigSchema.parse(sampleConfig);
    assert.equal(parsedSample.version, "2.0");

    const effectiveConfig = {
      version: "2.0",
      name: "Consumer Contract Smoke",
      targets: { cli: process.execPath },
      agents: {
        cli: {
          enabled: true,
          type: "cli-tester",
          intensity: "normal",
        },
      },
      intelligence: {
        selfHealing: false,
        prediction: false,
        correlation: true,
        collective: false,
      },
      quantum: {
        enabled: false,
        branches: 10,
        collapseStrategy: "significance",
        maxDepth: 5,
      },
      chaos: {
        enabled: false,
      },
    };

    assert.equal(createNexus, createTestCapabilities);
    assert.equal(typeof NexusOrchestrator, "function");
    assert.equal(CLI_OPERATION_REGISTRY.test.id, "test");
    assert.equal(CLI_OPERATION_REGISTRY.demo.id, "demo");
    assert.equal(
      CLI_ROUTE_MANIFEST.some((entry) => entry.command === "surf" && entry.action === "explore"),
      true,
    );

    const demoResult = await executeDemoOperation({});
    const first = await createTestCapabilities(effectiveConfig).run();
    const second = await createNexus(effectiveConfig).run();
    const kernelResult = await executeCliOperation(
      { command: "test" },
      {
        config: "./consumer-smoke.yaml",
        target: process.execPath,
        quick: true,
      },
    );

    assert.equal(demoResult.operationId, "demo");
    assert.equal(demoResult.summary.health, "pass");
    assert.equal(demoResult.coreUseCase.id, "cli-smoke-observation");
    assert.equal(first.passed, true);
    assert.equal(first.coverage.overall > 0, true);
    assert.equal(kernelResult.operationId, "test");
    assert.equal(kernelResult.summary.health, "pass");

    assert.deepEqual(
      {
        passed: first.passed,
        findings: first.findings,
        coverage: first.coverage,
        predictions: first.predictions,
        quantumInsights: first.quantumInsights,
      },
      {
        passed: second.passed,
        findings: second.findings,
        coverage: second.coverage,
        predictions: second.predictions,
        quantumInsights: second.quantumInsights,
      },
    );

    console.log(JSON.stringify({ version: VERSION, coverage: first.coverage }, null, 2));
  `;

  run("node", ["--input-type=module", "-e", smokeProgram], { cwd: tempDir });

  // Verify that packed dist/ produces correct root-cause observations when exercised
  // through the library API with mock agents. This proves calibrated diagnosis invariants
  // survive distribution.
  const rootCauseProgram = `
    import assert from "node:assert/strict";
    import process from "node:process";
    import { TestCapabilitiesOrchestrator } from "test-capabilities";

    const observedAt = new Date("2026-01-01T00:00:00.000Z");

    const cliFinding = (agent) => ({
      id: agent + "-missing",
      type: "bug",
      severity: "critical",
      component: "cli",
      description: "sh: 1: " + agent + ": not found",
      evidence: ["sh: 1: " + agent + ": not found"],
      recommendation: "Fix CLI command resolution.",
      timestamp: observedAt,
    });

    const cliObs = (agent, fid) => ({
      protocol: "observation.v1",
      id: agent + "-cli-smoke",
      agent,
      kind: "smoke",
      status: "failed",
      subject: "cli",
      summary: "CLI smoke failed: sh: 1: " + agent + ": not found",
      evidence: ["sh: 1: " + agent + ": not found"],
      semantics: { component: "cli", interpretation: "CLI executable not found." },
      findingIds: [fid],
      timestamp: observedAt,
    });

    const orchestrator = new TestCapabilitiesOrchestrator({
      version: "2.0",
      name: "Packed Root-Cause Proof",
      targets: { cli: process.execPath },
      agents: { cli: { enabled: true, type: "cli-tester" } },
    });

    // Replace agents with mock implementations
    orchestrator.agents = new Map([
      ["cliA", { execute: async () => ({ findings: [cliFinding("cliA")], coverage: {}, observations: [cliObs("cliA", "cliA-missing")] }) }],
      ["cliB", { execute: async () => ({ findings: [cliFinding("cliB")], coverage: {}, observations: [cliObs("cliB", "cliB-missing")] }) }],
    ]);

    const result = await orchestrator.run();
    const rootCauses = result.observations.filter((o) => o.kind === "root_cause");

    assert.equal(rootCauses.length, 1, "packed dist must produce exactly one root_cause for two agreeing CLI sensors");
    const rc = rootCauses[0];
    assert.equal(rc.subject, "cli");
    assert.match(rc.summary, /command_resolution as the current failure surface/);
    assert.equal(rc.semantics.failureClass, "command_resolution");
    assert.match(rc.evidence.join("\\n"), /failureClass:command_resolution/);
    assert.equal(rc.semantics.calibration.level, "high");
    assert.equal(rc.semantics.calibration.signalCount, 2);
    assert.equal(rc.semantics.calibration.sensorCount, 2);
    assert.equal(rc.semantics.calibration.findingCount, 2);
    assert.deepEqual([...rc.findingIds].sort(), ["cliA-missing", "cliB-missing"]);

    console.log("packed-root-cause-invariant: ok");
  `;

  run("node", ["--input-type=module", "-e", rootCauseProgram], { cwd: tempDir });

  // Verify packed dist/ also preserves propagation synthesis invariants. This guards
  // against distribution drift where root_cause survives but dependent-component
  // linkage disappears or starts making causal/predictive claims.
  const propagationProgram = `
    import assert from "node:assert/strict";
    import process from "node:process";
    import { TestCapabilitiesOrchestrator } from "test-capabilities";

    const observedAt = new Date("2026-01-01T00:00:00.000Z");

    const finding = ({ id, component, description, evidence, recommendation }) => ({
      id,
      type: "bug",
      severity: "critical",
      component,
      description,
      evidence,
      recommendation,
      timestamp: observedAt,
    });

    const observation = ({ id, agent, component, summary, evidence, findingId }) => ({
      protocol: "observation.v1",
      id,
      agent,
      kind: "runtime",
      status: "failed",
      subject: component,
      summary,
      evidence,
      semantics: { component, interpretation: summary },
      findingIds: [findingId],
      timestamp: observedAt,
    });

    const agentResult = ({ findings, observations, coverage }) => ({
      execute: async () => ({ findings, observations, coverage }),
    });

    const timeoutAgent = (agent, component, findingId) => {
      const evidence = [component + " health check timed out after 5000ms"];
      return agentResult({
        findings: [
          finding({
            id: findingId,
            component,
            description: component + " component timed out during health check",
            evidence,
            recommendation: "Investigate " + component + " latency before treating the timeout as isolated.",
          }),
        ],
        observations: [
          observation({
            id: agent + "-" + component + "-timeout",
            agent,
            component,
            summary: component + " runtime timed out during component health check.",
            evidence,
            findingId,
          }),
        ],
        coverage: component === "web" ? { userFlows: 0 } : { edgeCases: 0 },
      });
    };

    const componentFailureAgent = (agent, component, findingId) => {
      const evidence = [component + " runtime raised TypeError during component health check"];
      return agentResult({
        findings: [
          finding({
            id: findingId,
            component,
            description: component + " component health check failed during runtime probe",
            evidence,
            recommendation: "Investigate " + component + " runtime health before trusting downstream signals.",
          }),
        ],
        observations: [
          observation({
            id: agent + "-" + component + "-component-failed",
            agent,
            component,
            summary: component + " runtime failed during component health check.",
            evidence,
            findingId,
          }),
        ],
        coverage: component === "web" ? { userFlows: 0 } : { edgeCases: 0 },
      });
    };

    const orchestrator = new TestCapabilitiesOrchestrator({
      version: "2.0",
      name: "Packed Propagation Proof",
      targets: { cli: process.execPath },
      agents: { seed: { enabled: true, type: "cli-tester" } },
      intelligence: { correlation: true },
    });

    // Replace agents with mock implementations that force two high-calibration
    // dependent-component root causes through the packed library API.
    orchestrator.agents = new Map([
      ["apiA", timeoutAgent("apiA", "api", "api-timeout-a")],
      ["apiB", timeoutAgent("apiB", "api", "api-timeout-b")],
      ["webA", componentFailureAgent("webA", "web", "web-component-a")],
      ["webB", componentFailureAgent("webB", "web", "web-component-b")],
    ]);

    const result = await orchestrator.run();
    const rootCauses = result.observations.filter((o) => o.kind === "root_cause");
    const propagations = result.observations.filter((o) => o.kind === "propagation");

    assert.equal(rootCauses.length, 2, "packed dist must produce component-scoped root_causes before propagation");
    assert.equal(propagations.length, 1, "packed dist must produce exactly one bounded propagation observation");

    const propagation = propagations[0];
    assert.equal(propagation.subject, "api-to-web");
    assert.equal(propagation.semantics.propagationLink, "api-latency-cascade");
    assert.match(propagation.evidence.join("\\n"), /link:api-latency-cascade/);
    assert.equal(propagation.semantics.calibration.level, "low");
    assert.equal(propagation.semantics.calibration.signalCount, 2);
    assert.equal(propagation.semantics.calibration.sensorCount, 4);
    assert.equal(propagation.semantics.calibration.findingCount, 4);
    assert.match(propagation.evidence.join("\\n"), /non-authoritative heuristic/);
    const operatorText = [propagation.summary, propagation.evidence.join("\\n"), propagation.semantics.interpretation, propagation.semantics.nextStep].join("\\n");
    assert.doesNotMatch(operatorText, /predict|probability|horizon|future|will fail/i);
    assert.doesNotMatch(operatorText, /likely caused|caused|causing|cascaded|repair.{0,40}first/i);
    assert.deepEqual([...propagation.findingIds].sort(), [
      "api-timeout-a",
      "api-timeout-b",
      "web-component-a",
      "web-component-b",
    ]);

    console.log("packed-propagation-invariant: ok");
  `;

  const propagationProgramResult = run("node", ["--input-type=module", "-e", propagationProgram], {
    cwd: tempDir,
  });
  assert.match(propagationProgramResult.stdout, /packed-propagation-invariant: ok/);

  console.log("consumer-contract: ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
  if (tarballPath && existsSync(tarballPath)) {
    unlinkSync(tarballPath);
  }
}
