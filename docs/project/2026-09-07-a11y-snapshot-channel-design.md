---
summary: "Design packet for an optional second browser observation channel: accessibility-tree snapshots with element refs from agent-browser over CDP against Chromium (Agent), gated on the CDP endpoint, recorded as receipts, and usable for LLM-driven test generation and ref-addressed assertions; surf stays the action channel."
read_when:
  - "You implement or review the a11y snapshot observation channel (agent-browser over CDP) in test-capabilities."
  - "You decide whether a browser evidence surface belongs in surf, agent-browser, or a tester prompt."
  - "You wonder why refs are per-snapshot, why --pin-tab is mandatory, or why the channel refuses to launch its own browser."
  - "You wonder why a ref survives a reload that leaves the tree identical but not a navigation, why the artifact records DOM counts next to role counts, or why the schema outlives agent-browser."
type: "design"
---

# A11y snapshot observation channel (agent-browser over CDP), 2026-09-07

Row 6 of `docs/project/2026-09-07-surf-learnings-assessment.md:29`: "accessibility snapshot with element refs as a second observation channel, optional, gated on the CDP port". This packet fixes the placement, the contract and the proof. No code changes ship with it.

## Problem (evidence and measurements)

What the framework can observe in a browser today is what `surf explore` extracts: three `js`/`extract` probes that return `location.href`, `document.title`, `readyState`, element counts and up to five same-origin links (`src/core/operations/surf-explore-operation.ts:322-335`). Coverage is graded from those probes (`:700-724`). Nothing describes *which* controls exist, so an LLM asked to write a browser test for a page has to work from a DOM dump, a screenshot, or `surf page.read`, and nothing lets an assertion name an element other than by CSS selector. `SurfClient.read()` parses `[ref=eN]` tokens (`src/integrations/surf-client.ts:249`), but the branch build prints `[eN]` (measured below), so the parser yields zero elements; it has no contract test (`tests/surf_client_contract.test.mjs` never exercises `read`/`parseSnapshot`).

Live measurements, 2026-09-07 ~09:00 CEST, Chromium (Agent) with CDP on `127.0.0.1:9222` (`~/ai-society/softwareco/infra/workstation/docs/project/2026-09-07-agent-chromium-surf-and-agent-browser.md:18`), agent-browser 0.35.1 at `~/.npm-global/bin/agent-browser`, surf 2.18.0 branch build. Tab opened with `surf tab.new https://github.com/nicobailon/surf-cli/releases` (tab `1075141818`, `wait.ready` state `ready` after 3 polls / 808 ms), read only, closed afterwards; the operator's Brave/Chromium were never touched.

| command (same tab) | bytes | lines | refs | wall | run 1 vs run 2 |
|---|---|---|---|---|---|
| `agent-browser --cdp 9222 snapshot -i` | 8 161 | 204 | 204 (`[ref=eN]`) | 53-89 ms | byte-identical; still identical after `surf tab.reload` |
| `snapshot -i -c` | 8 161 | 204 | 204 | 55-68 ms | identical to `-i` (compact is a no-op with `-i`) |
| `snapshot` (full) and `snapshot --urls` | 48 090 | 1 167 | 204 | 51-63 ms | identical; `--urls` changed nothing; `-i -u` printed "(no interactive elements)" |
| `snapshot -i --json` | 18 534 | 1 | 204 | 56 ms | identical; keys `lifecycle`, `origin`, `refs` (`{eN: {role, name}}`), `snapshot` (the 8 158-char text) |
| `snapshot -i -d 3` / `-i -s main` | 8 161 / 21 782 | | | | `-s` scoping disables the interactive filter |
| `surf page.read --tab-id N --no-text` | 2 920 | 41 | 38 (`[eN]`) | 125-149 ms | identical, but the footer carries a stateful `--- Diff from previous snapshot ---` block |
| `surf page.read --tab-id N` (default) | 22 658 | 43 | 38 | 125 ms | 20 KB of visible text; `--compact` no-op; `--all` 22 707 |

Role mix of `snapshot -i`: 95 link, 58 heading, 24 button, 10 region, 8 cell, 6 navigation, 2 columnheader, 1 searchbox; surf's 38 refs are 34 link, 3 button, 1 searchbox (interactive only, no landmarks or headings, hrefs inline). Ref-addressed read-only calls all succeeded: `get text @e28`, `is visible @e28`, `get attr @e26 href`, `get box @e28` (height 32), `get url`; `is visible @e9999` failed with `{"success":false,"error":"Unknown ref: e9999"}`. Two findings shape the contract: after `surf tab.reload` the *old* `@e28` still resolved (`visible: true`) without a fresh snapshot, so agent-browser does not invalidate refs on reload; and when the surf tab was closed, an unpinned agent-browser session silently created an `about:blank` tab in the agent browser (surf tab `1075141819`, closed by hand), while a `--pin-tab` session failed with `tab_gone` carrying `targetId` and `lastUrl`.

So: the a11y snapshot is ~2 k tokens, deterministic across runs, richer than surf's interactive list (landmarks, headings, table cells) and 6x smaller than the full tree; it is cheap evidence for test generation and gives a stable-looking but not self-validating handle for assertions.

## Placement (confirm/challenge)

Assessment row 6 says "flavor gated on the CDP port". Challenged: a flavor is the wrong shape. `SurfRuntimeFlavor` is `"surf"` only (`src/core/surf-runtime.ts:17`) and names *which surf binary* runs; agent-browser is a different tool with a different transport, and it must never become the action channel (the retired fork lesson: one verified action path, `docs/project/2026-09-07-surf-cli-migration-live-run.md`). It is also not an orchestrator agent: it produces no findings on its own and `CAPABILITY_MATRIX.orchestrator.agents` (`src/core/capabilities.ts:15-21`) is the parliament of sensors, not of evidence formats.

Confirmed placement: an **observer** attached to browser operations, resolved and probed exactly like the surf runtime (`src/core/surf-runtime.ts:163-213`, `:429-481`), reported by `doctor` as an optional external (`src/core/operations/doctor-operation.ts:283-344` is the template), invoked by `surf explore` after the readiness gate on the surf-owned tab, and stored as an artifact in the page result. Its second consumer is the tester prompt: `prompts/web-tester.md:70-92` already describes the snapshot/ref loop for pi-agent-browser; the channel makes that a framework artifact instead of an ad-hoc shell habit. So: runtime module + observer hook + prompt input; not a flavor, not an agent.

Integration points:
- `src/core/a11y-snapshot-runtime.ts` (new): resolution, probes, argv allowlist, artifact and assertion types.
- the surf adapter's owned-tab `BrowserSession`: the observer is a registered read-only `observe` step run after the probes and torn down before the session closes (revised by architecture review: A8); `explorePage` (`surf-explore-operation.ts:632-694`) becomes a step list over the session, so the observer inherits the effect class, attempt log and outcome of every step.
- `src/core/operations/types.ts:233-245`: `observations?: A11ySnapshotArtifact[]` on `SurfExplorePageResult`; envelope `runtime` gains `a11yChannel`.
- `src/core/operations/doctor-operation.ts`: `external.agent_browser` next to `external.surf`; `src/core/capabilities.ts:46`: the new explore option in `SURF_EXPLORE_OPTION_SUPPORT`.
- `src/core/orchestrator.ts:202-210`: `observation` block on `AgentConfig`; `:2096` passes it to the explore operation.
- `prompts/web-tester.md`, `docs/DECISION-MATRIX.md:121-132`, `docs/api/config.md:162`, README capability table, capability passport.

## Current state

- `surf explore` owns tabs end to end: `tab.new` (`surf-explore-operation.ts:187-200`), `wait.ready` gate (`:266-309`), probes, `tab.close` (`:202-208`). The result envelope has `runtime`, `evidence`, `coverage`, `pages[]` (`src/core/operations/types.ts:247-284`); each page has `probes[]` of kind `state|dom|links` (`:223-231`). There is no slot for an observation artifact.
- `doctor` reports `external.surf` with structured `data` (`doctor-operation.ts:318-325`) and `external.bombadil`; nothing knows about agent-browser or the CDP port.
- `scripts/test-agent-browser.sh:9-22` runs `agent-browser open` / `close` on the default session, which launches agent-browser's own headless Chrome and closes it; it is a leftover, not a contract, and it violates the owned-tab rule for the agent browser.
- Docs list agent-browser as a neighbour tool (`docs/DECISION-MATRIX.md:24`, `:45`, `:107-113`, `:203`; `docs/LLM-TESTING-GUIDE.md:80`, `:115`, `:228-235`) with no framework path.
- `SurfClient.read()` → `parseSnapshot` (`surf-client.ts:194-202`, `:226-266`) is unverified and mismatched with the branch output format.
- Only Chromium (Agent) exposes CDP; the port is loopback-only and every local process can drive that browser (workstation doc `:31-34`).

## Contract

**Resolution and probe** (`src/core/a11y-snapshot-runtime.ts`, mirroring `surf-runtime.ts`):
1. Binary: `TEST_CAPABILITIES_AGENT_BROWSER_BIN` (must be executable) → `agent-browser` on `PATH` → `~/.npm-global/bin/agent-browser`, with a resolution note when the last one is used (cf. `surf-runtime.ts:196-208`).
2. Version probe: `agent-browser --version`, minimum `0.35.1` (the version whose `--pin-tab`, `tab_gone` and `tab list --json` `targetId` semantics were measured); cached per command path like `probeCache` (`surf-runtime.ts:418`).
3. CDP probe: `TEST_CAPABILITIES_CDP_ENDPOINT` (default `http://127.0.0.1:9222`); the host must be `127.0.0.1`, `localhost` or `[::1]`, anything else is refused before any request; `GET /json/version` with a 2 s timeout must return JSON with a `Browser` string. The browser string and `webSocketDebuggerUrl` host are recorded.
4. Any step failing yields channel status `unavailable` with a typed reason (`agent_browser_missing`, `agent_browser_too_old`, `cdp_endpoint_refused`, `cdp_endpoint_unreachable`, `cdp_endpoint_not_chromium`). The channel never launches a browser: every agent-browser invocation carries `--cdp <port>`; `open`, `--auto-connect`, `--profile`, `--headed` are not in the allowed argv (fail closed like `translateSurfArgs`, `surf-runtime.ts:891-990`).

**Config keys**: `surf explore --a11y-snapshot[=required]` (added to `SURF_EXPLORE_OPTION_SUPPORT`; the default stays off so existing runs are byte-compatible); `agents.<name>.observation.a11ySnapshot: off|optional|required` for the surf agent (`AgentConfig`, `src/core/orchestrator.ts:202-210`, next to `bombadil`/`terminal`); `TEST_CAPABILITIES_AGENT_BROWSER_BIN`, `TEST_CAPABILITIES_CDP_ENDPOINT`, `TEST_CAPABILITIES_AGENT_BROWSER_SESSION_PREFIX` (default `test-capabilities`). `optional` records `unavailable` and continues; `required` fails the page as unverified with the reason. Unknown values are refused.

**Session and tab binding**:
- one agent-browser session per run, `--session <prefix>-<runId>`, `--pin-tab` on the first command (sticky per session); `runId` is the kernel `RunContext.runId` minted by `executeCliOperation` (A5);
- the surf-owned tab is located through `GET /json/list` (read-only HTTP, no agent-browser side effects), matching `type == "page"` and `url == readiness.href` from `wait.ready`; exactly one match is required, `tab_bind_ambiguous` otherwise;
- the first agent-browser command is `tab <targetId>` (verified: binds the pinned session without creating a tab); the CDP target id is the same string in `/json/list` and in `tab list --json`;
- the recorded binding is `{surfTabId, targetId, url, title}` and every later command of the run is checked against it (`get url` must still equal the bound URL before an assertion is evaluated).

**Snapshot artifact** (`a11y-snapshot.v1`, written through the kernel artifact writer `src/core/artifacts.ts` under `receipts.dir/<run>/` as kind `a11y-snapshot` (A9); the page result's `pages[].observations[]` carries `digest`, `refs`, `roleCounts`, `semanticCoverage`, `status` and the artifact path, never the 8 KB text (revised by architecture review: A10)):
```
{ schemaVersion: 1, kind: "a11y-snapshot", channel: "agent-browser-cdp",
  tool: { command, version }, endpoint: { url, browser },
  session: string, tab: { targetId, surfTabId, url, title },
  sequence: n, capturedAt: iso, elapsedMs, bytes, refCount,
  digest: "sha256:<hex of the snapshot text>",
  refs: { "e28": { role: "searchbox", name: "Find a release" }, ... },
  snapshot: "<text of snapshot -i>",
  roleCounts: { link: 95, heading: 58, button: 24, ... },
  semanticCoverage: { anchors: { dom: n, tree: n }, buttons: { dom: n, tree: n }, inputs: { dom: n, tree: n } },
  status: "captured" }
```
or `{ schemaVersion: 1, kind: "a11y-snapshot", status: "unavailable", reason, detail }`. The source is `snapshot -i --json` (one call gives both the refs map and the text); `origin` must equal the bound tab URL or the artifact is refused (`origin_mismatch`), the same rule as the probe-id evidence check in `surf-explore-operation.ts:409-430`. The receipt keeps both the text (the only digest input) and the refs map (the only parser-free source of `{role, name}`; deriving it from the text would recreate the `parseSnapshot` failure).

*Added by refinement (Clash 1):* `roleCounts` is derived from `refs`; `semanticCoverage` sets the `dom` probe's counts (`anchors`, `buttons`, `inputs`, `surf-explore-operation.ts:322-335`) from the same tab and the same page visit against the tree's counts (`link`; `button`; the union of `textbox|searchbox|combobox|checkbox|radio|slider|spinbutton|listbox`). A gap is recorded evidence, never a failure and never zeroed: it is the number of controls the DOM has and the browser cannot name, i.e. the exact size of this channel's blind spot on that page. When the `dom` probe did not verify, `semanticCoverage` is absent (not `0`) with `reason: "dom_probe_missing"`.

**Producer independence** (*added by refinement, Clash 3*): `a11y-snapshot.v1` and `a11y-assert.v1` are the contract; `channel` names a producer. agent-browser over CDP is the only producer today because it is the only one measured to emit roles, names, landmarks, headings and a ref resolver deterministically; the day `surf page.read --json` (or a direct CDP `Accessibility.getFullAXTree` reader in `src/core/`) emits the same fields at the same schema without the stateful diff footer, the observer switches producer and no consumer changes. Digests are producer-specific by construction (they hash the producer's text), so a producer switch turns every stored `a11y-ref` into `ref_context_drift` and leaves every `a11y-role` valid; that is the intended direction of the two forms.

**Ref stability and invalidation** (*revised by refinement, Clash 5:* the first draft listed invalidators by event, which contradicted the digest-based evaluator; a reload leaves the measured tree byte-identical, so an event rule and a content rule give different answers): refs are per snapshot, and a ref is valid **iff** the digest of a fresh snapshot equals the digest of the snapshot that minted it. Validity is content identity, not time and not an action count. Two rules make this sufficient: (1) a ref is never resolved against agent-browser except immediately after a fresh `snapshot -i --json` in the same session, so the producer's internal ref table is never consulted stale (it re-resolved `@e28` after a reload; that table is not trusted); (2) a byte-identical tree mints byte-identical refs, so digest equality implies ref identity. Consequently a `surf tab.reload` that leaves the tree identical does not invalidate a ref, and a navigation, a login redirect or an in-page change that alters the tree does. `sequence` orders artifacts within a run and is not an invalidator. Cross-run identity is expressed by `{role, name}`, never by `eN`.

**Ref-based assertion** (`a11y-assert.v1`):
```
{ kind: "a11y-ref", snapshotDigest: "sha256:…", ref: "e28",
  expect: { role: "searchbox", name: "Find a release", visible: true,
            text?: string, attr?: { href: "…" } } }
{ kind: "a11y-role", role: "link", name: "Releases", expect: { visible: true } }
```
Evaluation: take a fresh `snapshot -i --json`; for `a11y-ref` the fresh digest must equal `snapshotDigest` and `refs[ref]` must match `role`/`name`, else the assertion is `unverified` with `ref_context_drift` (never "failed", never "passed"); for `a11y-role` the `{role,name}` pair must resolve to exactly one ref in the fresh snapshot, else `unverified` with `role_name_missing` (zero) or `role_name_ambiguous` (more than one, candidate refs listed) (*added by refinement, Clash 4:* 95 links on the measured page make repeated names the normal case, and `nth` is the selector school's brittleness under another name; landmark scoping (`within: {role, name}`) is the right resolution but needs parent links the flat `refs` map does not carry, so it is deferred to a structured producer, see open questions). Then `is visible @ref`, `get text @ref`, `get attr @ref <name>` run against the same session; each returns `passed|failed` with the command, ref and value as evidence. `visible` means agent-browser's computed predicate (style and geometry), not perception; overlap, clipping and contrast are outside this channel (*added by refinement, Clash 2*). Only read-only agent-browser verbs are allowed: `snapshot`, `get text|attr|box|url|title|count`, `is visible|enabled|checked`, `tab list`, `tab <id>`.

**Coexistence with surf on the same tab**:
- surf owns the tab lifecycle (`tab.new`/`tab.close`), the readiness gate and every action; agent-browser is bound to the same CDP target and only reads;
- order per page: surf action → `wait.ready` → a11y snapshot → assertions; nothing interleaves, and an assertion never triggers a surf action;
- teardown order: end the agent-browser session first (`tab_gone` is an acceptable outcome if the tab is already gone), then `surf tab.close`;
- why: an unpinned session left alive after the tab closed created a stray `about:blank` in the agent browser and then refused `tab close` as "Cannot close the last tab"; the pinned session failed cleanly with `tab_gone`;
- stray-tab detection is part of the page result: `/json/list` page count before and after the run must match, otherwise the page reports `tab_leak` with the leaked URLs.

**Tester prompt input**: the artifact is what an LLM-driven tester reads instead of a DOM dump. `prompts/web-tester.md` gets an option that hands over `snapshot` (text) and `refs` and asks for assertions in the `a11y-role` form, because refs die with the snapshot:
```
Page: <tab.url> (readiness: ready). Accessibility snapshot (agent-browser, 204 refs):
- searchbox "Find a release" [ref=e28]
- navigation "Releases and Tags" [ref=e11]
  - link "Releases" [ref=e26]
Controls the DOM has that the tree cannot name (semanticCoverage gap): <n> buttons, <n> inputs;
assert those through surf selectors, not by role.
Write assertions as {kind: "a11y-role", role, name, expect}; do not emit eN refs,
they are valid only for this snapshot (digest sha256:…). If a {role, name} pair is not
unique on this page, say so instead of picking one.
```

## Behaviour and failure modes

| situation | behaviour |
|---|---|
| no agent-browser / too old / CDP port closed / non-loopback endpoint | `optional`: page gets `observations: [{status: "unavailable", reason}]`, coverage unchanged; `required`: page `verified: false`, probe error `a11y_channel_unavailable`; `doctor` warns in both cases |
| `/json/version` answers but the surf tab is not in `/json/list` (or twice) | `tab_bind_ambiguous`, snapshot skipped/failed per mode; surf probes still run |
| `snapshot -i --json` fails, is empty, or `origin` differs from the bound tab | `snapshot_failed` / `empty_snapshot` / `origin_mismatch`; the empty case is a failure, never a zero-element success (assessment row 5) |
| `tab_gone` during the run | the page is marked `tab_lost`, remaining assertions `unverified`, teardown continues |
| ref assertion against a different digest | `unverified` with `ref_context_drift`, both digests recorded |
| `a11y-ref` evaluated after a `surf tab.reload` that leaves the tree byte-identical | fresh digest equals the minting digest: evaluated normally, `passed` or `failed` (*revised by refinement:* the first draft expected `ref_context_drift` here, which the digest evaluator cannot produce) |
| `a11y-role` resolves to zero or to several refs in the fresh snapshot | `unverified` with `role_name_missing` / `role_name_ambiguous` and the candidate refs; never a guess |
| `dom` probe on the page did not verify | artifact still `captured`; `semanticCoverage` absent with `dom_probe_missing`; the tester prompt omits the gap line |
| daemon left behind | the run ends the session it created and never touches other sessions (the default session daemon started at 03:59 belongs to someone else and was left alone) |

## Cost

Per page: one `/json/list` GET, one `tab <targetId>`, one `snapshot -i --json` (~18 KB, 50-90 ms) and one agent-browser daemon per run (Rust binary attached over a websocket, exempt from idle shutdown when attached, hence explicit teardown). The artifact file holds ~8 KB text plus ~10 KB refs; the page result carries refs, counts and digest (A10), and the text is about 2 k tokens when handed to a tester prompt, versus 22 KB for `surf page.read` or a screenshot. Implementation: runtime module (~300 lines), observer hook in `surf-explore-operation.ts`, doctor check, fake fixture and fake CDP endpoint, docs; comparable to the surf migration.

## Non-goals

- Not an action channel: no `click`, `fill`, `type`, `eval`, `network route`, `cookies`, `open`, `--auto-connect`, `--profile`, screenshots or `a11y` audits through agent-browser.
- No second browser: the channel attaches to Chromium (Agent) only; it never launches a headless Chrome and never targets Brave or the personal Chromium.
- No ref-based healing or ref persistence across runs; no replacement of surf's `wait.ready`/`extract` evidence; no orchestrator agent of its own; no fixing of `SurfClient.parseSnapshot` here (tracked separately).

## Risks

- CDP port exposure: the port already lets any local process read cookies of the agent browser (workstation doc `:31-34`). The channel does not widen this: it only ever targets the configured loopback endpoint, refuses anything else, and adds no listener. It does put page text into receipts; snapshots of logged-in pages are evidence like screenshots and get the same handling (no secrets in the profile, review before sharing).
- Refs are per snapshot and agent-browser silently re-resolves stale ones; the digest rule above is the only defence, so it is mandatory, not advisory.
- Shared tab: another agent-browser session or a human could act on the same tab; the readiness re-check and origin check catch navigation, not in-page edits. Accepted for an owned tab in the agent browser.
- Tool drift: `--urls` and `-i -u` behaved unexpectedly in 0.35.1; the contract uses only `snapshot -i --json`, `tab`, `get`, `is`, and pins the minimum version.
- Semantic blind spot (*added by refinement*): the tree is rich in proportion to the application's accessibility quality; on an app built from `div onclick`, `snapshot -i` is nearly empty and the LLM tester would conclude "nothing to test". `semanticCoverage` makes the gap visible on every page; it does not close it. Such controls are asserted through surf selectors.
- Lossy digest (*added by refinement*): the digest hashes `snapshot -i` text, which carries no `href`, `value` or attributes; two pages whose links share names but differ in targets share a digest. `a11y-ref` with `expect.attr` catches this at evaluation time; the digest alone does not.
- Producer lock (*added by refinement*): the observer depends on one binary's rendering. Mitigation is the schema-first contract above and the named fallback producer (direct CDP reader); `channel` is recorded so a producer switch is visible in every receipt.

## Verification and dogfood plan

1. `tests/fixtures/fake-agent-browser.mjs` + `tests/helpers/fake-agent-browser.mjs` (pattern: `tests/fixtures/fake-surf.mjs:1-30`, `tests/helpers/fake-surf.mjs:37`): speaks `--version`, `tab list --json`, `tab <targetId>`, `snapshot -i --json` from a `FAKE_AB_PAGES` map fed by the captured `snapshot -i --json` under `tests/fixtures/captures/agent-browser/` with a fidelity test (A17), `get text|attr|box|url`, `is visible`, `Unknown ref`, `tab_gone`, and refuses any other verb with exit 1; env knobs for `--version` below minimum, empty snapshot, origin mismatch, and a log of argv per call so tests can assert that `--cdp`, `--session`, `--pin-tab` were passed and that no action verb ever ran.
2. A fake CDP endpoint (`node:http` on `127.0.0.1:0`, serving `/json/version` and `/json/list`; precedent `scripts/capability-fixture-server.mjs`) so the probe, the loopback rule, the tab binding and `tab_bind_ambiguous` are tested without a browser.
3. `tests/a11y_snapshot_runtime_contract.test.mjs` (resolution order, version floor, endpoint refusal, argv allowlist), `tests/a11y_snapshot_observer_contract.test.mjs` (artifact schema, digest, unavailable-vs-required, origin mismatch, teardown order), doctor check added to `tests/surf_runtime_contract.test.mjs` style coverage, passport regeneration (`scripts/generate-capability-passport.mjs`).
4. Live dogfood on `https://github.com/nicobailon/surf-cli/releases`: `surf explore --url … --a11y-snapshot=required` must reproduce the table above (204 refs, digest identical across two runs, tab count unchanged before/after, no session left in `agent-browser session list`, `roleCounts` matching the role mix, `semanticCoverage` recorded with the `dom` probe's counts); then the ref round trip (*revised by refinement, Clash 5*): write an `a11y-ref` assertion for `searchbox "Find a release"` from run 1, evaluate it in run 2 (same digest → `passed`); reload via surf between snapshot and evaluation (tree identical → same digest → `passed`); navigate the tab via surf to `https://github.com/nicobailon/surf-cli/tags` between snapshot and evaluation (different digest → `ref_context_drift`); evaluate the `a11y-role` form for `link "Releases"` (`passed`) and for a name that repeats on the page (`unverified`, `role_name_ambiguous`, candidates listed).
5. Gates: `npm run check`, `npm test`, `loop-impact-plan` → `loop-impact-wide` (runtime surface changes).

## Open questions

- Does `agent-browser --session <s> close` disconnect from an attached browser or close it? Not tested on purpose (concurrent sessions use the agent browser); the daemons were ended with SIGTERM, which was safe. Decide the teardown verb after a test on an idle browser.
- ~~Should the receipt keep the 8 KB text, or only the refs map plus digest, with the text re-derivable?~~ Closed by refinement: keep both; the text is the digest input and the refs map is the parser-free source of `{role, name}`; neither is derivable from the other without a parser.
- `within: {role, name}` landmark scoping for `a11y-role`: the snapshot text carries nesting by indentation, the `--json` refs map does not. Parse the indentation (a second parser, the thing this packet avoids) or wait for a producer that emits parent links? Deferred; ambiguity is a typed `unverified` until then.
- `snapshot -i -s <selector>` disables the interactive filter; is a scoped snapshot worth a separate option or is depth enough?
- Where do ref assertions live once `surf assert` exists (`dispatch-manifest.ts:72-81` registers it as failing clearly)? This packet defines the artifact and the evaluator; the CLI verb is the submit-gate/assert packet's call.

## Decision log

- 2026-09-07: observer, not a runtime flavor and not an agent; agent-browser reads, surf acts.
- 2026-09-07: gated on the resolved binary and a loopback-only CDP endpoint; absence is a typed `unavailable`, never a launched browser and never a silent skip when `required`.
- 2026-09-07: `--pin-tab` and binding by CDP `targetId` from `/json/list` are mandatory after observing the stray `about:blank` and the `tab_gone` behaviour.
- 2026-09-07: refs are valid only with the digest of their snapshot; drift yields `unverified`, and cross-run identity is `{role, name}`. *revised by refinement:* validity is digest equality against a mandatory fresh snapshot and nothing else; the event list (any action, any readiness change, any later snapshot "even when identical") is dropped because it contradicted the evaluator and predicted `ref_context_drift` for a reload that leaves the tree byte-identical. `sequence` is ordering, not invalidation.
- 2026-09-07: source is `snapshot -i --json` only; `--urls`, `-u`, `-s`, `page.read` refs are out of contract.
- 2026-09-07 (refinement): the artifact schema is the contract and agent-browser is a replaceable producer; sunset condition: surf `page.read --json` or a direct CDP reader emitting the same fields deterministically retires the second tool. Direct CDP is the named fallback if agent-browser drifts; rejected as the first producer because it has no ref resolver behind `is visible`/`get box`/`get attr` and would reimplement the interactive filter.
- 2026-09-07 (refinement): the artifact records `roleCounts` and `semanticCoverage` (DOM counts from the `dom` probe against tree counts); a gap is evidence of the channel's blind spot on that page and routes the tester to surf selectors for the unnamed controls.
- 2026-09-07 (refinement): `a11y-role` ambiguity is `unverified` with `role_name_ambiguous`; no `nth`, no first-match; landmark scoping deferred to a producer with parent links.
- 2026-09-07 (refinement): `visible` is a computed predicate; perceptual evidence (overlap, clipping, contrast) is out of this channel by name; screenshots stay in surf.
- 2026-09-07, revised by architecture review (A8): the observer is an `observe` step on the surf adapter's `BrowserSession`, not a hook inside `explorePage`.
- 2026-09-07, revised by architecture review (A5, A9, A10): the session name derives from the kernel `RunContext.runId`; the artifact is written through `src/core/artifacts.ts`; the envelope carries digest, refs and counts and names the file, the text stays in the file.
- 2026-09-07, revised by architecture review (A17): the fake agent-browser is fed by captured `snapshot -i --json` shapes under `tests/fixtures/captures/` with a fidelity test.

## Refinement (many-of-the-greats)

Adjudication of this packet's central design question, 2026-09-07, with the operator's many-of-the-greats prompt. Everything under PRACTICAL CONSEQUENCE has been folded into Contract, Behaviour, Risks, Verification, Open questions and the Decision log above; changed decisions carry `revised by refinement:`, additions carry `added by refinement`.

### QUESTION

For a fail-closed testing framework in which surf is the only action channel and a language model is both the generator of tests and a reader of their evidence: what is the correct unit of evidence about a browser page? The candidates are (a) an accessibility-tree snapshot whose nodes are `{role, name}`, whose refs `eN` are minted per snapshot and bound to a content digest, produced by a second read-only tool (agent-browser) attached to the same CDP target as surf; (b) DOM/selector evidence from surf's own `js`/`extract` probes; (c) screenshots read by a vision model; (d) surf's own `page.read` refs, which keep the evidence inside the one tool that acts. And, if (a): is the evidence gain worth a second process bound to shared mutable state (session daemon, `--pin-tab`, binding by target id, teardown order, leak detection), or should the same tree be obtained without it, from surf or from CDP directly?

### MODE 1 — MANY OF THE GREATS

#### School 1: Semantic locators (Testing Library, Playwright role locators, WAI-ARIA)
- Core claim: a control's identity is its role and accessible name, because that is the identity a person uses; a test that addresses controls this way survives every refactor that leaves the user's experience unchanged and fails exactly when that experience changes.
- Premises: the accessibility tree is the browser's own computed model of "what is here for a person"; the DOM is an implementation detail; a test that depends on implementation detail tests the wrong thing; a control that cannot be found by role and name is an accessibility defect, which is itself a finding.
- Strongest case: `searchbox "Find a release"` is readable by a human, stable across CSS and framework rewrites, computed by the browser rather than by a parser, and doubles as an accessibility assertion. The measured snapshot is this claim made concrete: 204 nodes with role and name, landmarks, headings and table cells that no selector dump surfaces, byte-identical across runs.
- What it sees that others miss: that "which element" has a user-facing answer, and that identity across runs must be semantic because every other handle (selector, ref, pixel) is minted by an implementation and dies with it.

#### School 2: DOM-selector pragmatists (Selenium and Cypress lineage, `data-testid`, this framework's own `extract` probes)
- Core claim: the DOM is the ground truth; a selector is explicit, cheap and under the application owner's control; every other view of the page is a lossy projection with tool-specific quirks.
- Premises: the accessibility tree is derived (name computation, hidden-node pruning and generic-node collapsing differ across browsers and versions); most real applications have poor semantics, so their controls are invisible in a tree filtered to interactive roles; the DOM holds what the tree drops (`href`, `value`, classes, data attributes); evidence should be reproducible by anyone with `document.querySelectorAll`.
- Strongest case: the framework's entire existing evidence path (`buildProbeExpression`, `assertProbeEvidence`) is DOM-derived and verifiable against a probe id; it works on every page, including semantically broken ones. A `div` with a click handler and no role is a real control that accessibility evidence can neither name nor count. On precisely the applications that most need testing, the tree is thinnest.
- What it sees that others miss: the blind spot. Semantic evidence is rich in proportion to the application's accessibility quality, and its silence is indistinguishable from absence unless something counts the DOM alongside it.

#### School 3: Vision ("test what the user sees": visual regression, VLM agents, computer use)
- Core claim: the only faithful evidence of a user interface is its rendering; both trees can report a control as present and visible while it is covered, clipped, off-screen or at zero contrast.
- Premises: perception is the ground truth of a UI and structure is a proxy; screenshots are tool-independent and survive tool drift; current models read them.
- Strongest case: overlays, z-index bugs, layout collapse and "visible but unreachable" are the failures users report, and no tree can represent them; a screenshot is universal evidence that needs no producer contract.
- What it sees that others miss: that `visible` from a tree or a box query is a computed claim about style and geometry, not a perceptual fact.

#### School 4: Single-tool minimalists (one verified action path; the retired-fork lesson)
- Core claim: every additional process bound to shared mutable state multiplies failure modes faster than it adds evidence; evidence should come from the tool that acts, or from a transport the framework already owns.
- Premises: the coupling cost of a second tool is not its code but its state: session daemons, pinned tabs, binding by target id, teardown order, stray tabs, version floors; this packet's own measurements (stray `about:blank`, "Cannot close the last tab", stale ref re-resolution) are that cost made visible; surf already has `page.read` with refs, and the framework already speaks CDP HTTP for `/json/list`, so the tree is reachable without a third binary.
- Strongest case: `SurfClient.parseSnapshot` is broken today and nobody noticed because nothing exercises it. A second reader with its own daemon and its own output format repeats that pattern at larger scale. Fix the one tool, or read `Accessibility.getFullAXTree` over the CDP socket the framework already trusts.
- What it sees that others miss: that the durable asset is the evidence schema, not the producer, and that whichever tool produces it today must be replaceable without touching a consumer.

#### School 5: Hermetic artifacts (content-addressed evidence; snapshot testing; Antithesis-style determinism, Bombadil's `extract`/`always`/`eventually`)
- Core claim: evidence is evidence only when it is a self-validating artifact: deterministic given the same page, content-addressed, and re-checkable later without the tool that produced it.
- Premises: a handle (ref, selector, coordinate) is meaningful only relative to the artifact that minted it; tools lie about staleness (agent-browser re-resolved `@e28` after a reload); a receipt must carry enough to recompute its own digest; determinism is what makes a diff mean something.
- Strongest case: `snapshot -i` was byte-identical across runs and across a reload, so its sha256 is a real identity of "the page as the tree sees it". Bind every ref to that digest and staleness disappears by construction: an old ref is never resolved except against a fresh snapshot whose digest equals the minting digest. `surf page.read`, by contrast, appends a stateful `--- Diff from previous snapshot ---` footer and is not hermetic.
- What it sees that others miss: that validity is a property of content identity, not of time or action counts, and that a run-to-run digest comparison is a free change detector.

#### School 6: LLM context economy (Playwright MCP, agent-browser, browser-use snapshot design)
- Core claim: an observation format must be optimized for its reader, and the reader is a language model with a token budget and a tendency to hallucinate structure that is not in view; compact, structured, ref-addressable, deterministic text is what makes a model act correctly and what makes prompt caching work.
- Premises: 2 k tokens of role/name lines beat 22 KB of page text and beat an image; determinism across runs means the same prefix hits the cache; a short ref (`@e28`) is what makes a model's next step unambiguous; a model should never be asked to invent a selector.
- Strongest case: the measured 8 KB interactive snapshot carries every control of a 1 167-line page in 204 lines; that is the difference between a tester prompt that fits and one that does not.
- What it sees that others miss: that the prompt is the interface, and the evidence format is a UX decision for a non-human reader.

### MODE 2 — CONFRONTATION

#### Clash 1: Semantic locators vs DOM pragmatists
- Fundamental contradiction: whether identity is user-facing (role and name) or structural (selector). These are different partial orders over the same page; neither is derivable from the other.
- Incompatible assumptions: "the tree is what exists for the user" against "the DOM is what exists"; "silence in the tree is a finding" against "silence in the tree is a tool limitation".
- What semantic explains better: stability across refactors, identity across runs, assertions a human can read that double as accessibility checks, and landmarks and headings, which selectors cannot express without application knowledge.
- What DOM explains better: applications with poor semantics; attributes the tree drops (the `snapshot -i` text carries no `href`, so two links with the same name and different targets share a digest); the count of controls that exist against the count the tree can name.
- Residual tension: irreducible, and quantifiable per page: the gap between DOM control counts and tree role counts. Left unmeasured, the semantic channel under-reports on exactly the pages that need it.

#### Clash 2: Vision vs both tree schools
- Fundamental contradiction: perceptual truth against structural truth. A tree can be right about structure and wrong about what is perceivable; a screenshot can be right about perception and unable to name anything.
- Incompatible assumptions: "`visible` is a computed style-and-geometry predicate" against "`visible` is what a person sees"; "evidence must be addressable" against "evidence must be faithful".
- What vision explains better: overlap, clipping, contrast, layout collapse; every case where `is visible` says true and a person says no.
- What trees explain better: determinism (a screenshot differs with fonts, anti-aliasing, scroll offset), cost, and addressability (no ref, no assertion currency).
- Residual tension: irreducible. Neither substitutes for the other; the honest move is to define what `visible` means in this channel and leave screenshots to surf, where the action channel already attaches them.

#### Clash 3: Single-tool minimalists vs the observer (semantic plus hermetic)
- Fundamental contradiction: whether the evidence gain of a second reader outweighs a second process bound to the same tab.
- Incompatible assumptions: "the tree is a CDP domain you already reach; a third binary is ceremony" against "the interactive filter, ref minting and ref-to-node resolution are a curated, measured rendering that a reimplementation would drift from".
- What minimalism explains better: the failure catalogue in this very packet (stray tab, last-tab refusal, stale ref re-resolution, version floor) and the fact that `parseSnapshot` rotted unobserved.
- What the observer explains better: the measurements. surf's `page.read` yields 38 interactive refs, no landmarks or headings, and a stateful diff footer; agent-browser's `snapshot -i --json` yields 204 refs with roles, names, landmarks, headings and table cells, byte-identical across runs, from one call. A direct `Accessibility.getFullAXTree` reader would give the tree but not the ref resolver behind `is visible @ref`, `get box @ref`, `get attr @ref`; the framework would reimplement the interactive filter and inherit the parser problem it is trying to escape.
- Residual tension: resolvable by moving the commitment one level up. The minimalist is right that the producer must be replaceable and must never sit in the default path; the observer is right that today only agent-browser produces the evidence at the measured quality. The artifact schema, not the tool, is the contract.

#### Clash 4: Hermetic artifacts vs context economy (refs as currency)
- Fundamental contradiction: economy wants the shortest handle (`@e28`) to be what the model emits; hermeticism says a handle without its digest is a lie waiting to happen.
- Incompatible assumptions: "refs are cheap and unambiguous" against "refs are unowned the moment the snapshot is superseded".
- What economy explains better: why the model reads refs and why the prompt must stay at a few thousand tokens.
- What hermeticism explains better: why the model must write `{role, name}`: the assertion will be evaluated in another run, against another snapshot, possibly from another producer.
- Residual tension: resolved by role: refs for reading within a snapshot, `{role, name}` for writing across snapshots. What remains is the ambiguity of `{role, name}` on pages with repeated names (95 links on the measured page), which the semantic school solves by scoping within a landmark and the selector school by `nth`; the flat `refs` map carries no parent, so scoping needs the text's indentation or a structured producer.

#### Clash 5: Hermetic artifacts vs this packet's first invalidation rule
- Fundamental contradiction: the first draft listed invalidators by event (any surf action, any readiness change, any later snapshot "even when identical") while the evaluator it specified validated by content (fresh digest must equal the minting digest). After `surf tab.reload` the snapshot was measured byte-identical, so the evaluator would report `passed` while the dogfood plan expected `ref_context_drift`. Both cannot hold.
- Incompatible assumptions: "validity is a function of time and actions" against "validity is a function of content identity".
- What the event rule explains better: agent-browser's internal ref table can go stale after an action; that hazard is real and was observed.
- What the content rule explains better: the hazard is removed by never evaluating a ref except against a fresh snapshot; a fresh snapshot re-mints refs, and a byte-identical tree mints byte-identical refs, so digest equality implies ref identity. The event list is then redundant for evaluation and wrong in its prediction for reload.
- Residual tension: none once the two notions are separated: the mandatory fresh snapshot is the defence against staleness; the digest is the definition of validity.

### MODE 3 — INTEGRATION OR DECISION
- Chosen path: Contextual Dominance
- Result:
  - Identity: the semantic school dominates. What a test names, what the model is given to read, and what crosses runs is `{role, name}`; refs are a within-snapshot reading aid.
  - Validity: the hermetic school dominates. A ref is valid iff a fresh snapshot's digest equals the minting digest; the evaluator always snapshots first; no event list, no `sequence` comparison, no trust in the producer's staleness bookkeeping.
  - Ground truth and blind spot: the DOM school keeps the count. The `dom` probe already runs on the same tab; the artifact records the tree's role counts next to its anchor, button and input counts, and a gap is recorded evidence (`semanticCoverage`), never a pass and never silently absent. Unnamed controls are asserted through surf selectors.
  - Perception: the vision school is excluded from this channel by name. `visible` is agent-browser's computed predicate, the contract says so, and screenshots stay in surf.
  - Coupling: the minimalist school dominates the lifecycle. Off by default; read-only argv allowlist; `a11y-snapshot.v1` and `a11y-assert.v1` are the contract and `channel` names a replaceable producer; a sunset condition retires agent-browser the day surf `page.read --json` or a direct CDP reader emits roles, names, landmarks and headings deterministically at the same schema. Direct CDP is the named fallback if agent-browser drifts.
  - Format: the economy school dominates the tester prompt input: `snapshot -i` text plus refs plus the coverage gap line, about 2 k tokens, nothing else.
- Why this path is justified: the six schools answer six different questions (what a control is, when a handle is valid, what exists, what is seen, what is worth a process, what fits a prompt). Each dominates its own question and loses the moment it claims another's. No single school covers all six, and a synthesis that pretended to would hide the gaps listed next.
- What remains unresolved: (1) the semantic blind spot on accessibility-poor applications is measured, not closed; the channel cannot name a control the browser cannot name. (2) `{role, name}` ambiguity on repeated names needs landmark scoping, and scoping needs tree structure the flat refs map does not carry; until a producer emits parent links, ambiguity is a typed `unverified`. (3) The perceptual gap stays open by design.

### PRACTICAL CONSEQUENCE

Taking the adjudication seriously changes this packet in six places, all applied above:
1. Ref validity is digest equality against a mandatory fresh snapshot; the event-based invalidator list is dropped. A reload that leaves the tree identical keeps a ref valid; a navigation that changes the tree does not. The dogfood step now expects `passed` after reload and `ref_context_drift` after navigating to the tags page.
2. The artifact gains `roleCounts` and `semanticCoverage` (DOM counts from the `dom` probe against tree counts); a gap is evidence of the blind spot and routes the tester prompt to surf selectors for unnamed controls.
3. `a11y-role` ambiguity is `unverified` with `role_name_missing` / `role_name_ambiguous` and candidates; no `nth`, no first match; `within` scoping is an open question tied to a structured producer.
4. `visible` is defined as a computed predicate; perceptual evidence is out of this channel by name.
5. The schema is the contract, agent-browser is a producer with a sunset condition, direct CDP is the named fallback; `channel` in every receipt makes a producer switch visible, and digests are producer-specific by design.
6. The receipt keeps both the snapshot text (digest input) and the refs map (parser-free source of `{role, name}`); the open question is closed.

Placement, gating, `--pin-tab`, target binding by `/json/list`, teardown order and the read-only verb allowlist survive the confrontation unchanged: they are the minimalist school's price for the observer, and the measurements show the price is real.
