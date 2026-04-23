export default [
  {
    id: "maintainer",
    kind: "human",
    roles: ["maintainer"],
    grants: [
      {
        id: "maintainer-screening-merge",
        actions: ["merge", "override", "amend"],
        paths: [
          "src/core/operations/command-runner-core.ts",
          "src/core/operations/config-load-core.ts",
          "src/core/operations/config-quick-mode-core.ts",
          "src/core/operations/config-targets-core.ts",
          "src/core/operations/dispatch-execution.ts",
          "src/healing/collect-files-core.ts",
        ],
        minMergeConfidence: 50,
      },
    ],
  },
  {
    id: "release-bot",
    kind: "automation",
    roles: ["ci"],
    grants: [
      {
        id: "release-bot-screening-merge",
        actions: ["merge"],
        paths: [
          "src/core/operations/command-runner-core.ts",
          "src/core/operations/config-load-core.ts",
          "src/core/operations/config-quick-mode-core.ts",
          "src/core/operations/config-targets-core.ts",
          "src/core/operations/dispatch-execution.ts",
          "src/healing/collect-files-core.ts",
        ],
        minMergeConfidence: 70,
        requireHumanReview: true,
      },
    ],
  },
];
