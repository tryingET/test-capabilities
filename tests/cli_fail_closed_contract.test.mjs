import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { runtimeEnv } from "./helpers/runtime-dist.mjs";

const binPath = new URL("../bin/test-capabilities", import.meta.url).pathname;

function runCli(args, extraEnv = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
    env: runtimeEnv(extraEnv),
  });
}

test("CLI doctor command passes as zero-external-dependency happy path", () => {
  const result = runCli(["doctor", "--json"], {
    PATH: path.dirname(process.execPath),
    TEST_CAPABILITIES_SURF_GO_BIN: "",
    TEST_CAPABILITIES_SURF_GO_REPO: "",
    TEST_CAPABILITIES_BOMBADIL_BIN: "",
    TEST_CAPABILITIES_BOMBADIL_REPO: "",
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.operationId, "doctor");
  assert.equal(payload.status, "pass");
  assert.equal(payload.summary.requiredFailed, 0);
  assert.equal(
    payload.checks.some((check) => check.id === "external.surf_go" && check.required === false),
    true,
  );
  assert.equal(
    payload.checks.some((check) => check.id === "external.bombadil" && check.required === false),
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
  const fakeSurfGo = path.join(tempDir, "surf-go");
  const configPath = path.join(tempDir, "surf-config.yaml");

  writeFileSync(
    fakeSurfGo,
    `#!/bin/sh
cmd="$1"
if [ "$cmd" = "navigate" ]; then
  printf '{ "success": true, "url": "https://example.com" }\n'
  exit 0
fi
if [ "$cmd" = "js" ]; then
  probe=\${2#*\\"}
  probe=\${probe%%\\"*}
  printf '{ "__testCapabilitiesSurfExploreProbe": "%s", "href": "https://example.com", "title": "Example Domain", "readyState": "complete" }\n' "$probe"
  exit 0
fi
printf '%s\n' "$@"
`,
    { mode: 0o755 },
  );
  writeFileSync(
    configPath,
    [
      "version: '2.0'",
      "name: 'Surf CLI Contract'",
      "targets:",
      "  web: 'https://placeholder.example.com'",
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
        PATH: `${tempDir}${path.delimiter}${process.env.PATH ?? ""}`,
        TEST_CAPABILITIES_SURF_GO_BIN: fakeSurfGo,
      },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /Health:\s+pass/);
    assert.match(`${result.stdout}\n${result.stderr}`, /user=100%/);
  } finally {
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

test("unsupported CLI commands fail clearly instead of emitting placeholders", () => {
  const result = runCli(["predict"]);

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported CLI command\(s\): predict/);
});
