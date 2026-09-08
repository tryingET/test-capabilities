---
summary: "Live run of the frame root cause (slice S8) on 2026-09-08 against Chromium (Agent): example.com excludes, the MDN <iframe> reference suspects and is confirmed only with --frame-hint, the public claude.ai login page reads excluded when it has just opened and suspected once its invisible hCaptcha frames render, and a w3schools embed page produces the 933x949 blank frame that qualified the packet's hidden rule. Owned tabs, no logins, tab.list identical before and after."
read_when:
  - "You need evidence that the frame diagnosis works against a real browser, not only against the fake fed by captures."
  - "You want the exact commands, the determinations they produced, and the pages that produced them."
  - "You wonder why the packet's claude.ai/login expectation reads differently today, or where the hidden-rule deviation's evidence comes from."
type: "reference"
---

# Frame root cause live run (2026-09-08)

Slice S8 of `docs/project/2026-09-07-surf-learnings-implementation-plan.md`, packet
`docs/project/2026-09-07-frame-root-cause-design.md` (its `## Refinement (many-of-the-greats)`
is what this implements). Everything here is read-only: `tab.new`, `wait.ready`,
`frame.diagnose`, `tab.close`. Nothing was typed, nothing was clicked and nothing was logged
into.

Environment: `surf` 2.18.0 (`~/.local/bin/surf`), Chromium (Agent) started as
`systemd-run --user --unit chromium-agent --collect ~/.local/bin/chromium-agent.sh` and stopped
afterwards. `surf doctor --browser chromium --json`: `ok: true`, 10 pass / 0 warn / 0 fail.
`surf tab.list` showed the same single `New Tab` (id 1075142613) before and after every case:
every owned tab was closed.

## The captures the fixtures are built from

Taken first, as `tab.new` → `wait.ready --tab-id` → `frame.diagnose --tab-id --json` →
`tab.close`, and committed under `tests/fixtures/captures/frame-diagnose/`:

| capture | counts (dom / extension / cdp) | what it pins |
|---|---|---|
| `example-com` | 0 / 1 / 1 | the exclusion case: a page with no iframe at all |
| `mdn-iframe` | 3 / 6 / 1 | three cross-origin, shadow-hosted iframes absent from the CDP tree (`out_of_process_frame` + `shadow_hosted_frame`), one nested OpenStreetMap embed, one nested `about:srcdoc` frame whose content script does not answer, and six warnings |
| `claude-login` | 5 / 6 / 2 | two 0x0 hCaptcha frames, the 1x1 blank pixel whose `zeroSize` surf reports as **false**, two off-screen 300x150 challenge frames, and one CDP child frame with `url: ""` that surf does not explain |

The five synthetic captures beside them (`in-process-cross-origin`, `nested-srcdoc`,
`hidden-0x0`, `closed-shadow-mismatch`, `unreachable-content-script`) each name the live shape
they were derived from; Chrome's site isolation makes an in-process cross-origin frame rare
enough that it was not observable on any page tried.

## The framework, end to end

`node bin/test-capabilities surf explore --url <url> --ready-selector '#does-not-exist' --json`,
with `TEST_CAPABILITIES_RECEIPTS_DIR` pointed at a scratch directory.

| page | hint | determination | evidence |
|---|---|---|---|
| `https://example.com/` | none | **excluded** | 0 candidates; `error.code: element_unreachable`, `details.surf_code: page_timeout` |
| MDN `<iframe>` reference | none | **suspected** | 6 candidates (3 out-of-process DOM iframes + 3 nested frames); the packet's own incidentaloma case |
| MDN `<iframe>` reference | `urlPrefix=https://29c6a7b0…mdnplay.dev` | **confirmed** | `tag: out_of_process_frame`, DOM index 1; "a main-page selector does not reach into a frame" |
| `https://www.w3schools.com/html/html_youtube.asp` | none | **suspected** | 2 candidates, both blank frames the page fills itself |
| the same page | `urlPrefix=about:blank` | **undetermined** | the hint matched none of the candidates on that load |
| the same page | `urlPrefix=https://nowhere.example/` | **undetermined** | "a hint that resolves to nothing is a test defect, not a weaker suspicion" |
| the same page | `selector=iframe#no-such-id` | **undetermined** | the same rule through the selector form of the hint |

Every one of these exits 1 with the JSON error envelope on stdout, carrying
`code: element_unreachable` and `details { selector, determination, candidates, tag?, hint?,
surf_code }`. The surf code that produced the failure (`page_timeout`) is never renamed.

`surf explore --url https://example.com/ --json` without a ready selector is unchanged:
`coverage.userFlows 100`, `status verified`, `probesVerified 2/2`, `effect {read_only,
browser_session}`, `mutations: []`, and no `frame.diagnose` call at all - the diagnosis costs a
run that does not fail nothing.

## claude.ai/login: the same page, two determinations

The public login page (no login performed) is the one case that reads differently depending on
when the inventory is taken, and both readings are recorded here because the difference is the
point.

- **Read immediately after `tab.new`**: `counts {domIframes: 0, extensionFrames: 1, cdpFrames: 1}`
  → `excluded`, 0 candidates, 0 hidden. This is the packet's original expectation.
- **Read 8 s later, once the page has settled**: `counts {domIframes: 4, extensionFrames: 5,
  cdpFrames: 1}` → **suspected**, 2 candidates and 2 hidden. The two candidates are the
  invisible hCaptcha challenge frames (`https://newassets.hcaptcha.com`, 300x150, positioned at
  `y: -9999`, content script reachable); the two hidden ones are 0x0.

The packet's open question 4 decided against "not in the viewport" as a hidden criterion -
visibility is not a frame property - so a 300x150 frame parked off-screen is a candidate and the
determination is `suspected`. That is the specified rule producing the honest answer on a page
that changed since the packet was written, not a defect.

`surf explore --ready-selector` cannot reach this page at all: `wait.ready` classifies it
`login`, and the packet's trigger list deliberately excludes `page_login` from the diagnosis
("those are not element problems"). The two readings above came through the library seam -
`new SurfSession(...)`, `open()`, `explainUnreachable('#does-not-exist')`, `close()` - which is
exactly the third producer the packet's trigger list names.

## What the live run changed, and what it proves

**The hidden rule is qualified by the rect.** The packet's third hidden clause is `blank && src
=== ""`. On `https://www.w3schools.com/html/html_youtube.asp` the page renders a **933x949**
iframe that surf reports as `blank: true, src: ""` (its content is written by the parent, so it
carries no `src` attribute), and a second at 310x198. Under the literal clause both are hidden,
the page becomes `excluded` - the strongest claim this module makes, the one that licenses an
automatic selector rewrite - and a target inside that frame would be healed into a lookalike in
the main document. The implemented rule applies the blank clause only to a degenerate box
(width or height at most 1), so a rendered blank frame stays a candidate and the page is
`suspected`. `zeroSize` and the 1x1 clause are unchanged, so the claude.ai pixel the packet's
decision log is about is still hidden.

Note that the two geometry boundaries deliberately differ: the packet's own clause is a *pixel*
(`width <= 1 && height <= 1`), the qualification is a *degenerate box* (`width <= 1 ||
height <= 1`) and applies only to a blank, src-less frame. This is an amendment to P3, not
compliance with it - the packet's clause and this rule are not both satisfied - and reconciling
the packet's text is a follow-up for whoever owns it.

**Nothing writes a screenshot any more.** `surf js` without `--no-screenshot` saves a picture of
the page to `/tmp` (measured: one file per call); the explore probes now pass the flag and add
none. `wait.ready --selector` and `frame.diagnose` were measured and write none, so they need no
flag. `/tmp` held the same five operator-owned images before and after the run.

**The raw inventory is on disk, the capped evidence is in the envelope.** Each diagnosis wrote
`<receipts.dir>/<runId>/frame-diagnosis-<tabId>-<ms>.json` at mode 0600 carrying the whole
`frame.diagnose` payload (600-character `src` URLs included); the envelope carries at most ten
candidates with `src` abbreviated to 160 characters. The diagnosis wrote no mutation receipt: it
reads the page and changes nothing.

## What this run could not prove

- **The `test` orchestrator path.** The surf agent calls `executeSurfExploreOperation({ url })`
  and has no way to pass a ready selector, so a live `test` run cannot produce a
  `frame_boundary` finding today. The agent's copy of the determination onto the finding, the
  `frame_boundary` class and the healer's three-way rule are proved by the contract suite and
  the root-cause corpus instead. Wiring `agents.<name>.readySelector` is a follow-up.
- **An in-process cross-origin frame** (`cross_origin_frame` with a CDP match). Site isolation
  put every cross-origin frame on the pages tried out of process; the tag is covered by the
  synthetic capture only.
- **A `confirmed` determination on an embed page.** The YouTube embed on the w3schools page had
  not loaded its cross-origin document on either visit, so the only live `confirmed` is MDN's.
