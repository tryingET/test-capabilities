import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { TestCapabilitiesOrchestrator } = await importRuntimeModule("index.js");

test("orchestrator rejects configs with no enabled agents", async () => {
  await assert.rejects(
    async () =>
      new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "No Agents",
        targets: { cli: process.execPath },
      }).run(),
    /At least one enabled agent is required/,
  );
});

test("orchestrator rejects enabled unsupported agent types", () => {
  assert.throws(
    () =>
      new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Unsupported Agent",
        targets: { web: "https://example.com", cli: process.execPath },
        agents: {
          web: {
            enabled: true,
            type: "surf",
            intensity: "normal",
          },
        },
      }),
    /Unsupported agent type/,
  );
});

test("cli agent fails closed when the configured command does not exist", async () => {
  const result = await new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Broken CLI",
    targets: { cli: "/definitely/not/a/real/binary" },
    agents: {
      cli: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
    },
  }).run();

  assert.equal(result.passed, false);
  assert.equal(result.coverage.overall, 0);
  assert.equal(
    result.findings.some((finding) => finding.severity === "critical"),
    true,
  );
});

test("correlation can synthesize repeated supported-agent findings on the same component", async () => {
  const result = await new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Correlated CLI Failures",
    targets: { cli: "/definitely/not/a/real/binary" },
    agents: {
      cliA: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
      cliB: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
    },
  }).run();

  assert.equal(
    result.findings.some((finding) =>
      /Correlated findings indicate a systemic issue in cli/.test(finding.description),
    ),
    true,
  );
});

test(
  "cli agent escalates timed-out commands to SIGKILL when they ignore SIGTERM",
  { timeout: 5000 },
  async () => {
    if (process.platform === "win32") {
      return;
    }

    const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-timeout-"));
    const scriptPath = path.join(tempDir, "ignore-term.sh");
    writeFileSync(scriptPath, "#!/bin/sh\ntrap '' TERM\nsleep 30\n", { mode: 0o755 });

    try {
      const startedAt = Date.now();
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Timed Out CLI Target",
        targets: { cli: scriptPath },
        agents: {
          cli: {
            enabled: true,
            type: "cli-tester",
            intensity: "normal",
            duration: "50ms",
          },
        },
      }).run();
      const elapsed = Date.now() - startedAt;

      assert.equal(result.passed, false);
      assert.equal(elapsed < 3000, true);
      assert.equal(
        result.findings.some((finding) =>
          finding.evidence.some((evidence) => /timed out after 50ms/.test(evidence)),
        ),
        true,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  },
);

test("cli agent supports quoted commands whose executable path contains spaces", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities cli target "));
  const scriptPath = path.join(tempDir, "fake cli.sh");
  writeFileSync(scriptPath, "#!/bin/sh\necho 'fake cli help'\n", { mode: 0o755 });

  try {
    const result = await new TestCapabilitiesOrchestrator({
      version: "2.0",
      name: "Quoted CLI Target",
      targets: { cli: `"${scriptPath}"` },
      agents: {
        cli: {
          enabled: true,
          type: "cli-tester",
          intensity: "normal",
        },
      },
    }).run();

    assert.equal(result.passed, true);
    assert.equal(result.coverage.userFlows, 0);
    assert.equal(result.coverage.apiEndpoints, 0);
    assert.equal(result.coverage.edgeCases, 100);
    assert.equal(result.coverage.overall, 100);
    assert.deepEqual(result.coverage.measuredDimensions, ["edgeCases"]);
    assert.deepEqual(result.coverage.unmeasuredDimensions, ["userFlows", "apiEndpoints"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
