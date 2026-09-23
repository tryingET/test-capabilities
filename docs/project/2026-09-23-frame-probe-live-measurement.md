---
summary: "Live measurement on 2026-09-23, run with the operator present, against Chromium (Agent) Chrome/153, surf 2.18.0 and agent-browser 0.35.1 / 0.38.0. It answers the four questions the AK #5569 adjudication deferred to a live run. frame.js takes CDP frame ids only and cannot reach out-of-process frames. After frame.switch, js/page.text/page.state still read the main document, while page.read and wait.element read the switched frame. The frame context is per tab, a navigation resets it, and frame.main restores it. frame.switch --index numbers the top-level iframes in DOM order and then the nested ones. It also live-verifies the AK #5567 tabLeak attribution and re-measures the per-session about:blank stray on both agent-browser versions."
read_when:
  - "You build the in-frame positive probe (AK #5569) and need to know which surf verb reads inside which frame."
  - "You change the a11y channel's known-stray version list, or file or follow up the agent-browser stray-tab issue."
  - "A step after frame.switch reads something unexpected."
type: "diary"
---

# In-frame probe and stray-tab live measurement (2026-09-23)

## Environment

The operator was present and authorized the run. Chromium (Agent) was started with
`systemd-run --user --unit chromium-agent --collect ~/.local/bin/chromium-agent.sh` and reported
`Chrome/153.0.8010.47`. `surf doctor --browser chromium` reported OK with surf 2.18.0. The
agent-browser versions were 0.35.1 (the global install) and 0.38.0, installed with
`npm install --no-save --prefix $TMPDIR/...`. The npm `min-release-age=7` policy refuses 0.38.1,
which was published 2026-09-16; its release notes list only a recording-cursor fix.

Only owned tabs were used. The browser was stopped afterwards and ended as it started: one
`chrome://newtab/` page, and `agent-browser session list` reporting "No active sessions". Stray
`about:blank` pages created by the measurements were closed between steps through the DevTools
endpoint of this agent browser.

## 1. The per-session stray (AK #5567, upstream report)

In each case a clean browser held one page (`chrome://newtab/`), plus one `https://example.com/`
tab for the pinned case.

| agent-browser | session | first command | page count after | after the 2nd command | after `close` |
|---|---|---|---|---|---|
| 0.35.1 | unpinned | `tab list` | +1 `about:blank` | +0 | stray still there |
| 0.35.1 | `--pin-tab` | `tab <https target>` | +1 `about:blank` | +0 (`snapshot -i --json`) | stray still there |
| 0.38.0 | unpinned | `tab list` | +1 `about:blank` | +0 | stray still there |
| 0.38.0 | `--pin-tab` | `tab <https target>` | +1 `about:blank` | +0 (`snapshot -i --json`) | stray still there |

A repro artifact is recorded here so it is not mistaken for behaviour: binding a pinned session
to the `chrome://newtab/` target adds **two** pages on both versions. The channel never binds a
`chrome://` page, and the end-to-end check below shows one stray per run.

**#5567 live-verified.** Three consecutive
`surf explore --url https://example.com/ --a11y-snapshot=required --json` runs each exited 0 with
`status: captured` and
`tabLeak: {before: n, after: n+1, urls: ["about:blank"], attribution: "known_producer_stray"}`,
for n = 2, 3, 4. The accumulation is visible directly: three runs left three `about:blank` pages.

## 2. The in-frame probe questions (AK #5569)

The page was the MDN `<iframe>` reference, as in the S8 capture. It has three shadow-hosted,
cross-origin, out-of-process DOM iframes, with extension frame ids 30, 31 and 32 and no CDP ids,
plus three nested frames: OpenStreetMap, example.org, and an `about:srcdoc` frame whose content
script is unreachable. `frame.list` returned only the main frame, whose id is the CDP id
`CDEA6C62...`.

**Q1: what `frame.js --id` takes, and what it reaches.** It takes CDP frame ids only.
- `--id CDEA6C62665F2DCD01EA2754845F8ADB` (the main frame) ran the script.
- `--id 30` (an extension frame id) failed with `Invalid parameters [browser_error]`.
- `--id 999` failed with `frame_context_reset` (`reason: missing-frame`).

The out-of-process frames carry no CDP id, so `frame.js` cannot address them. This confirms the
refutation in the adjudication.

**Q2: what reads inside the frame after `frame.switch --index N`.** It depends on the verb:

| verb | reads | evidence |
|---|---|---|
| `js "return location.href"` | **the main document** | the MDN URL after switching to index 0 and index 2 |
| `page.text`, `page.state` | **the main document** | MDN title and URL |
| `page.read` | the switched frame | the playground runner's script text, then OpenStreetMap's "Zoom In", then example.org |
| `wait.element --selector` | the switched frame | inside index 1, `h1` (present in the main document) timed out while `body` and `iframe` succeeded |

A probe built on switching and then running `js` would read the main document and report it as
the frame's contents. That is a false reading, not a missing one. `wait.element --selector
<sel> --timeout <ms>` is the verb that answers "is this selector visible inside this frame". It
is already in the adapter's read-only set, and its visibility semantics match the readiness
gate's `--selector`.

**Q3: does `frame.main` restore the context.** It answered `OK` after every switch, and the next
`wait.element --selector h1` found MDN's `h1`. A navigation of the tab while it was switched
reset the context to the main document by itself: `h1` was found after the reload, before any
`frame.main`. `frame.switch --index 7` on a page with six frames refuses with
`Frame index 7 out of range. Found 6 frame(s).` rather than switching somewhere else.

**Q4: is the context per tab.** Yes. With tab A switched into a frame, tab B's
`wait.element --selector h1` found example.com's `h1` while tab A's timed out. After
`frame.main`, tab A found MDN's.

**Index space.** `frame.switch --index` numbers the top-level iframes in DOM order first:
indexes 0 to 2 are the three DOM iframes, and index 0's viewport is 627x248, the size of DOM
index 0. It then numbers the nested frames: 3 is OpenStreetMap under frame 0, 4 is example.org
under frame 1, and 5 is the unreachable `srcdoc`. The healer's `frame.switch` suggestion, which
carries the DOM index for a top-level frame, is therefore correct as shipped.

## What this changes

- The #5569 probe is buildable. The design is: `frame.switch --index <domIndex>`, then
  `wait.element --selector <failing selector> --timeout <short>`, then `frame.main`, once per
  top-level candidate. `js`, `page.text` and `page.state` must never be used after a switch. The
  switch and the restore are `browser_session` mutations, which `SurfSession.step` refuses today.
  So the probe still needs the scoped switch-with-restore step class from the adjudication's
  refutation. The measurement shows that class is sound: the context is per tab, `frame.main`
  restores it, and a navigation resets it on its own.
- `AGENT_BROWSER_NEW_SESSION_STRAY_VERSIONS` can add 0.38.0, which was measured with the same
  signature. 0.35.2 to 0.37.1 were not measured.
