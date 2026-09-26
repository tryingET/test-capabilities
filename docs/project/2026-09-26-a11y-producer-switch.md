---
summary: "AK #5915, 2026-09-26: the a11y channel's producer, decided by a measured series. agent-browser was retired first. surf `page.read --structure --full-page --nodes` briefly replaced it (the surf-cli fork's feat/page-read-nodes, still adopted and still worth upstreaming). A survey of current practice and two live measurements then showed that surf's content-script tree is not the accessibility truth: it misses shadow DOM (964 buttons on MDN), its names are not accessible names (86% agreement on GitHub), and it stops at out-of-process frames. The producer is now Chromium's own tree, `Accessibility.getFullAXTree` over the loopback CDP endpoint, attached to the tab surf owns, with recursive per-frame sessions and a read-only check reader. That reader finally gives the evaluator's visible/text/attr expectations something to read. Live: digest stable across tabs and hours, page count unchanged, in-frame checks pass."
read_when:
  - "You change the a11y channel, its producer, the CDP transport, or the rendering of the tree."
  - "An a11y run refuses with cdp_endpoint_unreachable, cdp_endpoint_refused or tab_bind_ambiguous, or doctor warns on external.a11y_channel."
  - "You wonder why the channel reads over CDP when surf owns the tab, or where agent-browser went."
type: "decision"
---

# The a11y producer, decided by measurement (AK #5915, #6032, 2026-09-26)

## Where this started

S9 made `a11y-snapshot.v1` the contract and agent-browser a replaceable producer. agent-browser's
cost was measured: a second binary, a version floor, a pinned session and its teardown, and a
stray tab on every pinned attach (vercel-labs/agent-browser#1986). The operator agreed to retire
it. The first replacement was surf's own `page.read`, extended on our fork (`feat/page-read-nodes`:
`--nodes`, `--full-page`, `--structure`, `--all` mapped to its filter, and the path-rewrite walk
skipped when there is nothing to rewrite). That build is adopted in the workstation runtime, and its
fixes are real upstream bugs.

The operator then asked whether surf was the right tool for accessibility truth at all. This
document records how that was settled.

## Survey (2026-09-26)

The consensus shows up in GitHub issues and PRs rather than on X, which the web index barely
covers:
- **The ground truth is Chromium's tree over CDP.** `Accessibility.getFullAXTree` gives the
  computed role, the accessible name and the ignored reasons. OpenClaw, VibeBrowser / Agent Labs
  ("How browser agents should serialize accessibility trees") and the Agent Accessibility Scorer
  build on it. The Scorer joins it to a DOM inventory on `backendNodeId` to find clickable elements
  an agent cannot see.
- **Out-of-process iframes need one session per frame.** Stagehand ships `Target.setAutoAttach`
  with `flatten: true` and stitches the trees together, and agent-browser #925, axscope #8,
  browser-tools #143 and Zenium #157 converged on the same fix. chrome-devtools-mcp's snapshot did
  not see into iframes as of its #186.
- **Serialization:** collapse wrapper roles (`generic`, `group`, `none`, `presentation`). There is
  no formal standard.
- **Performance:** `getPartialAXTree` for a subtree, not a full tree pruned afterwards (wmux #1371,
  hermes-agent #115056). This is not needed at our page sizes yet.

## Measurement 1: surf's tree against Chromium's tree, same owned tab

`{role, name}` multisets over controls, headings and landmarks. Chromium's tree is read
read-only from the existing page target's socket.

| page | surf | Chromium | agree | surf-only | Chromium-only |
|---|---|---|---|---|---|
| example.com | 2 | 2 | 2 | 0 | 0 |
| GitHub releases | 226 | 237 | 204 (86%) | 22 (names) | 33 |
| MDN `<iframe>` | 267 | 1222 | 239 | 28 | 983 |

- **Shadow DOM.** MDN has 9 buttons in the light DOM and **964 inside shadow roots**
  (`mdn-dropdown`, `mdn-copy-button`, …). surf's walk follows `element.children` and never enters a
  shadow root.
- **Names.** Every GitHub disagreement is a name. Chromium says "Pull requests" and "Tag v2.20.0"
  where surf says "Pull requests 0" and "v2.20.0". Chromium's name is what a screen reader
  announces.
- **Frames.** CDP attached all three out-of-process frames through their own sessions, while
  surf's read stops at the frame boundary.
- **No side effects:** the page count was 1 before and 1 after on every page.

## Measurement 2: a prototype CDP producer

A canonical rendering with wrappers collapsed, recursive frame sessions, and a read-only check
resolved from a node's backend id.

| page | lines | bytes | twice identical | frames | stray tabs |
|---|---|---|---|---|---|
| example.com | 2 | 54 | yes | 0 | none |
| GitHub releases | 408 | 12 378 | yes | 0 | none |
| MDN `<iframe>` | 3 448 | 184 501 | yes | 6 (nested included) | none |

The check read `visible`, `text` and `href` on all three. MDN showed the rendering needed a
structure filter (1 033 `Abbr` and 934 table cells), which the implementation added.

## Decision

**Chromium's accessibility tree over CDP is the a11y channel's producer, and surf keeps the tab
and every action.** The `a11y-snapshot.v1` contract did not change; only the producer changed, as
S9 designed for.

## What was built (test-capabilities)

- `src/core/a11y-ax-tree.ts` (pure) renders the forest.
  - It keeps controls, headings and landmarks. `form` and `region` count only with a name; named
    images are kept.
  - Wrappers and text are collapsed, and ignored nodes are dropped.
  - Refs are **document order (`eN`), not backend ids**, so an unchanged reload leaves the text
    byte-identical. The backend ids stay in a private handle map.
- `src/core/a11y-cdp.ts` is the transport.
  - The endpoint must be loopback (`TEST_CAPABILITIES_CDP_ENDPOINT`, default
    `http://127.0.0.1:9222`) and is refused before any request otherwise.
  - The page target must be exactly one at the gated href (`tab_bind_ambiguous` otherwise).
  - It uses a promise CDP connection over Node's WebSocket.
  - The forest read uses event-driven recursive auto-attach.
  - `releaseForest` detaches the frame sessions and only then turns auto-attach off.
  - The check reader uses `DOM.resolveNode` and a fixed read-only function, and releases every
    object.
- **Observer:** one ledgered read-only step. `openA11yLiveView(href)` returns a fresh view plus
  the reader for `evaluateA11yAssertion`, which is the first production reader the evaluator has
  ever had.
- **Error codes:** the CDP gate codes are back (`cdp_endpoint_refused`,
  `cdp_endpoint_unreachable`, `cdp_endpoint_not_chromium`, `tab_bind_ambiguous`), and
  `surf_page_read_unsupported` is gone. **`doctor`:** `external.a11y_channel` is the Browser string
  at the endpoint.
- **Tests** run against a fake DevTools endpoint (HTTP plus a minimal RFC 6455 socket) that replays
  two recorded Chromium trees (`tests/fixtures/captures/cdp-ax/`). Its method log proves no writing
  command is ever sent.

The first live run found one bug the fake had hidden: turning auto-attach off on the page
detaches every child session in Chromium, so the reader's in-frame read failed with "Session with
given id not found". The fake now behaves the same way, and the test was red before the fix.

## Live proof (Chromium (Agent) Chrome/153, owned tabs)

| run | result |
|---|---|
| `surf explore --a11y-snapshot=required`, GitHub releases, twice | 256 refs, 7 308 bytes, the **same digest both times and equal to the fixture recorded hours earlier** |
| same, MDN `<iframe>` | 1 260 refs, 938 buttons, 6 frames |
| same, local page with an out-of-process frame | the frame's `button "Play"` is in the tree |
| page targets before / after | 1 / 1 |
| evaluator: `button "Play"` in the out-of-process frame, visible/text/attr | **passed**; with `text: "Pause"` **failed** and quoted the real reading |
| evaluator: GitHub `link "Tags"` href, `searchbox` visible | passed |
| evaluator: `link "Pull requests 0"` (surf's name) | unverified: Chromium's accessible name is "Pull requests" |
| `test` with the agent's a11y channel | verified; the report carries the capture |
| `doctor` | `external.a11y_channel` pass: Chrome/153.0.8010.47 at the endpoint |

## What stays open

- `within` landmark scoping for `a11y-role` assertions. The rendering now carries the landmark
  nesting it needs.
- Per-element coverage by joining the tree to the DOM inventory on backend ids (the Agent
  Accessibility Scorer's idea), instead of the current counts.
- Upstream: surf-cli issues for `--all`, the path-rewrite limit and the structured read are
  drafted in issue-tracker, awaiting review and the operator's authority for each preview.
