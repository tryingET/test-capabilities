import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { BombadilAgent, CliTesterAgent, SurfAgent, TerminalFuzzerAgent } = await importRuntimeModule(
  "core/operations/test/agents.js",
);

function tempDir(label) {
  return mkdtempSync(path.join(os.tmpdir(), `test-capabilities-agents-${label}-`));
}

function writeExecutable(filePath, script) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, script, "utf8");
  chmodSync(filePath, 0o755);
}

/** Runs `body` with the Bombadil resolution env pinned to `binaryPath`. */
async function withBombadilBinary(binaryPath, body) {
  const previous = {
    bin: process.env.TEST_CAPABILITIES_BOMBADIL_BIN,
    repo: process.env.TEST_CAPABILITIES_BOMBADIL_REPO,
  };
  process.env.TEST_CAPABILITIES_BOMBADIL_BIN = binaryPath;
  delete process.env.TEST_CAPABILITIES_BOMBADIL_REPO;
  try {
    return await body();
  } finally {
    if (previous.bin === undefined) {
      delete process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
    } else {
      process.env.TEST_CAPABILITIES_BOMBADIL_BIN = previous.bin;
    }
    if (previous.repo !== undefined) {
      process.env.TEST_CAPABILITIES_BOMBADIL_REPO = previous.repo;
    }
  }
}

test("every agent refuses a missing target with a critical finding and zero coverage", async () => {
  const cases = [
    { agent: new BombadilAgent("bombadil", 50, undefined), id: "bombadil-missing-web-target" },
    { agent: new SurfAgent("surf"), id: "surf-missing-web-target" },
    { agent: new CliTesterAgent("cli-tester", 50), id: "cli-tester-missing-cli-target" },
    {
      agent: new TerminalFuzzerAgent("terminal-fuzzer", 50, undefined),
      id: "terminal-fuzzer-missing-cli-target",
    },
  ];

  for (const { agent, id } of cases) {
    const result = await agent.execute({});
    assert.equal(result.findings.length, 1, id);
    assert.equal(result.findings[0].id, id);
    assert.equal(result.findings[0].severity, "critical");
    assert.equal(result.findings[0].type, "bug");
    assert.equal(result.findings[0].evidence.length > 0, true);
    assert.equal(Object.values(result.coverage)[0], 0);
  }
});

test("cli-tester reports a successful --help run as edge-case coverage", async () => {
  const dir = tempDir("cli-ok");
  const target = path.join(dir, "ok-cli.sh");
  writeExecutable(target, "#!/bin/sh\necho 'usage: ok-cli [options]'\nexit 0\n");

  try {
    const result = await new CliTesterAgent("cli-tester", 5_000).execute({ cli: target });
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.coverage, { edgeCases: 100 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli-tester fails closed on a non-zero --help exit and renders the stderr channel", async () => {
  const dir = tempDir("cli-fail");
  const target = path.join(dir, "broken-cli.sh");
  writeExecutable(target, "#!/bin/sh\necho 'boom on stderr' >&2\nexit 3\n");

  try {
    const result = await new CliTesterAgent("cli-tester", 5_000).execute({ cli: target });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, "cli-tester-help-failed");
    assert.equal(result.findings[0].description.includes("--help"), true);
    assert.equal(result.findings[0].evidence[0], "boom on stderr");
    assert.deepEqual(result.coverage, { edgeCases: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli-tester kills a hanging --help run at the timeout and names the budget", async () => {
  const dir = tempDir("cli-timeout");
  const target = path.join(dir, "hang-cli.sh");
  writeExecutable(target, "#!/bin/sh\nsleep 30\n");

  try {
    const result = await new CliTesterAgent("cli-tester", 120).execute({ cli: target });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, "cli-tester-help-failed");
    assert.match(result.findings[0].evidence[0], /^timed out after 120ms/);
    assert.deepEqual(result.coverage, { edgeCases: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cli-tester reports a command that cannot be spawned as a spawn failure, not a target fault", async () => {
  const result = await new CliTesterAgent("cli-tester", 5_000).execute({
    cli: "definitely-missing-test-capabilities-binary",
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].id, "cli-tester-spawn-failed");
  assert.equal(
    result.findings[0].description.includes("definitely-missing-test-capabilities-binary --help"),
    true,
  );
  assert.equal(result.findings[0].evidence.length, 1);
  assert.deepEqual(result.coverage, { edgeCases: 0 });
});

test("cli-tester refuses an unparseable target command line", async () => {
  const result = await new CliTesterAgent("cli-tester", 5_000).execute({ cli: `node "--version` });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].id, "cli-tester-spawn-failed");
  assert.match(result.findings[0].evidence[0], /Unterminated quote/);
});

test("bombadil forwards its 0.5 options and reports a completed bounded run", async () => {
  const dir = tempDir("bombadil-ok");
  const binary = path.join(dir, "bombadil");
  const argvLog = path.join(dir, "argv.log");
  const trace = path.join(dir, "trace.jsonl");
  writeExecutable(
    binary,
    `#!/bin/sh\necho "$@" > ${JSON.stringify(argvLog)}\necho '{}' > ${JSON.stringify(trace)}\necho "using default specification" >&2\necho "storing trace in ${trace}" >&2\nexit 0\n`,
  );

  try {
    const result = await withBombadilBinary(binary, () =>
      new BombadilAgent("bombadil", 2_000, {
        command: "test",
        outputPath: trace,
        headers: { Authorization: "Bearer t" },
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        instrumentJavaScript: ["files"],
        chromeGrantPermissions: ["local-network-access"],
        headless: true,
        noSandbox: true,
      }).execute({ web: "https://example.com" }),
    );

    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.coverage, { edgeCases: 100 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bombadil renders a property violation with the trace and specification evidence", async () => {
  const dir = tempDir("bombadil-violation");
  const binary = path.join(dir, "bombadil");
  const trace = path.join(dir, "trace.jsonl");
  writeExecutable(
    binary,
    `#!/bin/sh\necho '{}' > ${JSON.stringify(trace)}\necho "using default specification" >&2\necho "storing trace in ${trace}" >&2\necho "property violation found" >&2\nexit 3\n`,
  );

  try {
    const result = await withBombadilBinary(binary, () =>
      new BombadilAgent("bombadil", 2_000, undefined).execute({ web: "https://example.com" }),
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, "bombadil-property-violation");
    assert.equal(result.findings[0].severity, "high");
    assert.equal(
      result.findings[0].evidence.some((line) => line === `trace: ${trace}`),
      true,
    );
    assert.equal(
      result.findings[0].evidence.some((line) => line === "specification: default"),
      true,
    );
    assert.deepEqual(result.coverage, { edgeCases: 100 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bombadil refuses a stale trace file as evidence for this run", async () => {
  const dir = tempDir("bombadil-stale");
  const binary = path.join(dir, "bombadil");
  const trace = path.join(dir, "old-trace.jsonl");
  writeFileSync(trace, "{}\n", "utf8");
  // A trace an earlier run left behind, older than this run's start.
  const stale = new Date(Date.now() - 60_000);
  utimesSync(trace, stale, stale);
  writeExecutable(
    binary,
    `#!/bin/sh\necho "storing trace in ${trace}" >&2\necho "boom" >&2\nexit 3\n`,
  );

  try {
    const result = await withBombadilBinary(binary, () =>
      new BombadilAgent("bombadil", 2_000, undefined).execute({ web: "https://example.com" }),
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, "bombadil-runtime-failed");
    assert.deepEqual(result.coverage, { edgeCases: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bombadil reports a runtime failure when the binary produces no evidence", async () => {
  const dir = tempDir("bombadil-noop");
  const binary = path.join(dir, "bombadil");
  writeExecutable(binary, "#!/bin/sh\nexit 0\n");

  try {
    const result = await withBombadilBinary(binary, () =>
      new BombadilAgent("bombadil", 2_000, undefined).execute({ web: "https://example.com" }),
    );

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, "bombadil-runtime-failed");
    assert.equal(result.findings[0].severity, "critical");
    assert.deepEqual(result.coverage, { edgeCases: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bombadil records an exhausted budget as evidence instead of a violation", async () => {
  const dir = tempDir("bombadil-budget");
  const binary = path.join(dir, "bombadil");
  writeExecutable(binary, "#!/bin/sh\necho 'starting test' >&2\nsleep 30\n");

  try {
    const result = await withBombadilBinary(binary, () =>
      new BombadilAgent("bombadil", 150, undefined).execute({ web: "https://example.com" }),
    );

    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.coverage, { edgeCases: 100 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminal-fuzzer runs its own command and reports the subject it exercised", async () => {
  const dir = tempDir("terminal-ok");
  const binary = path.join(dir, "bombadil");
  writeExecutable(binary, "#!/bin/sh\necho 'terminal test started' >&2\nexit 0\n");

  try {
    const result = await withBombadilBinary(binary, () =>
      new TerminalFuzzerAgent("terminal-fuzzer", 2_000, {
        command: "node",
        args: ["--version"],
      }).execute({}),
    );

    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.coverage, { edgeCases: 100 });
    assert.equal(result.observationSubject, "node");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminal-fuzzer reports a non-zero terminal exit as a runtime failure it cannot attribute", async () => {
  const dir = tempDir("terminal-nonzero");
  const binary = path.join(dir, "bombadil");
  writeExecutable(binary, "#!/bin/sh\necho 'terminal property check failed' >&2\nexit 4\n");

  try {
    const result = await withBombadilBinary(binary, () =>
      new TerminalFuzzerAgent("terminal-fuzzer", 2_000, undefined).execute({ cli: "node" }),
    );

    // The terminal runner writes no trace and passes no --exit-on-violation, so nothing
    // distinguishes a property violation from a crash; the finding never claims one.
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, "terminal-fuzzer-runtime-failed");
    assert.equal(result.findings[0].severity, "critical");
    assert.match(result.findings[0].recommendation, /not attributed to a property violation/);
    assert.equal(result.observationSubject, "node");
    assert.deepEqual(result.coverage, { edgeCases: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("surf agent turns a runtime failure into one finding that names the resolution path", async () => {
  const home = tempDir("surf-home");
  const previous = {
    home: process.env.HOME,
    bin: process.env.TEST_CAPABILITIES_SURF_BIN,
    path: process.env.PATH,
  };
  process.env.HOME = home;
  process.env.TEST_CAPABILITIES_SURF_BIN = "";
  process.env.PATH = path.dirname(process.execPath);

  try {
    const result = await new SurfAgent("surf").execute({ web: "https://example.com" });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, "surf-runtime-failed");
    assert.equal(result.findings[0].severity, "critical");
    assert.match(result.findings[0].recommendation, /TEST_CAPABILITIES_SURF_BIN/);
    assert.deepEqual(result.coverage, { userFlows: 0 });
  } finally {
    if (previous.home === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previous.home;
    }
    if (previous.bin === undefined) {
      delete process.env.TEST_CAPABILITIES_SURF_BIN;
    } else {
      process.env.TEST_CAPABILITIES_SURF_BIN = previous.bin;
    }
    process.env.PATH = previous.path;
    rmSync(home, { recursive: true, force: true });
  }
});
