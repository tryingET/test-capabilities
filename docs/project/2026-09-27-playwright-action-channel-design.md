---
summary: "Design package for Proposal B (AK #6092): whether Playwright (playwright-core, connectOverCDP, in-process) should act for test-capabilities beside surf. The case after the corrected benchmark: speed per action and reads inside a selected frame (surf refuses js there since upstream #323/#324); not frames themselves (surf clicks in a cross-origin frame after frame.switch). A gate measurement on the owned tab decides before any adapter is built."
read_when:
  - "You consider adding Playwright, or any second action channel, to test-capabilities."
  - "A surf verb is too slow or cannot do something a test needs, inside a frame or otherwise."
type: "design"
status: "gate measured 2026-09-27 (section 5): not built; reopen triggers recorded"
---

# Playwright as an action channel beside surf (AK #6092)

## 1. Why ask

The browser-tooling bench (`2026-09-27-browser-tooling-bench.md`) measured Playwright in-process as
the fastest at every action it was given (form flow 55 ms, frame click 98 ms). Two of the reasons
given then no longer hold: surf clicks inside a cross-origin frame after `frame.switch` (69 ms,
verified by the frame's own `postMessage`), and sessions no longer pay surf's screenshot
(`--no-screenshot`, AK #6048). What remains:
- **speed**: surf spawns a CLI per verb (~50-190 ms each); Playwright holds one connection;
- **reads inside a frame**: `js` in a selected frame refuses (`UNSUPPORTED_FRAME_EXECUTION`) since
  upstream #323/#324; Playwright evaluates in any frame;
- **one browser connection**: the a11y channel already holds a CDP connection to the owned tab.

## 2. What must not change

The owned-tab rule (a run acts only in the tab it created), the effect declarations and the
ledger/receipts for every step, read-only probes staying read-only, and no stray targets. surf keeps
the tab's lifecycle (open, readiness gate, close) either way.

## 3. Shape if built

A second implementation behind the session's step interface, selected per run: the same
`BrowserStep` (command, args, declaration, read) mapped to Playwright calls on the page bound to the
owned tab (exactly one page at the gated URL, as the a11y channel binds). `connectOverCDP` on the
loopback endpoint; disconnect, never close, at the end. `playwright-core` only - no browser download.

## 4. Gate (before any adapter)

On the owned tab of a live run, per verb, median of 7, surf CLI as sessions call it
(`--tab-id`, `--no-screenshot`) against Playwright over one connection:
readiness wait, a `js` read, `type`, `select`, `click`, the frame probe (`wait --element` in a
frame), a click and a read inside a cross-origin frame; plus one whole `surf explore` run and how
much of it is surf verbs.

Build only if at least one holds:
- a whole explore/test run gets **2x faster or more** end to end;
- a consumer needs a capability surf lacks (today: reading inside a selected frame).
Otherwise record the numbers here and stop.

## 5. Gate result (2026-09-27): not built

Owned tab on Chromium (Agent) Chrome/153, surf upstream `70fd595`, playwright-core 1.60.0 over one
`connectOverCDP` (27 ms to connect), median of 7:

| verb | surf (CLI per step, `--no-screenshot`) | Playwright |
|---|---|---|
| readiness wait | 54 ms | 0 ms |
| `js` read | 54 ms | 1 ms |
| type | 69 ms | 5 ms |
| select | 72 ms | 3 ms |
| click | 190 ms | 24 ms |
| frame probe (`frame.switch`, `wait.element`, `frame.main`) | 225 ms | 5 ms |
| click in a cross-origin frame | 185 ms | 25 ms |
| read inside the frame | refuses (`UNSUPPORTED_FRAME_EXECUTION`) | 3 ms |

Page targets 1 -> 1. A whole `surf explore --a11y-snapshot=required` run takes ~590 ms, of which
surf calls are ~400 ms (67 %, 7 calls). Only 3 of them (`js` x2, `wait.ready`, ~155 ms) are actions
Playwright would take; `tab.new`, `tab.close`, `--version` and `--help-full` stay with surf, which
owns the tab. Best case ~1.35x end to end, under the 2x bar, and no consumer needs in-frame reads.

**Reopen when** a run becomes action-heavy (LLM-written tests with tens of steps: at ~55-190 ms per
surf step against ~1-25 ms, 30 steps are ~3-4 s against ~0.4 s), or a test must read inside a
selected frame.

Harness note: surf's `wait --element` (not `wait.element`) ignores the flag and sleeps ~1 s,
answering OK for a selector that does not exist; test-capabilities translates `wait --element`
to `wait.element`, so its frame probe is unaffected.

## 6. Variant chosen by the operator: actions on our own CDP client (AK #6099)

Playwright's speed came from one held CDP connection, not from Playwright; test-capabilities
already holds one for the a11y channel (`a11y-cdp.ts`, ~4 ms per read). So the actions are built
on it, with no dependency and no vendor:

- `src/core/cdp-actions.ts`: `click`, `fill`, `select`, `evaluate` on the owned tab, addressed
  by an a11y ref (its backend node) or by a CSS selector in a named frame.
- `click` is real input: scroll into view, the element's content quad, a hit test
  (`elementFromPoint` must be the element or inside it, else `action_target_obscured`), then
  `Input.dispatchMouseEvent`. As first built it summed the page coordinates of every enclosing
  out-of-process frame and sent the input on the page session. CDP program S3 found that
  misroutes 4 of 10 clicks into an OOPIF in a window that paints no frames, so the input now goes
  on the session that hosts the element, in its own coordinates
  (`2026-09-27-cdp-channel-program.md`, S3 result). `fill` focuses, selects and
  `Input.insertText`s (trusted input events). `select` sets the option and fires input/change.
  `evaluate` runs in the frame's own session - the read surf refuses in a selected frame.
- Its effect is **mutating**, so it is a separate entry point (`openCdpActions`), never part of
  the read-only a11y channel. The attach events record their parent session, so nested frames
  resolve.
- Phase 1 (this task): module, fake-endpoint tests, live proof, and the comparison below.
  Wiring it into sessions as an action channel stays behind the section 4 gate.

## 7. Comparing it with surf and Vibium

Same owned tab of Chromium (Agent), same pages, same verbs as section 4, median of 7, plus:
- attaches to the running browser and its owned tab (Vibium drives chromedriver/WebDriver BiDi and
  launches its own Chrome by default; attaching is chromedriver's `debuggerAddress`);
- page targets before and after (no stray tabs);
- clicks and reads inside a cross-origin frame; trusted input;
- footprint and governance (license, who controls it, protocol: CDP or W3C BiDi).

## 8. Comparison, measured 2026-09-27

Chromium (Agent) 153, median of 7 per verb. surf, our CDP actions and Playwright ran in one run
on the same owned tab; Vibium (26.8.21, Apache-2.0, WebDriver BiDi through chromedriver
153.0.8010.47 from the Arch chromium package) ran on a page of its own (see below):

| verb | surf CLI | own CDP (`openCdpActions`) | Playwright | Vibium |
|---|---|---|---|---|
| readiness / `js` read | 57-59 ms | 0-1 ms | 0-1 ms | 1 ms |
| type | 72 ms | 2 ms | 5 ms | 6 ms |
| select | 67 ms | 1 ms | 4 ms | 5 ms |
| click | 192 ms | 14 ms | 25 ms | 59 ms |
| click in a cross-origin frame | 191 ms | 10 ms | 26 ms | 60 ms |
| read inside that frame | refuses | 0 ms | 3 ms | 1 ms |
| attaches to the owned tab of the running browser | yes | yes | yes | **no** |
| stray targets | none | none | none | a hidden BiDi target while attached |
| dependency / control | installed / nicobailon | none / us | npm / Microsoft | npm + chromedriver / VibiumDev |

Vibium on the shared browser, measured: attaching goes through chromedriver's `debuggerAddress`;
the attach turned the existing `chrome://newtab/` page into `about:blank` and added a hidden
`other` target (the BiDi mapper); Vibium's `pages()` did not include the tab surf owns; and
**`DELETE /session` shut Chromium (Agent) down** - every surf session and agent on it with it.
Stopping chromedriver without ending the session leaves the browser up and removes the hidden
target. Vibium fits a browser it launches itself (and Firefox, through BiDi), not a shared,
logged-in agent browser.

Result: our own CDP client is the fastest option that also works on the shared browser, with no
dependency. It is a library entry point today; routing session steps through it stays behind the
section 4 gate (1.35x on a whole explore run today).
