---
summary: "Slice S8: the frame root cause. `surf frame.diagnose` becomes a read-only observation over the tab a run already owns, its inventory becomes typed topology, and the gate every consumer reads is a separate five-value determination in the kernel's determination shape - `confirmed` only from the test author's `--frame-hint`, `frame_boundary` only on `confirmed`, everything short of exclusion filed as a coverage gap of the sensor. Six commits, 517 -> 563 tests, coverage 96.24 -> 96.35 % lines. Records the live run (MDN suspected then confirmed, claude.ai/login read twice with two honest answers), the hidden-rule deviation the w3schools page forced, the peer consultation on it, and what S9 and S10 must know."
read_when:
  - "You pick up slice S9 or S10 and need the shape of FrameTopology, FrameRootCause, explainUnreachable or the healer's refuse/caveat/heal rule."
  - "A run refuses with element_unreachable, frame_diagnosis_failed, frame_diagnosis_undetermined or heal_frame_refused and you want to know which rule produced it."
  - "You need the S8 gate outputs, the live dogfood evidence, or the deviations from the packet with their reasons."
type: "diary"
---

# Slice S8 notes (2026-09-08)

Plan: `docs/project/2026-09-07-surf-learnings-implementation-plan.md` §3 S8. Packets:
`2026-09-07-frame-root-cause-design.md` (primary; its `## Refinement (many-of-the-greats)` and
every `revised by …` line override the earlier text),
`2026-09-07-architecture-adjudication.md` Part 4 and claims 20, 22, 36, and the S6 and S7 slice
notes for the seams this slice fills.

Tree before the slice: `82b4ae5` (end of S7), 517 tests / 516 pass / 1 skipped, coverage
96.24 % lines / 86.50 % branches / 98.00 % functions on floors 90.36 / 79.58 / 92.90 (Node
26.8.1, c8 12.0.0). The other session's uncommitted changes (`AGENTS.md`,
`docs/dev/EXTENSION_SOP.md`, `scripts/install-hooks.sh`, the deleted `scripts/docs-list.sh`, the
`docs:list` hunks in `package.json`) were never staged; `package.json` was not touched by this
slice at all, so the index-blob method of plan §5 was not needed. `git status --short` after the
last commit lists only those five foreign paths.

## Commits

| commit | subject | tests after | lines/branches/functions | changed lines |
|---|---|---|---|---|
| `1fee383` | feat(frame): pure topology/determination classifier with captured fixtures | 539 (+22) | 96.27 / 86.63 / 98.08 | 96.89 % |
| `c7520c9` | feat(session): explainUnreachable as an observe step; --ready-selector and --frame-hint on explore | 550 (+11) | 96.34 / 86.49 / 98.12 | 99.13 % |
| `f853ec2` | feat(root-cause): typed Finding.frameRootCause, frame_boundary class, healer refuse/caveat/heal rule | 560 (+10) | 96.34 / 86.46 / 98.14 | 96.79 % |
| `ec4b114` | docs(frame): the live run | 560 | 96.34 / 86.46 / 98.14 | n/a (docs) |
| `028a827` | fix(surf): plan_field_unreachable comes from the frame diagnosis, not from an iframe count | 562 (+2) | 96.35 / 86.47 / 98.14 | 100.00 % |
| (this note) | docs(diary): slice S8 notes, and the geometry boundary the peer sharpened | 563 (+1) | 96.35 / 86.47 / 98.14 | 100.00 % |

Gates after every commit: `npm run check` (lint, typecheck, node tests, 4 cucumber scenarios,
structure, coverage ratchet, changed lines) green; `npm run loop-impact-plan` printed
`impact=wide` / `next=npm run loop-impact-wide`, and `LOOP_WIDE_REASON="slice S8 commit <n> …"
npm run loop-impact-wide` (= `release:check`: check, `truth:gate ok`, `consumer:smoke ok` on the
packed tarball) passed. `npm run root-cause:corpus` grew 92 → 97 cases and is green. Floors were
not raised (S10 owns `coverage:raise`). The pre-existing biome warning
(`tests/fixtures/fake-surf.mjs`, unused `tab` parameter in `readinessGate`) is still the only
one and is still untouched.

One unreproduced gate failure, as in S6: the first `loop-impact-wide` after commit (2) failed
`bombadil agent surfaces property violations as failing findings` once. Re-running that file
alone and the full wide gate twice more did not reproduce it, and nothing in the diff touches
Bombadil. Recorded rather than dismissed; S9 should re-report it if it appears again.

Structure after the slice: 60 modules, 178 runtime edges, 0 cycles, 4 exceptions, pure ring 13.
New modules: `frame-topology.ts` 433, `frame-root-cause.ts` 463 (both in `pure_ring`),
`frame-diagnosis.ts` 292. `surf-session.ts` grew 684 → 695 and stayed under the budget, because
`explainUnreachable` is a one-line delegation to a step list that lives elsewhere - the S7
pattern. Three ledgered growths, all in files that were already oversized:
`surf-explore-operation.ts` 882 → 976, `orchestrator.ts` 1653 → 1721, `self-healing.ts`
1006 → 1192.

## What changed in behaviour

**A failure to reach an element now gets an answer, and the answer knows what it does not
know.** `Session.explainUnreachable(selector, { frameHint?, failure? })` runs one read-only
`surf frame.diagnose` in the tab the session already owns, classifies the three inventories surf
returns into typed per-frame tags, and answers in the kernel's determination shape: `excluded`,
`confirmed`, `suspected`, `undetermined`, `unavailable`. It never throws for a diagnosis that
failed - `unavailable` is one of the answers - and it writes no receipt, because it reads the
page and changes nothing.

**Topology is evidence; the determination is the gate.** That split is the whole correction the
packet's refinement made, and it is enforced by the module boundary: `frame-topology.ts` may not
conclude anything (it has no notion of a failing selector), and `frame-root-cause.ts` decides
without ever reading surf's prose. Every tag rule reads a structural field
(`crossOrigin`, `cdpFrameIds`, `extensionFrameIds`, `shadowHost`, `rect`, `blank`); surf's
warnings travel verbatim as evidence and are never parsed. A contract case strips every warning
from the MDN capture and asserts the tags and the determination are unchanged.

**`confirmed` costs the author a sentence, and nothing else earns it.** The presence of an
unreachable frame on a page is not evidence that *this* selector targeted it - most real pages
carry an embed, a consent frame or an ad - so the only positive selector-to-frame link v1
accepts is `--frame-hint 'urlPrefix=…'` or `'selector=…'` resolving to exactly one candidate
whose content script answers. A hint that resolves to zero, to several, or to an unreachable
frame is `undetermined`, never a weaker suspicion: a wrong hint is a test defect the report must
name.

**A sensor limit is not a fault of the target.** `inferRootCauseClass` reads the typed field
before any regex: `confirmed` files the new `frame_boundary` class, `suspected`, `undetermined`
and `unavailable` file `browser_coverage_gap` with the diagnosis attached, and `excluded` falls
through to the existing rules. `frame_boundary` is its own class rather than a flavour of
`selector_or_dom_drift` because the repair differs: a structural change to the step, not a
substitution.

**The healer refuses, caveats or heals.** `confirmed` refuses outright with the `frame.switch`
the repair actually needs (index or extension frame id, origin, hops); `undetermined` and
`unavailable` refuse with the reason and no suggestion, because there is no candidate list a
reviewer could check; `suspected` still proposes, with `requiresReview: true` forced and a typed
`frameCaveat`, and `heal --apply` refuses that proposal structurally - whether it arrived
through `--proposal-input` or was generated in the same run. The price, stated rather than
hidden: **a frame-suspected page never heals without a human review.**

**S7's open items are closed.** `explainUnreachable` is no longer the refusing seam;
`plan_field_unreachable` reads the diagnosis instead of an iframe count (deviation 5); and the
explore `js` probes pass `--no-screenshot`, so the surf build stops leaving a picture of the
page in `/tmp` after every probe (measured: one file per `js` call without the flag, none with
it).

## Live dogfood (2026-09-08, Chromium (Agent), owned tabs, no logins)

Full transcript in `docs/project/2026-09-07-frame-root-cause-live-run.md`. Chromium (Agent) was
stopped; started as `chromium-agent.service` with `systemd-run --user --unit chromium-agent
--collect ~/.local/bin/chromium-agent.sh`, and stopped again afterwards. `surf doctor --browser
chromium --json`: `ok: true`, 10 pass / 0 warn / 0 fail. `surf` 2.18.0. `surf tab.list` showed
the same single `New Tab` (1075142613) before and after every case.

| page | hint | determination |
|---|---|---|
| `https://example.com/` | none | **excluded**, 0 candidates |
| MDN `<iframe>` reference | none | **suspected**, 6 candidates (3 out-of-process shadow-hosted iframes + 3 nested frames) |
| MDN `<iframe>` reference | `urlPrefix=https://29c6a7b0…mdnplay.dev` | **confirmed**, `tag: out_of_process_frame`, DOM index 1 |
| `https://claude.ai/login`, read immediately | none | **excluded**, 0 candidates |
| `https://claude.ai/login`, read 8 s later | none | **suspected**, 2 candidates (invisible off-screen hCaptcha challenge frames), 2 hidden |
| `https://www.w3schools.com/html/html_youtube.asp` | none | **suspected**, 2 candidates |
| the same page | `urlPrefix=about:blank`, `urlPrefix=https://nowhere.example/`, `selector=iframe#no-such-id` | **undetermined** in all three forms |

`surf explore --url https://example.com/ --json` without a ready selector is byte-comparable to
S6/S7: `userFlows 100`, `verified`, `probesVerified 2/2`, `effect {read_only, browser_session}`,
`mutations: []`, and no `frame.diagnose` call at all.

Three of the eight committed captures are live documents (`example-com`, `mdn-iframe`,
`claude-login`); the other five are synthetic and each names the live shape it was derived from.

## Deviations from the packet and the plan, with reasons

1. **The hidden rule's blank clause is qualified by the rect.** The packet says a frame is
   hidden when `zeroSize || rect <= 1x1 || (blank && src === "")`. Measured live: the w3schools
   try-it/embed pages render a **933x949** iframe that surf reports as `blank: true, src: ""`
   (its content is written by the parent, so it carries no `src` attribute). Under the literal
   clause that frame is hidden, the page becomes `excluded` - the strongest claim this module
   makes, the one that licenses an automatic rewrite - and a target inside it would be healed
   into a lookalike in the main document, which is precisely the silent false negative the
   packet exists to prevent. The implemented rule applies the blank clause only to a degenerate
   box (width or height at most 1) - note that this is a *different* boundary from the packet's
   own clause 2, which is a pixel (`width <= 1 && height <= 1`), and the difference is now
   stated in the code and pinned in both directions. `zeroSize` and the 1x1 clause are
   untouched, so the claude.ai pixel the packet's decision log is about is still hidden. This is
   an amendment to P3, not compliance with it: the two are not both satisfied, and reconciling
   the packet's text is a follow-up for whoever owns it. Peer consultation below.
2. **`Determination` became `DeterminationOf<TValue>`.** The plan says `determineFrameRootCause`
   returns "the kernel `Determination`", and `determination.ts` already said the type would be
   reused for frames. The frame question has its own closed value set, so what is reused is the
   *shape* - value, basis, candidates, reason - with the run verdict as `DeterminationOf<
   DeterminationValue>`. Nothing about the existing `Determination` type changed for a consumer.
3. **The classifier is two modules, not one.** `frame-root-cause.ts` measured 861 lines against
   the 700-line budget. The split is the packet's own: `frame-topology.ts` is layer 1 (evidence,
   with no notion of a failing selector) and `frame-root-cause.ts` is layer 2 (the gate), which
   re-exports the topology types so a consumer still has one import site. Both are in
   `pure_ring`.
4. **`explainUnreachable` is a read-only `step()`, not an entry in the observer registry.** The
   packet calls the diagnosis an `observe` step (review A8), meaning a read-only observation on
   the session rather than a hook inside explore - which is what it is. The registry
   (`observe(name, observer)` + `runObservers()`) runs observers *after* the step list, and a
   diagnosis has to run at the moment of the failure, on the page that failed, while the tab is
   still open; routing it through the registry would either reorder S9's observers or need a
   "run just this one" API nothing else wants. It goes through `context.ledger.runStep` like
   every other step and lands in the attempt log.
5. **`plan_field_unreachable` moved onto the diagnosis, and the count survives as a named
   fallback.** S7's open item asked for this (commit `028a827`). `planFromSession` now runs the
   same observation the explore gate runs - once for the page, whatever the number of unresolved
   fields - and the determination decides: `excluded` means the page carries no frame the field
   could be missing into, so the field is simply absent (`plan_field_not_found`); anything else
   is `plan_field_unreachable` carrying `details.determination` and the candidate count. The
   iframe count survives only for a direct `buildPlan` caller that never ran a diagnosis, and
   there it now answers `determination: "unavailable"` rather than claiming a frame boundary
   from a count. Both paths are pinned.
6. **`element_unreachable` is the probe's code, and surf's own code travels beside it.** The
   packet's trigger code is `element_unreachable`; the failure underneath is surf's
   `page_timeout`. The probe's `code` becomes the framework's, and `details.surf_code` carries
   surf's, taken from the classified outcome rather than from a string the framework wrote.
7. **`--frame-hint` requires `--ready-selector`.** A hint asserts which frame a failing selector
   lives in, and without a selector to wait for nothing in an explore run can fail to be
   reached. A hint on its own is a caller believing something the run will not do, so it refuses
   with `config_invalid` before a tab is opened - the same rule S7 applied to the submit gate's
   options.
8. **A selector hint is matched narrowly, and says so.** There is no DOM here to run a selector
   engine against, so `selector=` is evaluated against the identity the inventory carries:
   `#id`, `[id=…]`, `[name=…]`, `[title=…]`, `[src^=…]`, optionally prefixed with `iframe`. A
   shape the module cannot evaluate matches nothing, which makes the determination
   `undetermined` - a hint the framework cannot check is not a hint it may act on.
9. **An unwritable diagnosis artifact is a note, not a refusal.** The raw inventory is written to
   `<receipts.dir>/<runId>/frame-diagnosis-*.json` at 0600 (review A10). A write that fails is
   recorded as `frameRootCause.artifact.error` and the determination still reaches the caller:
   the step this diagnosis explains has already failed, and losing the explanation as well
   because a directory is unwritable would delete information rather than protect anything.
   Consequence to know: a `--ready-selector` failure now creates `<receipts.dir>/<runId>/` on a
   read-only explore run, which S5's "a read-only operation never touches receipts.dir"
   invariant did not anticipate.
10. **`inferRootCauseClass` reads the marker on observations too.** The packet names the finding
    as the carrier. A sensor's own observation of the same failure carries the marker line and
    no typed field, and without reading it the finding and its observation classify differently,
    which the root-cause synthesis suppresses as ambiguous - it produced zero root causes on the
    first corpus run. The determination is a fact the run recorded, wherever it was rendered.
11. **The MDN dogfood reports six candidates, not the packet's three.** The three out-of-process
    DOM iframes are there; the other three are nested frames (an OpenStreetMap embed and an
    `about:srcdoc` document below them) that the packet's own tag table calls candidates and its
    dogfood sentence did not count. `suspected` is unchanged.
12. **The claude.ai/login expectation now has two answers, and both are recorded.** The packet
    expects `excluded` with one hidden pixel. Read immediately after `tab.new` the page has no
    iframes at all and is `excluded`; read once it has settled it carries four, two of them
    invisible 300x150 hCaptcha challenge frames parked at `y: -9999`, and is `suspected`. Open
    question 4 decided against "not in the viewport" as a hidden criterion, so `suspected` is the
    specified rule answering honestly about a page that changed since 2026-09-07.
13. **The `test` orchestrator path is not live-proved.** The surf agent calls
    `executeSurfExploreOperation({ url })` and cannot pass a ready selector, so no live `test`
    run can produce a `frame_boundary` finding today. The agent's copy of the determination, the
    class and the healer rule are proved by the contract suite and the root-cause corpus.
    Follow-up: `agents.<name>.readySelector` in the config schema.

## Peer consultation

Question to `openai-codex/gpt-6-astra` (`pi -ne -nc -nt`, ~230 words): deviation 1 - a spec says
a frame is hidden when `blank && src === ""`, and a live page renders a 933x949 blank, src-less
iframe whose content the parent writes. Under the literal rule that page becomes `excluded`,
which licenses an automatic selector rewrite. Is qualifying the clause with the rect correct for
a fail-closed system, or should the literal rule stand?

Answer, condensed: the deviation is **right for fail-closed behaviour, but it is an explicit
spec change, not compliance with the literal rule**. "`blank:true` and `src:''` do not prove an
iframe is irrelevant: a parent can populate a source-less iframe. For the live 933x949 frame,
excluding it on those flags lets uncertain evidence authorize a selector rewrite. That is
fail-open with respect to the stated safety goal." The qualification moves uncertainty towards
`suspected` → review, which is the conservative direction, and "does not prove the iframe
explains the miss; it means the framework cannot safely rule it out". Three dispositions:
keep the case `suspected`, amend the spec explicitly and add the case as a regression test, and
**"clarify the geometry boundary: `width<=1 OR height<=1` differs from `width<=1 AND
height<=1`"** - the qualification does not mean the same thing as the packet's "rect <= 1x1".

**Adopted, including the sharpening.** The rule was already what the peer recommends; what the
consultation changed is that the two boundaries are now *stated* rather than left implicit.
`isHiddenFrame`'s contract comment spells out all three clauses with their different geometry
(clause 2 is a pixel, `width <= 1 && height <= 1`; clause 3 is a degenerate box, `width <= 1 ||
height <= 1`, and only for a blank, src-less frame), a contract case pins each boundary in both
directions, and - the sharpening this slice takes from S7's peer exchange as much as from this
one - the code, the live-run doc and this note all say the packet's clause and this rule are
**not both satisfied**. Reconciling P3's text is a follow-up for whoever owns the packet. The
advice is advice: it was adopted because it restates the packet's own axiom (a determination may
never claim more than the evidence supports, and `excluded` is the strongest claim), not because
the peer said so.

Two attempts were needed. The first, ~230 words, produced nothing in 20 minutes and was killed;
the same question at ~150 words answered in about a minute, which reproduces the S3 note's
finding about prompt length exactly.

## What S9 and S10 must know

- **`Session.explainUnreachable` is implemented and never throws for a failed diagnosis.** It
  returns a `FrameRootCause` whose `determination.value` is `unavailable` with the reason. The
  only refusals it raises are the session's own lifecycle ones (`unsupported_surf_action` on a
  closed session) and `config_invalid` for a `--frame-hint` shape the framework cannot read.
- **The step list pattern held.** `frame-diagnosis.ts` takes the session, does the composition
  and keeps `surf-session.ts` a one-line delegation, exactly as `surf-plan-probe.ts` does. S9's
  a11y observer should be the same shape.
- **A run directory holds more than receipts now.** `<receipts.dir>/<runId>/` carries mutation
  receipts *and* `frame-diagnosis-*.json`, and S9's a11y artifact will join them. A test that
  counts receipts must filter on `artifact_kind === "test-capabilities.mutation.receipt"`, the
  way `FileReceiptStore.list` already does; `tests/surf_session_contract.test.mjs` shows it.
- **`ARTIFACT_KINDS` is the registry.** Add the a11y kind there before writing one.
- **The fake's `frame.diagnose` is rebuilt from the captures.** A page model entry is
  `frames: [{ src, outOfProcess?, reachable?, crossOrigin?, shadowHost?, rect?, blank?,
  zeroSize?, srcdoc?, sandbox?, id?, name?, title?, nestedUnder? }]`; `nestedUnder: <index>`
  makes a frame a child of another frame, which the DOM walk never sees. `wait.ready --selector`
  times out on a selector the page's stub DOM does not carry, which is how the contract suite
  produces an element-reach failure without a browser.
- **The overclaim grep is exported.** `CAUSALITY_OVERCLAIM_PATTERN` in
  `scripts/capability-truth-gate.mjs` is what the guard fixture runs, and the grep now also
  reads `frame-root-cause.ts`, `frame-topology.ts`, `api-surf.md` and `api-healing.md`. Adding a
  surface to the gate is one line there.
- **The root-cause corpus counts are truth locks in two places**: `scripts/capability-truth-gate.mjs`
  (`payload.total`) and `tests/root_cause_corpus_contract.test.mjs` (total, per-class and
  per-subject counts). Both must move together when the corpus grows.
- **Adding an error code** is unchanged: append to a namespaced array in
  `src/core/error-codes.ts`, add it to `FRAMEWORK_ERROR_CODES`, add a row to
  `docs/api/errors.md`, and add the array to `tests/error_codes_contract.test.mjs`'s uniqueness
  case. `FRAME_ROOT_CAUSE_ERROR_CODES` holds four; `A11Y_CHANNEL_ERROR_CODES` is S9's.
- **S10 should raise the floors**: the tree measures about six points above the lines floor and
  seven above functions. Three exceptions moved up in this slice with ledger entries, and the
  scheduled shrink they all name (the explore probe/coverage split, the diagnosis consumer for
  correlation and root cause) is still outstanding.
- Test count after S8: 563 (562 pass, 1 skipped); `npm run check` ~30 s, of which the coverage
  ratchet is ~22 s and the structure check ~5.5 s.
