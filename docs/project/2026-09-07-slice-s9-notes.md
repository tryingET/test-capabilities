---
summary: "Slice S9: the a11y snapshot observation channel. agent-browser becomes an Adapter with two transports behind one invoke, the channel becomes a read-only Session.observe step on the tab a surf run already owns, and `a11y-snapshot.v1` becomes the contract that outlives the tool - ref validity is digest equality and nothing else, cross-run identity is {role, name}, and the DOM's control counts sit beside the tree's so the channel's blind spot is measured on every page. Three commits, 563 -> 605 tests, coverage 96.35 -> 96.56 % lines. Records the live run (two runs one digest, the full ref round trip, the reload-identical case reproduced), the three places the packet's 2026-09-07 measurements no longer hold, the peer consultation on reporting a leak the observer itself causes, and what S10 must know."
read_when:
  - "You pick up slice S10, or any work on the a11y channel, and need the shape of A11ySnapshotArtifact, the observer handle, the argv allowlist or the digest rule."
  - "A run refuses with agent_browser_missing, cdp_endpoint_refused, tab_bind_ambiguous, empty_snapshot, origin_mismatch, ref_context_drift or a11y_channel_unavailable and you want to know which rule produced it."
  - "You need the S9 gate outputs, the measured sizes, the live dogfood evidence, or the deviations from the packet with their reasons."
type: "diary"
---

# Slice S9 notes (2026-09-08)

Plan: `docs/project/2026-09-07-surf-learnings-implementation-plan.md` §3 S9. Packets:
`2026-09-07-a11y-snapshot-channel-design.md` (primary; its
`## Refinement (many-of-the-greats)` and every `revised by …` line override the earlier text),
`2026-09-07-architecture-adjudication.md` Part 4 and claims 22, 28, and the S6, S7 and S8 slice
notes for the seams this slice fills.

Tree before the slice: `bd6b6a3` (end of S8), 563 tests / 562 pass / 1 skipped, coverage
96.35 % lines / 86.47 % branches / 98.14 % functions on floors 90.36 / 79.58 / 92.90 (Node
26.8.1, c8 12.0.0). The other session's uncommitted changes (`AGENTS.md`,
`docs/dev/EXTENSION_SOP.md`, `scripts/install-hooks.sh`, the deleted `scripts/docs-list.sh`, the
`docs:list` hunks in `package.json`) were never staged; `package.json` was not touched by this
slice at all, so the index-blob method of plan §5 was not needed. `git status --short` after the
last commit lists only those five foreign paths.

## Commits

| commit | subject | tests after | lines/branches/functions | changed lines |
|---|---|---|---|---|
| `d99a147` | feat(a11y): agent-browser Adapter with HTTP and spawn invokes, CDP probe, fake fixtures from captures | 591 (+28) | 96.48 / 86.26 / 98.25 | 98.52 % |
| `875f987` | feat(session): a11y snapshot observe step, artifact on disk, assertion evaluator, doctor check | 605 (+14) | 96.56 / 86.47 / 98.44 | 97.29 % |
| `eb83623` | docs(a11y): tester prompt input, decision matrix, CLI, config, errors, passport and the live run | 605 | 96.56 / 86.47 / 98.44 | n/a (docs) |
| (this note) | docs(diary): slice S9 notes | 605 | 96.56 / 86.47 / 98.44 | n/a (docs) |

Gates after every commit: `npm run check` (lint, typecheck, node tests, 4 cucumber scenarios,
structure, coverage ratchet, changed lines) green; `npm run loop-impact-plan` printed
`impact=wide` / `next=npm run loop-impact-wide`, and `LOOP_WIDE_REASON="slice S9 commit <n> …"
npm run loop-impact-wide` (= `release:check`: check, `truth:gate ok`, `consumer:smoke ok` on the
packed tarball) passed. Floors were not raised (S10 owns `coverage:raise`). The pre-existing
biome warning (`tests/fixtures/fake-surf.mjs`, unused `tab` parameter in `readinessGate`) is
still the only one; the three warnings this slice's own fixtures introduced were fixed before
commit (1) landed. No unreproduced gate failure this time — the Bombadil flake S6 and S8 both
recorded did not appear in any of the ten full runs.

Structure after the slice: 63 modules (60 before), 194 runtime edges (178), 0 cycles, 5
exceptions (4), pure ring 14 (13). New modules: `a11y-snapshot.ts` 669 (in `pure_ring`),
`a11y-snapshot-runtime.ts` 673, `a11y-snapshot-observer.ts` 521. Two ledgered growths:
`surf-explore-operation.ts` 976 → 1033 and `agents.ts` 695 → 706, the latter a *new* exception
(deviation 4).

## What changed in behaviour

**A browser run can now be observed twice, by two tools, without either owning the other.** surf
keeps the tab, the readiness gate and every action; agent-browser attaches to the same CDP target
and only reads. `surf explore --a11y-snapshot[=required]`, or
`agents.<name>.observation.a11ySnapshot`, registers a read-only observer on the session; it runs
after the probes and is torn down before `tab.close`.

**The schema is the contract and the tool is a producer.** `a11y-snapshot.v1` and
`a11y-assert.v1` live in `src/core/a11y-snapshot.ts`, in the pure ring, importing nothing that
knows what agent-browser is. `channel: "agent-browser-cdp"` names the producer in every receipt,
so the day a direct CDP reader emits the same fields the observer switches and no consumer
changes.

**Ref validity is content identity, and nothing else.** A ref is valid iff a fresh snapshot's
digest equals the digest that minted it. There is no event list, no action count, and no trust
in the producer's own staleness bookkeeping — it was measured re-resolving `@e28` after a reload,
and the defence against that is the mandatory fresh snapshot, not a rule about what invalidates
what. The live run has both halves of the packet's Clash 5 on the same page within a minute: a
reload that renumbered the refs drifted, and a reload that left the tree byte-identical passed.

**Cross-run identity is `{role, name}`, and ambiguity is typed.** The same `link "Releases"`
resolved to `e28`, then `e27`, then `e15` across a reload and a navigation where the ref died
each time. A pair that matches several controls is `role_name_ambiguous` with the candidate refs
listed — ten of them on the tags page — and never a first match.

**The blind spot is measured on every page.** `semanticCoverage` puts the `dom` probe's
`anchors`/`buttons`/`inputs` counts next to what the tree could name. On the releases page: 209
anchors against 95 links, 46 buttons against 24, 42 inputs against 1. Nothing fails because of
it; the tester prompt names the gap and routes those controls to surf selectors. A `dom` probe
that did not verify is `dom_probe_missing`, never three zeros.

**The channel cannot become an action channel by accident.** The argv allowlist is an allowlist:
`snapshot`, `get`, `is`, `tab` and `close`, with a closed flag set per verb. `open`, `click`,
`fill`, `type`, `eval`, `cookies`, `network route`, `screenshot`, `a11y`, `chat`, `--profile`,
`--auto-connect`, `--headed` and `close --all` are absent by construction rather than by a rule
that has to remember them, and the contract suite asserts both directions.

## Live dogfood (2026-09-08, Chromium (Agent), owned tabs, no logins)

Full transcript in `docs/project/2026-09-07-a11y-snapshot-live-run.md`. Chromium (Agent) was
started for this slice with `systemd-run --user --unit chromium-agent --collect
~/.local/bin/chromium-agent.sh` and stopped afterwards. `surf doctor --browser chromium --json`:
`ok: true`, 10 pass / 0 warn / 0 fail. surf 2.18.0, agent-browser 0.35.1, Chrome/152.0.7977.64.

`surf explore --url https://github.com/nicobailon/surf-cli/releases --a11y-snapshot=required
--json`, twice: exit 0, `userFlows 100`, digest
`sha256:82b7fb5ed1704dcf2367f2223ef9fa5957e6219b29838ce3511739013667decd` **identical across both
runs**, 205 refs, 8 232 bytes of tree text, role mix
`link 95, heading 58, button 24, region 10, cell 8, navigation 6, columnheader 2, listitem 1,
searchbox 1`, artifacts at 0600 under `~/.cache/tc-s9-dogfood/<runId>/`, and
`agent-browser session list` back to `default` only after each run.

Measured sizes:

| thing | bytes |
|---|---|
| artifact, `captured` (0600) | 25 324 (8 232 tree text + 10 453 refs map + metadata) |
| artifact, `unavailable` (0600) | 593 |
| `surf explore --json` envelope, channel on | 31 834 |
| the same envelope, channel off | 6 165 |
| one `observations[]` entry | 11 497 (1 034 without `refs`) |
| tester prompt input | 8 797 (~2.2 k tokens) |

Ref round trip, through the shipped adapter and evaluator: same digest → `passed`; after a
reload that changed the tree (205 → 204 refs) → `unverified ref_context_drift`; `a11y-role`
`link "Releases"` after that reload → `passed` at `@e27`; after `surf go …/tags` →
`ref_context_drift`; `a11y-role` `link "Releases"` on `/tags` → `passed` at `@e15`; `a11y-role`
`link " zip"` (repeats 10×) → `unverified role_name_ambiguous` with all ten candidates;
`link "No Such Link"` → `unverified role_name_missing`. Separately, on a settled page,
snapshots 2-4 across three reloads were byte-identical and a ref minted against snapshot 3
`passed` after the next reload — the packet's Clash 5 case, reproduced.

Coexistence: `surf extract` returned byte-identical rows before and after the a11y snapshot on
the same tab, `surf wait.ready` still settled `ready`, and the snapshot was unchanged after two
surf reads.

`explore` without the flag is byte-comparable to S8: no `runtime.a11yChannel`, no
`pages[].observations`, `effect {read_only, browser_session}`, `mutations: []`, and not one
agent-browser process or `/json/*` request (a contract case asserts the last two).

## Deviations from the packet and the plan, with reasons

1. **The producer's reply is wrapped, and the capture says so.** The packet lists the keys
   `lifecycle`, `origin`, `refs`, `snapshot`. In 0.35.1 they are inside agent-browser's own
   `{"success":true,"data":{…},"error":null}` envelope. The observer unwraps it (and reads
   `success: false` as `tab_lost` or `snapshot_failed` by the message), and the committed capture
   drops `lifecycle` because it carries a per-run launch hash a fixture must not reproduce.
2. **`tab_leak` fires on a healthy run, and that is the answer, not a bug.** Measured five times:
   a *new* agent-browser session creates one stray `about:blank` page target on its first
   command, pinned or not, whichever verb it is. The packet's 2026-09-07 note attributes the
   stray to an *unpinned* session outliving its tab; that is not what 0.35.1 does today. The
   channel reports it — `tabLeak: {"before":2,"after":3,"urls":["about:blank"]}` — as recorded
   evidence on a captured artifact, which is where the packet places stray-tab detection ("part
   of the page result"), and not as a refusal, which is where the packet's failure table does not
   place it. Peer consultation below.
3. **The pure module is a third file the plan does not name.** The plan owns
   `a11y-snapshot-runtime.ts` and `a11y-snapshot-observer.ts`. The artifact schema, the digest,
   the counts, the resolver and the evaluator went into `src/core/a11y-snapshot.ts` instead,
   which is in `pure_ring`: the packet's own producer-independence rule says the schema must not
   depend on the tool, and a module that imports `spawn-step.js` cannot claim that. The runtime
   module re-exports `evaluateA11yAssertion` and `resolveA11yAssertion`, so a consumer still has
   one import site — the S8 `frame-root-cause` / `frame-topology` split, applied again.
4. **`agents.ts` gets a new structure-budget exception, six lines over.** `SurfAgent` needs the
   agent's `observation` block to forward it to the nested explore: one import, one field, one
   constructor line and a three-line call, on a file that was already at 695 of a 700 budget. The
   alternative was to hand-mirror the mode union in that file to avoid importing it from
   `config.ts`, which is exactly the hand mirror operator decision D4 exists to remove. The
   ledger entry names the scheduled shrink (one file per agent, once the config-driven
   `readySelector` follow-up of S8 deviation 13 lands).
5. **`close` is on a "read-only" allowlist, and the packet's open question 1 is closed to get it
   there.** The packet left "does `agent-browser close` disconnect or close the browser?"
   untested on purpose. It was tested here, on a browser this slice had started: `close` on a
   session attached with `--cdp` ends the session, leaves the browser and every page running, and
   drops the session from `session list` within about two seconds. `session end` is not a verb.
   So `close` is the teardown verb, and it is classified `read_only` with scope
   `browser_session` — the same class surf's `tab.close` carries for the run's own tab — while
   `close --all` is refused by the flag allowlist.
6. **Sixteen error codes, not fifteen.** The plan says "the fifteen codes of P6". Two of the
   sixteen are additions the packet's rules imply without naming: `a11y_command_not_allowed` is
   the argv allowlist refusing a verb or flag (a rule with no code cannot refuse), and
   `a11y_check_unavailable` is an assertion expecting something this evaluation had no reader
   for, which must not pass silently. `dom_probe_missing` and `tab_leak` are deliberately *not*
   codes: they are recorded evidence on a captured artifact.
7. **The `dom` probe's counts arrive through a getter.** The observer is registered before the
   probes run — registration has to happen while the session is open and before `runObservers`,
   and the probes produce the counts in between. `domCounts: () => A11yDomProbeCounts |
   undefined` is read at observation time. A snapshot of the counts at registration would be
   `undefined` every time and would report `dom_probe_missing` on every page, which is the exact
   dishonesty the field exists to prevent.
8. **The observation is read from the observer's handle, not from `session.observations()`.** A
   `required` channel that refuses throws out of `runObservers`, and the session's own record of
   the failed observation carries the code but not the artifact path. `createA11ySnapshotObserver`
   therefore returns `{ observer, observation() }` and `explorePage` reads the handle on both the
   verified and the failed path: the refusal and the evidence are different facts and the page
   result carries both.
9. **A required refusal reaches the CLI as `a11y_channel_unavailable`, not `probe_unverified`.**
   `runObservers` throwing makes the page a `failedPage`, whose probes carry the error's code;
   the seed-probe refusal then re-raises with that code. The packet asks for "probe error
   `a11y_channel_unavailable`" and this is stronger than a generic refusal: the envelope names
   the channel and the message names which gate refused (`cdp_endpoint_unreachable`,
   `agent_browser_too_old`, …).
10. **The version floor treats "did not answer" as `agent_browser_missing`, not
    `agent_browser_too_old`.** A binary that exits non-zero on `--version` is not there in any
    usable sense; calling it "too old" would name a version nobody read. `agent_browser_too_old`
    is reserved for an answer that carries no version number, or one below `0.35.1`.
11. **The session name reaches the adapter through the environment.** `Adapter.resolve(env)` is
    the only member that sees configuration, so the observer passes an env overlay carrying
    `TEST_CAPABILITIES_AGENT_BROWSER_SESSION=<prefix>-<runId>` and the resolution holds it. A
    caller that sets nothing gets `<prefix>-<pid>` — never `default`, which belongs to whoever
    else is on the machine.
12. **`--a11y-snapshot` takes a bare flag.** Commander gives `true` for `--a11y-snapshot` with no
    value; `parseA11ySnapshotMode` reads `true` and `""` as `optional`, `off` as "no channel",
    and refuses anything else with `config_invalid` before a tab is opened.
13. **The evaluator's reads are injected.** `evaluateA11yAssertion(assertion, fresh, reader)`
    takes an `A11yCheckReader` with optional `visible`, `text` and `attr`. That keeps the
    evaluator pure and testable, and it makes "no reader" a *typed* outcome
    (`a11y_check_unavailable`) rather than a skipped check.

## Peer consultation

Question to `openai-codex/gpt-6-astra` (`pi -ne -nc -nt`, ~150 words): a new agent-browser
session always creates one stray `about:blank`, pinned or not, so the packet's "page count before
and after must match" now fires on every healthy run and names a stray the observer itself
caused. Report it every time (a), subtract the known one and report only the excess (b), or close
it (c) — which is right for a fail-closed system?

Answer, condensed: **(a), under the current spec.** "The page count changed, and the observer
caused a real leak. A healthy application run is not necessarily a compliant observation run.
Fail-closed means preserving that failure signal — not silently redefining success because the
failure is predictable." (b) "changes the acceptance rule" and "can also mask an unrelated leak
if the expected stray does not appear"; any exception "requires an explicitly approved
specification change, reliable target attribution, and retained evidence — not an undocumented
adjustment". (c) "violates the read-only allowlist. Cleanup does not retroactively make the
observation read-only, and a known leak does not authorize additional mutations."

**Adopted as implemented, with the residual tension recorded.** The implementation is (a): the
count and the leaked URLs are on the artifact, in the envelope and in the live-run doc, and
nothing is subtracted or closed. The peer's argument against (b) is the one this note keeps —
subtracting one by count would hide a *second* leak on a run where the expected stray did not
appear. Where the peer and the packet differ is weight: the peer would have the specified
mismatch carry more than evidence, and the packet places stray-tab detection in the page result
rather than in its failure table, so `tabLeak` does not change a verdict here. Turning it into
one is a packet amendment, not an implementation choice, and it is named as a follow-up below.
The advice is advice: it was adopted because it restates the packet's own axiom that a
predictable failure is still a failure, not because the peer said so.

One attempt, ~150 words, answered in about a minute — the S3 and S8 finding about prompt length
holds again.

## What S10 must know

- **`ARTIFACT_KINDS` gained `test-capabilities.a11y.snapshot`.** A run directory now holds
  mutation receipts, `frame-diagnosis-*.json` *and* `a11y-snapshot-*.json`. The S8 rule stands
  and now has a second reason: a test that counts receipts must filter on
  `artifact_kind === "test-capabilities.mutation.receipt"`, and a read-only suite that reaches
  either the diagnosis or the a11y observer must point `receipts.dir` at a throwaway directory.
- **The a11y contract is exported from `src/index.ts`.** The artifact and assertion types, the
  digest, `evaluateA11yAssertion`, `renderTesterPromptInput`, the adapter and the observer
  factory. `consumer:smoke` does not name them yet; S10's contract-sync remainder is where the
  `types.md` unions and the export list are checked, and this is the surface to add.
- **Two fixtures and one fake endpoint are new.** `tests/fixtures/fake-agent-browser.mjs` (fed by
  `tests/fixtures/captures/agent-browser/snapshot-releases.json`, with a fidelity test asserting
  the digest, the ref count and the byte count of the live capture),
  `tests/helpers/fake-agent-browser.mjs` (`createFakeAgentBrowser`, `startFakeCdpEndpoint`,
  `pageTarget`, `releasesCapture`). Both fake helpers now accept a **string** `log` so two fakes
  can write to one file, which is how the teardown order is proved.
- **`tests/spawn_boundary_contract.test.mjs` lists the modules that may start a process.** It is
  now four: the three adapters and `a11y-snapshot-runtime.ts`. A fifth entry there is a fifth
  place a process can be started from and must be an adapter.
- **`agents.ts` is over budget by six lines with a fresh exception.** If S10 raises floors it
  should also look at whether the four agent classes can be split; the exception's ledger entry
  names that as the shrink.
- **Two follow-ups this slice created, both named in the live-run doc:** (1) whether `tabLeak`
  should carry more than evidence, given that 0.35.1 makes it fire on every run — a P6 amendment,
  not an implementation choice; (2) `agents.<name>.readySelector`, still outstanding from S8
  deviation 13, is now the only reason the `test` orchestrator path cannot produce a
  `--ready-selector` failure; the `observation` block proved the config-to-agent seam works, so
  the follow-up is a one-line sibling.
- **Floors are still S8's.** The tree measures about six points above the lines floor, seven
  above branches and five and a half above functions; `coverage:raise` is S10's.
- Test count after S9: 605 (604 pass, 1 skipped); `npm run check` ~32 s, of which the coverage
  ratchet is ~23 s and the structure check ~6 s.
