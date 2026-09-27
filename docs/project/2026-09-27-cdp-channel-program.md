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

**S3 result (AK #6145).** `surf plan --frame <url>` (`SessionPlanRequest.frame`) runs the plan
probe as a frame step. The plan records `target.frame` (`url`, `origin`, `landed_href`); its
fingerprint is taken over the frame; its approval token binds the frame's URL, while a
top-document plan's token is unchanged. The page's own `landed_href` and title still come from
the readiness gate. `surf apply` then runs every step in the frame: the fingerprint, each value,
each read-back, each observation and the one click, all through the same runner and ledger steps.
`mutation.allowOrigins` has to name the frame's origin as well as the page's, and the refusal
says which one is missing. The default `left_url` post-condition is judged against the frame's
URL, never the page's. A field the named frame does not have is `plan_field_not_found` naming the
frame, with no frame diagnosis. A frame that is not named by URL is refused, because its origin
is what the allowlist judges.

Four findings, three of them only visible live, each measured before the fix and each with a
test that turns red without it:

- **Page-level input does not reliably reach an out-of-process frame in an unpainted window.**
  With the window on an unseen workspace, 4 of 10 page-level clicks on a button in an OOPIF
  landed on the host's `<iframe>` element instead. Chromium routes input into an OOPIF by
  hit-test data that a window painting no frames does not have. The same click sent on the
  frame's own session, in the frame's coordinates, landed 10 of 10. S1 dispatched every pointer
  event on the page session at page coordinates. It now dispatches on the session that hosts the
  element, at the element's point in that session's coordinates, with held modifiers on the same
  session, and the page-origin arithmetic is gone. The first live submit found this: the click
  "succeeded", the form never submitted, and the receipt correctly settled `unknown`. After the
  fix: 10 of 10 through `openCdpActions`, and the S1 page regression is unchanged (late 536 ms,
  sliding 22, late-enabled 21, covered refused).
- **A page-world `evaluate` in a same-process frame ran in the host's document.** It was sent
  without a context. `Runtime.enable` reports one default context per frame before it answers
  (measured: `auxData {frameId, isDefault: true}`, alongside surf's isolated world). The page
  world of any frame is now that context, found by frame id and remade once when a navigation
  destroys it. Live: a global set in the inner frame's page world is visible there and not in
  its isolated world.
- **A frame found by URL is lost when the frame navigates.** A submit that moves the frame
  (`payform.html` -> `paid.html?...`) leaves no frame at the URL the plan named, so the
  observation that verifies the submit could not find it. Measured: an OOPIF keeps its CDP frame
  id across its own navigation. A session now pins each frame name to the frame id it first
  resolves to; a pinned frame that is gone is refused by the caller's name, and never looked up
  by URL again. Replies carry the `frameId`.
- **Frame receipts named surf.** The class map's declaration reason ("surf type acts on the
  target page") became the receipt's evidence for an act surf never ran. A frame step's
  declaration now says "type acts on the target page, in frame <url> over the DevTools
  connection", so every frame receipt names the frame and the channel.

Live on Chromium 153 (Agent), window on an unseen workspace, through the CLI. The page is on
`127.0.0.1` with the form in a `localhost` frame (out of process); the control is the same form
as the top document. Three rounds:

| Step | Frame form | Same form as top document |
|---|---|---|
| `surf plan` | 452-469 ms, submit identified, Save card forbidden | 467 ms |
| apply, frame origin not allowlisted | refused before a tab opened, 90 ms | - |
| apply (fill) | 594-607 ms, 2 fields read back, 2 receipts applied | 922 ms |
| apply `--submit --confirm-plan` | 926-931 ms, receipt applied, verified by the frame reaching `paid.html` | 2330 ms |
| the same submit again | `submit_already_attempted`, 93 ms | - |

The receipts of both routes have the same keys, step ids, effects, scopes, outcomes and
`verified_by`; the frame route's evidence adds the frame and the channel.

**Review (three rounds, `openai-codex-2/gpt-6-astra`).** Every finding below was real, and each
was fixed red-first:

1. The stored `target.frame.origin` was trusted, but the approval token binds only the frame's
   URL. An edited origin passed the allowlist while the acts landed elsewhere. The schema now
   refuses a frame origin that is not its URL's.
2. While a disabled submit waited to enable, nothing checked where the page or frame was. A
   frame replaced by another document with the same selectors would have been clicked. The
   runner now refuses to click when the observed URL is not one the plan read
   (`submit_control_changed`), and for a frame plan only the frame's own URLs count.
3. The operation passed the page's URL as the `left_url` baseline for a frame plan, and the
   fill-time side-effect check accepted the page's URL inside the frame. Both now use the frame.
4. The recorded landing was not bound. The schema now requires it to equal `fingerprint.url`,
   and apply refuses a live URL that is not the fingerprint's, so a forged baseline goes
   nowhere (live: `plan_stale`).
5. The check-then-act gap between the last observation and the click: pinning keeps the frame,
   not its document. Every fill and the click now name the documents the frame may hold. The
   element's `ownerDocument` URL is read after it is actionable and immediately before any
   input; anything else is `action_document_changed`, a refusal before input (live: 82 ms,
   nothing sent, receipt `failed`). A script step that names documents reads the frame's URL
   first. The window left is two CDP round trips.
6. The transport re-parsed the session's `--tab-id`-extended argv and skipped flags, so a value
   of `--into` swallowed `--selector` and the selector was typed as the text. A frame step now
   gets the caller's own argv, read by position, with flags looked up only after the positional
   words: `--into` is typed as `--into`.
7. The allowlist judged the origin a frame was named by, not the one it landed on after a
   cross-origin redirect. The same gap held for a top-document page that redirects (http to
   https, a login bounce). Every origin the plan acts on must now be allowlisted: the page's,
   where it landed, the frame's, and where the frame landed. Plans with no redirect are
   unaffected.

The surf (top-document) click keeps one residual that the frame route no longer has: it cannot
check its element's document just before input. Tests: 8 for plan and
apply in a frame (fake surf plus a fake DevTools endpoint whose frame answers the real probe,
read-back and observe scripts). The fake surf's DOM stub now lives in
`tests/fixtures/stub-dom.mjs`, so both fakes run the same scripts against the same form model.
There is 1 new frame-pinning test, and the S1 tests now model the unpainted window. Twenty
mutations were checked (each frame site in the runner, the start URL, both origins, the token,
the not-found branch, the page facts, the fingerprint URL, the pins, the page world, the
session and modifiers of pointer input, and the declaration); every one turned a test red.

### S4 - a CDP step backend for the session

`SurfSession.step` routes `js`, `type`, `select` and `click` to the CDP channel when it is bound,
with the same declaration, ledger step and receipt; surf keeps the tab lifecycle and the readiness
gate. The action-channel gate decides whether it is on by default. The per-step form landed
first; see "Order changed" above. Routing steps that name no frame stays with this gate.

## 4. Done when

Each slice: design section updated with what was learned, red-first tests with mutation checks
on the properties that matter, `npm run check` green, a live proof on Chromium (Agent), pushed
through the hook, AK completed with the evidence.
