import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { createFakeSurf, readyPages, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
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

function surfPages(extra = {}) {
  return readyPages({ "https://example.com/": { title: "Example Domain" }, ...extra });
}

function surfCommands(fake) {
  return fake
    .calls()
    .map((call) => call[0])
    .filter((command) => !command.startsWith("--"));
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
  assert.equal(CAPABILITY_MATRIX.cli.commands.init, "implemented");
  assert.equal(CAPABILITY_MATRIX.cli.commands.surf, "implemented");
  assert.equal(CAPABILITY_MATRIX.cli.commands["replacement-validation"], "implemented");
  assert.equal(getCliCommandStatus("test"), "implemented");
  assert.equal(getCliCommandStatus("doctor"), "implemented");
  assert.equal(getCliCommandStatus("demo"), "implemented");
  assert.equal(getCliCommandStatus("init"), "implemented");
  assert.equal(getCliCommandStatus("replacement-validation"), "implemented");
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
  assert.equal(resolveCliRoute({ command: "init" })?.operationId, "init");
  assert.equal(
    resolveCliRoute({ command: "replacement-validation" })?.operationId,
    "replacement-validation",
  );
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
    result.checks.some((check) => check.id === "external.surf" && check.required === false),
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

test("executeCliOperation init writes a minimal fail-closed config", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-init-"));
  const output = path.join(tempDir, "test-capabilities.yaml");

  try {
    const result = await executeCliOperation(
      { command: "init" },
      { output, target: "node", force: false },
    );

    assert.equal(result.operationId, "init");
    assert.equal(result.template, "cli-smoke");
    assert.equal(result.written, true);
    assert.equal(result.outputPath, output);
    assert.match(readFileSync(output, "utf8"), /type: cli-tester/);
    assert.match(result.configText, /cli: 'node'/);
    assert.equal(
      result.nextCommands.includes(`test-capabilities test --config ${output} --quick`),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("executeCliOperation init refuses to overwrite without force", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-init-overwrite-"));
  const output = path.join(tempDir, "test-capabilities.yaml");
  writeFileSync(output, "existing", "utf8");

  try {
    await assert.rejects(
      async () => executeCliOperation({ command: "init" }, { output }),
      /Refusing to overwrite existing config/,
    );
    assert.equal(readFileSync(output, "utf8"), "existing");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("executeCliOperation init can print without writing", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-init-print-"));
  const output = path.join(tempDir, "printed.yaml");

  try {
    const result = await executeCliOperation(
      { command: "init" },
      { output, target: "custom 'cli'", print: true },
    );

    assert.equal(result.operationId, "init");
    assert.equal(result.written, false);
    assert.equal(result.configText.includes("cli: 'custom ''cli'''"), true);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
  assert.equal(result.input.json, false);
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
  const fake = createFakeSurf({ pages: surfPages() });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      const result = await executeCliOperation(
        { command: "surf", action: "explore" },
        { url: "https://example.com" },
      );

      assert.equal(result.operationId, "surf.explore");
      assert.equal(result.result.command, fake.path);
      assert.deepEqual(result.result.args, ["tab.new", "https://example.com/"]);
      assert.equal(result.result.runtime.flavor, "surf");
      assert.equal(result.result.runtime.provider, "explicit_bin");
      assert.equal(result.result.runtime.version, "2.18.0");
      assert.equal(result.result.runtime.mechanisms.waitReady, true);
      assert.equal(result.result.runtime.mechanisms.extract, true);
      assert.match(result.result.stdout, /"href": "https:\/\/example\.com\/"/);
      assert.match(result.result.stdout, /"title": "Example Domain"/);
      assert.equal(result.result.evidence.verified, true);
      assert.equal(result.result.coverage.userFlows, 100);
      assert.equal(result.result.coverage.probesVerified, 2);
      assert.equal(result.result.coverage.probesRequired, 2);
      assert.equal(result.result.pages[0].probes.length, 2);
      assert.equal(result.result.pages[0].tabId, 100);
      assert.equal(result.result.pages[0].readiness.state, "ready");
      assert.deepEqual(surfCommands(fake), ["tab.new", "wait.ready", "js", "js", "tab.close"]);
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation refuses an upstream surf without wait.ready and extract", async () => {
  const fake = createFakeSurf({ pages: surfPages(), mode: "upstream" });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /surf 2\.18\.0 via explicit_bin .* lacks wait\.ready and extract/,
      );
      assert.deepEqual(surfCommands(fake), []);
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation refuses retired surf-go env vars instead of ignoring them", async () => {
  const fake = createFakeSurf({ pages: surfPages() });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      process.env.TEST_CAPABILITIES_SURF_GO_BIN = "/opt/surf-go";
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /TEST_CAPABILITIES_SURF_GO_BIN is set, but the surf-go fork runtime was retired/,
      );
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation rejects empty successful surf processes", async () => {
  const fake = createFakeSurf({ pages: surfPages(), emptyOn: ["tab.new"] });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /could not open an owned tab for https:\/\/example\.com\/: 'surf tab\.new' did not report a tab id/,
      );
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation rejects empty probe output and still closes the owned tab", async () => {
  const fake = createFakeSurf({ pages: surfPages(), emptyOn: ["js"] });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /surf js returned empty output where JSON was expected/,
      );
      assert.deepEqual(surfCommands(fake), ["tab.new", "wait.ready", "js", "js", "tab.close"]);
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation rejects non-evidence surf stdout", async () => {
  const fake = createFakeSurf({
    pages: surfPages({ "https://example.com/": { jsResult: "surf fake output" } }),
  });

  try {
    await withFakeSurfEnv(fake.path, async () => {
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
  const fake = createFakeSurf({
    pages: surfPages({
      "https://example.com/": { jsResult: { success: true, url: "https://example.com" } },
    }),
  });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /produced no verified browser evidence/,
      );
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation fails closed on a typed login state and closes the owned tab", async () => {
  const fake = createFakeSurf({
    pages: surfPages({
      "https://example.com/": {
        readiness: "login",
        evidence: ["1 visible password field(s)", "title 'Sign in' mentions signing in"],
      },
    }),
  });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /Surf explore refused https:\/\/example\.com\/: page readiness is 'login' \[page_login\]: Page is not ready: login at https:\/\/example\.com\/\. Evidence: 1 visible password field\(s\); title 'Sign in' mentions signing in/,
      );
      assert.deepEqual(surfCommands(fake), ["tab.new", "wait.ready", "tab.close"]);
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation surfaces surf error codes from failed probes", async () => {
  const fake = createFakeSurf({
    pages: surfPages({
      "https://example.com/": { jsThrows: "Inspected target navigated or closed" },
    }),
  });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /Inspected target navigated or closed \[browser_error\]/,
      );
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

test("executeSurfExploreOperation rejects probe browser state without a URL", async () => {
  const fake = createFakeSurf({
    pages: surfPages({
      "https://example.com/": { jsResult: { loading: false, title: "Example Domain" } },
    }),
  });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      await assert.rejects(
        async () => executeSurfExploreOperation({ url: "https://example.com" }),
        /produced no verified browser evidence/,
      );
    });
  } finally {
    fake.cleanup();
  }
});

test("direct executeSurfExploreOperation export stays wired to the surf runtime helper", async () => {
  const fake = createFakeSurf({ pages: surfPages() });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      const result = await executeSurfExploreOperation({ url: "https://example.com" });

      assert.equal(result.operationId, "surf.explore");
      assert.deepEqual(result.result.args, ["tab.new", "https://example.com/"]);
      assert.match(result.result.stdout, /href/);
      assert.equal(result.result.evidence.coverageScore, 100);
      assert.equal(result.result.coverage.status, "verified");
      assert.equal(result.result.pages[0].probes[0].signal, "structured href with browser state");
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation follows same-origin links through extract for bounded depth coverage", async () => {
  const fake = createFakeSurf({
    pages: surfPages({
      "https://example.com/": {
        title: "Home",
        links: ["https://example.com/page-2", "https://elsewhere.example/off-origin"],
      },
      "https://example.com/page-2": { title: "Page 2", links: [] },
    }),
  });

  try {
    await withFakeSurfEnv(fake.path, async () => {
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
      assert.deepEqual(result.result.pages[0].links, { rowCount: 1, attempts: 1 });
      assert.deepEqual(result.result.pages[0].discoveredUrls, ["https://example.com/page-2"]);
      assert.match(
        result.result.pages[0].probes[2].signal,
        /extract verified 1 same-origin link row\(s\)/,
      );
      assert.deepEqual(surfCommands(fake).slice(0, 6), [
        "tab.new",
        "wait.ready",
        "js",
        "js",
        "extract",
        "tab.close",
      ]);
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation accepts zero extracted link rows explicitly", async () => {
  const fake = createFakeSurf({ pages: surfPages({ "https://example.com/": { links: [] } }) });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      const result = await executeSurfExploreOperation({ url: "https://example.com/", depth: "2" });

      assert.equal(result.result.coverage.userFlows, 100);
      assert.equal(result.result.coverage.probesRequired, 3);
      assert.equal(result.result.coverage.pagesVisited, 1);
      assert.deepEqual(result.result.pages[0].links, { rowCount: 0, attempts: 1 });
      assert.deepEqual(result.result.pages[0].discoveredUrls, []);
      assert.match(
        result.result.pages[0].probes[2].signal,
        /extract verified 0 same-origin link row\(s\) \(zero rows accepted explicitly\)/,
      );
      const extractCall = fake.calls().find((call) => call[0] === "extract");
      assert.ok(extractCall.includes("--allow-empty"));
    });
  } finally {
    fake.cleanup();
  }
});

test("executeSurfExploreOperation reports partial graded coverage for refused deeper pages", async () => {
  const fake = createFakeSurf({
    pages: surfPages({
      "https://example.com/": { title: "Home", links: ["https://example.com/missing"] },
      "https://example.com/missing": {
        readiness: "not-found",
        evidence: ["title 'Page not found' mentions a missing page"],
      },
    }),
  });

  try {
    await withFakeSurfEnv(fake.path, async () => {
      const result = await executeSurfExploreOperation({ url: "https://example.com/", depth: "2" });

      assert.equal(result.result.coverage.userFlows, 60);
      assert.equal(result.result.coverage.status, "partial");
      assert.equal(result.result.coverage.pagesVisited, 2);
      assert.equal(result.result.coverage.pagesVerified, 1);
      assert.equal(result.result.coverage.probesVerified, 3);
      assert.equal(result.result.coverage.probesRequired, 5);
      assert.equal(result.result.pages[1].verified, false);
      assert.equal(result.result.pages[1].readiness.state, "not-found");
      assert.equal(result.result.pages[1].readiness.code, "page_not_found");
      assert.equal(result.result.pages[1].probes[0].code, "page_not_found");
      assert.match(result.result.pages[1].probes[0].error, /page readiness is 'not-found'/);
      assert.equal(surfCommands(fake).filter((command) => command === "tab.close").length, 2);
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

test("executeCliOperation heal applies proposals from a reviewed proposal artifact", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-proposal-input-"));
  const file = path.join(dir, "sample.test.ts");
  const artifactPath = path.join(dir, "artifacts", "heal-proposals.json");
  writeFileSync(
    file,
    "test('login', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );

  try {
    const dryRun = await executeCliOperation(
      { command: "heal" },
      { dir, dryRun: true, proposalOutput: artifactPath },
    );
    assert.equal(dryRun.appliedCount, 0);
    assert.equal(dryRun.proposals.length, 1);

    const apply = await executeCliOperation(
      { command: "heal" },
      {
        dir,
        proposalInput: artifactPath,
        checkpointRef: "checkpoint/heal-proposal-input-001",
      },
    );

    assert.equal(apply.appliedCount, 1);
    assert.equal(apply.proposals.length, 1);
    assert.equal(apply.checkpointRef, "checkpoint/heal-proposal-input-001");
    assert.match(readFileSync(file, "utf8"), /#login/);
    assert.doesNotMatch(readFileSync(file, "utf8"), /#old-login/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal rejects unsafe proposal-input combinations and artifacts", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-proposal-input-reject-"));
  const file = path.join(dir, "sample.test.ts");
  const artifactPath = path.join(dir, "heal-proposals.json");
  const badArtifactPath = path.join(dir, "bad-proposals.json");
  writeFileSync(
    file,
    "test('login', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );

  try {
    await executeCliOperation(
      { command: "heal" },
      { dir, dryRun: true, proposalOutput: artifactPath },
    );
    writeFileSync(
      badArtifactPath,
      JSON.stringify({
        schema_version: 1,
        artifact_kind: "wrong",
        operation_id: "heal",
        proposals: [],
      }),
      "utf8",
    );

    await assert.rejects(
      async () => executeCliOperation({ command: "heal" }, { dir, proposalInput: artifactPath }),
      /requires --checkpoint-ref/,
    );
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, dryRun: true, proposalInput: artifactPath, checkpointRef: "checkpoint/reject" },
        ),
      /cannot be combined with --dry-run/,
    );
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, proposalInput: badArtifactPath, checkpointRef: "checkpoint/reject" },
        ),
      /proposal-input must be a test-capabilities\.heal\.proposal schema v1 artifact/,
    );
    assert.match(readFileSync(file, "utf8"), /#old-login/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal rejects relative proposal-input targets", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-proposal-relative-"));
  const file = path.join(dir, "sample.test.ts");
  const artifactPath = path.join(dir, "relative-proposals.json");
  const original = "test('relative', async () => { await page.locator('#old-login').click(); });\n";
  writeFileSync(file, original, "utf8");
  writeFileSync(
    artifactPath,
    JSON.stringify({
      schema_version: 1,
      artifact_kind: "test-capabilities.heal.proposal",
      operation_id: "heal",
      proposals: [
        {
          file: "sample.test.ts",
          line: 1,
          oldSelector: "#old-login",
          newSelector: "#login",
          confidence: 0.95,
          strategy: "manual",
          requiresReview: false,
        },
      ],
    }),
    "utf8",
  );

  try {
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, proposalInput: artifactPath, checkpointRef: "checkpoint/relative" },
        ),
      /proposal-input target file must be absolute/,
    );
    assert.equal(readFileSync(file, "utf8"), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal rejects proposal-input targets outside the heal directory", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-proposal-boundary-"));
  const outsideDir = mkdtempSync(
    path.join(os.tmpdir(), "test-capabilities-heal-proposal-outside-"),
  );
  const artifactPath = path.join(dir, "escape-proposals.json");
  const outsideFile = path.join(outsideDir, "outside.test.ts");
  const original = "test('escape', async () => { await page.locator('#old-login').click(); });\n";
  writeFileSync(outsideFile, original, "utf8");
  writeFileSync(
    artifactPath,
    JSON.stringify({
      schema_version: 1,
      artifact_kind: "test-capabilities.heal.proposal",
      operation_id: "heal",
      proposals: [
        {
          file: outsideFile,
          line: 1,
          oldSelector: "#old-login",
          newSelector: "#login",
          confidence: 0.95,
          strategy: "manual",
          requiresReview: false,
        },
      ],
    }),
    "utf8",
  );

  try {
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, proposalInput: artifactPath, checkpointRef: "checkpoint/escape" },
        ),
      /proposal-input target resolved outside heal directory/,
    );
    assert.equal(readFileSync(outsideFile, "utf8"), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal rejects symlink targets inside proposal artifacts", async () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), "test-capabilities-heal-proposal-symlink-target-"),
  );
  const realFile = path.join(dir, "real.test.ts");
  const linkedFile = path.join(dir, "linked.test.ts");
  const artifactPath = path.join(dir, "symlink-target-proposals.json");
  const original = "test('symlink', async () => { await page.locator('#old-login').click(); });\n";
  writeFileSync(realFile, original, "utf8");
  symlinkSync(realFile, linkedFile);
  writeFileSync(
    artifactPath,
    JSON.stringify({
      schema_version: 1,
      artifact_kind: "test-capabilities.heal.proposal",
      operation_id: "heal",
      proposals: [
        {
          file: linkedFile,
          line: 1,
          oldSelector: "#old-login",
          newSelector: "#login",
          confidence: 0.95,
          strategy: "manual",
          requiresReview: false,
        },
      ],
    }),
    "utf8",
  );

  try {
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, proposalInput: artifactPath, checkpointRef: "checkpoint/symlink-target" },
        ),
      /proposal-input target file must not be a symlink/,
    );
    assert.equal(readFileSync(realFile, "utf8"), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal refuses symlink proposal inputs", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-proposal-input-symlink-"));
  const file = path.join(dir, "sample.test.ts");
  const artifactPath = path.join(dir, "heal-proposals.json");
  const linkedArtifactPath = path.join(dir, "linked-heal-proposals.json");
  writeFileSync(
    file,
    "test('login', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );

  try {
    await executeCliOperation(
      { command: "heal" },
      { dir, dryRun: true, proposalOutput: artifactPath },
    );
    symlinkSync(artifactPath, linkedArtifactPath);

    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, proposalInput: linkedArtifactPath, checkpointRef: "checkpoint/symlink" },
        ),
      /proposal-input must not be a symlink:/,
    );
    assert.match(readFileSync(file, "utf8"), /#old-login/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal refuses proposal artifacts containing review-required proposals", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-proposal-review-"));
  const file = path.join(dir, "sample.test.ts");
  const artifactPath = path.join(dir, "review-proposals.json");
  writeFileSync(
    file,
    "test('login', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );
  writeFileSync(
    artifactPath,
    JSON.stringify({
      schema_version: 1,
      artifact_kind: "test-capabilities.heal.proposal",
      operation_id: "heal",
      proposals: [
        {
          file,
          line: 1,
          oldSelector: "#old-login",
          newSelector: "#login",
          confidence: 0.5,
          strategy: "manual-review",
          requiresReview: true,
        },
      ],
    }),
    "utf8",
  );

  try {
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, proposalInput: artifactPath, checkpointRef: "checkpoint/review" },
        ),
      /proposal\(s\) that require review/,
    );
    assert.match(readFileSync(file, "utf8"), /#old-login/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal does not delete a preexisting artifact temp-name collision", async () => {
  const dir = mkdtempSync(
    path.join(os.tmpdir(), "test-capabilities-heal-artifact-temp-collision-"),
  );
  const file = path.join(dir, "sample.test.ts");
  const artifactPath = path.join(dir, "heal-proposals.json");
  const originalNow = Date.now;
  const fixedNow = 123456789;
  const tempPath = path.join(dir, `.heal-proposals.json.${process.pid}.${fixedNow}.tmp`);
  writeFileSync(
    file,
    "test('login', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );
  writeFileSync(tempPath, "do-not-delete\n", "utf8");

  try {
    Date.now = () => fixedNow;
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, dryRun: true, proposalOutput: artifactPath },
        ),
      /EEXIST|file already exists/i,
    );
    assert.equal(readFileSync(tempPath, "utf8"), "do-not-delete\n");
  } finally {
    Date.now = originalNow;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal refuses symlink artifact outputs", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-artifact-symlink-"));
  const artifactDir = mkdtempSync(
    path.join(os.tmpdir(), "test-capabilities-heal-artifact-output-"),
  );
  const file = path.join(dir, "sample.test.ts");
  const realArtifact = path.join(artifactDir, "real-proposals.json");
  const symlinkArtifact = path.join(artifactDir, "linked-proposals.json");
  writeFileSync(
    file,
    "test('login', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );
  writeFileSync(realArtifact, "{}\n", "utf8");

  try {
    symlinkSync(realArtifact, symlinkArtifact);
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          {
            dir,
            dryRun: true,
            proposalOutput: symlinkArtifact,
          },
        ),
      /Healing artifact output must not be a symlink:/,
    );
    assert.equal(readFileSync(realArtifact, "utf8"), "{}\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(artifactDir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal refuses findings input symlinks", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-findings-symlink-"));
  const file = path.join(dir, "sample.test.ts");
  const realFindings = path.join(dir, "findings.json");
  const linkedFindings = path.join(dir, "linked-findings.json");
  writeFileSync(
    file,
    "test('login', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );
  writeFileSync(
    realFindings,
    JSON.stringify([
      {
        id: "finding-1",
        component: "web",
        description: "old login selector",
        evidence: ["#old-login"],
      },
    ]),
    "utf8",
  );

  try {
    symlinkSync(realFindings, linkedFindings);
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, dryRun: true, findingsInput: linkedFindings },
        ),
      /findings-input must not be a symlink:/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("executeCliOperation heal refuses symlink artifact output directories", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-artifact-dir-"));
  const artifactParentDir = mkdtempSync(
    path.join(os.tmpdir(), "test-capabilities-heal-artifact-parent-"),
  );
  const outsideDir = mkdtempSync(
    path.join(os.tmpdir(), "test-capabilities-heal-artifact-outside-"),
  );
  const file = path.join(dir, "sample.test.ts");
  const linkedArtifactDir = path.join(artifactParentDir, "linked-artifacts");
  writeFileSync(
    file,
    "test('login', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );

  try {
    symlinkSync(outsideDir, linkedArtifactDir, "dir");
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          {
            dir,
            dryRun: true,
            proposalOutput: path.join(linkedArtifactDir, "nested", "proposals.json"),
          },
        ),
      /Healing artifact output directory component must not be a symlink:/,
    );
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          {
            dir,
            dryRun: true,
            verificationOutput: path.join(linkedArtifactDir, "nested", "verification.json"),
          },
        ),
      /Healing artifact output directory component must not be a symlink:/,
    );
    assert.equal(existsSync(path.join(outsideDir, "nested")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(artifactParentDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
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

test("executeCliOperation heal derives appliedCount from proven writes and reports zero when the write fails", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-applied-count-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('one', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );

  try {
    if (process.getuid?.() === 0) {
      return; // root ignores directory modes; the write cannot be made to fail this way
    }
    chmodSync(dir, 0o500);
    await assert.rejects(
      async () =>
        executeCliOperation(
          { command: "heal" },
          { dir, dryRun: false, checkpointRef: "checkpoint/heal-applied-count-001" },
        ),
      /Healing apply wrote 0 of 1 file\(s\) before failing/,
    );
    chmodSync(dir, 0o700);
    assert.match(readFileSync(file, "utf8"), /#old-login/);

    const applied = await executeCliOperation(
      { command: "heal" },
      { dir, dryRun: false, checkpointRef: "checkpoint/heal-applied-count-002" },
    );
    assert.equal(applied.appliedCount, 1);
    assert.match(readFileSync(file, "utf8"), /#login/);
  } finally {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Effect declarations (slice S5): every operation says what it may do, and the
// kernel resolves that before `execute` ever sees the input.
// ---------------------------------------------------------------------------

const { createRunContext, mintOperationContext } = await importRuntimeModule("core/run-context.js");

/** A parsed input good enough to resolve each operation's class. */
const EFFECT_INPUT_SAMPLES = {
  test: { config: "test-capabilities.yaml", quick: false },
  doctor: { json: false },
  demo: { json: false },
  init: { print: true, output: "test-capabilities.yaml" },
  "surf.explore": { url: "https://example.com" },
  quantum: { target: "https://example.com" },
  heal: { dir: "./tests", dryRun: true },
  "replacement-validation": { action: "plan", request: "request.json" },
};

test("every registered operation resolves an effect class with a reason", () => {
  const seen = [];
  for (const [operationId, operation] of Object.entries(CLI_OPERATION_REGISTRY)) {
    const sample = EFFECT_INPUT_SAMPLES[operationId];
    assert.notEqual(sample, undefined, `add an input sample for ${operationId}`);
    const declaration =
      typeof operation.effect === "function" ? operation.effect(sample) : operation.effect;
    assert.equal(
      ["read_only", "mutating"].includes(declaration.effect),
      true,
      `${operationId} resolved '${declaration.effect}'`,
    );
    assert.equal(typeof declaration.reason, "string");
    assert.equal(declaration.reason.length > 0, true, `${operationId} has no reason`);
    if (declaration.effect === "mutating") {
      assert.equal(
        ["target", "workspace", "browser_session"].includes(declaration.scope),
        true,
        `${operationId} is mutating without a scope`,
      );
    }
    seen.push(operationId);
  }
  assert.equal(seen.length, 8);
});

test("the mode-dependent operations change class with their mode", () => {
  const heal = CLI_OPERATION_REGISTRY.heal.effect;
  assert.equal(heal({ dir: "./tests", dryRun: true }).effect, "read_only");
  assert.deepEqual(heal({ dir: "./tests", dryRun: false }), {
    effect: "mutating",
    scope: "workspace",
    reason: "rewrites selectors in the test files under --dir",
  });

  const init = CLI_OPERATION_REGISTRY.init.effect;
  assert.equal(init({ print: true }).effect, "read_only");
  assert.equal(init({ print: false }).scope, "workspace");

  const replacement = CLI_OPERATION_REGISTRY["replacement-validation"].effect;
  assert.equal(replacement({ action: "plan", request: "r.json" }).effect, "read_only");
  assert.equal(
    replacement({ action: "plan", request: "r.json", out: "p.json" }).scope,
    "workspace",
  );
});

test("an operation that declares no class is refused before its input is executed", () => {
  assert.throws(
    () => mintOperationContext("made-up", undefined, {}),
    (error) => {
      assert.equal(error.code, "effect_unclassified");
      assert.match(error.message, /operation 'made-up'/);
      assert.match(error.message, /no default class/);
      return true;
    },
  );
  assert.throws(() => mintOperationContext("made-up", { effect: "mutating", reason: "x" }, {}), {
    code: "effect_declaration_invalid",
  });
});

test("a nested operation runs inside its parent's run, not a new one", async () => {
  const fake = createFakeSurf({ pages: readyPages({ "https://example.com/": {} }) });
  const context = createRunContext({
    operationId: "test",
    effect: { effect: "read_only", reason: "kernel contract test" },
  });

  const envelope = await withFakeSurfEnv(fake.path, () =>
    executeSurfExploreOperation({ url: "https://example.com/" }, context),
  );

  assert.equal(envelope.runId, context.runId, "the nested envelope carries the parent's run id");
  assert.equal(envelope.effect.effect, "read_only");
  assert.equal(envelope.effect.scope, "browser_session");
  assert.deepEqual(envelope.mutations, []);

  // and the surf agent is the caller that threads it (the alternative - re-entering the
  // operation without a context - would mint a second run inside the first; review A5)
  const agentsSource = readFileSync(
    new URL("../src/core/operations/test/agents.ts", import.meta.url),
    "utf8",
  );
  assert.match(agentsSource, /executeSurfExploreOperation\(\{ url: targets\.web \}, context\)/);
});

test("the library entry points mint their own run when the kernel did not", async () => {
  const {
    executeDemoOperation,
    executeDoctorOperation,
    executeInitOperation,
    executeReplacementValidationOperation,
  } = await importRuntimeModule("core/operations.js");

  const demo = await executeDemoOperation({ json: true });
  assert.equal(demo.effect.effect, "read_only");
  assert.match(demo.effect.reason, /packaged cli-tester fixture/);
  assert.deepEqual(demo.mutations, []);
  assert.match(demo.runId, /^[0-9a-f-]{36}$/);

  const doctor = await executeDoctorOperation({ json: true });
  assert.equal(doctor.effect.effect, "read_only");
  assert.deepEqual(doctor.mutations, []);

  // `init --print` writes nothing, so it stays read-only; the same operation writing a file is
  // mutating/workspace (the class is a property of the mode, not of the command name)
  const printed = await executeInitOperation({ print: true });
  assert.equal(printed.effect.effect, "read_only");
  assert.equal(printed.written, false);

  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-kernel-entry-"));
  const requestPath = path.join(dir, "request.json");
  writeFileSync(
    requestPath,
    JSON.stringify({
      schema_version: 1,
      artifact_kind: "dep-surgeon.replacement.request",
      request_id: "req-1",
      repo: "test-capabilities",
      dependency: { name: "left-pad", current_version: "1.0.0" },
      replacement: { name: "right-pad", version: "2.0.0" },
      commands: [{ id: "unit", kind: "unit", command: "npm test" }],
    }),
  );
  const plan = await executeReplacementValidationOperation({
    action: "plan",
    request: requestPath,
  });
  assert.equal(plan.effect.effect, "read_only");
  assert.deepEqual(plan.mutations, []);
  rmSync(dir, { recursive: true, force: true });
});
