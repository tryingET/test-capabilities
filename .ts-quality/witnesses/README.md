# Execution witnesses

This directory holds repo-local `ts-quality` execution witness artifacts and their sibling `*.receipt.json` sidecars.

Current live slices:
- `operation.kernel.fail-closed`
  - screened test-capabilities file: `src/core/operations/dispatch-execution.ts`
  - operator-facing facade alias: `src/core/operations.ts`
  - witness artifact: `operation-kernel-contract.json`
  - receipt sidecar: `operation-kernel-contract.receipt.json`
- `operation.command-runner.error-surface`
  - screened test-capabilities file: `src/core/operations/command-runner-core.ts`
  - operator-facing facade alias: `src/core/operations/command-runner.ts`
  - witness artifact: `command-runner-contract.json`
  - receipt sidecar: `command-runner-contract.receipt.json`
- `healing.collect-files.boundary`
  - screened test-capabilities file: `src/healing/collect-files-core.ts`
  - operator-facing facade alias: `src/healing/collect-files.ts`
  - witness artifact: `collect-files-contract.json`
  - receipt sidecar: `collect-files-contract.receipt.json`
- `operation.test.config-override.contract`
  - screened test-capabilities files: `src/core/operations/config-targets-core.ts`, `src/core/operations/config-quick-mode-core.ts`, `src/core/operations/config-load-core.ts`
  - operator-facing facade alias: `src/core/operations/config-overrides.ts`
  - witness artifact: `config-overrides-contract.json`
  - receipt sidecar: `config-overrides-contract.receipt.json`

Runtime-generated witness and receipt JSON files are gitignored. Keep only this README committed.
