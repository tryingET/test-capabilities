---
summary: "Design packet: when a browser probe or step cannot reach an element, run `surf frame.diagnose`, record the frame topology as typed evidence, and derive a fail-closed determination (excluded, confirmed, suspected, undetermined, unavailable) of whether a frame boundary explains the miss; the determination, not the topology, gates the root-cause report and what the healer may propose."
read_when:
  - "You implement the frame root-cause step in surf explore, the orchestrator root-cause synthesis, or the healer's frame refusals and caveats."
  - "You need the real `surf frame.diagnose --json` shape captured against Chromium (Agent) on 2026-09-07."
  - "You wonder why a selector failure is reported as a frame boundary (or only as a suspected one) instead of selector drift, or why heal refused or caveated its rewrite."
type: "design"
---

# Frame root cause: `frame.diagnose` as a diagnostic step (2026-09-07)

Row 3 of `docs/project/2026-09-07-surf-learnings-assessment.md`. Sibling packets: mutation safety (row 1), submit gate
(row 2, the producer of most future element-reach failures), result classification (row 5).

Refined on 2026-09-07 with the many-of-the-greats adjudication (see `## Refinement (many-of-the-greats)` at the end).
The refinement split what the first draft fused: frame *topology* (evidence), the *determination* that a frame explains
the miss (the gate), and the *permission* each consumer gets from that determination.

## Problem (evidence)

- A selector that does not match in the main document is reported today as text ("css selector ... matched zero
  elements") and classified by regex as `selector_or_dom_drift` (`src/core/orchestrator.ts:1235-1249`). The healer then
  treats every selector found in the evidence as a rewrite candidate (`src/healing/self-healing.ts:355-395`,
  `:687-718`). When the element lives in an iframe, no CSS rewrite can ever succeed: the proposal is wrong by
  construction, and a retry loop would repeat the same miss. Worse, a heuristic rewrite can land on a lookalike element
  in the main document and turn the step green: a silent false negative, the failure the result-classification packet
  exists to prevent.
- The healer has no positive evidence of its own: `validateSelector` is a local prefix heuristic (`self-healing.ts:600-604`,
  `old-`/`deprecated-`), not a live page check. Whatever the framework tells it about frames is the only frame
  knowledge it will ever have.
- The surf-cli-go deep dive (`~/ai-society/softwareco/contrib/docs/learnings/2026-09-06-surf-cli-go-deep-dive.md:186-190`)
  motivated `frame diagnose` with exactly this failure: Claude artifact widgets visible only as `about:blank` frames.
  The branch dogfood (`.../2026-09-07-surf-cli-branch-dogfood.md:105-111`) showed the three inventories disagree for
  real reasons: shadow-hosted iframes missing from a naive DOM walk (MDN: "0 iframes" vs 7 extension frames), srcdoc
  and blank frames unmatched, out-of-process iframes absent from the tab's CDP tree.
- Live capture in Chromium (Agent), 2026-09-07 (owned tabs `tab.new` / `tab.close`, no login, `tab.list` identical before
  and after; JSON saved in the session scratchpad `frame-diag/{example,mdn,claude-login}.json`):
  - `https://example.com/`: `counts {domIframes 0, extensionFrames 1, cdpFrames 1}`, `warnings []`. A selector miss here
    is not a frame problem.
  - MDN `<iframe>` reference: 3 DOM iframes, each `crossOrigin: true`, `shadowHost: "... > mdn-play-runner"`,
    `extensionFrameIds: [22]` / `[23]` / `[24]`, `cdpFrameIds: []`, `sandbox` set, `src` 600+ chars; extension frame 25
    (`about:srcdoc`, parent 24) `contentScriptReachable: false`; CDP tree lists only the main frame; 6 warnings, among
    them "is out-of-process ... frame.switch, page.read and click by ref work there" and "3 cross-origin iframe(s):
    selectors from the main page do not reach them". 3 topology tags on one page: cross-origin, out-of-process,
    shadow-hosted. Note what the capture does *not* say: nothing in it links any particular failing selector to any of
    the three frames. A typo in a main-document selector on this page produces the identical inventory.
  - `https://claude.ai/login` (readiness `login`, accepted): 1 DOM iframe `rect 1x1`, `src ""`, `blank: true`,
    `zeroSize: false`, no extension/CDP match; extension frame 29 `about:blank` unreachable; 4 CDP child frames with
    `url: ""` and no extension counterpart. The only iframe is a pixel: a selector miss here is not a frame problem,
    but surf's own `zeroSize` flag does not say so (1x1 is not 0x0), so the framework needs its own hidden rule.
- `SurfClient.diagnoseFrames` exists but nothing calls it (`src/integrations/surf-client.ts:748-766`); its result type
  is `unknown[]` per inventory (`:117-125`). Product posture lists the wiring as follow-up 9
  (`docs/project/product-posture.md:106`).

## Placement (confirm)

Confirmed for test-capabilities. surf-cli owns the *inventory* (three frame lists + warnings) and already ships it
upstream as PR #256 (`.../2026-09-07-surf-cli-upstream-prs.md:39`). What surf cannot own: which selector failed in
which test step, which frame is a plausible host for it, and what a healer is allowed to do about it. Those are
test-truth decisions. Challenge considered: put the classification into surf as `frame.diagnose --selector`. Rejected:
surf cannot query inside cross-origin frames either, so the classification would still be topology-based, and its
consumer contract (root-cause report, heal refusals) lives here. A later upstream PR may add a
`--selector` echo so the warning text names the selector; not required. Surf's warnings are prose for humans and
agents; the framework quotes them verbatim as evidence and never derives a decision from their text.

## Current state (code refs)

- Runtime: `frame.diagnose` is a known mechanism (`src/core/surf-runtime.ts:33-38`) probed at startup but not required
  by explore (`:44`); the translator appends `--json` and passes `--tab-id` (`:915-921`). Errors arrive as
  `SurfCommandError` with a surf `code` (`:67-90`, `:303-340`).
- Explore: owned tab (`src/core/operations/surf-explore-operation.ts:187-212`), readiness gate without `--selector`
  (`:266-300`), DOM probe that only counts `iframes` (`:331`), probe/page failure shapes carrying `error` and `code`
  (`:475-495`, `:604-630`), tab always closed in `finally` (`:632-697`). Result types: `src/core/operations/types.ts:223-245`.
- Orchestrator: `Finding.evidence` is `string[]` (`src/core/orchestrator.ts:245-254`); `SurfAgent` turns any explore
  failure into one critical `web` finding (`:2068-2118`) and one `coverage` observation (`:1710-1735`); classes are the
  closed list at `:268-281`; classification is regex over the corpus (`:1139-1254`).
- Healer: findings input schema (`src/core/operations/heal-operation.ts:138-168`, loaded at `:473-489`), evidence-scoped
  selector healing (`src/healing/self-healing.ts:355-395`), proposal shape with `triggeringFindingId` and
  `requiresReview` (`:640-652`), apply requires `--checkpoint-ref` (`heal-operation.ts:491-495`) and refuses any
  proposal with `requiresReview: true` (`:257-262`). That refusal is the existing lever this packet reuses for
  caveated proposals.
- Tests: fake surf stubs `frame.diagnose` with a fabricated shape (`tests/fixtures/fake-surf.mjs:600-625`: `index`,
  `src`, no `crossOrigin`/`shadowHost`/`rect`), asserted by `tests/surf_client_contract.test.mjs:209-227`.

## Contract

**Trigger.** The step runs only after a typed `element_unreachable` failure produced by a browser step that targeted an
element by selector or ref, on a page whose readiness was `ready`/`empty`. Producers in v1: (a) explore's readiness
gate when a new `--ready-selector` option is given and `wait.ready --selector` ends in `page_timeout` (mirrors
`SurfClient.extract({ readySelector })`, `surf-client.ts:100-115`); (b) browser steps from the submit-gate packet
(`click`, `type --into`, `wait.element`) failing with surf `element_not_found`/`no_ref`/`page_timeout`; (c) library
callers via `Session.explainUnreachable(selector, { frameHint? })` on the kernel session interface (revised by
adjudication: claim 36; `SurfClient` is deleted under operator decision D2). Never on `page_login`/`page_challenge`/
`page_not_found`/`page_error`, runtime-resolution failures, or non-browser sensors: those are not element problems.

**Frame hint (confirmation input).** A step or explore invocation may carry `frameHint: { selector | urlPrefix }`
(CLI: `--frame-hint 'urlPrefix=https://...'` or `--frame-hint 'selector=iframe#player'`). The hint is the test
author's assertion that the target lives inside that frame. It is the only v1 source of a positive link between a
failing selector and a frame; the framework never infers that link from topology alone (see Refinement, Clash 1).

**Topology tags** (`FrameTopology`, per candidate frame, all that hold are kept as evidence; deterministic rules on the
`frame.diagnose` result, structural fields only, never warning text):

| tag | rule on the `frame.diagnose` result |
|---|---|
| `cross_origin_frame` | DOM iframe with `crossOrigin: true` and a CDP match (in-process) |
| `out_of_process_frame` | `crossOrigin: true`, `cdpFrameIds: []`, `extensionFrameIds` non-empty (revised by refinement: the fallback "or the surf 'is out-of-process' warning names its index" is dropped; the structural rule alone covers every captured case and the warning stays quoted evidence) |
| `shadow_hosted_frame` | `shadowHost` non-null (open shadow root); same-origin or not |
| `nested_frame` | extension frame with `parentFrameId !== 0` (depth 2+), no DOM iframe of its own on the main page |
| `hidden_frame` | `zeroSize`, or `rect.width <= 1 && rect.height <= 1`, or (`blank` and `src === ""` **and the box is degenerate**: `rect.width <= 1 || rect.height <= 1`); excluded from candidates, reported as evidence only (revised by implementation: S8, see the decision log) |

Per-frame primary tag when several hold: `out_of_process_frame` > `cross_origin_frame` > `shadow_hosted_frame` >
`nested_frame`. The primary tag is descriptive (it names the reason a main-page selector cannot reach the frame and
which surf alternative works); it never decides anything by itself.

**Determination** (`FrameDetermination`, closed, deterministic, one per failing step; revised by refinement: replaces
the first draft's page-level "primary class", which let the mere presence of frames assert a cause):

| determination | rule | meaning |
|---|---|---|
| `excluded` | no candidate frames after hidden exclusion, `mainPage.href` and `browserEpoch` unchanged since the failure | a frame boundary cannot explain the miss; the selector is wrong in the main document |
| `confirmed` | `frameHint` selects exactly one candidate, that candidate has `contentScriptReachable: true` | the target is inside a frame the main-page selector cannot reach; primary tag names why |
| `suspected` | candidates exist and no `frameHint` was given | a frame boundary may explain the miss; the framework cannot tell a framed target from a main-document typo |
| `undetermined` | `frameHint` given but matches zero or several candidates, or matches a candidate with `contentScriptReachable: false`; counts mismatch surf does not explain (closed shadow root suspected); CDP child frames with `url: ""` unmatched while a hint was given; navigation between failure and diagnosis (`href` or `browserEpoch` changed) | the inventory is inconsistent or the hint does not resolve; nothing may be concluded |
| `unavailable` | `frame.diagnose` failed, returned non-JSON, or is missing from the probed mechanisms | no diagnosis; recorded as `frame_diagnosis_failed` |

Candidate disagreement (three frames with different primary tags) is not by itself `undetermined`: without a hint every
candidate is equally suspected; with a hint only the selected candidate matters.

**Consumer permissions per determination:**

| determination | root-cause class (`inferRootCauseClass`) | healer |
|---|---|---|
| `excluded` | falls through to the existing regex rules (`selector_or_dom_drift` as today) | unchanged selector-healing path, citing the finding |
| `confirmed` | `frame_boundary` (new class), set structurally before any regex | no rewrite proposal; `refusals[]` entry with a `frame.switch` suggestion (index, `origin`/`urlPrefix`, two hops for `nested_frame`); code `heal_frame_refused` |
| `suspected` | `browser_coverage_gap`, diagnosis attached, `nextStep` says "frame boundary suspected: add `--frame-hint` or confirm the selector in the main document" | rewrite proposal may be generated, but forced `requiresReview: true` with `frameCaveat { determination, findingId, candidates[] (domIndex, origin, primaryTag) }`; apply mode refuses it through the existing review gate (`heal-operation.ts:257-262`) |
| `undetermined` | `browser_coverage_gap`, diagnosis attached with the reason | no proposal; `refusals[]` entry with `reason` and no suggestion; code `heal_frame_refused` |
| `unavailable` | `browser_coverage_gap` (revised by refinement: never falls through to the regex, which would read the failure text as `selector_or_dom_drift`) | no proposal; `refusals[]` entry `frame_diagnosis_failed`; code `heal_frame_refused` |

Rule behind the healer column: a proposal may be shown to a reviewer when the framework can state what the reviewer must
check (the candidate list); it is refused outright when the framework cannot (`confirmed`: the rewrite is wrong by
construction; `undetermined`/`unavailable`: no candidate list to check). Apply mode never consumes a refusal or a
caveated proposal.

**Evidence fields** (typed `FrameRootCause`, attached to the failing probe/step result and to the finding as
`Finding.frameRootCause?` (revised by architecture review: A20), and rendered into `Finding.evidence[]` as one line per
item, prefixed `frame-root-cause:`):
`determination`, `primaryTag` (of the confirmed candidate; null otherwise), `hint` (echoed, if any), `candidates[]`
(`domIndex`, `origin`, `src` abbreviated to 160 chars, `rect`, `sandbox`, `shadowHost`, `crossOrigin`, `outOfProcess`,
`hidden`, `extensionFrameIds`, `cdpFrameIds`, `contentScriptReachable`, `tags[]`, `primaryTag`), `excludedHidden[]`,
`unmatchedCdpFrames` (count), `counts`, `warnings[]` verbatim from surf, `mainPage {href, origin}`,
`source {tabId, browserEpoch, command, durationMs}`, `reason` (for `undetermined`/`unavailable`).
The first evidence line is the machine marker, fixed format:
`frame-root-cause: determination=<value> tag=<primaryTag|none> candidates=<n> hint=<echo|none>`.
`SurfFrameDiagnosis` becomes fully typed from the captured shape. Consumers (`inferRootCauseClass`, the healer) read
the typed field first and parse the marker line only for legacy findings without it (A20).

**Root-cause report.** A new `RootCauseFailureClass` value `frame_boundary` joins the list at `orchestrator.ts:268-281`.
It is a test-defect class (the fix is a structural change to the step, not a selector substitution and not a change in
the system under test), which is why it is not a sub-field of `selector_or_dom_drift`. `inferRootCauseClass` reads `Finding.frameRootCause` first and the
marker line only for legacy findings (revised by architecture review: A20): `determination=confirmed` returns `frame_boundary` before any regex runs; `suspected`,
`undetermined` and `unavailable` return `browser_coverage_gap` with the diagnosis attached; `excluded` falls through
to the existing rules. Calibration rules are unchanged: a single surf sensor still yields no `root_cause` observation;
the finding carries the diagnosis regardless. Surf explore's page result gains `probes[].frameRootCause?`
(`types.ts:223-231`) and the `coverage` observation's `nextStep` names the determination and, when confirmed, the tag.

**Healer.** `HealingFinding` (`self-healing.ts:24-29`) accepts the marker line. `analyzeFile` reads the determination of
the triggering finding for each evidence-targeted selector and applies the permission table above. The proposal
artifact gains `refusals[]` (`{ triggeringFindingId, selector, reason, code, suggestion? }`, `suggestion` =
`{ kind: "frame.switch", index?, selector?, urlPrefix, hops }`) and `HealingProposal` gains `frameCaveat?`. Refusals
and caveated proposals are review artifacts; apply mode never acts on them.

**Error codes** (framework side; carried by `FrameworkError { code, details }`, registered as
`FRAME_ROOT_CAUSE_ERROR_CODES` in `src/core/error-codes.ts`, `[code]` suffix in text mode and the
`{"error": {code, message, details}}` envelope under `--json`; revised by architecture review: A6): `element_unreachable` (trigger), `frame_diagnosis_failed`
(surf non-zero, non-JSON, or `frame.diagnose` missing from the probed mechanisms), `frame_diagnosis_undetermined`
(revised by refinement: was `frame_diagnosis_unclassified`), `heal_frame_refused` (with the determination and, when
confirmed, the tag in the message). Surf-side codes pass through unchanged (`page_timeout`, `no_tab`,
`browser_error`).

## Behaviour and failure modes

- Diagnosis is a read-only `observe` step registered on the owned-tab `BrowserSession` (revised by architecture review:
  A8), run in the same tab before the session closes (today's `surf-explore-operation.ts:645-690` `try`), with the
  explore command timeout (`:33`). The `[surf tab=... window=...]` stderr line is stripped as today (`:138`).
- Fail closed: if `frame.diagnose` fails, the step result keeps `element_unreachable` and adds
  `frameDiagnosis: { status: "failed", code, message }`; the finding says "frame diagnosis unavailable", the marker
  line says `determination=unavailable` (never defaulted to `excluded`), the root-cause class is
  `browser_coverage_gap`, and the healer refuses that selector with `heal_frame_refused`.
- Missing mechanism (older surf): refuse with `frame_diagnosis_failed` naming the build, as `assertSurfExploreMechanisms`
  does for `wait.ready`/`extract` (`surf-runtime.ts:490`). `frameDiagnose` stays optional for explore without
  `--ready-selector`.
- Navigation between the failure and the diagnosis (`mainPage.href` differs from the step's page, or `browserEpoch`
  changed): `undetermined` with both hrefs in `reason`.
- A `frameHint` that resolves to nothing is `undetermined`, never silently downgraded to `suspected`: a wrong hint is a
  test defect the report must name.
- The diagnosis never switches frames, never runs `frame.js`, never opens a second tab. Consequently `confirmed` is
  only reachable through a hint in v1; the in-frame positive probe that would confirm without a hint is deferred
  (Open question 5).

## Cost

One `frame.diagnose --tab-id` per element-reach failure: 45-66 ms measured (dogfood §5, and here), 1-10 KB JSON. Cache
key `(tabId, browserEpoch, mainPage.href)` for the life of one page visit, so a page with several failing steps pays
once; the cache dies with the tab. Determination is computed per step (hints differ), topology once per page visit.
Evidence lines are capped (candidates 10, warnings 10, `src` 160 chars) so a page like MDN (three 600-char URLs) does
not bloat findings.

## Non-goals

Automatic `frame.switch` in explore; correlating OOPIFs through `Target.getTargets` (surf backlog); querying inside
frames (the positive probe, deferred, see Open question 5); detecting closed shadow roots; a new sensor; site-specific
frame knowledge; changing calibration thresholds; a11y refs (row 6); inferring a selector-to-frame link from selector
text or from healer strategy output.

## Risks

- Extension frame ids are per-load; a suggestion that carries only `index` is stale after reload. Suggestions always
  include `origin`/`urlPrefix`; consumers must re-diagnose before switching.
- False attribution (closed by refinement): the first draft classified MDN with `#does-not-exist` as
  `out_of_process_frame` and refused healing, although nothing linked the selector to a live sample. Under the
  determination table that page is `suspected`: reported as a coverage gap with three named candidates, healable under
  review. The guard fixture "typo in a main-document selector on a page with visible cross-origin iframes" must stay
  `suspected`, never `confirmed`.
- Over-refusal (mitigated by refinement): most real pages carry at least one visible third-party iframe (embed, consent,
  ad). Refusing every rewrite on such pages would disable healing almost everywhere. `suspected` therefore keeps the
  proposal and only removes it from apply mode; the cost that remains is that no frame-suspected page heals without a
  human review, which is the intended price.
- CDP child frames with `url: ""` (claude.ai: 4) are unexplained by surf; treating them as evidence for `undetermined`
  may over-refuse on pages with prerender/fenced frames. Mitigated by only doing so when a hint was given (without a
  hint they are listed under `unmatchedCdpFrames` and the determination stays `suspected` or `excluded`).
- Regex corpus: the words "frame"/"selector" in the new evidence lines could flip other classifications. The marker
  check runs first, and the root-cause corpus gains a guard fixture proving a `determination=excluded` line still
  classifies `selector_or_dom_drift` and a `determination=suspected` line classifies `browser_coverage_gap`, not
  `frame_boundary`.
- Hint drift: a stale `urlPrefix` after a third-party embed changes hosts yields `undetermined` and blocks healing for
  that step until the hint is fixed. Accepted: the report names the hint and the candidates.
- Brave background-tab `js` stall (dogfood §6) does not apply: `frame.diagnose` is a content-script tool (~50 ms).

## Verification and dogfood plan

- Truth gate: re-read `assertCurrentSurfaceAvoidsCausalityOverclaim` (`capability-truth-gate.mjs:192-209`) against the
  words `frame_boundary`/`confirmed` in README, posture and passport before the slice lands, and add a guard fixture
  (revised by architecture review: A15).
- Fixtures: commit the three captured JSON documents under `tests/fixtures/captures/frame-diagnose/` (the shared
  capture corpus the fake learns from, A17) (example-com, mdn-iframe,
  claude-login) plus synthetic ones per tag (in-process cross-origin, nested srcdoc from dogfood §4b, hidden 0x0,
  closed-shadow mismatch, unreachable content script). Unit tests on the pure classifier: one per tag, precedence, one
  per determination, hint selecting one/zero/several candidates, hint on an unreachable candidate, hidden rule on 1x1,
  navigation mismatch, candidate disagreement without hint staying `suspected`.
- Fake surf: replace the `counts.iframes` stub (`fake-surf.mjs:600-625`) with `FAKE_SURF_PAGES[url].frames` (array of
  real-shaped DOM/extension/CDP entries and warnings) and a `FAKE_SURF_FAIL_ON=frame.diagnose` path; explore contract
  tests assert the marker line, the determination with and without `--frame-hint`, the closed tab, and the
  `unavailable` result when diagnosis fails.
- Orchestrator: root-cause corpus scenarios for `frame_boundary` (two sensors agreeing on a confirmed determination),
  `browser_coverage_gap` from a suspected one, and the guards above; the runtime-diagnostic corpus stays CLI-only.
- Healer: contract tests that a confirmed finding produces a refusal with a `frame.switch` suggestion and no proposal;
  that a suspected finding produces a proposal with `requiresReview: true` and `frameCaveat`, which `heal --apply`
  refuses through the review gate; that `excluded` still heals; that `undetermined`/`unavailable` refuse.
- Live dogfood (Chromium (Agent) only, owned tabs, no login): `surf tab.new <url>` → `wait.ready --tab-id` →
  `frame.diagnose --tab-id --json` → `tab.close`, then `test-capabilities surf explore --url <url> --ready-selector
  '#does-not-exist' --json` on:
  - `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe`: expect `suspected` with three
    candidates tagged `out_of_process_frame`; rerun with `--frame-hint 'urlPrefix=https://'` plus the first
    `mdnplay.dev` host from the diagnosis and expect `confirmed`, tag `out_of_process_frame`;
  - `https://claude.ai/login` with `--accept login`: expect `excluded`, one hidden pixel listed under `excludedHidden`;
  - a YouTube embed page: expect `suspected`; with `--frame-hint 'urlPrefix=https://www.youtube.com/embed/'` expect
    `confirmed` with `cross_origin_frame` or `out_of_process_frame`;
  - `https://example.com/`: expect `excluded`, zero candidates.
  `tab.list` count identical before and after.

## Open questions

1. Answered by refinement: `frame_boundary` is its own root-cause class (test-defect locus, structural repair) and is
   asserted only for `confirmed`; the corpus coverage floor is updated with the confirmed and suspected scenarios.
2. Does explore need `--ready-selector` at all, or should the trigger wait for the submit-gate steps? Proposal: ship the
   classifier and fixtures first, `--ready-selector` (plus `--frame-hint`) as the minimal live producer.
3. Should `undetermined` on an unreachable content script still emit the `frame.js` alternative as text? Surf's warning
   already says it; the framework will quote the warning, not recommend it.
4. Pixel rule threshold (1x1) versus "not in viewport": keep 1x1 and `blank` only; visibility is not a frame property.
   (Closed by implementation: S8. "Not in viewport" stayed out - the hCaptcha frames parked at `y: -9999` on
   `claude.ai/login` are candidates, and the live read says `suspected` rather than pretending they are hidden - and
   the `blank` half gained the rect qualification recorded in the decision log.)
5. Positive in-frame probe (still deferred after S8; filed as `S10-FU-3` in `governance/work-items.json`):
   `frame.switch --index` in the owned tab followed by a read-only query for the
   failing selector would turn `suspected` into `confirmed` or `excluded` without a hint. It changes extension state
   for the tab and adds one round trip per candidate; it must be designed together with the mutation-safety packet
   (`frame.switch`/`frame.main` are now classified `browser_session` scope in the mutation-safety packet's map, revised by
   adjudication: Part 4 P3 note, so what remains is the read-only in-frame query and its round trips) before it can be added. Until then confirmation requires a hint.

## Decision log

- 2026-09-07: classification is topology-based and fail-closed; all flags preserved as evidence.
  `revised by refinement:` topology is evidence only. The gate is a separate `FrameDetermination` (excluded, confirmed,
  suspected, undetermined, unavailable) because the presence of a frame on the page is not evidence that the failing
  selector targeted it; the first draft's single "primary class per page" asserted a cause from a topology observation.
- 2026-09-07: new root-cause class `frame_boundary`, set structurally before regex; `excluded` keeps the existing
  selector path. `revised by refinement:` `frame_boundary` only for `confirmed`; `suspected`, `undetermined` and
  `unavailable` report `browser_coverage_gap` with the diagnosis attached, because a coverage limit of the sensor must
  not be reported as an established cause.
- 2026-09-07: the healer refuses selector rewrites for every frame class and records review-only `frame.switch`
  suggestions; apply mode never consumes them. `revised by refinement:` refusal only for `confirmed`, `undetermined`
  and `unavailable`; `suspected` yields a caveated proposal (`requiresReview: true`, `frameCaveat`) that the existing
  review gate keeps out of apply mode. Reason: blanket refusal on candidate presence would disable healing on nearly
  every real page, while a caveated proposal preserves the reviewer's information without any autonomous action.
- 2026-09-07: diagnosis failure is an error code on the step, never a default class; one command per failure, cached per
  page visit; no automatic frame switching. `revised by refinement:` failure is `determination=unavailable` and maps to
  `browser_coverage_gap`, never left to the regex (which would read the failure text as selector drift).
- 2026-09-07: hidden rule is the framework's (`zeroSize || <=1x1 || blank-without-src`), because surf's `zeroSize` is
  false for the 1x1 pixel frame observed on claude.ai/login. Unchanged.
- 2026-09-08 `revised by implementation: S8`: the blank clause is qualified by the rect. Measured live on
  `https://www.w3schools.com/html/html_youtube.asp`, the try-it/embed pages render a **933x949** iframe that surf
  reports as `blank: true, src: ""` - its content is written by the parent, so it carries no `src` attribute. Under
  the literal clause that frame is hidden, the page becomes `excluded`, which is the strongest claim this module
  makes and the one that licenses an automatic selector rewrite; a target inside that frame would be healed into a
  lookalike in the main document, which is the silent false negative this packet exists to prevent. The implemented
  clause 3 therefore applies only to a degenerate box (`width <= 1 || height <= 1`) - a *different* boundary from
  clause 2's pixel (`width <= 1 && height <= 1`), which is why both are now written out. `zeroSize` and the 1x1
  clause are untouched, so the claude.ai pixel this rule was written for is still hidden. The packet's earlier text
  and this rule are **not both satisfied**: this entry is the amendment, not a claim of compliance. Peer
  consultation and the two-direction contract cases are in `docs/project/2026-09-07-slice-s8-notes.md` (deviation 1).
- 2026-09-07 (refinement): decisions are derived from structural fields of the `frame.diagnose` result only; surf's
  warning prose is quoted verbatim as evidence and never parsed for a decision.
- 2026-09-07 (refinement): the only v1 source of a positive selector-to-frame link is the test author's `frameHint`;
  the in-frame positive probe is deferred (Open question 5). Selector text and healer strategy output are not links.
- 2026-09-07, revised by architecture review (A20): `Finding.frameRootCause?` is the authoritative typed field; the
  marker line is its rendered form for legacy readers and is parsed only when the field is absent.
- 2026-09-07, revised by architecture review (A8): the diagnosis is an `observe` step on the surf adapter's
  `BrowserSession`, not a hook inside explore; it inherits the effect class, attempt log and outcome of every step.
- 2026-09-07, revised by architecture review (A6, A15, A17): codes are carried by `FrameworkError` from the registry;
  the overclaim grep in the truth gate is re-read against `frame_boundary`/`confirmed` before landing; captures live
  under `tests/fixtures/captures/`.
- 2026-09-07, revised by adjudication (claims 22, 36; Part 4 P3 note): `explainUnreachable` lives on the kernel
  `Session`; the diagnosis is a `Session.observe` step; `frame.switch`/`frame.main` are `browser_session` scope in P1's
  map, which is the precondition the deferred in-frame probe was waiting for.

## Refinement (many-of-the-greats)

## QUESTION

When a browser step in a fail-closed testing framework cannot reach an element by selector or ref, and `surf
frame.diagnose` returns a three-way frame inventory (DOM iframes, extension frames with content-script reachability,
CDP frame tree) plus prose warnings: who may assert the *cause* of the miss, in what form, and with what authority over
downstream actors? Concretely: (a) should the framework compute a closed, deterministic classification from surf's raw
structured inventory, failing closed to a refusal when the inventory is inconsistent; or forward surf's own warnings as
the classification; or hand the raw inventory to an LLM and let it reason to a cause? And (b) given whatever
classification exists, may the healer act on it (rewrite selectors, propose frame switches), or may it only emit
review-only suggestions while refusing rewrites?

The question hides a second one that the first draft did not ask: does the presence of unreachable frames on a page
constitute evidence that *this* failing selector targeted one of them?

## MODE 1 — MANY OF THE GREATS

### School 1: Differential diagnosis (clinical reasoning, Osler through Bayesian diagnostics)
- Core claim: a finding on the body is not the cause of the complaint until a test links them. Diagnosis is the ordered
  exclusion of alternatives; confirmation requires a positive test with known sensitivity, and the absence of a
  necessary lesion excludes far more reliably than the presence of a compatible lesion confirms.
- Premises: symptoms have many sufficient causes; incidental findings are common in any population (most pages have an
  iframe, most adults have a benign cyst); pretest probability governs what a compatible finding is worth; a label
  written into the chart steers every later clinician.
- Strongest case: the MDN capture is the textbook incidentaloma. Three out-of-process frames are present; a typo in a
  main-document selector produces the identical inventory. A classifier that reads "three unreachable frames" as
  "frame boundary caused the miss" has a specificity of nearly zero on any page with an embed. Meanwhile the exclusion
  direction is sound: no candidate frames after hidden exclusion means no frame explains the miss, by modus tollens.
  The honest chart entry for MDN without further information is "frame boundary suspected, not excluded, not
  confirmed".
- What it sees that others miss: that "topology" and "cause" are different epistemic objects, and that fail-closed
  engineers, by refusing action, believe they have paid for a wrong label when they have not: the label in the
  root-cause report still steers the operator.

### School 2: Structured-evidence and observability engineering
- Core claim: keep raw, typed, high-cardinality evidence with provenance; derive decisions at the consumer from fields,
  never from prose; make every derivation reproducible from the stored evidence alone.
- Premises: producers evolve their messages; consumers outlive producers; anything parsed from text is a coupling that
  breaks silently; storage is cheap, wrong conclusions are not; the reader of a report will want to re-derive.
- Strongest case: surf already emits `crossOrigin`, `cdpFrameIds`, `extensionFrameIds`, `shadowHost`,
  `contentScriptReachable`, `rect`, `blank`. Every warning in the captures is a rendering of those fields. The first
  draft's rule "or the surf 'is out-of-process' warning names its index" is exactly the coupling this school forbids,
  and it is redundant with the structural rule in every captured case. Quote warnings verbatim for humans and agents;
  decide from fields; store `mainPage`, `browserEpoch`, `durationMs` so the derivation can be replayed.
- What it sees that others miss: that the *evidence contract* is the durable artifact. Enums, healers and models will be
  revised; the typed capture of what surf saw at that moment will not be recoverable later if it is thrown away.

### School 3: Raw evidence to the model (LLM-agent school)
- Core claim: closed enums freeze yesterday's ontology. Reality (prerender frames, fenced frames, portals, closed
  shadow roots, extension-injected frames) will outrun any table. Give a capable reasoner the full inventory and the
  failing step, and it will diagnose the long tail that a classifier labels confidently and wrongly.
- Premises: the reader of findings is increasingly an agent; the cost of a wrong confident label exceeds the cost of a
  paragraph of evidence; ontologies are cheap to write and expensive to maintain; reasoning at read time adapts,
  classification at write time does not.
- Strongest case: the claude.ai capture already contains four CDP child frames with `url: ""` that surf cannot explain.
  No enum in this packet knows what they are. A reasoning agent, told "four unexplained child frames, one hidden
  pixel, target selector `#login-form`", will say "not a frame problem, those are prerender or extension frames" and be
  right, while the classifier either over-refuses or needs a new special case. The framework should present, not decide.
- What it sees that others miss: that the primary consumers of these findings (Pi, the healer's future model backend,
  the operator reading a report) all reason better from evidence than from a label, and that a label attached to
  evidence tends to be read *instead of* the evidence.

### School 4: Fault-tree and root-cause analysis (Vesely; Reason's organizational accident model)
- Core claim: a root cause is an intervention point, not a description. Failure classes must partition by *where the
  fix goes*; a class that does not change the repair is decoration. A limit of the sensor is not a fault in the system
  under test and must never be filed as one.
- Premises: every failure has a locus (system under test, environment, test/sensor); confusing loci sends the repair to
  the wrong team; the value of a classification is the correctness of the routing.
- Strongest case: an element inside a cross-origin iframe is not a defect in the application. The application is fine;
  the *test* aimed a main-document selector at a framed target. The repair is a structural change to the step
  (`frame.switch` before the query), which is neither a selector substitution (`selector_or_dom_drift`) nor an
  application fix (`component_failure_surface`). That difference in repair justifies a distinct class, and it fixes
  the packet's open question 1 on principle rather than on taste. It also says the class must not be asserted when the
  repair is not known to apply.
- What it sees that others miss: that fine topology distinctions (cross-origin versus out-of-process) do not change the
  test's repair at all; they change only which surf tool works, which the framework does not run. They are evidence
  for a human, not classes for a router.

### School 5: Self-healing test-automation practitioners
- Core claim: a healer's whole value is that it acts. It is a hypothesis generator under review; refuse it the right to
  hypothesize and it is a linter. A frame switch is a legitimate heal, and "there is an iframe on the page" is not a
  reason to stop healing, because there is an iframe on nearly every page.
- Premises: test suites rot faster than teams can maintain them; most selector misses are drift, not architecture;
  reviewers are good at rejecting bad proposals and bad at inventing good ones; a healer that goes silent whenever the
  page has a consent banner or a YouTube embed will be turned off.
- Strongest case: the first draft refused every rewrite on a page whose primary class is any frame class. Applied to
  the real web that is a near-total refusal. And it is not even safety: the proposal is shown to a reviewer with
  `requiresReview`, apply already requires a checkpoint reference, and apply already rejects anything flagged for review
  (`heal-operation.ts:257-262`). The machinery for "propose, but never apply" exists; using "refuse" where "caveat" would
  do destroys information the reviewer wanted.
- What it sees that others miss: base rates. The fail-closed school reasons from the worst case (a lookalike rewrite in
  the main document going green); the practitioner knows the common case (a renamed class on a page with an ad frame)
  and knows what happens to tools that treat the common case as the worst case.

### School 6: Fail-closed reliability engineering (Leveson's safety constraints; "unknown means refuse")
- Core claim: a system may assert only what it can prove and may act only inside proven constraints; when the evidence
  is inconsistent or missing, the correct output is a refusal with a reason, never a default. A wrong-by-construction
  action that produces a green result is the worst possible outcome of a testing framework, because it converts a
  visible failure into an invisible one.
- Premises: silent false negatives cost more than any number of loud refusals; the operator can lift a refusal, but
  cannot see a false green; determinism is a safety property (the same evidence must yield the same gate on every
  run, in every retry loop, with no model in the path).
- Strongest case: a selector rewritten from a framed target to a main-document lookalike matches something and the
  step passes. The healer has no live check (`validateSelector` is a prefix heuristic), so it cannot detect this. A
  diagnosis that fails must not fall through to the regex, which would read the failure text as drift. A hint that
  resolves to nothing must not be downgraded to "suspected". All of this is only enforceable if the gate is a closed
  enum computed deterministically; a model in the gate is a non-reproducible gate.
- What it sees that others miss: that "the healer only proposes" is not a safety argument once retry loops and
  `--apply` exist. The safety property must live in the artifact (a proposal apply cannot consume), not in the intention.

## MODE 2 — CONFRONTATION

### Clash 1: Differential diagnosis vs the packet's first-draft fail-closed classifier
- Fundamental contradiction: the first draft computed a page-level "primary class" from topology and fed it, as a
  cause, to the root-cause report and the healer. The diagnostic school holds that no observation of topology can
  confirm that *this* selector targeted *that* frame.
- Incompatible assumptions: "fail closed" as drafted treated a confident wrong label as harmless because it only led to
  refusal. The diagnostic school treats the label itself as an act with consequences (the operator now debugs frames
  instead of the typo).
- What A (diagnostics) explains better: the MDN typo case, the `#does-not-exist` dogfood expectation (which the draft
  wrote as "expect `out_of_process_frame`" for a selector that exists nowhere), and why exclusion is strong while
  confirmation is weak.
- What B (fail-closed draft) explains better: why the gate must be deterministic and why absence of a diagnosis must
  not become a default.
- Residual tension: none once the gate is split from the label. The draft was not fail-closed; it was fail-confident
  in one direction. The correction is to add "suspected" and "excluded" as first-class outcomes and to reserve
  "confirmed" for a positive link.

### Clash 2: Self-healing practitioners vs fail-closed reliability
- Fundamental contradiction: whether the presence of unreachable candidates is sufficient reason to withhold a rewrite.
- Incompatible assumptions: the practitioner assumes review catches bad proposals and that silence is the greater
  failure; the reliability engineer assumes retry loops and apply paths will eventually consume whatever the healer
  emits and that a green lookalike is unrecoverable.
- What A explains better: base rates on the real web; the fate of tools that refuse on the common case; the fact that
  the review gate already exists in code.
- What B explains better: the specific catastrophic path (framed target, lookalike in main document, green step); the
  healer's lack of any live verification; why a proposal must be *structurally* unappliable rather than merely
  flagged in prose.
- Residual tension: partially resolvable. Both are satisfied if the proposal exists (practitioner) and carries
  `requiresReview: true` plus a typed caveat that apply refuses (engineer). What stays unresolved: a frame-suspected page
  never heals without a human, and no v1 mechanism can lift that without an in-frame probe. The practitioner pays.

### Clash 3: Raw-evidence-to-the-model vs deterministic closed gate (Schools 3 vs 2 and 6)
- Fundamental contradiction: whether the classification that gates actions may be produced by a reasoner whose output
  is not reproducible from the evidence alone.
- Incompatible assumptions: the model school values adaptivity at read time; the gate schools value that the same
  finding yields the same gate on every run, in every retry, in CI, with no model in the path and no prompt in the
  test fixtures.
- What A explains better: the long tail (unexplained CDP frames, closed shadow roots, future frame kinds) and the fact
  that labels get read instead of evidence.
- What B explains better: why a healer's apply gate and a root-cause class in a fail-closed framework cannot depend on a
  model, and why a closed enum with an explicit "undetermined" is not the same as a closed enum that pretends to cover
  the world.
- Residual tension: irreducible at the gate, resolvable in the report. The gate is deterministic; the raw inventory and
  verbatim warnings travel with it so that any reasoner downstream can disagree with the label and say so. The
  model school loses the right to label the gate; it keeps everything else.

### Clash 4: Structured evidence vs tool-owned classification (School 2 vs the "let surf classify" placement challenge and the draft's warning-text fallback)
- Fundamental contradiction: whether prose emitted by the producer may enter a decision.
- Incompatible assumptions: the placement challenge assumed surf, closest to the browser, knows best; the evidence school
  holds that surf knows the topology and nothing about the test, and that its prose is a rendering of fields it
  already exports.
- What A explains better: that the warning-text fallback is redundant and fragile; that the consumer contract (which
  step, which selector, what the healer may do) lives in test-capabilities.
- What B explains better: nothing the fields do not already say. The one thing surf could add, a `--selector` echo in
  the warning, is cosmetic.
- Residual tension: none. The fallback goes; the placement stands.

### Clash 5: Fault-tree routing vs topology-as-class (School 4 vs the draft's seven-value enum)
- Fundamental contradiction: whether cross-origin, out-of-process, shadow-hosted and nested deserve to be *classes*
  when the test's repair is the same for all of them (switch into the frame before querying).
- Incompatible assumptions: the draft assumed finer labels are free; the fault-tree school assumes every class that does
  not change the routing dilutes the ones that do.
- What A explains better: why `frame_boundary` is a single root-cause class with a test-defect locus, and why the
  topology detail belongs in the evidence and in the `frame.switch` suggestion (index, hops), not in the class.
- What B explains better: that the human reading the report wants to know *why* the selector cannot reach the frame,
  and that surf's alternatives differ per topology.
- Residual tension: resolved by demotion, not deletion: topology stays as typed tags on each candidate, the primary tag
  is descriptive, and one determination gates.

## MODE 3 — INTEGRATION OR DECISION
- Chosen path: True Synthesis.
- Result: the packet's single "class" is split into three layers that no school disputes once separated.
  (1) *Topology* is evidence: typed per-frame tags derived from surf's structural fields, warnings quoted verbatim,
  captured with provenance (School 2, School 3's raw evidence, School 4's demotion of topology to detail).
  (2) *Determination* is the gate: a closed enum with five values, `excluded` (no candidates: strong, by exclusion),
  `confirmed` (a positive link, in v1 only the author's `frameHint` resolving to one reachable candidate), `suspected`
  (candidates, no link), `undetermined` (inconsistent inventory or unresolvable hint), `unavailable` (no diagnosis).
  It is deterministic, replayable from the evidence, and admits that it does not know (Schools 1 and 6).
  (3) *Permission* is derived from the determination per consumer: the root-cause report files `frame_boundary` only
  on `confirmed` and files everything short of exclusion as a coverage gap of the sensor (School 4: sensor limits are
  not faults); the healer refuses on `confirmed` (wrong by construction), `undetermined` and `unavailable` (nothing
  to show a reviewer), and on `suspected` emits its proposal with a typed caveat that the existing review gate keeps
  out of apply (Schools 5 and 6 both satisfied by the artifact, not by intention).
- Why this path is justified: the schools were not disagreeing about one thing; the draft had fused three things and
  each school was defending the layer it could see. Once topology, determination and permission are separate
  objects, each school's strongest claim survives without contradiction: the diagnostician's "presence is not cause",
  the observability engineer's "decide from fields, keep the raw", the fault-tree analyst's "classes route repairs",
  the practitioner's "the proposal must exist", and the reliability engineer's "the gate is deterministic and the
  artifact is unappliable". The model school keeps the evidence and loses only the gate, which it could never have
  held in a fail-closed framework. This is a synthesis and not a compromise because nobody is asked to hold a weaker
  form of their claim; they are asked to hold it about the right object.
- What remains unresolved: confirmation without a hint. Topology cannot supply a positive link; only an in-frame probe
  (switch, read-only query, switch back) can, and that probe changes extension state for the tab and interacts with the
  mutation-safety packet. Until it exists, every frame-suspected page heals only under human review, and a test author
  who does not know the frame layout cannot get a `frame_boundary` verdict from the framework. That cost is real and
  is accepted here rather than hidden.

## PRACTICAL CONSEQUENCE

Rewrite the contract so that `FrameTopology` (evidence tags) and `FrameDetermination` (gate) are distinct types, with
the machine marker `frame-root-cause: determination=... tag=... candidates=... hint=...` as the only line the
orchestrator and healer parse. Drop every rule that reads surf's warning text. Add `--frame-hint` as the confirmation
input and make an unresolvable hint `undetermined`, never `suspected`. Map `unavailable`, `undetermined` and
`suspected` to `browser_coverage_gap`; reserve `frame_boundary` for `confirmed`. In the healer, replace blanket refusal
with the three-way rule refuse / caveat / heal, using `requiresReview: true` plus `frameCaveat` so that the existing
apply gate, not new prose, prevents action. Rewrite the dogfood expectations: MDN with `#does-not-exist` is
`suspected`, becomes `confirmed` only with a hint; claude.ai/login and example.com are `excluded`. Record the in-frame
positive probe as the deferred path to hint-free confirmation and design it together with mutation safety.
