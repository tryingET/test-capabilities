---
summary: "AK #5915, operator-approved 2026-09-23: the a11y channel's producer moved from agent-browser over CDP to surf's own `page.read --structure --full-page --no-text --nodes`, which meets the S9 sunset condition (roles, names, landmarks and headings, deterministically, no stateful footer). The surf side is branch feat/page-read-nodes of contrib/surf-cli. It adds --nodes, --full-page and --structure, maps --all to its filter, and skips the host's path-rewrite walk when there is nothing to rewrite. The workstation runs it as the `adopted` build. The test-capabilities side deletes the agent-browser runtime and rewrites the observer as one read through the run's own session. Live: the S9 reference page reads 236 nodes / 15154 bytes with the same digest across tabs, and the page count is unchanged."
read_when:
  - "You change the a11y channel, its producer, or the surf page.read flags it depends on."
  - "An a11y run refuses with surf_page_read_unsupported, or doctor warns on external.a11y_channel."
  - "You wonder where agent-browser, tabLeak or the CDP endpoint settings went."
type: "decision"
---

# The a11y producer switch: agent-browser → surf page.read (AK #5915, 2026-09-26)

## Why

S9 made `a11y-snapshot.v1` the contract and named a sunset condition for agent-browser: *the day
`surf page.read --json` emits roles, names, landmarks and headings deterministically at the same
schema, the observer switches producer and no consumer changes*
(`2026-09-07-a11y-snapshot-channel-design.md`). The cost of the second tool was already
measured:
- a second binary with its own version floor;
- a CDP endpoint and its loopback rule;
- binding the tab by target id;
- a pinned session with a teardown order;
- a stray `about:blank` on every pinned attach, which forced the tab-leak attribution of AK #5567
  and was filed upstream as vercel-labs/agent-browser#1986.

The operator agreed to retire agent-browser on 2026-09-23.

## What surf lacked, and what was added (contrib/surf-cli `feat/page-read-nodes`)

Measured on upstream v2.20.0 (`f779289`, then latest main) before any change:

- The default `page.read` is the **interactive filter clipped to the viewport**. On the GitHub
  releases page it returns 38 nodes, because it only sees what is scrolled into view. That is not
  deterministic across window sizes.
- `page.read --all` was documented as "Include all elements", but **nothing mapped it to the all
  filter**, so it silently returned the viewport-clipped interactive tree.
- The text carries a **stateful "Diff from previous snapshot" footer** when two reads fall within
  5 s.
- Structured output existed only as the internal `semanticObservation`, which has no headings or
  landmarks.
- Any response larger than 1000 values failed with "response exceeds path rewrite limits": the
  host walked every response to rewrite transferred file paths, even when there were none.

Two commits on `feat/page-read-nodes`, cut from `main`:

1. `fix(host): skip the path-rewrite walk when a response has nothing to rewrite` (`413eb50`).
2. `feat(page.read): --structure, --full-page and --nodes; --all selects its filter` (`cfc78e4`):
   - `--nodes` returns `{pageContent, nodes: [{ref, role, name, depth}], viewport, url, title}`
     and always takes a full snapshot, so there is no footer;
   - `--full-page` drops the viewport clip and keeps the visibility checks;
   - `--structure` means controls plus headings and landmarks, without the named prose `--all`
     adds.

   The CLI rewrites `--full-page` to `fullpage` (the screenshot alias), and the host reads that
   key. The live run found this; the unit test had passed with the pre-rewrite key.

The fork suite was 1177 tests on pristine main and is 1185 after the change, all passing, with
every new case red first.

| page (live, Chrome 153) | `--full-page` | `--structure --full-page` |
|---|---|---|
| example.com | 1 node | 2 nodes (heading, link) |
| github.com/nicobailon/surf-cli/releases | 154 nodes, 11461 B | **236 nodes, 15154 B**: 119 links, 63 headings, 24 buttons, 10 regions, 6 navigation, 1 banner |
| MDN `<iframe>` reference | 221 nodes | 288 nodes |

Every read was byte-identical on repeat. On the releases page, S9 had measured agent-browser at
204 refs.

## What changed in test-capabilities

- **Deleted:** `src/core/a11y-snapshot-runtime.ts` (673 lines: the agent-browser adapter,
  resolution, version floor, CDP endpoint, argv allowlist), its test suite, both fakes and the
  agent-browser capture. The spawn-boundary guard lists three process-starting modules instead
  of four.
- **Observer:** 544 lines became about 290. It is one
  `page.read --structure --full-page --no-text --nodes` in the owned tab via `session.step`:
  tab-scoped, ledgered and `read_only` like every surf read. There is no binding, no teardown and
  no tab leak.
- **Contract:** unchanged in substance (`a11y-snapshot.v1`, digest identity, `{role, name}`
  identity, the evaluator). Channel `surf-page-read`; the tab is surf's own tab id. The viewport
  line is not digested, because the window size is not the page.
- **Error codes:** the agent-browser and CDP codes and `tab_lost`/`tab_leak` are gone.
  `surf_page_read_unsupported` covers a surf without `--nodes`.
- **`doctor`:** `external.agent_browser` became `external.a11y_channel`, which asks whether the
  resolved surf's `page.read --help` lists `--nodes` and `--structure`.
- **Fixture:** `tests/fixtures/captures/surf-page-read/releases.json`, the live capture of the
  releases page (236 nodes, digest `sha256:f4076105…`, with the DOM's counts), with a fidelity
  test.

## Live proof (Chromium (Agent), surf `adopted` = `cfc78e4`)

| run | result |
|---|---|
| `doctor` | `external.surf`, `external.bombadil` and `external.a11y_channel` all `pass` |
| `surf explore --url …/releases --a11y-snapshot=required`, twice | `captured`, channel `surf-page-read`, 236 refs, 15154 bytes, digest `sha256:f40761058539…` both times, **equal to the committed fixture** captured earlier in another tab; `semanticCoverage.anchors` dom 233 / tree 119 |
| same on example.com | `captured`, 2 refs |
| page targets before / after | 1 / 1: no stray tab |
| `test` with `observation.a11ySnapshot: required` | `verified`; the report carries `a11y-snapshot: captured sha256:89738bce…` |

## Runtime and upstream

- The workstation runs contrib/surf-cli branch `adopted` (upstream `main` plus
  `feat/page-read-nodes`). The name `local` is taken by `local/parked-edits-20260906`.
- Rollback: `ln -sfn f779289 ~/.local/opt/surf-cli/current` (pure v2.20.0), then restart.
  test-capabilities then reports `surf_page_read_unsupported` for the a11y channel and nothing
  else changes.
- Upstream: the two commits are ready as PRs to nicobailon/surf-cli (the path-rewrite fix and
  the `page.read` flags). They go out through issue-tracker `bin/it` with the operator's authority
  for each preview.
