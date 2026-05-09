import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  run(binPath, ["test", "--quick", "--config", smokeConfig], {
    cwd: tempDir,
  });

  const installedPackageRoot = path.join(tempDir, "node_modules", "test-capabilities");
  const nodeOnlyBin = path.join(tempDir, "node-only-bin");
  mkdirSync(nodeOnlyBin, { recursive: true });
  symlinkSync(
    process.execPath,
    path.join(nodeOnlyBin, process.platform === "win32" ? "node.exe" : "node"),
  );

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
    assert.equal(
      CLI_ROUTE_MANIFEST.some((entry) => entry.command === "surf" && entry.action === "explore"),
      true,
    );

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

  console.log("consumer-contract: ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
  if (tarballPath && existsSync(tarballPath)) {
    unlinkSync(tarballPath);
  }
}
