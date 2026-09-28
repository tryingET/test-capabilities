---
summary: "Design package for `surf flow` (AK #6164): a closed, LLM-writable step language run in the owned tab on one held DevTools connection, with an effect class per step, receipts for every act, typed refusals, a content-bound submit gate and at-most-once submits. It reopens the action-channel gate on its stated condition (action-heavy runs) without letting any step bypass the owned-tab, origin, effect, receipt, replay or submit boundaries."
read_when:
  - "You run, extend or review `surf flow`."
  - "You decide whether a multi-step browser journey belongs in plan/apply or in a flow."
type: "design"
status: "accepted for execution under the operator's instruction of 2026-09-28; slices F1 and F2 land in order, each live-gated"
---

# `surf flow` (AK #6164, 2026-09-28)

## 1. Why now

The action-channel gate (`2026-09-27-playwright-action-channel-design.md` section 5) recorded its
own reopen condition: runs with tens of steps, where surf costs ~55-190 ms per step against
~1-25 ms on a held DevTools connection. `surf flow` is that run: a journey an LLM writes (log in,
move through a wizard, fill, check, submit) that `surf plan`/`apply` cannot express, because apply
fills one form it reviewed and nothing else.

A flow is power, and power is exactly what the kernel's boundaries exist to fence. So the design
starts from what must not change.

## 2. What must not change

- **Owned tab.** A flow runs in the one tab its session opened, gated and closes. It names no tab,
  opens none and navigates only by acting on the page. surf keeps the tab's lifecycle.
- **Effects.** The class of a step comes from its action, never from the flow file. Read-only
  steps write no receipt; every act is `mutating`/`target`, receipted, attempted once.
- **Origins.** `mutation.allowOrigins` names every origin a flow may act on, checked for the start
  URL before a tab exists and, just before input, for the document of the element acted on (the
  ledger alone judges the session's start URL, which a flow may have left).
- **Replay.** A step's idempotency key is derived from the flow's content and the step's id, so a
  rerun of the same flow meets the in-doubt interlock (`mutation_replay_refused`) for any act a
  previous run left `attempting` or `unknown`.
- **Submit.** No step can act on a form-level control unless the flow declares that step a
  submit, the operator approved the flow's exact content, and the flow was never submitted before.

## 3. The step language (flow file v1)

A flow file is JSON or YAML (`js-yaml`'s safe `load`), at most 1 MiB, a regular file (no
symlink), validated closed: an unknown key, action or field is refused, never ignored.

```yaml
schema_version: 1
url: https://shop.example/login
steps:
  - { id: user, action: fill, target: "#user", value: alice }
  - { action: fill, target: { role: textbox, name: Password }, value: "..." }
  - { action: click, target: "a.next" }
  - { action: wait, for: { selector: "#card" }, timeout_ms: 5000 }
  - { action: select, target: "#country", value: fr }
  - { action: check, target: "#terms" }
  - { action: press, key: Tab, target: "#card" }
  - { action: assert, that: { field: { target: "#card", equals: "4242" } } }
  - { action: click, target: "#pay", submit: true, expect: { url_prefix: "https://shop.example/done" } }
```

- `id`: optional, `[A-Za-z0-9_-]{1,64}`, unique; `s<n>` by position when absent.
- `target`: a CSS selector or shadow path (`host >>> field`, AK #6163), or `{ role, name }` found
  afresh in the accessibility tree; read steps take selectors only.
- `frame`: optional; a frame by HTTP(S) URL, matched by origin+path and pinned for the run.
- `timeout_ms`: optional, at most 30000; the actionability wait of an act, the deadline of a wait.
- Actions: `wait` (`for`: `selector` visible, `text` in the body, or `url_prefix`), `assert`
  (`that`: the same three, or `field: { target, equals }` against a value or `"true"`/`"false"`
  checked state), `fill`, `select`, `check`, `uncheck`, `click`, `press` (`key`, a chord such as
  `Enter` or `Shift+Tab`, with a required `target` it focuses first).
- `submit: true` and `expect` (`url_prefix`, `text`, or `left_url: true`, the default) are allowed
  on `click` and `press` only.

Deliberately absent from v1: script evaluation (`js`), navigation to a URL, new tabs, hover,
file uploads (a flow could read any local file), and waits that sleep. A missing capability is a
refusal at parse time, not a fallback.

## 4. Effect per step

| Action | Effect | Receipt | Runs |
|---|---|---|---|
| `wait`, `assert` | `read_only` | none | an isolated world of the page or frame |
| `fill`, `select`, `check`, `uncheck` | `mutating`/`target` | one per step | trusted input on the element's own session |
| `click`, `press` | `mutating`/`target` | one per step; a submit step settles `unknown` until its `expect` is seen | as above |

Every step is one `Session.step` through the frame-step path (`BrowserStep.frame`, `main` for the
page), so declaration, key, receipt, settle and `verify` are the ledger's own. The receipt's
evidence names the frame and the DevTools channel; its details carry the flow id, the step id,
the action and the target, never the value.

## 5. One held connection

The per-step path opens a connection and reads the accessibility forest for every step (S4
measured 44-67 ms per step, no faster than surf). A flow holds one `openCdpActions` for the run,
bound through the same document time-origin proof as apply, and every step uses it; apply keeps
its per-step path. The flow operation releases it before the session closes the tab. On a held
connection the page's frame id is its target id (it survives navigation) and isolated worlds are
remade once when a navigation destroys them; a step naming a frame reads the frames afresh first.
A dialog stops the step that sees it, and the flow with it; one that opens between two steps
(after the first completed) is seen by the next, which a per-step connection could not do.

If the DevTools connection does not bind the owned tab, the flow refuses before its first step,
with the bind's code: surf has no before-input check for any of the guards below.

## 6. Guards just before input

After the element is actionable and before any input, on the element itself:

1. **Origin**: its document's origin must be allowlisted, else `mutation_origin_not_allowed`.
2. **Form-level control**, the same class apply forbids. A click is judged at the node a real
   pointer at the element's point hits (`pointer-events: none` honoured): that node, or the
   nearest button-like element on its event path (through slots and out of shadow roots:
   `button`, an `input` of type submit, button, image or reset, or `role=button`), or the control
   of a label on that path, is gated when it belongs to a form; a click that reaches a frame is
   gated. A key press of `Enter` or `Space`, with any modifiers, is gated whatever the target:
   these keys activate what holds focus, and a focus handler, a closed shadow root or a frame can
   put focus where no check can follow. A gated act by a step that is not an authorized submit
   is `flow_submit_undeclared`, before focus or any input. Fields, checkboxes, radios, links and
   other keys are not gated.
3. **Documents**: a frame step keeps the frame's pin; the page's documents are not frozen (a flow
   navigates by design), which is why the origin is checked on every act.

All three refuse before input: the receipt settles `failed`, and the flow stops.

## 7. Submit authorization

- The flow's **approval token** is `sha256` over the RFC 8785 canonical form of its whole
  normalized content (the URL and every step, ids and defaults filled). Every run prints it. It
  binds an approval to exactly what was reviewed; it is not a secret and grants nothing alone.
- **Without `--submit`** a flow runs up to its first submit step and stops there before input:
  `status: "stopped_at_submit_gate"`, exit 0, like apply's fill mode. `--confirm-flow` without
  `--submit` is `submit_gate_closed`.
- **With `--submit`**, before a tab exists: the flow must declare a submit step (else
  `config_invalid`), `--confirm-flow` must be given (`submit_gate_closed`) and equal the token
  (`flow_approval_mismatch`), and no submit receipt may exist for the flow id
  (`submit_already_attempted`, any outcome): a flow is submitted at most once.
- A submit step's act settles `unknown`; its `expect` is the receipt's `verify`, polled within
  `surf.submit.postconditionTimeoutMs`. Seen: `applied`. Not seen: the receipt stays `unknown`,
  the flow stops with `submit_postcondition_unmet`, and later steps never run. A dialog during a
  submit is `action_dialog_opened` and is never promoted.

## 8. Refusal model

Before a tab: `config_invalid` (file, schema, flags), `mutation_origin_not_allowed` (start URL),
`submit_gate_closed`, `flow_approval_mismatch`, `submit_already_attempted`. Before the first step:
the bind's code (`cdp_endpoint_unreachable`, `tab_bind_ambiguous`, ...). Per step, before input
(receipt `failed`): the `action_*` target refusals, `action_document_changed`,
`mutation_origin_not_allowed`, `flow_submit_undeclared`. After input (receipt `unknown`, flow
stops, never retried): `mutation_outcome_unknown`, `action_dialog_opened`,
`submit_postcondition_unmet`. Read steps: `flow_wait_timeout`, `flow_assertion_failed`. A rerun
of an in-doubt act: `mutation_replay_refused`. Every refusal names the step id.

## 9. Relation to plan/apply

Plan/apply is the reviewed path for one form reachable by URL: a structural fingerprint, field-only
addressing and one identified control. A flow is for journeys: it has no page fingerprint, so it
cannot detect a redesigned page beyond its targets resolving; in exchange every act is guarded on
its element, gated controls need a declared and approved submit step, and the submit is at most
once. Where a form is reachable directly, plan/apply remains the stronger gate.

## 10. Slices

- **F1**: file, schema, token, route and envelope; `wait`, `assert`, `fill`, `select`, `check`,
  `uncheck`, non-submit `click` and `press` on the held connection; the origin and form-level
  guards; frames; receipts and replay. Live gate: a multi-page journey with every action, a
  cross-origin act refused, a form-level click refused before input, per-step timings against the
  gate table.
- **F2**: submit steps, `--submit`/`--confirm-flow`, stop at the gate, at-most-once and `expect`.
  Live gate: stop at the gate, a refused wrong token, a verified submit, the repeat refused, an
  unmet post-condition left `unknown`.

## 11. Residuals (accepted)

No page fingerprint (section 9). An element whose script posts but that is no form-level control
(a button outside any form, a `div` or link with a click handler) is receipted, origin-checked and
at-most-once per key, but not submit-gated: the gate recognizes form controls, not every network
effect. A page that opens
a new tab or window leaves it; the flow never acts there. Closed shadow roots are opaque to every
page script: pointer capture held inside one is invisible to the after-press check, and a page
whose handler builds one during a click - a mouseup handler attaching a closed root whose form's
button takes the clicked content through a slot - is not visible at dispatch either. CDP sees
closed roots only between input events, and a check after the click cannot tell the navigation
of a submission from a link's. The click-time guard judges a click again whenever the trees
its path lives in change while it dispatches, but a click the page dispatches from a handler
has activated before that handler returns, and so before any change it made is seen. Such a
page, like one whose handler submits, is the page acting on
its own: the flow's receipt records the click, and the submit gate is not claimed for it. The check-then-act round trips of the
channel remain. `text` conditions read `document.body.innerText`, which omits shadow text.

## 12. Results

### F1 (reads, acts, guards, held connection)

Implemented as designed: `flow-file.ts` (schema, normalization, token), `cdp-flow-acts.ts` (acts,
reads, the two guards), the held connection in `cdp-step-transport.ts`, a `before` hook on CDP
acts (after the document check, before input; `press` now checks its target's document too), and
the `surf.flow` operation, route, types, CLI and docs. A frame step is held to `js`'s owned-tab
rule in `SurfSession.step` (surf-session.ts stays at its size). `--submit` lands with F2; until
then a flow stops before its first submit step.

Found while testing, each fixed with a test that fails without it: a dialog during an act was
reported as `mutation_outcome_unknown` (envelope receipt copies are redacted and carry no step
details; the step's own receipt, the latest, now names it); and counting dialogs per step on a
held connection would let a dialog that opens between two steps pass a following read. Every
dialog the held connection heard now stops the step that sees it, which also closes, for flows,
the #6161 residual about dialogs after a completed step.

Independent inspection (`openai-codex-2/gpt-6-astra`) found, each fixed red-first: (1) the
form-level check used `closest()`, which stops at a shadow root, so a click on an icon's shadow
tree inside a submit button, or on content slotted into a shadow form's button, escaped it - the
check now walks the event's path (assigned slot, parent, shadow host); (2) a select whose value no
option has leaked the value through `action_option_not_found` into the receipt - the flow's
refusal names the step only; (3) the check judged the target, not what the input reaches, so a
click on a wrapper whose centre a form's button covers passed - a pointer act is now judged at
the node its point hits, and a key press after focus, on the element that holds focus (the origin
is still checked before any focus); (4) js-yaml quotes the lines around a syntax error, values
included, and its reason can name an alias - a parse refusal now gives the line and column
only; (5) a submit button inside a label for a checkbox was judged by the label's checkbox - the
element's own control and the label's are both judged, either gated is gated; (6) a focus handler
can move focus into a same-origin frame's submit button, and (7) into a closed shadow root, where
no script can follow it - so rather than predict where a key lands, `Enter` and `Space` are now
gated whatever the target (stricter: `Enter` on a link needs a declared submit too), and the focus
walk that (6) had added is gone; (8) the hit test ignored `pointer-events: none`, so an overlay
that lets clicks through to a submit button was judged instead of the button - it now reaches
what a real pointer reaches, for actionability too (a click on such an overlay is refused as
obscured). A click that reaches a frame is gated. (9) A focus handler could also move focus
into a frame of another origin before a fill's text or another key went out: every fill, type
and key press now checks, after focus and before any text or key, that focus is still on its
element in each tree scope up to the document, and that its document holds the page's focus (a
frame whose handler moved focus to a sibling frame still names the element as its own focus;
measured live: `hasFocus()` answers per frame with the window unfocused) - `action_focus_moved`,
settled `unknown` because a handler ran; this protects apply's fills too. (10) A page could echo a typed value in a dialog,
or in its URL (`history.replaceState`), which the receipt recorded: a flow step's dialog is
recorded by its type and answer only. (12) The click check took the nearest button-like element
only: a `role=button` span inside a `form=`-associated submit button hid the button - every
button-like element on the path is judged now, and belonging to a form is any `form` owner on the
path. (13) A fill's select-all fires `select`, whose handler could move focus after the focus
check: focus is checked again just before the text goes out (measured live: Chromium queues the
event, and the text landed in the field 3 of 3; the check covers a handler that runs first).
(14) Refusals quoted page URLs, which a page may fill with a value it was given: a flow's
refusals name the origin only, and a frame refusal lists frames by origin. (15) Content slotted
into a closed shadow root's form button escaped the click check (a closed root's `assignedSlot` is
`null` to every script): the check also asks CDP whether a closed root hosts anything on the
click's path, and such a click is gated (measured live: `DOM.describeNode` names a root
`closed`, ~0.5 ms per element). (16) A modifier's keydown handler could move focus before the
key: focus is checked again after the modifiers go down, and they are released whatever
happens; (17) with several modifiers it is checked after each one, before anything more is sent.
The dialog handling moved to `cdp-dialogs.ts` to keep `cdp-actions.ts` in budget. (18) A mousedown
handler can make the pressed control form-level (set its `form=`) between the check and the
release: a click is judged again after its press, and if it now reaches a form-level control the
release goes outside the viewport, as for a mousedown dialog (#6161), and the step stops with
`flow_submit_cancelled`, settled `unknown` because the press was sent. (19) A check after the
press that cannot judge (a handler covered the control with a frame) now cancels too, never
reads as a clean before-input refusal. (20) Pointer capture defeated the cancellation: a control
that captured the pointer on `pointerdown` still received the release at (-1,-1) and completed
its click - measured live: with the fix removed, the server received the form's submit. A
cancelling release now first lets go of every pointer capture (document and open roots) and arms
a one-shot click blocker in the isolated world, removed right after; with it, nothing was
submitted. This hardens #6161's mousedown-dialog cancellation too. A page whose own capture
listener stops the click before ours runs is the page acting on its own (section 11). (21) A
pointerdown handler on an ungated control could hand pointer capture to a form's submit button,
which then received the release and its click - measured live: with the check removed, the other
form was submitted. After the press, the element holding capture (document and open roots) is
judged as a click on it would be, and a form-level captor cancels the click; live, nothing was
submitted. A captor inside a closed root is not visible to any script (section 11). (22) A
mouseup handler could still make the control form-level after every check and before the click
landed - measured live: with no click-time check, that form was submitted. Every check between
input events can be raced by the next handler, so an unauthorized click now also arms, after its
press passed, a capture listener in the isolated world that judges the click event's own target
at dispatch, just before activation, and prevents a form-level one (`flow_submit_cancelled`,
`unknown`); live, nothing was submitted. (23) A captor slotted into a closed root escaped the CDP
check, which walked the pointer's path only - measured live: without it, the closed form was
submitted; the captor's path is now asked too. (24) The click-time listener ran in the capture
phase, before a target-phase `onclick` that sets `form=` - measured live: with it alone, that form
was submitted. The guard listens in the bubble phase at the window too, after the page's own
handlers and before activation; live, nothing was submitted. A handler that also stops the
click's propagation is the page acting on its own (section 11). (25) The guard judged the target's
current ancestors, which a handler can change: a span whose onclick binds its button to a form
and removes itself hid the button - measured live: judged by the first node only, that form was
submitted. It now judges every element of the event's own path, fixed at dispatch; live, nothing
was submitted. (26) An Alt chord may be an access key, which activates the element carrying it:
Alt chords are gated like `Enter` and `Space`, and every unauthorized key press arms the
click-time guard, so a click any key causes is judged as it lands (not reproduced live: `Alt+k`
sent over CDP to the unfocused window activated no access key; gated anyway). (27) A held
connection cached a frame's worlds by frame id only, but context ids are unique within a session:
a frame that moved process could reuse an id valid in another session and read or act in the
wrong document. Worlds are now keyed by session and frame; and since a renderer that replaced
another behind the same session may reuse ids too, each isolated world carries a random stamp
on its own global, checked before reuse (a world that lost it is made again), while the page's
own worlds, which cannot be stamped without touching the page, are dropped on every navigation.
(28) A page can always add a click listener after the guard's (a mouseup handler registering one
that gives the button a form) - measured live: that form was submitted. For an unauthorized
click the guard now holds the native activation of the buttons on the click's path, whatever
type and form they have at that moment. One that is a submitter with a form by the time the
guard is read back is reported (`flow_submit_cancelled`); live, nothing was submitted. (29) The
same holds for a later listener that turns a `type=button` into a submitter and gives it a form
(measured live: submitted before, not after). Holding first ran before the page's handlers, and
three ordinary pages broke live: a component handler that skips a click whose default was
prevented did not run, a `popovertarget` button (a submitter with no form) did not open its
popover, and a button inside a link did not follow it (Chromium does). So the hold now runs at
the window after the page's handlers, which see the click as sent, and a click whose activation
does more than reach a form - a button with a popover or command target, or a link around it -
is not held: live, all three pages work, and the late-listener pages above still submit nothing.
(30) A later listener can make any input a submitter (a formless checkbox given `type=submit`
and `form=`), or give a popover submit button a form without touching it (a form renamed to
the id its `form` attribute names, a form inserted with that id, the button moved into a form)
- measured live: each of those forms was submitted. Holding every input would undo a
checkbox's toggle, so the guard now watches the trees the path's inputs and buttons live in
(a `MutationObserver` in the isolated world, from the capture listener on: the subtree, its
children, and the `type`, `form` and `id` attributes). Records arrive in the microtask
checkpoint after the changing listener returns, while the click still dispatches; every click
still dispatching is then judged again, and one whose path now holds a form's submitter is
prevented (a click the page dispatches from a handler does not hide the one around it), and a
tree a control was moved into - an open or a closed shadow root's form - is watched from then
on. Live: none of the seven pages submitted anything (the last two moved a checkbox into an
open and a closed root's form, then made it a submit input); without the watch, each did. One
full live run left the round-19 page's click `ok` with nothing submitted, as if its late
listener had not run; with page-side logging, its 18 later runs each showed the listener run
and the click stopped. That one run's cause is unknown.
(11) A frame that
navigated after the connection was held kept its first URL in the next read: a read now takes
each attached frame's URL from its own frame tree. Measured live while
fixing (3): Chromium's `DOM.focus` refuses a `delegatesFocus` host, `tabindex` or not, so a key
cannot be handed inward over this channel; the refusal was recorded `unknown` and blocked the
step's reruns, and is now `action_target_unsuitable` (nothing sent, receipt `failed`). Any other
focus failure stays in doubt.

Live on Chromium (Agent) 153 at 127.0.0.1:9222, window on the unseen workspace and unfocused,
page targets 1 → 1 (`$TMPDIR/cdp-6164-<session-id>/`): a 14-step journey across two pages (a
role-and-name fill, fill, select, check, Tab, a click outside any form, a wait for its effect,
field assertions, a link to the second page, a wait for a late element, a fill there, a URL
assertion) completed in 1412 ms wall; a 30-step flow in 1394 ms wall. A click on the form's
submit button, `Enter` in its card field and a click on its `type=button` "Save card" were each
`flow_submit_undeclared` before input; a fill after a link to `localhost` (not allowlisted) was
`mutation_origin_not_allowed` before input; a flow with a submit step stopped before it
(`stopped_at_submit_gate`); a fill and a read of a shadow field inside a `localhost` frame
completed; with no DevTools endpoint the flow refused before its first step. After the fixes,
a click on the shadow icon inside the submit button, on content slotted into a shadow form's
button, and on a wrapper covered by a submit button were each `flow_submit_undeclared`, with no
submit in the server log; a rerun of a step left `unknown` was `mutation_replay_refused`. So
were a click on a submit button inside a label for a checkbox, and `Enter` on a field whose focus
handler moves focus into a same-origin frame's submit button; a click on an iframe element never
reaches the check, since its hit test lands in the frame and the act is refused as obscured.
A click on a full-page `pointer-events: none` overlay was refused as obscured, and a fill and a
key press on a field whose focus handler moves focus into a `localhost` frame each sent nothing
(`action_focus_moved`, the value in no receipt); so did a fill in a frame whose focus handler
moves focus to a sibling frame, which received no input. apply's fills on the #6163 pages
(top document, shadow root, out-of-process frame) still pass. Content slotted into a closed
root's form button, and `Shift+a` on a field whose Shift handler moves focus into a `localhost`
frame, were each refused live with nothing submitted or typed; so were a submit button outside any
form whose mousedown sets `form=` (the release went outside the viewport; no submit reached the
server) and `Shift+Control+a` whose Shift handler moves focus.

Speed, measured honestly: reads take 0-2 ms. An act takes 45-65 ms, of which ~20 ms is the CDP act
(median of 7 without the ledger: fill 19.5, click 20.2, check 20.1, select 18.6 ms) and the rest is
the receipt the kernel writes durably before and after every act (44 ms from `started_at` to
`finished_at` on a fill). The gate's ~0.4 s for 30 steps assumed no receipts; the receipt is the
boundary, so it stays. The 30-step flow (17 acts, 13 reads) spent 0.9 s in its steps against
~2.3 s for the same verbs on surf by the gate table (type 69, select 72, click 190, a `js` read 54
ms), and the tab's open, gate and close are the same either way.
