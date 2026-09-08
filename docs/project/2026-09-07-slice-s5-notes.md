---
summary: "Slice S5: every operation and agent declares an effect class with a reason, the kernel mints the run, and a mutating step is attempted at most once behind a receipt that is fsynced to receipts.dir before the act. Six commits, 435 -> 444 tests, coverage 93.69 -> 95.98 % lines. Records the in-doubt interlock proved live against a real Bombadil run interrupted with SIGINT, the mutation.allowOrigins behaviour change for existing Bombadil configs, the ephemeral-store refusal (D5), the two error codes beyond the packet's twelve, the peer consultation on an outcome nobody can account for, and what S6 must know."
read_when:
  - "You pick up slice S6 (Session interface, surf implementation) and need the shape of RunContext, MutationLedger.runStep, EffectStep and the receipt store."
  - "A run refuses with mutation_origin_not_allowed, mutation_replay_refused, mutation_receipts_ephemeral or precondition_failed and you want to know which rule produced it and how an operator resolves it."
  - "You need the S5 gate outputs, the live interlock dogfood evidence, or the deviations from the plan with their reasons."
type: "diary"
---

# Slice S5 notes (2026-09-08)

Plan: `docs/project/2026-09-07-surf-learnings-implementation-plan.md` §3 S5. Packets:
`2026-09-07-mutation-safety-design.md` (primary; its `## Refinement (many-of-the-greats)` and the
`revised by …` entries override the earlier text), `2026-09-07-architecture-adjudication.md`
Part 4 and claims 1, 6, 47, 50, and the submit-gate packet where S5 owns what it defers
(one receipt kind, `details`, `listReceipts({planId, mode})`).

Tree before the slice: `6a4c21d` (end of S4), 385 tests / 384 pass / 1 skipped, coverage
93.69 % lines / 83.85 % branches / 94.68 % functions on floors 90.36 / 79.58 / 92.90 (Node
26.8.1, c8 12.0.0). The other session's uncommitted changes (`AGENTS.md`,
`docs/dev/EXTENSION_SOP.md`, `scripts/install-hooks.sh`, the deleted `scripts/docs-list.sh`, the
`docs:list` hunks in `package.json`) were never staged; `package.json` was not touched by this
slice at all, so the index-blob method of plan §5 was not needed.

## Commits

| commit | subject | tests after | lines/branches/functions |
|---|---|---|---|
| `50b80a5` | feat(kernel): artifacts.ts with fsync and the ReceiptStore interface (review A5, A9; adjudication 1, 6) | 395 (+10) | 93.84 / 83.77 / 94.92 |
| `a8eaea2` | feat(effects): effect classes, the mutation ledger, the durable interlock and the ephemeral refusal (D5) | 417 (+22) | 94.17 / 84.60 / 95.18 |
| `eaad04d` | feat(operations): every operation and agent declares its effect class with a reason; the allowlist gates Bombadil; quantum stays parked (review A13; adjudication 47, 50; D1, D4) | 435 (+18) | 95.22 / 85.80 / 96.46 |
| `a7e376b` | feat(heal): conditional writes with precondition hashes, receipts and --supersede-receipt | 444 (+9) | 95.98 / 86.43 / 98.29 |
| `3994854` | chore(bombadil): the richer smoke declares the origin it fuzzes and accepts its throwaway receipt store | 444 | 95.98 / 86.43 / 98.29 |
| (this note) | docs(diary): slice S5 notes | 444 | 95.98 / 86.43 / 98.29 |

Gates after every commit: `npm run check` (lint, typecheck, node tests, cucumber, structure,
coverage ratchet, changed lines) green; `npm run loop-impact-plan` printed `impact=wide` /
`next=npm run loop-impact-wide`, and `LOOP_WIDE_REASON="slice S5 commit <n> …" npm run
loop-impact-wide` (= `release:check`: check, `truth:gate ok`, `consumer:smoke ok` on the packed
tarball) passed. Changed-lines gate per commit: 96.30 %, 97.11 %, 100.00 %, 95.29 %, 100.00 %
against a 90.36 % floor. Floors were not raised (S10 owns `coverage:raise`); the tree now
measures five points above the lines floor. The pre-existing biome warning
(`tests/fixtures/fake-surf.mjs:386`, unused `tab`) is untouched and is still the only one.

## What changed in behaviour

**Nothing reaches the world without a class.** `executeCliOperation` parses the input, resolves
`OperationDefinition.effect` from it, refuses `effect_unclassified` when the result is neither
`read_only` nor `mutating`, mints the `RunContext` with that class and passes it to `execute`.
Every `execute<X>Operation` library entry point mints one too, so the library surface is governed
exactly like the CLI. Envelopes gained `runId`, `effect` (with the reason rendered, claim 50) and
`mutations`; `TestResult` gained `mutations`.

**A mutating step is attempted at most once, behind a record that outlives the process.** Before
the act, in order: the store must survive the run (D5), the origin must be in
`mutation.allowOrigins`, the key must not be replayed in this run or blocked by an in-doubt
receipt on disk, a workspace `precondition` is re-read and compared, and only then is the
`attempting` receipt written, fsynced (file *and* directory) and the step run. `applied` and
`failed` are definite; `attempting` and `unknown` refuse the next run for that key until an
operator passes `--supersede-receipt <id>`, which the new receipt records and which never
rewrites the superseded file.

**Two behaviour changes existing configs will notice**, both intended and both named in their
refusal:

1. A Bombadil (or terminal-fuzzer) agent refuses with `mutation_origin_not_allowed` until the
   operator declares the origin in `mutation.allowOrigins`. Nothing is spawned.
2. `receipts.dir` inside `$TMPDIR`, a CI job workspace or a linked git worktree refuses with
   `mutation_receipts_ephemeral` unless `receipts.ephemeral: true` (or
   `TEST_CAPABILITIES_RECEIPTS_EPHEMERAL=1`) accepts it, which every receipt then records.

**Where the receipts live is per operation** (claim 47): the `--config` directory for `test`,
`--dir` for `heal`, the working directory for everything else, all under
`.test-capabilities/receipts`, with `TEST_CAPABILITIES_RECEIPTS_DIR` overriding. `.gitignore`
now ignores `.test-capabilities/`.

**The healer writes conditionally.** `analyzeFile` stamps `fileSha256` on every proposal;
`applyProposals` is one `EffectStep` per file keyed `sha256(file | before-hash | change)` whose
precondition is re-read immediately before the rename, whose `verify` is the after-hash
read-back, and whose failure compensates only siblings whose own receipt says `applied`.
`appliedCount` counts `applied` receipts.

## Live dogfood (2026-09-08)

Chromium (Agent) was stopped; started as `chromium-agent.service` with
`systemd-run --user --unit chromium-agent --collect ~/.local/bin/chromium-agent.sh`, and stopped
again afterwards. `surf doctor --browser chromium --json`: `ok: true`, 10 pass / 0 fail. `surf`
2.18.0. `surf tab.list` showed the same single `New Tab` before and after every step.

**Read-only through the real browser.** `node bin/test-capabilities surf explore --url
https://example.com/ --json` → exit 0, `effect: {effect: "read_only", scope: "browser_session",
reason: "opens a tab it owns, reads the page and closes the tab; no step changes the target"}`,
`mutations: []`, `runId` present, both probes `success`/`evidence`, coverage `verified`.

**The interlock, against a real Bombadil run.** `scripts/capability-fixture-server.mjs` served
`examples/bombadil-rich/site` on `http://127.0.0.1:34711`; the config declared that origin in
`mutation.allow_origins` and a `bombadil` agent with a 45 s budget; the vendored Bombadil
(`external/bombadil`) drove its own Chrome, never the operator's browser.

| step | result |
|---|---|
| `test --config tc.yaml` | exit 0, health pass; receipt `ce079f77` `applied`, mode 0600, evidence `status: budget_exhausted`, `trace: …`, `traceBytes: 44` |
| the same run, SIGINT 100 ms after the receipt appeared (a driver polled `receipts.dir`, then sent SIGINT; the child died on the signal) | receipt `28599f6a` left `attempting` with no `finished_at`: the record outlived the process |
| `test --config tc.yaml --json` (rerun) | exit 1, finding `web-mutation-replay-refused`: "receipt 28599f6a… for the same idempotency key is still 'attempting' (run 5ef13256…). Nothing is known about whether that attempt took effect… run again with --supersede-receipt 28599f6a…"; `mutations: []` (nothing was attempted) |
| `doctor --json` with that store | `runtime.receipts` **warn**, `data.inDoubt: 1`, the receipt id, outcome and subject listed, and the `--supersede-receipt` line in the detail |
| `test … --supersede-receipt 28599f6a-…` | exit 0, health pass, new receipt `646f32b3` `applied` carrying `supersedes: 28599f6a…`; the superseded file is byte-for-byte unchanged (still `attempting`, still no `finished_at`) |
| the same config copied into `$TMPDIR` | finding `web-receipts-ephemeral`: "the receipt store … does not survive this run (receipts.dir is inside the temporary directory …). An interlock that is gone when the process restarts is not an interlock." Nothing spawned |
| `doctor --json` on the repo checkout | `runtime.receipts` **pass**, "0 receipts in doubt", store `<repo>/.test-capabilities/receipts`, not ephemeral (the plan's S5 dogfood) |
| `npm run bombadil:smoke` | `[pass] direct Bombadil run …`, `[pass] test-capabilities Bombadil run passes on the richer fixture`, `[pass] bombadil richer smoke complete`, after the smoke config gained the allowlist and `receipts.ephemeral: true` |

The envelope copy of the live receipt carried `evidence: []` and
`details: {agent, budget_ms}` while the file on disk carried the trace path and the status
lines: the redaction rule (review A10) working on real data.

## Peer consultation

Question to `openai-codex/gpt-6-astra` (`pi -ne -nc -nt`, ~200 words): a browser fuzzer that
*ran* and exited 0 having produced neither a trace nor any output — is settling that `unknown`
(which locks the key until a human supersedes it) defensible, or is it over-locking a case that
is really "the tool did nothing"?

Answer: `unknown` is defensible. "Exit code 0 means the process reported success, not that it
performed no mutations… Silence is absence of evidence, not evidence of no effects." Calling it
`failed` would need a guarantee that no-trace-and-no-output implies no mutation, which the typed
facts do not establish. It added one caveat: **output does not prove mutations either**, so
`applied` should be understood as "this attempt is consumed", not as proof of effect — and since
`applied` permits reruns, that permissiveness must be intentional even when the output
accompanied a timeout or a crash.

**Adopted, and the caveat adopted as documentation**: the rule is unchanged (it is the packet's
own — "a run that produced a trace is `applied` whatever its exit, a run without a trace is
`unknown`"), and `settleBombadilAttempt` now says in its doc comment that `applied` means the
attempt is consumed rather than proven, that a definite outcome deliberately does not block a
later run because a fuzz campaign is meant to be repeated, and that the case which must never
pass silently is the attempt nobody can account for. The advice is advice: it was adopted
because it restates the packet's own asymmetry (nothing may be demoted to `failed` on absence),
not because the peer said so.

## Deviations from the plan, with reasons

1. **`run-context.ts` landed in commit (2), not (1).** A `RunContext` without the ledger it
   carries is not reachable from any live path, and S2's never-imported rule has no exception
   list. The commit boundary moved; the artifact ownership did not.
2. **Two error codes beyond the packet's twelve.** `mutation_step_not_started`: a process that
   never started is knowledge ("nothing happened"), not doubt, so the receipt settles `failed`
   instead of locking the key — and `spawn_failed` is a classifier outcome code, not a
   `FrameworkError` code, so it could not carry it. `mutation_step_not_started` is documented in
   `docs/api/errors.md` with the other twelve. (No second code was added for the
   "unledgered invoke" rule; see 4.)
3. **`TEST_CAPABILITIES_RECEIPTS_DIR` and `TEST_CAPABILITIES_RECEIPTS_EPHEMERAL`.** D5 is a
   config key, but `heal`, `init` and `replacement-validation` run without a config file, so
   without an environment escape hatch a `heal` apply in a temp directory would be unresolvable.
   Both refusals name the env var beside the config key.
4. **"Mutating invokes only from `runStep`" is a static proof, not a runtime guard.**
   `tests/spawn_boundary_contract.test.mjs` masks comments and string literals, computes the
   brace-balanced span of every `ledger.runStep(` call and asserts that every `runBombadil(` /
   `runBombadilTerminalTest(` call outside `bombadil-runtime.ts` lies inside one. A runtime guard
   would need a module-global "current step" that concurrent agents could satisfy for one
   another (a false permit), and a thirteenth error code. The static check was verified against a
   deliberate violation before being kept.
5. **`agent-findings.ts` is new.** `agents.ts` reached 891 lines with the ledger steps, over the
   700-line budget, and the S3 note asks for it to stay under. The refusal/finding vocabulary
   (`AGENT_EFFECTS`, `describeLedgerRefusal`, `describeSurfRefusal`, `describeCliOutcome`) moved
   to a sibling module: what an agent *runs* and what it *reports* are different jobs.
6. **`orchestrator.ts` was touched** (the plan says S5 no longer touches it, the S4 note
   anticipated it): `run(context?)` threads the run to `agent.execute`, and `TestResult` gains
   `mutations`. +31 lines with a ledger entry, as the S4 note required.
7. **The envelope's `effect` is the operation's own, not the run's.** `finalizeEnvelope` takes
   the declaration explicitly, because a nested explore inside a `test` run must report its
   parent's `runId` and its own class.
8. **`tests/healing_contract.test.mjs` now imports `dist/`** like every other contract test: the
   healer reaches the kernel ledger, and Node's type stripping cannot resolve `../core/effects.js`
   from a `.ts` source file.
9. **On `failed`, `runStep` rethrows the original error** rather than wrapping it in a
   `MutationError`. The healer's compensation path and every existing message survive unchanged;
   the receipt is still on disk and in the envelope's `mutations`. Ledger *refusals*
   (`mutation_replay_refused`, `mutation_outcome_unknown`, `precondition_failed`,
   `mutation_origin_not_allowed`, `mutation_receipts_ephemeral`, `mutation_receipt_write_failed`)
   are `MutationError`s carrying `details.receipts`, and the CLI prints one line per receipt
   before the `[code]` line.
10. **`settle` may not turn a returned value into `failed`** (a step that knows it failed
    throws) and may not turn a thrown step into `applied` (only a `verify` post-read may
    promote). Both are `effect_declaration_invalid`.
11. **Four structure-budget entries**: `orchestrator.ts` 1622 → 1653,
    `surf-explore-operation.ts` 932 → 957, `self-healing.ts` 841 → 1006, plus the pure-ring
    additions `receipt-store.ts` and `effects.ts`. `effects.ts` is listed in `pure_ring` although
    Part 4's diagram calls the ledger a mediated-ring object: it reaches neither `node:fs` nor
    `node:child_process` (it writes only through the injected `ReceiptStore`), and pinning that
    costs nothing and forbids a future edit from giving the reference monitor its own I/O.
12. **The ephemeral detector trusts the caller's `TMPDIR`.** `os.tmpdir()` reads the *process*
    environment, which made a test's explicit env unusable; the detector now reads
    `TMPDIR`/`TMP`/`TEMP` from the env it was given and falls back to `os.tmpdir()` only when the
    env names none. A live consequence: a directory under `/tmp` is **not** ephemeral on a
    machine whose `TMPDIR` points elsewhere, which is why the dogfood's scratch directory was
    accepted and the `$TMPDIR` copy was refused.

## What S6 must know

- **`context.ledger.runStep(step)` is the only way to act.** `EffectStep` gives you `id`,
  `effect`, `subject`, `intent`, optional `idempotencyKey`, `precondition` +
  `readPrecondition()` (workspace only), `maxAttempts`/`retryOn` (read-only only, cap 3), `run`,
  `settle`, `observe` (read-only revocation) and `verify` (mutating promotion only). A read-only
  step writes no receipt and lands in `ledger.attempts()`.
- **The revocation seam S6 needs is `observe`.** Return a reason string from
  `observe({attempt, value, error})` and the step fails with `read_only_violation_observed` and
  forfeits its remaining budget. That is where "a probe `href` outside `acceptedProbeUrls`" and
  surf's "Inspected target navigated or closed" belong; the ledger already refuses the retry.
- **`Session` gets its context from `RunContext`**, which already carries `adapters`
  (`cli`, `surf`, `bombadil`) and `supersedeReceiptId`. Add the session to `defaultAdapters()`
  when it exists; nothing else in the mint needs to change.
- **`surf.explore` already declares `read_only` with `browser_session` scope**, and
  `executeSurfExploreOperation(input, context)` runs inside its caller's run
  (`tests/operation_kernel_contract.test.mjs` pins both the shared `runId` and the call site).
  Turning explore into a step list is therefore additive: the class and the run are in place.
- **`js` has no class**: `AdapterEffect` already returns `unclassified` for `js` and unknown surf
  verbs (`surf-adapter.ts`, S3). `resolveEffectDeclaration` refuses anything that is not one of
  the two classes with `effect_unclassified`, so `evaluate(code, {effect, reason})` only has to
  pass the declaration through; the denylist and `read_only_violation` are S6's.
- **`mutation.allowOrigins` is enforced in the ledger, not in the agent**, so `surf apply
  --submit` inherits it for free the moment its step declares `scope: "target"` with a URL
  subject.
- **`listReceipts({planId, mode})` is live** and reads `details.plan_id` / `details.mode`, which
  is what S7's rule (3) (`submit_already_attempted`) needs.
- **Test hygiene**: a suite that runs a mutating agent must set
  `TEST_CAPABILITIES_RECEIPTS_DIR` to its own temp directory and
  `TEST_CAPABILITIES_RECEIPTS_EPHEMERAL=1`, or the interlock from one test blocks the next and
  the receipts land in the checkout. `tests/orchestrator_fail_closed_contract.test.mjs`,
  `tests/healing_contract.test.mjs` and `tests/operation_kernel_contract.test.mjs` show the
  pattern; a config-driven suite declares `mutation.allow_origins` and `receipts.ephemeral`
  instead (`tests/cli_fail_closed_contract.test.mjs`, `scripts/bombadil-rich-smoke.sh`).
- **Adding an error code** still means appending to a namespaced array in
  `src/core/error-codes.ts`, adding it to `FRAMEWORK_ERROR_CODES` and documenting the row in
  `docs/api/errors.md`; `EFFECT_ERROR_CODES` is S5's and now holds thirteen.
- Test count after S5: 444 (443 pass, 1 skipped); `npm run check` ~15 s, of which the coverage
  ratchet is ~7 s.
