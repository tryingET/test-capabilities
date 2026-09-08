---
summary: "Closeout of the 2026-09-07 surf-learnings programme: what the six design packets set out to change, what each of the eleven slices actually delivered, the measured before/after for the whole programme (253 -> 612 tests, 88.70 -> 96.57 % lines under c8, 34 -> 64 modules, one import cycle -> none, 0.3.0 -> 0.4.0), every behaviour change a user of this framework will notice, the eleven design decisions implementation evidence changed and the slice that changed each, what was deferred and where it is filed, how to verify the whole thing from a clean checkout, and what is worth propagating to the org template."
read_when:
  - "You need to know what the 2026-09-07 surf-learnings programme changed, in one document, without reading eleven slice notes."
  - "You are about to trust a number about this repo's tests, coverage or structure and want the measured before/after with its method."
  - "You are upgrading a consumer from 0.3.x, or wondering why a run that used to pass now reports `unverified`."
  - "You want the list of what the programme deliberately did not do, and where each deferral is filed."
type: "reference"
---

# Surf learnings: programme closeout (2026-09-08)

Programme: `docs/project/2026-09-07-surf-learnings-implementation-plan.md`, slices S1 through S10, on `main`,
2026-09-07 13:00 to 2026-09-08. 59 commits (`git log --oneline bf44007..HEAD | wc -l` at the S10 closing commit), of which S10 is ten.
Inputs the plan itself was built from: the six design packets, the architecture review (amendments A1-A20), the
architecture adjudication (Part 3 claims 1-55, Part 4 consequences) and the five confirmed operator decisions D1-D5.

Every slice left a note under `docs/project/2026-09-07-slice-s<n>-notes.md` with its commits, gate outputs, live
dogfood and deviations; every live run has its own `docs/project/2026-09-07-*-live-run.md`. This document is the
programme's own summary, not a replacement for them.

## 1. What the programme set out to do

Six packets, each written against a defect this repo could demonstrate rather than a wish:

| packet | the problem it named | what it asked for |
|---|---|---|
| P1 mutation safety | a mutating step could be attempted twice, and nothing on disk said an attempt had started | effect classes, a run context, a mutation ledger whose receipts are fsynced before the act, an owned-tab browser session, an origin allowlist |
| P2 submit gate | a browser runner able to click anything could submit a form nobody reviewed | a reviewable plan artifact, a content-bound approval token, a capability-restricted runner, at-most-once submit |
| P3 frame root cause | an element the run could not reach was reported as selector drift, and the healer rewrote the selector | typed frame topology, a five-value determination, `frame_boundary` only from a confirmed link, a healer that refuses or caveats |
| P4 quality ratchet | three runtime modules the suite never loaded, five files over 700 lines, one import cycle with a live TDZ defect, docs that had drifted from the code | floors at measured truth with a ledger, a structure budget, never-imported and ring rules, contract sync |
| P5 result classification | pass/fail was derived from the absence of failure in four different places | one pure classifier, `RawResult`, an outcome with a basis, a run `Determination`, a typed error carrier |
| P6 a11y snapshot channel | the browser was observed through one tool only, and its blind spots were invisible | a read-only second observation channel as a session observer, an artifact schema that outlives its producer |

The architecture review's verdict was "revise before implementation, one round": the packets were individually sound
and defined the same shared objects two to four times each. The adjudication turned that into a two-ring evidence
kernel (a pure exported ring for classification and determination, a mediated ring that is the only code touching
the world) over replaceable adapters, with orchestration, diagnosis and healing as consumers holding no authority.

## 2. What each slice delivered

| slice | delivered | tests after |
|---|---|---|
| S1 | the healer's prefix-safe re-apply guard and `appliedCount` from proven writes; the dead command runner and `scripts/test-agent-browser.sh` deleted; the sourcemap build switch; the `capabilities -> operations -> dispatch -> demo -> orchestrator` cycle broken by a leaf `capability-matrix.ts`, with a deep-import regression test over all 35 modules; the config schema moved to `src/core/config.ts` (D4) | 257 |
| S1b | 0.4.0: `SurfFlowBuilder`, the `SurfClient` export, `createNexus`, `NexusOrchestrator`, `NexusConfig` and the default export removed before any floor was measured; quantum and prediction marked parked everywhere they are documented (D1, D2) | 259 |
| S2 | `surf-client.ts` deleted as a prerequisite (the never-imported rule has no exception list); the coverage ratchet on c8 with per-major floors, a reductions ledger and a changed-lines gate; the structure budget with size exceptions, cycle detection, never-imported, the pure-ring rule and the passport byte check; floors measured at truth | 275 |
| S3 | `Adapter.invoke` as the named kernel boundary with `spawn-step.ts` as its one process transport; the pure classifier, `RawResult` and the outcome vocabulary; `FrameworkError`, the error-code registry and the `--json` error envelope; the four agents moved out of `orchestrator.ts`; eight live surf captures as the fake's specification; Bombadil's status derived from typed fields instead of regexes | 370 |
| S4 | every sensor classifies through `ResultOutcome`; `TestResult.determination` with a basis next to `passed`; `agents.<name>.expect` declarations with provenance; explore's declared link emptiness and the refusal of undeclared `empty` readiness; the healer proposes only from `basis: fault` | 385 |
| S5 | `RunContext` minted by the kernel; the `ReceiptStore` interface with `artifacts.ts` (temp + fsync file and directory + rename, 0600, symlink refusals); the mutation ledger with write-ahead receipts, the in-doubt interlock and `--supersede-receipt`; effect classes on every operation and agent with a reason; `mutation.allowOrigins`; the ephemeral-store refusal (D5); conditional healer writes with precondition hashes | 444 |
| S6 | the kernel `Session` interface and its surf owned-tab implementation; explore rewritten as a step list over it; the static effect map, the `js` declaration and denylist, bounded revocable retry, `owned_tab_required`; `Session` exported as the browser surface with no facade | 475 |
| S7 | `surf plan` (a reviewable 0600 plan artifact with an RFC 8785 approval token over its content) and `surf apply` (a capability-restricted runner whose addressable set is the plan's fields plus, in submit mode only, one self-consuming click); the ordered refusals; one receipt per act with the post-condition as its verification | 517 |
| S8 | the pure frame topology and determination classifiers; `Session.explainUnreachable` as a read-only diagnosis in the same owned tab; `--ready-selector` and `--frame-hint`; `Finding.frameRootCause`, the `frame_boundary` root-cause class and the healer's refuse/caveat/heal rule | 563 |
| S9 | the agent-browser `Adapter` with an HTTP and a spawn invoke behind one `invoke`; the a11y snapshot observer as a read-only `Session.observe` step with its artifact on disk and a redacted envelope copy; `a11y-snapshot.v1` and the assertion evaluator in the pure ring; the doctor check | 607 |
| S10 | contract sync in pre-push and ci; the coverage floors raised to measured truth; the last fresh structure exception removed; the flake three slices had recorded, found and fixed; the packets reconciled with what shipped; the 0.4.0 release note, the posture and this closeout | 612 |

## 3. Measured before and after

| | before (`bf44007`, 2026-09-07) | after (`aee95f4`, 2026-09-08) |
|---|---|---|
| `npm test` | 253 tests, 252 pass, 1 skipped, 27 test files | 612 tests, 611 pass, 1 skipped, 43 test files |
| coverage, lines (c8, Node 26, parked directories excluded) [*] | 88.70 % | 96.57 % |
| coverage, branches [*] | 77.87 % | 86.58 % |
| coverage, functions [*] | 84.55 % | 98.44 % |
| enforced floors (Node 26) | none | lines 96.57 / branches 86.58 / functions 98.44 |
| enforced floors (Node 22) | none | lines 96.57 / branches 86.57 / functions 98.44 |
| `src/**/*.ts` | 36 modules, 10,773 lines | 64 modules, 22,369 lines |
| runtime import graph | 54 edges, **1 cycle** (a live TDZ `ReferenceError` on a deep import) | 196 edges, 0 cycles, `allowed_cycles: []` |
| files over the 700-line budget | 5, unrecorded | 4, each with a ledger entry naming its scheduled shrink |
| pure-ring modules (import neither `node:fs` nor `node:child_process`, transitively) | not a rule | 14, enforced |
| modules that may start a process | 5 hand-rolled runners | 1 transport, reachable only from 4 adapters, enforced by a source grep |
| framework error codes | none (prose messages) | 61 registered, each documented in `docs/api/errors.md` |
| artifact kinds written through one fsynced writer | 0 (ad-hoc `writeFileSync` in the healer) | 8 |
| gate stages | lint, typecheck, tests | + structure (pre-commit), + contract-sync and coverage (pre-push, ci) |
| package version | 0.3.0 | 0.4.0 |

[*] Method note, because these numbers have been quoted three ways: the c8 figures are the only comparable
series. Node's built-in `--experimental-test-coverage` does not merge grandchild coverage, so it never saw
`test-operation.ts` (S1's finding); the ratchet uses c8 with the source-map build, which does. The "before" column for the three coverage rows is therefore not `bf44007`: it is the same corpus measured with c8
on the tree as it stood at the start of S2 (after S1 and S1b), before `surf-client.ts` (65.70 % lines, 47.76 %
functions, never imported) was deleted. No c8 measurement of `bf44007` exists; the built-in reporter said
85.21 / 79.11 / 85.69 there, over a different denominator. The floors themselves were set after the 0.4.0 removals so the
ratchet never memorised deleted code.

The floors are a memory of what the fixture corpus has demonstrated, and nothing more. `npm test` drives the runtime
through a fake surf, a fake agent-browser and a fake Bombadil, all fed by captured live output; real-binary truth
stays with the dogfood lanes, `capability:drill`, `bombadil:smoke` and the passport.

## 4. What a user of this framework will notice

Behaviour changes, in the order a run meets them. The release note in `README.md` carries the same list as a
migration table with the fix for each.

1. **An exit code is no longer a verdict.** Every sensor step carries a typed outcome with a basis; the run composes
   them into `TestResult.determination {value, basis, reason}` next to `passed`, which is now
   `determination.value === "verified"`. A CLI target that exits 0 and prints nothing is `empty` / `no_evidence` and
   the run is `unverified` (exit 1) until `agents.<name>.expect.output: empty` declares that shape, which records who
   declared it. Exit codes stay 0/1 (D3).
2. **A mutating agent needs the operator's declaration.** A `bombadil` or `terminal-fuzzer` agent whose target origin
   is not in `mutation.allowOrigins` refuses with `mutation_origin_not_allowed` and spawns nothing. No flag and no
   environment variable can add an origin.
3. **A mutating step writes a receipt before it acts, and an interrupted one blocks its own repeat.** The receipt is
   fsynced (file and directory) at 0600 under `receipts.dir/<runId>/` before the act. `applied` and `failed` are
   definite; `attempting` and `unknown` refuse the next run for that key until an operator passes
   `--supersede-receipt <id>`, which the new receipt records and which never rewrites the superseded file. `doctor`
   reports the in-doubt count.
4. **A receipt store that does not survive the run is refused.** `receipts.dir` inside `$TMPDIR`, a CI job workspace
   or a disposable worktree refuses with `mutation_receipts_ephemeral` unless `receipts.ephemeral: true` accepts it,
   which every receipt then records (D5).
5. **The browser surface is a scope, not an object with authority.** `SurfClient` and `SurfFlowBuilder` are gone; the
   kernel `Session` interface with `SurfSession` replaces them. A run acts only in the tab it created, every surf
   command carries a static effect class the caller cannot override, page-side `js` has no class until the caller
   declares one, and a `read_only` claim is checked against a denylist before any process starts.
6. **A form mutation is a prepared act.** `surf plan` writes what an operator reviews; `surf apply` carries out that
   artifact and nothing else, filling by default and submitting only with `--submit`, `--confirm-plan <token>`
   recomputed from the plan's content, and an allowlisted origin. A submitted plan is never submitted twice; a
   post-condition that never arrives leaves `submitted: "unknown"` and burns the plan.
7. **An unreachable element gets an answer that knows what it does not know.** `surf explore --ready-selector` puts a
   selector into the readiness gate; a selector the gate cannot reach gets one read-only `frame.diagnose` in the same
   tab and a determination: `excluded`, `confirmed`, `suspected`, `undetermined` or `unavailable`. Only `confirmed`
   (which in this release line requires the test author's `--frame-hint`) files `frame_boundary`; everything short of
   `excluded` is `browser_coverage_gap`, a limit of the sensor rather than a fault of the target. The healer refuses a
   confirmed boundary with the `frame.switch` the repair needs and caveats a suspected one into review, so a
   frame-suspected page never heals without a human.
8. **A page can be observed twice.** `surf explore --a11y-snapshot[=required]` or
   `agents.<name>.observation.a11ySnapshot` attaches agent-browser to the tab surf already owns, reads once, and
   writes `a11y-snapshot.v1` at 0600 next to the receipts; the envelope carries the digest, the refs map, the role
   counts and `semanticCoverage` (what the DOM counted against what the tree could name). Off by default, and an
   envelope without the flag is byte-comparable to one from before the channel existed.
9. **Failures are typed.** Text mode prints `<message> [code]` on stderr; `--json` prints
   `{"error": {code, message, details}}` on stdout and exits 1; a mutation refusal lists the blocking receipts and
   the exact `--supersede-receipt` line in `details`.
10. **Removed at 0.4.0:** `SurfClient`, `SurfFlowBuilder` and their type exports, `createNexus`, `NexusOrchestrator`,
    `NexusConfig`, the default export, the `command-runner` internals and `scripts/test-agent-browser.sh`. The
    packed surface is proved by `consumer:smoke`, and `docs/api/exports.generated.md` is the full inventory.
11. **Quantum and prediction are parked, not removed** (D1): present, tested, contacting no target, never writing a
    `Finding` or `Observation`, never influencing `passed` or the determination, excluded from the coverage floor,
    and pinned there by `tests/parked_runtime_contract.test.mjs`.

## 5. Design decisions changed by implementation evidence

Each of these is a place where the packets, the review or the plan said one thing and the code does another, with
the evidence that decided it. They are recorded in the packets themselves (`revised by implementation: S<n>`), in
the slice notes, and here.

| # | decision as designed | what shipped, and why | slice |
|---|---|---|---|
| 1 | `surf-client.ts` "stays internal until S6" | deleted in S2, before any floor was measured: the never-imported rule has no exception list, and an internal module nothing imports fails it. Floors must never memorise deleted code | S2 |
| 2 | the ratchet runs Node's built-in coverage reporter | c8, as the plan's own fallback clause: the built-in reporter does not merge grandchild coverage and never saw the CLI-only module. The published source maps also had to be relocated to be usable at all | S2 |
| 3 | a fixed 95 % changed-lines gate (imported from another repo) | the changed-lines requirement is `floors.lines` and rises with it, and the uncovered `file:line` list is printed on every run. A target ten points above demonstrated truth is the one number in the packet that Goodhart's critique reaches | P4 refinement, S2 |
| 4 | a non-zero exit from the Bombadil *terminal* runner is a property violation | `runtime_error`. Without a trace file or a documented typed signal, a non-zero exit cannot distinguish a violation from a crash, and a verdict may not claim a target fault it cannot evidence. The terminal runner can therefore never report a violation until it has a typed signal | S3 |
| 5 | the session's own tab lifecycle is receipt-free because it is "compatible with read-only steps" | still receipt-free, but now an explicit, enforced exception: `SESSION_LIFECYCLE_EFFECT` is a named constant no caller can reach, `step()` refuses every `browser_session` verb, and a contract test asserts that a full open/gate/close writes zero receipts | S6 |
| 6 | the ledger's default idempotency key (`sha256(operationId\|id\|subject\|intent)`) covers browser steps | the browser key is derived from the page, not the subject: a tab id is this run's handle, so the default key moved with it and the cross-run interlock never fired. Caught by the hang test refusing to reproduce a refusal | S6 |
| 7 | the `js` denylist enumerates `location`, `document.cookie`, `.value`, `.submit(`, ... | plus `document_assignment`: the packet's own example of a declared-mutating script (`document.title = ...`) passed a `read_only` claim untouched. A fence with a hole where its own example sits is not a fence | S6 |
| 8 | P2 Q1: fill mode does not require the origin allowlist | a fill on an undeclared origin refuses with `mutation_origin_not_allowed`. The kernel ledger consults `mutation.allowOrigins` for every mutating step whose subject is a web origin; exempting a fill would need either a false effect class or a special case inside the reference monitor. **The packet and the code are not both satisfied**, and Q1 now says so | S7 |
| 9 | P3: a frame is hidden when `zeroSize \|\| rect <= 1x1 \|\| (blank && src === "")` | the blank clause applies only to a degenerate box (`width <= 1 \|\| height <= 1`). A live 933x949 blank, src-less iframe would otherwise make its page `excluded` - the strongest claim the module makes, and the one that licenses an automatic rewrite. **An amendment, not compliance**, and the packet says so | S8 |
| 10 | P6: a page-count mismatch after the a11y channel is a stray-tab failure | agent-browser 0.35.1 strands one `about:blank` per new session, pinned or not, so the check fires on every healthy run. It is reported as evidence on the artifact and changes no verdict; making it a refusal is a packet amendment, filed as AK #5567. The accounting itself found a real leak: an unavailable channel used to run its teardown, creating the session it then ended | S9 |
| 11 | `timedOut` means the budget expired | it means the framework killed a live process tree. The budget timer and a child's exit race inside one event loop, and the loop runs timers before it delivers either event, so a parent busy past the budget reported a run that finished in 3 ms as killed by its 50 ms budget. This was the flake S6, S8 and S9 each recorded once | S10 |

## 6. The flake three slices recorded

S6 saw a wide-gate failure it could not reproduce (`actual: 50, expected: 100`), S8 and S9 each saw one, always
`bombadil agent surfaces property violations as failing findings`, always once, always on a wide run, never on a
rerun. S9 called it a standing item for S10. It was two independent races in the same test, both now fixed:

1. **The budget timer.** `spawnStep` armed the budget as a timer, and the event loop runs timers before it delivers a
   child's `exit` (poll phase) or `close` (close phase). A parent blocked past the budget - which the corpus does
   under load - reached the timer with the child's exit already waiting, marked `timedOut` and killed a process that
   had finished in 3 ms. The Bombadil agent reads `timedOut` before anything else, so a violation whose trace was
   already on disk became `budget_exhausted` (no finding, `passed: true`) or, when only one of the two agents lost the
   race, `unknown` and `edgeCases: 50`. Reproduced deterministically by blocking the loop for 300 ms with a 50 ms
   budget; the decision is now deferred by one loop turn, so a child that had already finished settles first and a
   tree that is genuinely alive is killed a millisecond later. Both kill paths are unchanged.
   Regression test: `a busy parent does not turn a finished child into a budget kill`.
2. **The shared trace file.** The two agents in that test run concurrently (`Promise.all`) against one fake binary,
   because `TEST_CAPABILITIES_BOMBADIL_BIN` names one path - and the fake wrote its trace to one fixed file, while
   `echo '{}' > "$TRACE_PATH"` truncates before it writes. An agent that stats the file inside the other's truncate
   window reads zero trace bytes, which is "no evidence of a run": `runtime_error`, `edgeCases: 0` for that agent,
   and the same `50 !== 100`. The real tool names a fresh trace per run, so the fixture was unfaithful as well as
   racy; each invocation now writes `trace-$$.jsonl`.

Both assertions that used to fail with a bare number now carry the run's findings, so the next member of this class
is diagnosed from its own failure rather than from three slices of sightings.

Standing evidence after the fixes: 50 clean corpus runs at `45b2e9f`, the commit carrying both, in an isolated worktree (40 plain, 10 under c8), plus every gate run in this slice. Before the fixture fix and after the spawn fix, one failure still occurred - the trace-file race, which is why both are recorded here rather than one. A flake of this shape is never proved absent, only
unreproduced; the two mechanisms above are proved present and fixed.

## 7. What was deferred, and where it is filed

| deferred | where it is filed |
|---|---|
| whether the a11y channel's `tabLeak` carries more than evidence (a P6 amendment) | AK #5567, projected into `governance/work-items.json` M2, posture follow-up 10 |
| `agents.<name>.readySelector`, without which a `test` run cannot produce an element-reach failure | AK #5568, work-items M2, posture follow-up 11 |
| the in-frame positive probe (`frame.switch` + a read-only query), the only way to confirm a frame boundary without a hint | AK #5569, work-items M2, posture follow-up 12, P3 open question 5 |
| `SideEffectWitness`; `within` landmark scoping and a structured a11y producer; the http adapter; exit code 2 for the third determination state; a shared `Spec` artifact; a persistent CI receipt store; a cross-run receipt index; per-click Bombadil receipts; the `src/core/kernel/` and `src/core/adapters/` directory move | named in the plan's §1, restated in posture follow-up 13 |
| the four files still over the 700-line budget | `structure-budget.json` ledger entries, each naming its scheduled shrink; posture follow-up 14 |
| a typed terminal signal that would let the Bombadil terminal runner report a violation again | S3 slice note, "what S4 must know"; not yet a task |

## 8. How to verify this from a clean checkout

```bash
git clone <this repo> && cd test-capabilities
npm ci                      # c8, biome, tsgo, cucumber, fast-check are devDependencies
npm run check               # lint, typecheck, 612 tests, 4 cucumber scenarios, contract-sync, the coverage ratchet
npm run structure:check     # size budget, cycles, never-imported, the pure ring, passport byte identity
npm run contract:sync       # the commander/manifest/docs/schema/export contracts
npm run release:check       # the above plus truth:gate and consumer:smoke on the packed tarball
```

`npm run check` is the gate CI runs; it needs no browser and no external binary. Expect roughly 45 s on a 64-core
workstation, of which the coverage ratchet is about 24 s and the test corpus about 16 s. A red from the ratchet prints the metric, the measured value, the floor, the gap and
the uncovered changed `file:line` list; a red from the structure check names the file and the ledger entry that would
authorise it; a red from contract-sync names the generated file to regenerate
(`node scripts/quality/check-contract-sync.mjs --write`).

Deeper lanes, none of which gate a commit:

```bash
npm run root-cause:corpus        # 97 fixture cases with per-class coverage floors
npm run runtime-diagnostic:corpus # a real cli-tester subprocess lane
npm run bombadil:smoke           # needs a Bombadil binary; declares its own origin and receipts
npm run capability:drill         # real surf CLI when `surf doctor` is OK, otherwise a deterministic shim
```

The live behaviour behind the fakes is recorded, not gated: `docs/project/2026-09-07-mutation-safety-live-run.md`,
`-submit-gate-live-run.md`, `-frame-root-cause-live-run.md`, `-a11y-snapshot-live-run.md` and
`-surf-cli-migration-live-run.md` carry the transcripts, with the tool versions they were taken against (surf 2.18.0,
agent-browser 0.35.1, Chrome/152). Reproducing them needs Chromium (Agent) running
(`systemd-run --user --unit chromium-agent --collect ~/.local/bin/chromium-agent.sh`), `surf doctor --browser
chromium` green, and owned tabs only.

## 9. What is worth propagating to the org template

The quality-ratchet packet named a TIP candidate and the implementation confirms which half travels.
`.copier-answers.yml` points at `~/ai-society/softwareco/copier/tpl-project-repo`, whose `package.json.j2` ships only
`test`, `lint` and `format`.

Propagate unchanged: the stage skeleton of `scripts/quality-gate.sh` (lint / typecheck / tests / structure /
contract-sync / coverage), `scripts/quality/check-structure.mjs` and `scripts/quality/coverage-ratchet.mjs`, both
baseline files with empty exceptions and floors the first `--raise` sets, and the CI wiring (`fetch-depth: 0` and
`COVERAGE_BASE`). Two findings belong with them: a repo whose tests spawn child processes needs c8 rather than
Node's built-in coverage reporter, and a build that emits source maps must relocate them relative to the published
`dist/` or nothing downstream can read them.

Keep here: `scripts/quality/check-contract-sync.mjs`. Its checks are this repo's surfaces - a capability passport
generator, a commander/route-manifest pairing, a status table in `docs/api/cli.md`, two published JSON schemas with a
zod counterpart. What generalises is the *shape*: a generated file committed next to the thing it describes, and a
gate that regenerates and compares bytes, with `--write` as the fix path a red names.

## 10. What this programme did not settle

- The coverage number measures the fixture corpus, not the binaries. It always will; the packet says so and the
  posture repeats it.
- `confirmed` frame determinations need a human's `--frame-hint` until the in-frame probe lands, so the most useful
  half of the frame work is still author-driven.
- The `test` orchestrator path cannot produce a frame determination at all until `agents.<name>.readySelector` lands.
- The submit gate has been exercised against exactly one real form, on `127.0.0.1`, by design. Its refusals are
  fixture-proved.
- Four files remain oversized, and the diagnosis consumer that would shrink `orchestrator.ts` is still a plan.
