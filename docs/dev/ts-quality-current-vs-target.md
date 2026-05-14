---
summary: "Current-vs-target rollout map for repo-local ts-quality screening in test-capabilities."
read_when:
  - "You need an overview of what ts-quality covers today in this repo."
  - "You are deciding the next repo-local screening slice to add."
type: "reference"
---

# ts-quality current vs target — test-capabilities

This file is the repo-local rollout truth for `ts-quality` screening in `test-capabilities`.

Use it to answer:
- what is live today
- what is ready to add next
- what is only a later candidate
- what the target screening shape is for this repo

The central catalog in a sibling `../ts-quality/` checkout, when present, is a downstream overview, not the authority for this repo.

## Current live slices

| Invariant | Screened test-capabilities file(s) | Witness test | Current status | Notes |
|---|---|---|---|---|
| `operation.kernel.fail-closed` | `src/core/operations/dispatch-execution.ts` | `tests/operation_kernel_contract.test.mjs` | live / supported | Operator-facing aliases `src/core/operations.ts` and `dist/core/operations.js` normalize onto the implementation file so mutation pressure lands on real logic rather than a facade barrel. |
| `operation.command-runner.error-surface` | `src/core/operations/command-runner-core.ts` | `tests/command_runner_contract.test.mjs` | live / supported | Operator-facing aliases `src/core/operations/command-runner.ts` and `dist/core/operations/command-runner.js` normalize onto the implementation file so mutation pressure lands on real logic rather than a facade barrel. |
| `healing.collect-files.boundary` | `src/healing/collect-files-core.ts` | `tests/collect_files_contract.test.mjs` | live / supported | Operator-facing aliases `src/healing/collect-files.ts` and `dist/healing/collect-files.js` normalize onto the implementation file so mutation pressure lands on real logic rather than a facade barrel. |
| `operation.quantum.input-envelope.contract` | `src/core/operations/quantum-operation.ts` | `tests/quantum_operation_contract.test.mjs` | live / supported | The slice screens the behavior-bearing quantum operation implementation directly and keeps witness pressure on input validation plus result-envelope shaping rather than the broader simulator layer. |
| `operation.test.config-override.contract` | `src/core/operations/config-targets-core.ts`, `src/core/operations/config-quick-mode-core.ts`, `src/core/operations/config-load-core.ts` | `tests/config_overrides_contract.test.mjs` | live / supported | The facade alias `src/core/operations/config-overrides.ts` normalizes onto a three-file implementation cluster because the override contract is split across load, target routing, and quick-mode shaping. |

## Ready-next slices

No single ready-next slice is declared right now.
This repo should pause widening until one later candidate has a clearly behavior-bearing boundary and one focused witness path that is reviewable on its own.
Do not force another slice just to increase coverage count.
Let the current five-slice set settle before naming another ready-next candidate.

## Candidate later slices

These look worthwhile, but they are less obviously the next best slice than the already-landed rollout set above.

| Area | Likely screened file(s) | Likely witness/evidence | Why later |
|---|---|---|---|
| surf explore operation | `src/core/operations/surf-explore-operation.ts` | `tests/operation_kernel_contract.test.mjs`, `tests/surf_client_contract.test.mjs` | Intentionally paused while the surf implementation/runtime choice may still change; do not start this slice until the runtime boundary stabilizes and the witness can stay focused. |
| heal operation | `src/core/operations/heal-operation.ts` | `tests/healing_contract.test.mjs` | Useful, but broader than the first rollout slices. |
| config schema fail-closed | adjacent config-loading/runtime paths | `tests/config_contract.test.mjs` | Overlaps with the now-live config-override cluster until responsibilities are split more sharply. |
| orchestrator fail-closed | orchestrator control-plane paths | `tests/orchestrator_fail_closed_contract.test.mjs` | Valuable, but broader and noisier than the current operation-kernel rollout pattern. |

## Target state for this repo

Target does **not** mean “screen every file equally.” It means the high-risk behavior-bearing boundaries have explicit screening slices.

Desired shape:
- cover the highest-risk behavior-bearing paths under `src/core/operations/**`
- cover selected bounded helper boundaries under `src/healing/**`
- avoid centering slices on facade/export barrels unless they only serve as operator-facing aliases to a real implementation file
- keep witness commands focused and deterministic rather than repo-global
- keep each slice reviewable on its own before widening again

## Rollout rules

When adding the next slice:
1. prefer a behavior-bearing implementation file over a facade barrel
2. pair it with one focused contract test or witness command
3. add one invariant at a time unless a cluster is truly inseparable
4. normalize facade/runtime aliases onto the real screened implementation file
5. preserve repo-local docs as the authority for this repo

## Central catalog sync

The upstream `ts-quality` repo keeps a downstream cross-repo catalog for visibility across projects.

Optional local registration command when a sibling `ts-quality` checkout is available:

```bash
cd ../ts-quality
node scripts/register-screening-catalog.mjs \
  --entry docs/adoption/entries/test-capabilities.json
```

To verify the central markdown view still matches the machine-readable catalog:

```bash
cd ../ts-quality
node scripts/register-screening-catalog.mjs --check
```
