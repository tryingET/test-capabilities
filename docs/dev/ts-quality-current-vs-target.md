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

## ts-quality adoption state

- adoptionStatus: `accepted-repo-local`
- acceptedBy: Holding Owner (owner decision of 2026-10-06, recorded on ts-quality AK6550 evidence 14172)
- acceptedAt: 2026-10-06
- packageSource: npm `ts-quality@0.7.0`, pinned exactly as a devDependency. `scripts/screening/ts-quality-common.sh` resolves `node_modules/.bin/ts-quality` first; `TS_QUALITY_BIN` and the sibling `../ts-quality/dist` fallback are not the accepted source.
- repoLocalControlPlane: `ts-quality.config.json` (mutations.timeoutMs 60000, because the full runtime suite takes about 30 s), `.ts-quality/invariants.ts`, `.ts-quality/constitution.ts`, `.ts-quality/agents.ts`, `.ts-quality/approvals.json`, `.ts-quality/waivers.json`, `.ts-quality/overrides.json`, `.ts-quality/witnesses/README.md`, `scripts/screening/*`
- artifactRetentionPolicy: per `.gitignore`, `.ts-quality/runs/`, `latest.json`, `mutation-manifest.json`, `materialized/`, `locks/`, `tmp-mutants/`, `attestations/`, `keys/`, `witnesses/*.json` and `coverage/` stay local and uncommitted; config, control-plane files and the witness README are committed.
- acceptedSlices: the four live slices below, each with content-bound (0.7.0) execution witnesses.
- latestEvidence (2026-10-06, normal checkout, npm 0.7.0):

| Slice | Run id | Outcome | Mutation | Witness |
|---|---|---|---|---|
| `operation.kernel.fail-closed` | `tc-operation-kernel-accept-20261006` | pass, 90/100 | 6 killed / 6 | execution-backed |
| `healing.collect-files.boundary` | `tc-collect-files-accept-20261006` | pass, 90/100 | 10 killed / 10 | execution-backed |
| `operation.quantum.input-envelope.contract` | `tc-quantum-operation-accept-20261006` | pass, 90/100 | 3 killed / 3 | execution-backed |
| `operation.test.config-override.contract` | `tc-config-overrides-accept-20261006` | pass, 90/100 | 16 killed / 16 | execution-backed |

- commands (from a normal checkout):

```bash
npm ci
npm run screening:witness-refresh -- --changed "src/core/operations/dispatch-execution.ts,src/healing/collect-files-core.ts,src/core/operations/quantum-operation.ts,src/core/operations/config-targets-core.ts,src/core/operations/config-quick-mode-core.ts,src/core/operations/config-load-core.ts"
npm run screening:check -- --changed src/core/operations/quantum-operation.ts --run-id <new-run-id>
npx ts-quality explain --run-id <new-run-id>
npx ts-quality report --run-id <new-run-id>
```

  Use a new run id for every check; 0.7.0 refuses to reuse one.
- knownGaps: every slice still carries coverage pressure, because some changed functions are under 80% line coverage (the lowest changed function is 0% in `dispatch-execution.ts`). Mutation runs use the whole runtime suite per mutant, so a slice takes minutes. The April runs `tc-config-overrides-screen` and `tc-quantum-operation-screen` predate 0.7.0 (unbound witnesses, no changed-path digests) and are kept only as history; a public 0.7.0 run with the old 15 s timeout failed closed on the baseline (`tc-quantum-operation-v070-20261006`).
- centralCatalogStatus: entry updated in `../ts-quality/docs/adoption/entries/test-capabilities.json` on 2026-10-06.
- rollback: `npm uninstall ts-quality`, revert `mutations.timeoutMs`, and set adoptionStatus to `paused`; keep this file and the witness README as history. Local run artifacts are ignored and can be deleted.

## Current live slices

| Invariant | Screened test-capabilities file(s) | Witness test | Current status | Notes |
|---|---|---|---|---|
| `operation.kernel.fail-closed` | `src/core/operations/dispatch-execution.ts` | `tests/operation_kernel_contract.test.mjs` | live / supported | Operator-facing aliases `src/core/operations.ts` and `dist/core/operations.js` normalize onto the implementation file so mutation pressure lands on real logic rather than a facade barrel. |
| `healing.collect-files.boundary` | `src/healing/collect-files-core.ts` | `tests/collect_files_contract.test.mjs` | live / supported | Operator-facing aliases `src/healing/collect-files.ts` and `dist/healing/collect-files.js` normalize onto the implementation file so mutation pressure lands on real logic rather than a facade barrel. |
| `operation.quantum.input-envelope.contract` | `src/core/operations/quantum-operation.ts` | `tests/quantum_operation_contract.test.mjs` | live / supported | The slice screens the behavior-bearing quantum operation implementation directly and keeps witness pressure on input validation plus result-envelope shaping rather than the broader simulator layer. |
| `operation.test.config-override.contract` | `src/core/operations/config-targets-core.ts`, `src/core/operations/config-quick-mode-core.ts`, `src/core/operations/config-load-core.ts` | `tests/config_overrides_contract.test.mjs` | live / supported | The facade alias `src/core/operations/config-overrides.ts` normalizes onto a three-file implementation cluster because the override contract is split across load, target routing, and quick-mode shaping. |

## Ready-next slices

No single ready-next slice is declared right now.
This repo should pause widening until one later candidate has a clearly behavior-bearing boundary and one focused witness path that is reviewable on its own.
Do not force another slice just to increase coverage count.
Let the current four-slice set settle before naming another ready-next candidate.

## Candidate later slices

These look worthwhile, but they are less obviously the next best slice than the already-landed rollout set above.

| Area | Likely screened file(s) | Likely witness/evidence | Why later |
|---|---|---|---|
| surf explore operation | `src/core/operations/surf-explore-operation.ts` | `tests/operation_kernel_contract.test.mjs`, `tests/surf_runtime_contract.test.mjs` | Intentionally paused while the surf implementation/runtime choice may still change; do not start this slice until the runtime boundary stabilizes and the witness can stay focused. |
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
