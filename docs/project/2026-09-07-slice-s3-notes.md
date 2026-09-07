---
summary: "Slice note for S3 of the 2026-09-07 surf-learnings implementation plan (kernel boundary, classifier, error carrier, agents moved): the five commits and what each did, the gate outputs and coverage before/after (275 -> 370 tests, 90.36 -> 93.58 % lines), the eight live surf captures and how they corrected the fake, the two extra modules the size budget forced, the peer consultation that removed the Bombadil terminal violation claim, every deviation from the plan with its reason, and what S4 must know before it switches the consumers onto ResultOutcome."
read_when:
  - "You pick up slice S4 or later and need the shape of Adapter.invoke, RawResult, classifyResult, ExpectDeclaration and the error registry, plus the exact reason the surf explore consumers were not switched in S3."
  - "You wonder why cli-adapter.ts, surf-adapter.ts and result-payload.ts exist, why probeSurfRuntime moved, or why the Bombadil terminal runner can never report a violation."
  - "You need the S3 gate outputs, the live capture corpus and its provenance, or the deviations from the plan with their reasons."
type: "diary"
---

# Slice S3 notes (2026-09-07)

Plan: `docs/project/2026-09-07-surf-learnings-implementation-plan.md` §3 S3. Packets:
`2026-09-07-result-classification-design.md` (primary; its `## Refinement` and the `revised by …`
entries override earlier text), `2026-09-07-mutation-safety-design.md` (`Adapter.invoke`,
`spawn-step.ts`, `FrameworkError`), `2026-09-07-architecture-adjudication.md` Part 4.

Tree before the slice: `0f7e4d1` (end of S2), `npm test` 275 tests / 274 pass / 1 skipped,
coverage 90.36 % lines / 79.56 % branches / 92.90 % functions (Node 26.8.1, c8 12.0.0), structure
34 modules / 54 runtime edges / 0 cycles. The other session's uncommitted changes (`AGENTS.md`,
`docs/dev/EXTENSION_SOP.md`, `scripts/install-hooks.sh`, the deleted `scripts/docs-list.sh`, the
`docs:list` hunk in `package.json`) were never staged; every commit staged explicit paths and
`package.json` was not touched by this slice at all, so the index-blob method of plan §5 was not
needed.

## Commits

| commit | subject | tests after | lines/branches/functions |
|---|---|---|---|
| `4fb1b30` | refactor(orchestrator): move the four agents to src/core/operations/test/agents.ts as step lists (adjudication 33) | 288 (+13) | 91.43 / 80.51 / 92.90 |
| `20ae922` | feat(kernel): Adapter.invoke with spawn-step as the transport; three callers; Bombadil status from typed fields (review A7, adjudication 21, 46) | 310 (+22) | 92.82 / 81.53 / 94.08 |
| `8f682d9` | feat(result): pure classifier, error-code registry, FrameworkError and the --json error envelope (review A6) | 359 (+49) | 93.58 / 83.30 / 94.33 |
| `7f8f62b` | test(surf): capture corpus and fake fidelity test (review A17) | 369 (+10) | 93.54 / 83.18 / 94.33 |
| `30d5fa0` | fix(bombadil): a terminal exit is never attributed to a property violation; a stale trace is not this run's evidence (adjudication 46) | 370 (+1) | 93.58 / 83.47 / 94.33 |
| (this note) | docs(diary): slice S3 notes | 370 | 93.58 / 83.47 / 94.33 |

Gates after every commit: `npm run check` green (lint, typecheck, node tests, 4 cucumber
scenarios, structure, coverage; 12-14 s wall, of which the ratchet is 5.6-6.5 s);
`npm run loop-impact-plan` printed `impact=wide` / `next=npm run loop-impact-wide` and
`LOOP_WIDE_REASON="slice S3 commit <n> …" npm run loop-impact-wide` (= `release:check`: check,
`truth:gate ok`, `consumer:smoke ok` on the packed tarball) passed. `npm run
runtime-diagnostic:corpus` and `npm run root-cause:corpus` (92 cases) are unchanged. The
pre-existing biome warning (`tests/fixtures/fake-surf.mjs`, unused `tab` parameter) is untouched.

Changed-lines gate per commit: 95.78 %, 95.97 %, 99.27 %, n/a (tests and fixtures only),
100.00 %. The floors are still S2's (`90.36 / 79.58 / 92.90` on Node 26); the tree now measures
about three points above every one of them. Raising them is S10's job (plan §3 S10), so this
slice left `coverage-baseline.json` untouched: S4 has headroom, and the changed-lines gate is
what holds new code to the tree's ratio.

## What each commit did

### `4fb1b30` the agents move

`BombadilAgent`, `TerminalFuzzerAgent`, `SurfAgent` and `CliTesterAgent` moved to
`src/core/operations/test/agents.ts` with the process helpers they own (`parseCommandLine`,
`appendCappedProcessOutput`, the CLI-tester timeout and output cap, `summarizeBombadilEvidence`)
and the `AgentResult` / `TestAgent` interfaces. The orchestrator keeps the run loop, correlation,
root-cause synthesis and observation rendering and imports the classes at runtime; agents.ts
imports the orchestrator for types only, so the graph stays acyclic (0 cycles, verified).
`structure-budget.json` lowered the orchestrator exception 2078 → 1538 in the same commit, as S2
required.

The move is why the slice starts with 13 new tests: every line of a new `src/` module counts as a
changed line, and the agent region was covered at 77.7 % inside `orchestrator.ts` (102 uncovered
lines of 458). `tests/agents_contract.test.mjs` covers the four missing-target refusals,
cli-tester success / non-zero exit / timeout kill / spawn failure / unparseable command line,
Bombadil option forwarding, violation evidence, no-evidence runtime failure and budget
exhaustion, the terminal subject, and the surf agent's runtime refusal.

### `20ae922` the kernel boundary

`src/core/spawn-step.ts` is the only module in `src/` that imports `node:child_process`. It
carries the kill-tree, force-kill grace and output-cap semantics that `CliTesterAgent.runCommand`
and `runBoundedBombadilProcess` each had a copy of, plus the synchronous path `runSurfCommand`
needs, and answers with `RawResult`. `src/core/adapter.ts` declares
`Adapter { id, resolve, probe, translate, effects, invoke }` (commit (3) adds `normalize`) with
`invokeAdapter` as the one composition and two fail-closed guards: an invocation without a
command, argv or budget, and a transport reply that is not a `RawResult`, are refusals at the
boundary.

Three live callers, not the plan's four: S2 deleted `surf-client.ts`. `cli-adapter.ts` (the CLI
tester's private `runCommand` and `parseCommandLine`), `surf-adapter.ts` (`runSurfCommand`, the
capability probe, the static surf command → effect class map with `js` and unknown verbs
`unclassified`) and `bombadil-runtime.ts` (both spawn sites).

Bombadil status stopped coming from prose: `looksLikeViolation`,
`looksLikeBombadilRunEvidence` and `looksLikeBombadilTerminalEvidence` are deleted and the status
is derived from the spawn result, the trace file (new typed `traceBytes`, read from disk) and the
exit contract. The fake Bombadil in `tests/orchestrator_fail_closed_contract.test.mjs` now writes
the trace file it announces, as the real tool does.

### `8f682d9` the classifier, the registry and the envelope

`classifyResult` applies the packet's order: transport failure (with `basis: indeterminate` on a
mutating step, review A4), channel separation (stderr never payload; surf-only bookkeeping
stripping into `transport.bookkeeping`), error signals under an owned or declared contract only,
emptiness (`ok: true` needs a payload or a declaration from config, operation code or an HTTP
protocol fact), success, and `unclassifiable` for anything self-contradictory.
`src/core/error-codes.ts` registers the framework's codes and separates them from surf's
pass-throughs and the `exit_<n>` / `signal_<NAME>` / `http_<status>` patterns.
`runtime-contract.ts` gained `FrameworkError`, `toErrorEnvelope` and `renderErrorLine`; the CLI
prints `<message> [code]` on stderr in text mode and `{"error": {code, message, details}}` on
stdout with exit 1 under `--json`.

### `7f8f62b` the captures

Eight live captures (below) became the fake's specification and corrected three shapes it had
wrong. The fake gained `FAKE_SURF_ZERO_ROWS_ON` and `FAKE_SURF_BOOKKEEPING_ONLY_ON`.

### `30d5fa0` the attribution fix

The peer consultation's conclusion (below) plus the trace-freshness rule it suggested.

## Live captures (dogfood)

Chromium (Agent) was not running: it is started by `~/.local/bin/chromium-agent.sh`, and the
operator's own Chromium (a different profile) was left alone. Started as a transient unit
(`systemd-run --user --unit chromium-agent-s3 ~/.local/bin/chromium-agent.sh`), captured, and
stopped again; `/tmp/surf.sock` and port 9222 are gone afterwards and `surf tab.list` showed the
same single `New Tab` before and after every capture. `surf doctor --browser chromium --json`:
`ok: true`, 10 pass / 0 warn / 0 fail. Tool: `~/.local/bin/surf` 2.18.0 against Chrome/152.0.7977.64.

| capture | command | exit | what it pins |
|---|---|---|---|
| `tab-new` | `tab.new https://example.com/` | 0 | the text reply (`Created tab <id>: <url>`) the CLI gives even under `--json` |
| `tab-close` | `tab.close <id>` | 0 | `Closed tab <id>` |
| `wait-ready-ready` | `wait.ready --tab-id <id> --json` | 0 | the `{result, target, notice}` explicit-tab envelope; `result` carries `accepted`, `timeout`, `interval`; `target` is `{source, tabId, windowId, browserEpoch, queuedMs}` |
| `wait-ready-login` | `wait.ready --tab-id <id> --json` on `https://github.com/login` | 1 | the `page_login` error envelope on stdout and `Error: … [page_login]` on stderr (the page was classified, never logged into) |
| `extract-rows` | `extract --tab-id <id> --code <links> --allow-empty --json` on docs.python.org | 0 | target-mode payload: `{data, rows, readiness, rowCount, attempts, mode, url}`, `url: null`, no `tabId` |
| `extract-owned-tab` | `extract <url> --code <links> --allow-empty --json` | 0 | owned-tab payload: the same keys plus `tabId` (null once the tab is closed) |
| `extract-empty` | same with a script returning `rows: []` | 0 | zero rows accepted explicitly |
| `extract-empty-refused` | same without `--allow-empty` | 1 | `{"error": {code: "empty_result", message: "… Pass --allow-empty …", details: {rows: 0}}}` |

Envelope dogfood: `node bin/test-capabilities surf explore --url https://example.com/ --json`
(against the real surf and the agent browser) → exit 0, `operationId: surf.explore`,
`coverage {userFlows: 100, status: "verified", probesVerified: 2/2}`, `runtime {flavor: surf,
provider: path_surf, version: 2.18.0}`, envelope keys unchanged apart from `input.json`; 64 s.
`node bin/test-capabilities surf explore --json` (no `--url`) → the error envelope
`{"error": {code: "config_invalid", message: "Surf explore requires --url with a valid URL.",
details: {issues: [{path: "url", …}]}}}` on stdout, exit 1; the same failure in text mode prints
`… [config_invalid]` on stderr and nothing on stdout. Both are now contract tests.

## Peer consultation

Question to `openai-codex/gpt-6-astra` (`pi -ne -nc -nt`): with status derived from typed fields
only, is a non-zero exit from the Bombadil *terminal* runner (no trace file, no
`--exit-on-violation`, only an exit code and whether it printed anything) defensibly a
`violation`, or must it be `runtime_error`, accepting that the terminal runner can then never
report a violation?

Answer: `runtime_error`. "A non-zero terminal exit plus output cannot distinguish a property
violation from a crash, dependency failure, or malformed invocation. Output byte count proves
only that something was emitted. Labeling it `violation` would make an unsupported claim about
the target… That is a limitation of its observability, not a reason to weaken classification."
It added that web traces must be *fresh and run-specific*, because stale trace bytes are not
evidence about this run, and that a terminal violation needs a documented typed signal (a
dedicated exit code or a structured result artifact) before it can be claimed.

**Adopted in full** (`30d5fa0`): the terminal runner returns `runtime_error` for every non-zero
exit and the terminal-fuzzer finding lost its violation branch (the recommendation says why);
`traceEvidence` refuses a trace file whose mtime predates the run by more than one second of
clock slack. The follow-up (a typed terminal signal) is named below for S4/S5. Two earlier
attempts at the same question timed out after 10 minutes each with a ~400-word prompt; the
answer came back in about a minute once the prompt was cut to ~200 words. The advice is advice:
it was adopted because it is the packet's own attribution rule (a verdict may never claim a
target fault it cannot evidence), not because the peer said so.

## Deviations from the plan, with reasons

1. **Three new modules the plan did not name**: `src/core/cli-adapter.ts`, `src/core/surf-adapter.ts`
   and `src/core/result-payload.ts`. The surf adapter and `runSurfCommand` inside
   `surf-runtime.ts` would have grown that file from 1006 to ~1145 lines, i.e. raised an
   exception on the second-largest file in a slice about boundaries; extracting instead *lowered*
   it to 813. The classifier as one file measured 915 lines against a 700-line budget, so the
   channel/payload half (JSON candidates, bookkeeping stripping, rows, the surf error contract)
   moved to `result-payload.ts`. Both new pure modules are in `pure_ring`.
2. **`probeSurfRuntime` and `runSurfCommand` live in `surf-adapter.ts`** (public names unchanged;
   `src/index.ts` re-exports them). `probeSurfRuntime` calls `runSurfCommand`, so leaving it in
   `surf-runtime.ts` would have created a runtime cycle with the adapter.
3. **`Adapter.normalize` arrives in commit (3), not (2)**: it returns a `ResultOutcome`, which
   commit (3) defines. The interface is complete at the end of the slice, as the plan requires.
4. **`runSurfCommand` attaches `outcome` but `ok`/`failure` keep their transport meaning.** The
   plan's S3 line says "attaches `outcome`" and S4 is "Classification consumers". Deriving `ok`
   from the outcome in S3 was tried and immediately turned four explore tests red (zero link rows
   and an empty `tab.new` reply became refusals), which is exactly the behaviour S4 introduces
   *together with* its declarations (`SURF_EXPLORE_LINKS_EMPTINESS`, `expect`, the readiness
   gate). Doing it here would have been S4's work without S4's declarations.
5. **`surf explore --json` is new.** The plan's dogfood assumes it; the command had no `--json`
   flag, so commander refused it. Added as an implemented option (`SURF_EXPLORE_OPTION_SUPPORT`,
   the input schema, `SurfExploreOperationInput`, `docs/api/cli.md`); it costs one line in
   `surf-explore-operation.ts`, which is the slice's only structure-ledger entry (841 → 842).
6. **The envelope is rendered in `runtime-contract.ts` + `bin/test-capabilities`, not in
   `dispatch-execution.ts`.** A library function cannot print; it raises typed errors instead
   (`invalid_route_payload`, the `renderUnsupported` codes). Keeping `toErrorEnvelope` and
   `renderErrorLine` in `src/` (exported from the package root) also keeps them under test, which
   nothing in `bin/` is.
7. **`renderUnsupported` takes a required `code` and returns the `FrameworkError`** (the packet
   says "throws it"); the twelve call sites keep `throw renderUnsupported(...)`. Deriving the code
   from the category prose would have been the same class of mistake the slice removes.
8. **`config_not_found` was added to the registry** and `loadConfig` raises it. Without it the
   most common CLI failure would have rendered as `unclassified_error`, which is honest but
   useless; the code is one row in `docs/api/errors.md` and one line in the loader.
9. **Bombadil's terminal runner can never report `violation`** (peer consultation above), and a
   stale trace file is not evidence.
10. **The fake surf's shapes changed** (`readiness.accepted/timeout/interval`, the `target` block,
    `tabId` only in owned-tab mode, `readiness` before `rowCount`). The captures are the
    specification; the fidelity test compares structural fingerprints, never values.
11. **The capture files are biome-formatted.** The repo formats JSON, and `stdout` already holds
    the parsed payload rather than the byte stream, so formatting changes nothing but whitespace.
12. **Floors not raised** (see the gate section): S10 owns `coverage:raise`.
13. **The slice has five commits, not four.** The fifth is the peer-driven attribution fix, kept
    separate so it reverts on its own.

## Structure and budget after the slice

42 modules, 76 runtime edges, 0 cycles, roots `src/index.ts`. Exceptions:
`orchestrator.ts` 1538 (was 2078), `surf-runtime.ts` 813 (was 1006),
`surf-explore-operation.ts` 842 (ledgered +1), `self-healing.ts` 821 (untouched). `pure_ring`
now lists `config.ts`, `capability-matrix.ts`, `result-classification.ts`, `result-payload.ts`,
`error-codes.ts` and `runtime-contract.ts` - the last two beyond S2's handover, because
`FrameworkError` and the registry are the pure ring's error carrier and the rule costs nothing.
New module sizes: `agents.ts` 415, `spawn-step.ts` 206, `adapter.ts` 146, `cli-adapter.ts` 149,
`surf-adapter.ts` 289, `result-classification.ts` 573, `result-payload.ts` 367,
`error-codes.ts` 110.

## What S4 must know

- **The consumers are still on the transport verdict.** `SurfCommandResult.outcome` is populated
  on every call, but `ok`/`failure`, the explore probes, `gateReadiness` and the agents still read
  exit codes. Switch them *together with* the declarations, or the links probe (zero rows) and an
  `empty` readiness state become refusals with no way to accept them. The four tests that catch
  this are in `tests/orchestrator_fail_closed_contract.test.mjs` (surf agent) and the explore
  contract tests.
- **The classifier's entry points**: `classifyResult(raw: RawResult, declaration?: ExpectDeclaration)`.
  `ExpectDeclaration` uses the config keys verbatim (`output`, `empty_marker`, `payload`,
  `error_envelope`) plus a required `declaredBy`, so `AgentConfigSchema.expect` can be passed
  straight through with `declaredBy: "config:agents.<name>.expect"`; `author:<tester>` is the
  provenance claim 4 asks for and is already exercised in the contract test.
- **`basis: indeterminate` comes from `RawResult.effect: "mutating"`** on a transport failure.
  S5's ledger sets that field; nothing else produces `indeterminate` today.
- **`invokeAdapter` returns `{ raw, outcome, effect, invocation, resolution }`** and is the only
  composition of the adapter members; `AdapterStep.expect` carries a declaration to `normalize`.
- **Agents live in `src/core/operations/test/agents.ts`** (415 lines; keep it under 700). Edit the
  step lists there, never in `orchestrator.ts`, and lower the orchestrator exception again if the
  file shrinks - an exception with slack fails the structure check.
- **Bombadil's typed facts** for "require a non-empty trace": `BombadilRunResult.tracePath` and
  `traceBytes` (fresh files only). `runtime_error` is currently the class for "exit 0 with no
  trace and no output" and for every non-zero terminal exit; S4's classifier consumption should
  render the first as `empty`/`no_evidence` rather than as a target fault. Open follow-up: a typed
  terminal signal (dedicated exit code or result artifact) would let the terminal runner report a
  violation again.
- **Adding an error code**: append a namespaced `as const` array to `src/core/error-codes.ts`
  (`EFFECT_ERROR_CODES` is S5's), add it to `FRAMEWORK_ERROR_CODES`, and add a row to the table in
  `docs/api/errors.md` - `tests/error_codes_contract.test.mjs` greps every `new FrameworkError("`
  literal and every `renderUnsupported` call in `src/`, and `tests/docs_runtime_contract.test.mjs`
  asserts the documentation of each code and of the outcome classes.
- **The captures** are `tests/fixtures/captures/surf/*.json` with their provenance; the fidelity
  test fails if the fake drifts from them. New knobs: `zeroRowsOn`, `bookkeepingOnlyOn` on
  `createFakeSurf`.
- **`docs/api/errors.md` and `docs/api/types.md`** now carry the error and outcome contracts; S4's
  `determination` belongs next to them (`errors.md` already names the exit-code mapping D3
  promises and points forward to `determination`).
- Test count after S3: 370 (369 pass, 1 skipped); `npm run check` ~13 s.
