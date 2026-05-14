import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { CAPABILITY_MATRIX } = await importRuntimeModule("core/capabilities.js");
const {
  CLI_OPERATION_REGISTRY,
  CLI_ROUTE_MANIFEST,
  SURF_EXPLORE_OPTION_SUPPORT,
  TEST_OPTION_SUPPORT,
  executeCliOperation,
  executeHealOperation,
  executeSurfExploreOperation,
  executeTestOperation,
  resolveCliRoute,
} = await importRuntimeModule("core/operations.js");
const {
  getCliCommandStatus,
  getSurfActionStatus,
  resolveCliRoute: resolveCliRouteCore,
} = await importRuntimeModule("core/operations/dispatch-manifest.js");
const {
  assertKnownSurfExecutionRoute,
  executeCliOperation: executeCliOperationCore,
  requireManifestEntry,
  requireRegisteredOperation,
  throwUnavailableManifestEntry,
  throwUnsupportedCommand,
} = await importRuntimeModule("core/operations/dispatch-execution.js");

function withFakeSurfGo(script) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-operation-kernel-"));
  const surfGoPath = path.join(dir, "surf-go");
  writeFileSync(surfGoPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });

  return {
    dir,
    path: surfGoPath,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function withSurfGoEnv(binaryPath, callback) {
  const previousBin = process.env.TEST_CAPABILITIES_SURF_GO_BIN;
  const previousRepo = process.env.TEST_CAPABILITIES_SURF_GO_REPO;
  process.env.TEST_CAPABILITIES_SURF_GO_BIN = binaryPath;
  delete process.env.TEST_CAPABILITIES_SURF_GO_REPO;

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (previousBin === undefined) {
        delete process.env.TEST_CAPABILITIES_SURF_GO_BIN;
      } else {
        process.env.TEST_CAPABILITIES_SURF_GO_BIN = previousBin;
      }
      if (previousRepo === undefined) {
        delete process.env.TEST_CAPABILITIES_SURF_GO_REPO;
      } else {
        process.env.TEST_CAPABILITIES_SURF_GO_REPO = previousRepo;
      }
    });
}

test("operation kernel registry and capability matrix stay aligned", () => {
  const implementedOperationIds = CLI_ROUTE_MANIFEST.filter(
    (entry) => entry.status === "implemented" && entry.operationId,
  )
    .map((entry) => entry.operationId)
    .sort();

  const registryOperationIds = Object.values(CLI_OPERATION_REGISTRY)
    .map((definition) => definition.id)
    .sort();

  assert.deepEqual(implementedOperationIds, registryOperationIds);
  assert.deepEqual(CAPABILITY_MATRIX.cli.testOptions, TEST_OPTION_SUPPORT);
  assert.deepEqual(CAPABILITY_MATRIX.cli.surfExploreOptions, SURF_EXPLORE_OPTION_SUPPORT);
  assert.equal(CAPABILITY_MATRIX.cli.commands.doctor, "implemented");
  assert.equal(CAPABILITY_MATRIX.cli.commands.demo, "implemented");
  assert.equal(CAPABILITY_MATRIX.cli.commands.surf, "implemented");
  assert.equal(getCliCommandStatus("test"), "implemented");
  assert.equal(getCliCommandStatus("doctor"), "implemented");
  assert.equal(getCliCommandStatus("demo"), "implemented");
  assert.equal(getCliCommandStatus("predict"), "unsupported");
  assert.equal(getSurfActionStatus("explore"), "implemented");
  assert.equal(getSurfActionStatus("flow"), "unsupported");
  assert.equal(
    resolveCliRoute({ command: "surf", action: "explore" })?.operationId,
    "surf.explore",
  );
  assert.equal(
    resolveCliRouteCore({ command: "surf", action: "explore" })?.operationId,
    "surf.explore",
  );
  assert.equal(resolveCliRoute({ command: "doctor" })?.operationId, "doctor");
  assert.equal(resolveCliRoute({ command: "demo" })?.operationId, "demo");
  assert.equal(resolveCliRoute({ command: "predict" })?.status, "unsupported");
});

test("executeCliOperation routes doctor through a zero-external-dependency happy path", async () => {
  const result = await executeCliOperation({ command: "doctor" }, {});

  assert.equal(result.operationId, "doctor");
  assert.equal(result.status, "pass");
  assert.equal(result.summary.requiredFailed, 0);
  assert.equal(
    result.checks.some((check) => check.id === "node.version" && check.status === "pass"),
    true,
  );
  assert.equal(
    result.checks.some((check) => check.id === "package.version" && check.status === "pass"),
    true,
  );
  assert.equal(
    result.checks.some((check) => check.id === "config.shape" && check.status === "pass"),
    true,
  );
  assert.equal(
    result.checks.some((check) => check.id === "external.surf_go" && check.required === false),
    true,
  );
  assert.equal(
    result.checks.some((check) => check.id === "external.bombadil" && check.required === false),
    true,
  );
});

test("executeCliOperation doctor validates CLI target executability", async () => {
  const result = await executeCliOperation({ command: "doctor" }, { target: process.execPath });

  assert.equal(result.operationId, "doctor");
  assert.equal(result.status, "pass");
  assert.equal(
    result.checks.some((check) => check.id === "target.cli" && check.status === "pass"),
    true,
  );
});

test("executeCliOperation doctor fails closed for missing CLI targets", async () => {
  const result = await executeCliOperation(
    { command: "doctor" },
    { target: "definitely-missing-test-capabilities-command" },
  );

  assert.equal(result.operationId, "doctor");
  assert.equal(result.status, "fail");
  assert.equal(
    result.checks.some((check) => check.id === "target.cli" && check.status === "fail"),
    true,
  );
});

test("executeCliOperation doctor validates URL targets without requiring CLI executability", async () => {
  const result = await executeCliOperation(
    { command: "doctor" },
    { target: "https://example.com" },
  );

  assert.equal(result.operationId, "doctor");
  assert.equal(result.status, "pass");
  assert.equal(
    result.checks.some((check) => check.id === "target.web" && check.status === "pass"),
    true,
  );
});

test("executeCliOperation routes demo through the built-in zero-external-dependency fixture", async () => {
  const result = await executeCliOperation({ command: "demo" }, {});

  assert.equal(result.operationId, "demo");
  assert.equal(result.summary.health, "pass");
  assert.equal(result.result.passed, true);
  assert.equal(result.result.findings.length, 0);
  assert.match(result.demo.cliFixture, /examples\/demo\/cli-demo\.mjs$/);
  assert.match(result.demo.configFixture, /examples\/demo\/test-capabilities\.yaml$/);
  assert.equal(result.coreUseCase.id, "cli-smoke-observation");
  assert.match(result.coreUseCase.title, /CLI smoke/);
  assert.equal(
    result.coreUseCase.proves.includes(
      "the orchestrator records a passing observation.v1 smoke signal",
    ),
    true,
  );
  assert.equal(result.coreUseCase.commands.includes("test-capabilities demo --json"), true);
  assert.match(result.effectiveConfig.targets.cli, /examples\/demo\/cli-demo\.mjs/);
});

test("executeCliOperation routes the test verb through the typed operation kernel", async () => {
  const result = await executeCliOperation(
    { command: "test" },
    {
      config: new URL("../test-capabilities.yaml", import.meta.url).pathname,
      target: process.execPath,
      quick: true,
    },
  );

  assert.equal(result.operationId, "test");
  assert.equal(result.summary.health, "pass");
  assert.equal(result.result.passed, true);
  assert.equal(result.result.coverage.status, "partial");
  assert.equal(result.input.quick, true);
  assert.equal(result.effectiveConfig.targets.cli, process.execPath);
});

test("executeCliOperation rejects URL test targets when no supported web consumer is enabled", async () => {
  await assert.rejects(
    async () =>
      executeCliOperation(
        { command: "test" },
        {
          config: new URL("../test-capabilities.yaml", import.meta.url).pathname,
          target: "https://example.com",
          quick: true,
        },
      ),
    /URL targets for 'test' require a real web-consuming runtime path/,
  );
});

test("direct executeTestOperation export stays wired to the same runtime path", async () => {
  const result = await executeTestOperation({
    config: new URL("../test-capabilities.yaml", import.meta.url).pathname,
    target: process.execPath,
    quick: true,
  });

  assert.equal(result.operationId, "test");
  assert.equal(result.summary.health, "pass");
  assert.equal(result.result.passed, true);
  assert.equal(result.input.quick, true);
  assert.equal(result.effectiveConfig.targets.cli, process.execPath);
});

test("executeCliOperation routes surf explore through the typed operation kernel", async () => {
  const fake = withFakeSurfGo(`
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
`);

  try {
    await withSurfGoEnv(fake.path, async () => {
      const result = await executeCliOperation(
        { command: "surf", action: "explore" },
        { url: "https://example.com" },
      );

      assert.equal(result.operationId, "surf.explore");
      assert.deepEqual(result.result.args, ["navigate", "--url", "https://example.com/"]);
      assert.match(result.result.stdout, /"href": "https:\/\/example\.com"/);
      assert.match(result.result.stdout, /"title": "Example Domain"/);
      assert.equal(result.result.evidence.verified, true);
      assert.equal(result.result.coverage.userFlows, 100);
      assert.equal(result.result.coverage.probesVerified, 2);
      assert.equal(result.result.coverage.probesRequired, 2);
      assert.equal(result.result.pages[0].probes.length, 2);
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation rejects empty successful surf-go processes", async () => {
  await withSurfGoEnv("/bin/true", async () => {
    await assert.rejects(
      async () => executeSurfExploreOperation({ url: "https://example.com" }),
      /Surf explore produced no runtime evidence/,
    );
  });
});

test("executeSurfExploreOperation rejects non-evidence surf stdout", async () => {
  const fake = withFakeSurfGo('printf "%s\\n" "$@"');

  try {
    await withSurfGoEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /produced no verified browser evidence/,
      );
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation rejects success plus target URL without browser state", async () => {
  const fake = withFakeSurfGo(`printf '{ "success": true, "url": "https://example.com" }\n'`);

  try {
    await withSurfGoEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /produced no verified browser evidence/,
      );
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation accepts Surf Go YAML probe browser state evidence", async () => {
  const fake = withFakeSurfGo(`
cmd="$1"
if [ "$cmd" = "js" ]; then
  probe=\${2#*\\"}
  probe=\${probe%%\\"*}
  printf -- '---\n__testCapabilitiesSurfExploreProbe: %s\ncurrentUrl: https://example.com\ntitle: Example Domain\n---\n' "$probe"
  exit 0
fi
printf '{ "success": true, "url": "https://example.com" }\n'
`);

  try {
    await withSurfGoEnv(fake.path, async () => {
      const result = await executeSurfExploreOperation({ url: "https://example.com" });

      assert.equal(result.operationId, "surf.explore");
      assert.equal(result.result.evidence.verified, true);
      assert.equal(result.result.coverage.userFlows, 100);
      assert.match(result.result.pages[0].probes[0].signal, /structured currentUrl/);
    });
  } finally {
    fake.cleanup();
  }
});

test("executeCliOperation rejects surf explore flags that are not wired to runtime behavior", async () => {
  await assert.rejects(
    async () =>
      executeCliOperation(
        { command: "surf", action: "explore" },
        { url: "https://example.com", record: true },
      ),
    /Unsupported option\(s\) for 'surf explore': --record/,
  );
});

test("executeSurfExploreOperation rejects navigate success when the browser-state probe has no URL", async () => {
  const fake = withFakeSurfGo(`
cmd="$1"
if [ "$cmd" = "navigate" ]; then
  printf '{ "success": true, "url": "https://example.com" }\n'
  exit 0
fi
if [ "$cmd" = "js" ]; then
  printf 'loading: false\ntitle: Example Domain\n'
  exit 0
fi
printf '%s\n' "$@"
`);

  try {
    await withSurfGoEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /produced no verified browser evidence/,
      );
    });
  } finally {
    fake.cleanup();
  }
});

test("direct executeSurfExploreOperation export stays wired to the surf-go runtime helper", async () => {
  const fake = withFakeSurfGo(`
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
`);

  try {
    await withSurfGoEnv(fake.path, async () => {
      const result = await executeSurfExploreOperation({ url: "https://example.com" });

      assert.equal(result.operationId, "surf.explore");
      assert.deepEqual(result.result.args, ["navigate", "--url", "https://example.com/"]);
      assert.match(result.result.stdout, /href/);
      assert.equal(result.result.evidence.coverageScore, 100);
      assert.equal(result.result.coverage.status, "verified");
      assert.equal(result.result.pages[0].probes[0].signal, "structured href with browser state");
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation follows same-origin links for bounded depth coverage", async () => {
  const fake = withFakeSurfGo(`
state_file="$(dirname "$0")/current-url"
cmd="$1"
if [ "$cmd" = "navigate" ]; then
  printf '%s\n' "$3" > "$state_file"
  printf '{ "success": true, "url": "%s" }\n' "$3"
  exit 0
fi
if [ "$cmd" = "js" ]; then
  current_url="$(cat "$state_file")"
  probe=\${2#*\\"}
  probe=\${probe%%\\"*}
  if [ "$current_url" = "https://example.com/" ]; then
    printf '{ "__testCapabilitiesSurfExploreProbe": "%s", "href": "%s", "title": "Home", "readyState": "complete", "links": ["https://example.com/page-2"] }\n' "$probe" "$current_url"
  else
    printf '{ "__testCapabilitiesSurfExploreProbe": "%s", "href": "%s", "title": "Page 2", "readyState": "complete", "links": [] }\n' "$probe" "$current_url"
  fi
  exit 0
fi
printf '%s\n' "$@"
`);

  try {
    await withSurfGoEnv(fake.path, async () => {
      const result = await executeSurfExploreOperation({ url: "https://example.com/", depth: "2" });

      assert.equal(result.result.coverage.userFlows, 100);
      assert.equal(result.result.coverage.requestedDepth, 2);
      assert.equal(result.result.coverage.reachedDepth, 2);
      assert.equal(result.result.coverage.pagesVisited, 2);
      assert.equal(result.result.coverage.pagesDiscovered, 2);
      assert.equal(result.result.coverage.probesVerified, 5);
      assert.equal(result.result.coverage.probesRequired, 5);
      assert.deepEqual(
        result.result.pages.map((page) => page.url),
        ["https://example.com/", "https://example.com/page-2"],
      );
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation reports partial graded coverage for failed deeper pages", async () => {
  const fake = withFakeSurfGo(`
state_file="$(dirname "$0")/current-url"
cmd="$1"
if [ "$cmd" = "navigate" ]; then
  if [ "$3" = "https://example.com/broken" ]; then
    echo 'navigation failed' >&2
    exit 7
  fi
  printf '%s\n' "$3" > "$state_file"
  printf '{ "success": true, "url": "%s" }\n' "$3"
  exit 0
fi
if [ "$cmd" = "js" ]; then
  current_url="$(cat "$state_file")"
  probe=\${2#*\\"}
  probe=\${probe%%\\"*}
  printf '{ "__testCapabilitiesSurfExploreProbe": "%s", "href": "%s", "title": "Home", "readyState": "complete", "links": ["https://example.com/broken"] }\n' "$probe" "$current_url"
  exit 0
fi
printf '%s\n' "$@"
`);

  try {
    await withSurfGoEnv(fake.path, async () => {
      const result = await executeSurfExploreOperation({ url: "https://example.com/", depth: "2" });

      assert.equal(result.result.coverage.userFlows, 60);
      assert.equal(result.result.coverage.status, "partial");
      assert.equal(result.result.coverage.pagesVisited, 2);
      assert.equal(result.result.coverage.pagesVerified, 1);
      assert.equal(result.result.coverage.probesVerified, 3);
      assert.equal(result.result.coverage.probesRequired, 5);
      assert.equal(result.result.pages[1].verified, false);
      assert.match(result.result.pages[1].probes[0].error, /navigation failed/);
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation rejects invalid depth values", async () => {
  await assert.rejects(
    async () => executeSurfExploreOperation({ url: "https://example.com", depth: "4" }),
    /Surf explore --depth must be an integer from 1 to 3/,
  );
});

test("executeCliOperation requires an explicit surf explore URL", async () => {
  await assert.rejects(
    async () => executeCliOperation({ command: "surf", action: "explore" }, {}),
    /Surf explore requires --url with a valid URL/,
  );
});

test("executeCliOperation rejects invalid surf explore targets", async () => {
  await assert.rejects(
    async () => executeCliOperation({ command: "surf", action: "explore" }, { url: "not-a-url" }),
    /Surf explore target must be a valid URL/,
  );
});

test("executeCliOperation fails closed when the heal directory is missing", async () => {
  await assert.rejects(
    async () =>
      executeCliOperation({ command: "heal" }, { dir: "/tmp/definitely-missing-heal-dir" }),
    /Heal directory not found:/,
  );
});

test("executeCliOperation heal ignores generated and dependency directories", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-scan-"));
  const srcDir = path.join(dir, "src");
  const ignoredDir = path.join(dir, "node_modules");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(ignoredDir, { recursive: true });
  writeFileSync(path.join(srcDir, "sample.test.ts"), "export const ok = true;\n", "utf8");

  const unreadableFile = path.join(ignoredDir, "ignored.test.ts");
  writeFileSync(unreadableFile, "export const ignored = true;\n", { mode: 0o000 });
  chmodSync(unreadableFile, 0o000);

  try {
    const result = await executeCliOperation({ command: "heal" }, { dir, dryRun: true });

    assert.equal(result.proposals.length, 0);
  } finally {
    chmodSync(unreadableFile, 0o644);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal writes dry-run proposal and verification artifacts without mutating files", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-artifact-"));
  const file = path.join(dir, "sample.test.ts");
  const artifactPath = path.join(dir, "artifacts", "heal-proposals.json");
  const verificationPath = path.join(dir, "artifacts", "heal-verification.json");
  const original = "test('login', async () => { await page.locator('#old-login').click(); });\n";
  writeFileSync(file, original, "utf8");

  try {
    const result = await executeCliOperation(
      { command: "heal" },
      {
        dir,
        dryRun: true,
        proposalOutput: artifactPath,
        verificationOutput: verificationPath,
        checkpointRef: "checkpoint/demo-heal-001",
      },
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const verificationArtifact = JSON.parse(readFileSync(verificationPath, "utf8"));

    assert.equal(result.appliedCount, 0);
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposalArtifact.path, artifactPath);
    assert.equal(result.proposalArtifact.schemaVersion, 1);
    assert.equal(result.proposalArtifact.proposalCount, 1);
    assert.equal(result.verification.status, "pass");
    assert.equal(result.verificationArtifact.path, verificationPath);
    assert.equal(result.verificationArtifact.schemaVersion, 1);
    assert.equal(result.verificationArtifact.status, "pass");
    assert.equal(result.verificationArtifact.proposalCount, 1);
    assert.equal(readFileSync(file, "utf8"), original);
    assert.equal(artifact.schema_version, 1);
    assert.equal(artifact.artifact_kind, "test-capabilities.heal.proposal");
    assert.equal(artifact.operation_id, "heal");
    assert.equal(artifact.mutation.mode, "dry_run");
    assert.equal(artifact.mutation.applied_count, 0);
    assert.equal(artifact.mutation.external_checkpoint_required_for_apply, true);
    assert.equal(artifact.mutation.external_checkpoint_ref, "checkpoint/demo-heal-001");
    assert.equal(artifact.mutation.replay_fabric_guidance_only, true);
    assert.equal(artifact.summary.scanned_file_count, 1);
    assert.equal(artifact.summary.proposal_count, 1);
    assert.equal(artifact.summary.file_count_with_proposals, 1);
    assert.equal(artifact.proposals[0].oldSelector, "#old-login");
    assert.equal(artifact.proposals[0].newSelector, "#login");
    assert.equal(verificationArtifact.schema_version, 1);
    assert.equal(verificationArtifact.artifact_kind, "test-capabilities.heal.verification");
    assert.equal(verificationArtifact.proposal_artifact.path, artifactPath);
    assert.equal(verificationArtifact.mutation.external_checkpoint_ref, "checkpoint/demo-heal-001");
    assert.equal(verificationArtifact.verification.mode, "in_memory_apply_check");
    assert.equal(verificationArtifact.verification.status, "pass");
    assert.equal(verificationArtifact.verification.proposalCount, 1);
    assert.equal(verificationArtifact.verification.checkedFileCount, 1);
    assert.deepEqual(verificationArtifact.verification.failures, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal rejects proposal and verification artifacts outside dry-run mode", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-artifact-reject-"));

  try {
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          {
            dir,
            dryRun: false,
            proposalOutput: path.join(dir, "proposal.json"),
            verificationOutput: path.join(dir, "verification.json"),
          },
        ),
      /Healing proposal and verification artifacts are only supported with --dry-run/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal requires an external checkpoint ref before applying proposals", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-checkpoint-required-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('login', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );

  try {
    await assert.rejects(
      async () => executeCliOperation({ command: "heal" }, { dir, dryRun: false }),
      /Healing apply requires --checkpoint-ref/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal applies multiple same-line proposals in one pass", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-atomic-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('multi', async () => { await page.locator('#old-login'); await page.locator('#deprecated-submit'); });\n",
    "utf8",
  );

  try {
    const result = await executeCliOperation(
      { command: "heal" },
      { dir, dryRun: false, checkpointRef: "checkpoint/heal-atomic-001" },
    );
    const updated = readFileSync(file, "utf8");

    assert.equal(result.appliedCount, 2);
    assert.equal(result.checkpointRef, "checkpoint/heal-atomic-001");
    assert.match(updated, /locator\('#login'\)/);
    assert.match(updated, /locator\('#submit'\)/);
    assert.doesNotMatch(updated, /#old-login/);
    assert.doesNotMatch(updated, /#deprecated-submit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("direct executeHealOperation export stays wired to the healing runtime helper", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-direct-"));

  try {
    const result = await executeHealOperation({ dir, dryRun: true });
    assert.equal(result.operationId, "heal");
    assert.equal(result.input.dryRun, true);
    assert.deepEqual(result.proposals, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("direct dispatch-core executeCliOperation stays wired to the registered operations", async () => {
  const result = await executeCliOperationCore(
    { command: "test" },
    {
      config: new URL("../test-capabilities.yaml", import.meta.url).pathname,
      target: process.execPath,
      quick: true,
    },
  );

  assert.equal(result.operationId, "test");
  assert.equal(result.result.passed, true);
});

test("dispatch helpers fail clearly for unsupported or malformed routes", () => {
  assert.throws(
    () => assertKnownSurfExecutionRoute({ command: "surf" }),
    /Unsupported surf action\(s\): \(missing action\)/,
  );
  assert.throws(
    () => assertKnownSurfExecutionRoute({ command: "surf", action: "typo" }),
    /Unsupported surf action\(s\): typo/,
  );
  assert.doesNotThrow(() => assertKnownSurfExecutionRoute({ command: "test" }));

  assert.equal(requireManifestEntry({ command: "test" }).operationId, "test");
  assert.equal(requireManifestEntry({ command: "predict" }).status, "unsupported");

  assert.throws(() => requireManifestEntry({}), /Invalid CLI route payload: \{\}/);

  assert.equal(requireRegisteredOperation(requireManifestEntry({ command: "test" })).id, "test");
  assert.throws(
    () => requireRegisteredOperation(requireManifestEntry({ command: "predict" })),
    /Unsupported CLI command\(s\): predict/,
  );
  assert.throws(
    () =>
      throwUnavailableManifestEntry({
        command: "surf",
        action: "flow",
        status: "unsupported",
        description: "flow",
      }),
    /Unsupported surf action\(s\): flow/,
  );
  assert.throws(
    () => throwUnsupportedCommand({ command: "typo" }, { command: "typo" }),
    /Unsupported CLI command\(s\): typo/,
  );
});

test("executeCliOperation fails clearly for unsupported or unknown routes", async () => {
  await assert.rejects(
    async () => executeCliOperation({ command: "surf", action: "flow" }, {}),
    /Unsupported surf action\(s\): flow/,
  );

  await assert.rejects(
    async () => executeCliOperation({ command: "surf", action: "typo" }, {}),
    /Unsupported surf action\(s\): typo/,
  );

  await assert.rejects(
    async () => executeCliOperation({ command: "surf" }, {}),
    /Unsupported surf action\(s\): \(missing action\)/,
  );

  await assert.rejects(
    async () => executeCliOperation({ command: "predict" }, {}),
    /Unsupported CLI command\(s\): predict/,
  );

  await assert.rejects(
    async () => executeCliOperation({ command: "typo" }, {}),
    /Unsupported CLI command\(s\): typo/,
  );
});
