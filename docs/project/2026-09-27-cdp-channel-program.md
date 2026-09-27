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

### S2 - the frame probe over CDP

`frame-diagnosis.ts` probes each top-level candidate with `frame.switch`, `wait.element`,
`frame.main` (225 ms per candidate); nested candidates are `unprobed`, and a failed restore closes
the tab (`frame_context_unrestored`). Over CDP the probe is a read in the candidate's own frame
(`cdpFrameIds`), switches nothing, and reaches nested and same-process candidates.
- **Gate:** the same determinations as today on the recorded fixtures; nested candidates probed;
  no `frame.switch` in the ledger; a live page with a nested target confirmed where today it is
  `unprobed`.

### S3 - forms inside frames

Plan and apply read fields back with `js`, which surf refuses in a selected frame, so a form in
an iframe (payment fields, embedded login) cannot be planned or applied. Over CDP: field
discovery, read-back and trusted input in the frame, with the submit gate unchanged.
- **Gate:** plan and apply a form in a cross-origin frame live, receipts and read-backs as for a
  main-page form; nothing submitted without the gate.

### S4 - a CDP step backend for the session

`SurfSession.step` routes `js`, `type`, `select` and `click` to the CDP channel when it is bound,
with the same declaration, ledger step and receipt; surf keeps the tab lifecycle and the readiness
gate. The action-channel gate decides whether it is on by default.

## 4. Done when

Each slice: design section updated with what was learned, red-first tests with mutation checks
on the properties that matter, `npm run check` green, a live proof on Chromium (Agent), pushed
through the hook, AK completed with the evidence.
