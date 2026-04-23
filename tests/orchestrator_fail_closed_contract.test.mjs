import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { TestCapabilitiesOrchestrator } = await importRuntimeModule("index.js");

function withFakeBombadil(script) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-"));
  const bombadilPath = path.join(dir, "bombadil");
  writeFileSync(bombadilPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });

  return {
    path: bombadilPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

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

test("bombadil agent requires targets.web", () => {
  assert.throws(
    () =>
      new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Missing Bombadil Target",
        targets: { cli: process.execPath },
        agents: {
          web: {
            enabled: true,
            type: "bombadil",
            intensity: "normal",
          },
        },
      }),
    /The enabled 'bombadil' agent requires targets\.web/,
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

test(
  "bombadil agent treats the duration budget as a bounded success when no violation is surfaced",
  { concurrency: false },
  async () => {
    const fake = withFakeBombadil(`
      echo 'using default specification' >&2
      echo 'storing trace in /tmp/fake-bombadil-trace' >&2
      trap '' TERM
      sleep 30
    `);
    const previousBinary = process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
    process.env.TEST_CAPABILITIES_BOMBADIL_BIN = fake.path;

    try {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Bombadil Budget Success",
        targets: { web: "https://example.com" },
        agents: {
          web: {
            enabled: true,
            type: "bombadil",
            intensity: "normal",
            duration: "50ms",
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

      assert.equal(result.passed, true);
      assert.equal(result.findings.length, 0);
      assert.equal(result.coverage.edgeCases, 100);
      assert.equal(result.coverage.overall, 100);
      assert.deepEqual(result.coverage.measuredDimensions, ["edgeCases"]);
    } finally {
      if (previousBinary === undefined) {
        delete process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
      } else {
        process.env.TEST_CAPABILITIES_BOMBADIL_BIN = previousBinary;
      }
      fake.cleanup();
    }
  },
);

test(
  "bombadil agent surfaces property violations as failing findings",
  { concurrency: false },
  async () => {
    const fake = withFakeBombadil(`
      echo 'using default specification' >&2
      echo 'storing trace in /tmp/fake-bombadil-trace' >&2
      echo 'violation: invariant failed' >&2
      exit 2
    `);
    const previousBinary = process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
    process.env.TEST_CAPABILITIES_BOMBADIL_BIN = fake.path;

    try {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Bombadil Violation",
        targets: { web: "https://example.com" },
        agents: {
          web: {
            enabled: true,
            type: "bombadil",
            intensity: "normal",
            duration: "50ms",
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

      assert.equal(result.passed, false);
      assert.equal(result.coverage.edgeCases, 100);
      assert.equal(
        result.findings.some((finding) =>
          /Bombadil found a property violation/.test(finding.description),
        ),
        true,
      );
      assert.equal(
        result.findings.some((finding) =>
          finding.evidence.some((entry) => /trace: \/tmp\/fake-bombadil-trace/.test(entry)),
        ),
        true,
      );
    } finally {
      if (previousBinary === undefined) {
        delete process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
      } else {
        process.env.TEST_CAPABILITIES_BOMBADIL_BIN = previousBinary;
      }
      fake.cleanup();
    }
  },
);

test(
  "bombadil agent fails clearly when its configured binary is missing",
  { concurrency: false },
  async () => {
    const previousBinary = process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
    process.env.TEST_CAPABILITIES_BOMBADIL_BIN = "/tmp/definitely-missing-bombadil";

    try {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Bombadil Missing Binary",
        targets: { web: "https://example.com" },
        agents: {
          web: {
            enabled: true,
            type: "bombadil",
            intensity: "normal",
            duration: "50ms",
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

      assert.equal(result.passed, false);
      assert.equal(result.coverage.overall, 0);
      assert.equal(
        result.findings.some((finding) =>
          /Bombadil runtime could not complete/.test(finding.description),
        ),
        true,
      );
      assert.equal(
        result.findings.some((finding) =>
          finding.recommendation.includes("TEST_CAPABILITIES_BOMBADIL_BIN"),
        ),
        true,
      );
    } finally {
      if (previousBinary === undefined) {
        delete process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
      } else {
        process.env.TEST_CAPABILITIES_BOMBADIL_BIN = previousBinary;
      }
    }
  },
);

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
