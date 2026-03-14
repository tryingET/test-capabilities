import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const { TestCapabilitiesOrchestrator } = await import("../dist/index.js");

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
    assert.equal(result.coverage.overall, 33);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
