import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { createFakeSurf, readyPages } from "./helpers/fake-surf.mjs";
import { runtimeEnv } from "./helpers/runtime-dist.mjs";

const binPath = new URL("../bin/test-capabilities", import.meta.url).pathname;

function runCli(args, extraEnv = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
    env: runtimeEnv(extraEnv),
  });
}

// An empty HOME keeps ~/.local/bin/surf out of child CLI runs that must not see a surf CLI.
const noSurfHome = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-no-surf-home-"));

test("CLI doctor command passes as zero-external-dependency happy path", () => {
  const result = runCli(["doctor", "--json"], {
    PATH: path.dirname(process.execPath),
    TEST_CAPABILITIES_SURF_BIN: "",
    HOME: noSurfHome,
    TEST_CAPABILITIES_BOMBADIL_BIN: "",
    TEST_CAPABILITIES_BOMBADIL_REPO: "",
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.operationId, "doctor");
  assert.equal(payload.status, "pass");
  assert.equal(payload.summary.requiredFailed, 0);
  assert.equal(
    payload.checks.some((check) => check.id === "package.version" && check.status === "pass"),
    true,
  );
  assert.equal(
    payload.checks.some((check) => check.id === "config.shape" && check.status === "pass"),
    true,
  );
  assert.equal(
    payload.checks.some((check) => check.id === "external.surf" && check.required === false),
    true,
  );
  assert.equal(
    payload.checks.some((check) => check.id === "external.bombadil" && check.required === false),
    true,
  );
});

test("doctor reports whether the resolved surf can serve the a11y channel (AK #5915)", () => {
  for (const [mode, status] of [
    ["branch", "pass"],
    ["upstream", "warn"],
  ]) {
    const fake = createFakeSurf({ pages: readyPages({ "https://example.com/": {} }) });
    try {
      const result = runCli(["doctor", "--json"], {
        TEST_CAPABILITIES_SURF_BIN: fake.path,
        FAKE_SURF_MODE: mode,
      });
      const check = JSON.parse(result.stdout).checks.find(
        (entry) => entry.id === "external.a11y_channel",
      );
      assert.equal(check?.status, status, mode);
      assert.equal(check.required, false, "the channel is optional, never a doctor failure");
      assert.equal(check.data.nodes, status === "pass");
      if (status === "warn") {
        assert.match(check.detail, /surf_page_read_unsupported/);
      }
      assert.equal(
        JSON.parse(result.stdout).checks.some((entry) => entry.id === "external.agent_browser"),
        false,
        "agent-browser is retired",
      );
    } finally {
      fake.cleanup();
    }
  }
});

test("CLI doctor command checks target executability without running target", () => {
  const result = runCli(["doctor", "--json", "--target", process.execPath], {
    PATH: path.dirname(process.execPath),
    TEST_CAPABILITIES_SURF_BIN: "",
    HOME: noSurfHome,
    TEST_CAPABILITIES_BOMBADIL_BIN: "",
    TEST_CAPABILITIES_BOMBADIL_REPO: "",
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.operationId, "doctor");
  assert.equal(
    payload.checks.some((check) => check.id === "target.cli" && check.status === "pass"),
    true,
  );
});

test("CLI doctor command fails when requested target cannot be resolved", () => {
  const result = runCli(
    ["doctor", "--json", "--target", "definitely-missing-test-capabilities-command"],
    {
      PATH: path.dirname(process.execPath),
      TEST_CAPABILITIES_SURF_BIN: "",
      HOME: noSurfHome,
      TEST_CAPABILITIES_BOMBADIL_BIN: "",
      TEST_CAPABILITIES_BOMBADIL_REPO: "",
    },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.operationId, "doctor");
  assert.equal(payload.status, "fail");
  assert.equal(
    payload.checks.some((check) => check.id === "target.cli" && check.status === "fail"),
    true,
  );
});

test("CLI init command writes a minimal config without external runtimes", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-init-"));
  const output = path.join(tempDir, "test-capabilities.yaml");

  try {
    const result = runCli(["init", "--output", output, "--target", "node", "--json"], {
      PATH: path.dirname(process.execPath),
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.operationId, "init");
    assert.equal(payload.written, true);
    assert.equal(payload.outputPath, output);
    assert.match(readFileSync(output, "utf8"), /type: cli-tester/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI init command refuses to overwrite without --force", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-init-refuse-"));
  const output = path.join(tempDir, "test-capabilities.yaml");
  writeFileSync(output, "existing", "utf8");

  try {
    const result = runCli(["init", "--output", output], {
      PATH: path.dirname(process.execPath),
    });

    assert.equal(result.status, 1);
    assert.match(`${result.stdout}\n${result.stderr}`, /Refusing to overwrite existing config/);
    assert.equal(readFileSync(output, "utf8"), "existing");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI init command can print a config without writing", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-init-print-"));
  const output = path.join(tempDir, "printed.yaml");

  try {
    const result = runCli(["init", "--output", output, "--target", "custom-cli", "--print"], {
      PATH: path.dirname(process.execPath),
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stderr.trim(), "");
    assert.match(result.stdout, /cli: 'custom-cli'/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI demo command passes as zero-external-dependency functional path", () => {
  const result = runCli(["demo", "--json"], {
    PATH: path.dirname(process.execPath),
    TEST_CAPABILITIES_SURF_BIN: "",
    HOME: noSurfHome,
    TEST_CAPABILITIES_BOMBADIL_BIN: "",
    TEST_CAPABILITIES_BOMBADIL_REPO: "",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.operationId, "demo");
  assert.equal(payload.summary.health, "pass");
  assert.equal(payload.result.passed, true);
  assert.match(payload.demo.cliFixture, /examples\/demo\/cli-demo\.mjs$/);
  assert.equal(payload.coreUseCase.id, "cli-smoke-observation");
  assert.equal(
    payload.coreUseCase.commands.includes(
      "test-capabilities test --target <your-cli-command> --quick",
    ),
    true,
  );
});

test("CLI test command emits machine-readable JSON for the primary run path", () => {
  const result = runCli(["test", "--config", "examples/demo/test-capabilities.yaml", "--json"], {
    PATH: path.dirname(process.execPath),
    TEST_CAPABILITIES_SURF_BIN: "",
    HOME: noSurfHome,
    TEST_CAPABILITIES_BOMBADIL_BIN: "",
    TEST_CAPABILITIES_BOMBADIL_REPO: "",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout.trim().startsWith("{"), true);
  assert.equal(result.stderr.trim(), "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.operationId, "test");
  assert.equal(payload.input.json, true);
  assert.equal(payload.input.config, "examples/demo/test-capabilities.yaml");
  assert.equal(payload.summary.health, "pass");
  assert.equal(payload.result.passed, true);
  assert.equal(
    payload.result.observations.some((entry) => entry.protocol === "observation.v1"),
    true,
  );
});

test("CLI test command fails when the config file is missing", () => {
  const result = runCli(["test", "--config", "/tmp/definitely-missing-test-capabilities.yaml"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Config file not found/);
});

test("CLI test command rejects unsupported flags", () => {
  const result = runCli([
    "test",
    "--config",
    new URL("../test-capabilities.yaml", import.meta.url).pathname,
    "--predict",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported option\(s\) for 'test'/);
});

test("CLI test command rejects URL overrides when no supported web consumer is enabled", () => {
  const result = runCli([
    "test",
    "--config",
    new URL("../test-capabilities.yaml", import.meta.url).pathname,
    "--target",
    "https://example.com",
    "--quick",
  ]);

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /URL targets for 'test' require a real web-consuming runtime path/,
  );
});

test("CLI test command accepts URL overrides when surf is the supported web consumer", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-surf-"));
  const fake = createFakeSurf({
    pages: readyPages({ "https://example.com/": { title: "Example Domain" } }),
  });
  const configPath = path.join(tempDir, "surf-config.yaml");

  writeFileSync(
    configPath,
    [
      "version: '2.0'",
      "name: 'Surf CLI Contract'",
      "targets:",
      "  web: 'https://placeholder.example.com'",
      // The fuzzer changes the target, so the operator has to say which origin it may change
      // (mutation.allowOrigins, architecture review A13); --target overrides targets.web.
      "mutation:",
      "  allow_origins: ['https://example.com']",
      "receipts:",
      "  ephemeral: true",
      "agents:",
      "  web:",
      "    enabled: true",
      "    type: surf",
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

  try {
    const result = runCli(
      ["test", "--config", configPath, "--target", "https://example.com", "--quick"],
      {
        PATH: `${fake.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        TEST_CAPABILITIES_SURF_BIN: fake.path,
      },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /Health:\s+pass/);
    assert.match(`${result.stdout}\n${result.stderr}`, /user=100%/);
    assert.deepEqual(
      fake
        .calls()
        .map((call) => call[0])
        .filter((command) => !command.startsWith("--")),
      ["tab.new", "wait.ready", "js", "js", "tab.close"],
    );
  } finally {
    fake.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI test command accepts URL overrides when bombadil is the supported web consumer", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-bombadil-"));
  const fakeBombadil = path.join(tempDir, "bombadil");
  const configPath = path.join(tempDir, "bombadil-config.yaml");

  writeFileSync(
    fakeBombadil,
    "#!/bin/sh\necho 'using default specification' >&2\necho 'storing trace in /tmp/fake-bombadil-trace' >&2\ntrap '' TERM\nsleep 30\n",
    { mode: 0o755 },
  );
  writeFileSync(
    configPath,
    [
      "version: '2.0'",
      "name: 'Bombadil CLI Contract'",
      "targets:",
      "  web: 'https://placeholder.example.com'",
      // The fuzzer changes the target, so the operator has to say which origin it may change
      // (mutation.allowOrigins, architecture review A13); --target overrides targets.web.
      "mutation:",
      "  allow_origins: ['https://example.com']",
      "receipts:",
      "  ephemeral: true",
      "agents:",
      "  web:",
      "    enabled: true",
      "    type: bombadil",
      "    intensity: normal",
      "    duration: 50ms",
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

  try {
    const result = runCli(
      ["test", "--config", configPath, "--target", "https://example.com", "--quick"],
      { TEST_CAPABILITIES_BOMBADIL_BIN: fakeBombadil },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /Health:\s+pass/);
    assert.match(`${result.stdout}\n${result.stderr}`, /edge=100%/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("CLI surf explore rejects flags that are not wired to runtime behavior", () => {
  const result = runCli(["surf", "explore", "--url", "https://example.com", "--record"]);

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Unsupported option\(s\) for 'surf explore': --record/,
  );
});

test("CLI surf explore requires an explicit URL", () => {
  const result = runCli(["surf", "explore"]);

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Surf explore requires --url with a valid URL/,
  );
});

test("CLI surf explore rejects invalid URLs", () => {
  const result = runCli(["surf", "explore", "--url", "not-a-url"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Surf explore target must be a valid URL/);
});

test("CLI surf command rejects unknown actions with a contract error", () => {
  const result = runCli(["surf", "typo", "--url", "https://example.com"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported surf action\(s\): typo/);
});

test("CLI quantum command rejects invalid branch counts", () => {
  const result = runCli(["quantum", "--target", "https://example.com", "--branches", "0"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Invalid value for --branches: 0/);
});

test("CLI quantum command rejects invalid targets", () => {
  const result = runCli(["quantum", "--target", "not-a-url", "--branches", "1"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Quantum target must be a valid URL/);
});

test("CLI quantum command requires an explicit target", () => {
  const result = runCli(["quantum", "--branches", "1"]);

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Quantum simulation requires --target with a valid URL/,
  );
});

test("CLI heal command fails closed when the target directory is missing", () => {
  const result = runCli(["heal", "--dir", "/tmp/definitely-missing-heal-dir"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Heal directory not found:/);
});

test("CLI heal command accepts findings input and writes triggering finding provenance", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-heal-"));
  const testFile = path.join(dir, "sample.test.ts");
  const findingsFile = path.join(dir, "findings.json");
  const proposalFile = path.join(dir, "heal-proposals.json");

  writeFileSync(
    testFile,
    "test('login', async () => { await page.getByTestId('old-login-btn').click(); });\n",
    "utf8",
  );
  writeFileSync(
    findingsFile,
    JSON.stringify([
      {
        id: "surf-selector-drift-1",
        component: "web",
        description: "Selector drift detected on login button",
        evidence: ["getByTestId('old-login-btn') failed during Surf DOM probe"],
      },
    ]),
    "utf8",
  );

  try {
    const result = runCli([
      "heal",
      "--dir",
      dir,
      "--dry-run",
      "--findings-input",
      findingsFile,
      "--proposal-output",
      proposalFile,
    ]);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const artifact = JSON.parse(readFileSync(proposalFile, "utf8"));
    assert.equal(artifact.artifact_kind, "test-capabilities.heal.proposal");
    assert.equal(artifact.input.findingsInput, findingsFile);
    assert.equal(artifact.proposals.length, 1);
    assert.equal(artifact.proposals[0].oldSelector, "old-login-btn");
    assert.equal(artifact.proposals[0].triggeringFindingId, "surf-selector-drift-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI heal command accepts test JSON envelopes as findings input", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-heal-"));
  const testFile = path.join(dir, "sample.test.ts");
  const findingsFile = path.join(dir, "test-output.json");
  const proposalFile = path.join(dir, "heal-proposals.json");

  writeFileSync(
    testFile,
    "test('login', async () => { await page.getByTestId('old-login-btn').click(); });\n",
    "utf8",
  );
  writeFileSync(
    findingsFile,
    JSON.stringify({
      operationId: "test",
      result: {
        findings: [
          {
            id: "test-envelope-selector-drift",
            component: "web",
            description: "Selector drift detected on login button",
            evidence: ['selector [data-testid="old-login-btn"] failed during DOM probe'],
          },
        ],
      },
    }),
    "utf8",
  );

  try {
    const result = runCli([
      "heal",
      "--dir",
      dir,
      "--dry-run",
      "--findings-input",
      findingsFile,
      "--proposal-output",
      proposalFile,
    ]);

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const artifact = JSON.parse(readFileSync(proposalFile, "utf8"));
    assert.equal(artifact.proposals.length, 1);
    assert.equal(artifact.proposals[0].oldSelector, "old-login-btn");
    assert.equal(artifact.proposals[0].triggeringFindingId, "test-envelope-selector-drift");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI heal command fails closed when findings input is missing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-heal-"));
  try {
    const result = runCli([
      "heal",
      "--dir",
      dir,
      "--dry-run",
      "--findings-input",
      path.join(dir, "missing-findings.json"),
    ]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /ENOENT|no such file/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI heal command fails closed when findings input is malformed JSON", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-heal-"));
  const findingsFile = path.join(dir, "findings.json");
  writeFileSync(findingsFile, "{not-json", "utf8");

  try {
    const result = runCli(["heal", "--dir", dir, "--dry-run", "--findings-input", findingsFile]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /findings-input must be valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI heal command fails closed when findings input has ambiguous findings shapes", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-heal-"));
  const findingsFile = path.join(dir, "ambiguous-findings.json");
  writeFileSync(
    findingsFile,
    JSON.stringify({
      findings: [],
      result: {
        findings: [
          {
            id: "nested-finding",
            component: "web",
            description: "nested finding should not be silently ignored",
            evidence: ['selector [data-testid="old-login-btn"] failed'],
          },
        ],
      },
    }),
    "utf8",
  );

  try {
    const result = runCli(["heal", "--dir", dir, "--dry-run", "--findings-input", findingsFile]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /findings-input is ambiguous/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI heal command fails closed when findings input exceeds the size limit", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-heal-"));
  const findingsFile = path.join(dir, "huge-findings.json");
  writeFileSync(findingsFile, `[${" ".repeat(5 * 1024 * 1024)}]`, "utf8");

  try {
    const result = runCli(["heal", "--dir", dir, "--dry-run", "--findings-input", findingsFile]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /findings-input exceeds maximum size/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI heal command fails closed when findings input has no accepted findings shape", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-heal-"));
  const findingsFile = path.join(dir, "findings.json");
  writeFileSync(findingsFile, JSON.stringify({ id: "not-an-array" }), "utf8");

  try {
    const result = runCli(["heal", "--dir", dir, "--dry-run", "--findings-input", findingsFile]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /findings-input must be a JSON array/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI heal command fails closed when findings input entries omit required fields", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-heal-"));
  const findingsFile = path.join(dir, "findings.json");
  writeFileSync(
    findingsFile,
    JSON.stringify([{ id: "missing-evidence", component: "web", description: "bad" }]),
    "utf8",
  );

  try {
    const result = runCli(["heal", "--dir", dir, "--dry-run", "--findings-input", findingsFile]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /evidence/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI heal command fails closed when findings evidence entries are not strings", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-heal-"));
  const findingsFile = path.join(dir, "findings.json");
  writeFileSync(
    findingsFile,
    JSON.stringify([{ id: "bad-evidence", component: "web", description: "bad", evidence: [42] }]),
    "utf8",
  );

  try {
    const result = runCli(["heal", "--dir", dir, "--dry-run", "--findings-input", findingsFile]);

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Expected string/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unsupported CLI commands fail clearly instead of emitting placeholders", () => {
  const result = runCli(["predict"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported CLI command\(s\): predict/);
});

// ---------------------------------------------------------------- error envelope (S3)

test("a --json failure prints the surf-shaped error envelope on stdout and exits 1", () => {
  const result = runCli(["surf", "explore", "--json"], {
    PATH: path.dirname(process.execPath),
    HOME: noSurfHome,
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(payload), ["error"]);
  assert.equal(payload.error.code, "config_invalid");
  assert.match(payload.error.message, /Surf explore requires --url with a valid URL\./);
  assert.equal(
    payload.error.details.issues.some((issue) => issue.path === "url"),
    true,
  );
});

test("the same failure in text mode carries the [code] suffix on stderr", () => {
  const result = runCli(["surf", "explore"], {
    PATH: path.dirname(process.execPath),
    HOME: noSurfHome,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Surf explore requires --url with a valid URL\. \[config_invalid\]/);
  assert.equal(result.stdout.includes('"error"'), false);
});

test("an unsupported command names its registered code in both modes", () => {
  const text = runCli(["predict"]);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /\[unsupported_command\]$/m);

  const json = runCli(["test", "--config", "/definitely-missing-config.yaml", "--json"]);
  assert.equal(json.status, 1);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.error.code, "config_not_found");
  assert.equal(payload.error.details.path, "/definitely-missing-config.yaml");
});

/**
 * A frame diagnosis writes its raw inventory next to the run's receipts, so an explore run that
 * takes one touches `receipts.dir` - which a read-only run otherwise never does. These cases
 * point it at a throwaway directory and accept it as ephemeral, the way an operator would, so
 * `npm test` leaves nothing in the checkout.
 */
function diagnosisEnv(fake) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-explore-receipts-"));
  scratchReceiptDirs.push(dir);
  return {
    TEST_CAPABILITIES_SURF_BIN: fake.path,
    TEST_CAPABILITIES_RECEIPTS_DIR: dir,
    TEST_CAPABILITIES_RECEIPTS_EPHEMERAL: "1",
  };
}

const scratchReceiptDirs = [];

test.after(() => {
  for (const dir of scratchReceiptDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A page whose only frames are third-party embeds a main-document selector cannot reach. */
const FRAMED_EXPLORE_PAGES = readyPages({
  "https://example.com/": {
    links: [],
    frames: [
      { src: "https://embed.example/player.html", outOfProcess: true, id: "player" },
      { src: "https://ads.example/slot.html", outOfProcess: true },
    ],
  },
});

test("surf explore --ready-selector that cannot be reached is diagnosed, not guessed at", () => {
  const fake = createFakeSurf({ pages: FRAMED_EXPLORE_PAGES });

  try {
    const result = runCli(
      [
        "surf",
        "explore",
        "--url",
        "https://example.com/",
        "--ready-selector",
        "#does-not-exist",
        "--json",
      ],
      diagnosisEnv(fake),
    );

    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "element_unreachable");
    assert.equal(payload.error.details.determination, "suspected");
    assert.equal(payload.error.details.candidates, 2);
    // the surf code that produced the failure is kept, never renamed
    assert.equal(payload.error.details.surf_code, "page_timeout");
    // the tab this run owned was closed even though the gate refused
    const commands = fake.calls().map((call) => call[0]);
    assert.equal(commands.includes("frame.diagnose"), true);
    assert.equal(commands.includes("tab.close"), true);
  } finally {
    fake.cleanup();
  }
});

test("surf explore --frame-hint confirms exactly one reachable frame", () => {
  const fake = createFakeSurf({ pages: FRAMED_EXPLORE_PAGES });

  try {
    const result = runCli(
      [
        "surf",
        "explore",
        "--url",
        "https://example.com/",
        "--ready-selector",
        "#play",
        "--frame-hint",
        "urlPrefix=https://embed.example/",
        "--json",
      ],
      diagnosisEnv(fake),
    );

    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "element_unreachable");
    assert.equal(payload.error.details.determination, "confirmed");
  } finally {
    fake.cleanup();
  }
});

test("surf explore --frame-hint without --ready-selector refuses before a browser is touched", () => {
  const fake = createFakeSurf({ pages: FRAMED_EXPLORE_PAGES });

  try {
    const result = runCli(
      [
        "surf",
        "explore",
        "--url",
        "https://example.com/",
        "--frame-hint",
        "urlPrefix=https://embed.example/",
        "--json",
      ],
      diagnosisEnv(fake),
    );

    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "config_invalid");
    assert.deepEqual(
      fake.calls().filter((call) => call[0] === "tab.new"),
      [],
    );
  } finally {
    fake.cleanup();
  }
});

test("surf explore --frame-hint in a shape the framework cannot read refuses with the two it can", () => {
  const fake = createFakeSurf({ pages: FRAMED_EXPLORE_PAGES });

  try {
    const result = runCli(
      [
        "surf",
        "explore",
        "--url",
        "https://example.com/",
        "--ready-selector",
        "#play",
        "--frame-hint",
        "https://embed.example/",
        "--json",
      ],
      diagnosisEnv(fake),
    );

    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.error.code, "config_invalid");
    assert.match(payload.error.message, /urlPrefix=<prefix>' or 'selector=<css>/);
  } finally {
    fake.cleanup();
  }
});

test("a --ready-selector the page does carry explores it normally", () => {
  const fake = createFakeSurf({
    pages: readyPages({
      "https://example.com/": { links: [], controls: [{ selector: "#go", text: "Go" }] },
    }),
  });

  try {
    const result = runCli(
      ["surf", "explore", "--url", "https://example.com/", "--ready-selector", "#go", "--json"],
      diagnosisEnv(fake),
    );

    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.result.coverage.status, "verified");
    assert.equal(payload.input.readySelector, "#go");
    // no failure, so no diagnosis: one frame.diagnose per element-reach failure, never per run
    assert.equal(
      fake.calls().some((call) => call[0] === "frame.diagnose"),
      false,
    );
  } finally {
    fake.cleanup();
  }
});

test("a test run with agents.<name>.readySelector carries the frame determination onto its finding", () => {
  const fake = createFakeSurf({ pages: FRAMED_EXPLORE_PAGES });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-ready-selector-"));
  const configPath = path.join(tempDir, "surf-config.yaml");
  writeFileSync(
    configPath,
    [
      "version: '2.0'",
      "name: 'Surf Ready Selector'",
      "targets:",
      "  web: 'https://example.com/'",
      "agents:",
      "  web:",
      "    type: surf",
      "    ready_selector: '#does-not-exist'",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = runCli(["test", "--config", configPath, "--json"], diagnosisEnv(fake));

    const payload = JSON.parse(result.stdout);
    const findings = payload.result.findings;
    assert.equal(findings.length, 1, result.stdout);
    assert.equal(findings[0].frameRootCause.determination.value, "suspected");
    assert.equal(findings[0].frameRootCause.candidates.length, 2);
    // the surf code that produced the failure is kept, never renamed
    assert.equal(findings[0].outcome.code, "page_timeout");
    assert.match(findings[0].evidence[0], /^frame-root-cause: determination=suspected /);
    const commands = fake.calls().map((call) => call[0]);
    assert.equal(commands.includes("frame.diagnose"), true);
    assert.equal(commands.includes("tab.close"), true);
  } finally {
    fake.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("a test run with agents.<name>.frameHint confirms the frame the selector lives in", () => {
  const fake = createFakeSurf({ pages: FRAMED_EXPLORE_PAGES });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-frame-hint-"));
  const configPath = path.join(tempDir, "surf-config.yaml");
  writeFileSync(
    configPath,
    [
      "version: '2.0'",
      "name: 'Surf Frame Hint'",
      "targets:",
      "  web: 'https://example.com/'",
      "agents:",
      "  web:",
      "    type: surf",
      "    ready_selector: '#play'",
      "    frame_hint: 'urlPrefix=https://embed.example/'",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = runCli(["test", "--config", configPath, "--json"], diagnosisEnv(fake));

    const findings = JSON.parse(result.stdout).result.findings;
    assert.equal(findings.length, 1, result.stdout);
    assert.equal(findings[0].frameRootCause.determination.value, "confirmed");
    assert.equal(findings[0].frameRootCause.hint, "urlPrefix=https://embed.example/");
    assert.match(findings[0].evidence[0], /^frame-root-cause: determination=confirmed /);
  } finally {
    fake.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

/** Two top-level third-party frames; `selectors` is what `wait.element` finds inside each. */
function probedPages(first, second) {
  return readyPages({
    "https://example.com/": {
      links: [],
      frames: [
        { src: "https://embed.example/player.html", outOfProcess: true, selectors: first },
        { src: "https://ads.example/slot.html", outOfProcess: true, selectors: second },
      ],
    },
  });
}

function exploreProbe(fake, extraEnv = {}) {
  const result = runCli(
    [
      "surf",
      "explore",
      "--url",
      "https://example.com/",
      "--ready-selector",
      "#play",
      "--frame-probe",
      "--json",
    ],
    { ...diagnosisEnv(fake), ...extraEnv },
  );
  return { result, payload: JSON.parse(result.stdout), commands: fake.calls().map((c) => c[0]) };
}

test("--frame-probe confirms the one frame that holds the selector, and restores every switch (AK #5569)", () => {
  const fake = createFakeSurf({ pages: probedPages([], ["#play"]) });
  try {
    const { result, payload, commands } = exploreProbe(fake);
    assert.equal(result.status, 1);
    assert.equal(payload.error.code, "element_unreachable");
    assert.equal(payload.error.details.determination, "confirmed");
    assert.match(payload.error.message, /in-frame probe found '#play' inside exactly one of 2/);
    const count = (name) => commands.filter((c) => c === name).length;
    assert.equal(count("frame.switch"), 2);
    assert.equal(count("wait.element"), 2);
    assert.equal(count("frame.main"), 2, "every switch is restored");
    assert.equal(commands.includes("tab.close"), true);
    // the probe is read-only: it never runs js inside a switched frame
    const firstSwitch = commands.indexOf("frame.switch");
    const lastMain = commands.lastIndexOf("frame.main");
    assert.equal(commands.slice(firstSwitch, lastMain).includes("js"), false);
  } finally {
    fake.cleanup();
  }
});

test("--frame-probe: two frames holding the selector are undetermined, none is suspected, never excluded", () => {
  const both = createFakeSurf({ pages: probedPages(["#play"], ["#play"]) });
  try {
    assert.equal(exploreProbe(both).payload.error.details.determination, "undetermined");
  } finally {
    both.cleanup();
  }
  const none = createFakeSurf({ pages: probedPages([], []) });
  try {
    const { payload } = exploreProbe(none);
    assert.equal(payload.error.details.determination, "suspected");
    assert.match(payload.error.message, /absence is not exclusion/);
  } finally {
    none.cleanup();
  }
});

test("--frame-probe: a frame.main that fails closes the tab and stops probing", () => {
  const fake = createFakeSurf({ pages: probedPages([], ["#play"]) });
  try {
    const { payload, commands } = exploreProbe(fake, { FAKE_SURF_FAIL_ON: "frame.main" });
    assert.equal(payload.error.details.determination, "suspected");
    assert.match(payload.error.message, /could not be probed/);
    assert.equal(commands.filter((c) => c === "frame.switch").length, 1, "no second switch");
    assert.equal(commands.includes("tab.close"), true);
  } finally {
    fake.cleanup();
  }
});

test("--frame-probe: nested and unanswering frames are recorded and block a confirmation", () => {
  const nested = createFakeSurf({
    pages: readyPages({
      "https://example.com/": {
        links: [],
        frames: [
          { src: "https://embed.example/player.html", outOfProcess: true, selectors: ["#play"] },
          { src: "https://inner.example/", outOfProcess: true, nestedUnder: 0 },
        ],
      },
    }),
  });
  try {
    const { payload } = exploreProbe(nested);
    // a hit in the top-level frame, but the nested one could hold the selector too
    assert.equal(payload.error.details.determination, "suspected");
    assert.match(payload.error.message, /1 of 2 candidate frame\(s\) could not be probed/);
  } finally {
    nested.cleanup();
  }
  const erroring = createFakeSurf({ pages: probedPages([], ["#play"]) });
  try {
    // a probe that errors for any reason other than surf's own timeout is unanswered, not a miss
    const { payload } = exploreProbe(erroring, { FAKE_SURF_FAIL_ON: "wait.element" });
    assert.equal(payload.error.details.determination, "suspected");
    assert.match(payload.error.message, /2 of 2 candidate frame\(s\) could not be probed/);
  } finally {
    erroring.cleanup();
  }
});

test("--frame-probe without --ready-selector refuses before a browser is touched", () => {
  const fake = createFakeSurf({ pages: probedPages([], ["#play"]) });
  try {
    const result = runCli(
      ["surf", "explore", "--url", "https://example.com/", "--frame-probe", "--json"],
      diagnosisEnv(fake),
    );
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "config_invalid");
    assert.equal(
      fake.calls().some((c) => c[0] === "tab.new"),
      false,
    );
  } finally {
    fake.cleanup();
  }
});

test("a test run with agents.<name>.frameProbe confirms through the probe", () => {
  const fake = createFakeSurf({ pages: probedPages([], ["#play"]) });
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-frame-probe-"));
  const configPath = path.join(tempDir, "surf-config.yaml");
  writeFileSync(
    configPath,
    [
      "version: '2.0'",
      "name: 'Surf Frame Probe'",
      "targets:",
      "  web: 'https://example.com/'",
      "agents:",
      "  web:",
      "    type: surf",
      "    ready_selector: '#play'",
      "    frame_probe: true",
      "",
    ].join("\n"),
    "utf8",
  );
  try {
    const result = runCli(["test", "--config", configPath, "--json"], diagnosisEnv(fake));
    const findings = JSON.parse(result.stdout).result.findings;
    assert.equal(findings.length, 1, result.stdout);
    assert.equal(findings[0].frameRootCause.determination.value, "confirmed");
    assert.equal(findings[0].frameRootCause.probe.length, 2);
    assert.equal(findings[0].frameRootCause.hint, null);
  } finally {
    fake.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("surf explore js probes never leave a screenshot of the page behind", () => {
  const fake = createFakeSurf({ pages: readyPages({ "https://example.com/": { links: [] } }) });

  try {
    runCli(["surf", "explore", "--url", "https://example.com/", "--json"], diagnosisEnv(fake));

    const jsCalls = fake.calls().filter((call) => call[0] === "js");
    assert.equal(jsCalls.length > 0, true);
    for (const call of jsCalls) {
      assert.equal(call.includes("--no-screenshot"), true, call.join(" "));
    }
  } finally {
    fake.cleanup();
  }
});

test("surf explore --json prints the operation envelope on a successful run", () => {
  const fake = createFakeSurf({
    pages: readyPages({ "https://example.com/": { links: [] } }),
  });

  try {
    const result = runCli(["surf", "explore", "--url", "https://example.com/", "--json"], {
      TEST_CAPABILITIES_SURF_BIN: fake.path,
    });

    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.operationId, "surf.explore");
    assert.equal(payload.input.url, "https://example.com/");
    assert.equal(payload.input.json, true);
    assert.equal(typeof payload.result.coverage.userFlows, "number");
  } finally {
    fake.cleanup();
  }
});
