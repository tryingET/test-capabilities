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

function withFakeSurfGo(script) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-surf-go-"));
  const surfGoPath = path.join(dir, "surf-go");
  writeFileSync(surfGoPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });

  return {
    path: surfGoPath,
    dir,
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
          api: {
            enabled: true,
            type: "api-fuzzer",
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

test("surf agent requires targets.web", () => {
  assert.throws(
    () =>
      new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Missing Surf Target",
        targets: { cli: process.execPath },
        agents: {
          web: {
            enabled: true,
            type: "surf",
            intensity: "normal",
          },
        },
      }),
    /The enabled 'surf' agent requires targets\.web/,
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
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].kind, "smoke");
  assert.equal(result.observations[0].status, "errored");
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
      assert.equal(result.observations.length, 1);
      assert.equal(result.observations[0].protocol, "observation.v1");
      assert.equal(result.observations[0].kind, "property");
      assert.equal(result.observations[0].status, "passed");
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

test(
  "surf agent reports successful exploration as measured user-flow coverage",
  { concurrency: false },
  async () => {
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
        const result = await new TestCapabilitiesOrchestrator({
          version: "2.0",
          name: "Surf Success",
          targets: { web: "https://example.com" },
          agents: {
            web: {
              enabled: true,
              type: "surf",
              intensity: "normal",
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
        assert.equal(result.coverage.userFlows, 100);
        assert.equal(result.coverage.overall, 100);
        assert.deepEqual(result.coverage.measuredDimensions, ["userFlows"]);
        assert.equal(result.observations.length, 1);
        assert.equal(result.observations[0].kind, "coverage");
        assert.equal(result.observations[0].status, "passed");
        assert.match(result.observations[0].evidence.join("\n"), /userFlows: 100%/);
      });
    } finally {
      fake.cleanup();
    }
  },
);

test(
  "surf agent rejects empty successful processes as fake coverage",
  { concurrency: false },
  async () => {
    await withSurfGoEnv("/bin/true", async () => {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Surf Empty Success",
        targets: { web: "https://example.com" },
        agents: {
          web: {
            enabled: true,
            type: "surf",
            intensity: "normal",
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
      assert.equal(result.observations[0].kind, "coverage");
      assert.equal(result.observations[0].status, "errored");
      assert.equal(
        result.observations.some(
          (observation) => observation.kind === "coverage" && observation.status === "passed",
        ),
        false,
      );
      assert.equal(
        result.findings.some((finding) =>
          finding.evidence.some((entry) => /produced no runtime evidence/.test(entry)),
        ),
        true,
      );
    });
  },
);

test("surf agent rejects non-browser stdout as fake coverage", { concurrency: false }, async () => {
  const fake = withFakeSurfGo('echo surf-go fake "$@"');

  try {
    await withSurfGoEnv(fake.path, async () => {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Surf Non Evidence",
        targets: { web: "https://example.com" },
        agents: {
          web: {
            enabled: true,
            type: "surf",
            intensity: "normal",
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
          finding.evidence.some((entry) => /produced no verified browser evidence/.test(entry)),
        ),
        true,
      );
    });
  } finally {
    fake.cleanup();
  }
});

test(
  "surf agent surfaces runtime failures as critical findings",
  { concurrency: false },
  async () => {
    const fake = withFakeSurfGo("echo surf-go exploded >&2\nexit 9");

    try {
      await withSurfGoEnv(fake.path, async () => {
        const result = await new TestCapabilitiesOrchestrator({
          version: "2.0",
          name: "Surf Failure",
          targets: { web: "https://example.com" },
          agents: {
            web: {
              enabled: true,
              type: "surf",
              intensity: "normal",
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
            /Surf runtime could not complete/.test(finding.description),
          ),
          true,
        );
        assert.equal(
          result.findings.some((finding) =>
            finding.evidence.some((entry) => /surf-go exploded/.test(entry)),
          ),
          true,
        );
      });
    } finally {
      fake.cleanup();
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
  assert.equal(
    result.observations.some(
      (observation) =>
        observation.kind === "synthesis" &&
        observation.subject === "cli" &&
        observation.status === "errored" &&
        observation.findingIds.includes("corr-cli") &&
        /Semantic synthesis: cli has 2\/2 non-passing observation/.test(observation.summary) &&
        /degradation or finding signal/.test(observation.semantics?.interpretation ?? ""),
    ),
    true,
  );
  assert.equal(
    result.observations.some(
      (observation) =>
        observation.kind === "correlation" &&
        observation.status === "errored" &&
        /2\/2 supported sensor observation/.test(observation.summary),
    ),
    true,
  );
});

test("orchestrator respects disabled correlation for findings and observations", async () => {
  const result = await new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Correlation Disabled",
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
    intelligence: {
      selfHealing: false,
      prediction: false,
      correlation: false,
      collective: false,
    },
  }).run();

  assert.equal(
    result.findings.some((finding) => finding.id.startsWith("corr-")),
    false,
  );
  assert.equal(
    result.observations.some(
      (observation) => observation.kind === "synthesis" || observation.kind === "correlation",
    ),
    false,
  );
  assert.equal(result.observations.length, 2);
});

test("observation protocol keeps ids unique across multiple synthesized components", async () => {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const observation = (agent, kind, subject, component) => ({
    protocol: "observation.v1",
    id: `${agent}-${kind}-passed`,
    agent,
    kind,
    status: "passed",
    subject,
    summary: `${agent} ${kind} passed`,
    evidence: [],
    semantics: { component, interpretation: "passed" },
    findingIds: [],
    timestamp: observedAt,
  });
  const orchestrator = new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Observation Ids",
    targets: { cli: process.execPath },
    agents: {
      cli: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
    },
  });
  orchestrator.agents = new Map([
    [
      "cliA",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [observation("cliA", "smoke", "cli", "cli")],
        }),
      },
    ],
    [
      "cliB",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [observation("cliB", "runtime", "cli", "cli")],
        }),
      },
    ],
    [
      "webA",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [observation("webA", "coverage", "web", "web")],
        }),
      },
    ],
    [
      "webB",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [observation("webB", "property", "web", "web")],
        }),
      },
    ],
  ]);

  const result = await orchestrator.run();
  const ids = result.observations.map((entry) => entry.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.includes("orchestrator-synthesis-cli-passed"), true);
  assert.equal(ids.includes("orchestrator-synthesis-web-passed"), true);
});

test("observation synthesis cannot pass while linking same-component critical findings", async () => {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const observation = (agent) => ({
    protocol: "observation.v1",
    id: `${agent}-runtime-passed`,
    agent,
    kind: "runtime",
    status: "passed",
    subject: "web",
    summary: `${agent} passed`,
    evidence: [],
    semantics: { component: "web", interpretation: "passed" },
    findingIds: [],
    timestamp: observedAt,
  });
  const criticalFinding = {
    id: "web-critical",
    type: "bug",
    severity: "critical",
    component: "web",
    description: "web is broken",
    evidence: ["boom"],
    recommendation: "fix web",
    timestamp: observedAt,
  };
  const orchestrator = new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Observation Finding Integrity",
    targets: { cli: process.execPath },
    agents: {
      cli: {
        enabled: true,
        type: "cli-tester",
        intensity: "normal",
      },
    },
  });
  orchestrator.agents = new Map([
    [
      "webA",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [observation("webA")],
        }),
      },
    ],
    [
      "webB",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [observation("webB")],
        }),
      },
    ],
    [
      "webFinding",
      {
        execute: async () => ({
          findings: [criticalFinding],
          coverage: {},
        }),
      },
    ],
  ]);

  const result = await orchestrator.run();
  const synthesis = result.observations.find((entry) => entry.kind === "synthesis");
  const suiteCorrelation = result.observations.find((entry) => entry.kind === "correlation");

  assert.equal(result.passed, false);
  assert.equal(synthesis?.status, "errored");
  assert.equal(synthesis?.findingIds.includes("web-critical"), true);
  assert.match(synthesis?.summary ?? "", /1 finding/);
  assert.match(synthesis?.evidence.join("\n") ?? "", /finding:critical:web-critical/);
  assert.equal(suiteCorrelation?.status, "errored");
  assert.equal(suiteCorrelation?.findingIds.includes("web-critical"), true);
});

test("observation id de-duplication avoids collisions with generated suffixes", async () => {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const observation = (id) => ({
    protocol: "observation.v1",
    id,
    agent: id,
    kind: "runtime",
    status: "passed",
    subject: "custom",
    summary: `${id} passed`,
    evidence: [],
    findingIds: [],
    timestamp: observedAt,
  });
  const orchestrator = new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Observation Suffix Collision",
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
      correlation: false,
      collective: false,
    },
  });
  orchestrator.agents = new Map([
    [
      "a",
      { execute: async () => ({ findings: [], coverage: {}, observations: [observation("a")] }) },
    ],
    [
      "a2",
      { execute: async () => ({ findings: [], coverage: {}, observations: [observation("a-2")] }) },
    ],
    [
      "aAgain",
      { execute: async () => ({ findings: [], coverage: {}, observations: [observation("a")] }) },
    ],
  ]);

  const result = await orchestrator.run();
  const ids = result.observations.map((entry) => entry.id);

  assert.deepEqual(ids, ["a", "a-2", "a-3"]);
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
