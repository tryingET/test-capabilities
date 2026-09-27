---
summary: "Design package for the CDP channel program (operator 2026-09-27: 'work until you created the most awesome thing out there'). Our own CDP actions (openCdpActions, AK #6099) are the fastest measured and the only fast option that works on the shared owned tab; this program closes what they lack (waiting, re-resolution, input breadth, every frame, dialogs) and integrates them where test-capabilities gains correctness or capability, not only speed: the frame probe, forms inside frames, then a CDP step backend. Four slices, each with red tests, a live proof and a gate."
read_when:
  - "You extend openCdpActions, or move a surf step onto the CDP connection."
  - "The frame probe, forms inside iframes, or a multi-step flow is slow, unprobed or impossible."
type: "design"
status: "accepted for execution by the operator 2026-09-27; slices land in order, each gated"
---

# The CDP channel program (2026-09-27)

## 1. Where it starts

`src/core/cdp-actions.ts` (AK #6099) acts on the owned tab over the connection the a11y channel
holds: trusted clicks through out-of-process frames (hit-tested), fill, select, evaluate in any
out-of-process frame. Measured: click 14 ms (surf 192, Playwright 25, Vibium 59). What it lacks
is everything around a single action (`2026-09-27-playwright-action-channel-design.md` section 8
and the gap list the operator asked for).

## 2. Principles

- **Correctness before speed.** A slice lands where it removes a failure mode or adds a capability;
  speed alone waits behind the section 4 gate of the action-channel design.
- **The contracts stay:** the owned-tab rule, effect declarations, one ledger step per browser
  step (read-only steps without receipts, mutating ones with), refusals as typed codes, no stray
  targets, the a11y channel read-only.
- **Reads go to isolated worlds.** A probe or read-back runs in `Page.createIsolatedWorld` for the
  frame, so the page's own scripts can neither see nor tamper with it.
- **Every frame is addressable** by its CDP frame id: an out-of-process frame through its session,
  a same-process frame through an isolated world in its parent's session.

## 3. Slices

### S1 - the missing pieces of the actions (AK: created with the slice)

- **Actionability:** every action waits (default 5 s, polled every 50 ms) until the element is
  attached, visible, has a stable box across two frames, is enabled, and the hit test passes;
  the refusal names the condition that never held (`action_target_not_ready` with
  `{attached, visible, stable, enabled, receivesEvents}`).
- **Re-resolution:** a target may be `{ role, name }`; it resolves against a fresh read of the
  forest, so it survives navigation and re-rendering. A stale ref is refused as drift, never
  guessed.
- **Frames:** `frame` accepts any frame's URL or CDP frame id, same-process frames included.
- **Input breadth:** `press(key)` (Enter, Tab, Escape, arrows, with modifiers), `type` key by key,
  `hover`, `dblclick`, `check`/`uncheck` (idempotent, verified), `setFiles` (file inputs).
- **Dialogs:** `alert`/`confirm`/`prompt` opened by an action are recorded and answered by an
  explicit policy (default: dismiss and report), never left blocking.
- **Gate:** fake-endpoint tests for each condition red first; live on pages that render late,
  move, re-render, open dialogs and hold same-process frames.

**S1 result (AK #6126).** `cdp-actionability.ts` (the wait), `cdp-keys.ts` (keys, chords),
`cdp-actions.ts` (click, dblclick, hover, fill, type, press, check, uncheck, select, setFiles,
evaluate, refresh), and same-process frames in the a11y snapshot. Measured live before relying on
them, on Chromium 153:
- the page's accessibility tree leaves same-process iframes out: each needs
  `getFullAXTree({frameId})` in its host session - **the a11y channel missed them until now**;
- quads of elements in same-process frames are already in the local root's coordinates, and
  `DOM.getNodeForLocation` hit-tests into them - but only at **integer** coordinates (a fractional
  centre is "Invalid parameters"; the first live run reported every click obscured);
- a removed node still resolves while referenced, detached - so a ref checks `isConnected` and is
  `ref_context_drift`, never "not ready";
- `mouseMoved` is aligned to the next animation frame: in a window that paints no frames its ack
  takes ~1 s, and the press that follows flushes it with the event order intact - a click no
  longer awaits the move (974 ms -> 1-2 ms). Launcher flags were measured and rejected:
  `--disable-backgrounding-occluded-windows` changes nothing, `--disable-frame-rate-limit` fixes
  the move but burns 99 % of a core idle;
- a dialog is reported to the connection with surf attached and is answered in ~8 ms.
Live (window on an unseen workspace): a late button, a sliding one and a late-enabled one each
clicked once ready (536 / 20 / 24 ms); a covered one refused; a re-rendered one found by role and
name (48 ms) while its old ref is drift; key-by-key typing and Enter submitted the form; check,
select by label and setFiles verified by the page; a same-process frame's button clicked by role
and name; an alert dismissed and the page continued; pages 1 -> 1. Tests: 19 on a fake that models
each of these behaviours; each of no waiting, no stability check, no hit test, a guessed
ambiguity, no release and an unanswered dialog turns one red.

### S2 - the frame probe over CDP

`frame-diagnosis.ts` probes each top-level candidate with `frame.switch`, `wait.element`,
`frame.main` (225 ms per candidate); nested candidates are `unprobed`, and a failed restore closes
the tab (`frame_context_unrestored`). Over CDP the probe is a read in the candidate's own frame
(`cdpFrameIds`), switches nothing, and reaches nested and same-process candidates.
- **Gate:** the same determinations as today on the recorded fixtures; nested candidates probed;
  no `frame.switch` in the ledger; a live page with a nested target confirmed where today it is
  `unprobed`.

**S2 result.** `cdp-frame-probe.ts`; `frame-diagnosis.ts` runs it as one read-only ledger step
(`surf.frame.probe.cdp`) and falls back to the surf probe when the DevTools channel is absent or
fails part-way. Measured live first: surf's frame tree holds only the page's in-process frames,
so out-of-process candidates arrive with no CDP frame id; they are mapped by DOM index (the owner
iframe's index in the top document, exact even after a redirect) or, nested, by URL; a candidate
that maps to none or several is `unanswered`. Live: the nested target that was `suspected` ("1 of
2 candidate frame(s) could not be probed") is now `confirmed` (nested frame .../inner2.html); the
top-level case stays `confirmed`; surf's host log for both runs holds no `frame.switch`,
`wait.element` or `frame.main`, so `frame_context_unrestored` cannot happen on this path. Tests:
7 unit (mapping, redirect, polling, ambiguity, worlds, read-only, release; four mutations each
turn one red), 2 CLI end to end against fake surf and a fake DevTools endpoint (both fail when
the CDP probe is disabled), 1 in-process fallback test.

### Order changed: S4 before S3

Reading the apply runner showed that every page-facing call of plan and apply - the probe, each
read-back, each value set, the observation, the submit click - goes through `Session.step`, which
carries the effect class, the idempotency key, the receipt, settlement and `verify`. Forms in
frames therefore need a step that can run in a frame, not a second copy of that machinery. S4
lands first, narrowed to exactly that:

- `BrowserStep.frame` (a frame URL, label or CDP frame id). A step without it is unchanged and
  runs on surf; a step with it runs over CDP in that frame (`cdp-step-transport.ts`), inside the
  same `runLedgerStep` - declaration, key, receipt, settle and verify untouched.
- Commands: `js` (a `read_only` declaration evaluates in the frame's isolated world, a `mutating`
  one in the page's world), `type` (trusted fill), `select`, `click`. Any other command with a
  frame is refused before anything runs.
- Replies carry a new result source, `cdp`, never `surf`. A refusal raised before any input
  (not found, not ready, obscured, ambiguous, unsuitable, unknown frame) is a definite `failed`;
  anything after input was sent settles `unknown` (`mutation_outcome_unknown`), never retried.

**S4 result (AK #6132).** Landed as above, with two findings from the tests:

- The frame check has to come first in `Session.step`. The session's own target check refuses
  a command with no `--tab-id` mapping (`screenshot`) with `owned_tab_required`, which misnames
  why a frame step is refused. `assertFrameStepCommand` now runs before the declaration and the
  target arguments, so a frame step is refused as `action_frame_step_unsupported` before any
  process or connection exists.
- The class table still applies: `type`, `select` and `click` are mutating, so a frame step on
  them declared `read_only` is refused as `effect_declaration_invalid`, exactly as on surf, and
  a mutating frame step still needs `mutation.allowOrigins` to name the page's origin. A
  malformed mutating step (no selector, no value) raises no input and settles `failed`.

Live on Chromium 153 (Agent), 2026-09-27: a host page on `127.0.0.1` with a payment form in a
`localhost` frame (a separate site, so out of process). Each run was one `SurfSession`, with surf
owning the tab.

| Step in the frame | Time | Result | Receipt |
|---|---|---|---|
| `js` read-only: status | 44 ms | `unpaid`, source `cdp` | none |
| `type 4242 --selector #card` | 63 ms | `OK` | applied |
| `select #country fr` | 49 ms | `Selected: fr` | applied |
| `click --selector #pay` | 67 ms | `OK` | applied |
| `js` read-only: status | 11 ms | `paid 4242 fr` (the form submitted) | none |
| `js` mutating: `window.payCount` | 30 ms | `1`, read in the page's world | applied |
| the same `click` key again | 1 ms | `mutation_replay_refused` | none |
| `click --selector #covered` (overlaid) | 5053 ms | `action_target_obscured`, nothing clicked | failed |
| `screenshot` with a frame | 0 ms | `action_frame_step_unsupported` | none |

A step with no frame in the same session still ran on surf (`js document.title` → `checkout
host`, 60 ms). Tests: 7 contract tests with a fake surf and a fake DevTools endpoint. Nine
mutations were checked: world choice, the before-input set (obscured, unknown frame,
unsupported), wrapping everything, rethrowing everything, the read-only rethrow, the select
reply, the step-level refusal, and the frame branch. Every one turned a test red.

### S3 - forms inside frames

Plan and apply read fields back with `js`, which surf refuses in a selected frame, so a form in
an iframe (payment fields, embedded login) cannot be planned or applied. Over CDP: field
discovery, read-back and trusted input in the frame, with the submit gate unchanged.
- **Gate:** plan and apply a form in a cross-origin frame live, receipts and read-backs as for a
  main-page form; nothing submitted without the gate.

### S4 - a CDP step backend for the session

`SurfSession.step` routes `js`, `type`, `select` and `click` to the CDP channel when it is bound,
with the same declaration, ledger step and receipt; surf keeps the tab lifecycle and the readiness
gate. The action-channel gate decides whether it is on by default. The per-step form landed
first; see "Order changed" above. Routing steps that name no frame stays with this gate.

## 4. Done when

Each slice: design section updated with what was learned, red-first tests with mutation checks
on the properties that matter, `npm run check` green, a live proof on Chromium (Agent), pushed
through the hook, AK completed with the evidence.
