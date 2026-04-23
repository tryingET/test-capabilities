---
summary: "Repo-local ts-quality screening integration for test-capabilities."
read_when:
  - "You want to run deterministic screening in this repo."
  - "You need the repo-specific ts-quality wrapper and changed-scope rules."
type: "how-to"
---

# ts-quality screening in test-capabilities

This repo is the first real TypeScript brownfield proving ground for `ts-quality`.

Canonical `ts-quality` semantics live upstream in:
- `~/ai-society/softwareco/owned/ts-quality/README.md`
- `~/ai-society/softwareco/owned/ts-quality/docs/invariant-dsl.md`
- `~/ai-society/softwareco/owned/ts-quality/docs/config-reference.md`
- `~/ai-society/softwareco/owned/ts-quality/docs/ci-integration.md`

This doc records only the repo-local integration truth.

For the rollout overview of what is live today vs planned next in this repo, see [docs/dev/ts-quality-current-vs-target.md](docs/dev/ts-quality-current-vs-target.md).

## Scope distinction

To keep the boundaries explicit:

- **screened test-capabilities code**: `src/**`, with the current live slices on `src/core/operations/dispatch-execution.ts`, `src/core/operations/command-runner-core.ts`, `src/healing/collect-files-core.ts`, `src/core/operations/quantum-operation.ts`, and the config-override cluster under `src/core/operations/config-*.ts`
- **repo-local ts-quality integration files**: `ts-quality.config.json`, `.ts-quality/**`, and `scripts/screening/**`
- **upstream ts-quality implementation/docs**: `../ts-quality/**`

## Repo-local execution model

- screening targets authored TypeScript under `src/**`
- runtime tests still execute built output under `dist/**`
- each screening wrapper builds an isolated runtime under `tmp/ts-quality-screening.*/dist`
- `screening:check` collects LCOV against the repo's top-level runtime test corpus on that isolated built runtime, then remaps `SF:` entries back onto `src/**` through source maps before invoking `ts-quality`
- mutation baseline and mutant runs execute the same runtime test corpus through `scripts/screening/run-runtime-tests.sh` against the isolated built runtime via `TEST_CAPABILITIES_DIST_ROOT`
- witness refresh and check both use a per-run overlay config under `.ts-quality/materialized/screening.*` so changed scope, diff scope, isolated coverage, and isolated runtime roots stay run-local

## Current live slices

| Invariant | Screened test-capabilities file(s) | Witness test | Notes |
|---|---|---|---|
| `operation.kernel.fail-closed` | `src/core/operations/dispatch-execution.ts` | `tests/operation_kernel_contract.test.mjs` | `src/core/operations.ts` and `dist/core/operations.js` normalize onto the implementation file. |
| `operation.command-runner.error-surface` | `src/core/operations/command-runner-core.ts` | `tests/command_runner_contract.test.mjs` | `src/core/operations/command-runner.ts` and `dist/core/operations/command-runner.js` normalize onto the implementation file. |
| `healing.collect-files.boundary` | `src/healing/collect-files-core.ts` | `tests/collect_files_contract.test.mjs` | `src/healing/collect-files.ts` and `dist/healing/collect-files.js` normalize onto the implementation file. |
| `operation.quantum.input-envelope.contract` | `src/core/operations/quantum-operation.ts` | `tests/quantum_operation_contract.test.mjs` | Screen the quantum operation implementation file directly; keep the witness centered on operation-level input validation and result-envelope shaping rather than the broader simulator contract. |
| `operation.test.config-override.contract` | `src/core/operations/config-targets-core.ts`, `src/core/operations/config-quick-mode-core.ts`, `src/core/operations/config-load-core.ts` | `tests/config_overrides_contract.test.mjs` | `src/core/operations/config-overrides.ts` and `dist/core/operations/config-overrides.js` normalize onto the implementation cluster. |

Why these implementation files instead of facade barrels:
- facade/export surfaces are useful operator-facing aliases, but they are weak mutation targets
- the behavior-bearing implementation files carry the real fail-closed, error-surface, boundary, and config-shaping logic
- repo-local screening normalizes facade/runtime entrypoints onto those implementation files so mutation pressure lands on executable logic instead of re-export glue

## Changed-scope normalization

The repo-local wrappers accept either authored-source or built-runtime inputs, but screening always normalizes onto the authored `src/**` test-capabilities file(s) being screened.

Current canonical examples:
- `src/core/operations/dispatch-execution.ts` -> `src/core/operations/dispatch-execution.ts`
- `src/core/operations.ts` -> `src/core/operations/dispatch-execution.ts`
- `dist/core/operations.js` -> `src/core/operations/dispatch-execution.ts`
- `src/core/operations/command-runner-core.ts` -> `src/core/operations/command-runner-core.ts`
- `src/core/operations/command-runner.ts` -> `src/core/operations/command-runner-core.ts`
- `dist/core/operations/command-runner.js` -> `src/core/operations/command-runner-core.ts`
- `src/healing/collect-files-core.ts` -> `src/healing/collect-files-core.ts`
- `src/healing/collect-files.ts` -> `src/healing/collect-files-core.ts`
- `dist/healing/collect-files.js` -> `src/healing/collect-files-core.ts`
- `src/core/operations/quantum-operation.ts` -> `src/core/operations/quantum-operation.ts`
- `dist/core/operations/quantum-operation.js` -> `src/core/operations/quantum-operation.ts`
- `src/core/operations/config-overrides.ts` -> `src/core/operations/config-targets-core.ts`, `src/core/operations/config-quick-mode-core.ts`, `src/core/operations/config-load-core.ts`
- `dist/core/operations/config-overrides.js` -> `src/core/operations/config-targets-core.ts`, `src/core/operations/config-quick-mode-core.ts`, `src/core/operations/config-load-core.ts`

If `--changed` is omitted, the wrappers derive changed `src/**` files from git-visible tracked and untracked source changes. For the current live slices, you can pass either the operator-facing facade path or the canonical screened implementation path.

## Commands

```bash
npm run screening:witness-refresh -- --changed src/core/operations.ts
npm run screening:witness-refresh -- --changed src/core/operations/dispatch-execution.ts
npm run screening:check -- --changed src/core/operations.ts --run-id tc-operations-screen

npm run screening:witness-refresh -- --changed src/core/operations/command-runner.ts
npm run screening:witness-refresh -- --changed src/core/operations/command-runner-core.ts
npm run screening:check -- --changed src/core/operations/command-runner.ts --run-id tc-command-runner-screen

npm run screening:witness-refresh -- --changed src/healing/collect-files.ts
npm run screening:witness-refresh -- --changed src/healing/collect-files-core.ts
npm run screening:check -- --changed src/healing/collect-files.ts --run-id tc-collect-files-screen

npm run screening:witness-refresh -- --changed src/core/operations/quantum-operation.ts
npm run screening:check -- --changed src/core/operations/quantum-operation.ts --run-id tc-quantum-operation-screen

npm run screening:witness-refresh -- --changed src/core/operations/config-overrides.ts
npm run screening:witness-refresh -- --changed src/core/operations/config-targets-core.ts
npm run screening:check -- --changed src/core/operations/config-overrides.ts --run-id tc-config-overrides-screen
```

## Repo-local control-plane files

Committed files for this slice set:
- `ts-quality.config.json`
- `.ts-quality/invariants.ts`
- `.ts-quality/constitution.ts`
- `.ts-quality/agents.ts`
- `.ts-quality/approvals.json`
- `.ts-quality/waivers.json`
- `.ts-quality/overrides.json`
- `.ts-quality/witnesses/README.md`
- `scripts/screening/ts-quality-common.sh`
- `scripts/screening/ts-quality-witness-refresh.sh`
- `scripts/screening/ts-quality-check.sh`
- `scripts/screening/run-runtime-tests.sh`
- `scripts/screening/remap-lcov-to-src.mjs`

Ignored runtime artifacts for this slice set:
- `coverage/`
- `.ts-quality/runs/`
- `.ts-quality/materialized/`
- `.ts-quality/attestations/`
- `.ts-quality/keys/`
- generated witness and receipt JSON under `.ts-quality/witnesses/*.json`
