---
summary: "Measured on 2026-09-26/27, one Chromium (Agent) Chrome/153 over CDP, same pages, medians of 5: surf + our CDP reader (status quo), agent-browser 0.38.1, playwright-cli 0.1.21, dev-browser 0.2.9, and playwright-core driven in-process. surf's default screenshot after each action costs 3-5.6 s per verb when the window is not on screen (form flow 12.1 s; 0.37 s with --no-screenshot). agent-browser is the fastest CLI but still leaks one about:blank per session (#1986). Playwright in-process is fastest overall (form flow 55 ms, cross-origin-iframe click 98 ms). Three proposals with numbers; the recommendation is to fix the surf path now and to measure Playwright as the action channel next."
read_when:
  - "You choose or change the browser tool that acts for test-capabilities, or wonder why runs are slow."
  - "Someone proposes agent-browser, dev-browser, playwright-cli or Playwright instead of surf."
type: "decision"
---

# Browser tooling, measured (2026-09-27)

The operator asked for the fastest way forward, with timing facts. The two "browser guys" on X:
Sawyer Hood's **dev-browser** ("the fastest way for an agent to use a browser is to let it write
code": Playwright scripts in a sandbox), and Vercel's **agent-browser** (native CLI + daemon, compact
refs). Their public numbers are their own; these are ours.

## Setup

- One browser for all: Chromium (Agent), Chrome/153.0.8010.47, `--remote-debugging-port=9222`,
  the operator away (no window focused, so Chromium does not paint it - the overnight case).
- Local pages on `127.0.0.1:18766`: a form (textbox, select, button, status) and a host page with
  two cross-origin frames (`localhost` vs `127.0.0.1` - out-of-process). Remote: GitHub releases,
  MDN `<iframe>` (964 shadow-DOM buttons).
- Each candidate starts from one blank tab; timings are wall clock per CLI call (medians of 5)
  unless marked in-process. Harness and raw JSON: `$TMPDIR/bench/` (scratch, not in git).
- Tools installed into scratch only (`npm i --prefix $TMPDIR/bench`, `HOME` redirected).

## Results

| use case | surf + our reader (today) | agent-browser 0.38.1 | playwright-cli 0.1.21 | dev-browser 0.2.9 | playwright-core in-process |
|---|---|---|---|---|---|
| U1 cold start to first snapshot | 419 ms | 219 ms | 1 064 ms | 556 ms | 45 ms connect |
| U2 snapshot, small page | 323 ms CLI / 255 ms in-process | **38 ms** | 229 ms | 119 ms | ~1 ms (aria snapshot) |
| U2 names the fields ("Name", "Size") | yes | yes | yes | yes | yes |
| U3 form: fill, select, click, read | **12 146 ms** (default screenshots, window unseen); ~2.4 s window visible; **~370 ms** with `--no-screenshot` | 224 ms (4 calls) | 1 959 ms | 170 ms (1 script) | **55 ms** |
| U4 GitHub releases: navigate + snapshot | 1 530 + 389 ms, 7.3 KB | 1 316 + 119 ms, 62 KB | 763 + 292 ms, 83 KB | 495 + 176 ms, 85 KB | not measured |
| U4 same snapshot twice | identical | identical | identical | identical | - |
| U5 cross-origin iframe: button in snapshot | yes | yes | yes | yes | - |
| U5 click it | **cannot** (surf acts in the top frame; nicobailon/surf-cli#319) | 91 ms | 1 001 ms | 163 ms | 98 ms |
| U6 MDN: snapshot time, size, buttons | 1 127 ms, 60 KB, 938 | 390 ms, 304 KB, 936 | 631 ms, 426 KB, 938 | 664 ms, 430 KB, 938 | not measured |
| U7 tabs left behind per session | 0 | **1 `about:blank`** (after `tab close` and `close`) | 0 | 0 | 0 |
| footprint | surf (installed) | 1 native binary | Node per call + daemon | daemon + QuickJS sandbox; `install` downloads 167 MiB Chromium even for `--connect` | 1 npm dep, no browser download |

What the numbers say:
1. **surf's cost is its screenshot, not surf.** Every value-setting verb and `js` captures a
   screenshot; with no window on screen the capture waits for its 5 s timeout
   (`SCREENSHOT_TIMEOUT_MS=5e3` in the extension). Measured per verb: `js` 5 626 ms ->
   **55 ms** with `--no-screenshot`, `click` 5 752 -> 180 ms, `type` 775 -> 70 ms. Our own
   `Session.evaluate` (`src/core/surf-session.ts`) sends `js` without the flag today, so every
   evaluate step of a run pays it.
2. **Our reader spends ~250 ms waiting for frames** (`FRAME_SETTLE_MS`) even on pages with none;
   255 ms in-process on a 7-node page.
3. **agent-browser is the fastest CLI** and reaches cross-origin frames, but **#1986 is not fixed**
   in 0.38.1: every session leaves one `about:blank`.
4. **playwright-cli is the slowest** (a Node start per call: ~230 ms floor, ~2 s for the form).
5. **Playwright in-process is the fastest at everything it was asked** (form 55 ms, frame click
   98 ms) - dev-browser's advantage (one script instead of N calls) without its daemon or download.
6. Shadow DOM and accessible names are fine in every candidate once the page has loaded. A
   first-visit snapshot taken right after navigation missed MDN's shadow content in one early run
   (11 vs 936 buttons): waiting for the page to settle is part of any snapshot contract.

## Proposals

**A. Fix the surf path (hours, no new dependency) - recommended now.**
- `--no-screenshot` on `Session.evaluate` and on every action verb test-capabilities issues.
  Measured: form flow 12.1 s -> ~0.37 s unattended; `js` 5.6 s -> 55 ms.
- Skip the frame settle when the page's tree has no iframe node (255 ms -> expected tens of ms;
  to be measured).
- Remains: no actions inside cross-origin frames (surf#319, open upstream).

**B. Playwright (playwright-core) in-process as the action channel, over the same CDP - measure next.**
- Fastest measured: connect 45 ms, form 55 ms, cross-origin-frame click 98 ms, no tab left.
- Agents already write Playwright (dev-browser's thesis); our a11y reader stays the evidence
  channel, surf stays for what only the extension does.
- Cost: one dependency, an action adapter beside surf's, and proof that the owned-tab and
  receipt rules hold (days, as its own measured slice).

**C. agent-browser back as the action CLI - not recommended.**
- Fastest CLI (38 ms snapshot, 224 ms form, 91 ms frame click), but one leaked tab per session on
  0.38.1 (we would close it ourselves), a second binary, and a reversal of AK #5915 three days on.

Not proposed: playwright-cli (slowest per call), dev-browser as a harness dependency (its speed
comes from one script per step, which B gives without a daemon and a 167 MiB download; it stays a
good interactive tool for an agent exploring a site).
