---
summary: "Slice note for S1 and S1b of the 2026-09-07 surf-learnings implementation plan: what each of the seven commits did (healer guard and appliedCount from proven writes, dead runner and test-agent-browser.sh deleted, sourcemap switch, child-coverage proof, import cycle broken with a deep-import regression test, config schema moved to src/core/config.ts, the 0.4.0 removals, quantum and prediction parked), gate outputs (253 -> 259 tests, coverage 85.21 -> 85.18 % lines, 85.54 % with the D1 exclusions), the deep-import proof, dogfood evidence, the peer consultation, the deviations from the plan with reasons, and what S2 must know (node --test does not merge grandchild coverage; c8 or a raw NODE_V8_COVERAGE merge is required)."
read_when:
  - "You pick up slice S2 (quality ratchet) and need the measured post-S1b coverage, the structure facts (zero cycles, 35 modules, oversized files) and the child-coverage merge finding."
  - "You wonder why appliedCount still counts proposals, why the leaf matrix is ORCHESTRATOR_CAPABILITY_MATRIX rather than CAPABILITY_MATRIX, or why the surf-client type exports left with the class."
  - "You need the exact commits, gates and dogfood evidence for S1 and S1b before reverting or building on them."
type: "diary"
---

# Slice S1 and S1b notes (2026-09-07)

Plan: `docs/project/2026-09-07-surf-learnings-implementation-plan.md` §3 S1 and S1b. Tree before the slice: `bf44007`, `npm test` 253 tests / 252 pass / 1 skipped, Node 26.8.1. The other session's uncommitted changes (`AGENTS.md`, `docs/dev/EXTENSION_SOP.md`, `scripts/install-hooks.sh`, the deleted `scripts/docs-list.sh`, the `docs:list` hunks in `package.json`) were never staged; `package.json` was staged through the index-blob method of plan §5 and `git diff -- package.json` after the 0.4.0 commit shows only the other session's hunk.

## Commits

| commit | subject | slice | tests after |
|---|---|---|---|
| `0b50e7a` | fix(heal): prefix-safe re-apply guard and appliedCount from written files | S1 (1) | 257 / 256 pass / 1 skipped |
| `939a8b3` | chore(core): delete the dead command runner and scripts/test-agent-browser.sh; sourcemap switch; child-coverage merge proof (adjudication 41, 42, 55) | S1 (2) | 254 (−5 command-runner cases, +2) |
| `6d99878` | refactor(core): leaf capability-matrix breaks the import cycle with a deep-import regression test; config schema moves to src/core/config.ts (review A18, adjudication 40, 48; D4) | S1 (3) | 257 (+3) |
| `7ce80d3` | test(core): sourcemap contract is self-consistent on either build | S1 follow-up | 257 |
| `664c92b` | feat(api)!: delete SurfFlowBuilder and the SurfClient, Nexus and default exports; 0.4.0 (adjudication 17, 36, 44; D2) | S1b (1) | 257 (−2 builder cases, +2) |
| `30b0cbb` | docs(governance): quantum and prediction rows parked, README and posture truthful (D1) | S1b (2) | 259 (+2) |

Every commit passed `npm run check` (lint, typecheck, node tests, 4 cucumber scenarios), `npm run loop-impact-plan` printed `impact=wide`, and `LOOP_WIDE_REASON="slice S1|S1b commit n" npm run loop-impact-wide` (= `release:check`: check, `truth:gate` ok, `consumer:smoke` ok on the packed tarball) passed. The pre-commit hook's single biome warning (`tests/fixtures/fake-surf.mjs:360` unused `tab` parameter) is pre-existing and untouched.

## What each commit did

### S1 (1) `0b50e7a` healer
- `src/healing/self-healing.ts`: `applyProposalsToContent` accepts a match only as a whole selector token (neither neighbour in `[A-Za-z0-9_-]`; the plan named the trailing boundary, the leading one is the mirrored bug for `btn` inside `my-btn` and costs one comparison). Without a recorded column the first whole-token occurrence on the line is used (`findSelectorTokenColumn`), so `#btn-new ... #btn` still heals the second. The refusal names the longer token: `Expected '#btn' as a whole token but found '#btn-new' (already healed or a longer selector)`.
- `applyProposals` returns `{ written: string[] }`; on a write failure after earlier writes it restores every written file, reports `wrote N of M file(s) before failing: <cause>` plus `Restored N file(s)` or, when a restore fails, `Restore failed for K file(s); healed content remains on disk: ...` (fail closed, never hidden).
- `heal-operation.ts`: `appliedCount` = proposals whose file is in `written`; 0 when nothing was written. `docs/api/api-healing.md` documents the return and the count.
- Tests (`tests/healing_contract.test.mjs` +3, `tests/operation_kernel_contract.test.mjs` +1): `#btn`→`#btn-new` applied twice yields `#btn-new` and the mismatch error with and without a recorded column; longer-token occurrence skipped; partial write failure (second file's directory `0500`) reports `wrote 1 of 2` and restores; through `executeCliOperation` a failed write reports `appliedCount` 0 and the retry 1.

### S1 (2) `939a8b3` dead code, sourcemap switch, child-coverage proof
- Deleted `src/core/operations/command-runner.ts`, `command-runner-core.ts`, `tests/command_runner_contract.test.mjs`, `scripts/test-agent-browser.sh`. The ts-quality screening lane referenced the runner (`.ts-quality/invariants.ts`, `constitution.ts`, `agents.ts`, `witnesses/README.md`, `scripts/screening/ts-quality-common.sh`, `docs/dev/ts-quality-*.md`); those references went with it, the four other screening slices stay.
- `scripts/build.mjs`: `TEST_CAPABILITIES_BUILD_SOURCEMAP=1` adds `sourceMap: true` to the staging tsconfig. Verified: 19 `dist/core/operations/*.js.map` with the switch, 0 after a default build (`publishDist` removes entries the staged dist no longer has); `consumer:smoke` already asserts no `.map` in the pack.
- `tests/child_coverage_merge_contract.test.mjs`: a CLI child (`test --config examples/demo/test-capabilities.yaml --json`) under `NODE_V8_COVERAGE` leaves a precise-coverage entry for `dist/core/operations/test-operation.js` with `runTestOperation` counted (`executeTestOperation` itself is not on the CLI path, count 0; the module's top level, `runSuite`, `summarizeTestResult`, `runTestOperation` are 1).

### S1 (3) `6d99878` cycle break and config schema
- `src/core/capability-matrix.ts` (leaf): `ORCHESTRATOR_CAPABILITY_MATRIX` (agents, intelligence, quantum, chaos) and `validateCapabilityContract(config: RuntimeConfigLike)`; imports only `./config.js` (types) and `./runtime-contract.js`. `src/core/capabilities.ts` composes `CAPABILITY_MATRIX = { orchestrator: ORCHESTRATOR_CAPABILITY_MATRIX, cli: {...} }` (unchanged shape for the passport generator and kernel tests) and re-exports the leaf. `orchestrator.ts` imports the leaf.
- `src/core/config.ts`: `TargetSchema`, `AgentConfigSchema`, `TestCapabilitiesConfigSchema`, all config types, `ParsedTestCapabilitiesConfig`, `RuntimeConfigLike = z.infer<typeof TestCapabilitiesConfigSchema>` (the hand mirror in `capabilities.ts:62-97` is gone, claim 49). Importers updated: `orchestrator.ts`, `config-load-core.ts`, `init-operation.ts`, `config-targets-core.ts`, `config-quick-mode-core.ts`, `operations/types.ts`, `test-operation.ts`, `demo-operation.ts`, `index.ts` (public names unchanged, now sourced from `config.js`). `docs/api/config.md` names the file.
- `tests/deep_import_contract.test.mjs`: (a) `dispatch.js` first in a fresh process; (b) every `dist/**/*.js` (35 modules) first in a fresh process, concurrently; (c) `capability-matrix.js` and `config.js` import nothing under `operations/` and not the orchestrator.

### S1 follow-up `7ce80d3`
The second child-coverage case had read `TEST_CAPABILITIES_BUILD_SOURCEMAP` from the test process, not from the build, and failed when a coverage build was followed by a plain `node --test` (exactly what S2's ratchet will do). It now asserts that a `.js.map` exists exactly for the modules carrying a `sourceMappingURL` comment, on either build.

### S1b (1) `664c92b` removals at 0.4.0
- `src/integrations/surf-client.ts`: `SurfFlowBuilder` and its private `Flow*` types deleted; the file stays internal (S6 deletes it).
- `src/index.ts`: `SurfClient`, `SurfFlowBuilder`, the surf-client type exports, `createNexus`, `NexusOrchestrator`, `NexusConfig` and the default export removed; `createTestCapabilities`, `TestCapabilitiesOrchestrator`, `TestCapabilitiesConfig`, `PredictionEngine`/`QuantumSimulator` exports stay (D1).
- `package.json` 0.3.0 → 0.4.0 (index-blob staging), `package-lock.json` (two top-level version fields), passport `package_version`.
- `scripts/consumer_contract_smoke.mjs`: on the packed tarball, `import * as packageRoot` and every removed name asserted absent, `VERSION === "0.4.0"`, `createTestCapabilities(...) instanceof TestCapabilitiesOrchestrator`.
- Passport generator: `library:SurfClient` row removed. `tests/surf_client_contract.test.mjs` imports the internal module and `core/surf-runtime.js`, builder cases deleted.
- Docs: README row 25 (the `src/` component row; README had no SurfClient row) and the new "Changes in 0.4.0" section with every removed symbol and its replacement; `docs/api/api-reference.md`, `api-surf.md` ("Status at 0.4.0" header, method reference kept as the shape `Session` will carry), `types.md`, `patterns.md`, `errors.md:167`, `docs/TEST-CAPABILITIES-README.md`, `docs/LLM-TESTING-GUIDE.md`, `docs/DECISION-MATRIX.md`, and `examples/test-capabilities-test.ts` (three SurfClient examples dropped, import fixed to the real package name). `docs/api/errors.md:213-236` still documents the internal `Unsupported SurfClient config option` error because `tests/docs_runtime_contract.test.mjs` requires the string and S3 rewrites `errors.md`.

### S1b (2) `30b0cbb` parked rows (D1)
- Generator: `cli:quantum`, `library:QuantumSimulator`, `library:PredictionEngine` → `support_state: parked` with one shared note per family ("produces no target evidence; must never write a Finding or Observation; never influences TestResult.passed or the run determination; dist/quantum|prediction/** excluded from the coverage floor"); `verification_state` stays `verified` because the simulator and collector tests really run. The library loop honours a per-entry `supportState`.
- README: the `quantum` row left "Implemented today" for a new "Parked (present, tested, not testing capabilities)" table with the prediction and quantum library APIs; the Commands example is annotated. `product-posture.md` one-sentence posture, Intelligence, Sensors, Packaging rows, strengths, follow-up 9 and the authority map (`capability-matrix.ts`, `config.ts`); `api-reference.md`, `api-quantum.md`, `api-prediction.md`, `cli.md` carry the parked status (cli.md's status table keeps `implemented` for the route because it mirrors the manifest that S10's contract-sync compares).
- Tests: `capability_passport_contract` (three parked rows, note wording, `cli:test` still supported, no SurfClient row, `package_version` 0.4.0), `docs_runtime_contract` (+2 cases).

## Proofs and measurements

- Deep import: `node -e "import('./dist/core/operations/dispatch.js')"` threw `Cannot access 'CLI_ROUTE_MANIFEST' before initialization` at `bf44007`; exits 0 with `deep import ok` from `6d99878` on. The deep-import contract test covers all 35 runtime modules.
- Structure prototype (scratch DFS over runtime imports in `dist/`, the S2 shape): at `939a8b3` 35 modules, 55 edges, 1 cycle (`capabilities → operations → dispatch → dispatch-core → dispatch-execution → dispatch-manifest → demo-operation → orchestrator → capabilities`); from `6d99878` on 35 modules, 59 edges, 0 cycles.
- Coverage (sourcemap build, `node --test --experimental-test-coverage --test-coverage-include='dist/**/*.js' tests/*.test.mjs`, Node 26.8.1): baseline 85.21 / 79.11 / 85.69 (lines / branches / functions); after S1 84.95 / 78.75 / 85.53; after S1b 85.18 / 78.97 / 86.24 over 34 reported files; with `--test-coverage-exclude='dist/quantum/**' --test-coverage-exclude='dist/prediction/**'` (D1) 85.54 / 79.02 / 87.09. Notable rows after S1b: `surf-client.js` 65.70 / 52.21 / 47.76, `index.js` functions 0.00 (`createTestCapabilities` is exercised only by the packed-consumer smoke, not by `npm test`), `capability-matrix.js` 94.03, `config.js` 93.28.
- Child-coverage merge: **`node --test --experimental-test-coverage` on Node 26.8.1 does not merge grandchild coverage.** `dist/core/operations/test-operation.js` is absent from the report and the lcov (0 `SF:` entries) although the CLI children inherit `NODE_V8_COVERAGE` (the contract test proves the inherited directory receives an entry with `runTestOperation` counted; a plain `NODE_V8_COVERAGE=<dir> node --test tests/child_coverage_merge_contract.test.mjs tests/cli_fail_closed_contract.test.mjs` leaves 42 coverage files, 31 of them naming `test-operation.js`). A one-file experiment (a test spawning a child that imports `test-operation.js`) confirms the runner ignores it. Per the plan's S1 acceptance clause, **S2's ratchet command must switch to `c8`** (or merge the raw `NODE_V8_COVERAGE` directory itself) rather than the built-in reporter; the numbers above therefore understate `operations/` by the child-only module.

## Dogfood

The plan lists no dogfood for S1 or S1b; no browser was touched. Non-browser evidence through the real CLI (`bin/test-capabilities` on the built 0.4.0 dist, scratch directory):
- `heal --dry-run` on `#old-login` / `#old-login-form` on one line proposes both; `heal --checkpoint-ref demo/ckpt-1` applies 2 (`Applied 2 healing proposal(s).`), the file reads `#login` / `#login-form` (column-ordered application, no prefix damage).
- Re-apply guard: a dry-run proposal artifact edited to `#old-login → #old-login-new` (reviewed, `requiresReview: false`) applied with `--proposal-input` once (`Applied 1`); the second apply from the same artifact is refused, exit 1, `Healing proposal selector mismatch at ...sample.test.ts:1:49. Expected '#old-login' as a whole token but found '#old-login-new' (already healed or a longer selector).`, file unchanged.
- `consumer:smoke` on the packed 0.4.0 tarball: removed names absent, `VERSION` 0.4.0, orchestrator, kernel, init, demo and the root-cause invariants green (run in every wide gate).

## Peer consultation

One question to `openai-codex/gpt-6-astra` (`pi -ne -nc -nt`), on the `appliedCount` semantic (plan: `written.length`, i.e. files; existing kernel test: 2 for two proposals in one file). Answer: keep the proposal count derived from proven writes for 0.4.0, document the deliberate deviation, define `appliedCount` explicitly, and make S5's switch to receipt counts an explicit contract migration; it notes the assumption that a proven file rewrite means all of that file's proposals were applied (true here: `applyProposalsToContent` is all-or-nothing per file). **Adopted**: implemented as recommended, documented in `docs/api/api-healing.md`; S5 owns the migration to per-file `applied` receipts.

## Deviations from the plan, with reasons

1. `appliedCount` counts proposals whose file was proven written, not `written.length` (files): keeps the documented/tested envelope semantic at 0.4.0 while still deriving from proven writes; S5 redefines it as `applied` receipts (see the consultation).
2. The leaf exports `ORCHESTRATOR_CAPABILITY_MATRIX`; `CAPABILITY_MATRIX` stays composed in `capabilities.ts`. The CLI half (command and surf-action statuses) is derived from the route manifest under `operations/`, so it cannot live in a module that imports nothing under `operations/` without a second source of truth. Consumers (`index.ts`, passport generator, kernel tests) see the same shape.
3. The healer guard checks the leading boundary too (`btn` inside `my-btn`), and without a column searches for the first whole-token occurrence instead of failing on the first substring.
4. The surf-client type exports (`SurfConfig`, `SurfSnapshot`, ..., `SurfFrameDiagnosis`) left `index.ts` with the class: types for an unexported class are a half-removed API, which plan §6 forbids at 0.4.0. `createTestCapabilities` stays (documented factory; claim 44 lists it as unused but the plan's removal list does not name it).
5. The ts-quality screening files, `.ts-quality/*` and `docs/dev/ts-quality-*.md` were edited to drop the command-runner slice (not in the plan's file list; required by the deletion).
6. An extra commit `7ce80d3` fixed the sourcemap test's env-dependence found by the scratch coverage run.
7. `docs/api/api-quantum.md`, `api-prediction.md`, `cli.md`, `errors.md`, `patterns.md`, `types.md`, `docs/TEST-CAPABILITIES-README.md`, `LLM-TESTING-GUIDE.md`, `DECISION-MATRIX.md` and `examples/test-capabilities-test.ts` were made truthful about the removals/parking beyond the plan's named docs, because they advertised the removed names.
8. README "row 25" had no `SurfClient` mention; the `src/` component row was rewritten for the parked simulator/engine instead.
9. No `diary/` file: this note is the slice diary at the path the operator asked for.

## What S2 must know

- Floors to measure on `30b0cbb` with the D1 exclusions: 85.54 % lines / 79.02 % branches / 87.09 % functions on Node 26 with the built-in reporter, but the built-in reporter misses child-only modules; measure again with `c8` (add it as a devDependency) so `test-operation.js` gets a record instead of an unrecorded 0 %.
- Structure: 35 runtime modules, 0 cycles, `allowed_cycles: []` holds. Oversized files (>700 lines) on this tree: `src/core/orchestrator.ts` (about 2,190 lines after the schema move), `src/integrations/surf-client.ts` (about 860 lines until S6), `src/healing/self-healing.ts` (about 800 lines) — measure exactly for `structure-budget.json`.
- Never-imported check: every `src/**` module is reachable from `src/index.ts` or `bin/test-capabilities`; `operations/types.ts` compiles to `export {}` and is type-only (exempt); `capability-matrix.ts` and `config.ts` are the ring-rule leaves that must import neither `node:fs` nor `node:child_process`.
- The passport byte check will see `governance/capability-passport.json` regenerated at `30b0cbb`; `scripts/generate-capability-passport.mjs --stdout` equals it.
- `package.json` still carries the other session's uncommitted `docs:list` hunk; keep using the index-blob staging for the S2 script entries.
- Coverage build: `TEST_CAPABILITIES_BUILD_SOURCEMAP=1 npm run build` then the test run; a default `npm run build` afterwards clears the maps.
