import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { createFakeSurf, readyPages, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { TestCapabilitiesOrchestrator } = await importRuntimeModule("index.js");

// Mutating agents write a receipt before they act (slice S5). Keep this suite's receipts out of
// the checkout and out of one another's way, and accept the store as ephemeral the way an
// operator would for a throwaway directory (operator decision D5).
process.env.TEST_CAPABILITIES_RECEIPTS_DIR = mkdtempSync(
  path.join(os.tmpdir(), "test-capabilities-orchestrator-receipts-"),
);
process.env.TEST_CAPABILITIES_RECEIPTS_EPHEMERAL = "1";

/** The operator's declaration that this suite's fuzzers may act on the fixture origin. */
const ALLOW_EXAMPLE = { mutation: { allowOrigins: ["https://example.com"] } };

// The fake writes the trace file it announces, exactly as Bombadil does: the trace is the typed
// evidence the runtime reads for the run status (adjudication claim 46), so a fake that only
// prints the line would not speak the tool's contract.
function withFakeBombadil(script) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-bombadil-"));
  const bombadilPath = path.join(dir, "bombadil");
  const tracePath = path.join(dir, "trace.jsonl");
  writeFileSync(bombadilPath, `#!/bin/sh\nTRACE_PATH=${tracePath}\n${script}\n`, { mode: 0o755 });

  return {
    path: bombadilPath,
    tracePath,
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
  assert.equal(result.observations.length, 3);
  assert.equal(result.observations[0].kind, "smoke");
  assert.equal(result.observations[0].status, "errored");
  assert.equal(
    result.observations.some(
      (observation) => observation.kind === "synthesis" && observation.status === "errored",
    ),
    true,
  );
  assert.equal(
    result.observations.some(
      (observation) => observation.kind === "correlation" && observation.status === "errored",
    ),
    true,
  );
  assert.equal(
    result.observations.some((observation) => observation.kind === "root_cause"),
    false,
  );
  assert.equal(
    result.findings.some((finding) => finding.severity === "critical"),
    true,
  );
});

test(
  "terminal-fuzzer agent emits bounded observation.v1 terminal evidence",
  { concurrency: false },
  async () => {
    const fake = withFakeBombadil(`
      echo 'terminal test started' >&2
      echo "args: $*" >&2
      exit 0
    `);
    const previousBinary = process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
    process.env.TEST_CAPABILITIES_BOMBADIL_BIN = fake.path;

    try {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Terminal Fuzzer",
        targets: { cli: process.execPath },
        agents: {
          terminal: {
            enabled: true,
            type: "terminal-fuzzer",
            duration: "50ms",
            terminal: {
              args: ["--version"],
            },
          },
        },
        intelligence: {
          selfHealing: false,
          prediction: false,
          correlation: false,
          collective: false,
        },
      }).run();

      assert.equal(result.passed, true);
      assert.equal(result.findings.length, 0);
      assert.equal(result.coverage.overall, 100);
      assert.equal(result.observations.length, 1);
      assert.equal(result.observations[0].protocol, "observation.v1");
      assert.equal(result.observations[0].kind, "runtime");
      assert.equal(result.observations[0].semantics.component, "cli");
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
  "terminal-fuzzer observation subject uses terminal command override instead of targets.cli",
  { concurrency: false },
  async () => {
    const fake = withFakeBombadil(`
      echo 'terminal test started' >&2
      echo "args: $*" >&2
      exit 0
    `);
    const previousBinary = process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
    process.env.TEST_CAPABILITIES_BOMBADIL_BIN = fake.path;

    try {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Terminal Fuzzer Override",
        targets: { cli: "placeholder-target-that-was-not-executed" },
        agents: {
          terminal: {
            enabled: true,
            type: "terminal-fuzzer",
            duration: "50ms",
            terminal: {
              command: process.execPath,
              args: ["--version"],
            },
          },
        },
        intelligence: {
          selfHealing: false,
          prediction: false,
          correlation: false,
          collective: false,
        },
      }).run();

      assert.equal(result.passed, true);
      assert.equal(result.observations.length, 1);
      assert.equal(result.observations[0].subject, process.execPath);
      assert.doesNotMatch(result.observations[0].subject, /--version/);
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
  "terminal-fuzzer observation subject uses terminal command when targets.cli is absent",
  { concurrency: false },
  async () => {
    const fake = withFakeBombadil(`
      echo 'terminal test started' >&2
      echo "args: $*" >&2
      exit 0
    `);
    const previousBinary = process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
    process.env.TEST_CAPABILITIES_BOMBADIL_BIN = fake.path;

    try {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Terminal Fuzzer Command Only",
        targets: {},
        agents: {
          terminal: {
            enabled: true,
            type: "terminal-fuzzer",
            duration: "50ms",
            terminal: {
              command: process.execPath,
            },
          },
        },
        intelligence: {
          selfHealing: false,
          prediction: false,
          correlation: false,
          collective: false,
        },
      }).run();

      assert.equal(result.passed, true);
      assert.equal(result.observations.length, 1);
      assert.equal(result.observations[0].subject, process.execPath);
      assert.notEqual(result.observations[0].subject, "targets.cli");
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

test("terminal-fuzzer agent fails closed when no CLI target or terminal command is configured", () => {
  assert.throws(
    () =>
      new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Terminal Fuzzer Missing Target",
        targets: {},
        agents: {
          terminal: {
            enabled: true,
            type: "terminal-fuzzer",
            duration: "50ms",
          },
        },
        intelligence: {
          selfHealing: false,
          prediction: false,
          correlation: false,
          collective: false,
        },
      }),
    /requires targets\.cli.*unless terminal\.command is configured/,
  );
});

test(
  "bombadil agent treats the duration budget as a bounded success when no violation is surfaced",
  { concurrency: false },
  async () => {
    const fake = withFakeBombadil(`
      echo 'using default specification' >&2
      echo '{}' > "$TRACE_PATH"
      echo "storing trace in $TRACE_PATH" >&2
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
        ...ALLOW_EXAMPLE,
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
      echo '{}' > "$TRACE_PATH"
      echo "storing trace in $TRACE_PATH" >&2
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
        ...ALLOW_EXAMPLE,
        agents: {
          webA: {
            enabled: true,
            type: "bombadil",
            intensity: "normal",
            duration: "50ms",
          },
          webB: {
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
          finding.evidence.some((entry) => entry === `trace: ${fake.tracePath}`),
        ),
        true,
      );
      const rootCause = result.observations.find(
        (observation) => observation.kind === "root_cause",
      );
      assert.equal(rootCause?.subject, "web");
      assert.equal(rootCause?.semantics?.calibration?.level, "high");
      assert.equal(rootCause?.semantics?.calibration?.signalCount, 2);
      assert.equal(rootCause?.semantics?.calibration?.sensorCount, 2);
      assert.equal(rootCause?.semantics?.calibration?.findingCount, 2);
      assert.match(rootCause?.summary ?? "", /property_violation as the current failure surface/);
      assert.match(rootCause?.evidence.join("\n") ?? "", /failureClass:property_violation/);
      assert.doesNotMatch(
        `${rootCause?.summary ?? ""}\n${rootCause?.semantics?.interpretation ?? ""}`,
        /predict|probability|horizon|future|will fail/i,
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
        ...ALLOW_EXAMPLE,
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
    const fake = createFakeSurf({
      pages: readyPages({ "https://example.com/": { title: "Example Domain" } }),
    });

    try {
      await withFakeSurfEnv(fake.path, async () => {
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
    const fake = createFakeSurf({
      pages: readyPages({ "https://example.com/": {} }),
      emptyOn: ["tab.new"],
    });
    await withFakeSurfEnv(fake.path, async () => {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Surf Empty Success",
        targets: { web: "https://example.com" },
        agents: {
          webA: {
            enabled: true,
            type: "surf",
            intensity: "normal",
          },
          webB: {
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
          finding.evidence.some((entry) => /did not report a tab id/.test(entry)),
        ),
        true,
      );
      const rootCause = result.observations.find(
        (observation) => observation.kind === "root_cause",
      );
      assert.equal(rootCause?.subject, "web");
      assert.equal(rootCause?.semantics?.calibration?.level, "high");
      assert.equal(rootCause?.semantics?.calibration?.signalCount, 2);
      assert.equal(rootCause?.semantics?.calibration?.sensorCount, 2);
      assert.equal(rootCause?.semantics?.calibration?.findingCount, 2);
      assert.match(rootCause?.summary ?? "", /browser_coverage_gap as the current failure surface/);
      assert.match(rootCause?.evidence.join("\n") ?? "", /failureClass:browser_coverage_gap/);
      assert.doesNotMatch(
        `${rootCause?.summary ?? ""}\n${rootCause?.semantics?.interpretation ?? ""}`,
        /predict|probability|horizon|future|will fail/i,
      );
    });
    fake.cleanup();
  },
);

test("surf agent rejects non-browser stdout as fake coverage", { concurrency: false }, async () => {
  const fake = createFakeSurf({
    pages: readyPages({ "https://example.com/": { jsResult: "surf fake output" } }),
  });

  try {
    await withFakeSurfEnv(fake.path, async () => {
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
    const fake = createFakeSurf({
      pages: readyPages({ "https://example.com/": {} }),
      failOn: ["tab.new"],
    });

    try {
      await withFakeSurfEnv(fake.path, async () => {
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
        assert.equal(result.determination.value, "failed");
        assert.equal(result.determination.basis, "fault");
        assert.equal(result.coverage.overall, 0);
        // The surf command ran and reported a failure: the finding names the classified code
        // and carries the outcome, so it is not the same shape as a runtime that never started
        // (adjudication claim 45).
        const failed = result.findings.find((finding) =>
          /Surf reported a failure while exploring/.test(finding.description),
        );
        assert.ok(failed, "expected a classified surf command failure finding");
        assert.match(failed.description, /\[exit_9\]/);
        assert.equal(failed.outcome.basis, "fault");
        assert.equal(failed.outcome.class, "error");
        assert.equal(failed.outcome.code, "exit_9");
        assert.equal(
          failed.evidence.some((entry) => /surf exploded/.test(entry)),
          true,
        );
        assert.equal(failed.evidence[0], "outcome:error:exit_9");
        assert.equal(failed.evidence[1], "basis:fault");
        assert.equal(
          result.observations.some((observation) => observation.kind === "root_cause"),
          false,
        );
      });
    } finally {
      fake.cleanup();
    }
  },
);

/** One surf agent run against a fake surf, returning the whole TestResult. */
async function runSurfAgent(name, surfPath, url = "https://example.com") {
  return withFakeSurfEnv(surfPath, async () =>
    new TestCapabilitiesOrchestrator({
      version: "2.0",
      name,
      targets: { web: url },
      agents: { web: { enabled: true, type: "surf", intensity: "normal" } },
      intelligence: {
        selfHealing: false,
        prediction: false,
        correlation: true,
        collective: false,
      },
      quantum: { enabled: false },
      chaos: { enabled: false },
    }).run(),
  );
}

test(
  "a page readiness refusal and a surf runtime that never started are distinguishable findings",
  { concurrency: false },
  async () => {
    // The page answered and refused: surf's own readiness code reaches the finding.
    const login = createFakeSurf({
      pages: readyPages({
        "https://example.com/": { readiness: "login", evidence: ["login form detected"] },
      }),
    });
    // A surf binary that is searchable but cannot be executed: the process never started.
    const unstartable = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-surf-dir-"));

    try {
      const refused = await runSurfAgent("Surf Login Refusal", login.path);
      const neverRan = await runSurfAgent("Surf Spawn Failure", unstartable);

      const refusal = refused.findings.find((finding) => finding.outcome !== undefined);
      const spawnFailure = neverRan.findings.find((finding) => finding.outcome !== undefined);

      assert.ok(refusal, "the readiness refusal must carry a classified outcome");
      assert.ok(spawnFailure, "the spawn failure must carry a classified outcome");

      assert.equal(refusal.outcome.code, "page_login");
      assert.equal(refusal.outcome.basis, "fault");
      assert.equal(refusal.severity, "high");
      assert.match(refusal.description, /could not reach a settled page state/);
      assert.match(refusal.recommendation, /the page refused it/);

      assert.equal(spawnFailure.outcome.class, "spawn_failed");
      assert.equal(spawnFailure.outcome.code, "spawn_failed");
      assert.equal(spawnFailure.severity, "critical");
      assert.match(spawnFailure.description, /could not be executed/);
      assert.match(spawnFailure.recommendation, /TEST_CAPABILITIES_SURF_BIN/);

      // The two renderings differ in every field a reader acts on.
      assert.notEqual(refusal.description, spawnFailure.description);
      assert.notEqual(refusal.recommendation, spawnFailure.recommendation);
      assert.notEqual(refusal.id, spawnFailure.id);
      assert.equal(refused.determination.value, "failed");
      assert.equal(neverRan.determination.value, "failed");
    } finally {
      login.cleanup();
      rmSync(unstartable, { recursive: true, force: true });
    }
  },
);

test(
  "a verified surf run reports determination verified with its classified probes",
  { concurrency: false },
  async () => {
    const fake = createFakeSurf({
      pages: readyPages({ "https://example.com/": { title: "Example Domain" } }),
    });
    try {
      const result = await runSurfAgent("Surf Determination", fake.path);
      assert.equal(result.passed, true);
      assert.equal(result.determination.value, "verified");
      assert.equal(result.determination.basis, "evidence");
      assert.deepEqual(result.determination.candidates, ["verified"]);
      assert.equal(result.outcomes.length, 2);
      assert.equal(
        result.outcomes.every((outcome) => outcome.ok && outcome.basis === "evidence"),
        true,
      );
      assert.equal(result.observations[0].outcome.class, "success");
      assert.equal(result.observations[0].evidence[0], "outcome:success:ok");
      assert.equal(result.observations[0].evidence[1], "basis:evidence");
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

  const rootCause = result.observations.find((observation) => observation.kind === "root_cause");
  assert.equal(rootCause?.subject, "cli");
  assert.equal(rootCause?.status, "errored");
  assert.equal(rootCause?.semantics?.calibration?.level, "high");
  assert.equal(rootCause?.semantics?.calibration?.signalCount, 2);
  assert.equal(rootCause?.semantics?.calibration?.sensorCount, 2);
  assert.equal(rootCause?.semantics?.calibration?.findingCount, 2);
  assert.equal(
    rootCause?.semantics?.calibration?.basis.includes("2 independent evidence unit(s)"),
    true,
  );
  assert.equal(rootCause?.findingIds.includes("corr-cli"), false);
  assert.match(rootCause?.summary ?? "", /command_resolution as the current failure surface/);
  assert.match(rootCause?.evidence.join("\n") ?? "", /failureClass:command_resolution/);
  assert.doesNotMatch(
    `${rootCause?.summary ?? ""}\n${rootCause?.semantics?.interpretation ?? ""}\n${rootCause?.semantics?.nextStep ?? ""}`,
    /predict|probability|horizon|future|will fail/i,
  );
  assert.equal(result.predictions?.length ?? 0, 0);
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
    result.observations.some((observation) =>
      ["synthesis", "correlation", "root_cause"].includes(observation.kind),
    ),
    false,
  );
  assert.equal(result.observations.length, 2);
});

test("root-cause synthesis requires observed independent evidence units", async () => {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const orchestrator = new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Finding-only Component",
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
      "otherObservation",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [
            {
              protocol: "observation.v1",
              id: "other-runtime-passed",
              agent: "otherObservation",
              kind: "runtime",
              status: "passed",
              subject: "other",
              summary: "other component passed",
              evidence: [],
              semantics: { component: "other", interpretation: "passed" },
              findingIds: [],
              timestamp: observedAt,
            },
          ],
        }),
      },
    ],
    [
      "apiPartialObservation",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [
            {
              protocol: "observation.v1",
              id: "api-contract-observed",
              agent: "apiPartialObservation",
              kind: "runtime",
              status: "failed",
              subject: "api",
              summary: "api contract drift observed",
              evidence: ["schema mismatch"],
              semantics: { component: "api", interpretation: "schema drift observed" },
              findingIds: ["api-contract-drift"],
              timestamp: observedAt,
            },
          ],
        }),
      },
    ],
    [
      "apiFindings",
      {
        execute: async () => ({
          findings: [
            {
              id: "api-contract-drift",
              type: "api_contract",
              severity: "high",
              component: "api",
              description: "API schema drift",
              evidence: ["schema mismatch"],
              recommendation: "Align schema",
              timestamp: observedAt,
            },
            {
              id: "api-validation-mismatch",
              type: "bug",
              severity: "medium",
              component: "api",
              description: "API validation mismatch",
              evidence: ["validation mismatch"],
              recommendation: "Align validation",
              timestamp: observedAt,
            },
          ],
          coverage: {},
        }),
      },
    ],
  ]);

  const result = await orchestrator.run();

  assert.equal(
    result.observations.some(
      (observation) => observation.kind === "root_cause" && observation.subject === "api",
    ),
    false,
  );
});

test("linked finding class does not mask conflicting current-run observation evidence", async () => {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const linkedRuntimeObservation = (id, agent) => ({
    protocol: "observation.v1",
    id,
    agent,
    kind: "runtime",
    status: "failed",
    subject: "api",
    summary: "API handler threw TypeError during request processing.",
    evidence: ["TypeError: cannot read properties of undefined"],
    semantics: {
      component: "api",
      interpretation: "API handler threw TypeError during request processing.",
    },
    findingIds: ["api-contract-drift"],
    timestamp: observedAt,
  });
  const orchestrator = new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Linked Finding Conflict",
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
      "apiObserverA",
      {
        execute: async () => ({
          findings: [
            {
              id: "api-contract-drift",
              type: "api_contract",
              severity: "high",
              component: "api",
              description: "API schema validation mismatch",
              evidence: ["schema validation mismatch"],
              recommendation: "Align schema",
              timestamp: observedAt,
            },
          ],
          coverage: {},
          observations: [linkedRuntimeObservation("api-a-runtime", "apiObserverA")],
        }),
      },
    ],
    [
      "apiObserverB",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [linkedRuntimeObservation("api-b-runtime", "apiObserverB")],
        }),
      },
    ],
  ]);

  const result = await orchestrator.run();

  assert.equal(
    result.observations.some(
      (observation) => observation.kind === "root_cause" && observation.subject === "api",
    ),
    false,
  );
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

test("single passing observation with a critical finding emits degraded synthesis", async () => {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const orchestrator = new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Single Observation Finding Integrity",
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
      "webObservation",
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [
            {
              protocol: "observation.v1",
              id: "web-observation-passed",
              agent: "webObservation",
              kind: "runtime",
              status: "passed",
              subject: "web",
              summary: "web passed",
              evidence: [],
              semantics: { component: "web", interpretation: "passed" },
              findingIds: [],
              timestamp: observedAt,
            },
          ],
        }),
      },
    ],
    [
      "webFinding",
      {
        execute: async () => ({
          findings: [
            {
              id: "web-critical-single",
              type: "bug",
              severity: "critical",
              component: "web",
              description: "single-observation web is broken",
              evidence: ["boom"],
              recommendation: "fix web",
              timestamp: observedAt,
            },
          ],
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
  assert.equal(synthesis?.findingIds.includes("web-critical-single"), true);
  assert.equal(suiteCorrelation?.status, "errored");
  assert.equal(suiteCorrelation?.findingIds.includes("web-critical-single"), true);
});

test("synthesized finding evidence is retained when observation evidence is truncated", async () => {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  const orchestrator = new TestCapabilitiesOrchestrator({
    version: "2.0",
    name: "Observation Evidence Retention",
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
    ...Array.from({ length: 9 }, (_, index) => [
      `webObservation${index}`,
      {
        execute: async () => ({
          findings: [],
          coverage: {},
          observations: [
            {
              protocol: "observation.v1",
              id: `web-observation-${index}`,
              agent: `webObservation${index}`,
              kind: "runtime",
              status: "passed",
              subject: "web",
              summary: `web passed ${index}`,
              evidence: [`observation ${index}`],
              semantics: { component: "web", interpretation: "passed" },
              findingIds: [],
              timestamp: observedAt,
            },
          ],
        }),
      },
    ]),
    [
      "webFinding",
      {
        execute: async () => ({
          findings: [
            {
              id: "web-critical-retained",
              type: "bug",
              severity: "critical",
              component: "web",
              description: "finding evidence must remain visible",
              evidence: ["boom"],
              recommendation: "fix web",
              timestamp: observedAt,
            },
          ],
          coverage: {},
        }),
      },
    ],
  ]);

  const result = await orchestrator.run();
  const synthesis = result.observations.find((entry) => entry.kind === "synthesis");

  assert.equal(synthesis?.status, "errored");
  assert.equal(synthesis?.evidence.length, 8);
  assert.match(synthesis?.evidence.join("\n") ?? "", /finding:critical:web-critical-retained/);
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
          cliA: {
            enabled: true,
            type: "cli-tester",
            intensity: "normal",
            duration: "50ms",
          },
          cliB: {
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
      const rootCause = result.observations.find(
        (observation) => observation.kind === "root_cause",
      );
      assert.match(rootCause?.summary ?? "", /timeout_or_latency as the current failure surface/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  },
);

test("cli agent caps noisy CLI smoke output in findings", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-cli-output-"));
  const scriptPath = path.join(tempDir, "noisy-cli.mjs");
  writeFileSync(scriptPath, "process.stderr.write('x'.repeat(80_000)); process.exit(1);\n", "utf8");

  try {
    const result = await new TestCapabilitiesOrchestrator({
      version: "2.0",
      name: "Noisy CLI Target",
      targets: { cli: `${process.execPath} ${scriptPath}` },
      agents: {
        cli: {
          enabled: true,
          type: "cli-tester",
          intensity: "normal",
        },
      },
    }).run();

    // Since S4 the outcome and basis lines lead the evidence, so the capped channel is the
    // last line rather than the first; the cap itself is what this test is about.
    const lines = result.findings[0]?.evidence ?? [];
    const evidence = lines.at(-1) ?? "";
    assert.equal(result.passed, false);
    assert.equal(lines[0], "outcome:error:exit_1");
    assert.match(evidence, /output truncated after 64000 characters/);
    assert.equal(evidence.length < 65_000, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
    assert.equal(result.coverage.overall, 100);
    assert.deepEqual(result.coverage.measuredDimensions, ["edgeCases"]);
    assert.deepEqual(result.coverage.unmeasuredDimensions, ["userFlows", "apiEndpoints"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// The headline of the result-classification packet: a command that exits 0 and prints nothing
// produced no evidence, so the run is `unverified`, not `passed` (adjudication claim 1; plan S4).
// The plan named `true` as the smallest such target; on GNU coreutils `true --help` prints 944
// bytes of usage, which is real evidence, so the silent shape needs a script of its own.
test("a CLI target that prints nothing is unverified, and a declaration makes it verified", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-silent-cli-"));
  const silent = path.join(dir, "silent-cli.sh");
  writeFileSync(silent, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  try {
    const undeclared = await new TestCapabilitiesOrchestrator({
      version: "2.0",
      name: "Silent CLI Target",
      targets: { cli: silent },
      agents: { cli: { enabled: true, type: "cli-tester", intensity: "normal" } },
    }).run();

    assert.equal(undeclared.passed, false);
    assert.equal(undeclared.determination.value, "unverified");
    assert.equal(undeclared.determination.basis, "no_evidence");

    const finding = undeclared.findings.find((entry) => entry.id === "cli-empty-result");
    assert.ok(finding, "expected the empty payload to be reported as its own finding");
    assert.equal(finding.outcome.class, "empty");
    assert.equal(finding.outcome.basis, "no_evidence");
    // The recommendation names the exact key that would make this shape legitimate.
    assert.match(finding.recommendation, /agents\.cli\.expect: \{ output: empty \}/);
    // An absence of evidence is not a fault, so it must not be counted as a blocking failure.
    assert.equal(undeclared.determination.candidates.includes("failed"), false);

    const declared = await new TestCapabilitiesOrchestrator({
      version: "2.0",
      name: "Silent CLI Target",
      targets: { cli: silent },
      agents: {
        cli: {
          enabled: true,
          type: "cli-tester",
          intensity: "normal",
          expect: { output: "empty" },
        },
      },
    }).run();

    assert.equal(declared.determination.value, "verified");
    assert.equal(declared.determination.basis, "evidence");
    assert.equal(declared.passed, true);
    assert.deepEqual(declared.findings, []);
    assert.equal(declared.outcomes[0].class, "declared_empty");
    assert.equal(declared.outcomes[0].emptiness.declaredBy, "config:agents.cli.expect");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "a bombadil agent whose origin is not in mutation.allowOrigins never spawns",
  { concurrency: false },
  async () => {
    const fake = withFakeBombadil(`
      echo 'this must never run' >&2
      echo '{}' > "$TRACE_PATH"
      exit 0
    `);
    const previousBinary = process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
    process.env.TEST_CAPABILITIES_BOMBADIL_BIN = fake.path;

    try {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Bombadil Without An Allowlist",
        targets: { web: "https://example.com" },
        agents: {
          web: { enabled: true, type: "bombadil", intensity: "normal", duration: "50ms" },
        },
        quantum: { enabled: false },
        chaos: { enabled: false },
      }).run();

      // Which origins this suite may change is the operator's declaration, and the default is
      // none: the refusal happens before the process is spawned (architecture review A13, Q1).
      assert.equal(result.passed, false);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].id, "web-origin-not-allowed");
      assert.match(result.findings[0].description, /mutation\.allowOrigins/);
      assert.match(result.findings[0].evidence[0], /add 'https:\/\/example\.com'/);
      assert.equal(result.coverage.edgeCases, 0);
      assert.equal(result.mutations, undefined, "a step that never ran writes no receipt");
      assert.equal(
        existsSync(fake.tracePath),
        false,
        "the fake bombadil must not have been executed",
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
  "a bombadil run that produced a trace carries a redacted receipt on the result",
  { concurrency: false },
  async () => {
    const fake = withFakeBombadil(`
      echo 'using default specification' >&2
      echo '{}' > "$TRACE_PATH"
      echo "storing trace in $TRACE_PATH" >&2
      exit 0
    `);
    const previousBinary = process.env.TEST_CAPABILITIES_BOMBADIL_BIN;
    process.env.TEST_CAPABILITIES_BOMBADIL_BIN = fake.path;

    try {
      const result = await new TestCapabilitiesOrchestrator({
        version: "2.0",
        name: "Bombadil Receipt",
        targets: { web: "https://example.com" },
        ...ALLOW_EXAMPLE,
        agents: {
          web: { enabled: true, type: "bombadil", intensity: "normal", duration: "2s" },
        },
        quantum: { enabled: false },
        chaos: { enabled: false },
      }).run();

      assert.equal(result.mutations.length, 1);
      const receipt = result.mutations[0];
      assert.equal(receipt.outcome, "applied");
      assert.equal(receipt.effect, "mutating");
      assert.equal(receipt.scope, "target");
      assert.equal(receipt.subject, "https://example.com");
      assert.equal(receipt.intent, "bounded fuzz");
      assert.match(receipt.idempotency_key, /^sha256:[0-9a-f]{64}$/);
      assert.equal(receipt.ephemeral_store, true);
      assert.equal(receipt.path.endsWith(`${receipt.receipt_id}.json`), true);
      // the envelope copy carries no page text and no trace body, only hashes and counts
      assert.deepEqual(receipt.evidence, []);
      assert.deepEqual(receipt.details, { agent: "web", budget_ms: 2000 });
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
