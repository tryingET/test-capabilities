export default [
  {
    kind: "risk",
    id: "operation-kernel-screening-risk",
    paths: ["src/core/operations/dispatch-execution.ts"],
    message:
      "Operation-kernel fail-closed dispatch changes require deterministic screening evidence.",
    maxCrap: 30,
    minMutationScore: 0.5,
    minMergeConfidence: 50,
  },
  {
    kind: "risk",
    id: "command-runner-screening-risk",
    paths: ["src/core/operations/command-runner-core.ts"],
    message: "Command-runner error-surface changes require deterministic screening evidence.",
    maxCrap: 30,
    minMutationScore: 0.5,
    minMergeConfidence: 50,
  },
  {
    kind: "risk",
    id: "collect-files-screening-risk",
    paths: ["src/healing/collect-files-core.ts"],
    message: "collectFiles boundary changes require deterministic screening evidence.",
    maxCrap: 30,
    minMutationScore: 0.5,
    minMergeConfidence: 50,
  },
  {
    kind: "risk",
    id: "config-override-screening-risk",
    paths: [
      "src/core/operations/config-load-core.ts",
      "src/core/operations/config-quick-mode-core.ts",
      "src/core/operations/config-targets-core.ts",
    ],
    message: "Config override and quick-mode changes require deterministic screening evidence.",
    maxCrap: 30,
    minMutationScore: 0.5,
    minMergeConfidence: 50,
  },
];
