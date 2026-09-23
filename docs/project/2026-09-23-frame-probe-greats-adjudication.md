---
summary: "Many-of-the-greats adjudication for AK #5569, the in-frame positive probe: how to confirm without a --frame-hint that a failing selector lives in a frame. The gate rule stands: the probe may promote (a hit in exactly one candidate, every candidate answering, is confirmed; a hit in several is undetermined) and never demotes to excluded. The first verb choice was refuted before any code was written: surf's own warning says frame.js cannot reach out-of-process frames, which are the frames that matter, so the probe needs frame.switch after all. Implementation is deferred until the probe is designed together with mutation safety and the verbs are measured live against the agent browser."
read_when:
  - "You design or implement the in-frame probe (its planned opt-in: --frame-probe, agents.<name>.frameProbe) or change the frame determination gate."
  - "A frame determination says it was confirmed by probe and you want to know why a probe may confirm but never exclude."
  - "You consider running the probe by default, or through frame.switch instead of frame.js."
type: "decision"
---

# The in-frame positive probe (AK #5569, 2026-09-23)

The facts this rests on:
- The S8 design says the diagnosis "never switches frames, never runs `frame.js`". It also says
  confirmation needs a positive link between the failing selector and one frame, and that a hint
  is the only v1 source of that link (design, Open question 5; Clash 1).
- The task names `frame.switch --index` followed by a read-only query. The mutation-safety map
  classifies `frame.switch` and `frame.main` as `mutating` with `browser_session` scope
  (`surf-adapter.ts`).
- surf 2.18.0 also ships `frame.js <code> --id <frame id>`, which executes in one frame without
  switching the tab's frame context. The live `frame.diagnose` inventory already ties every
  DOM iframe to its `extensionFrameIds` (`tests/fixtures/captures/frame-diagnose/mdn-iframe.json`).
- `js` is left unclassified on purpose: a caller declares the effect of the script it runs, as
  explore does for its read-only probes.
- The healer's three-way rule gives each determination a different cost:
  - `confirmed` refuses a rewrite and suggests `frame.switch`;
  - `suspected` caveats a proposal into review;
  - `excluded` keeps the selector path, where a rewrite may be proposed.

## QUESTION

The run can execute a read-only query inside each candidate frame. Should what the query finds
be allowed to decide the frame determination without the test author's hint? If so, in which
direction, through which surf verb, and on whose authority?

## MODE 1 - MANY OF THE GREATS

### School 1: Differential diagnosis (the clinician)
- Core claim: an observation of the selector inside one frame is a positive link. It is stronger
  than a hint, because the hint is only asserted while the probe result is observed.
- Premises: confirmation requires evidence that ties the finding to the cause, and "the element
  is in that frame and nowhere else the run can see" is such evidence.
- Strongest case: the S8 gate reserved `confirmed` for a positive link because it had no way to
  observe one. The probe removes that reason. Keeping the hint as the only route to confirmation
  would leave `test` runs on pages with third-party frames stuck at `suspected` forever.
- What it sees that others miss: the hint was a stand-in for missing evidence, not a principle.

### School 2: Mutation safety (the steward)
- Core claim: a diagnosis must not change the thing it diagnoses. `frame.switch` changes the tab's
  frame context. If the matching `frame.main` fails, every later step runs in the wrong frame.
- Premises: a restore that can fail turns a read into a mutation. The only safe diagnostic
  change is one that never happens.
- Strongest case: the task as filed chose `frame.switch` because the S8 design had ruled out
  `frame.js`. `frame.js --id` reaches the same frame with no context change at all. With that
  verb available, taking the mutating route would be negligent.
- What it sees that others miss: the probe can be done without any state change, provided the
  verb is chosen correctly.

### School 3: Asymmetric risk (the reliability engineer)
- Core claim: the two errors a probe can make do not cost the same.
  - A false `confirmed` leads to a refusal with a `frame.switch` suggestion, which a reviewer
    can reject.
  - A false `excluded` licenses a selector rewrite towards a lookalike in the main document. That
    produces a green step that tests the wrong element, and it cannot be recovered afterwards.
- Premises: a gate should move freely in the direction whose errors are cheap and not at all in
  the direction whose errors are unrecoverable. Absence of evidence is weak: an element can still
  be loading, a frame can be mid-navigation, and a content script can answer with the wrong frame.
- Strongest case: the S8 design's strongest case was exactly the green lookalike. A probe that
  demotes `suspected` to `excluded` whenever it finds nothing would reopen that case for every
  page whose framed content loads late.
- What it sees that others miss: the probe should be able to promote a determination but never
  demote one.

### School 4: Authorial sovereignty (the test author)
- Core claim: what a step means is set by its author. A selector found in a frame may be a
  different element that happens to carry the same selector.
- Premises: the framework knows syntax, not intent, and an inferred link overrides an assertion
  nobody made.
- Strongest case: when a hint is given, the hint decides. A probe that disagreed with a hint and
  won would substitute the framework's reading for the author's statement.
- What it sees that others miss: the probe must stay out of the way of an explicit hint. Running
  code in third-party frames (ads, captcha challenges) is something the operator should switch on
  deliberately, not something that happens by default.

## MODE 2 - CONFRONTATION

### Clash 1: Differential diagnosis vs Asymmetric risk
- Fundamental contradiction: the clinician would let the probe answer in both directions (a hit
  in one frame means `confirmed`, no hit anywhere means `excluded`). The reliability engineer
  allows only the first.
- What the clinician explains better: the MDN `#does-not-exist` case. A selector that exists
  nowhere is almost certainly a typo, and `excluded` would be the correct answer.
- What the reliability engineer explains better: the cost of being wrong. When the answer is
  wrong, "almost certainly" still produces a green lookalike.
- Residual tension: irreducible. Absence stays `suspected`, with the probe's readings attached as
  evidence, so a human reading the finding sees "zero in all N frames". The gate still does not
  act on it.

### Clash 2: Differential diagnosis vs Authorial sovereignty
- What the clinician explains better: pages the author never hinted, which after `readySelector`
  landed is every `test` run.
- What sovereignty explains better: a probe that overrules a hint would mean the framework knows
  better than the author.
- Resolvable: yes. With a hint, the hint decides and the probe does not run. Without a hint, the
  probe may speak.

### Clash 3: Mutation safety vs the task as filed
- Fundamental contradiction: the task says `frame.switch`. The steward says a diagnosis may not
  switch anything.
- Resolved by a fact, not by preference: `frame.js --id` exists, is keyed by the extension frame
  ids the inventory already carries, and changes no context. The task's verb is replaced, and the
  reason is recorded here.

### Clash 4: Every school vs uniqueness
- A hit in one frame proves uniqueness only if every candidate answered. A frame whose content
  script does not answer, or whose candidate maps to zero or several extension frame ids, could
  hold a second copy. So confirmation needs every candidate probed and answering. Otherwise a hit
  leaves the determination `suspected`, with the evidence attached.

## MODE 3 - INTEGRATION OR DECISION
- Chosen path: **Contextual dominance.** Each school governs the dimension it owns.
- Result:
  1. **Verb (mutation safety):** the probe is `surf frame.js --id <extensionFrameId>` running one
     fixed script: `document.querySelectorAll(SURF_OPTIONS.selector).length`, declared
     `read_only`. It never uses `frame.switch` or `frame.main`.
  2. **When (sovereignty):** only on an explicit opt-in (`--frame-probe` on explore,
     `agents.<name>.frameProbe` on a surf agent). Only when no hint was given, and only when the
     gate would otherwise answer `suspected`. Off by default, so existing envelopes are
     byte-identical.
  3. **Direction (asymmetric risk):** the probe can only promote.
     - Exactly one candidate reports a count of at least 1, every other candidate answers 0, and
       every candidate was probed (one extension frame id, content script reachable): the
       result is `confirmed`, with a reason that says it was confirmed by probe.
     - Two or more candidates report a hit: `undetermined`, as with a hint that resolves to
       several.
     - Anything else, including no hit anywhere: `suspected`, with the readings attached.
     - The probe never produces `excluded`.
  4. **Gate purity (differential diagnosis):** the readings (candidate, frame id, count or
     unanswered) are inputs to `determineFrameRootCause` and are recorded on `FrameRootCause`.
     The determination therefore stays a replayable function of recorded evidence.
  5. The same rule as for a hint: unmatched CDP child frames block confirmation by probe.
- Why this path is justified: confirmation now needs neither a hint nor a mutation. The only error
  it can introduce is a false `confirmed`, which is cheap and reviewable. The unrecoverable error,
  a false `excluded`, stays impossible by construction.
- What remains unresolved:
  - The probe is proved against the fake surf only. A live run against the agent browser is needed
    before the posture may call it live-verified. That run drives the operator's browser, so it
    waits for the operator.
  - Whether `frame.js` reaches out-of-process frames in surf 2.18 has not been measured. On a page
    where it does not, the result is `unanswered` readings and a `suspected` determination, which
    is the fail-closed answer.

## PRACTICAL CONSEQUENCE

- `frame.js` gets an argv translation, is used only with the fixed count script, and is declared
  `read_only` at the call site.
- `FrameRootCauseInput.probe` and `FrameRootCause.probe` carry the readings.
  `determineFrameRootCause` applies rule 3 after the hint branch and the no-candidates branch.
- `explainUnreachable(selector, { probe: true })` runs one `frame.js` per candidate that can be
  probed. `surf explore --frame-probe` and `agents.<name>.frameProbe` turn it on.
- A live run is carried forward as a gated follow-up in AK.

## REFUTATION (same day, before any code): the verb choice does not survive the evidence

This section amends the decision above rather than replacing it. The gate rule (result 3: promote,
never demote) and the rule that a hint decides where one is given (result 2) stand. The verb choice
(result 1), and the claim in Clash 3 that `frame.js` resolves the conflict, do not.

- surf's own `frame.diagnose` warning, preserved verbatim in the fake surf and in the live
  capture's inventory, says that an out-of-process iframe "is missing from this tab's CDP frame
  tree, so frame.js cannot reach it; its content script answers, so frame.switch, page.read and
  click by ref work there". So `frame.js` is a CDP route. Its `--id` is a CDP frame id
  (`cdpFrameIds`), not an extension frame id, and the MDN capture's out-of-process candidates
  carry `cdpFrameIds: []`.
- The S8 live run found that "site isolation put every cross-origin frame on the pages tried out
  of process" (`2026-09-07-frame-root-cause-live-run.md`). The frames the probe exists for
  (embeds, ads, challenge frames) are therefore exactly the ones `frame.js` cannot reach. Under
  the uniqueness rule (Clash 4), a single unreachable candidate blocks confirmation. A
  `frame.js`-only probe would therefore confirm almost nothing on real pages, and it would add a
  surface built against a fake, for a verb whose id format nobody has measured.
- For out-of-process frames the reach is through `frame.switch`, which is `browser_session`
  mutating. `SurfSession.step` refuses every `browser_session` step today (`owned_tab_required`):
  the session owns the tab lifecycle. A probe through `frame.switch` would need a new kind of
  step: a scoped switch, a read-only query, and a `frame.main` that must succeed, with the tab
  treated as poisoned (and closed, not reused) if it does not. That is a change to the
  mutation-safety contract, which is exactly why the S8 design deferred the probe "together with
  mutation safety".

**Revised consequence.** Nothing is implemented in this pass. #5569 is deferred in AK. It is
unblocked by one live measurement session against the agent browser: the operator's Chromium
(Agent), which this pass does not drive without them. That session answers four questions:
1. What `frame.js --id` accepts, and whether it reaches an in-process cross-origin frame.
2. Whether `frame.switch --index` followed by `js` reads inside an out-of-process frame, and
   through which id.
3. Whether `frame.main` always restores the context, including after the frame has navigated or
   gone away.
4. What surf does with a `--tab-id` step while a frame context is active.

The answers decide the design. If `frame.js` turns out to reach out-of-process frames after all,
result 1 stands as written. Otherwise the mutation-safety packet gains a
"scoped `browser_session` switch with restore" step class, and the probe is built on it.

## LIVE MEASUREMENT (same day, operator present): the four questions answered

The measurement is in `2026-09-23-frame-probe-live-measurement.md`. Its answers settle the
design that the refutation above left open:

1. `frame.js --id` takes CDP frame ids only and cannot address an out-of-process frame. The
   refutation holds.
2. After `frame.switch`, **`js`, `page.text` and `page.state` still read the main document**,
   while `page.read` and `wait.element` read the switched frame. The in-frame query is therefore
   `wait.element --selector <sel> --timeout <short>`, which is already in the adapter's read-only
   set. A `js` query after a switch would be a false reading and is forbidden in the probe.
3. `frame.main` restores the context, and a navigation of the tab resets it without being asked.
4. The frame context is per tab, so a switch in the run's owned tab cannot leak into any other
   tab.

`frame.switch --index` numbers the top-level iframes in DOM order, which matches the DOM index
the topology already carries.

**Consequence.** The probe is unblocked and has a concrete design:
- once per top-level candidate: `frame.switch --index <domIndex>`, then `wait.element`, then
  `frame.main`;
- the probe runs inside a scoped `browser_session` switch-with-restore step class, where a
  `frame.main` that fails poisons the tab: it is closed and never reused;
- a nested candidate (no DOM index) counts as not probed, so it blocks confirmation.

The gate rule is unchanged. #5569 goes back to pending as implementation work.

