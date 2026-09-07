---
summary: "Design packet: read-only vs mutating effect classification for operations and runtime steps, retries only for read-only steps, a durable receipt before every mutating attempt, an in-doubt interlock that survives the process, and healing/explore loops that cannot double-submit."
read_when:
  - "You add an operation, agent, SurfClient command, or healer write path and must declare its effect class."
  - "You are about to add a retry, fresh-tab, or restore loop anywhere in test-capabilities."
  - "You are implementing or reviewing the mutation ledger, receipt schema, or the effect_* error codes."
  - "You pick up the 2026-09-07 submit-gate packet, which builds on this one."
type: "design"
system4d:
  container: "Effect classification and receipts for every step a test run performs."
  compass: "A test framework may look as often as it needs; it may act at most once, and it must be able to prove it."
  engine: "declare effect class -> ledger checks class, key and in-doubt receipts on disk -> attempting receipt reaches disk before the act -> read-only may retry until evidence says the target moved, mutating runs once -> unknown fails closed unless one post-read proves the commit."
  fog: "The surf runtime and Bombadil are external processes; the framework can bound its own attempts, not the target's interpretation of them."
---

# Mutation safety: effect classes, single-attempt mutations, receipts (2026-09-07)

Row 1 of `docs/project/2026-09-07-surf-learnings-assessment.md`. Companion packets: submit gate (row 2, builds on the classes and receipts defined here) and result classification (row 5, decides what a failed attempt *means*; this packet decides whether it may be *repeated*).

Refined 2026-09-07 by the adjudication in `## Refinement (many-of-the-greats)` at the end of this file. Decisions it changed are marked `revised by refinement:` in the decision log; the sections above it are already the revised text.

## Problem

The failure class is: **an action believed to be preparatory or read-only was in fact a commit, and nothing recorded that a commit had been attempted.** A retry or healing loop wrapped around such an action repeats the commit.

Evidence from the sources:

- The Upwork "Set bid" incident (`contrib/docs/learnings/2026-09-06-surf-cli-go-restricted-verbs-research.md:220-227`, from the UW1 ticket diary): while *setting* the "Bid to boost" amount in what was meant to be a draft-only session, clicking the boost section's "Set bid" button submitted a real proposal (rate, cover letter, four answers, ~150 Connects). The value-setting step was classified as harmless by the author; the page treated it as a form-level commit. The derived rule: "setting any value must never click a form-level button; only the guarded `--submit` path may click, and only the button whose text matches." The probe that caused it was kept for traceability, which is the only receipt that exists of the attempt.
- surf-cli-go's `withOwnedTabRetry` (`tab_ready.go:66-114`) is documented as read-only-extractors-only; its doc comment (`:33-36`) forbids use for mutations because "replaying could apply the side effect more than once" (`2026-09-06-surf-cli-go-deep-dive.md:176-179`). The guard is a comment, not a type: nothing stops a verb author from wrapping a mutating script in it.
- The socket-level retry test (`upwork_jobs_test.go:315-384`, restricted-verbs `:281-284`) proves the fresh-tab protocol step by step for a read-only extractor; no equivalent test proves a mutating verb is attempted exactly once.
- Upstream surf `extract` now retries transient failures with a fresh tab (`2026-09-07-surf-cli-branch-dogfood.md:122`) and retries `page_timeout` even when a fresh tab cannot help (`:216`). The retry budget is decided inside surf; a caller that runs a mutating script through `extract` inherits it silently.
- In this repo the healer's re-apply guard is content-based only: `applyProposalsToContent` accepts a proposal when `oldSelector` is found at the recorded line/column (`src/healing/self-healing.ts:511-523`). A proposal `#btn` -> `#btn-new` re-applied to an already-healed file still matches (`#btn` is a prefix of `#btn-new`) and yields `#btn-new-new`. A second apply run is a double-submit today.
- `HealOperationResultEnvelope.appliedCount` is `proposals.length` when not dry-run (`src/core/operations/heal-operation.ts:519`), computed before anything proves the writes landed; `applyProposals` writes all files then restores originals on error (`self-healing.ts:462-478`) without recording which files were written or restored. A restore is itself a mutation with no receipt.

## Placement

Confirmed: this belongs in the test-capabilities operation contract, not in surf-cli or Pi.

- Every loop that could repeat an action lives here: the explore page queue (`src/core/operations/surf-explore-operation.ts:758-790`), the `extract` budget we forward through the flag allowlist (`src/core/surf-runtime.ts:728-741`), the healer's write-then-restore (`self-healing.ts:440-479`), and `SurfFlowBuilder.execute` (`src/integrations/surf-client.ts:903-983`), which any caller can invoke twice.
- surf-cli cannot classify our `js`: only the composer of a step knows whether `document.title` is read or assigned. The classification must sit where steps are composed.
- The posture doc's rule "fail closed, verify with deterministic checks" (`docs/project/product-posture.md:11`) is a framework rule; Pi's concern is agent capability (assessment rows 8-9).

One challenge to the assessment's wording "never retry a mutation": the sharper rule is "never retry a mutation *and never treat an unknown outcome as a failure that invites a rerun*". The Set-bid class is an outcome-unknown case (the tool believed draft, the page believed submitted). This packet therefore adds an explicit `unknown` outcome that fails closed instead of folding it into `failed`. The refinement sharpens it once more: `unknown` is not an error class but the residue no sender can eliminate (a lost reply is indistinguishable from a lost request), so the design must survive it rather than classify it away, and the record that an attempt was made must exist *outside the process* before the attempt, or the next run is as blind as the Set-bid probe.

## Current state

Where retries and repeatable writes happen today, and what is untyped:

| Site | Behaviour today | Untyped fact |
|---|---|---|
| `src/core/operations/types.ts:345-355` `OperationDefinition` | `id`, `route`, `description`, `inputSchema`, `execute` | no effect class; nothing in the kernel can tell `heal --dry-run` from `heal --proposal-input` |
| `src/core/surf-runtime.ts:341-389` `runSurfCommand` | one `spawnSync`, `timeout` -> `failure.code: "timeout"` | a timed-out mutating command has an unknown outcome; today it is a plain failure |
| `surf-explore-operation.ts:536-544` `runLinksProbe` | `extract --tab-id --allow-empty --ready-timeout`, no `--retry` | surf's default fresh-tab retry applies; `attempts` is copied into `links.attempts` (`types.ts:241-244`, `surf-explore-operation.ts:561`) but never declared by us |
| `surf-explore-operation.ts:632-694` `explorePage` | `tab.new` -> gate -> probes -> `tab.close` in `finally`; no retry | read-only by construction, but only by inspection: the `js` probes at `:322-335` are pure expressions because a comment says so |
| `surf-explore-operation.ts:758-790` queue loop | each URL visited once; a thrown page after the first is recorded as failed, not retried | correct, undeclared |
| `src/core/orchestrator.ts:581-590` | `Promise.all` over agents, each `execute` once | Bombadil (`:1918-1938`) and terminal-fuzzer (`:2017-2023`) click/type on the target; cli-tester runs `<targets.cli> --help` (`:2153-2160`); none carries an effect class |
| `src/integrations/surf-client.ts:791-847` `run` | one `spawn`; `type(..., {submit})` adds `--submit` (`:290-301`), `workflow` runs `do` (`:565-579`), `evaluate` runs arbitrary `js` (`:623-626`) | mutating and read-only commands share one path; `attachScreenshotIfEnabled` (`:772-789`) folds a screenshot error into `result.error` *after* a mutating click succeeded, so the caller can read a successful click as failed |
| `surf-client.ts:903-983` `SurfFlowBuilder.execute` | sequential steps, stop on first failure, no retry, no receipt | re-executing the builder replays every click |
| `heal-operation.ts:490-498`, `:515-524` | apply requires `--checkpoint-ref`; `appliedCount = proposals.length` | receipts absent; `HealMutationPosture` (`:296-302`) exists only for dry-run artifacts |
| `self-healing.ts:440-479`, `:565-598` | write-all with temp+rename, restore originals on error | restore is an unreceipted mutation; partial-failure rerun re-applies |
| `src/core/operations/init-operation.ts:74-83`, `replacement-validation-operation.ts:26,36-37` | `init` refuses overwrite without `--force`; `--out` writes JSON | workspace writes without a class or receipt |

The quantum runner is a seeded in-memory simulation with no process spawn or network call (`src/quantum/simulator.ts:160-217`, `:632-639`); it is read-only.

## Contract

New module `src/core/effects.ts`, re-exported through `src/core/operations/types.ts`.

```ts
export type EffectClass = "read_only" | "mutating";
export type MutationScope = "target" | "workspace" | "browser_session";
export interface EffectDeclaration {
  effect: EffectClass;
  scope?: MutationScope;   // required when effect === "mutating"
  reason: string;          // one line; appears in receipts and refusals
}
export type MutationOutcome = "attempting" | "applied" | "failed" | "unknown";
export type VerifyResult = "applied" | "indeterminate";   // deliberately no "absent"; see Behaviour
export interface EffectStep<T> {
  id: string;                    // stable within a run, e.g. "heal.apply:<file>"
  effect: EffectDeclaration;
  subject: string;               // file path, "<url> tab=<id>", or command display
  intent: string;
  idempotencyKey?: string;       // mutating only; default sha256(operationId|id|subject|intent)
  precondition?: string;         // mutating/workspace only; sha256 of the content the step expects to find
  maxAttempts?: number;          // read_only only; default 1, hard cap 3
  retryOn?: readonly string[];   // read_only only; default TRANSIENT_CODES
  run: (attempt: number) => Promise<T>;
  verify?: () => Promise<{ result: VerifyResult; evidence: string[] }>; // mutating only; one read-only post-read
}
export interface MutationReceipt { /* see schema below */ }
export class MutationLedger {
  constructor(runId: string, operationId: OperationId, receiptsDir: string);
  runStep<T>(step: EffectStep<T>): Promise<T>;
  receipts(): MutationReceipt[];
}
export const TRANSIENT_CODES = ["timeout", "spawn_failed", "browser_error", "page_timeout"] as const;
```

Declaration points:

- `OperationDefinition` gains a required `effect: EffectDeclaration | ((input) => EffectDeclaration)`. The function form is for mode-dependent operations (`heal`: `dryRun` -> read_only, apply -> mutating/workspace; `init`: `print` -> read_only; `replacement-validation`: `out` -> mutating/workspace). The registry resolves it before `execute` and refuses with `effect_unclassified` if the result is not one of the two classes.
- Agents in `orchestrator.ts` declare a static class: `cli-tester` read_only (reason: "runs `--help` only; assumed read-only, not verified"), `surf` read_only with `browser_session` lifecycle, `bombadil` and `terminal-fuzzer` mutating/target. `test` resolves to the worst class of its enabled agents.
- `SurfClient` gains a static command -> class map enforced in `run()`. Read-only: `read`, `page.*`, `wait*`, `screenshot`, `tab.list`, `network*`, `console`, `cookie.list`, `frame.list|diagnose|switch|main`, `extract`, `scroll.*`, `emulate.*`. Runtime-owned `browser_session`: `tab.new`, `tab.close`, `tab.switch`, `window.*`. Mutating/target: `click`, `type`, `key`, `select`, `locate.* --action`, `do`, `go|back|forward|tab.reload` on any tab. `js` is unclassified: `evaluate(code)` refuses unless the caller passes `{ effect, reason }`; a `read_only` claim is additionally checked against a static denylist (`=` assignment to `location|document.cookie|.value|.checked`, `.submit(`, `.click(`, `dispatchEvent(`, `fetch(`, `XMLHttpRequest`, `localStorage|sessionStorage|indexedDB`, `history.`); a hit refuses with `read_only_violation` and tells the caller to declare `mutating`. The explore probes at `surf-explore-operation.ts:322-335` are declared read_only in code and pass the denylist.
- Config `receipts.dir` in `test-capabilities.yaml` (default `.test-capabilities/receipts`, resolved against the config file's directory; the submit-gate packet's `surf.receipts.dir` folds into this one key). The ledger writes `<receipts.dir>/<run_id>/<receipt_id>.json` (mode 0600, through `writeJsonArtifactAtomically` with its symlink refusals). Ledger writes are framework bookkeeping, not steps: they carry no effect class and no receipt of their own, exactly as the dry-run artifacts do today. A mutating operation whose `receipts.dir` is not writable refuses before any step with `mutation_receipt_write_failed`; read-only operations never touch it.
- `precondition` and `verify` on a `read_only` step, or `precondition` on a non-`workspace` scope, refuse at declaration with `effect_declaration_invalid`.

What the ledger may and may not do per class:

| | read_only | mutating |
|---|---|---|
| attempts | up to `maxAttempts` (default 1, cap 3); a second attempt only when the error code is in `retryOn` *and* the failed attempt's evidence does not show the target moved (see Behaviour: revocation) | exactly 1; `maxAttempts > 1` or `retryOn` present refuses at declaration with `mutation_retry_refused` |
| never retried on | readiness refusals `page_login|page_challenge|page_not_found|page_error` (`surf-runtime.ts:91-98`), `empty_result`, `no_output`, evidence assertions, `read_only_violation_observed` | everything |
| same `idempotencyKey` again in one run | allowed (attempt log entry) | `mutation_replay_refused`, even after `failed` |
| same `idempotencyKey` in a later run (receipt on disk) | n/a | refused with `mutation_replay_refused` naming the receipt while any receipt for the key is `attempting` or `unknown` (in-doubt); `applied` and `failed` receipts do not block; `--supersede-receipt <receipt_id>` is the only reset and is recorded on the new receipt |
| precondition (`workspace` only) | n/a | re-read and compared immediately before the write; mismatch refuses with `precondition_failed` and writes nothing |
| receipt | none; attempt log on the envelope (`attempts: [{stepId, attempt, code}]`) | one receipt: written to `receipts.dir` with `outcome: "attempting"` and fsync'd before `run`, rewritten atomically after; the envelope carries a copy |
| outcome on `timeout`, exit `null`, signal, "Inspected target navigated or closed" | retry if budget remains and not revoked, else fail | `unknown`; then `verify` runs once if declared: `applied` promotes the outcome (receipt `verified_by: "post_read"`), `indeterminate` leaves it `unknown`; a step still `unknown` throws `mutation_outcome_unknown` and the operation fails closed |
| compensation (healer restore) | n/a | its own receipt with `compensation_of`, single attempt, only for a sibling step whose receipt is `applied`, never after `unknown`; may itself end `unknown` |

Receipt schema (`artifact_kind: "test-capabilities.mutation.receipt"`, `schema_version: 1`):

```json
{
  "schema_version": 1, "artifact_kind": "test-capabilities.mutation.receipt",
  "receipt_id": "uuid", "run_id": "uuid", "operation_id": "heal", "step_id": "heal.apply:/abs/tests/login.spec.ts",
  "effect": "mutating", "scope": "workspace", "subject": "/abs/tests/login.spec.ts",
  "intent": "replace 2 selector(s) from proposal artifact", "idempotency_key": "sha256:…",
  "attempt": 1, "started_at": "ISO", "finished_at": "ISO",
  "precondition": "sha256:…", "outcome": "applied", "verified_by": "post_read",
  "evidence": ["before sha256:…", "after sha256:…"],
  "error": { "code": "…", "message": "…" }, "checkpoint_ref": "…", "compensation_of": "uuid", "supersedes": "uuid"
}
```

Envelope changes (additive): every `CliOperationResult` member gains `effect: EffectDeclaration` and `mutations: MutationReceipt[]` (empty for read-only runs); `TestResult` gains optional `mutations?: MutationReceipt[]` like `observations`. `heal` gains `--receipt-output <file>` (apply mode only, written through `writeJsonArtifactAtomically`, `heal-operation.ts:108-136`) with `artifact_kind: "test-capabilities.heal.receipts"`: this is the *aggregate export* of the run's receipts, not their only home; the per-receipt files in `receipts.dir` exist whether or not it is passed. `heal` and every later mutating operation also gain `--supersede-receipt <receipt_id>` (apply mode only) to reset an in-doubt interlock after the operator has inspected the subject. `appliedCount` becomes the count of receipts with `outcome: "applied"`. When a mutating operation throws, the thrown `MutationError` carries `.receipts`, and the CLI prints one line per receipt (`receipt_id outcome subject`) before the error, so an `unknown` outcome is never silent.

Error codes: `effect_unclassified`, `effect_declaration_invalid`, `mutation_retry_refused`, `mutation_replay_refused` (same run, or an in-doubt receipt on disk; the message carries `receipt_id`, `outcome`, `subject`), `mutation_outcome_unknown`, `mutation_receipt_write_failed` (the `attempting` receipt did not reach disk; the step is not run), `precondition_failed`, `read_only_violation` (static, before the run), `read_only_violation_observed` (dynamic, after an attempt), `owned_tab_required` (a target-affecting surf command without `--tab-id` on a tab this run created).

## Behaviour and failure modes

- Unknown class -> refuse before any process is spawned. There is no default class.
- The `attempting` receipt is on disk before the mutating process is spawned or the first byte of a workspace file is written; a process push into an array is not a receipt. If the framework dies during the act (SIGINT from the operator is the common case, then OOM and SIGKILL), the receipt survives as `attempting` and the next run with the same key is refused until the operator supersedes it. If the *finalizing* rewrite fails, the receipt stays `attempting` and the run reports `mutation_receipt_write_failed` in addition to the step's own outcome; that is the intended failure direction.
- In-doubt interlock: before any mutating step, the ledger lists `receipts.dir` for the same `idempotency_key` and refuses on `attempting` or `unknown`. `applied` and `failed` are definite outcomes and do not block a later run: a rerun is an operator decision and a new attempt by design (the submit-gate packet's `submit_already_attempted` is a stricter per-`plan_id` policy layered on top for submits). The reset is `--supersede-receipt <receipt_id>`; the new receipt records `supersedes`, and the superseded file is never deleted or rewritten.
- Asymmetric verification: `verify` is a single read-only post-read that may promote `unknown` to `applied` when it observes evidence specific to the intent (the after-hash of the file, the exact title that was assigned, the post-condition URL the submit was expected to reach). It can never demote `unknown` to `failed`: absence of evidence in one read is not evidence of absence (a commit may be asynchronous, the tab may be gone, the page may render a draft while the server holds a submission). `verify` never triggers a retry and runs at most once.
- Revocation of read-only retry: a read-only attempt whose evidence shows the target moved forfeits its remaining budget and fails with `read_only_violation_observed`. The signals are the ones the runtime already returns: a probe `href` outside the accepted URL set (`acceptedProbeUrls`), surf's "Inspected target navigated or closed", or, when the caller captured it, a non-GET request in `network` since the attempt started. Observation cannot prevent the first submit; it prevents the second, and the second is the failure class this packet exists for. Upstream `--retry` is forwarded only for `extract` scripts that pass the denylist; every other read-only retry is ledger-level and subject to revocation.
- Workspace steps are conditional writes: the healer records the file's `sha256` at analysis time as the step's `precondition`, re-reads and compares immediately before the temp+rename, refuses with `precondition_failed` on drift, and uses the after-hash readback as `verify`. The `#btn` -> `#btn-new-new` replay is therefore refused by the precondition even where the content-based selector guard would have matched.
- Read-only retry is bounded and declared: `runLinksProbe` passes an explicit `--retry 1` so the budget is ours, and `links.attempts` must equal the ledger's attempt count or the probe is marked unverified.
- A mutating step that fails with a definite refusal from the target (surf `[code]` other than transient, healer selector mismatch) is `failed`, not retried, and the operation reports it; the operator reruns explicitly, which is a new run with a new receipt, not a retry.
- A mutating step whose process reports nothing (timeout, signal, tab navigated away) is `unknown`; the run fails with `mutation_outcome_unknown` and the receipt's `evidence` holds whatever the runtime returned. No compensation is attempted automatically for `unknown` (a restore could undo a commit that the target accepted).
- The healer's restore-on-error path is a compensation step: one receipt per restored file; if a restore fails, the run reports both receipts and stops.
- The `heal` idempotency key is `sha256(file | sha256(content before) | proposals)` and the before-hash is also the step's `precondition`; because the content hash changes on success, a legitimate second heal of a further-drifted file gets a new key, a same-run replay of the same key is refused, and a cross-run rerun after a definite `failed` (content unchanged, same key) is allowed while a rerun after an in-doubt receipt is not.
- `SurfClient.attachScreenshotIfEnabled` runs after a mutating command; its failure must no longer overwrite the command's success (`surf-client.ts:783-787`): the screenshot becomes a read-only sub-step whose error lands in `receipt.evidence`.
- `SurfFlowBuilder.execute` runs through a ledger; calling it twice on the same builder refuses with `mutation_replay_refused` for the first mutating step.

## Interaction with the surf runtime

- Owned tabs only: a run may mutate only in a tab it created (`tab.new` -> id parsed at `surf-explore-operation.ts:187-200`) and must close it in `finally` (`:686-691`). `SurfClient` target-affecting commands without a run-owned `--tab-id` refuse with `owned_tab_required`; the doctor path and `tab.list` are exempt.
- `extract` stays read-only and keeps its fresh-tab retry; the ledger records surf's `attempts` next to its own. The dogfood note that surf retries `page_timeout` on a URL-prefix mismatch (`branch-dogfood.md:216`) is an upstream inefficiency, not a safety issue, and stays upstream.
- `js` that reads is read-only when declared and denylist-clean; `js` that assigns, submits, clicks, or fetches is mutating/target and runs once. A declared-mutating `js` that ends with "Inspected target navigated or closed" is `unknown` (the navigation may be the post-commit redirect), exactly the Set-bid shape.
- `type --submit`, `do`, `locate.* --action` are mutating/target here; the submit-gate packet adds the prepare/apply gate on top. This packet guarantees one attempt, one durable receipt, and the in-doubt interlock. The submit-gate packet's `--until-url-prefix` / `--until-text` post-condition is this packet's `verify` for the submit step (its `submit_postcondition_unmet` with `submitted: "unknown"` is exactly `unknown` left standing after an `indeterminate` verify), and its receipt file is this packet's per-receipt file under `receipts.dir`; its open question Q4 is answered here.
- Bombadil is one mutating/target step per agent run; its trace path (`orchestrator.ts:1865-1867`) is the receipt evidence and its `verify`: a run that produced a trace is `applied` whatever its exit (the effects are the fuzzer's purpose), a run without a trace is `unknown`. Bombadil's internal clicks are not individually receipted.

## Non-goals

- The prepare/apply split, dry-run default, and "click only the named button" rule (row 2 packet).
- A cross-run persistent ledger with an index, locking, or compaction (revised by refinement: the ledger *does* list `receipts.dir` for in-doubt receipts with the same key before every mutating step; that is a directory listing over atomically written files, not a database). Replay protection against definite outcomes across runs still relies on `--checkpoint-ref`, changed content hashes, and the target's own refusal.
- Deciding before the run that a `read_only` claim is true; observation is post hoc and can only revoke a retry, never grant one.
- Sandboxing or parsing page-side JavaScript; the denylist is a fail-closed heuristic, not a proof.
- Rollback execution; checkpoint/restore stays with an external authority (`docs/project/2026-04-30-recovery-backed-repair-readiness.md`).
- Verifying that `<targets.cli> --help` is read-only; it is declared as an assumption and named as such in the receipt-free attempt log.
- Live-verifying `SurfClient` commands beyond explore/doctor (open in `2026-09-07-surf-cli-migration-live-run.md:35`).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A step is misclassified read_only | contract test enumerates every `OperationId`, agent type, and `SurfClient` command against the class table; `js` denylist; classification is code, reviewed in the same diff as the step; at runtime an observed navigation or non-GET request after the attempt fails it with `read_only_violation_observed` and forfeits the retry, so the repeat (the actual double-submit) does not happen |
| Denylist false positives block honest read-only `js` | the remedy is to declare `mutating` (cost: a receipt and no retry), never to weaken the list |
| More runs fail with `mutation_outcome_unknown` | intended; the message names the receipt and the subject so the operator can inspect the target instead of rerunning blind |
| Envelope shape change breaks consumers | fields are additive; `docs/api/types.md` and the capability passport updated in the same change; `consumer:smoke` covers the packed shape |
| Receipts leak workspace paths or page content | receipts carry subject, hashes, and error codes, not file bodies or page text |
| Operators surprised that Bombadil counts as mutating | behaviour change is a receipt in `TestResult.mutations`, documented in the posture map row for orchestrator sensors |
| A crash before the finalizing rewrite leaves a key locked although nothing happened | intended: the framework does not know that nothing happened; the refusal names the receipt and subject, the operator inspects and passes `--supersede-receipt`; the lock is per key, not per operation, so unrelated work proceeds |
| `verify` promotes a false `applied` | positive evidence must be specific to the intent (after-hash, the assigned value, the declared post-condition); a generic "page loaded" or "file exists" is not a verify and the contract test rejects a `verify` that returns `applied` without evidence strings |
| Retry revocation trips on benign client-side redirects | only leaving the accepted URL set revokes; redirects inside it (`acceptedProbeUrls` already models the readiness redirect) do not |
| `receipts.dir` grows without bound; operators delete it and silently reset interlocks | one subdirectory per `run_id`; nothing is deleted automatically; deletion is documented as an interlock reset with the same standing as `--supersede-receipt`, and `doctor` reports the count of in-doubt receipts |

## Verification and dogfood plan

1. Unit contract tests, `tests/effects_contract.test.mjs`: unclassified operation -> `effect_unclassified`; mutating step with `maxAttempts: 2` -> `mutation_retry_refused`; same key twice -> `mutation_replay_refused`; read-only step retried only on `TRANSIENT_CODES` and never on `page_login`/`empty_result`; mutating step under a simulated timeout -> receipt `unknown` and `mutation_outcome_unknown`; the `attempting` receipt file exists in `receipts.dir` (asserted from inside the step's `run`, i.e. before the act) and its rewrite after the act is atomic; a second ledger in a new `run_id` with the same key -> `mutation_replay_refused` naming the in-doubt receipt, allowed after `failed`, allowed with `--supersede-receipt` and the new receipt carries `supersedes`; `verify` returning `applied` promotes `unknown` with `verified_by: "post_read"`, `indeterminate` does not, and no `verify` result ever yields `failed`; `precondition`/`verify` on a read_only step -> `effect_declaration_invalid`; `--receipt-output` and the per-receipt files refuse symlinks like the proposal artifacts (`heal-operation.ts:91-106`).
2. Healing, extend `tests/healing_contract.test.mjs`: apply `#btn` -> `#btn-new` twice in one run -> second refused; across two runs -> `precondition_failed` (the content-based guard is no longer the only line), zero receipts with `applied`; content drift between analysis and write -> `precondition_failed`, file untouched; partial write failure -> one `applied`, one `failed`, one compensation receipt for the applied file only, `appliedCount` equal to applied receipts; a write that ends `unknown` (simulated rename failure after temp write) -> no compensation, `verify` readback decides.
3. Fake-surf scenario, extend `tests/fixtures/fake-surf.mjs` and `tests/helpers/fake-surf.mjs` (`calls.log` records every argv, helper `:40-42`): with `failOn: ["extract"]` (transient once) the log shows two `extract` calls and `links.attempts: 2`; with `failOn: ["type"]` a `SurfFlowBuilder` `type` step appears exactly once in the log, the receipt is `failed`, and a second `execute()` is refused. Add `FAKE_SURF_HANG_ON` so a mutating `js` can time out and produce `unknown`; while it hangs, the CLI is killed with SIGINT and the rerun with the same key must be refused by the on-disk receipt. A read_only `js` probe whose fake answer carries an `href` outside the accepted set -> `read_only_violation_observed`, exactly one call in `calls.log`.
4. Live run against Chromium (Agent) (`chromium-agent.service`, `scripts/test-agent-browser.sh`, `surf doctor --browser chromium`): (a) `surf explore --url https://github.com/nicobailon/surf-cli/releases` -> `effect.effect: "read_only"`, `mutations: []`, attempt log shows `extract` with `--retry 1`; (b) in an owned tab on `https://example.com/`, a declared-mutating `js` step `document.title = 'tc-mutation-dogfood'` -> one receipt `applied` with the title in `evidence`, a second call with the same key refused; (c) the dogfood reload script (`location.reload(); ...`) once as read-only `extract` (two attempts, fresh tab) and once as declared-mutating `js` (one attempt, `unknown`; a `verify` that reads `document.title` back promotes it to `applied` only if the title it expects is there, and for a reload it is not, so the outcome stays `unknown`; no second tab); (d) the title assignment from (b) with the CLI interrupted mid-step: the rerun is refused naming the receipt, `--supersede-receipt` lets it through, and the superseded file is unchanged; `tab.list` returns to baseline after each. Nothing is submitted anywhere.
5. Gates: `npm run check`, `npm test`, `loop-impact-plan` (then `loop-impact-wide` if it says so), passport regenerated.

## Open questions

- Should `mutations` on `TestResult` be required rather than optional once all agents declare a class? Optional for one release to keep historical envelopes valid.
- Is `scroll.*` read-only? It can trigger infinite-scroll loads; proposed read-only because it commits nothing on the target.
- Should `cli-tester` require an operator acknowledgement that `--help` is safe for their target, or is the declared assumption enough?
- Where does the `run_id` come from: per `executeCliOperation` call, or shared across an orchestrator run so agent receipts correlate? Proposed: per kernel call, threaded into the orchestrator.
- Does the submit-gate packet want the receipt to carry the prepared artifact hash, so apply can be tied to the exact prepare output? (Its Q4, receipt location, is answered by `receipts.dir`.)
- Should `applied` also block later runs for `scope: target` by default, as the submit-gate packet does per `plan_id`? Proposed no: a definite outcome does not trip the interlock; stricter per-artifact policies sit above the ledger.

## Decision log

- 2026-09-07: two classes only (`read_only`, `mutating`); no `idempotent` third class, because idempotence of a browser action is the target's property, not ours. Reaffirmed by refinement: where the framework owns the state (workspace) idempotence is expressed as a `precondition` on the step, which is a property of a write, not a class.
- 2026-09-07: `unknown` is a first-class outcome that fails closed and is never retried or auto-compensated. Refined: one read-only `verify` may promote it to `applied` on intent-specific positive evidence and may never demote it to `failed`.
- 2026-09-07: owned-tab lifecycle (`tab.new`/`tab.close`) is runtime-owned `browser_session` scope and compatible with read-only steps; anything that changes target state is mutating/target.
- 2026-09-07: `js` has no default class; callers declare, and a `read_only` claim is denylist-checked.
- 2026-09-07, revised by refinement: receipts are written to `receipts.dir` before the act and copied onto the envelope; `--receipt-output` is the aggregate export. Reason: an in-memory `attempting` record does not survive SIGINT during the act, which is precisely the blind-rerun state; a write-ahead record that is not ahead of the write on stable storage is narration, and `mutation_receipt_write_failed` could never fire for an array push.
- 2026-09-07 (refinement): in-doubt interlock across runs. A mutating step is refused while a receipt for its key is `attempting` or `unknown`; `applied` and `failed` do not block; `--supersede-receipt` is the sole reset and is recorded. Reason: an interlock that resets when the process restarts is not an interlock, and a rerun after a definite outcome is an operator decision, not a loss of knowledge.
- 2026-09-07 (refinement): a read-only retry budget is revocable by runtime evidence (`read_only_violation_observed`); declaration grants the budget, observation can only take it away. Reason: static classification is a belief about the framework's intent; the target's interpretation is only visible after the fact, and after the fact is early enough to stop the repeat.
- 2026-09-07 (refinement): workspace writes are conditional on a `precondition` hash re-checked at write time. Reason: for state the framework owns, a compare-and-swap makes the replay impossible by construction; the ledger's bookkeeping is the fallback there, not the mechanism.
- 2026-09-07 (refinement): the submit-gate packet's post-condition wait is this packet's `verify`, and its receipt file is this packet's per-receipt file; there is one receipt mechanism.
- 2026-09-07: `appliedCount` is derived from receipts, not from `proposals.length`.

## Refinement (many-of-the-greats)

## QUESTION

A fail-closed test framework acts on state it does not own (browser pages, CLI targets) through processes it does not control (surf, Bombadil), and on state it does own (workspace files). Where must the guarantee "every effect is attempted at most once, and the attempt is provable afterwards" be located: (a) in a static, author-declared effect class enforced by a per-run ledger that executes each mutating key once behind a receipt recorded before the act; (b) in runtime observation of what the target actually did; (c) in idempotent operations whose retries are free because the target or the write itself deduplicates; or (d) in transactional undo and compensation? And when the intermediary reports nothing (timeout, signal, "navigated or closed"), must the framework stop and surface `unknown`, resolve it by reading the target, or treat it as a failure that a rerun may repeat?

## MODE 1 — MANY OF THE GREATS

### School 1: At-most-once delivery (distributed systems; the two-generals result)
- Core claim: exactly-once over a channel that loses messages is impossible. A sender chooses at-most-once (never resend) or at-least-once (resend, and the receiver must deduplicate). "Exactly-once" is at-least-once plus receiver-side idempotence, and idempotence is the receiver's property, never the sender's.
- Premises: requests and replies are lost symmetrically; the sender cannot distinguish a lost request from a lost reply; the receiver's state is the only authority on whether the effect happened; time-outs carry no information about the receiver.
- Strongest case: every framework that "retries on timeout" has chosen at-least-once without receiver cooperation, which is duplicates by construction; the rate is a matter of load, not design. The only honest posture for a sender that cannot make the receiver deduplicate is at-most-once, plus an explicit name for the state it is then left in.
- What it sees that others miss: `unknown` is not an error to be classified but the irreducible residue of acting across a lossy boundary. A design is measured by how it survives `unknown`, not by how rarely it produces it.

### School 2: Write-ahead logging and two-phase commit (database transaction discipline)
- Core claim: intent must be durable before action. The log record reaches stable storage before the page is modified; a transaction in the prepared state is in doubt and is resolved by consulting the log and the coordinator, never by guessing; recovery is a first-class execution path, not an afterthought.
- Premises: the process can die at any instruction; memory is not a record; the log is the truth and the data pages are a cache of the log; anything the log does not know did not, for the purposes of recovery, happen.
- Strongest case: a receipt that lives in process memory until an envelope is printed is not a receipt. The operator's Ctrl-C during the click leaves no trace; the next run is exactly as blind as the Set-bid probe was. The ARIES rule that undo is only possible for logged work and redo only from logged intent is the whole difference between a system that recovers and one that guesses.
- What it sees that others miss: "receipt written before `run`" is a WAL claim, and a WAL claim is a durability claim. An error code for "could not record the attempting receipt" that cannot fire on an array push is a contract with nothing behind it.

### School 3: Safety-engineering interlocks (Leveson's STAMP; lockout/tagout; fail-safe on loss of signal)
- Core claim: accidents come from loss of control over state, not from component failure. On loss of state knowledge the controller must go to the safe state and stay there until a human with information resets it; automation must never re-arm itself.
- Premises: the controller's model of the process can be wrong; the hazardous condition is a wrong model combined with continued action; humans reset with information, automation resets blind; a tripped interlock that clears itself on restart is not an interlock.
- Strongest case: a retry on timeout is the controller acting on a model it has just learned is unreliable. Automatic compensation of an unknown is a second uncontrolled action taken from the same wrong model. Both convert one possible hazard into a certain one.
- What it sees that others miss: the interlock must persist beyond the process, and the reset must be a distinct, recorded human act. Everything else is a hope that the operator will not do the obvious thing, which is rerun the command.

### School 4: Effect and capability type systems (monadic IO; Koka and Effekt; object-capability discipline)
- Core claim: the authority to cause an effect must be conveyed explicitly and be visible in the program's structure. Ambient authority (any function may spawn, any string may be `js`) is the root cause; a comment is not a type; what is not in the type is not checked.
- Premises: effects are known at composition sites, not at execution sites; enforcement at construction dominates detection at runtime because it refuses the program instead of the run; the way to make a rule unbreakable is to make the rule-breaking program unwritable.
- Strongest case: `withOwnedTabRetry` forbids mutations in a doc comment and nothing enforces it; `evaluate(code)` is ambient authority to mutate through a string. If `MutationLedger.runStep` is the only path to a spawn and demands a declaration, the class of bug "someone wrapped a mutation in a retry" does not compile.
- What it sees that others miss: the denylist is a regular expression, not a proof, and the honest structure is "no class, no capability, no run". Receipts are the runtime shadow of the type: the type says *may*, the receipt says *did*.

### School 5: Idempotent by design, retries are free (Stripe idempotency keys; Kubernetes reconciliation; Helland's "Idempotence Is Not a Medical Condition")
- Core claim: transient failure is the normal case, and the correct response is to make repeated application converge. A conditional write (compare-and-swap on the content the writer expects) and a target that deduplicates by key make retries free; a "never retry" rule is a symptom of an operation that was never made idempotent.
- Premises: the sender either controls the receiver's state or can negotiate a deduplication key with it; state is reconciled toward a declared goal rather than driven by imperative steps; a timeout is an invitation to reconcile, not a reason to stop.
- Strongest case: where the framework owns the state, the whole `#btn` to `#btn-new-new` bug is the absence of a precondition. A write that checks the before-hash it expects and refuses on drift makes the replay impossible without any ledger, receipt, or human. The packet's idempotency key already contains the before-hash: the idempotence is latent, and the ledger is doing with bookkeeping what one comparison does by construction.
- What it sees that others miss: for state the framework holds, refusing to retry is not safety, it is friction, and friction is what drives operators to wrap the tool in a loop that has no safety at all.

### School 6: Dynamic side-effect detection (network interception, navigation and DOM observers, dynamic effect analysis)
- Core claim: the only ground truth about what an action did is what the target did. Declarations are beliefs. The Set-bid author's belief was wrong, and only observation of the page could have said so.
- Premises: the target is observable (network log, URL, DOM, tab lifecycle); an effect is an event, not a property of source text; classification before execution is prophecy and prophecy needs an auditor.
- Strongest case: the runtime already returns `href` in every probe, reports "Inspected target navigated or closed", and exposes `network*`. A step declared read-only that produced a POST or left the page is observably misclassified, and the static design has no place to put that fact.
- What it sees that others miss: static classification cannot be validated statically. The runtime is the only auditor of the declaration, and it is cheap because the evidence already flows through the framework.

### School 7: Self-healing test-automation practitioners (Healenium; Playwright and Cypress retry-ability; flaky-test quarantines)
- Core claim: browser testing is dominated by transient nondeterminism. A framework that halts on every mutating timeout is unusable; the operator will rerun anyway, so a refusal only relocates the retry to a less-informed actor. The job is to make retries safe and informed, not to forbid them.
- Premises: most timeouts are page-side and harmless; suites are run repeatedly by design; the operator's rerun *is* the retry loop, and it is the one loop the framework does not control.
- Strongest case: a tool whose answer to every mutating timeout is `mutation_outcome_unknown` and exit 1 will be inside a shell `until` loop within a week, and the shell loop keeps no receipts. Refusal without durable state and without a resolution path is theatre performed for the reviewer, not the target.
- What it sees that others miss: the human rerun is the retry that must be governed. A design that governs only the in-process loop has governed the one loop that was never going to double-submit twice in a row.

## MODE 2 — CONFRONTATION

### Clash 1: Effect types (School 4) vs Write-ahead logging (School 2)
- Fundamental contradiction: whether safety is a property of the program (checked before any run) or of the record (checked after any crash). Types do not survive a process death; logs do not stop a mis-typed program from spawning.
- Incompatible assumptions: School 4 assumes the interesting failures are programs that should not have been written; School 2 assumes the interesting failures are executions that were interrupted. Neither can be reduced to the other.
- What A explains better: why the surf-cli-go comment failed as a guard; why `evaluate(code)` is the hole; why classification must sit at the composition site.
- What B explains better: why the packet's "receipt before `run`" is empty as written; why SIGINT during a click is the Set-bid state again; why `mutation_receipt_write_failed` must be able to fire.
- Residual tension: none that reality demands. The type grants the capability, the log records its use; a design needs both and the packet had only the first.

### Clash 2: At-most-once and interlocks (Schools 1 and 3) vs Idempotent-by-design and practitioners (Schools 5 and 7)
- Fundamental contradiction: whether a timeout is a stop signal or a reconcile signal. This is not verbal: one side forbids the second attempt, the other side designs for it.
- Incompatible assumptions: Schools 5 and 7 assume the receiver deduplicates or the state is reconcilable by the sender; Schools 1 and 3 assume the receiver is opaque and the sender's model may be wrong. Both cannot hold for the same target.
- What A explains better: the browser and the CLI target. A "Set bid" click has no idempotency key the page honours; a rerun is a second proposal; there is nothing to reconcile toward because the goal state ("one submitted proposal") is unobservable to the sender.
- What B explains better: the workspace. The healer's file is the framework's own state, the pre-state is hashable, the post-state is readable, and the write can be conditional. Here at-most-once is pure friction: the safe rerun is available and refusing it teaches the operator to bypass the tool.
- Residual tension: irreducible for `scope: target`, fully resolvable for `scope: workspace`. The axis that decides is not the effect class but who holds an authoritative read of the post-state.

### Clash 3: Interlocks (School 3) vs Transactional undo (School 2's compensation half)
- Fundamental contradiction: whether a system in an unknown state should undo or hold. ARIES undoes uncommitted work automatically; Leveson forbids any automatic action from a wrong model.
- Incompatible assumptions: undo presumes the log is authoritative about the pre-state and the undo target is the system's own storage; the interlock presumes the effect may have escaped to a place no log describes.
- What A explains better: why restoring a healed file after an `unknown` write can destroy the very content whose fate is unknown; why "un-submitting" is not an operation.
- What B explains better: why the healer's restore of an `applied` sibling file after a definite failure is legitimate: the pre-state is logged, the storage is owned, the undo is deterministic.
- Residual tension: resolvable by scope and by outcome. Compensation is permitted for owned storage after a definite sibling failure, forbidden after `unknown`, and non-existent for external targets.

### Clash 4: Static declaration (School 4) vs Dynamic detection (School 6)
- Fundamental contradiction: prophecy versus audit. School 4 wants to refuse before the run; School 6 says only the run knows.
- Incompatible assumptions: School 4 needs effects to be decidable from the composition site; School 6 holds that for `js` and for any page-level button they are not.
- What A explains better: the never-written bug (a mutation inside a retry helper); the denylist as a cheap fence around the one undecidable primitive.
- What B explains better: the Set-bid class itself, where the declaration was sincere and wrong. Static analysis had no way to learn that "Set bid" is a form-level commit; the navigation after the click said so immediately.
- Residual tension: resolvable with an asymmetry. Observation arrives too late to prevent the first attempt and exactly early enough to prevent the second. So declaration grants a retry budget and observation may revoke it; observation may never grant one, because "no side effect observed" is the same weak evidence as a timeout.

### Clash 5: Interlocks (School 3) vs Practitioners (School 7)
- Fundamental contradiction: whether the framework's refusal is a safety property or a relocation of risk to the shell.
- Incompatible assumptions: School 3 assumes the human reset is informed; School 7 assumes the human reset is reflexive.
- What A explains better: why the retry must not be automatic and why the reset must be a distinct act.
- What B explains better: why an interlock that is not durable, not named, and not resolvable will be bypassed, and why the bypass will be worse than the thing it replaced.
- Residual tension: resolvable, and the resolution is the strongest single requirement on the packet: the refusal must be durable (it survives the process), specific (it names the receipt and the subject), resolvable (one read-only post-read may settle it), and resettable (one recorded flag). An interlock with those four properties makes the informed reset easier than the blind one, which is the only way School 3 wins against School 7 in practice.

## MODE 3 — INTEGRATION OR DECISION
- Chosen path: Contextual Dominance.
- Result: the deciding condition is whether the framework holds an authoritative read of the post-state. Where it does (the workspace), School 5 dominates: writes are conditional on the expected pre-state, the post-state is read back, and the replay is impossible by construction; the ledger is bookkeeping there, not the mechanism. Where it does not (browser and CLI targets, where the commit may live server-side), Schools 1, 2 and 3 dominate together: at-most-once, a durable intent record ahead of the act, and an interlock that persists across processes and is reset only by a recorded human act. School 4 supplies the structure both regimes share: no class, no capability, no run; `runStep` is the only path to an effect. School 6 is subordinate in both regimes as the auditor that can revoke a read-only retry but never grant one. School 7 is not a design school but the pressure that fixes the interlock's four properties (durable, specific, resolvable, resettable). On `unknown`: it stands as the outcome; one intent-specific read-only post-read may promote it to `applied`; nothing may demote it to `failed`; nothing retries it; nothing compensates it.
- Why this path is justified: the schools are not disagreeing about the same object. Schools 5 and 7 are right about state whose post-condition the framework can read; Schools 1 and 3 are right about state it cannot. A true synthesis would have to invent a post-state read for the browser target that does not exist, and an explicit preference for either side would either forbid the safe workspace rerun or permit the unsafe browser one. The scope field already in the contract is the seam along which the dominance splits, so the split costs the design nothing.
- What remains unresolved: the first attempt. Classification expresses the framework's intent, not the target's interpretation, and a sincere `mutating` click on the wrong button is still a submission; only the submit-gate packet's prepare/apply narrows that, and only to the button it identified. Second, the two-generals residue survives even the durable receipt: a receipt lost to disk failure between the fsync and the act leaves the framework blind, and that is accepted as a disk failure, not a design gap. Third, the verify asymmetry means some `unknown` outcomes that were in fact failures stay locked until a human looks; that cost is chosen.

## PRACTICAL CONSEQUENCE

If this analysis is taken seriously, the packet changes in six places, and all six are already folded into the sections above.

1. The `attempting` receipt is durable before the act: written to `receipts.dir/<run_id>/<receipt_id>.json`, fsync'd, then the process is spawned or the file is written. `--receipt-output` becomes the aggregate export. `mutation_receipt_write_failed` becomes a refusal that can actually fire.
2. The interlock persists across runs: before any mutating step the ledger lists `receipts.dir` for the same key and refuses on `attempting` or `unknown`. Definite outcomes (`applied`, `failed`) do not block; `--supersede-receipt <id>` is the sole, recorded reset.
3. Verification is asymmetric: an optional read-only `verify` may promote `unknown` to `applied` on intent-specific evidence (after-hash, assigned value, post-condition URL) and can never produce `failed` or a retry. The submit-gate packet's `--until-*` wait is this `verify`.
4. Read-only retry is revocable: a probe `href` outside the accepted set, "navigated or closed", or a non-GET request after a read-only attempt fails it with `read_only_violation_observed` and forfeits the budget. The first submit cannot be prevented by observation; the second can, and the second is the failure class.
5. Workspace writes are conditional: the healer's before-hash is a `precondition` re-checked immediately before the rename (`precondition_failed`), and the after-hash readback is its `verify`. For owned state the mechanism is compare-and-swap; the ledger is the record.
6. Compensation is confined: owned storage only, after a definite sibling failure only, one receipt each, never after `unknown`, never for a target.

What does not change: two classes, no `idempotent` class, no default class for `js`, owned tabs only, and `unknown` as a first-class outcome that fails closed. The refinement did not soften any of these; it gave them somewhere to live when the process is gone.
