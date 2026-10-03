---
summary: "AK6545 bounded source/fixture evidence for terminal SurfSession transport-loss invalidation."
read_when:
  - "Inspecting the SOURCE/FIXTURE-ONLY browser interruption contract and its proof limits."
type: "reference"
task_id: 6545
status: "source-fixture-qualified; live proof pending"
---

# Surf crash interruption — AK6545

## Earlier working-tree qualification (2026-10-03)

The following records the earlier **fixture-qualified working-tree patch**, not a release or
live-runtime proof. The fresh qualification and source-delivery boundary are appended below.
The pre-existing AK6221 speed slice remains in the checkout; its 14 untouched source/test/design
paths were hash-checked byte-identical to the parent's incoming snapshot. Mixed-path edits and
new helper/tests are retained, not silently committed with unrelated incoming work.

Parent isolated build/test verification: **904 tests, 903 pass, 0 fail, 1 existing opt-in Convex
runtime skip**. Typecheck, structure/budgets and 41 focused error-registry/close/crash tests pass.
The new `surf_session_interrupted` refusal is registered in the error-code owner surface, with a
red-first contract test. The first broad isolated test invocation also exposed a missing package
root in the parent's test environment; its failed output is retained, not recast as passing.
The corrected command supplies both the isolated dist and `TEST_CAPABILITIES_PACKAGE_ROOT`.

`npm run check` is still blocked on two pre-existing generator-format differences in untracked
SCI `.ontology` snapshots; their bytes were not changed. AK6574 owns the generated-workspace
scan-boundary decision. Docs strict initially found a stale unbound CDP handoff; AK6575 archives
it as historical rather than treating obsolete commands as current guidance. Docs strict now
passes. No aggregate quality-gate pass or speed acceptance is claimed.

Parent artifacts: `/home/tryinget/.local/state/pi-quests/tmp/surf-fixes-6221-6545.AtDa3H/`.
`npm-test-corrected.txt`, `final-focused.txt`, `typecheck-final.txt`, `structure-final.txt`,
`npm-check.txt`, `error-code-red.txt`, and both docs-strict attempts preserve the actual results.
Independent final inspection `dispatch-1791021960553` reproduced the nine blockers red, then
verified all nine green against the corrected source; no new demonstrated blocker in that slice.

The operator interview keeps AK6536 pending and the live fault deferred. The
[approval packet](2026-10-03-surf-crash-live-canary-plan.md) prepares a future owned-page canary;
no live runner or fault was executed. Source/fixture proof does not satisfy AK6545's required
separately approved live canary. Audio source repair landed separately in AK6571, without changing
its installed unit or private recordings.

## Implemented behavior

Unexpected CDP close/error or a sent command's unanswered 15-second budget notifies the
session. Intentional `close`/`closeAndWait` does not. Surf `no_tab`, or a sent command's
`code=null` timeout/signal, also terminalizes the session. Startup failures and explicit
unsent/refused commands retain CLI fallback.

Loss clears owned-tab/readiness and target/frame pins. Later session operations, existing
runner steps, binding and transport retries refuse with `surf_session_interrupted`: initialize
an explicit **NEW owned-page/session**. Queued unsent commands cannot escape to CLI fallback
after the preceding command loses its reply. Internal read retries preserve the first error
without contacting either transport. Frame restoration never uses invalidated ownership.

The first pending mutation still settles `unknown`, retaining its original transport error in
the receipt. No mutation or submit is replayed. Existing flow presentation remains
`submit_postcondition_unmet` for an unknown submit; its receipt retains
`mutation_outcome_unknown` and the socket failure. A new session does not reset ledger keys or
submit-at-most-once history. Cleanup still tears down observers and ends stdio, but never
`tab.close`s a lost/reused id.

## Fixture evidence

Artifact root (repo-relative): `.tmp/ak6545-crash-1791020995-1786280/`.

- `incoming/`, `incoming-status.txt`: captured dirty incoming sources/status; existing AK6221
  and the completed teardown child were the starting point, not reverted.
- `red-build.log`, `red-source.tar.gz`, `red/dist/`, `red.log`: incoming-source snapshot runtime
  with the new fake fault injection and final contract tests: **17 tests, 3 pass / 14 fail**,
  exit 1. The original 13-test contract was run red before implementation; supplementary cases
  were also checked against that captured incoming runtime. The three controls preserve
  pre-ready fallback, explicit refusal fallback, and intentional normal teardown.
- `green-build.log`, `dist/`, `green.log`: patched fresh build, **17/17 pass**, exit 0.
- `regression.log`: `tests/surf*.test.mjs tests/cdp*.test.mjs`, **349/349 pass**, exit 0.
- `typecheck.log`, `budgets.log`, `targeted-lint.log`: typecheck, structure and changed-path
  lint results. Source budgets remain `surf-session.ts` **724** and `cdp-actions.ts` **700**;
  no budget file was changed by this child.
- `lint.log`: whole-repo lint remains blocked by two pre-existing out-of-scope
  `.ontology/snapshots` JSON formatting errors; an existing fake-DOM comma-operator warning
  is also reported. Those incoming files were not changed.
- `child.patch`, `changed-paths.txt`: child-only deltas against captured incoming files and
  new files, not the combined dirty worktree diff.

Build/test invocations (from this repo, `A` is the artifact root above):

```bash
TEST_CAPABILITIES_BUILD_DIST_DIR="$A/dist" npm run build
TEST_CAPABILITIES_DIST_ROOT="$PWD/$A/red/dist" node --test tests/surf_crash_interruption_contract.test.mjs
TEST_CAPABILITIES_DIST_ROOT="$PWD/$A/dist" node --test tests/surf_crash_interruption_contract.test.mjs
TEST_CAPABILITIES_CDP_ENDPOINT=http://127.0.0.1:9 TEST_CAPABILITIES_DIST_ROOT="$PWD/$A/dist" \
  node --test tests/surf*.test.mjs tests/cdp*.test.mjs
npm run typecheck
TEST_CAPABILITIES_DIST_ROOT="$PWD/$A/dist" npm run structure:check
npm run lint
```

New fixtures cover idle loss; plan read loss; input handled **before** reply loss; real CDP
command-budget expiry against a silent simulated peer; apply/flow interruption; submit release
reply loss and refused replay; read retry and queued-fallback blocking; `no_tab`/id reuse;
frame-body/restoration loss; observer/stdio cleanup; fresh-target initialization; and intentional
teardown. Existing stdio tests now distinguish the earlier plan's normal close from the later
interrupted apply, and child imports honor the selected isolated dist.

## Bounds / non-acceptance

SOURCE/FIXTURE-ONLY proof. Endpoints are fake loopback ephemeral ports or a closed test port;
no live CDP 9222/9223, real surf/browser, Chromium fault, installer/config lifecycle, AK mutation,
commit or push. No claim of live-browser recovery or source-owner acceptance. AK6536 interview
remains pending; the parent owns the claimed task and prepares approval separately.

## Reviewer blocker follow-up (dispatch-1791021960553)

The original green contract did not cover in-flight revocation, failing non-held cleanup,
or pending binding acquisition. The follow-up implements:

- A session guard checked synchronously at **every CDP RPC send**, including nested
  post-await action continuations. Revocation cannot repopulate frame pins or send late input;
  already-sent commands retain their original pending answer/error.
- Bounded cleanup after failed binding acquisition/proof and non-held steps, preserving the
  primary error/identity. Secondary cleanup failures are attached to `details.cleanup_errors`
  on available framework error details, or `cleanupErrors` on extensible ordinary errors;
  this does not change the primary message. Downstream error projections need not retain
  these additional fields.
- Cleanup ownership remains local through every awaited acquisition/proof check, including
  pinned-target initialization and the handoff to a held binding. Startup read failures also
  await bounded native close rather than returning after a void close request.

Follow-up artifact root: `.tmp/ak6545-blockers-1791022285-712375/`.
`incoming/` captures current incoming files; `red/dist/` was built before the source patch.
The eight initial blocker fixtures ran **8/8 red before implementation**. Final `red.log`
adds a startup-read cleanup case against the same captured runtime: **9/9 fail**, exit 1.
`green.log` uses the patched isolated `dist/`: **9/9 pass**, exit 0. Causal reply gates
witness handled focus/input or acquired binding before revocation/error; no sleep chooses
these race points. `regression.log` records **358/358** surf/stdio/flow/submit/CDP fixture
passes (the previous 349 plus these nine). `typecheck.log`, `targeted-lint.log` and
`budgets.log` record the focused checks; whole-repo lint remains blocked by the same two
incoming `.ontology` formatting errors. `child.patch`, `changed-paths.txt` and
`final-sha256.txt` delimit this follow-up's changes, not the combined dirty worktree.

The fixture-only follow-up does **not** establish full runtime/task acceptance. A native close
waiter timing out is not forced socket teardown: withheld-reply fixtures explicitly retain
one socket until the fake peer replies or test-owned cleanup destroys it. A preparation race's
caller bound does not establish background quiescence. No live effects, AK mutation, commit
or push; parent authority/AK6536 status is unchanged.

## Fresh qualification and scoped source delivery

A fresh session reloaded Git/AK authority and independently inspected the mixed slice
(`dispatch-1791025009788`). It found three additional causal gaps: CDP revocation while a
stdio refusal awaited CLI fallback; acknowledged non-held mutation followed by close failure
being classified as definite failure; and sent ENOBUFS loss being mistaken for startup failure.
The bounded follow-up (`dispatch-1791025366459`) reproduced **six failures plus one passing
read-only control**, then **seven passes**; 177 relevant contracts passed.

- Surf checks session authority at each actual dispatch, including CLI fallback after an await.
  Genuine unsent startup/refusal fallback remains supported only while authority still holds.
- Acknowledged mutating input followed by non-held cleanup failure is conservatively `unknown`,
  not definite failure. Disk receipts protect the same key in an independent run/context.
  Read-only cleanup still reports its ordinary error. This is not process-restart live proof.
- ENOBUFS kills preserve sent-loss classification. A second inspection demonstrated that a
  SIGTERM handler can exit 0 or 2, erasing Node's signal field. Two actual child-process fixtures
  failed red, then passed after forcing null exit status and retaining the buffer-kill signal.
  The analogous handled ETIMEDOUT path also reproduced two failures, then passed with null exit
  status preserving timeout terminalization. Neither a handled zero nor nonzero exit proves a
  complete answer. Startup refusals stay unsent. Independent final tester
  `dispatch-1791026641951` verified five handled-loss/startup-control cases.

AK6574's root-only `.ontology/` / `.tmp/` policy is fixture-qualified, including VCS ignore on
and off, malformed fresh/tracked source and similarly named nested source paths. Generated
snapshot bytes remain unchanged; no coverage floor or global ledger rule was relaxed.

Final declared **`npm run check` passes**: 916 tests, **915 pass, 0 fail, 1 existing opt-in skip**;
4 behavior scenarios / 25 steps pass; typecheck and contract-sync pass. Coverage: **97.35% lines,
89.41% branches, 98.69% functions; changed lines 1478/1511 (97.82%)**, above unchanged floors.
The earlier aggregate failure from a misnamed test-helper import is retained and corrected;
it was a fixture mistake, not recast as a source defect. A later aggregate run exposed an EPIPE
race in the flooding child fixture; catching its pipe error preserves the actual SIGTERM-handler
assertion (40/40 native controls verified), rather than dropping the assertion or retrying a failed
gate until green. A further coverage run exposed an 80 ms positive legacy-close fixture deadline
under parallel instrumentation. That success/API test now uses the production 1000 ms completion
budget; independent withheld-reply and stalled-preparation tests still enforce the 80 ms bound.
The causal reply-release witness is unchanged. Failed logs remain. Final aggregate, focused close,
structure/budgets and docs strict checks pass.

Evidence root: `/home/tryinget/.local/state/pi-quests/tmp/surf-landing-qualification.kcmwnV/`;
child evidence: `.tmp/bounded-surf-repairs.C10pdp/`. Logs preserve both failures and passes.
The operator explicitly selected separate policy/archive commits followed by an audited source
integration commit containing the identified AK6221 persistent-transport prerequisite, bounded
teardown and AK6545 interruption fixes. Git and attached AK evidence identify landed revisions;
this document grants no publication or runtime activation.

**Still pending:** fresh AK6221 speed qualification/acceptance, AK6545's separately approved live
canary, AK5596 installation and AK6536 acceptance. No live fault, install, restart, push, logout,
private-audio access or personal-profile/GPU change occurred. Native close timeout still is not
forced socket teardown; bounded preparation still is not background quiescence.
