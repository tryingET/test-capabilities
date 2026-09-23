---
summary: "Many-of-the-greats adjudication for AK #5567: whether the a11y channel's tabLeak carries more than evidence, given that agent-browser 0.35.1 strands one about:blank page target per new session. Decision (contextual dominance): the leak is attributed, not subtracted - exactly the measured producer stray on a measured tool version is known_producer_stray and stays evidence; any other page that appears while the channel holds its session is unexplained and refuses a required channel with tab_leak. The effect declaration stops claiming the browser is left untouched."
read_when:
  - "You change the a11y channel's tab-leak rule, the list of measured agent-browser versions, or the channel's effect declaration."
  - "A required a11y channel refused with tab_leak and you want to know why that is a refusal and a stray about:blank is not."
  - "agent-browser is upgraded and the known stray has to be re-measured."
type: "decision"
---

# tabLeak: evidence or refusal (AK #5567, 2026-09-23)

The facts this rests on. The a11y design packet's P6 says that stray-tab detection is part of the page
result: the page count in `/json/list` must be the same before and after the run, or else the page
reports `tab_leak` with the URLs that leaked. The S9 live run measured agent-browser 0.35.1
creating one `about:blank` page target on the first command of every new session, whether or not
the session is pinned, and measured `close` ending the session without closing that page
(`2026-09-07-a11y-snapshot-live-run.md` §5.2 and §6). S9 therefore shipped `tabLeak` as
evidence that changes no verdict (`2026-09-07-slice-s9-notes.md`, deviation 2 and the peer
consultation). Two further facts come from the code. The `before` and `after` target lists are
read inside `capture`, around the channel's own bind and snapshot, and neither surf nor any
other step runs in that window. And `A11Y_SNAPSHOT_EFFECT` states that the channel "changes
nothing about either" the target or the browser.

## QUESTION

A read-only observer creates a side effect that anyone can predict, on every healthy run. Should
the page-count check that detects this effect decide the verdict (a refusal), inform the reader
only (evidence), or do something with more structure than either?

## MODE 1 - MANY OF THE GREATS

### School 1: Fail-closed specification (the contract purist)
- Core claim: the packet states that the counts must match, so a mismatch is a failure, and being
  able to predict a failure does not make it a success.
- Premises: a specification is the only neutral judge. Redefining success because an outcome is
  expected is the same as moving the goalposts. An observation run is not compliant just because
  the application under test is healthy.
- Strongest case: every silent exception begins as a known quirk. Once one known leak is accepted,
  the check can no longer tell a known leak from a new one, and the next leak goes through
  unseen. The S9 peer said it directly: "a known leak does not authorize additional mutations".
- What it sees that others miss: the stray is a real mutation of shared browser state, and a
  channel that calls itself read-only is producing it.

### School 2: Signal detection (the alarm engineer)
- Core claim: an alarm that fires on every run carries no information. Wiring such an alarm into
  a verdict does not make the system stricter. It destroys the `required` mode, because an
  operator will turn a check off before living with a permanently red check.
- Premises: the value of a check is the information it adds to the verdict. Alarm fatigue is a
  failure mode that has been measured, not a matter of taste. Evidence that is recorded, keeps
  its URLs and sits in the envelope is not hidden.
- Strongest case: if `tab_leak` were a refusal under 0.35.1, a `required` channel would fail
  every page on every run. The only way left to use the channel would be `optional`, where the
  check is again only evidence. So the purist's rule would get the purist a weaker system.
- What it sees that others miss: the check fires on every run, and the rule has to be judged by
  what operators will actually do when faced with it.

### School 3: Causal attribution (the forensic accountant)
- Core claim: the question is not "did the count change" but "who changed it, and is that cause
  already understood". A change with a known cause is a recorded cost. A change with an unknown
  cause is a defect.
- Premises: the observation window is closed. Between `before` and `after` only the channel acts,
  so every new page in that window was caused by the channel. The known cause has a precise
  signature (tool, version, exactly one page, URL `about:blank`) that was measured three times
  with fresh sessions.
- Strongest case: attribution classifies a leak without subtracting anything from its count.
  The peer's objection to subtraction ("can mask an unrelated leak if the expected stray does not
  appear") applies to arithmetic on counts, not to matching the identity of what leaked. A
  second page, any URL other than `about:blank`, or a tool version nobody measured falls outside
  the signature, so the leak is unexplained, and the rule has not moved the goalposts: it names
  where they are.
- What it sees that others miss: the closed observation window turns a heuristic into a proof of
  attribution.

### School 4: Effect honesty (the mutation-safety steward)
- Core claim: the verdict matters less than the declaration. A channel that leaves one page
  target behind on every run, and never closes it, does not "change nothing". The ledger has to
  say what the channel does before any rule about the verdict means anything.
- Premises: effects accumulate. A hundred runs leave a hundred `about:blank` pages in the agent
  browser. Cleaning that up would be a further mutation, outside the read-only argv allowlist.
  A false effect declaration is worse than a known effect, because every downstream consumer
  relies on it.
- Strongest case: the S9 cleanup found a real bug (an unavailable channel creating a session just
  to close it) only because the accounting stayed visible. The same accounting now shows that the
  effect declaration is wrong. Fixing the verdict and leaving the declaration wrong would repeat
  the original mistake one level up.
- What it sees that others miss: the stray persists, and the declaration is inaccurate today.

## MODE 2 - CONFRONTATION

### Clash 1: Fail-closed specification vs Signal detection
- Fundamental contradiction: the purist judges a rule by whether each verdict follows the text;
  the alarm engineer judges it by the information in the whole stream of verdicts. A rule can pass
  the first test and fail the second.
- Incompatible assumptions: "a predictable failure is still a failure" and "a failure that is
  always present is not a signal" cannot both decide the same verdict.
- What the purist explains better: why accepting the stray silently would blind the check to the
  next leak.
- What the alarm engineer explains better: why a refusal on every run leads operators to
  downgrade to `optional` and so weakens the system.
- Residual tension: none, once School 3 splits the one check into two questions.

### Clash 2: Signal detection vs Causal attribution
- Fundamental contradiction: the alarm engineer would keep `tabLeak` as evidence only. The
  accountant says evidence only also records an unexplained leak as evidence, so the verdict
  cannot see the one case that matters.
- What attribution explains better: the difference between the 0.35.1 stray and a new leak,
  which the evidence-only rule treats identically.
- What signal detection explains better: why the known stray must not refuse.
- Resolvable: yes. The attributed case is evidence, and the unexplained case carries a verdict.

### Clash 3: Causal attribution vs Fail-closed specification (the peer's objection)
- Fundamental contradiction: the purist says any exception needs "reliable target attribution",
  and doubts that it can be had. The accountant says the closed window provides it.
- What the purist explains better: an attribution keyed only on the URL could mask a second
  `about:blank` from another cause. The window rules out another actor, but not a second defect
  in the same tool. That is why the signature requires exactly one page and a measured version.
- Residual tension: a future agent-browser could produce a different defect whose only
  symptom is one `about:blank`, with the known stray absent. On a measured version that would be
  classified as known. This is irreducible at the resolution `/json/list` offers (no opener id,
  no creation time), and it is accepted: the version list is what bounds it.

### Clash 4: Effect honesty vs every verdict school
- Fundamental contradiction: the three verdict schools argue about the page result. The steward
  says the page result is downstream of a declaration that is currently false.
- What effect honesty explains better: why accumulation (one page per run, never closed) matters
  more than any one verdict, and why no rule about the verdict can repair it.
- Resolvable in part: the declaration can be made accurate now. The leak itself is agent-browser's
  to fix; closing the stray from this side would be a mutation outside the allowlist.

## MODE 3 - INTEGRATION OR DECISION
- Chosen path: **Contextual dominance**, with School 4 as a precondition that is not negotiable.
- Result:
  1. The channel attributes each leak and never subtracts. A leak is `known_producer_stray` only
     when all three hold: exactly one new page target, its URL is `about:blank`, and the tool
     version is in the measured list (`0.35.1`). Anything else is `unexplained`.
  2. Where the leak is known, **signal detection dominates**. It stays evidence on the artifact and
     in the envelope, carrying the URL, and changes no verdict in either mode.
  3. Where the leak is unexplained, **fail-closed dominates**. A `required` channel refuses the page
     with `tab_leak` (now a registered code) after the artifact is written, so the refusal still
     reports what it saw. An `optional` channel records the leak as evidence with attribution
     `unexplained` and continues, because `optional` is the mode in which the operator has said
     the channel's findings do not gate the page.
  4. The effect declaration says what the channel does. It still opens, navigates and clicks
     nothing on the target. On 0.35.1 it leaves one `about:blank` page target in the agent
     browser per session and does not close it.
- Why this path is justified: every verdict now carries information. The known stray is visible
  and does not gate, and any leak the rule does not recognise gates a `required` run. The
  version list turns an agent-browser upgrade into a re-measurement: a new version that still
  strays refuses under `required` until someone measures it and adds it to the list. That is the
  fail-closed default applied to a producer change, the same stance the version floor already
  takes.
- What remains unresolved: the stray still accumulates, one page per session. The fix belongs
  upstream in agent-browser, filed as vercel-labs/agent-browser#1986 (2026-09-23). The cause is a
  fresh `--pin-tab` session opening a tab on attach before its `tab <targetId>` binds. Clash 3 records the one masking case attribution cannot rule out.

## PRACTICAL CONSEQUENCE

- `A11yTabLeak` gains `attribution: "known_producer_stray" | "unexplained"`, decided by a pure
  function over the leak and the tool version. The measured versions are one exported list
  beside the version floor.
- `tab_leak` joins `A11Y_CHANNEL_ERROR_CODES`. A `required` observer throws it for an unexplained
  leak after writing the artifact.
- `A11Y_SNAPSHOT_EFFECT.reason` names the stray. The effect class stays `read_only`, since nothing
  on the target changes and the browser page is recorded rather than hidden.
- The docs follow: the `tabLeak` row in `docs/api/cli.md`, the code table in `docs/api/errors.md`,
  and posture follow-up 10, which this closes.
- Carried forward rather than done: an upstream agent-browser issue for the per-session stray,
  offered to the operator.
