---
summary: "Live dogfood of the a11y snapshot observation channel (slice S9) against Chromium (Agent) on 2026-09-08: two `surf explore --a11y-snapshot=required` runs with an identical digest, the measured role mix and semantic-coverage gap, the ref round trip (same digest passes, a reload that renumbers refs drifts, a reload that leaves the tree byte-identical passes, a navigation drifts, the {role, name} form survives both), the coexistence proof with surf on one tab, the doctor readings, the recorded sizes, and the three places the packet's 2026-09-07 measurements no longer reproduce."
read_when:
  - "You need the measured evidence behind the a11y snapshot channel: digests, ref counts, byte sizes, role mix, semanticCoverage gap."
  - "You wonder whether a ref survives a reload, and why the answer is 'it depends on the tree, which is the whole point of the digest'."
  - "You are about to use agent-browser 0.35.1 attached over CDP and need to know what `close` does, and what a new session costs in stray tabs."
type: "live-run"
---

# A11y snapshot channel: live run (2026-09-08)

Packet: `docs/project/2026-09-07-a11y-snapshot-channel-design.md` (verification and dogfood plan,
step 4). Slice: `docs/project/2026-09-07-surf-learnings-implementation-plan.md` §3 S9.

Environment. Chromium (Agent) started for this run with
`systemd-run --user --unit chromium-agent --collect ~/.local/bin/chromium-agent.sh`;
`/json/version` reports `Chrome/152.0.7977.64`, DevTools on `127.0.0.1:9222`.
`surf doctor --browser chromium --json`: `ok: true`, 10 pass / 0 warn / 0 fail.
`~/.local/bin/surf` 2.18.0 (branch build), `~/.npm-global/bin/agent-browser` 0.35.1.
Owned tabs only, no logins, the operator's other browsers untouched. `receipts.dir` pointed at
`~/.cache/tc-s9-dogfood` so nothing landed in the checkout.

## 1. Two runs, one digest

```
node ./bin/test-capabilities surf explore \
  --url https://github.com/nicobailon/surf-cli/releases --a11y-snapshot=required --json
```

| | run 1 | run 2 |
|---|---|---|
| exit | 0 | 0 |
| wall | 2.03 s | ~2 s |
| `coverage.userFlows` | 100 | 100 |
| `evidence.verified` | true | true |
| `digest` | `sha256:82b7fb5ed1704dcf2367f2223ef9fa5957e6219b29838ce3511739013667decd` | identical |
| `refCount` | 205 | 205 |
| `bytes` (tree text) | 8 232 | 8 232 |
| artifact | `~/.cache/tc-s9-dogfood/db40936d…/a11y-snapshot-1-1788843775016.json` | `…/148da55c…/a11y-snapshot-1-1788843792117.json` |
| `agent-browser session list` after | `default` only | `default` only |

`runtime.a11yChannel`:

```json
{"mode":"required","channel":"agent-browser-cdp","tool":"/home/tryinget/.npm-global/bin/agent-browser",
 "version":"0.35.1","endpoint":"http://127.0.0.1:9222","status":"captured"}
```

Role mix, straight from the refs map:

```
link 95, heading 58, button 24, region 10, cell 8, navigation 6, columnheader 2, listitem 1, searchbox 1
```

which is the packet's measured mix plus one transient `listitem` (see §5).

`semanticCoverage` — the DOM's counts from the `dom` probe of the same page visit against what
the tree could name:

| family | DOM | tree | gap |
|---|---|---|---|
| anchors | 209 | 95 | 114 |
| buttons | 46 | 24 | 22 |
| inputs | 42 | 1 | 41 |

That gap is the point of the field: on this page more than half the anchors and almost every
input are controls the accessibility tree cannot name, and a tester reading the snapshot alone
would not know they exist. The tester prompt says so in one line and routes them to surf
selectors.

## 2. Sizes

| thing | bytes |
|---|---|
| artifact, `status: "captured"` (0600) | 25 324 |
| ├─ tree text (`snapshot`) | 8 232 |
| └─ refs map | 10 453 |
| artifact, `status: "unavailable"` (0600) | 593 |
| `surf explore --json` envelope, channel on | 31 834 |
| `surf explore --json` envelope, channel off | 6 165 |
| one `observations[]` entry | 11 497 |
| the same entry without `refs` | 1 034 |
| tester prompt input (`renderTesterPromptInput`) | 8 797 (~2.2 k tokens) |

The envelope grows by 25.7 KB with the channel on, and 10.5 KB of that is the refs map, which
architecture review A10 puts in the envelope deliberately: it is the parser-free source of
`{role, name}` and the thing a consumer needs without opening the file. The 8 KB tree text is
what A10 keeps *out*, and it is out.

## 3. The ref round trip

Driven through the framework's own adapter and evaluator (`dist/core/a11y-snapshot*.js`), so the
argv allowlist and the digest rule are the ones that ship.

| step | result |
|---|---|
| `a11y-ref` for `searchbox "Find a release"` (`@e28`), evaluated against a fresh snapshot of the same tree | **passed** (`is visible @e28 -> "true"`) |
| the same assertion after `surf tab.reload` that changed the tree (205 → 204 refs) | **unverified `ref_context_drift`**, both digests recorded |
| `a11y-role` `link "Releases"` after that reload | **passed**, resolved to `@e27` |
| the same assertion after `surf go https://github.com/nicobailon/surf-cli/tags` | **unverified `ref_context_drift`**, origin `…/tags` |
| `a11y-role` `link "Releases"` on `/tags` | **passed**, resolved to `@e15` |
| `a11y-role` `link " zip"` on `/tags` (the name repeats 10×) | **unverified `role_name_ambiguous`**, candidates `e100, e64, e68, e72, e76, e80, e84, e88, e92, e96` |
| `a11y-role` `link "No Such Link"` | **unverified `role_name_missing`** |

The two rows that matter together: the ref died across a reload and across a navigation, and the
`{role, name}` form resolved through both — to a *different* ref each time (`e28` → `e27` →
`e15`). That is the packet's Clash 4 resolution made visible: refs for reading within a snapshot,
`{role, name}` for writing across them.

### The reload-identical case

The packet's 2026-09-07 measurement recorded a reload that left the tree byte-identical, and the
refinement's whole argument (Clash 5) is that such a reload must *not* invalidate a ref. It
reproduces once the page has settled:

```
snapshot 1: sha256:82b7fb5ed1704dcf (205 refs)   <- first read after tab.new
snapshot 2: sha256:87059500dec06efb (204 refs)   <- after reload 1
snapshot 3: sha256:87059500dec06efb (204 refs)   <- after reload 2
snapshot 4: sha256:87059500dec06efb (204 refs)   <- after reload 3
```

and an `a11y-ref` minted against snapshot 3 and evaluated after the next reload:

```
after a reload that left the tree byte-identical (sha256:87059500dec06efb) -> passed
  evidence: e28 is searchbox "Find a release" in snapshot sha256:8705950… | is visible @e28 -> "true" (expected "true")
```

So both behaviours are real on the same page within a minute of each other, and the digest rule
is what makes them both correct answers. An event-based invalidator would have called the second
one drift and been wrong.

## 4. Coexistence with surf on one tab

One owned tab, one pinned agent-browser session, interleaved reads:

```
surf extract before a11y: ok 3 rows
a11y snapshot digest:     sha256:87059500dec06efb
surf extract after a11y:  ok 3 rows          (rows byte-identical to the first extract)
surf wait.ready after a11y: ready
a11y snapshot after two surf reads: unchanged
```

Neither tool disturbed the other: surf's extraction is identical before and after the snapshot,
the readiness gate still settles `ready`, and the snapshot is unchanged after two surf reads.
The `surf explore` runs of §1 are the same proof end to end — `tab.new`, `wait.ready`, two `js`
probes, then the channel, then `tab.close`, with all probes verified.

Teardown order, from a shared argv log of both fakes' live counterparts in the contract suite and
from the live run's own sequence:

```
surf tab.new -> surf wait.ready -> surf js -> surf js
  -> agent-browser tab <targetId> -> agent-browser snapshot -i --json -> agent-browser close
  -> surf tab.close
```

## 5. Where the packet's 2026-09-07 measurements no longer reproduce

1. **`snapshot -i --json` wraps its payload.** The packet lists the keys `lifecycle`, `origin`,
   `refs`, `snapshot`. In 0.35.1 those are inside agent-browser's own
   `{"success":true,"data":{…},"error":null}` envelope, and `lifecycle` carries a per-run launch
   hash. The framework unwraps the envelope and never reads `lifecycle`; the committed capture
   drops it so a fixture cannot depend on a value that changes per run.
2. **A new session creates one stray `about:blank`, `--pin-tab` or not.** Measured three times
   with three fresh session names, and once with `tab list` and once with `connect` as the first
   command: `/json/list` grows by exactly one page target on the first command of a session and
   not afterwards. The packet's 2026-09-07 note attributes the stray to an *unpinned* session
   outliving its tab; that is not what happens today. The channel therefore reports it rather
   than hiding it — `tabLeak: {"before":2,"after":3,"urls":["about:blank"]}` on a healthy run —
   and the packet's "page count before and after must match" is, as of 0.35.1, a check that
   fires once per run and names the URL.
3. **204 refs is 205 on a first read.** The extra node is a `listitem "v2.15.2" … clickable
   [cursor:pointer]` that the tree carries while the pointer is over the release list and drops
   afterwards. It is why run 1 and run 2 agree with each other (both read the page the same way)
   and why the settled reload sequence in §3 sits at 204.

## 6. `agent-browser … close` on an attached browser (packet open question 1)

The packet left this untested on purpose. Measured here, because Chromium (Agent) was started by
this run and could be restarted:

```
agent-browser --cdp 9222 --session tc-s9-probe3 close
✓ Browser closed
```

and afterwards: `/json/version` still answers `Chrome/152.0.7977.64`, every page target is still
open, and `agent-browser session list` no longer lists `tc-s9-probe3` (the listing is eventually
consistent; it settles within about two seconds). So **`close` on a session attached over `--cdp`
ends the session and leaves the browser and its pages alone.** It does *not* close the stray
`about:blank` the session created. `session end` is not a verb — `agent-browser session` accepts
`id`, `info` and `list` only, and `session end` prints the current session name.

The channel therefore tears down with `close`, always on its own `--session <prefix>-<runId>`,
never `--all` (which the argv allowlist refuses), and never on the shared `default` session.

## 7. The optional and required paths, live

| command | result |
|---|---|
| `--a11y-snapshot=required` with `TEST_CAPABILITIES_CDP_ENDPOINT=http://127.0.0.1:9333` | exit 1, `{"error":{"code":"a11y_channel_unavailable","message":"… cdp_endpoint_unreachable - No DevTools endpoint answered …; the channel never launches a browser."}}` |
| `--a11y-snapshot` (bare) with the same dead endpoint | exit 0, `userFlows 100`, page verified, `observations[0] = {status:"unavailable", reason:"cdp_endpoint_unreachable"}`, artifact written |
| no flag at all | exit 0, no `runtime.a11yChannel`, no `pages[].observations`, `effect {read_only, browser_session}`, `mutations: []` |

`doctor --json`, `external.agent_browser`:

| endpoint | status | detail |
|---|---|---|
| `http://127.0.0.1:9222` | pass | `agent-browser 0.35.1 via path (…); CDP http://127.0.0.1:9222: Chrome/152.0.7977.64` |
| `http://127.0.0.1:9333` | warn | `… No DevTools endpoint answered at http://127.0.0.1:9333/json/version (fetch failed). Start Chromium (Agent) …` |
| `http://10.0.0.5:9222` | warn | `… names host '10.0.0.5'. The a11y channel attaches to a browser on this machine only (127.0.0.1, localhost, ::1, [::1]); a remote DevTools endpoint is refused before any request is made` |

## 8. Cleanup

Every session this run created was ended with `close`; `agent-browser session list` shows only
`default` (the daemon that has been running since 2026-09-07 03:59 and belongs to someone else —
it was never touched). Every stray `about:blank` was closed with `surf tab.close`, and
`surf tab.list` ends where it started: one `chrome://newtab/`.
