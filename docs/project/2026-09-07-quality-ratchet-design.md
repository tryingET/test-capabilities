---
summary: "Design packet for a fail-closed quality ratchet in test-capabilities: coverage floors that start at measured truth and only rise, a changed-lines gate held to the lines floor (not a fixed target), a never-loaded-module check, a contract-sync check (passport, CLI help/route manifest, JSON schemas), a file-size budget and a runtime import-cycle check with one ledger shape for every relaxation, wired into scripts/quality-gate.sh and CI; plus the TIP candidate for the org copier template. Refined with the many-of-the-greats adjudication."
read_when:
  - "You implement or review the coverage ratchet, changed-lines gate, contract-sync, structure budget or cycle check in this repo."
  - "A gate blocks your commit and you need to know how a floor reduction or a budget exception is approved."
  - "You decide what of this moves into copier/tpl-project-repo instead of living here."
type: "design"
---

# Quality ratchet design (2026-09-07)

Row 4 of `docs/project/2026-09-07-surf-learnings-assessment.md:27`. Source mechanisms: pic's `scripts/check-coverage.ts`,
`scripts/check-structure.ts`, `coverage-ratchet.json` and `.github/workflows/ci.yml` in the archived clone
`~/ai-society/softwareco/contrib/pic/` (Apache-2.0; any borrowed code keeps the licence header and a `derived from` note,
as the Pi spike did in `contrib/docs/learnings/2026-09-06-pic-execution.md:98-100`). No code changes in this packet.

## Problem

- The repo's posture is "fail closed, verify with deterministic checks, then widen" (`docs/project/product-posture.md:11`),
  but the gate that every commit passes checks lint, types and test pass/fail only (`scripts/quality-gate.sh:108-125`).
  Nothing stops a change from shipping untested code, and nothing records how much of `src/**` is exercised.
- Measured on the current tree with Node's built-in coverage (253 tests, 252 pass, 1 skipped, 4.15 s): lines 85.18 %
  (6175/7249), branches 78.92 % (1456/1845), functions 85.36 % (519/608). Weakest modules: `src/integrations/surf-client.ts`
  66.39 % lines / 48.10 % functions, `src/healing/self-healing.ts` 73.88 %, `src/core/bombadil-runtime.ts` 75.12 %,
  `src/prediction/engine.ts` 77.64 %. Three runtime modules are never loaded by the suite
  (`src/core/operations/command-runner.ts`, `test-operation.ts`, `types.ts`) and therefore do not appear in the report at
  all — an invisible 0 %, which is the exact silent-false-negative shape the assessment warns about.
- Structure, measured with a scratch prototype of pic's algorithm: five files exceed pic's 700-line default
  (`src/core/orchestrator.ts` 2293, `src/integrations/surf-client.ts` 1020, `src/core/surf-runtime.ts` 1006,
  `src/core/operations/surf-explore-operation.ts` 842, `src/healing/self-healing.ts` 741) and there is one runtime import
  cycle: `capabilities.ts -> operations.ts -> operations/dispatch.ts -> dispatch-core.ts -> dispatch-execution.ts ->
  dispatch-manifest.ts -> demo-operation.ts -> orchestrator.ts -> capabilities.ts`. The posture already names the
  kernel-as-bottleneck risk (`docs/project/product-posture.md:42`); today nothing measures it.
- Contract drift is only partly guarded: the passport byte-identity check lives in the release gate
  (`scripts/capability-truth-gate.mjs:1050-1057`), not in `npm run check`; the CLI is defined by hand in commander
  (`bin/test-capabilities:105-482`, eleven commands) next to a separate route manifest
  (`src/core/operations/dispatch-manifest.ts:23-34`), and `docs/api/cli.md:294-296` claims they mirror each other while the
  test only greps a fixed list of phrases (`tests/docs_runtime_contract.test.mjs:23-50`); the two JSON schemas under
  `schemas/` are hand-written next to the zod source (`src/core/replacement-validation.ts:40,72,101`) and the contract
  test asserts their shape, not their equivalence (`tests/replacement_validation_membrane_contract.test.mjs:49-70`).
- What pic measured (`contrib/docs/learnings/2026-09-06-pic-deep-dive.md:109-110,141`): floors 95/90/98/95 with a 98 %
  changed-lines target; `npm run check` including structure and contract checks in 7.5 s
  (`2026-09-06-pic-execution.md:40`); the all-files-in-parallel instrumented run wedged at 13 m 16 s on this workstation
  while CI's one-file-per-job matrix took 7.5 s per file (`2026-09-06-pic-execution.md:127-129`) — the coverage *design*
  was sound, the *harness parallelism* under instrumentation was the hazard.

## Placement

All four mechanisms live in this repo: `scripts/quality-gate.sh` stages, three small scripts under `scripts/quality/`,
two committed baseline files, and the CI workflow. They are generic and belong in the org template afterwards (see
"TIP candidate"). They do not touch the runtime under `src/**`; the only `src` edits they will force are deliberate
(breaking the cycle, splitting oversized files), each as its own commit.

## Current state

- Stages: `pre-commit` = lint; `pre-push` and `ci` = lint + typecheck + tests (`scripts/quality-gate.sh:108-125`); hooks
  are installed by `scripts/install-hooks.sh` and call these stages (`.githooks/pre-commit`, `.githooks/pre-push`).
  `npm run check` = `quality:ci` (`package.json:50-51`); `release:check` adds `truth:gate` and `consumer:smoke`
  (`package.json:58`); GitHub CI runs `release:check` on PR, push and nightly (`.github/workflows/ci.yml:48,73,99`);
  the GitLab pipeline only validates the ontology and is `allow_failure: true` (`gitlab/ci/rocs.yml:9`).
- Tests: `node --test tests/*.test.mjs` after a build (`package.json:62`, `scripts/quality-gate.sh:90-94`); tests import
  and spawn the built `dist/**` via `tests/helpers/runtime-dist.mjs:7-27`; 29 spawn sites exercise the CLI as a child process.
- Coverage today: no script in `package.json` produces coverage for the gate. The ts-quality screening wrapper already
  uses Node's built-in `--experimental-test-coverage --test-reporter=lcov` (`scripts/screening/ts-quality-check.sh:22`)
  and remaps `dist/**` back to `src/**` (`scripts/screening/remap-lcov-to-src.mjs`, consumed via
  `ts-quality.config.json:5`). Because `tsconfig.json:8` sets `sourceMap: false` and the build inherits it
  (`scripts/build.mjs:135-152`), the remap always takes the name-only fallback (`remap-lcov-to-src.mjs:171-176,274-277`):
  `dist` line numbers are attributed to `src` files. That is good enough for ts-quality's per-file ratios but wrong for a
  changed-*lines* gate. `vitest` is a devDependency (`package.json:116`) that no script invokes.
- Tool choice: **Node's built-in coverage**, not c8 and not vitest. Reasons: it is what the harness already runs
  (`node --test`, `package.json:62`), it is already in use in this repo (screening), it adds no dependency, it supports
  lcov output plus include/exclude globs and floor flags on Node ≥ 22 (`.nvmrc` = 22, `engines >= 22` at
  `package.json:41`), and child processes inherit `NODE_V8_COVERAGE` so the CLI spawns are merged — to be proven in the
  dogfood step, with c8 as the fallback if they are not. vitest would mean a second harness; c8 buys nothing the built-in
  lacks here except its own reporters.

## Contract

Files (committed, formatted by Biome, JSON):

- `coverage-baseline.json` (repo root, next to `ts-quality.config.json`):
  `{"schema_version":1,"node_major":22,"floors":{"lines":85.18,"branches":78.92,"functions":85.36},
  "measured":{"commit":"<sha>","tests":253},"reductions":[]}`. Floors are the last measured values rounded down to two
  decimals. `reductions` is an append-only ledger: `{"metric","from","to","reason","ref"}` with a non-empty `reason` and
  an AK task or commit `ref`. *Revised by refinement:* there is no `changed_lines_min` field; the changed-lines
  requirement is `floors.lines` and rises with it (Clash 1 — a fixed 95 % is a target above demonstrated truth).
- `structure-budget.json`: `{"schema_version":1,"default_max_lines":700,"exceptions":{"src/core/orchestrator.ts":2293,…},
  "allowed_cycles":[],"ledger":[]}`. The initial file lists exactly the five files; the one cycle measured above is
  broken before the gate lands by a leaf `src/core/capability-matrix.ts` holding the agent/intelligence statics that
  `orchestrator.ts` imports, so `capabilities.ts` only computes CLI statuses (revised by architecture review: A18, Q4). *Revised by refinement:* exceptions may shrink or disappear
  freely; adding or growing an exception, or adding an allowed cycle, requires a `ledger` entry
  `{"file"|"cycle","from","to","reason","ref"}` in the same commit — the same shape and rule as a floor drop (Clash 3:
  a block on a 2293-line file with no fix path is a wall, the ledger is the fix path; this also repairs the earlier
  contradiction between "may only shrink" and "the same rule applies to adding an exception").

Scripts (`scripts/quality/`, ESM, Node-only, no new runtime dependency):

- `coverage-ratchet.mjs [--raise]`: builds via `npm run build --silent`, runs
  `node --test --experimental-test-coverage --test-coverage-include='dist/**/*.js' --test-coverage-exclude='dist/quantum/**' --test-coverage-exclude='dist/prediction/**' --test-reporter=lcov
  --test-reporter-destination=coverage/lcov.raw.info tests/*.test.mjs`, remaps to `src/**` through
  `scripts/screening/remap-lcov-to-src.mjs` (which becomes exact once the coverage build emits source maps, see Open
  questions), then: (1) every `src/**/*.ts` module must be reachable in the import graph from `src/index.ts` or
  `bin/test-capabilities` (the graph `check-structure.mjs` builds), a module nothing imports fails with
  `module never imported`, and the child-process coverage merge is proven before any floor is set so a module exercised
  only in child processes (`test-operation.ts`) is never a false finding (revised by adjudication: claim 42; the earlier
  "never loaded" baseline was one dead barrel, one `export {}` and one child-only module); a
  type-only module (zero executable lines) is not a finding; *revised by refinement:* there is no exception list for
  this check — it is the one signal that cannot be gamed, and an exception would hollow it; (2) each measured metric
  must be ≥ floor − 0.005; (3) changed executable lines (below) must be ≥ `floors.lines` % (*revised by refinement:*
  was a fixed `changed_lines_min` of 95); (4) the working-tree baseline is compared to
  `git show HEAD:coverage-baseline.json` and any lowered floor without a matching `reductions` entry fails;
  (5) `--raise` rewrites floors upward to the measured values and refuses on a Node major other than `node_major`.
- Changed lines: `git diff --unified=0 <base> -- src` parsed as pic does (`check-coverage.ts:88-124`), where `<base>` is
  `COVERAGE_BASE` if set, else `HEAD` when the tree is dirty, else `HEAD^`. Unlike pic (`check-coverage.ts:53-54`,
  which silently skips a changed file that has no coverage record) a changed file with no record counts as 0 % covered.
  Lines present in the diff but not executable per lcov are ignored, as in pic (`check-coverage.ts:57-59`). The
  uncovered changed `file:line` list is printed on every run, pass or fail (*revised by refinement:* the list, not
  the percentage, is the output a reviewer acts on, and it is the target list for screening's mutation lane).
- `check-structure.mjs`: line budgets, a runtime-import cycle detector, the never-imported check, and the ring rule:
  the named pure-ring modules (`result-classification.ts`, `error-codes.ts`, `config.ts`, `frame-root-cause.ts`,
  `determination.ts`, the type half of `effects.ts`) import neither `node:fs` nor `node:child_process` (revised by
  adjudication: Part 2 Clash 4). Floors are measured only after the 0.4.0 removals so the ratchet never memorises
  deleted code (claim 13); `dist/quantum/**` and `dist/prediction/**` are excluded from the coverage include because
  under operator decision D1 they stay in the runtime as parked, read-only code that produces no target evidence. Import edges are extracted with a
  regex over `import … from "./x"`, `export … from "./x"` and `import("./x")`, skipping `import type` / `export type`
  and type-only named specifiers; pic uses the TypeScript AST for this (`check-structure.ts:22-76`) but this repo has
  only `tsgo`, which exposes no compiler API. Cycle detection is pic's DFS (`check-structure.ts:78-108`).
- `check-contract-sync.mjs`: (a) `node scripts/generate-capability-passport.mjs --stdout` byte-equal to
  `governance/capability-passport.json` (moved here from the release gate, which keeps calling it; this one check ships with the first ratchet commit, ahead
  of the rest of contract-sync, revised by adjudication: Part 4 S2); (b) the commander
  command set from `bin/test-capabilities --help` equals the name set of `CLI_ROUTE_MANIFEST`, and each `status` in the
  manifest equals the status column of the table under `docs/api/cli.md:294`; every subcommand `--help` is captured into
  `docs/api/cli-help.generated.md` (Biome ignores `*.generated.*`, `biome.jsonc:20`) and must be byte-equal to the
  committed file; (c) `schemas/*.schema.json` byte-equal to a deterministic generator from the zod definitions; (d) the `CliRoute` and
  `CliOperationResult` unions rendered in `docs/api/types.md` equal `src/core/operations/types.ts` (revised by
  architecture review: A20).

Stages and exact commands (`scripts/quality-gate.sh`):

| stage | adds | command | budget |
|---|---|---|---|
| `pre-commit` | structure | `node scripts/quality/check-structure.mjs` | < 1 s, no build |
| `pre-push`, `ci` | contract-sync, coverage | `node scripts/quality/check-contract-sync.mjs && node scripts/quality/coverage-ratchet.mjs` | + ~6 s after the existing tests |
| new `structure`, `contract-sync`, `coverage` | single-stage entry points, added to `usage()` (`quality-gate.sh:9-11`) | as above | — |

`package.json` gains `structure:check`, `contract:sync`, `coverage:ratchet`, `coverage:raise`; `loop-impact-plan`'s
wide-trigger regex (`package.json:85`) gains `coverage-baseline\.json|structure-budget\.json|scripts/quality/`.
CI (`.github/workflows/ci.yml`): `fetch-depth: 0` on the smoke and full jobs and
`COVERAGE_BASE: ${{ github.event.pull_request.base.sha || github.event.before }}` as in pic's `ci.yml:130-133`;
no matrix is needed at 4 s total. The GitLab include stays as is.

Approving a legitimate drop: edit `coverage-baseline.json` in the same commit as the code, lower the floor, append a
`reductions` entry with the reason and the AK ref, and name the file in the commit subject
(`quality: lower lines floor 85.18→84.90 (delete prediction engine, AK #…)`). The gate then passes; without the ledger
entry it fails with `floor lowered without a reductions entry`. The same rule and message shape apply to adding or
growing a `structure-budget.json` exception or allowed cycle (`exception grown without a ledger entry`). A ledger entry with a
missing `ref` fails; an unresolvable AK ref warns; this check is independent of `TEST_CAPABILITIES_REQUIRE_AK_DIRECTION`
(revised by architecture review: A15). Raising a
floor, shrinking an exception or removing a cycle needs no ledger entry.

What the ratchet claims and what it does not (*added by refinement*): the floors are a memory of what the fixture
corpus has demonstrated and a promise that no commit leaves the tree less exercised than it was. They are not evidence
about behaviour against a real surf or bombadil binary: `npm test` drives the runtime through the fake surf fixture and
a fake bombadil script, so coverage of `src/integrations/surf-client.ts` or `src/core/bombadil-runtime.ts` measures the
fakes' fidelity. Real-binary truth stays with `capability:drill`, `bombadil:smoke`, `test:runtime` and the passport
evidence; nothing in this packet moves it.

## Behaviour and failure modes

- Every failure is a non-zero exit with one line per finding and no partial pass; output lists metric, measured,
  floor and the gap, and every finding names its fix path (`raise coverage`, `append a reductions entry`, `append a
  structure ledger entry`, `add a loading test`). The changed-lines block prints `changed-lines: <covered>/<coverable>
  (<pct> %), floor <floors.lines> %` followed by the uncovered `file:line` list on every run, green or red
  (*revised by refinement*).
- Missing prerequisites fail closed with the same message shape as the existing typecheck stage
  (`quality-gate.sh:56-68`): no `dist/` build, no `git` base ref, a `node_major` mismatch when `--raise` is used, an
  unparseable baseline, a baseline whose floors exceed the measured values by more than the tolerance because someone
  hand-edited them upward.
- The changed-lines gate is skipped only when the diff against base contains no `src/**` executable lines; it prints
  `changed-lines: no executable src changes` rather than silently passing.
- Coverage and contract-sync never run in `pre-commit`: they need a build and would double commit latency. Structure does.
- The ledger cannot be used to pre-approve future drops: an entry must name the exact `from` and `to` of the floor change
  in the same commit. The same holds for structure ledger entries.
- A changed-lines red is never about a number the tree has not itself demonstrated: the requirement equals
  `floors.lines`, so a change is held to the repo's own standard, and the only way to demand more of new code is to
  raise the floor for all code (*added by refinement*).

## Non-goals

- Mutation score and per-file CRAP thresholds: `ts-quality` screening owns those (`ts-quality.config.json:13-17`).
  *Sharpened by refinement:* the division of labour has a dependency, not just a boundary. Screening runs mutation with
  `coveredOnly: true`, so the coverage gate is the substrate that decides which changed lines the outcome measure can
  examine at all; the gate's printed uncovered-line list is exactly mutation's blind spot. The gate proves execution,
  screening proves detection; neither is presented as the other.
- Per-file coverage floors, branch-level changed-lines gating, coverage of `scripts/**` and `bin/test-capabilities`
  (the CLI file has no `.js` extension and is outside `dist/**`; it is exercised but not measured in v1).
- Coverage from the real-binary lanes (`bombadil:smoke`, `capability:drill`, `test:runtime`): they stay outside `npm test`.
- Replacing the docs regex tests in `tests/docs_runtime_contract.test.mjs`; contract-sync adds a stricter check beside them.
- Splitting `orchestrator.ts` beyond the pure move of its four agent classes into `src/core/agents/*.ts` (one commit
  before the classification consumers land; revised by architecture review: A19): the budget file freezes the remaining
  size; further splits are separate commits with their own AK tasks. Breaking the runtime cycle is no longer a non-goal
  (A18): it is broken before the gate lands.

## Risks

- Flaky coverage from real-browser tests: not a risk in this suite — `npm test` uses the fake surf fixture (commit
  `ab34937`) and no browser; pic's wedge came from ~15 instrumented headless Chromes in parallel
  (`2026-09-06-pic-execution.md:127-129`). The equivalent risk here is environment-dependent skips: one test is skipped
  today and `convex_runtime_contract_enforcement` runs only with `RUN_CONVEX_RUNTIME_TESTS=1`
  (`scripts/run_ci_targeted_tests.mjs:19-22`); such tests must not be in the default corpus or the floor moves with the env.
- Goodhart pressure on the changed-lines gate (*added by refinement*): the authors under this gate are mostly language
  models, and the cheapest way past a changed-lines red is a test that executes the uncovered branch without asserting
  on it — disproportionately the timeout, retry and malformed-input branches, and most of all in the integration modules
  whose only double is a fake. Mitigations, in order of weight: the requirement is the tree's own `floors.lines`, not
  a target above it; the uncovered list is shown rather than hidden behind a percentage; detection is measured by
  screening's mutation lane, not by this gate; and reviewers treat a coverage-only test on `surf-client.ts` or the
  bombadil runtime as a fixture-echo until the drill lane says otherwise.
- V8 coverage differs across Node majors; the workstation runs v26.8.1, CI runs 22 (`.nvmrc`). Floors are enforced on
  every major; raising is limited to `node_major`. The dogfood step measures the v22/v26 delta before the floor is set.
  *Contingency added by refinement:* if the delta exceeds the 0.005 tolerance on the same tree, `floors` becomes a map
  keyed by Node major (`"floors":{"22":{…},"26":{…}}`), each raised only on its own major, so the workstation never sees
  a red that CI would not — a red that is about the machine trains bypass (Clash 3).
- Generated-file churn (*added by refinement*): `docs/api/cli-help.generated.md` diffs on every commander description
  edit. Accepted: the diff is the point of a one-authoritative-source check, and it is regenerated, never hand-edited.
- Timing-dependent branches (spawn timeouts, retry loops) can flip a handful of lines between runs; the 0.005 tolerance
  does not absorb that, and the answer is to make such tests deterministic, not to widen the tolerance.
- CI time: +~6 s on a job dominated by `npm install`; `fetch-depth: 0` adds a few seconds of clone.
- Regex import extraction can miss exotic forms (multi-line `import type {` blocks with a trailing runtime specifier);
  the failure direction is a missed edge, i.e. a missed cycle, never a false block. Reviewed as an open question.
- The schema generator may not reproduce the hand-written `$defs` naming; see Open questions.

## Verification and dogfood plan

1. Baseline: run `coverage:ratchet --raise` on the current tree under Node 22 and Node 26; record both; commit the
   Node 22 numbers as the floors (expected near 85.18 / 78.92 / 85.36) and the 253-test count.
2. Child-process merge proof: add a temporary `console.log` to a CLI-only path in `dist/`, confirm the line shows hits in
   `coverage/lcov.raw.info`; if not, switch the command to `c8` and record the decision.
3. Never-loaded modules: confirm the gate fails on the current tree for the unloaded modules with executable lines
   (`command-runner.ts`, `test-operation.ts`; `types.ts` only if it compiles to executable lines), then add loading tests
   for them in the same commit as the gate (*revised by refinement:* no exception list exists for this check).
4. Synthetic drop: comment out one test file, run the gate, expect `lines fell below floor`; restore. Then lower a floor in
   the baseline without a ledger entry, expect `floor lowered without a reductions entry`; add the entry, expect pass.
5. Changed-lines: add an untested `if` branch to `src/core/capabilities.ts` in the working tree, expect the gate to name
   the file:line and report the percentage against `floors.lines`; add a test, expect pass with the (now empty)
   uncovered list still printed; revert. Then create a new `src/**` module with no test, expect `0 %` for that file.
6. Structure: run on the current tree, expect exactly the five exceptions and one cycle from the committed budget file;
   grow one exception by one line, expect `exception grown without a ledger entry`; add the ledger entry, expect pass;
   revert.
7. Contract-sync: hand-edit `docs/api/cli.md` status of `predict`, expect failure; remove a commander command, expect
   failure; regenerate the passport, expect pass.
8. Record all of the above in a diary entry with timings for each stage and the CI run link.

## Open questions

- Source maps: turn on `sourceMap` for the coverage build only (a staging tsconfig override in `scripts/build.mjs:135-152`
  or a `TEST_CAPABILITIES_BUILD_SOURCEMAP=1` switch) or globally in `tsconfig.json:8`? Maps in `dist/` would ship in the
  npm package (`package.json:32-39` includes `dist/`) unless filtered.
- Schema equivalence: is a `zod-to-json-schema` devDependency acceptable, and can it reproduce the committed
  `$defs`/`required` shape? Fallback: keep the schemas hand-written and prove equivalence by running the zod schema and a
  minimal JSON-schema validator over the shared fixture corpus.
- Should the passport byte-identity check stay duplicated in `truth:gate`, or should the release gate call
  `check-contract-sync.mjs`?
- Closed by refinement: the changed-lines level (it is `floors.lines`, no separate number, no "raise after a month");
  the never-loaded modules (tests, no exceptions).

## TIP candidate (org template)

`.copier-answers.yml:1` points to `~/ai-society/softwareco/copier/tpl-project-repo`; this repo was generated with
`language: typescript`, `enable_software_pack: false`. The template's `package.json.j2:7-11` ships only `test`, `lint`,
`format`; `scripts/quality-gate.sh` is repo-local. Propagate: the stage skeleton of `quality-gate.sh` (lint / typecheck /
tests / structure / contract-sync / coverage), `scripts/quality/check-structure.mjs` and `coverage-ratchet.mjs`
unchanged, both baseline files with empty exceptions and floors of 0 (the first `--raise` sets them), and the CI env
wiring — rendered only when `enable_software_pack` and `language in (node, typescript)` (`copier.yml:48-52,110-112`).
Keep here: `check-contract-sync.mjs` (passport generator, commander/manifest pairing, schema generator are this repo's
surfaces), the budget exceptions and the allowed cycle.

## Decision log

- 2026-09-07: Node built-in coverage over c8/vitest (already the harness, already used by screening, no new dependency).
- 2026-09-07: Two committed baseline files with append-only ledgers, not env-var overrides; drops are approved in the
  commit that lowers the floor.
- 2026-09-07: A changed file with no coverage record counts as 0 % (fail closed), diverging from pic.
- 2026-09-07: Structure check in `pre-commit`; coverage and contract-sync in `pre-push`/`ci` only.
- 2026-09-07: Existing oversized files and the one cycle are frozen as exceptions, not fixed in this work.
  *Revised by architecture review (A18, Q4):* the cycle is broken before the gate lands (leaf `capability-matrix.ts`) and
  `allowed_cycles` starts empty; only the five oversized files are frozen, and `orchestrator.ts` shrinks by the agent
  extraction (A19) before it is measured.
  *Revised by refinement:* frozen, but not walled — an exception may grow or be added through a `structure-budget.json`
  ledger entry with `from`/`to`/reason/ref in the same commit, the same mechanism as a floor drop. Reason: a
  stop-the-line with no fix path is bypassed, not obeyed (Clash 3), and the earlier text contradicted itself.
- 2026-09-07: Generic scripts go to the copier template after one dogfood cycle here; contract-sync stays repo-local.
- 2026-09-07, *revised by refinement:* no fixed changed-lines target. The changed-lines requirement equals
  `floors.lines` and rises with the ratchet; `changed_lines_min` is removed from the baseline. Reason: 95 % on a tree
  that demonstrates 85 % is a target above truth aimed at the lines most cheaply executed and least meaningfully verified,
  under authors who are mostly language models, in a corpus whose integration doubles are fakes (Clash 1, Clash 5).
- 2026-09-07, *added by refinement:* the never-loaded-module check has no exception list; it is the one Goodhart-proof
  signal in the packet and the three known modules get loading tests in the first commit.
- 2026-09-07, *added by refinement:* the uncovered changed `file:line` list is printed on every run, not only on failure;
  the gate proves execution, screening's mutation lane proves detection, and the packet states that dependency.
- 2026-09-07, *added by refinement:* the ratchet is a floor on the fixture corpus and is not evidence about real-binary
  behaviour; that claim stays with the drill/smoke lanes and the passport.
- 2026-09-07, *revised by architecture review (A15):* the ledger `ref` check is its own rule (missing fails, unresolvable
  warns) and does not inherit the truth gate's `TEST_CAPABILITIES_REQUIRE_AK_DIRECTION` optionality.
- 2026-09-07, *revised by architecture review (A20):* contract-sync also checks the `CliRoute`/`CliOperationResult`
  unions in `docs/api/types.md`, the drift the review found in the current tree.
- 2026-09-07, *revised by adjudication (claims 13, 42; Part 2 Clash 4; Part 4 S2):* never-loaded becomes never-imported
  over the import graph; the child-coverage merge is proven before any floor; floors are measured after the 0.4.0
  removals; the passport byte check lands in the first ratchet commit; the pure/mediated ring boundary is a structure
  rule.
- 2026-09-07, *revised by adjudication (claim 49; operator decisions D1, D4):* `RuntimeConfigLike` is derived from the
  kernel config schema (no hand mirror); if any mirror survives, contract-sync covers it; `dist/quantum/**` and
  `dist/prediction/**` are excluded from the floor as parked code.

## Refinement (many-of-the-greats)

## QUESTION

Should this repo enforce code quality by a one-way ratchet — committed floors for line/branch/function coverage, file-size
budgets and allowed import cycles that start at the measured truth and may only rise, with every lowering recorded in an
append-only ledger in the same commit — or by fixed thresholds imported from elsewhere (pic's 95/90/98/95), by reviewer
judgement, or by outcome-based measures (mutation score)? And, inside that: is a hard changed-lines gate at a fixed 95 %
the correct primary signal for a fail-closed *testing* framework whose measured corpus (`npm test`, 27 files, 253 tests)
drives the runtime through a fake surf fixture and a fake bombadil shell script plus child-process CLI spawns, while the
lanes that touch a real browser or a real binary (`bombadil:smoke`, `capability:drill`, `test:runtime`) are exactly the
ones the gate cannot see?

The second half corrects a premise: the framework's own default tests do not run a real browser (commit `ab34937`,
`tests/bombadil_runtime_contract.test.mjs:34-36`). The coverage number therefore measures how much of `src/**` the
*fixture* corpus executes. The modules whose truth depends on a live counterpart — `src/integrations/surf-client.ts`
(66.39 % lines, 48.10 % functions, "mapped from `surf <cmd> --help` shapes but not live-verified" per
`docs/project/product-posture.md`) — are the ones where a coverage target can be met only by writing more tests against
the fake.

## MODE 1 — MANY OF THE GREATS

### School 1: Measurement critique (Goodhart, Campbell; Marick's "How to Misuse Code Coverage", Fowler's "TestCoverage")
- Core claim: coverage records that a line was executed, not that anything about it was verified. The moment a coverage
  number becomes a target it stops being a measure, because the cheapest way to move it is to execute lines without
  asserting on them.
- Premises: a metric is a proxy for a property, never the property; every agent optimising against a gate optimises the
  proxy; an unverified execution that reads as green is a false negative — the exact failure shape this repo's posture
  exists to prevent.
- Strongest case: the authors and reviewers in this repo are, most of the time, language models running under a
  fail-closed gate. A model blocked by "changed-lines 91 % < 95 %" will write the test that executes the four uncovered
  lines. Those lines are, with high regularity, the defensive branches — spawn timeouts, retry exhaustion, malformed
  fixture output — precisely the branches whose *behaviour* matters and whose *execution* proves nothing. The gate
  converts the strongest quality question ("does the suite detect the wrong behaviour?") into the weakest ("did the line
  run?"), and the resulting number is then cited as evidence.
- What it sees that others miss: the difference between the *direction* of a signal and its *level*. "This line has never
  been executed" is information no one can fake. "95 % of changed lines were executed" is a compliance statement whose
  truth content falls as the pressure to reach it rises.

### School 2: Coverage is a floor, not a goal (Google's coverage practice — Arguelles, Ivanković, Bender 2020; Feathers)
- Core claim: absolute coverage is a weak positive signal but *uncovered* code is a strong negative one: code with zero
  hits has provably never been exercised by any test. Guarding the floor against erosion and surfacing the uncovered
  lines of every change is the highest-yield, lowest-cost quality mechanism there is.
- Premises: erosion is the default state of a codebase; nobody notices a module drifting from tested to untested unless a
  machine reports it; the local, per-change list of uncovered lines is the unit a reviewer can act on, whereas a
  repo-wide percentage is not.
- Strongest case: this tree already shows what erosion looks like without a floor — three runtime modules the suite never
  loads (`command-runner.ts`, `test-operation.ts`, `types.ts`), invisible in every report, at an unrecorded 0 %. Nothing
  but a coverage report finds those. Google's published practice makes the same point from the other end: per-change
  ("incremental") coverage with the uncovered lines shown in review is the metric engineers act on; the repo-wide number
  is a health indicator, not a target.
- What it sees that others miss: the Goodhart critique is asymmetric. You can inflate "covered"; you cannot fake
  "uncovered". A floor that starts at measured truth and forbids regression asks for nothing that has not already been
  demonstrated — there is no target to game, only a regression to avoid.

### School 3: Mutation testing (DeMillo, Lipton, Sayward 1978; Jia & Harman; Petrović & Ivanković, "State of Mutation Testing at Google" 2018)
- Core claim: a test suite is measured by the faults it detects. Coverage is a necessary but not sufficient condition:
  a line that is executed but whose mutants survive is, for quality purposes, untested. The only honest outcome measure
  is mutation score; gating on coverage is gating on the precondition and calling it the result.
- Premises: tests exist to fail; a test that cannot fail carries no information; fault-detection is directly measurable
  by injecting faults; execution without detection is the common case for tautological and fixture-echo tests.
- Strongest case: this repo already knows this. `ts-quality.config.json` sets `minMutationScore: 0.5`, `maxSites: 64`,
  `coveredOnly: true`, and the screening wrapper runs diff-aware. The outcome measure for a change is already defined;
  the coverage gate does not replace it and must not be presented as if it did. Google's scale result is decisive on
  method: mutation is useful only *incrementally on changed lines, surfaced to the reviewer*, never as a whole-repo
  gate — cost and noise make anything else unusable.
- What it sees that others miss: `coveredOnly: true` means mutation cannot even be attempted on an uncovered line. The
  coverage floor is therefore not a rival to mutation; it is the substrate mutation runs on. A change that lowers
  coverage silently shrinks the set of lines the outcome measure can examine.

### School 4: The ratchet (Ohno, Deming; Humble & Farley's "tighten the build"; the quality-ratchet pattern)
- Core claim: a standard that depends on daily willpower is not a standard. Lock in every gain mechanically, start from
  where you actually are, and make backsliding require an explicit, visible, recorded act. Improvement is monotone and
  small; the mechanism, not the person, holds the line.
- Premises: entropy is the default; a fixed threshold set above current truth is either ignored, waived, or gamed, while
  a threshold set *at* current truth is honest by construction; an exception is data — it should be written down where
  it was made, by whom, and why (the andon record).
- Strongest case: pic's fixed 95/90/98/95 are numbers someone chose; this tree's 85.18/78.92/85.36 are numbers the suite
  produced. A ratchet at 85.18 makes one claim — "no change leaves the tree less tested than it was" — and that claim is
  true on the day it is committed and every day after. The append-only ledger with `from`, `to`, `reason`, `ref` in the
  same commit turns a silent decision (delete a module, lose 0.3 points) into a visible one and forbids pre-approval.
  Raising needs no ceremony because raising is the point.
- What it sees that others miss: the distinction between a *threshold* (a demand) and a *ratchet* (a memory). The
  Goodhart critique aims at demands. A ratchet at truth is a memory of what has been demonstrated, and a memory cannot
  be gamed, only lost — and the ledger makes losing it deliberate.

### School 5: Evidence governance (safety-case and change-control thinking; this repo's own passport and truth gate)
- Core claim: a claim the system makes about itself — the CLI table in `docs/api/cli.md`, the JSON schemas under
  `schemas/`, the capability passport — is only true while a reproducible generator says so. Hand-maintained duplicates
  of a source of truth always drift; the check that catches drift is a different kind of check from coverage, and it
  belongs in the commit gate on its own justification.
- Premises: what CI does not check decays; byte-identity against a generator is the strongest available form of
  "docs match code"; the audit trail (the ledger, the commit subject naming the file) is part of the product, not
  overhead.
- Strongest case: the passport byte-identity check exists (`scripts/capability-truth-gate.mjs:1049-1057`) but only in the
  release gate; eleven commander commands are declared by hand next to a route manifest, and the test that claims they
  mirror each other greps a fixed phrase list. These are truth failures waiting to happen, and no coverage number, no
  mutation score and no reviewer will catch a status column that says `supported` when the manifest says `bounded`.
- What it sees that others miss: contract-sync is immune to every Goodhart argument. The only way to satisfy a
  byte-identity check is to regenerate the artifact, which is the desired action. There is no proxy to inflate.

### School 6: Minimalism and judgement (Fagan inspection; Weinberg; DORA/Accelerate on lead time; Lean's build-measure-learn)
- Core claim: every gate is a tax paid on every commit to prevent a failure that happens rarely; the gate's false
  positives, maintenance surface and unfamiliar failure messages cost more learning than the failures they prevent.
  Quality comes from fast feedback and small batches; numbers should be *shown to* a reviewer, not *enforced on* an
  author.
- Premises: lead time and deployment frequency predict quality (DORA), and gates lengthen both; a red that is not a
  bug trains everyone to bypass; in a repo touched by many parallel agent sessions, one opaque block costs a session's
  context; complexity nobody owns after its author is a liability, not an asset.
- Strongest case: the packet's own numbers. At birth the structure check enforces nothing about existing code — it
  freezes five oversized files and one cycle and then forbids growth exactly where every feature lands
  (`orchestrator.ts`, 2293 lines). Floors are enforced on every Node major while the workstation runs v26 and CI runs
  v22 with a known coverage delta; timing-dependent branches can flip lines between runs against a 0.005 tolerance.
  Add a schema generator, a captured help file that diffs on every description edit, source-map switches — and the
  packet has built a machine whose reds will sometimes be about the machine.
- What it sees that others miss: a stop-the-line that has no fix path is not an andon cord, it is a wall. Toyota's andon
  works because a team lead arrives. A block on "orchestrator.ts grew by ten lines" with no split scheduled is a wall.

## MODE 2 — CONFRONTATION

### Clash 1: Measurement critique vs Coverage-as-floor
- Fundamental contradiction: whether any enforced coverage number is self-defeating, or whether enforcement at the
  floor merely forbids regression.
- Incompatible assumptions: Goodhart — every target corrupts the measure it targets. Floor school — a floor at
  demonstrated truth is not a target, and the negative direction of the signal cannot be corrupted at all.
- What the critique explains better: what happens above the floor. A changed-lines demand of 95 % on a tree that
  demonstrates 85 % is a target set ten points ahead of truth, aimed at the residual lines that are hardest to test
  honestly and easiest to execute dishonestly. In `surf-client.ts` — where 52 % of functions have never run and the
  only test double is a fake speaking shapes the maintainers wrote — reaching 95 % on a change means fixture-echo tests
  by construction.
- What the floor explains better: the three never-loaded modules; erosion in general; why a per-change uncovered-line
  list is the one output a reviewer reliably uses.
- Residual tension: none where the signal is negative and the level is the floor. Real and irreducible where the level
  is above truth. The packet's `changed_lines_min: 95` is the one number in it that sits on the wrong side of this line.

### Clash 2: Mutation vs coverage gating
- Fundamental contradiction: whether gating on the precondition (execution) is legitimate when the outcome (detection)
  is measurable.
- Incompatible assumptions: Mutation — only detection counts. Coverage — detection is unmeasurable on lines that never
  run, so execution is the substrate.
- What mutation explains better: assertion-free and tautological tests; why a 95 % changed-lines number carries almost
  no information about defect detection.
- What coverage explains better: cost. Sixty-four sites at a 15 s timeout is a screening lane, not a pre-push stage, and
  `coveredOnly: true` makes coverage the enabling condition for the outcome measure, not its competitor.
- Residual tension: resolvable by pairing, not by choice — coverage gate as substrate, mutation on the changed covered
  lines as outcome, in screening where the cost belongs. The packet's non-goal ("screening owns mutation") is correct
  but states the division of labour without the dependency.

### Clash 3: Ratchet vs Minimalism
- Fundamental contradiction: whether locking in the present state is protection or friction.
- Incompatible assumptions: Ratchet — erosion is the default and mechanisms must hold what people will not. Minimalism —
  gates must earn their friction per red, and a red without a fix path is a bypass lesson.
- What the ratchet explains better: this tree. Five files over 700 lines and one runtime cycle accumulated with no gate;
  the never-loaded modules accumulated with no report. The erosion the minimalist calls hypothetical has already happened.
- What minimalism explains better: bypass culture and non-bug reds — the v22/v26 delta, timing flips, a generated file
  that diffs on every wording change, a frozen 2293-line file with no split on the schedule.
- Residual tension: partly resolvable. The ratchet wins on principle; minimalism dictates the ergonomics: every red must
  be deterministic, name the metric, the measured value, the floor and the gap, and carry a fix path. For the structure
  budget the fix path is the ledger — the packet already provides one for floors and then contradicts itself for
  exceptions ("may only shrink" vs "the same rule applies to adding an exception"). The residue that does not resolve:
  a repo with a ratchet has a slightly higher cost per commit forever, and accepts it.

### Clash 4: Evidence governance vs Measurement critique and Minimalism (the ledger)
- Fundamental contradiction: whether a written reason is evidence or ceremony.
- Incompatible assumptions: Governance — the moment of writing forces articulation and the record enables audit.
  Critique — reasons degrade to "needed". Minimalism — a JSON object for a 0.3-point drop from deleting a module is
  ceremony.
- What governance explains better: the alternative. Without the ledger a floor drop is a silent decision in a JSON diff;
  the repo's posture forbids silent degradation explicitly.
- What the critics explain better: nobody reads ledgers later. Their value is at write time (the author must name a
  `from`, a `to`, and an AK ref), not at read time.
- Residual tension: resolved in governance's favour at near-zero cost: one object, one commit-subject convention, a
  `ref` that must resolve. Boilerplate reasons are a review problem, not a design problem.

### Clash 5: Judgement vs deterministic gates
- Fundamental contradiction: whether "tested enough" is a number or a decision.
- Incompatible assumptions: Judgement — a reviewer weighs the change; numbers inform. Gate — in this repo the reviewer at
  push time is usually the same model that wrote the code, or no one; the assessment's constraint is "deterministic
  checks".
- What judgement explains better: that 95 % is a judgement encoded as a number without evidence for this codebase, and
  that pic's 98 % was a judgement for a repo where fifteen test files launch real Chrome under precise coverage — a
  different corpus.
- What the gate explains better: parallel agent sessions, no synchronous reviewer, fail-closed posture. Judgement is not
  available at the point of enforcement.
- Residual tension: irreducible in one place — the gate must encode *some* level for changed lines. The honest level is
  the one the tree has demonstrated, not one imported from another repo.

## MODE 3 — INTEGRATION OR DECISION
- Chosen path: Contextual Dominance.
- Result:
  1. The ratchet (School 4) with the ledger (School 5) dominates for every *regression floor*: total line/branch/function
     floors set at measured truth, never-loaded runtime modules, allowed cycles, file-size exceptions. These forbid
     regression and demand nothing; the Goodhart critique has no purchase on them because there is no level to reach for.
     Unchanged, with one consistency repair: structure exceptions may be added or grown only through the same ledger
     mechanism as a floor drop.
  2. The measurement critique (School 1) dominates for the *changed-lines level*. A fixed 95 % is a target ten points
     above demonstrated truth, aimed at the lines most cheaply executed and least meaningfully verified, in a corpus
     whose integration doubles are fakes. It is removed. Changed executable lines must be covered at least at the
     repo's own `floors.lines` — the changed set is held to the standard the whole tree has demonstrated, and that
     standard rises only when the ratchet rises. The Goodhart-proof part of the changed-lines signal is hardened
     instead: a changed runtime module with no coverage record is 0 % (kept), and the uncovered changed `file:line`
     list is printed on every run, green or red, because that list — not the percentage — is what School 2 shows
     reviewers act on.
  3. Mutation (School 3) is the outcome measure for changed code and stays in screening; the packet states the
     dependency explicitly: the coverage gate is the substrate that makes `coveredOnly` mutation possible on the changed
     set, and the printed uncovered-line list is mutation's blind spot by construction.
  4. Minimalism (School 6) dictates ergonomics, not existence: reds must be deterministic and carry a fix path; the
     never-loaded check has no exception list (an exception would hollow the one signal that cannot be gamed) — the
     three modules get loading tests in the first commit; a type-only module with zero executable lines is not a
     finding; the v22/v26 delta is a contingency with a defined resolution, not a hope.
  5. Contract-sync (School 5) stands on its own justification, untouched by the coverage dispute.
- Why this path is justified: the schools are not disagreeing about one thing. They are disagreeing about the negative
  direction of a signal (uncontested: enforce it), the level of a demand (contested: set it at demonstrated truth, never
  above), and the outcome measure (uncontested: mutation, at screening cost). Contextual dominance is the only path that
  does not either smuggle a target back in under the word "floor" or throw away the erosion protection this tree has
  already proven it needs.
- What remains unresolved: the coverage number for `surf-client.ts` and the bombadil runtime will always measure the
  fakes' fidelity, not the binaries' truth; no gate on the fixture corpus can see the real-binary lanes, and the packet
  must say so rather than let 85 % read as evidence about live behaviour. And a ratchet has a permanent per-commit cost
  that the minimalist correctly names and the repo accepts.

## PRACTICAL CONSEQUENCE

`changed_lines_min` leaves the baseline file; the changed-lines requirement is `floors.lines` and rises with it. The
gate prints the uncovered changed lines always. Never-loaded runtime modules have no exception list; the three known
ones get tests. Structure exceptions grow only through a ledger entry naming `from`, `to`, reason and ref, exactly like
a floor drop. The packet states in one sentence that the ratchet is a floor on the fixture corpus and not evidence
about real-binary behaviour, which stays with the drill/smoke lanes and the passport. Everything else in the packet —
the ratchet, the ledger, contract-sync, structure in pre-commit, Node built-in coverage — survives the confrontation
intact.
