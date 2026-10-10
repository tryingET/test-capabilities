---
summary: "Local S5 proof (ts-quality AK6704): one test-capabilities slice screened with the unreleased native ts-quality source, then rolled back to the pinned npm 0.7.0."
read_when:
  - "You want to know how unreleased ts-quality native features behave on this repo before a ts-quality release."
  - "You are reviewing or accepting the 2026-10-10 native screening evidence or its rollback."
type: "reference"
---

# ts-quality native screening proof — 2026-10-10

**Local evidence only.** This screened one slice with the unreleased `ts-quality` source checkout. The accepted
package for this repo is still npm `ts-quality@0.7.0` (see `ts-quality-current-vs-target.md`). Nothing here claims
a public release, a new adoption, or a change to the accepted state. ts-quality AK6550 and its dependency AK6548 are
unchanged.

- Authorization: the Holding Owner, owner of this repo, authorized this scoped screening on 2026-10-10 (ts-quality
  AK6704, evidence 14901), naming the slice, the commands and the output effects.
- Receiver acceptance of these results: **pending** (see the end of this file).

## Identity

| What | Value |
|---|---|
| Native CLI | `../ts-quality/dist/packages/ts-quality/src/cli.js` at ts-quality commit `b942f6d`, cli.js sha256 `ee67ec308d3e05fee230ebbbbffa9227c7ebd49d95ede034b455435c02d2dbc7` |
| How it was selected | `TS_QUALITY_BIN`, the first rule of `resolve_ts_quality_cli` in `scripts/screening/ts-quality-common.sh` |
| Rollback CLI | `node_modules/.bin/ts-quality` (npm `0.7.0`, pinned), which the resolver returns once `TS_QUALITY_BIN` is unset |
| test-capabilities | commit `ea9c277`, clean tree |

Both CLIs print `--version` as `0.7.0`, so the version string does not tell them apart. The resolved path and the
cli.js digest do. Behavior does too: npm 0.7.0 refuses `index write --package .` with `unknown option --package`.

No dependency was installed and no pin, `package.json` or `package-lock.json` changed.

## Slice and commands

Slice: `operation.quantum.input-envelope.contract` (`src/core/operations/quantum-operation.ts`, witness
`tests/quantum_operation_contract.test.mjs`).

```bash
NATIVE=../ts-quality/dist/packages/ts-quality/src/cli.js
TS_QUALITY_BIN=$NATIVE npm run screening:witness-refresh -- --changed src/core/operations/quantum-operation.ts
node $NATIVE mutations preview --changed src/core/operations/quantum-operation.ts --json
TS_QUALITY_BIN=$NATIVE npm run screening:check -- --changed src/core/operations/quantum-operation.ts --run-id <run-id>
node $NATIVE report --run-id <run-id> --json
node $NATIVE navigate --run-id <run-id> --json
node $NATIVE index write --package . --run-id <run-id> --out .ts-quality/materialized/package-index.json
node $NATIVE index inspect --index .ts-quality/materialized/package-index.json --json
# rollback
env -u TS_QUALITY_BIN npm run screening:witness-refresh -- --changed src/core/operations/quantum-operation.ts
env -u TS_QUALITY_BIN npm run screening:check -- --changed src/core/operations/quantum-operation.ts --run-id <run-id>
npm run check
```

## Results

| Run id | CLI | Outcome | Mutation | Note |
|---|---|---|---|---|
| `tc-quantum-operation-native-s5-20261010` | native | fail, 15/100 | 0 killed / 7, 7 errors | Mutation workspace baseline failed; ts-quality refused to count kills (fail closed). Not reproduced; see finding 1 |
| `tc-quantum-operation-native-s5-diag-20261010` | native, output caps lifted (scratch copy, not committed) | pass, 90/100 | 7 killed / 7 | Diagnostic rerun to see the full baseline output; the baseline passed |
| `tc-quantum-operation-native-s5b-20261010` | native, unmodified | pass, 90/100 | 7 killed / 7 | Selection ledger complete: 7 discovered, eligible, selected and executed, 0 cached |
| `tc-quantum-operation-rollback-s5-20261010` | npm 0.7.0 | pass, 90/100 | 3 killed / 3 | Rollback after the first native run |
| `tc-quantum-operation-rollback-s5b-20261010` | npm 0.7.0 | pass, 90/100 | 3 killed / 3 | Final state; `latest.json` points here |

The native and 0.7.0 runs agree on the verdict (pass, 90/100). Differences the native source introduces on this slice:

- **More mutation sites:** 7 instead of 3. The native catalog adds probes (increment, `0`/`1`, condition inversion);
  all 7 were killed.
- **Lower measured coverage:** the lowest changed-function coverage is 33.33% instead of 37.5%, because native
  coverage counts only LCOV-instrumented lines.
- **New read-only projections work:** `mutations preview` (inert, 7 sites), `navigate` (2 queue items) and
  `index write`/`index inspect` (18 fresh references).

## Findings

1. **A transient baseline failure, correctly fail-closed, but its cause was hidden.** The first native run's
   unmutated test command failed once inside the mutation workspace while the machine was under load (load average
   15 to 20 from other jobs). The two reruns passed. ts-quality refused to count kills, as it should, but it records
   only the first 280 characters of the test output, so the failing test's name (printed at the end) was lost.
   Follow-up for ts-quality: keep the end of the output. No change needed here.
2. **Post-check projections always report control-plane drift (also with 0.7.0).** `ts-quality-check.sh` writes
   the screening overlay config to `.ts-quality/materialized/screening.XXXXXX/` and deletes it on exit. Every later
   `report`, `explain`, `navigate` or `index inspect` therefore sees `control plane config: sha256:missing`.
   Native `navigate` shows this as an `evidence-invalidity` headline. A possible receiver fix is to keep the overlay
   config of each run; that is your decision and was not changed here.
3. **The default package-index output breaks this repo's gate.** `index write` defaults to
   `.ts-quality/package-index.json`, which `.gitignore` does not cover, and `npm run check` (biome format) then
   fails. With `--out .ts-quality/materialized/package-index.json` (ignored) the gate passes. Follow-up for
   ts-quality before release: name the index in its retention guidance or choose an ignored default.
4. **The central catalog is already current.** It lists exactly the four live slices (`adoptionStage`
   `accepted-repo-local-four-slices`) and `node scripts/register-screening-catalog.mjs --check` passes in
   `../ts-quality`. Nothing is left to hand off for the old five-row catalog.

## Rollback

Unsetting `TS_QUALITY_BIN` returns the resolver to the pinned npm 0.7.0. The rollback runs above pass. `npm run check`
passed with exit 0, after removing the S5 index file of finding 3. The working tree is clean. Local run artifacts stay
in the ignored `.ts-quality/runs/` like every other screening run and can be deleted.

## Receiver acceptance

Pending: the receiver owner's acceptance of these local results and of the rollback is to be recorded on ts-quality
AK6704.
