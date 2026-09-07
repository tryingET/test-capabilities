---
summary: "Architecture review of test-capabilities as the code shows it today and of the six refined 2026-09-07 design packets (mutation safety, submit gate, frame root cause, quality ratchet, result classification, a11y snapshot channel) as one system: current layer map, the kernel objects the packets jointly imply, every duplication and conflict between them with a proposed single owner, a five-lens review with the review-rfc-multi checklist, the target architecture (kernel vs adapters, authority boundaries), transitional compatibility, a decision-grade verdict per packet and for the whole, numbered amendments for the implementer, and five decision questions for the operator."
read_when:
  - "You are about to implement any slice of the surf-learnings plan and need to know which packet owns a shared object (receipts, outcome basis, error codes, run context, fake-surf, observer steps) and which packet text was amended by this review."
  - "You want the 10,000 ft view of where authority sits in test-capabilities today and where the code contradicts the docs."
  - "You are the operator deciding the five open questions at the end (Bombadil under the origin allowlist, SurfClient as public API, one process runner, breaking the import cycle, the framework error envelope)."
type: "review"
---

# Architecture review: current system and the six surf-learnings packets (2026-09-07)

Method: `~/.pi/agent/prompts/review-rfc-multi.md` with five non-overlapping lenses instead of three, System4D lite. Inputs: the assessment, the six packets (their `## Refinement` sections and `revised by refinement:` decisions override earlier text), vision, product posture, framework doc, `docs/api/types.md`, `AGENTS.md`, `governance/`, and the code named below. The implementation plan (`docs/project/2026-09-07-surf-learnings-implementation-plan.md`) is being written in parallel; where its §2 ownership table already agrees with a finding here that is noted, nothing here depends on it. Packet references: P1 mutation safety, P2 submit gate, P3 frame root cause, P4 quality ratchet, P5 result classification, P6 a11y snapshot channel; `§` cites a packet section.

## 1. Current architecture map

```
 bin/test-capabilities (commander, 11 commands)        library: src/index.ts (executeCliOperation, SurfClient,
        │ assertSupportedCliCommand (capabilities.ts)   SurfFlowBuilder, TestFileHealer, PredictionEngine, QuantumSimulator)
        ▼                                                          │
 ┌─ operation kernel ─────────────────────────────────────────────▼──────────────────────────────┐
 │ dispatch-manifest (CLI_ROUTE_MANIFEST, CLI_OPERATION_REGISTRY) → dispatch-execution            │
 │ executeCliOperation: manifest → zod parse → execute   (no run id, no effect class, no receipt)  │
 │ operations: test | doctor | demo | init | surf.explore | quantum | heal | replacement-validation │
 └──────┬──────────────────────┬───────────────────────────┬──────────────────────┬────────────────┘
        │ test                 │ surf.explore              │ heal                 │ quantum
        ▼                      ▼                           ▼                      ▼
 ┌─ orchestrator.ts 2293 ─┐  ┌─ surf-explore-operation ─┐ ┌─ healing/ ────────┐ ┌─ quantum/simulator (seeded,
 │ config zod (strict)    │  │ tab.new → wait.ready →   │ │ TestFileHealer     │ │ no target contact) ────────┐
 │ agents: cli-tester,    │  │ js probes → extract →    │ │ regex evidence     │ └────────────────────────────┘
 │ surf, bombadil,        │  │ tab.close (owned tab)    │ │ prefix heuristic   │ ┌─ prediction/engine (library
 │ terminal-fuzzer        │  └────────┬─────────────────┘ │ temp+rename write  │ │ only; orchestrator has its own
 │ Finding/Observation    │           │ runSurfCommand      └───────────────────┘ │ severity-table "prediction") ┘
 │ regex root-cause class │           │ (spawnSync)                                └────────────────────────────
 │ correlation/propagation│           ▼
 │ SurfAgent → executeSurfExploreOperation (re-enters the kernel op directly, not via dispatch)
 │ BombadilAgent → bombadil-runtime.runBombadil (spawn, own Chrome, --exit-on-violation)
 │ CliTesterAgent → private runCommand (spawn + kill tree)      TerminalFuzzer → runBombadilTerminalTest
 └────────────────────────┘
 adapters: surf-runtime.ts (resolve → probe → translateSurfArgs allowlist → runSurfCommand)  integrations/surf-client.ts (own async spawn)
 governance: capabilities.ts CAPABILITY_MATRIX ← passport generator ← truth:gate (release only) ; work-items.json = AK projection
```

Layers and their real boundaries (as the code shows them):

- Kernel: `src/core/operations/types.ts:345-355` defines `OperationDefinition {id, route, description, inputSchema, execute}`; `dispatch-execution.ts:94-102` parses and runs. There is no run identity, no effect class, no receipt, no typed error; the only error contract is `renderUnsupported` returning `Error(message)` (`runtime-contract.ts:1-5`). Envelopes are typed per operation (`types.ts:129-333`).
- Orchestrator: `orchestrator.ts` owns the config schema (`:44-176`, `.strict()`), the `Finding`/`Observation` vocabulary (`:245-313`), agent execution `Promise.all` (`:581-590`), root-cause classification by regex over concatenated text (`:1139-1254`), and `passed = !blocking && coverage.overall > 0` (`:634`). Agents decide pass/fail from a different signal each: exit code (`:2161`), Bombadil status (`:1940-1945`, `:2025-2028`), explore envelope (`:2096`).
- Adapters: surf has two spawn paths, `runSurfCommand` (`surf-runtime.ts:341-389`, sync, returns `ok` on exit 0) used by explore, and `SurfClient.run` (`surf-client.ts:791-847`, async, `success: true` on exit 0) used by the library; they share `parseSurfErrorOutput` (`:303-339`) but nothing else. Bombadil (`bombadil-runtime.ts:385-`) and the CLI tester (`orchestrator.ts:2206-2290`) and `command-runner-core.ts:16-41` are three more process runners. Five runners, five result shapes.
- Healing: `self-healing.ts` mines selectors from evidence text by regex (`:687-718`), validates by prefix heuristic (`:600-604`), writes all-then-restore (`:440-479`); the operation counts `appliedCount = proposals.length` before proof (`heal-operation.ts:519`) and requires `--checkpoint-ref` only when proposals exist (`:502-506`). Dry-run artifacts (`test-capabilities.heal.proposal|verification`) are the only durable receipts in the system (`:304-330`), written through the only atomic writer (`:108-136`).
- Prediction/quantum: `quantum` is a kernel operation over a seeded in-memory simulator (`quantum-operation.ts:41-45`, seed 42) with no target contact; `PredictionEngine` is exported but unused by the orchestrator, whose `runPrediction` is a severity lookup table (`orchestrator.ts:885-910`) behind a config flag the capability contract refuses (`capabilities.ts:19`, `:114-127`). Dead-but-present code, correctly labelled "future" in posture.
- Governance and gates: `CAPABILITY_MATRIX` (`capabilities.ts:13-51`) is the runtime authority on support; the passport is generated from it plus hand-listed evidence (`generate-capability-passport.mjs:57-136`) and byte-checked only in `truth:gate` (`capability-truth-gate.mjs:1049-1057`), not in `npm run check` (`quality-gate.sh:108-125`). `work-items.json` is a projection; AK is the task authority (`work-items.cue:5-6`, `AGENTS.md`).

Data that flows: config (YAML → strict zod → `TestCapabilitiesConfig`), per-agent `AgentResult {findings, coverage, observations?}` → `TestResult` → `TestOperationResultEnvelope` (`test --json`), `Finding.evidence: string[]` with the text marker `failureClass:<class>` (`docs/api/types.md:417`) → healer regex, heal proposal artifacts → `--proposal-input` apply, passport ← matrix. Authority today: support state in `capabilities.ts`; pass/fail in `orchestrator.run`; mutation authority nowhere (any library caller can `SurfClient.type(..., {submit: true})`, `surf-client.ts:290-301`).

Where the code contradicts the docs:

| claim | doc | code |
|---|---|---|
| `surf explore` accepts only `--url` | `docs/api/errors.md:73-80` | `--depth` implemented (`support.ts:22-30`, `docs/api/cli.md:170`) |
| `CliRoute` / `CliOperationResult` unions | `docs/api/types.md:22-33`, `:50-58` omit `replacement-validation` | `types.ts:29-40`, `:322-333` include it (P4 contract-sync would catch this class of drift) |
| healing retries strategies, `max_attempts: 3` | `docs/TEST-CAPABILITIES-FRAMEWORK.md:142-146`, `:205-213` | no retry exists; P1 forbids exactly this loop; the doc's own header (`:13`) calls itself mixed, but the example is the anti-pattern the packets outlaw |
| `SurfClient.read()` parses `[ref=eN]` | `docs/api/types.md` `SurfSnapshot` | branch surf prints `[eN]`; parser yields zero elements, untested (`surf-client.ts:249`, P6 §Problem) |
| "self-healing creates PRs" (vision `:341-379`) | vision | shipped healer is a local prefix heuristic; posture says so (`product-posture.md:793`) |
| import graph is a layered kernel | posture "kernel as bottleneck" (`:790`) | one runtime cycle `capabilities → operations → dispatch → demo → orchestrator → capabilities` (P4 §Problem); `SurfAgent` re-enters a kernel op directly (`orchestrator.ts:2096`) |

## 2. The six packets as one system

```
                    operator config (allowOrigins, receipts.dir, agents.<n>.expect / .observation)
                                                │
 executeCliOperation ── RunContext{runId, ledger} ── effect class resolved (P1) ── execute
        │
        ├─ surf.explore ─ owned tab ─ wait.ready ─ probes ─┬─ frame.diagnose on element_unreachable (P3)
        │                                                   ├─ a11y snapshot observer (P6, read-only, CDP)
        │                                                   └─ links extract --retry 1 (P1 revocable)
        ├─ surf.plan (P2, read-only) ─ plan artifact + approval_token
        ├─ surf.apply (P2, mutating) ─ SurfApplyRunner ─ receipt attempting (P1) ─ click once ─ verify
        ├─ heal ─ basis:fault findings only (P5) ─ frame determination (P3) ─ precondition write + receipt (P1)
        └─ test ─ agents ─ every process result → classifyResult (P5) → ResultOutcome → Finding.outcome
                                                                    └→ inferRootCauseClass (P3 marker first)
 gates: scripts/quality-gate.sh + coverage/structure ledgers (P4) ; passport byte-identity in npm run check (P4)
```

Shared kernel objects the packets jointly imply, and whether they define them consistently:

| object | P1 | P2 | P3 | P4 | P5 | P6 | consistent? |
|---|---|---|---|---|---|---|---|
| effect class | `EffectDeclaration {effect, scope, reason}` on operations, agents, SurfClient commands (§Contract) | `surf.plan` read-only, `surf.apply` mutating, `mutation: external`, `operator_only` (§2, §5) | `frame.diagnose` "read-only" assumed; `frame.switch` unclassified (§Open q5) | n/a | n/a | "read-only argv allowlist" (§Contract) | yes in spirit; only P1 has a type; P2's `mutation: external` and `operator_only` are manifest fields P1 never defines |
| typed outcome with basis | `MutationOutcome attempting/applied/failed/unknown` | receipt `ok/refused/attempting/failed/unknown` (§4.2) | `FrameDetermination` 5 values | n/a | `ResultOutcome {class, ok, basis}` | assertion `passed/failed/unverified`, channel `captured/unavailable` | different axes (act, cause, evidence, evaluation), fine; P2's vocabulary collides with P1's (`ok` vs `applied`, `refused` is not an attempt); P1 `unknown` has no home in P5 `basis` |
| durable receipt with intent | `test-capabilities.mutation.receipt` in `receipts.dir/<run>/<id>.json`, fsync before act; envelope copy; `--receipt-output` aggregate | `test-capabilities.surf.receipt`, `surf.receipts.dir`, per-`plan_id` block (§4.2, D5); D6 yields to P1 | none (evidence on the probe) | ledgers in JSON files | none | "receipt file next to the run when `--record`/receipts land" | no: two receipt kinds, two dirs (P1 says P2's folds in, P2 still specifies its own), plus heal proposal/verification artifacts and P6 artifacts with no shared writer |
| observation/evidence artifacts | `receipt.evidence: string[]` | `surf_calls[]` | `FrameRootCause` typed, plus marker line | n/a | `outcome:<class>:<code>` + `basis:` as first evidence lines | `a11y-snapshot.v1` typed | three text-marker grammars in `evidence[]` (`failureClass:`, `outcome:`, `frame-root-cause: k=v`) next to typed fields; P3 says its marker is "the only line parsed", P5 says its line is first |
| determination gates | `verify` promotes `unknown`→`applied` only | four ordered refusals (§4.2) | permission table per consumer | ledger entry rule | `unclassifiable` terminal | `unverified` never pass/fail | consistent pattern: closed enum, unknown first-class, nothing downstream reinterprets |
| error-code registry | 10 codes | 16 codes | 4 codes | n/a | `RESULT_OUTCOME_CODES`, `RESULT_RECORDED_SIGNALS` exported + tested | 15 codes | no carrier defined for framework codes (exception class? `[code]` suffix? JSON envelope?); only surf codes have a type today (`SurfCommandError.code`) |
| declared expectations | `verify`, `precondition`, `idempotencyKey` | `approval_token`, `--until-*`, allowlist | `--frame-hint`, `--ready-selector` | n/a | `expect {output, empty_marker, payload, error_envelope}` + `declaredBy` provenance | `a11y-assert.v1`, `observation.a11ySnapshot: off/optional/required` | five shapes, three places (config, flag, code); only P5 has provenance (`declaredBy`); "required" means two different things (P5 default, P6 fail-page) |

Duplications and conflicts, with the proposed single owner and shape:

1. Receipts (P1 §Contract, §Interaction; P2 §4.2, D5, D6; P6 §Contract; heal artifacts `heal-operation.ts:304-330`). Owner: P1. Shape: one `test-capabilities.mutation.receipt` v1; P2's `fields[]`, `submit{}`, `surf_calls[]` become `details`; `plan_id` becomes `subject` metadata (`details.plan_id`); `surf.receipts.dir` is deleted from P2; `outcome` uses P1's four values (`ok`→`applied`; `refused` is not a receipt because nothing was attempted: refusals are envelope errors). All artifact writes (receipts, plan, heal proposal/verification, a11y snapshot, frame captures) go through one `src/core/artifacts.ts` lifted from `heal-operation.ts:108-136`, with kind, schema version, mode 0600, symlink refusals.
2. `submit_already_attempted` defect (P2 §4.2 rule 3): "no receipt for `plan_id` exists, whatever its outcome". Fill mode also writes "one file per apply attempt" (§4.2 Receipt), so the intended workflow fill → review → submit on the same plan is refused by its own dry run. Owner: P2. Fix: the query is `listReceipts({planId, mode: "submit"})`; fill receipts never block.
3. `SurfFlowBuilder` (P1 §Current state, §Behaviour "execute runs through a ledger", verification item 3 uses a `type` step; P2 D8 removes `click`/`type`). Owner: P2 (later refinement, builds on P1). P1's builder claims and test are withdrawn; the builder is deleted outright (its remaining `goto`/`wait`/`screenshot` steps have no test value and `goto` is mutating/target under P1's own map).
4. `unknown` vs `basis` (P1 §Contract table; P5 §Contract `OutcomeBasis`). A timed-out mutating step is P5 `timeout`/`fault` and P1 `unknown`; a finding rendered from it would claim a target fault where the truth is "we do not know". Owner: P5 adds `basis: "indeterminate"` (transport failed, no signal from the target); P1's ledger sets it on mutating steps; the healer and report treat it like `contradiction` (nothing to heal, not a target bug).
5. Run identity (P1 §Open questions; P6 `--session <prefix>-<runId>`; P2 `plan_id`, `receipt_id`). Nobody mints `run_id`. Owner: kernel. `executeCliOperation` mints a `RunContext {runId, receiptsDir, ledger, config}` and passes it to `execute`; `SurfAgent` must call the explore operation with the orchestrator's context instead of re-entering `executeSurfExploreOperation` (`orchestrator.ts:2096`), so nested operations share one run and one ledger.
6. Error-code carrier (P1 error list; P2 §2 "in the branch's `[code]` shape"; P3 "framework side, `[code]` suffix like surf"; P5 `ResultOutcome.code`; P6 typed reasons). Owner: P5 (registry) plus the kernel (carrier). Shape: `src/core/error-codes.ts` with namespaced `as const` arrays and a uniqueness test (the plan's §2 already says this); one `FrameworkError extends Error {code, details}` in `runtime-contract.ts`; CLI text mode prints `[code]` suffix, `--json` prints `{"error": {code, message, details}}` (the shape P5 already parses from surf) and exit 1 as today (`docs/api/errors.md:14-19`).
7. Spawn paths (P1 refinement Mode 3 "runStep is the only path to an effect"; P5 §Placement lists five call sites). Five runners exist today (§1). "Only path" is unenforceable with two surf spawners and three ad-hoc ones. Owner: P5 defines `RawResult` and one `spawnStep(source, argv, {timeoutMs, env})` in the kernel; P1's `runStep` wraps it; `SurfClient.run`, `runSurfCommand`, `command-runner-core.runCommand`, `CliTesterAgent.runCommand` and `runBombadil` become callers of it.
8. Observer hooks vs the kernel (P3 §Behaviour "inside explore's try before tab.close"; P6 §Placement "observer hook between the probes and closeOwnedTab"; P2 §4.3 runner). Three ways to add browser behaviour are proposed: kernel operation, in-operation hook, library client. Owner: the surf adapter. Shape: an owned-tab `BrowserSession` (open, gate, run step, register read-only observer steps, close in `finally`) in `src/core/surf-runtime.ts` or a sibling; explore, plan, apply and both observers are step lists over it; every step is a P1 `EffectStep` and yields a P5 `ResultOutcome`, so observers get the attempt log, the class map and the outcome without special casing.
9. Fake-surf fixture (P1 verification 3, P2 §9, P3 verification, P5 verification 3 all grow `tests/fixtures/fake-surf.mjs`; P6 adds `fake-agent-browser` and a fake CDP endpoint). Owner: the surf adapter's test suite; the fixture's source of truth becomes a captured-shape corpus under `tests/fixtures/captures/` (P3 already commits three `frame.diagnose` captures; P6 measured `snapshot -i --json`; the live-run doc has `wait.ready`/`extract` shapes). Env knobs are namespaced `FAKE_SURF_*` and listed in the header; the page model gains `frames`, `fields`, `controls`, `changeNavigatesTo` in one schema bump rather than four ad-hoc additions.
10. Evidence markers (existing `failureClass:`; P5 `outcome:`/`basis:` first lines; P3 `frame-root-cause: k=v`). Owner: the orchestrator types. Typed fields are authoritative (`Finding.outcome?`, `Finding.frameRootCause?`, `TestResult.mutations?`, `pages[].observations?`); text lines are rendered from them in one `key:value` grammar for legacy readers; parsers read the typed field first and fall back to text only for legacy envelopes.
11. Config keys (P1 `receipts.dir`; P2 `surf.submit.*`; P5 `agents.<n>.expect`; P6 `agents.<n>.observation`). The schema is `.strict()` (`orchestrator.ts:167-176`) and mirrored in `capabilities.ts:79-89`, `docs/api/config.md`, the `init` template and `demo` config. Owner: orchestrator config; every key optional with a fail-closed default; the allowlist is named for what it gates (see Q1).
12. Receipt content vs secrets (P1 §Risks "receipts carry subject, hashes, error codes, not page text"; P2 §5 plan and receipt files hold intended values, mode 0600; P6 receipt holds 8 KB page text). Owner: the artifact store. Rule: files under `receipts.dir` are 0600 and may carry values and text; the envelope copy (`mutations[]`, `test --json`) carries hashes, codes and refs only.
13. Public API break (P2 D8 removes `type({submit})` and builder steps; P1 changes `evaluate(code)` to require `{effect, reason}`; P5 changes `SurfActionResult` semantics). Passport row `library:SurfClient library_only verified`. One bump 0.3.0 → 0.4.0 with `consumer:smoke` proof; `prompts/web-tester.md` and `docs/api/api-surf.md` updated in the same commit.

## 3. Five-lens review

### Lens 1: core semantics and contracts

- Sees: the packets converge on one semantic rule the code lacks, "a third state exists and it is never a pass, never retried, never reinterpreted" (P1 `unknown`, P3 `undetermined`/`unavailable`, P5 `empty`/`unclassifiable`, P6 `unverified`). The kernel object that carries it is `ResultOutcome.basis` (P5). Strength: P5's refinement scoped interpretation to owned shapes and made stderr a channel; P3's split of topology/determination/permission is the cleanest contract in the set.
- Evidence: `orchestrator.ts:634`, `:1940-1945`, `:2161` (pass from absence of failure); `surf-runtime.ts:388` and `surf-client.ts:809-816` (exit 0 = ok); `self-healing.ts:511-523` (content-only replay guard).
- Concerns: items 2, 3, 4, 5, 10 above; P1's "`test` resolves to the worst class of its enabled agents" is decided from config before any run, fine, but P1 never says what `test`'s receipt subject is when Bombadil is one mutating step (subject = origin, intent = "bounded fuzz"; state it). P2's `approval_token` is "sha256 over canonical JSON" (§4.1) without naming the canonicalisation; two implementations will hash differently.
- Required: amendments A1-A7, A12.
- Evidence quality: strong; every claim above is a line in the tree.

### Lens 2: runtime authority and platform boundary

- Sees: authority is meant to sit in three places, operator config (allowlist, `receipts.dir`), the kernel (effect class, ledger), and the construction of the apply runner (P2 D8), with LLM testers subordinate (P5 refinement). Strength: P2's hazard ownership table is the best authority argument in the set; P6's "observer, not flavor, not agent" is right.
- Evidence: `index.ts:44-58` exports `executeCliOperation`; `surf-client.ts:290-301`, `:623-626` (ambient authority); `bombadil-runtime.ts:394-403` (`--exit-on-violation --headless <origin>`: Bombadil launches its own Chrome and clicks anything on `targets.web`); `capabilities.ts:13-27` (matrix is the support authority).
- Concerns: (a) P2 §5 "submit mode is operator-invoked only, unreachable from the orchestrator" is a claim about the CLI; the kernel is a public library, and a Pi extension calling `executeCliOperation({command:"surf",action:"apply"}, {submit:true, confirmPlan})` is reachable. The real boundary is the operator-owned allowlist; the packet must say that `operator_only` is documentation of intent, not a control. (b) The allowlist gates only `surf apply --submit`; Bombadil is classed mutating/target by P1 and runs against `targets.web` with no allowlist, no owned-tab rule (own Chrome), no per-click receipt. Under the packets' own logic that is the "Set bid" class at fuzzer scale on any origin the config names. Decision question Q1. (c) Three resolution ladders (surf `surf-runtime.ts:163-213`; bombadil `bombadil-runtime.ts:136-`; agent-browser P6 §Contract) and two version-probe styles; an adapter template (`resolve → probe → translate allowlist → class map → fixture`) should be stated once so the future http adapter follows it. (d) `SurfAgent` bypassing dispatch (`orchestrator.ts:2096`) means kernel-level authority (effect resolution, run context) is skipped for the one path most runs take.
- Required: A5, A8, A13, A14; Q1, Q2.
- Evidence quality: strong for (a), (b), (d); (c) is a design judgement.

### Lens 3: safety, evidence and governance

- Sees: durable intent before act (P1 refinement), receipts as the audit trail, interlock reset as a recorded human act, coverage/structure ledgers (P4) and the passport as governance artifacts. Strength: P1's four interlock properties (durable, specific, resolvable, resettable) and P4's "ratchet is a memory, not a target" are exactly right for a repo whose authors are mostly models.
- Evidence: `heal-operation.ts:108-136` (only atomic writer, no fsync); `:519`; `capability-truth-gate.mjs:1049-1057` (passport check release-only); `quality-gate.sh:108-125`; `work-items.cue:5-6`.
- Concerns: (a) `writeJsonArtifactAtomically` does not `fsync` the file or the directory; P1's "fsync'd before `run`" needs a new writer, and P2 says "temp file, fsync, rename" separately: one writer (item 1). (b) Item 12: three packets disagree on whether receipts carry values/text. (c) P4's `reductions[].ref` requires an AK ref; consistent with `AGENTS.md`, but the truth gate's AK direction assertions (`capability-truth-gate.mjs:56-91`) only run with `TEST_CAPABILITIES_REQUIRE_AK_DIRECTION=1`; the ledger check must not inherit that optionality (a missing ref fails, an unresolvable ref warns). (d) P3 adds `frame_boundary` and the words "confirmed"/"root cause"; `assertCurrentSurfaceAvoidsCausalityOverclaim` (`capability-truth-gate.mjs:192-209`) greps README/posture/passport for overclaim wording and must be re-read against the new text before S8. (e) `receipts.dir` deletion resets interlocks (P1 §Risks) and `doctor` reports the in-doubt count; that is adequate for a single workstation, and a shared CI runner with a per-job workspace has no interlock at all: the packet must say the interlock is per `receipts.dir`, and CI must point it at a persistent path or accept that CI runs are not interlocked.
- Required: A1, A9, A10, A15.
- Evidence quality: strong.

### Lens 4: operator and agent ergonomics

- Sees: five new refusal families, four new config keys, seven new flags (`--field`, `--submit --confirm-plan`, `--until-*`, `--supersede-receipt`, `--receipt-output`, `--frame-hint`, `--ready-selector`, `--a11y-snapshot`), one new artifact the operator reviews (the plan), and `doctor` as the place to see in-doubt receipts, agent-browser and CDP. Strength: dry-run defaults everywhere; every refusal names its fix (P4 rule, P5 `empty` finding naming both resolutions).
- Evidence: `bin/test-capabilities:105-493` (commander per command, hand-mirrored manifest); `docs/api/errors.md:14-19` (exit 0/1 only); `errors.md:73-80` already stale.
- Concerns: (a) Without a framework `--json` error envelope (item 6), agents parsing `test-capabilities ... --json` get JSON on success and prose on failure; P1 adds receipt lines before the error, which makes the prose harder to parse, not easier. (b) `expect.output: empty` will be needed by every quiet CLI target on the day S4 lands; the finding text must name the key verbatim (P5 does) and `init` should offer it as a commented line. (c) `--confirm-plan <sha256>` is a 71-character token; `surf plan` prints it (P2 §4.1) so the operator copies it; acceptable, but the summary line must be the only line on stdout in text mode or the copy is error-prone. (d) `unknown` outcomes lock a key until `--supersede-receipt`; the message must print the exact command to inspect and the exact supersede invocation, or the shell `until` loop P1's School 7 predicts arrives anyway. (e) P6's page result carries ~18 KB per page; `test --json` at depth 3 with ten pages grows by ~180 KB when the flag is on; put the text in the artifact file and the digest, refs and counts in the envelope.
- Required: A6, A11, A16.
- Evidence quality: adequate; (c)-(e) are judgement calls stated as such.

### Lens 5: verification, testability and evolution

- Sees: `npm test` never touches a browser (fake-surf, commit `ab34937`); live truth lives in dogfood docs and the passport; P4 measures the fixture corpus and says so. Strength: P3 commits real captures as fixtures; P2 demands a type-level `never` test on the runner; P5 demands "no fixture reaches `ok: true` without payload or declaration".
- Evidence: P4 §Problem (three never-loaded modules, five oversized files, one cycle); `tests/` (27 files, all contract-style); `orchestrator.ts` 2293 lines edited by S4, S5, S7, S8, S9 in the plan.
- Concerns: (a) Fixture fidelity is the single largest verification risk: five packets teach the fake new verbs from prose, not from captures (item 9). (b) Freezing the cycle in `structure-budget.json` (P4 decision log) locks in the thing the ratchet exists to prevent; the cycle is cheap to break (a leaf `capability-matrix.ts` holding the agent/intelligence statics that `orchestrator.ts` imports, leaving `capabilities.ts` to compute CLI statuses), and doing it before S2 lets the budget start with `allowed_cycles: []`. Q4. (c) `orchestrator.ts` receives edits from five slices; extracting the four agent classes to `src/core/agents/*.ts` before S4 shrinks the frozen exception instead of growing it and gives P5's per-agent classification a file each. (d) The http adapter (api-fuzzer) is "written before the agent exists" in P5 only; P1's class map for http (GET/HEAD read-only, else mutating), P2's non-applicability, and the fixture server precedent (`scripts/capability-fixture-server.mjs`) should be reserved as one row in the adapter template now, or the sixth adapter will be designed by accretion again. (e) Contract-sync (P4) checks commander vs manifest vs `docs/api/cli.md`; the drift found in §1 (`types.md` route union) is one line away and cheap to include.
- Required: A17-A20; Q3, Q4.
- Evidence quality: strong for (a)-(c); (d) is forward-looking.

### review-rfc-multi checklist

| item | status | note |
|---|---|---|
| problem framing is evidence-backed | yes | every packet cites file:line and a measured incident; P4 measured the tree |
| options are fairly represented | yes | the refinements adjudicate six to seven schools each; P6 seriously weighed "no second tool" |
| preferred direction is explicit | yes | each packet has a decision log; the combined direction is only implicit (this review makes it explicit) |
| stable core vs adapter boundary is clear | partial | P6 draws it for agent-browser; P1/P5 do not say which of the five runners is core; §4 fixes |
| contracts/interfaces are specific enough to test | partial | P5, P3, P6 yes; P1 receipt file layout and query, P2 canonical JSON, run id, error carrier are not |
| migration and rollback are realistic | partial | additive envelopes and optional keys are right; the S6 API removal and the `empty` default flip are the two behaviour changes that need a named release note |
| docs/template claims match expected rendered behaviour | partial | `errors.md`, `types.md` and the framework doc already drift (§1); P4 contract-sync covers CLI/manifest only |
| validation relies on executable checks | yes | contract tests, corpora, `consumer:smoke`, fixture proofs; live runs recorded, not gating |
| open questions are real decision questions | partial | P1 Q2 (`scroll.*`), P2 Q6 (upstream naming), P3 Q3/Q4 are settleable by the author; the five in §6 are the operator's |
| recommendation is actionable | yes | numbered amendments in §5 |

System4D lite: boundary = the framework's own process and workspace versus targets it does not own (browser origins, CLI binaries) and processes it does not control (surf, Bombadil, agent-browser); primary driver = "a test run must never cause an effect the operator did not declare and must never report evidence it did not obtain"; critical invariants = effect declared before spawn, intent durable before act, `ok` only from payload or declaration, third states never pass; main risks = the fake drifting from the binaries, and authority claimed in prose (`operator_only`) rather than in config or construction.

## 4. Target architecture

Kernel objects (all in `src/core/`, none importing an adapter):

- `RunContext {runId, startedAt, config, receiptsDir, ledger}` minted by `executeCliOperation` and threaded through every `execute`; nested operations receive it.
- `EffectDeclaration`, `EffectStep`, `MutationLedger`, `MutationReceipt` (P1 `effects.ts`); `runStep` is the sole caller of `spawnStep`.
- `RawResult`, `classifyResult`, `ResultOutcome {class, ok, basis(+indeterminate), code, transport, payload, recorded}` (P5 `result-classification.ts`); `TRANSIENT_CODES` lives here.
- `Expectation` with `declaredBy` provenance (`config:` | `cli:` | `operation:` | `protocol:`), used by P5 `expect`, P1 `verify`/`precondition`, P2 `--until-*`, P3 `frameHint`, P6 assertions; one grammar, one echo field in the outcome.
- `FrameworkError {code, details}` + `error-codes.ts` registry with namespaced arrays and a uniqueness test.
- `artifacts.ts`: atomic + fsync writer, kinds (`mutation.receipt`, `heal.proposal`, `heal.verification`, `surf.plan`, `a11y-snapshot`, `frame-diagnosis`), 0600, symlink refusals, `list(kind, filter)`.
- Determination gates as a pattern: closed enum, unknown first-class, permission table per consumer (P3 is the reference implementation).
- Typed evidence on `Finding`/`Observation`/probe/page (`outcome`, `frameRootCause`, `mutations`, `observations`); text markers derived.

Module map: `src/core/kernel/` (types, dispatch, run-context, effects, result-classification, expectations, error-codes, artifacts); `src/core/adapters/{surf,bombadil,agent-browser,http}/` each with `resolve`, `probe`, `translate` (argv allowlist), `effects` (command → class map), `normalize` (→ `RawResult`), and its fake in `tests/fixtures/<adapter>/` fed by `tests/fixtures/captures/`; `src/core/browser-session.ts` (owned tab lifecycle over the surf adapter, observer steps); `src/core/operations/` (compositions only: explore, plan, apply, heal, test, doctor, demo, init, quantum, replacement-validation); `src/core/diagnosis/` (root-cause, frame-root-cause, correlation, propagation); `src/core/agents/` (the four sensors, out of `orchestrator.ts`); `src/healing/` (consumer of outcome, determination and ledger); `src/prediction/`, `src/quantum/` unchanged, library-only, declared `read_only`.

Stable core vs adapters: the kernel objects and operations are the core; surf (action channel), agent-browser (observation channel), Bombadil (fuzzer, one mutating step, own browser), http (future, inherits `source: "http"`, GET/HEAD read-only) are adapters. Nothing in an adapter decides pass/fail, effect class or permission; adapters translate, spawn through `spawnStep`, and return `RawResult`.

Authority boundaries: operator config owns the world (`allowOrigins`, `receipts.dir`, `expect`, `observation`); the kernel owns effect resolution, the ledger, the outcome and the run; runner construction owns the addressable set (P2); external authority owns checkpoint/restore (`docs/project/2026-04-30-recovery-backed-repair-readiness.md`) and tasks (AK); LLM testers are monotone over the outcome (P5). "Operator-only" is not an authority; reachability through the library is assumed.

What stays out: surf upstream `form.plan`/`form.apply` (P2 D7); the in-frame positive probe (P3 Q5); `within` landmark scoping and a structured a11y producer (P6); Pi's typed tool and site verbs (assessment rows 8-9); a cross-run receipt index; per-click Bombadil receipts; prediction and collective promotion; a checkpoint store.

Transitional compatibility: `test --json` stays parseable (fields additive: `outcome`, `outcomes`, `bases`, `mutations`, `observations`, `effect`); heal proposal/verification artifacts v1 unchanged, `--findings-input` accepts legacy findings with `legacy_evidence`; `CliRoute`/manifest gain `surf plan|apply` (passport regenerated in the same commit or `truth:gate` fails); config keys optional with fail-closed defaults so `init`, `demo` and every existing `cli-tester` config keep working; two behaviour changes need a release note, the `empty` default (quiet targets fail until `expect.output: empty`) and the `SurfClient` removals (0.4.0); old receipts do not exist, so no receipt migration; `docs/api/errors.md` and `types.md` corrected in the slice that introduces the envelope.

Migration principles (the plan owns the slices): classification before effects before gate (P5 → P1 → P2), because each later contract consumes the earlier object; one owner per shared object (the table in §2 and the plan's §2 agree); additive envelopes, exactly one removal commit; the fake learns from captures, never from prose; live runs recorded in `*-live-run.md`, never gating; break structure debt before freezing it (Q4); every slice regenerates the passport; `orchestrator.ts` is split before it receives five slices of edits.

## 5. Decision-grade outcome

| packet | verdict | why |
|---|---|---|
| P1 mutation safety | revise before implementation | builder claims contradict P2 D8; `unknown` has no basis in P5; run id, receipt query, envelope redaction and the "only path" runner are unspecified |
| P2 submit gate | revise before implementation | fill receipts trip `submit_already_attempted`; own receipt kind and dir survive D6; `operator_only` presented as a control; canonical JSON unnamed |
| P3 frame root cause | ready with amendments | typed `Finding.frameRootCause` alongside the marker; diagnosis as a session step; error carrier from the registry |
| P4 quality ratchet | ready with amendments | break the cycle instead of freezing it; ledger ref check independent of the AK env switch; add the `types.md` route drift to contract-sync |
| P5 result classification | revise lightly | add `basis: "indeterminate"`; define `RawResult` and one `spawnStep`; define the framework `--json` error envelope it already parses from surf |
| P6 a11y snapshot channel | ready with amendments | observer as a `BrowserSession` step; artifact through `artifacts.ts`; text in the file, digest/refs/counts in the envelope |
| combined architecture | revise before implementation, one round | the six packets are individually sound; the shared objects (receipt, run context, runner, error carrier, expectation provenance, session) are defined in two to four places each; one revision round on §2 items 1-13 and the amendments below makes them one system |

Amendments (apply to the packet text before or in the first slice that touches the object):

1. P2 §4.2, D5: delete `surf.receipts.dir` and `test-capabilities.surf.receipt`; the apply receipt is a P1 `mutation.receipt` with `details {plan_id, mode, fields[], submit{}, surf_calls[]}`; outcome vocabulary is P1's; refusals before the act are envelope errors, not receipts.
2. P2 §4.2 rule 3: `submit_already_attempted` queries `listReceipts({planId, mode: "submit"})`; fill-mode receipts never block a later submit of the same plan.
3. P1 §Current state, §Behaviour, verification item 3: withdraw every `SurfFlowBuilder` claim; the builder is deleted in the same commit that removes `type({submit})`; the `failOn: ["type"]` test targets `SurfClient.type(text, {selector})`.
4. P5 §Contract: add `basis: "indeterminate"` (transport failed with no signal from the target: timeout, signal, null exit); P1 §Contract: the ledger sets it on a mutating step whose outcome is `unknown`; healer and report treat it as not-a-target-fault.
5. Kernel (P1 §Open questions run id): `executeCliOperation` mints `RunContext {runId, receiptsDir, ledger}` and passes it to `execute`; `SurfAgent` passes the orchestrator's context to the explore operation instead of calling `executeSurfExploreOperation` (`orchestrator.ts:2096`); P6 derives its session name from `runId`.
6. Error carrier (P1, P2, P3, P6 code lists; P5 registry): `src/core/error-codes.ts` with namespaced arrays and a uniqueness test; `FrameworkError {code, details}` in `runtime-contract.ts`; text mode prints `[code]`, `--json` prints `{"error": {code, message, details}}`, exit 1; P1's receipt lines go into `error.details.receipts` under `--json`; `docs/api/errors.md` updated.
7. P5 §Placement: define `RawResult {source, exitCode, signal, stdout, stderr, durationMs, httpStatus?, body?}` and one kernel `spawnStep`; the five runners in §1 become callers; P1 §Contract: `runStep` is the only caller of `spawnStep` for mutating steps (enforced by a contract test that greps `src/` for `spawn(`/`spawnSync(` outside the kernel).
8. Surf adapter (P1 §Interaction, P2 §4.3, P3 §Behaviour, P6 §Placement): introduce `BrowserSession` (open owned tab, gate, `step(EffectStep)`, `observe(name, readOnlyStep)`, close in `finally`); explore, plan, apply and both observers are step lists over it; the `SurfApplyRunner` is constructed from a session in submit mode.
9. Artifacts (P1 receipts, P2 plan, P6 snapshot, heal artifacts): one `src/core/artifacts.ts` writer with fsync on file and directory, 0600, kinds and `list`; `heal-operation.ts:108-136` moves there.
10. P1 §Risks, P2 §5, P6 §Contract: on-disk artifacts may carry values and text; envelope copies (`mutations[]`, `pages[].observations[]`, `test --json`) carry hashes, codes, refs and counts only; the envelope names the artifact path.
11. P2 §4.1: name the canonicalisation of `approval_token` (RFC 8785 JCS, or "sorted keys, no whitespace, UTF-8" stated verbatim) and put one fixture plan with its expected token in the contract test.
12. P2 §5, D10: reword "unreachable from the orchestrator" as "not wired to any agent, hook or retry path in this repo; reachable through the library like every operation; the allowlist is the boundary"; the passport row for `surf-action:apply` says the same.
13. Bombadil (P1 §Interaction; P2 §4.2 allowlist): per Q1, either the origin allowlist gates every `mutating/target` step whose subject is a web origin (Bombadil included, key renamed `mutation.allowOrigins`) or the packets state in one sentence why the fuzzer is exempt; silence is not an option.
14. Adapter template (P6 §Contract as the model): one section in the target architecture (this §4) listing `resolve`, `probe`, `translate`, `effects`, `normalize`, fixture from captures; the http adapter row is reserved now.
15. P4 §Contract (4) and ledger rule: a missing `ref` fails; an unresolvable AK ref warns; independent of `TEST_CAPABILITIES_REQUIRE_AK_DIRECTION`. P3: re-read `capability-truth-gate.mjs:192-209` against `frame_boundary`/`confirmed` wording before S8 and add the guard fixture.
16. P5 `empty` finding, P1 `mutation_outcome_unknown`, P2 refusals: every refusal message carries the exact command or config line that resolves it (`expect.output: empty`, `--supersede-receipt <id>`, `surf plan ... --submit-selector`); `init` writes `# expect: { output: empty }` as a commented hint.
17. Fixture (P1, P2, P3, P5 verification): `tests/fixtures/captures/` holds real `--json` shapes (the three P3 captures, P6's `snapshot -i --json`, `wait.ready`/`extract` from the live run, an npmjs `surf plan` shape once captured); the fake's page model bumps to one schema (`frames`, `fields`, `controls`, `changeNavigatesTo`) in a single commit; a fidelity test asserts the fake reproduces every capture byte-for-byte under the matching knob.
18. P4 decision log: break the runtime cycle before S2 with a leaf `capability-matrix.ts` (Q4); `structure-budget.json` starts with `allowed_cycles: []`.
19. Before S4: extract the four agent classes from `orchestrator.ts` into `src/core/agents/*.ts` (pure move, no behaviour change, one commit) so the five later slices edit four small files and the frozen exception shrinks.
20. P3 §Evidence fields: add `Finding.frameRootCause?: FrameRootCause` (typed) and keep the marker line as the rendered form; `inferRootCauseClass` reads the field first, the marker only for legacy findings. P4 contract-sync: include the `CliRoute`/`CliOperationResult` unions in `docs/api/types.md`.

## 6. Open decision questions for the operator

1. Does the origin allowlist gate Bombadil? Bombadil is `mutating/target` under P1, runs its own Chrome against `targets.web` (`bombadil-runtime.ts:394-403`) and is not covered by P2's allowlist or the owned-tab rule. Recommendation: yes; rename `surf.submit.allowOrigins` to `mutation.allowOrigins`, consulted by every mutating step whose subject is a web origin; existing Bombadil configs get a refusal naming the key; `demo`/`init` (cli-tester only) are unaffected.
2. Is `SurfClient` kept as public library API? It is the ambient-authority surface (`surf-client.ts:272-301`, `:623-626`) and the passport lists it `library_only verified`. Recommendation: keep it public but as a thin facade over `BrowserSession` with the effect map and `evaluate(code, {effect, reason})`; delete `SurfFlowBuilder`; ship as 0.4.0 with `consumer:smoke` proof.
3. Collapse the five process runners into one kernel `spawnStep` in S3, or classify at each site? Recommendation: collapse in S3 (size M inside an L slice); it is the only way P1's "only path" is checkable, and P5's classifier then has one input shape.
4. Break the `capabilities → operations → dispatch → demo → orchestrator → capabilities` cycle now or freeze it in the budget? Recommendation: break it now (leaf `capability-matrix.ts`, one commit before S2); the ratchet should not start by recording an exception to itself.
5. Adopt surf's `{"error": {code, message, details}}` envelope and `[code]` suffix for framework errors, exit 1 unchanged? Recommendation: yes, in S3 with the registry; agents then parse one error shape from the CLI and from surf, and P1's receipt lines have a typed home.

## Summary

- Combined outcome: revise before implementation, one round. The six packets are individually sound and their refinements hold; the shared objects are defined in two to four places each.
- Today the kernel has no run identity, no effect class, no receipt and no typed error; pass/fail is derived from the absence of failure in four different ways; five process runners exist; the docs drift in four places named in §1.
- Coherence fix 1: one receipt kind, one artifact writer with fsync, one `receipts.dir`; P2's receipt, dir and outcome vocabulary fold into P1; fill receipts never block a submit (amendments 1, 2, 9, 10).
- Coherence fix 2: one process boundary. `RawResult` and `spawnStep` in the kernel, `runStep` the only mutating caller, `BrowserSession` as the owned-tab seam that explore, plan, apply, frame diagnosis and the a11y observer all run through (amendments 5, 7, 8).
- Coherence fix 3: one error carrier and one third-state semantics. `FrameworkError` + registry + JSON envelope; `basis: "indeterminate"` so P1's `unknown` never renders as a target fault (amendments 4, 6).
- Authority: `operator_only` is prose; the allowlist and runner construction are the controls; the kernel is public through the library.
- Verification: the fake must learn from captures, not prose; break the cycle and split `orchestrator.ts` before five slices edit it.
- P1, P2 revise; P5 revise lightly; P3, P4, P6 ready with amendments; twenty amendments listed for the implementer.
- Q1: should Bombadil be under the origin allowlist? Recommend yes, key renamed `mutation.allowOrigins`.
- Q2: keep `SurfClient` public as a facade over the session, delete the builder, 0.4.0? Recommend yes.
- Q3: one `spawnStep` in S3? Recommend yes. Q4: break the cycle before S2? Recommend yes.
- Q5: surf-shaped JSON error envelope for the framework? Recommend yes, in S3.
