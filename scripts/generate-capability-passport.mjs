import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repoRoot, "governance", "capability-passport.json");
const stdoutMode = process.argv.includes("--stdout");

const runtimeDistRoot = path.resolve(
  process.env.TEST_CAPABILITIES_DIST_ROOT ?? path.join(repoRoot, "dist"),
);
const runtimeCapabilitiesModuleUrl = pathToFileURL(
  path.join(runtimeDistRoot, "core", "capabilities.js"),
).href;

let capabilityMatrix;
try {
  ({ CAPABILITY_MATRIX: capabilityMatrix } = await import(runtimeCapabilitiesModuleUrl));
} catch (error) {
  throw new Error(
    `Capability passport generation requires built runtime artifacts. Run 'npm run build' first. ${error instanceof Error ? error.message : String(error)}`,
  );
}

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const bombadilBinaryPath = path.join(repoRoot, "external", "bombadil");
const bombadilPresent = existsSync(bombadilBinaryPath);

function capabilityEntry({
  id,
  name,
  surfaceKind,
  presenceState,
  supportState,
  verificationState,
  evidence = {},
  attachPoints = [],
  activationRequirements = [],
  notes,
}) {
  return {
    id,
    name,
    surface_kind: surfaceKind,
    presence_state: presenceState,
    support_state: supportState,
    verification_state: verificationState,
    evidence,
    attach_points: attachPoints,
    activation_requirements: activationRequirements,
    ...(notes ? { notes } : {}),
  };
}

const commandEvidence = {
  test: {
    tests: [
      "tests/cli_fail_closed_contract.test.mjs",
      "tests/operation_kernel_contract.test.mjs",
      "tests/capability_drill_contract.test.mjs",
    ],
    commands: ["npm test", "npm run capability:drill -- --surf-mode shim --skip-build"],
  },
  surf: {
    tests: [
      "tests/cli_fail_closed_contract.test.mjs",
      "tests/operation_kernel_contract.test.mjs",
      "tests/capability_drill_contract.test.mjs",
    ],
    commands: ["npm test", "npm run capability:drill -- --surf-mode shim --skip-build"],
  },
  heal: {
    tests: [
      "tests/healing_contract.test.mjs",
      "tests/operation_kernel_contract.test.mjs",
      "tests/capability_drill_contract.test.mjs",
    ],
    commands: ["npm test", "npm run capability:drill -- --surf-mode shim --skip-build"],
  },
  quantum: {
    tests: [
      "tests/cli_fail_closed_contract.test.mjs",
      "tests/operation_kernel_contract.test.mjs",
      "tests/quantum_simulator_contract.test.mjs",
      "tests/capability_drill_contract.test.mjs",
    ],
    commands: ["npm test", "npm run capability:drill -- --surf-mode shim --skip-build"],
  },
  predict: {
    tests: ["tests/cli_fail_closed_contract.test.mjs"],
    commands: ["npm test"],
  },
  visualize: {
    tests: ["tests/cli_fail_closed_contract.test.mjs"],
    commands: ["npm test"],
  },
  report: {
    tests: ["tests/cli_fail_closed_contract.test.mjs"],
    commands: ["npm test"],
  },
};

const actionEvidence = {
  explore: {
    tests: [
      "tests/operation_kernel_contract.test.mjs",
      "tests/surf_client_contract.test.mjs",
      "tests/capability_drill_contract.test.mjs",
    ],
    commands: ["npm run capability:drill -- --surf-mode shim --skip-build"],
  },
  flow: { tests: ["tests/operation_kernel_contract.test.mjs"], commands: ["npm test"] },
  assert: { tests: ["tests/operation_kernel_contract.test.mjs"], commands: ["npm test"] },
  compare: { tests: ["tests/operation_kernel_contract.test.mjs"], commands: ["npm test"] },
  replay: { tests: ["tests/operation_kernel_contract.test.mjs"], commands: ["npm test"] },
};

const capabilities = [];

for (const [command, status] of Object.entries(capabilityMatrix.cli.commands)) {
  capabilities.push(
    capabilityEntry({
      id: `cli:${command}`,
      name: `${command} command`,
      surfaceKind: "cli-command",
      presenceState: "present",
      supportState: status === "implemented" ? "supported" : "unsupported",
      verificationState: status === "implemented" ? "verified" : "contract_only",
      evidence: commandEvidence[command],
      attachPoints: ["src/core/operations.ts", "src/core/capabilities.ts"],
    }),
  );
}

capabilities.push(
  capabilityEntry({
    id: "cli-option:heal-proposal-and-verification-output",
    name: "heal --proposal-output / --verification-output / --checkpoint-ref",
    surfaceKind: "cli-option",
    presenceState: "present",
    supportState: "implemented",
    verificationState: "verified",
    evidence: {
      tests: ["tests/operation_kernel_contract.test.mjs"],
      commands: ["npm test"],
    },
    attachPoints: [
      "bin/test-capabilities",
      "src/core/operations/heal-operation.ts",
      "docs/project/2026-04-30-recovery-backed-repair-readiness.md",
    ],
    activationRequirements: [],
    notes:
      "Writes dry-run-only JSON healing proposal and in-memory verification artifacts for review or future replay-ledger artifact follow-through, and requires an externally-owned checkpoint ref before apply-mode healing mutates files. It does not create checkpoints, emit Replay Fabric milestones, or execute rollback.",
  }),
);

for (const [action, status] of Object.entries(capabilityMatrix.cli.surfActions)) {
  capabilities.push(
    capabilityEntry({
      id: `surf-action:${action}`,
      name: `surf ${action}`,
      surfaceKind: "cli-subcommand",
      presenceState: "present",
      supportState: status === "implemented" ? "supported" : "unsupported",
      verificationState: status === "implemented" ? "verified" : "contract_only",
      evidence: actionEvidence[action],
      attachPoints: ["src/core/operations.ts", "src/core/capabilities.ts"],
    }),
  );
}

for (const [agent, status] of Object.entries(capabilityMatrix.orchestrator.agents)) {
  const bombadilAgent = agent === "bombadil";
  const surfAgent = agent === "surf";
  capabilities.push(
    capabilityEntry({
      id: `agent:${agent}`,
      name: `${agent} orchestrator agent`,
      surfaceKind: "orchestrator-agent",
      presenceState: bombadilAgent && bombadilPresent ? "present" : "present",
      supportState:
        status === "implemented"
          ? "supported"
          : bombadilAgent && bombadilPresent
            ? "parked"
            : "unsupported",
      verificationState:
        status === "implemented"
          ? "verified"
          : bombadilAgent && bombadilPresent
            ? "present_only"
            : "contract_only",
      evidence:
        status === "implemented"
          ? bombadilAgent
            ? {
                files: bombadilPresent ? ["external/bombadil"] : undefined,
                tests: [
                  "tests/orchestrator_fail_closed_contract.test.mjs",
                  "tests/config_overrides_contract.test.mjs",
                  "tests/cli_fail_closed_contract.test.mjs",
                  "tests/bombadil_runtime_contract.test.mjs",
                ],
                commands: ["npm test"],
              }
            : surfAgent
              ? {
                  tests: [
                    "tests/orchestrator_fail_closed_contract.test.mjs",
                    "tests/config_overrides_contract.test.mjs",
                    "tests/cli_fail_closed_contract.test.mjs",
                    "tests/capability_drill_contract.test.mjs",
                    "tests/surf_runtime_contract.test.mjs",
                  ],
                  commands: ["npm test", "npm run capability:drill -- --surf-mode shim"],
                }
              : {
                  tests: ["tests/orchestrator_fail_closed_contract.test.mjs"],
                  commands: ["npm test"],
                }
          : bombadilAgent && bombadilPresent
            ? {
                files: ["external/bombadil"],
                tests: ["tests/orchestrator_fail_closed_contract.test.mjs"],
                commands: ["npm test"],
              }
            : {
                tests: ["tests/orchestrator_fail_closed_contract.test.mjs"],
                commands: ["npm test"],
              },
      attachPoints: ["src/core/capabilities.ts", "src/core/orchestrator.ts"],
      activationRequirements:
        status === "implemented"
          ? []
          : bombadilAgent && bombadilPresent
            ? [
                "Add a core-owned Bombadil execution path instead of depending on the vendored binary ad hoc.",
                "Introduce fail-closed input validation plus structured result envelopes for Bombadil-backed runs.",
                "Add adversarial runtime fixtures, docs, and release checks before promoting the agent to supported.",
                "Only then flip support_state from parked to supported in the capability passport and runtime matrix.",
              ]
            : [],
      notes:
        status === "implemented" && bombadilAgent
          ? "Supported Bombadil runtime resolves TEST_CAPABILITIES_BOMBADIL_BIN first, then a built checkout from TEST_CAPABILITIES_BOMBADIL_REPO or the conventional workspace-local softwareco/contrib/bombadil, then repo-local external/bombadil, then bombadil on PATH."
          : status === "implemented" && surfAgent
            ? "Supported Surf runtime uses the shared surf explore operation, resolves TEST_CAPABILITIES_SURF_GO_BIN, TEST_CAPABILITIES_SURF_GO_REPO, the workspace surf-cli-go checkout, or surf-go on PATH, and verifies browser-state evidence after navigation before reporting user-flow coverage. Empty output, help text, warning-only output, and target URLs without a matching browser-state probe fail closed as unverified coverage."
            : bombadilAgent && bombadilPresent
              ? "Bombadil is vendored in the repo, but the orchestrator currently rejects bombadil agents until a real runtime path is restored."
              : undefined,
    }),
  );
}

capabilities.push(
  capabilityEntry({
    id: "tool:bombadil-binary",
    name: "Vendored Bombadil binary",
    surfaceKind: "vendored-tool",
    presenceState: bombadilPresent ? "present" : "absent",
    supportState: bombadilPresent ? "parked" : "unsupported",
    verificationState: bombadilPresent ? "present_only" : "unverified",
    evidence: bombadilPresent
      ? {
          files: ["external/bombadil"],
          commands: ["file external/bombadil", "npm run consumer:smoke"],
        }
      : {},
    attachPoints: ["external/bombadil", "README.md", "docs/project/product_posture.md"],
    activationRequirements: bombadilPresent
      ? [
          "Intentionally include the vendored Bombadil binary in packed artifacts before treating this vendored tool itself as a consumer-facing supported surface; the current packed-consumer contract treats Bombadil as an external binary requirement.",
        ]
      : [],
    notes: bombadilPresent
      ? "Repo-local external/bombadil is one binary provider for the supported Bombadil agent in this checkout; a built softwareco/contrib/bombadil checkout can override it locally, while packed consumers still need TEST_CAPABILITIES_BOMBADIL_BIN, TEST_CAPABILITIES_BOMBADIL_REPO, or bombadil on PATH."
      : "Bombadil binary is not currently vendored in this checkout.",
  }),
);

const libraryCapabilities = [
  {
    id: "library:executeCliOperation",
    name: "executeCliOperation",
    surfaceKind: "library-api",
    verificationState: "verified",
    evidence: {
      tests: ["tests/operation_kernel_contract.test.mjs"],
      commands: ["npm test"],
    },
  },
  {
    id: "library:SurfClient",
    name: "SurfClient",
    surfaceKind: "library-api",
    verificationState: "verified",
    evidence: {
      tests: ["tests/surf_client_contract.test.mjs"],
      commands: ["npm test"],
    },
  },
  {
    id: "library:QuantumSimulator",
    name: "QuantumSimulator",
    surfaceKind: "library-api",
    verificationState: "verified",
    evidence: {
      tests: ["tests/quantum_simulator_contract.test.mjs"],
      commands: ["npm test"],
    },
  },
  {
    id: "library:PredictionEngine",
    name: "PredictionEngine",
    surfaceKind: "library-api",
    verificationState: "verified",
    evidence: {
      tests: [
        "tests/prediction_collector_contract.test.mjs",
        "tests/capability_drill_contract.test.mjs",
      ],
      commands: ["npm test", "npm run capability:drill -- --surf-mode shim --skip-build"],
    },
  },
  {
    id: "library:SelfHealingEngine",
    name: "SelfHealingEngine",
    surfaceKind: "library-api",
    verificationState: "verified",
    evidence: {
      tests: ["tests/healing_contract.test.mjs"],
      commands: ["npm test"],
    },
  },
  {
    id: "library:TestFileHealer",
    name: "TestFileHealer",
    surfaceKind: "library-api",
    verificationState: "verified",
    evidence: {
      tests: ["tests/healing_contract.test.mjs", "tests/capability_drill_contract.test.mjs"],
      commands: ["npm test", "npm run capability:drill -- --surf-mode shim --skip-build"],
    },
  },
];

for (const libraryCapability of libraryCapabilities) {
  capabilities.push(
    capabilityEntry({
      ...libraryCapability,
      presenceState: "present",
      supportState: "library_only",
      attachPoints: ["src/index.ts"],
    }),
  );
}

const passport = {
  schema_version: 1,
  kind: "capability_passport_projection",
  repo_name: packageJson.name,
  package_version: packageJson.version,
  projection_note:
    "Informational capability projection for this repo. Useful now, but not authoritative task or product state. Candidate future AK model.",
  support_state_vocabulary: ["supported", "unsupported", "parked", "library_only"],
  verification_state_vocabulary: ["verified", "contract_only", "present_only", "unverified"],
  capabilities: capabilities.sort((left, right) => left.id.localeCompare(right.id)),
};

const serialized = `${JSON.stringify(passport, null, 2)}\n`;

if (stdoutMode) {
  process.stdout.write(serialized);
} else {
  writeFileSync(outputPath, serialized, "utf8");

  const biomePath = path.join(repoRoot, "node_modules", ".bin", "biome");
  if (existsSync(biomePath)) {
    const formatted = spawnSync(biomePath, ["format", "--write", outputPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (formatted.status !== 0) {
      throw new Error(
        `Biome formatting failed for capability passport: ${formatted.stderr || formatted.stdout}`,
      );
    }
  }

  process.stdout.write(`${outputPath}\n`);
}
