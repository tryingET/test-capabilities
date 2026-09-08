---
summary: "Slice S6: the kernel Session interface with the surf owned-tab implementation, explore rewritten as a step list over it, the static surf effect map and the js denylist enforced at the session boundary, and Session exported as the browser surface at 0.4.0 with no facade. Four commits, 444 -> 475 tests, coverage 95.98 -> 96.16 % lines, surf-explore-operation.ts 957 -> 872 lines with the exception lowered. Records the live dogfood (docs.python.org identical to S4, the github.com/login refusal, the declared-mutating js on example.com and its refusals), the two deviations that strengthen the packet (a stable idempotency key derived from the page rather than the tab, one denylist signal beyond the packet's list), the peer consultation on the browser_session class, and what S7, S8 and S9 must know."
read_when:
  - "You pick up slice S7, S8 or S9 and need the shape of Session, BrowserStep, the effect map, the denylist and the observer contract."
  - "A browser step refuses with owned_tab_required, read_only_violation, read_only_violation_observed, effect_declaration_invalid or unsupported_surf_action and you want to know which rule produced it."
  - "You need the S6 gate outputs, the live dogfood evidence, or the deviations from the plan with their reasons."
type: "diary"
---

# Slice S6 notes (2026-09-08)

Plan: `docs/project/2026-09-07-surf-learnings-implementation-plan.md` §3 S6. Packets:
`2026-09-07-mutation-safety-design.md` (primary: the effect map, owned tabs, the `js` denylist,
revocation, `unknown`), `2026-09-07-architecture-adjudication.md` Part 4 and claims 22 and 36,
`2026-09-07-submit-gate-design.md` D8/D16 and `2026-09-07-a11y-snapshot-channel-design.md` for
what the seams must carry. Operator decision D2 (delete `SurfClient`, export `Session`, no
facade) is the shape of commit (3).

Tree before the slice: `5f97d56` (end of S5), 444 tests / 443 pass / 1 skipped, coverage
95.98 % lines / 86.43 % branches / 98.29 % functions on floors 90.36 / 79.58 / 92.90 (Node
26.8.1, c8 12.0.0). The other session's uncommitted changes (`AGENTS.md`,
`docs/dev/EXTENSION_SOP.md`, `scripts/install-hooks.sh`, the deleted `scripts/docs-list.sh`, the
`docs:list` hunks in `package.json`) were never staged; `package.json` was not touched by this
slice at all, so the index-blob method of plan §5 was not needed. `git status --short` after the
last commit lists only those five foreign paths.

## Commits

| commit | subject | tests after | lines/branches/functions |
|---|---|---|---|
| `b6bd872` | test(surf): page-model schema bump from captures, hang and mutation knobs (review A17) | 449 (+5) | 95.98 / 86.42 / 98.29 |
| `f1fc384` | feat(kernel): Session interface and the surf owned-tab implementation; explore as a step list (review A8; adjudication 22) | 475 (+26) | 96.15 / 86.70 / 98.03 |
| `dd85c7d` | refactor(surf)!: Session exported as the browser surface at 0.4.0; no facade (adjudication 36; D2) | 475 | 96.16 / 86.71 / 98.03 |
| (this note) | docs(diary): slice S6 notes | 475 | 96.16 / 86.71 / 98.03 |

Gates after every commit: `npm run check` (lint, typecheck, node tests, 4 cucumber scenarios,
structure, coverage ratchet, changed lines) green; `npm run loop-impact-plan` printed
`impact=wide` / `next=npm run loop-impact-wide`, and `LOOP_WIDE_REASON="slice S6 commit <n> …"
npm run loop-impact-wide` (= `release:check`: check, `truth:gate ok`, `consumer:smoke ok` on the
packed tarball) passed. Changed-lines gate: commit (1) test-only (no executable `src` change),
commit (2) 95.08 % (1334/1403), commit (3) 100.00 % (37/37), against a 90.36 % floor. Floors were
not raised (S10 owns `coverage:raise`); the tree now measures about six points above the lines
floor. The pre-existing biome warning (`tests/fixtures/fake-surf.mjs`, unused `tab` parameter) is
still the only one.

## What changed in behaviour

**There is one browser object, and it is a scope rather than a capability.** `Session`
(`src/core/browser-session.ts`, pure ring: the interface, the denylist and the lifecycle
declaration) with `SurfSession` (`src/core/surf-session.ts`, mediated ring) is an owned scope
over unowned state: one tab this run created, gated once by `wait.ready`, read through declared
steps that go through `context.ledger.runStep`, observed by registered read-only observers, and
closed in `finally` whatever happened. Explore, the submit gate, the frame diagnosis and the
a11y channel are step lists over it, not hooks inside an operation.

**A caller cannot supply the authority.** `BrowserStep` deliberately has no `run`: the caller
names a surf command and reads the reply, and the session decides three things the caller may
not.

1. *Which tab.* The session points every step at the tab `open()` created. A step that names a
   different `--tab-id`, a step before `open()`, and a command whose argv mapping carries no
   `--tab-id` at all are refused with `owned_tab_required` rather than run against whichever tab
   the browser has in front. `tab.list` is exempt because it addresses no tab. The lifecycle
   verbs (`tab.new|close|switch`, `window.*`, `frame.switch|main`) belong to the session, so
   `step()` refuses them too.
2. *Which class.* `Adapter.effects` decides. A declaration that contradicts a classified command
   is `effect_declaration_invalid`; only an unclassified command takes one.
3. *Which budget.* Read-only steps are capped at three attempts and revocable; mutating steps
   are attempted exactly once behind a receipt.

**`js` still has no class, and now the claim is checked.** `evaluate(code, {effect, reason})`
refuses an undeclared script with `effect_unclassified`, a mutating claim that is not scoped
`target` with `effect_declaration_invalid`, and a `read_only` claim that trips the static
denylist with `read_only_violation` - before any process exists. The same check runs over an
`extract --code` script, which is why upstream `--retry` is only ever forwarded for a script that
passed it.

**Read-only retry is bounded, ours, and revocable.** The links probe declares `maxAttempts: 2`
and passes `--retry 1` upstream, so the second attempt is the ledger's decision and appears in
its attempt log; `links.attempts` now reports the ledger's count, and an upstream `attempts`
the run did not ask for leaves the probe unverified. Both probe kinds carry the revocation seam:
a probe answering from a URL outside the set its page was gated on fails the step with
`read_only_violation_observed` and forfeits the rest of the budget. Observation cannot prevent
the first attempt; it prevents the repeat.

**An unattributable browser attempt is `unknown`, never a target fault.** `runSurfCommand` now
takes the step's class, so a transport failure on a mutating step classifies with
`basis: indeterminate`, and a process killed by a signal answers `signal_<NAME>` instead of being
read as surf's own refusal by `parseSurfErrorOutput` over an empty stderr. `settleSurfAttempt`
turns an indeterminate basis into `unknown`, which writes the receipt that locks the key.

**Explore is the same behaviour through the new seam.** Every existing explore contract test
passed unchanged after the rewrite - the envelope, the probe outcomes, the coverage grades and
the `page_login` refusal are what they were - and the live dogfood below reproduces the S4
figures exactly.

## Structure and budget after the slice

51 modules, 130 runtime edges, 0 cycles. `src/core/operations/surf-explore-operation.ts` went
957 -> 872 lines and its exception came **down** with a ledger entry (`ref b6bd872`); it is still
over the 700-line budget, and the next shrink named there is the probe/coverage split once S8
adds `frameRootCause` to the probe shape. New modules: `browser-session.ts` 290,
`surf-session.ts` 677, `surf-readiness.ts` 161. `browser-session.ts` and `surf-readiness.ts` are
in `pure_ring` (11 entries); `surf-session.ts` is not, because it drives the transport.

## Live dogfood (2026-09-08, Chromium (Agent), owned tabs, no logins)

Chromium (Agent) was stopped; started as `chromium-agent.service` with
`systemd-run --user --unit chromium-agent --collect ~/.local/bin/chromium-agent.sh`, and stopped
again afterwards. `surf doctor --browser chromium --json`: `ok: true`, 10 pass / 0 warn / 0 fail
(before the unit was started it reported 7 pass / 2 fail, which is the "browser is not running"
shape). `surf` 2.18.0. `surf tab.list` showed the same single `New Tab` (id 1075142260) before
and after every step: every owned tab was closed.

| case | result |
|---|---|
| `surf explore --url https://docs.python.org/3/ --json` | exit 0; 1 page, `readiness: ready`, both probes `verified` with `outcome success/ok/evidence`, `coverage.userFlows 100`, `status verified`, `probesVerified 2/2` - **identical to the S4 note**; `effect {read_only, browser_session}`, `mutations: []`, `runId` present |
| `surf explore --url https://github.com/login --json` | exit 1, `{"error": {"code": "page_login", "message": "Surf explore refused … page readiness is 'login' [page_login] … (1 visible password field(s); URL path /login looks like a login route; title \"Sign in to GitHub · GitHub\" mentions signing in)", "details": {"url": …, "probe": "state"}}}` - **the same refusal as S4**, now raised by `SurfSession.gate` |
| the same in text mode | `✖ Surf explore failed!` plus the `… [page_login]` line on stderr, exit 1, nothing on stdout |
| `surf explore --url https://docs.python.org/3/ --depth 2 --json` | exit 0, 6 pages, 13/13 probes verified, `userFlows 100`, seed `links {rowCount: 5, attempts: 1}`, `mutations: []` - the live proof that surf accepts `--retry 1` on `extract` and that `attempts` is the ledger's count |
| library: `read_only` claim over `document.title = 'tc-should-never-run'` | `read_only_violation`: "…was declared read_only but assigns to a document property … ('document.title =') … Nothing was sent to the browser." No `js` call was made |
| library: the same assignment declared `mutating/target` on `https://example.com/` | returned `"tc-mutation-dogfood"`; one receipt `applied`, mode 0600, `effect mutating`, `scope target`, `subject https://example.com/ tab=1075142314`, `idempotency_key sha256:7717b7b4…` |
| the same key again **in the same run** | `mutation_replay_refused` naming the receipt |
| the same key again **in a new run** | allowed, as the packet requires: `applied` is a definite outcome and does not block a later run (only `attempting`/`unknown` do). My first dogfood script expected a refusal here; the code is right and the expectation was wrong |
| a mutating step on `https://www.iana.org/` with only `example.com` allowlisted | `mutation_origin_not_allowed` before the browser was touched |
| a step naming tab `1` while the run owned tab `1075142318` | `owned_tab_required`: "A run acts only in the tab it created." |
| `session.plan({fields: []})` | `unsupported_surf_action`: "declared but not implemented in this build … Nothing was sent to the browser." |

The dogfood receipts were written under a scratch `receipts.dir` inside the checkout and deleted
afterwards; `.test-capabilities/` is gitignored and the tree is clean.

## Peer consultation

Question to `openai-codex/gpt-6-astra` (`pi -ne -nc -nt`, ~180 words): the command map calls
`tab.new`/`tab.close` *mutating* with scope `browser_session`, while the packet's decision log
says the owned-tab lifecycle is "compatible with read-only steps" and the S6 dogfood requires a
read-only explore to report `mutations: []`. Should the session's own lifecycle run as read-only
`browser_session` steps (no receipt) or as mutating steps (a receipt per open and per close)?

Answer: prefer mutating with `browser_session` scope and receipt both verbs; "compatible with
read-only steps" authorises the lifecycle *during* a read-only exploration, not an override of
the classification. Keep target mutations (`mutations: []`) and session-lifecycle mutations as
separate concepts. The risk of the read-only choice is "an unaudited exception to fail-closed
enforcement": it bypasses receipt durability and duplicate-key rejection, retries could open
extra tabs, and more broadly "allowing caller-supplied labels to override the command map creates
a classification-bypass pattern". A receipt-free lifecycle is acceptable only as an explicit,
enforced contract - not as an inference from the word "compatible".

**Adapted, not adopted.** The class stayed read-only, because the packet's decision log and S5's
`resolveEffectDeclaration` (which permits `read_only` + `browser_session` for exactly this case)
have already decided it, and because the S6 dogfood the operator set requires `mutations: []` on
an explore run - a receipt per tab open would also make every explore refuse in an ephemeral
receipt store, which is not a behaviour change this slice is allowed to make. What the peer's
risk analysis *did* change is that the exception is now explicit and enforced rather than
inferred, on all three of its points:

- **No caller-supplied label reaches it.** `SESSION_LIFECYCLE_EFFECT` is a named constant in the
  pure ring with its reason, used only by `open()` and `close()`. `step()` refuses every
  `browser_session` verb with `owned_tab_required`, so there is no path by which a caller's
  declaration overrides the map - the classification-bypass pattern the peer names cannot be
  written.
- **No retry can open extra tabs.** A second `open()` is refused, `close()` is idempotent, and
  neither is retried: the lifecycle has no budget to spend.
- **The exception is pinned.** `docs/api/api-surf.md` states it, and
  `tests/surf_session_contract.test.mjs` asserts that a full open/gate/close writes zero
  receipts and three attempt-log entries, so a future edit that starts receipting - or stops
  recording - fails the suite.

The advice is advice: it was taken as a specification of what the read-only choice must *cost*,
not as a reversal of a decision the packets had already made.

## Deviations from the plan, with reasons

1. **`surf-client.ts` was already gone.** S2 deleted it under the never-imported rule (S2
   deviation 1), so the plan's S6 commit (3) is only the replacement half: `Session`,
   `SurfSession`, `SessionReadinessRefusal`, `SESSION_LIFECYCLE_EFFECT` and the denylist are
   exported and the consumer smoke asserts both directions on the packed tarball.
2. **The fixture bump is commit (1), not (4).** The session contract tests need
   `FAKE_SURF_HANG_ON`, so the fixture had to land first; the commit is test-only and reverts on
   its own. Three knobs beyond the plan's list arrived with their consumers in commit (2):
   `FAKE_SURF_SIGNAL_ON` (a process that dies on a signal, the only way to reach an exit with no
   code that is not the caller's own budget), `navigatesAfterGate` (the page moves after the gate
   settled - the revocation shape, which no other knob can produce) and `extractAttempts` (an
   upstream retry the run did not ask for).
3. **The plan's commits (1) and (2) are one commit.** The effect map, the denylist and the
   owned-tab rule *are* `Session.step`; writing the session without them and adding them after
   would have been writing it twice. The commit boundary moved; nothing in the artifact
   ownership did.
4. **`src/core/surf-readiness.ts` is new.** With the readiness vocabulary inside it,
   `surf-session.ts` measured 768 lines, i.e. a brand-new file over the 700-line budget in the
   slice whose job is to shrink a file. Classifying a page and owning a tab are different jobs;
   the split leaves the session at 677 and the new pure module at 161, and needs no exception.
5. **The browser idempotency key is derived from the page, not from the subject.** The ledger's
   default key is `sha256(operationId|id|subject|intent)` and a browser subject carries the tab
   id, which is this run's handle rather than part of what the step means. Two runs of the same
   act get different tab ids, so the default key moved with them and the cross-run in-doubt
   interlock never fired - caught by the hang test, which refused to reproduce the refusal. The
   session now passes an explicit key built from the page URL. This is a fix to a hole the packet
   assumed closed, not a change to its rule.
6. **One denylist signal beyond the packet's list.** The packet enumerates `location`,
   `document.cookie`, `.value`, `.checked`, `.submit(`, `.click(`, `dispatchEvent(`, `fetch(`,
   `XMLHttpRequest`, storage and `history.`. That list lets `document.title = …` - the packet's
   *own* example of a declared-mutating script - pass a `read_only` claim untouched. A fence with
   a hole where its own example sits is not a fence, so `document_assignment` (assignment to any
   `document` property other than `cookie`, which keeps its named signal) was added. Eleven
   signals; the explore probe expressions all pass, and the doc test asserts every runtime signal
   has a row in `api-surf.md`.
7. **`SessionReply` carries `ok` and `failure`.** `step()` never hands a caller a failed reply -
   it raises the surf failure - but `gate()` and `close()` must see the refusal to render it, so
   the private runner has an `acceptFailure` path. The flag is not on the caller-facing
   `BrowserStep`: a caller cannot silence a failure.
8. **`BrowserStep.read` takes the attempt number.** A step that reports its own attempt count
   (`links.attempts`) must report the budget the framework spent, not one a tool claims.
9. **`explainUnreachable`, `plan` and `apply` are declared and refuse.** The plan lists
   `explainUnreachable` on the interface and the operator asked for `plan`/`apply` as seams. All
   three throw `unsupported_surf_action` naming what is not implemented and stating that nothing
   was sent to the browser; `Promise<never>` says at the type level that they return no value
   until a later slice widens them.
10. **`docs/api/api-surf.md` was rewritten, not amended.** It was a method reference for a class
    that no longer exists. Its contract test now checks the doc against the runtime's own signal
    list and command map instead of against remembered prose, so the doc cannot drift from the
    denylist silently.
11. **`prompts/web-tester.md` gained a section the plan did not specify in detail**: what the
    session will and will not do, so an LLM-authored web test is written to the rules rather than
    refused by them.
12. **One unreproduced gate failure.** The first `loop-impact-wide` after commit (3) failed one
    assertion with `actual: 50, expected: 100` (a `coverage.userFlows`, i.e. one of two explore
    probes did not verify). It has not recurred in twelve subsequent full-suite runs (3 x
    `npm test`, 6 x the orchestrator file, 3 x the full wide gate, each of which runs the suite
    twice - once plain and once under c8). Nothing in the diff explains it and no fake state is
    shared between test files; it is recorded here rather than dismissed, and S7 should re-report
    it if it appears again.

## What S7, S8 and S9 must know

- **`Session` is the seam; do not add hooks to `surf-explore-operation.ts`.** Build a
  `SurfSession`, `open()`, `gate()`, run `step()`s, `runObservers()`, `close()` in `finally`.
  `SurfSessionOptions` takes `{ context, url, runtime?, timeoutMs?, readyTimeoutMs?, idPrefix? }`;
  pass a shared `runtime` when a run visits several pages so the binary is probed once.
- **A step is `{ id, command, args?, intent, declare?, expect?, maxAttempts?, retryOn?,
  idempotencyKey?, details?, read, observe?, verify? }`.** `read(reply, attempt)` turns the
  reply into your value and may throw to fail the attempt; `observe(attempt)` returns a reason
  string to revoke the remaining budget.
- **S7:** `plan`/`apply` are declared on the interface and refuse with `unsupported_surf_action`;
  replace both, and widen `SessionActionRequest` (currently `Readonly<Record<string, unknown>>`)
  into the packet's shapes. The runner is built *from* a session, and `mutation.allowOrigins` is
  already enforced in the ledger, so a submit step that declares `scope: "target"` with a URL
  subject inherits it. **`type`, `click` and `select` are not yet reachable through `step()`**:
  their argv mappings carry no `--tab-id`, so the session refuses them under the owned-tab rule
  (`SESSION_TAB_SCOPED_COMMANDS` in `surf-session.ts` is the list to extend, in the same commit
  that teaches `translateSurfArgs` the flag). The fake already speaks `type --selector` and
  `click --selector` with `changeNavigatesTo` for the post-condition. `details` on a step lands
  on the receipt, and `listReceipts({planId, mode})` reads `details.plan_id`/`details.mode`.
- **S8:** `explainUnreachable(selector, {frameHint?})` is declared and refuses; implement it as
  `observe("frame-diagnosis")` over the same owned tab. `frame.diagnose` is already read-only and
  tab-scoped, and the fake's page model carries `frames: [{src, outOfProcess?, reachable?}]` from
  the S6 bump, so the topology comes from the fixture rather than from a count. When
  `SurfExploreProbeResult` gains `frameRootCause`, lower the explore exception again - the file
  is at 872 and the split named in the ledger is probes/coverage.
- **S9:** `observe(name, observer)` takes `{ effect, intent, required?, run(session), teardown? }`.
  Registration refuses a non-read-only declaration (`effect_declaration_invalid`) and a duplicate
  name; `runObservers()` runs them in registration order after the step list, records
  `{name, status: ok|unavailable|failed, value?, error?, code?}`, continues on an optional
  failure and rethrows a required one. `close()` tears observers down in **reverse** registration
  order *before* `tab.close`, which is the order the a11y packet needs (end the agent-browser
  session first, then the surf tab), and a teardown that throws becomes a lifecycle note instead
  of swallowing the close. `session.runId` is the kernel run id for the `--session <prefix>-<runId>`
  name, and `session.tab` gives `{id, url, openedAt}` for the `/json/list` binding.
- **Anything a step returns is what `read` returned**; `SessionReply` carries
  `{command, args, display, stdout, stderr, exitCode, outcome, ok, failure?}`. Parse surf's JSON
  with `parseSurfJsonOutput(reply.stdout, "<command>")` so the existing "returned empty output
  where JSON was expected" contract survives.
- **Adding a surf command to the session** means three edits in one commit: the class in
  `surfEffect` (`surf-adapter.ts`), the argv mapping in `translateSurfArgs` (`surf-runtime.ts`),
  and `SESSION_TAB_SCOPED_COMMANDS` (`surf-session.ts`) if it can carry `--tab-id`. The class
  table test in `tests/surf_session_contract.test.mjs` enumerates the map and will fail on a verb
  that gains no class.
- **Test hygiene is unchanged from S5**: a suite that runs a mutating step points
  `TEST_CAPABILITIES_RECEIPTS_DIR` at its own temp directory and sets
  `TEST_CAPABILITIES_RECEIPTS_EPHEMERAL=1`; `tests/surf_session_contract.test.mjs` shows the
  pattern for a session.
- Test count after S6: 475 (474 pass, 1 skipped); `npm run check` ~16 s, of which the coverage
  ratchet is ~7 s.
