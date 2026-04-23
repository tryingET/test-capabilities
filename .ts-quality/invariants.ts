export default [
  {
    id: "operation.kernel.fail-closed",
    title: "Operation kernel stays fail-closed",
    description:
      "Unsupported commands, unsupported surf actions, and inert runtime paths must reject clearly instead of pretending success.",
    severity: "high",
    selectors: ["path:src/core/operations/dispatch-execution.ts", "symbol:executeCliOperation"],
    requiredTestPatterns: ["tests/operation_kernel_contract.test.mjs"],
    scenarios: [
      {
        id: "unsupported-routes-rejected",
        description:
          "unsupported commands, unsupported surf actions, and inert URL test targets fail closed",
        keywords: ["Unsupported CLI command(s): predict", "Unsupported surf action(s): flow"],
        failurePathKeywords: ["URL targets for 'test' require a real web-consuming runtime path"],
        executionWitnessCommand: ["node", "--test", "tests/operation_kernel_contract.test.mjs"],
        executionWitnessOutput: ".ts-quality/witnesses/operation-kernel-contract.json",
        executionWitnessTestFiles: ["tests/operation_kernel_contract.test.mjs"],
        executionWitnessTimeoutMs: 10000,
        expected: "reject",
      },
    ],
  },
  {
    id: "operation.command-runner.error-surface",
    title: "Command runner preserves success output and fails loudly",
    description:
      "runCommand must preserve stdout and stderr on success while surfacing spawn and process failures instead of hiding them.",
    severity: "high",
    selectors: ["path:src/core/operations/command-runner-core.ts", "symbol:runCommand"],
    requiredTestPatterns: ["tests/command_runner_contract.test.mjs"],
    scenarios: [
      {
        id: "success-and-failure-surfaced",
        description: "successful commands preserve output and failure paths surface process detail",
        keywords: ["runCommand captures stdout and stderr on success"],
        failurePathKeywords: ["runCommand rejects missing commands with a surfaced spawn error"],
        executionWitnessCommand: ["node", "--test", "tests/command_runner_contract.test.mjs"],
        executionWitnessOutput: ".ts-quality/witnesses/command-runner-contract.json",
        executionWitnessTestFiles: ["tests/command_runner_contract.test.mjs"],
        executionWitnessTimeoutMs: 10000,
        expected: "surface",
      },
    ],
  },
  {
    id: "healing.collect-files.boundary",
    title: "collectFiles stays bounded and fail-closed",
    description:
      "collectFiles must reject invalid roots and ignore generated directories while returning sorted source candidates.",
    severity: "high",
    selectors: ["path:src/healing/collect-files-core.ts", "symbol:collectFiles"],
    requiredTestPatterns: ["tests/collect_files_contract.test.mjs"],
    scenarios: [
      {
        id: "bounded-scan-and-invalid-root-rejected",
        description: "invalid roots fail closed and generated directories stay out of the scan",
        keywords: [
          "collectFiles ignores generated directories and returns sorted source candidates",
        ],
        failurePathKeywords: ["collectFiles fails closed when the target directory is missing"],
        executionWitnessCommand: ["node", "--test", "tests/collect_files_contract.test.mjs"],
        executionWitnessOutput: ".ts-quality/witnesses/collect-files-contract.json",
        executionWitnessTestFiles: ["tests/collect_files_contract.test.mjs"],
        executionWitnessTimeoutMs: 10000,
        expected: "bound",
      },
    ],
  },
  {
    id: "operation.quantum.input-envelope.contract",
    title: "Quantum operation stays fail-closed and envelope-shaped",
    description:
      "Quantum operation input parsing must reject missing or invalid targets and invalid branch counts while returning a normalized result envelope for valid requests.",
    severity: "high",
    selectors: ["path:src/core/operations/quantum-operation.ts", "symbol:executeQuantumOperation"],
    requiredTestPatterns: ["tests/quantum_operation_contract.test.mjs"],
    scenarios: [
      {
        id: "input-validated-and-envelope-shaped",
        description:
          "quantum operation inputs fail closed and valid calls return a normalized result envelope",
        keywords: ["executeQuantumOperation returns a normalized quantum result envelope"],
        failurePathKeywords: [
          "Quantum simulation requires --target with a valid URL",
          "Quantum target must be a valid URL",
          "Invalid value for --branches: 0. Use a positive integer.",
        ],
        executionWitnessCommand: ["node", "--test", "tests/quantum_operation_contract.test.mjs"],
        executionWitnessOutput: ".ts-quality/witnesses/quantum-operation-contract.json",
        executionWitnessTestFiles: ["tests/quantum_operation_contract.test.mjs"],
        executionWitnessTimeoutMs: 10000,
        expected: "preserve",
      },
    ],
  },
  {
    id: "operation.test.config-override.contract",
    title: "Test config overrides stay fail-closed and intention-preserving",
    description:
      "Config loading, target overrides, and quick-mode shaping must preserve supported runtime intent while rejecting inert URL target overrides.",
    severity: "high",
    selectors: [
      "path:src/core/operations/config-targets-core.ts",
      "path:src/core/operations/config-quick-mode-core.ts",
      "path:src/core/operations/config-load-core.ts",
      "symbol:loadConfig",
    ],
    requiredTestPatterns: ["tests/config_overrides_contract.test.mjs"],
    scenarios: [
      {
        id: "load-override-and-quick-mode",
        description: "config loading, target override routing, and quick mode stay deterministic",
        keywords: [
          "applyTargetOverride routes CLI paths to targets.cli and URLs to targets.web",
          "applyQuickMode disables quantum and prediction while preserving other runtime intent",
        ],
        failurePathKeywords: [
          "assertMeaningfulTestTargetOverride fails closed only for inert URL targets",
          "loadConfig parses the canonical YAML, tolerates empty YAML, and fails clearly when the file is missing",
        ],
        executionWitnessCommand: ["node", "--test", "tests/config_overrides_contract.test.mjs"],
        executionWitnessOutput: ".ts-quality/witnesses/config-overrides-contract.json",
        executionWitnessTestFiles: ["tests/config_overrides_contract.test.mjs"],
        executionWitnessTimeoutMs: 10000,
        expected: "preserve",
      },
    ],
  },
];
