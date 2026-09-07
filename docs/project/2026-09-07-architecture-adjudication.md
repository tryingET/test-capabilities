---
summary: "Adjudication of the 2026-09-07 architecture review and the six amended surf-learnings packets from first principles (seven axioms with their decomposition chains, eleven prisoners, four opportunities, a from-zero reconstruction with object definitions) and a many-of-the-greats confrontation over the central question (thin two-ring evidence kernel vs orchestrated platform vs pure-classifier library); every §4/§5/§6 claim of the review marked upheld/revised/rejected with path:line evidence, sixteen findings the review did not make (the import cycle is a live TDZ defect on deep import; command-runner is dead code; quantum and prediction produce no target evidence), the amended target, changes to the plan's slices S1-S10 as they stand after reconciliation, and five open operator decisions re-derived from the axioms."
read_when:
  - "You are the operator deciding the five open questions of the architecture review and want them re-derived from axioms rather than from the reviewer's recommendation, including where this adjudication disagrees (Q2: delete SurfClient; Q3: Adapter.invoke, not spawnStep; Q5: exit code stays open)."
  - "You implement any slice of the surf-learnings plan and need to know what changes beyond the review's amendments (Session as a kernel interface, deletions before the ratchet floor, config schema out of orchestrator.ts, the run verdict as a Determination, the deep-import regression test)."
  - "You wonder why the cycle break is the first move, why quantum and prediction leave the runtime, or why pass/fail stops being a boolean."
type: "review"
---

# Architecture adjudication: test-capabilities as a fail-closed framework acting on owned and unowned state (2026-09-07)

Inputs, read in full: `~/.pi/agent/prompts/first-principles.md`, `~/.pi/agent/prompts/many-of-the-greats.md`, `docs/project/2026-09-07-architecture-review.md` (the review; `§n`, `A<n>`, `Q<n>` cite it), `2026-09-07-surf-learnings-assessment.md`, the six packets P1-P6 as amended by the reconciliation session (decision logs carrying `revised by architecture review: A<n>`), `2026-09-07-surf-learnings-implementation-plan.md` as revised (§0 "Operator decisions assumed", slices S1-S10), `vision.md`, `product-posture.md`, `docs/TEST-CAPABILITIES-FRAMEWORK.md`, and the code cited below. Measured on this tree: `npm test` 253 tests, 252 pass, 1 skipped, 3.8 s; Node built-in coverage 85.21 % lines / 79.11 % branches / 85.69 % functions (`surf-client.js` 66.39 / 53.73 / 48.10; `index.js` functions 0.00; `command-runner-core.js` 100).

Three facts the review did not measure:
1. `node -e "import('./dist/core/operations/dispatch.js')"` throws `ReferenceError: Cannot access 'CLI_ROUTE_MANIFEST' before initialization` (`capabilities.js:24` evaluates `getCliCommandStatus` at module load while `dispatch-manifest.js:125` is still initialising). `dist/index.js` works only because `src/index.ts:6-12` imports `capabilities` first; the package `exports` map (`"."` → `dist/index.js` only) hides the defect from consumers, not from scripts or tests.
2. `runCommand` in `src/core/operations/command-runner-core.ts:16-42` has no caller under `src/`; `command-runner.ts:1-5` is a barrel nothing imports. The function is exercised only by `tests/command_runner_contract.test.mjs` and reports 100 % coverage.
3. `dist/core/operations/types.js` is `export {};` and `test-operation.js` is imported at load by `dispatch-manifest.ts:11` yet absent from the coverage report because its functions run only in child processes; P4's "three never-loaded modules" is one dead barrel, one type-only module and one child-process-only module.

## Part 1: FIRST PRINCIPLES

System: a fail-closed testing framework that acts on state it does not own (browser origins, CLI binaries, processes it does not control) and on state it owns (the workspace), with language models as authors of steps and as readers of evidence.

### AXIOMS (Non-Negotiables)

- A1 Evidence before verdict: a pass may be asserted only from evidence the run obtained; absence of failure is not evidence. Chain: "we need `classifyResult`" → because `targets.cli: "true"` passes with `edgeCases: 100` (`orchestrator.ts:2161-2186`, `:634`) → because the report then claims coverage it never obtained → because a reader, human or model, acts on the report and cannot see a false green → bedrock: the framework's only product is a claim about a target, and a claim without evidence is false whatever the implementation.
- A2 Unknown is irreducible: over a channel the framework does not own, a lost reply is indistinguishable from a lost request, so an effect's outcome can be unknown and no sender-side design removes that. Bedrock: the two-generals result; P1's `unknown` and the review's `basis: indeterminate` (A4) are consequences, not choices.
- A3 Intent is durable outside the process before the act. Chain: "we need receipts" → so a rerun does not double-submit → because the operator reruns → because nothing distinguished "nothing happened" from "unknown" after Ctrl-C → because the process that would remember is the process that died → bedrock: A2 plus process mortality; an in-memory record is narration (P1 refinement, School 2).
- A4 Ownership decides the regime: where the framework holds the authoritative post-state read (the workspace), compare-and-swap plus readback makes replay impossible by construction; where it does not (browser, CLI target, server-side commit), only at-most-once, durable intent and a recorded human reset apply. Bedrock: derived from A2 and from who can read the post-state (P1 Mode 3); `scope` is therefore a kernel field, not an adapter detail.
- A5 Gates are replayable functions of recorded fields: any decision that permits an effect, sets `ok: true`, or lets `apply` consume a proposal is deterministic over stored evidence, and a model may lower a verdict but never raise one. Chain: "we need closed enums" → so the same evidence yields the same gate in CI and in retry loops → because target output is untrusted input and a model in the gate is steerable through the payload it judges (P5 Clash 4) → bedrock: a verdict that cannot be re-derived cannot be audited or tested.
- A6 Authority is held, not checked: the only actions that never happen are those no component can express; a check between held authority and its use is policy, and prose (`operator_only`) is not a control. Chain: "we need a submit gate" → so "Set bid" cannot be clicked → why not a confirmation → because the probe held the click and the token is readable by the same principal (P2 School 1) → bedrock: object-capability discipline; the two authorities that are not the agent's are the operator's world declaration (`mutation.allowOrigins`) and the construction of the runner.
- A7 Evidence outlives its producer: typed, provenance-carrying, content-addressed artifacts; text markers are renderings. Chain: "we need `Finding.frameRootCause` typed" → because regex over concatenated text (`orchestrator.ts:1139-1254`, `self-healing.ts:685-718`, `bombadil-runtime.ts:196-198`) is unreproducible → because consumers outlive producers and a label gets read instead of the evidence (P3 School 2) → bedrock: A5 requires re-derivation from stored evidence alone.

### PRISONERS (False Constraints)

- There must be an orchestrator with agents: believed because of vision Part II and the framework doc's "brain of everything" (`TEST-CAPABILITIES-FRAMEWORK.md:33-65`), and because `orchestrator.ts` (2293 lines) owns config, agents, correlation, root cause and pass/fail → not: an "agent" is a step list over an adapter that yields outcomes (`cli-tester` runs `--help`, `orchestrator.ts:2153-2160`; `SurfAgent` calls a kernel operation, `:2096`); `test` is a composition (`Promise.all`, `:581-590`) plus a determination; correlation and root cause (`:592-616`, `:1139-1254`) are consumers of evidence. Orchestration is a composition layer; the kernel is Step, Outcome, Receipt, Determination.
- Healing belongs in the framework: believed because of the vision's motor cortex and the `heal` route → not as core: the shipped healer is a substring heuristic (`validateSelector`, `self-healing.ts:600-604`) plus regex mining; its two real values, proposals with provenance and conditional workspace writes, are a consumer of evidence and one workspace `EffectStep`. It stays in the repo as a consumer; "self-healing" is an overclaim by the truth gate's own standard.
- The framework spawns tools as subprocesses: believed because surf, Bombadil and agent-browser are binaries (six spawn sites: `command-runner-core.ts:20`, `surf-runtime.ts:349`, `surf-client.ts:795`, `orchestrator.ts:2218`, `bombadil-runtime.ts:280,428`) → not: the kernel boundary is `Adapter.invoke(step) → RawResult`; spawn is one transport, P6's `/json/list` is an HTTP invoke, the fake is a function call. The review's `spawnStep` (A7, Q3) and the plan's `src/core/spawn-step.ts` name the transport where the axiom names the boundary.
- Surf is the action channel: true today as a measured fact (`surf-runtime.ts:17`, the migration live run) → false as structure: the kernel must not know surf; `Session` is a kernel interface (open, gate, step, observe, close in `finally`) that the surf adapter implements; the review (A8) and the plan (S6 `browser-session.ts` "over the surf adapter") weld the interface to its one implementation.
- Receipts are files: believed because of P1's fsync argument → the axiom is "durable outside the process before the act, listable by key"; a file under `receipts.dir` is the v1 implementation of `ReceiptStore {append, list}`; the review's own Lens 3(e) shows why it is an adapter (a per-job CI workspace has no interlock). Sometimes the target is the receipt (the Bombadil trace, the workspace after-hash).
- Pass/fail is a per-step property: believed because of `probe.verified`, `findings.length === 0` (`:1705-1708`) and `passed = !blocking && coverage.overall > 0` (`:634`) → not: a step has an Outcome with a basis; the run has a Determination (`verified | failed | unverified | indeterminate`) over outcomes under declared expectations. The review's §4 keeps the boolean and folds the third state into `fail`, which is where P5's `basis` is lost at the top level.
- An LLM tester is subordinate: correct as judge (monotone, P5) → incomplete as author: the model authors declarations (`expect`, plan fields, `a11y-role` assertions, `frameHint`) that the kernel then enforces deterministically; provenance must carry `author:` next to `config: | cli: | operation: | protocol:`. Subordinate in the gate, first-class at the composition site.
- The passport and truth gate are the right governance form: believed because they exist and byte identity is Goodhart-proof (P4) → the passport lists evidence by hand (`scripts/generate-capability-passport.mjs`), "verified" means "a test file is named" (`library:SurfClient library_only verified` next to 48 % functions executed and a broken parser at `surf-client.ts:249`), the overclaim check greps prose (`capability-truth-gate.mjs:192-209`), the AK check is env-gated (`:56-91`). Governance should be a projection over recorded evidence (contract tests plus `*-live-run.md`), which is the same Evidence object the kernel is about to build; the passport stays a projection, the grep stays a linter.
- Prediction and quantum belong here: believed because the vision names them and `index.ts:169-184` exports them → `quantum` is a seeded in-memory simulation (`quantum-operation.ts:40-44`, seed 42) with no target contact, so by A1 it yields no testing evidence, yet it is a registered kernel route marked Implemented (`README.md:94`); `runPrediction` is a severity lookup (`orchestrator.ts:884-910`) behind a flag the matrix refuses (`capabilities.ts:24`). Both are parked code inside the runtime, inflating the tree the ratchet will memorise.
- The kernel must be a library and a CLI: the `exports` map already exposes only `dist/index.js`; "reachable through the library" means reachable through `src/index.ts`, which exports ambient authority (`SurfClient`, `SurfFlowBuilder`, `:161`; `TestCapabilitiesOrchestrator`, `:94-95`; `createNexus` and the default export, `:205-213`, 0 % functions). The false constraint is "everything the CLI does must be exported"; the library surface is the kernel's pure ring plus `executeCliOperation`.
- Quality ratchets belong in this repo: they do, and P4's mechanism is sound, but two premises are false: the never-loaded baseline (fact 3 above) means the check must be "never imported" over the import graph and the child-coverage merge must be proven before any floor; and "install the floor before S3" (plan S2) memorises dead code (`surf-client.js` 66 %, `engine.js` 78 %) that the same programme deletes.

### OPPORTUNITIES (Assumed Impossibilities)

- Exactly-once against a browser: impossible as a sender property (A2) → achievable per target where the target offers an authoritative post-read or a dedup key: the local `node:http` submit fixture (P2 §9), an intent-specific `verify` (P1). Classify targets by post-read availability and grow the class; at-most-once with a confirmed outcome is exactly-once for that class.
- Proving absence of side effects: a negative cannot be proven → for an owned tab the observable effect surface can be bounded and measured: non-GET requests since the attempt (`network*`), navigation, form loss, DOM mutation count. A `SideEffectWitness` observe step around every declared-read-only step turns "read-only by declaration" into "read-only with a named blind spot", the move P6 made with `semanticCoverage`; P1's revocation is its first consumer.
- Deterministic LLM tests: a model's output is not reproducible → its output is a declaration; if the kernel records it with `author:` provenance and evaluates it deterministically, the test is deterministic although its authoring is not. The plan artifact (P2) and `a11y-assert.v1` (P6) already have this shape; generalise to one `Spec` artifact any runner can replay.
- Hermetic browser evidence: live pages change → P6 measured byte-identical snapshots across runs and a reload; a run's evidence as a set of content-addressed artifacts is hermetic for re-evaluation even when re-acquisition is not, and `tests/fixtures/captures/` (A17) is both the fake's source of truth and the classifier corpus.

### RECONSTRUCTION

If building from axioms only, the objects are:
- `Step {id, effect {class, scope, reason}, subject, intent, adapter, payload, expectation?, idempotencyKey?, precondition?}`: a declared unit of work; nothing runs without one.
- `RawResult {source, exitCode | status, signal, stdout | body, stderr, durationMs}`: what the adapter returned, uninterpreted.
- `Outcome {class, ok, basis, code, transport, payload, recorded[], evidence[]}` = `classify(RawResult, Expectation)`, pure (P5).
- `Receipt {id, runId, stepId, effect, subject, intent, key, outcome: attempting | applied | failed | unknown, startedAt, finishedAt, precondition?, verifiedBy?, evidence[], supersedes?, compensationOf?, details}`: written before the act for every mutating step (P1).
- `Evidence {kind, schemaVersion, digest, provenance {runId, stepId, adapter, capturedAt}, path}`: the durable artifact; text lines are rendered from it.
- `Determination {value (closed enum), basis, candidates[], reason}`: a pure function over Evidence; used for frames (P3), for the run verdict, and for apply permission.
- `Expectation {kind, value, declaredBy: config: | cli: | operation: | protocol: | author:}`.
- `Session`: an owned scope of unowned state (owned tab, process tree, workspace root) with `open, gate, step(Step), observe(name, readOnlyStep), close` in `finally`.
- `Adapter {id, resolve, probe, translate (argv allowlist), effects (command → class), invoke(step) → RawResult, normalize}` plus a fake fed by captures.
- `RunContext {runId, startedAt, config, receiptStore, ledger, adapters}`; `ReceiptStore {append, list(filter)}` with files under `receipts.dir` as v1; `FrameworkError {code, details}` plus a registry.

Module map: `src/kernel/` in two rings: a pure ring (step, outcome, determination, expectation, effects classification, error codes, config schema; no I/O; exported as the library) and a mediated ring (run-context, ledger, receipt store, artifacts, session; the only code that may invoke an adapter or write a receipt); `src/adapters/{surf,bombadil,agent-browser,http}/`; `src/operations/` (compositions: explore, plan, apply, heal, test, doctor, init, replacement-validation); `src/diagnosis/` (correlation, root cause, frame root cause, propagation; pure over Evidence); `src/healing/` (consumer); `bin/` (rendering only). The plan's decision to keep flat `src/core/` names and defer the directory move is compatible: the rings are an import rule, not a directory.

What becomes trivial: `test` is "for each configured sensor, run its step list in a session, classify, determine"; agents are step lists; observers are read-only steps; the interlock is `list` before `append`; `operator_only` disappears; one error carrier; healing is a consumer; a11y and frame diagnosis are `observe` steps; the fake is an adapter whose `invoke` reads captures.

### GAP ANALYSIS

- Current state: no run identity, effect class, receipt or typed error in the kernel (`dispatch-execution.ts:94-102`, `runtime-contract.ts:1-5`, `types.ts:345-355`); pass from absence of failure in four ways; five live spawn paths plus one dead one; the import cycle is a load-order defect, not a smell; the public library exports ambient authority; two runtime modules produce no target evidence; verdict inputs derived by regex in three places; the config schema lives in a consumer (`orchestrator.ts:166-176`) that kernel code imports at runtime (`config-load-core.ts:5`, `init-operation.ts:6`).
- Optimal state: the reconstruction above; the review's §4 is roughly 70 % of it and differs in five places (boundary named after a transport; Session welded to surf; boolean verdict kept; prediction and quantum "unchanged"; agents as a layer).
- Real constraints: surf is the only measured action tool; A2 for every browser commit; a per-job CI workspace; the v22/v26 coverage delta; the `exports` map (which helps: deep imports are already unreachable for consumers); LLM authors under a gate; a shared checkout with another session's uncommitted edits (plan §5).
- Imaginary constraints: `SurfClient` must stay public; `quantum` must stay a route; the cycle may be frozen; the ratchet must precede the deletions; a receipt must be a file; `orchestrator.ts` must be split into an `agents/` layer; the third state must map to exit 1 silently; the config schema must stay in `orchestrator.ts`.

### FIRST MOVE

Break the cycle with a leaf `src/core/capability-matrix.ts` (the plan's S1 commit (4)) and add, in the same commit, the regression test that imports `dist/core/operations/dispatch.js` before anything else, plus `tests/spawn_boundary`-style structure proof that `capability-matrix.ts` imports nothing under `operations/`. One commit, under an hour, green tree, and every later kernel object has a place to live that nothing imports back.

## Part 2: MANY OF THE GREATS

## QUESTION

Should test-capabilities be (A) a thin evidence kernel in two rings, with at-most-once effect discipline over replaceable adapters, where orchestration, diagnosis and healing are consumers with no authority; (B) a rich orchestrated testing platform in which agents, healing, prediction and correlation are one program and the orchestrator is the authority on pass/fail and on effects; or (C) a library of pure classifiers and determinations with no runtime of its own, composed by any runner (Pi, a shell, CI)?

## MODE 1 — MANY OF THE GREATS

### School 1: Microkernel minimality (Brinch Hansen; Liedtke's tolerance principle; the exokernel)
- Core claim: a concept is tolerated inside the kernel only if moving it outside would prevent the system's required function; everything else is policy and lives above.
- Premises: mechanism and policy are separable; the kernel's correctness is what everything else inherits; every line inside the kernel is a line every consumer pays for.
- Strongest case: what must be inside is exactly what no consumer can supply for itself: the run identity, the effect ledger, the receipt before the act, the outcome classification, the session boundary. Correlation, prediction, healing and reporting can all be written above these objects; none of them can create at-most-once from outside.
- What it sees that others miss: `orchestrator.ts` at 2293 lines is the platform school's kernel, and its cycle with `capabilities.ts` is the price: the thing everything inherits cannot even be imported alone.

### School 2: Functional core, imperative shell (Cockburn's ports and adapters; Bernhardt)
- Core claim: the core is pure and total over its inputs; I/O is pushed to a thin shell at the edges; adapters translate; tests of the core need no world.
- Premises: purity is what makes a decision replayable; the core/adapter boundary is the highest-value seam in the program; adapters are replaceable by construction, not by promise.
- Strongest case: `classifyResult`, `determineFrameRootCause`, the effect map, the expectation grammar and the determination rules are pure functions over recorded fields (A5); written that way they are the most testable code in the repo and the only code that can be handed to another runner. P3's split of topology, determination and permission is this school's canonical form.
- What it sees that others miss: the review's kernel mixes the pure ring with the mediated one (`artifacts.ts` beside `result-classification.ts`), and that mixture is why `spawnStep` was named as if spawning were a kernel concept.

### School 3: The integrated platform (Brooks' conceptual integrity; the vision's nervous system; observability platforms)
- Core claim: value comes from integration; cross-sensor meaning requires one runtime that owns all evidence at one time under one vocabulary; a kernel with consumers fragments intelligence into libraries nobody assembles.
- Premises: a system needs one mind; the interesting output is synthesis, not steps; operators want one config, one command, one report.
- Strongest case: root-cause synthesis needs two sensors' evidence co-located (`synthesizeRootCauses`, `orchestrator.ts:598-600`); healing needs findings; propagation needs topology; all of it exists today because one orchestrator holds it. A pure library never runs; a kernel never correlates.
- What it sees that others miss: vocabulary ownership (Finding, Observation, failure classes) is a design act someone must perform, and a repo of consumers without a vocabulary owner drifts into six receipt kinds, which is the state the review found.

### School 4: Unix composition (McIlroy, Pike; small tools, typed streams, the runner is external)
- Core claim: do one thing; emit typed output; let another program compose. In an agent harness the runner already exists (Pi); a framework that ships its own orchestrator competes with the harness and loses.
- Premises: composition beats integration; the cheapest interface is a process with a JSON envelope; every internal loop is a loop the operator cannot see.
- Strongest case: `test-capabilities surf explore --json`, `surf plan`, `surf apply`, `heal --dry-run` are already tools; the `--json` envelope plus the `[code]` error shape is the whole contract a runner needs; the "agent" abstraction adds nothing an external loop with full context does not do better.
- What it sees that others miss: the LLM is the runner, and classification and determination exported as pure functions are what let that runner stay honest without adopting the framework's runtime.

### School 5: Reference monitor and TCB minimisation (Anderson 1972; Saltzer and Schroeder; Rushby's separation kernel; object-capability)
- Core claim: the security-relevant mechanism must be small, always invoked and not bypassable; every effect passes through it; authority is conveyed by construction, never by ambient reach.
- Premises: a check that can be skipped will be skipped; the trusted base must be small enough to verify; a program that can express the forbidden action will eventually perform it.
- Strongest case: "Set bid" happened because the probe held the click; `SurfClient.type({submit})` (`surf-client.ts:290-301`), `click(anySelector)` (`:272-288`), `evaluate(code)` (`:623-626`) and `workflow(do)` (`:565-579`) are ambient authority exported at `index.ts:161`. Complete mediation is `runStep` as the only path to a mutating invoke; least privilege is the apply runner whose addressable set is the plan; economy of mechanism is a kernel small enough that the grep-for-spawn contract test can cover it.
- What it sees that others miss: a library of pure classifiers (School 4) cannot enforce at-most-once, because enforcement needs to own the receipt store and the invoke; and a platform (School 3) cannot be a TCB, because 2293 lines with a regex verdict cannot be verified.

### School 6: Strangler and seams (Fowler; Feathers' "Working Effectively with Legacy Code"; Lehman's laws)
- Core claim: architecture is changed by extracting through seams the code already has, one seam per green commit; re-layering by diagram fails because the tree never stays green long enough.
- Premises: every commit must ship; the module map is the destination, not the route; the risk of a programme is proportional to the number of edits to the same hot file.
- Strongest case: the plan edits `orchestrator.ts` in S1, S3, S4, S5, S7, S8 and S9 (plan §2 table) and answers with a pure move into `src/core/agents/` (A19, S3 commit (1)) that the target does not need. The seams already present are `executeCliOperation` (for `RunContext`), `explorePage`'s `try/finally` (`surf-explore-operation.ts:632-694`, for `Session`), the four live spawn sites (for `Adapter.invoke`), and `writeJsonArtifactAtomically` (`heal-operation.ts:108-136`, for the artifact store).
- What it sees that others miss: "one owner per shared object" (review §2, plan §2) is a statement about commits, not about modules, and deletions are the cheapest extractions.

## MODE 2 — CONFRONTATION

### Clash 1: Microkernel and reference monitor (1, 5) vs Integrated platform (3)
- Fundamental contradiction: whether cross-sensor meaning must live where authority lives. The platform says one runtime owns evidence and verdict; the kernel says the verdict is a determination over evidence anyone may read.
- Incompatible assumptions: "synthesis needs ownership" against "synthesis needs co-location"; they differ on whether owning the artifact set is the same as owning the verdict.
- What A explains better: why the cycle exists, why `passed` is derived four ways, why `operator_only` was written as if it were a control: authority spread across a large program is authority nobody holds.
- What B explains better: vocabulary drift (six receipt kinds, three marker grammars, five expectation shapes) in a programme with no single owner of types.
- Residual tension: resolvable. A run's artifact set gives co-location without ownership; the kernel owns the vocabulary (types) and the determination; consumers own algorithms. The platform keeps conceptual integrity of the type layer and loses every claim on authority.

### Clash 2: Unix composition (4) vs Reference monitor (5)
- Fundamental contradiction: if Pi is the runner, why a runtime at all? Unix says export pure functions and envelopes; the monitor says at-most-once cannot be enforced by a library the runner may not call.
- Incompatible assumptions: "the operator's loop is the retry loop and must be free" against "the operator's loop is the retry loop and must be governed" (P1 School 7 against School 3, at the architecture level).
- What A explains better: reach; the value of `classifyResult` and the frame determination to a runner that never adopts the orchestrator; why `--json` and `[code]` matter more than any agent class.
- What B explains better: the shell `until` loop; why receipts must be written by the thing that invokes; why `heal --apply` needs a ledger it did not get from a library call.
- Residual tension: resolvable by the two rings. The pure ring is exported and composable (Unix wins there); the mediated ring is the only path to an effect through the framework (the monitor wins there); effects performed outside the framework are outside its claims, and the receipts say so.

### Clash 3: Integrated platform (3) vs Strangler (6)
- Fundamental contradiction: rewrite toward the diagram or extract through seams. The review's §4 module map is re-layering; the plan's slices are accretion onto the hot file with one pure move; neither is extraction.
- Incompatible assumptions: "the destination justifies a big move" against "only green commits exist".
- What A explains better: why a coherent vocabulary needs one authoring pass (the review's §2 table, the plan's §2 owners).
- What B explains better: why seven slices touching `orchestrator.ts` will collide, and why the four spawn sites and the `explorePage` `try/finally` are cheaper seams than a new directory.
- Residual tension: irreducible in one place: the type layer is authored once (platform), the runtime is extracted seam by seam (strangler); the two proceed in different commits and the type commit comes first.

### Clash 4: Functional core (2) vs Reference monitor (5)
- Fundamental contradiction: purity forbids I/O in the core; mediation requires I/O (fsync, invoke) in the trusted path.
- Incompatible assumptions: "the kernel is a set of total functions" against "the kernel is the only code that may touch the world".
- What A explains better: testability, replay from captures, why the frame determination is the best contract in the set.
- What B explains better: why `mutation_receipt_write_failed` must be able to fire and why the writer is a kernel object.
- Residual tension: none once named: two rings, a pure ring that never imports `node:fs` or `node:child_process`, and a mediated ring that imports both and nothing else, with the ring boundary enforced by the structure check (P4) rather than by discipline.

## MODE 3 — INTEGRATION OR DECISION
- Chosen path: Contextual Dominance, with a hard partition rather than a blend.
- Result: the reference monitor (5) dominates everything that causes an effect or asserts `ok`: one mediated ring owns `RunContext`, ledger, receipt store, session and `Adapter.invoke`, and nothing outside it may spawn, write a receipt, or set `ok: true`. The functional core (2) and Unix (4) dominate the pure ring: outcome, determination, expectation, effect classification and the error registry are pure, exported, replayable from captures and usable by any runner. The microkernel (1) sets the admission rule for both rings: a concept enters only if no consumer could supply it. The platform (3) is confined to compositions and to authoring the vocabulary once; it holds no authority, so `TestCapabilitiesOrchestrator` becomes the `test` composition plus a `diagnosis/` consumer and stops being the thing kernel code imports. The strangler (6) dominates the route: types first, one seam per commit, deletions before measurements. Answer: A, with C's pure ring as its exported half and B demoted to a consumer.
- Why this path is justified: the schools answered four different questions (what is inside, what is pure, who runs it, how to get there), and each loses exactly where it claimed another's question. A true synthesis would have to invent a way for a library to enforce at-most-once or for a platform to be a verifiable TCB; neither exists. An explicit preference for the monitor alone would throw away the exportable pure ring, which is where the LLM runner and the fixture corpus get their value.
- What remains unresolved: effects performed outside the framework (Pi driving surf directly) are outside its guarantees and always will be; the vocabulary owner is a role, not a module, and the repo has no mechanism beyond review to keep it single; the first attempt against an unowned target remains hazardous after every discipline here (P1 Mode 3).

## PRACTICAL CONSEQUENCE

Build the two rings and the adapter interface, not the diagram: extract `RunContext` at `dispatch-execution.ts:94-102`, `Session` at `surf-explore-operation.ts:632-694`, `Adapter.invoke` at the four live spawn sites, the artifact store at `heal-operation.ts:108-136`; author the types once; delete what the axioms exclude from the runtime (the `SurfClient` public surface, `SurfFlowBuilder`, the `quantum` route, the prediction exports, the dead runner) before any floor is set; make the run verdict a Determination; keep the orchestrator's correlation and root-cause code as a `diagnosis` consumer that never sets `ok`.

## Part 3: NO STONE UNTURNED

Each claim of the review's §4 target, §5 amendments and §6 questions, marked upheld / revised / rejected, one line each.

### §4 target architecture
1. `RunContext` minted by `executeCliOperation` and threaded to every `execute`: upheld; revised to carry `receiptStore` (interface) and `adapters`, not `receiptsDir` (`dispatch-execution.ts:94-102` has no context at all; Lens 3(e) shows the dir is not the interlock in CI).
2. `EffectDeclaration`, `EffectStep`, `MutationLedger`, `MutationReceipt`; `runStep` sole caller of `spawnStep`: revised; `runStep` is the sole caller of `Adapter.invoke` for mutating steps and spawn is one transport (prisoner 3; six spawn sites, one dead).
3. `RawResult`, `classifyResult`, `ResultOutcome` with `basis` including `indeterminate`, `TRANSIENT_CODES` in the kernel: upheld (pure ring).
4. `Expectation` with `declaredBy` provenance: upheld; add `author:` for LLM-authored declarations (prisoner 7).
5. `FrameworkError {code, details}` plus registry: upheld (`runtime-contract.ts:1-5`; `bin/test-capabilities:93-99` prints prose under `--json` today).
6. `artifacts.ts` with fsync, kinds, 0600, `list`: upheld; revised to be the file implementation of `ReceiptStore`/`EvidenceStore` interfaces (prisoner 5).
7. Determination gates as a pattern with P3 as reference: upheld and extended to the run verdict (prisoner 6): `TestResult.determination` next to `passed`.
8. Typed evidence on `Finding`, `Observation`, probe and page with derived markers: upheld (A7).
9. Module map (`kernel/`, `adapters/`, `browser-session.ts`, `operations/`, `diagnosis/`, `agents/`, `healing/`, prediction and quantum unchanged): revised in three parts: `Session` is a kernel interface implemented in the surf adapter; there is no `agents/` layer (agents are step lists inside `operations/test`); prediction and quantum leave the runtime (rejected as "unchanged", A1, `quantum-operation.ts:40-44`, `orchestrator.ts:884-910`).
10. Nothing in an adapter decides pass/fail, effect class or permission: upheld.
11. Authority boundaries (operator config, kernel, runner construction, external checkpoint, monotone LLM, "operator-only is not an authority"): upheld; add the library surface to the boundary (`index.ts:161`, `:94-95`), which changes Q2.
12. What stays out: upheld; add quantum and prediction; `SideEffectWitness` is deferred, not out.
13. Transitional compatibility with one removal commit at 0.4.0: revised; the removal grows (`SurfClient` public surface, `SurfFlowBuilder`, `quantum` route, `PredictionEngine`/`QuantumSimulator` exports, `command-runner.ts`, `createNexus`/`Nexus*` aliases) and moves before the ratchet floor.
14. Migration principles: upheld, except "split `orchestrator.ts` into `agents/`" (see 33) and with one addition, "delete before you measure".

### §5 amendments
15. A1 one receipt kind, P2 folds in: upheld (P2 D12 now says so).
16. A2 fill receipts never block submit: upheld (P2 D13).
17. A3 builder withdrawn and deleted: upheld and extended to the whole `SurfClient` public surface (Q2).
18. A4 `basis: indeterminate`: upheld (P5 §Contract carries it).
19. A5 `RunContext` and `SurfAgent` through the context: upheld; under the decision the `test` composition runs the explore step list in a session it owns.
20. A6 error carrier and JSON envelope: upheld.
21. A7 `spawnStep` and grep test: revised to `Adapter.invoke`; the grep stays as the transport check; `command-runner-core.runCommand` is deleted, not migrated (no caller).
22. A8 `BrowserSession` on the surf adapter: revised to a kernel interface with the surf implementation.
23. A9 one artifact writer with fsync: upheld.
24. A10 values on disk, hashes in envelopes: upheld.
25. A11 JCS canonicalisation with a fixture: upheld (P2 D14).
26. A12 `operator_only` is prose: upheld, and stronger: remove the ambient exports rather than document them.
27. A13 allowlist gates Bombadil: upheld (Q1).
28. A14 adapter template: upheld; add `invoke` and `fake` rows; agent-browser's `/json/list` is an HTTP invoke, not a spawn.
29. A15 ledger `ref` rule independent of the AK env switch; overclaim grep re-read: upheld.
30. A16 refusals carry the resolving command: upheld.
31. A17 fake from captures with a fidelity test: upheld; the captures are also the classifier's test corpus.
32. A18 break the cycle before S2: upheld and upgraded from hygiene to defect (fact 1).
33. A19 extract four agent classes to `src/core/agents/*.ts`: revised; extract them as step lists into `operations/test/` and move correlation and root cause toward `diagnosis`; no `agents/` layer. The plan's S3 commit (1) is acceptable as a pure move only if the directory is named for what it is (`operations/test/`) so it is not mistaken for a kernel layer.
34. A20 typed `Finding.frameRootCause`; `types.md` unions in contract-sync: upheld.

### §6 questions, re-adjudicated from the axioms and the Part 2 decision
35. Q1 Bombadil under the origin allowlist: yes, from A6 (the world hazard belongs to the world's owner; Bombadil is the only component that clicks anything on any origin the config names, with its own Chrome, `bombadil-runtime.ts:393-411`). Key `mutation.allowOrigins`; its own browser is acceptable because it is not the operator's, but the origin is still the operator's declaration. Agrees with the review and the plan's §0 assumption.
36. Q2 keep `SurfClient` public as a facade: no (differs from the review, the plan's §0 and S6 commit (3)). A6 forbids exporting ambient authority; the class is 48 % functions executed, mapped from `--help` and not live-verified (`product-posture.md:43`), with a broken parser (`surf-client.ts:249`). Export `Session` (read steps, `plan`, `apply`) as the library's browser surface; delete `SurfClient` and `SurfFlowBuilder` at 0.4.0. The plan's §0 fallback for a rejected Q2 (trim the builder and ledger-wrap it) is the wrong direction under the axioms: a wrapped ambient capability is still held.
37. Q3 one `spawnStep` in S3: yes as `Adapter.invoke` with a spawn transport in `spawn-step.ts`; delete the dead runner instead of migrating it; size stays M inside S3. The plan's §0 fallback (per-site classification) would leave complete mediation unenforceable and is rejected.
38. Q4 break the cycle now: yes, as the first move, with the deep-import regression test; freezing it would freeze a defect. Agrees with the review and S1 commit (4).
39. Q5 surf-shaped JSON error envelope and `[code]` suffix, exit 1 unchanged: yes for the envelope; the exit code is an open decision because the third state (`unverified`, `indeterminate`) now reaches the top level (Part 4, D3).

### Claims the review did not make
40. The import cycle is a live TDZ defect on deep import (fact 1); only the `exports` map and the import order in `index.ts:6-12` hide it.
41. `command-runner-core.runCommand` has no production caller and 100 % coverage (fact 2): a Goodhart exhibit and a fifth "runner" that should be deleted, not made a caller of `spawnStep` (plan S3).
42. P4's never-loaded baseline is one dead barrel, one `export {}` and one child-process-only module (fact 3); the check should be "never imported" over the import graph, and the child-coverage merge must be proven before any floor is set; the plan's S1 loading test for `command-runner.js` would test dead code.
43. `quantum` is a registered route marked Implemented (`README.md:94`, `dispatch-manifest.ts:95-100`) that contacts no target; by A1 it is not a testing capability.
44. `index.js` functions 0 %: `createTestCapabilities`, `createNexus`, the default export and the `Nexus*` aliases (`index.ts:86`, `:95`, `:205-213`) are unused legacy surface.
45. `SurfAgent` folds every explore error into one critical `web` finding (`orchestrator.ts:2101-2117`): a `page_login` refusal and a spawn failure render identically; the basis axis must reach this site (S4 names the file, not the conflation).
46. Bombadil's status is decided by regex over stdout (`looksLikeViolation`, `bombadil-runtime.ts:196-198`) and the orchestrator greps for `violation|error|failed` (`:1871-1878`); under A5 status must come from typed fields (exit contract, trace presence), P5's "violations are not the classifier's business" notwithstanding.
47. `receipts.dir` "resolved against the config file's directory" (P1 §Contract, plan S5) has no meaning for `heal`, `init` and `replacement-validation`, which run without a config; the default must be defined per operation (cwd or `--dir`).
48. `mutation.allowOrigins` lives in `TestCapabilitiesConfigSchema` inside `orchestrator.ts:166-176`, but `surf plan|apply` (P2 §4, plan S7) have no `--config`; the operations need `--config` or a defined lookup, and the schema must move to the kernel because kernel code already imports a consumer for it at runtime (`config-load-core.ts:5`, `init-operation.ts:6`).
49. The `.strict()` schema is mirrored by hand in `capabilities.ts:62-97` (`RuntimeConfigLike`), a second drift surface contract-sync does not cover.
50. `cli-tester`'s read-only claim is "assumed, not verified" (P1); the assumption must be rendered in the envelope's `effect.reason`, not only in code.
51. The review cites `heal-operation.ts:502-506` for the checkpoint rule; it is at `:490-494`.
52. `docs/api/errors.md:73-81` still says `--url` only while `--depth` ships (`support.ts:22-23`, `docs/api/cli.md:170`); confirmed, and the plan's S3 fixes it.
53. The passport's `library:SurfClient library_only verified` row is contradicted by the coverage and by `:249`; "verified" there means "a test file exists".
54. `attachScreenshotIfEnabled` turning a successful click into `{success: true, error}` (`surf-client.ts:772-789`) disappears with the class rather than being fixed (plan S3 caller list item dropped under Q2 = no).
55. `scripts/test-agent-browser.sh` launches its own Chrome (P6 §Current state); its deletion is scheduled in S9 but it violates the owned-browser rule today and can go in S1.

## Part 4: CONSEQUENCES

### Amended target architecture

```
 bin/test-capabilities (render only: text [code] | --json {"error":{code,message,details}} | envelope.determination)
        │
 ┌─ kernel (flat under src/core/ for now; the rings are an import rule the structure check enforces) ──────┐
 │ pure ring (exported, imports no node:fs / node:child_process): step, outcome (classifyResult),          │
 │   determination, expectation (declaredBy incl. author:), effects (class map, EffectStep), error-codes, │
 │   config schema (moved out of orchestrator.ts)                                                          │
 │ mediated ring (the only code that touches the world): run-context, ledger (runStep), receipt-store     │
 │   {append,list} + artifacts (files, fsync, 0600), session {open,gate,step,observe,close}, Adapter.invoke│
 └───────┬────────────────────────────────────────────────────────────────────────────────────────────────┘
         │ adapters (resolve, probe, translate, effects, invoke, normalize; fake in tests/fixtures/<adapter>/ from captures/)
         ├─ surf (Session impl: owned tab; explore, plan, apply and both observers are step lists)
         ├─ bombadil (one mutating/target step; trace = verify; status from typed fields, no regex)
         ├─ agent-browser (observe steps only; HTTP invoke for /json/*; spawn invoke for snapshot)
         └─ http (reserved row: GET/HEAD read-only)
 operations/ compositions: explore, plan, apply, heal, test (agents = step lists), doctor, init, replacement-validation
 diagnosis   correlation, root cause, frame root cause, propagation: pure over Evidence, never sets ok
 healing/    consumer: proposals from Evidence; apply = workspace EffectSteps with precondition and verify
 governance/ passport = projection over recorded evidence; truth gate = linter plus byte identity
 out of the runtime: quantum, prediction, SurfClient, SurfFlowBuilder, command-runner, Nexus aliases
```

Object definitions are those of Part 1 Reconstruction, with two additions: `TestResult.determination: {value: verified | failed | unverified | indeterminate, basis, reason}` next to `passed` (which becomes `determination.value === "verified"`), and `Adapter.invoke(step, ctx) → RawResult` replacing `spawnStep` as the named boundary (the plan's `spawn-step.ts` survives as the spawn transport behind it).

### Slice changes, by the plan's current slice ids

- S1 (M, unchanged size): keep the healer guard, `appliedCount` from written files, the sourcemap switch, and commit (4) (the leaf matrix). Add to commit (4): the deep-import regression test and the config-schema move (`TestCapabilitiesConfigSchema`, `TargetSchema`, `AgentConfigSchema`, `RuntimeConfigLike` into `src/core/config.ts`; `orchestrator.ts`, `config-load-core.ts:5`, `init-operation.ts:6` import it). Drop commit (2) (`parseSnapshot` fix and fake `page.read`) under Q2 = no. Replace commit (3)'s loading test: delete `command-runner.ts` and `runCommand` with their test, keep the sourcemap switch, and add the child-coverage merge proof as the acceptance for `test-operation.ts`. Delete `scripts/test-agent-browser.sh` here (claim 55).
- New S1b (M, the removal commit, 0.4.0, before S2): delete `SurfFlowBuilder` (`surf-client.ts:859-984`), the `SurfClient` export at `index.ts:161` (the file stays internal until S6 replaces it), the `quantum` route (`dispatch-manifest.ts:95-100`, `quantum-operation.ts`, `bin`), the `PredictionEngine`, `GradientBoostingPredictor`, `PredictionCollector`, `QuantumSimulator`, `QuantumTestRunner`, `createNexus`, `NexusOrchestrator`, `NexusConfig` and default exports (`index.ts:78`, `:86`, `:95`, `:163-184`, `:205-213`); passport, README rows 25 and 94, `docs/api/api-surf.md`, `consumer:smoke`, the "Changes in 0.4.0" section started here instead of in S6. Deletions before the floor; the version bump moves from S6 commit (3) to here.
- S2 (M): `allowed_cycles: []` stays; the never-loaded check becomes never-imported over the import graph (`check-structure.mjs` already builds the graph); the pure-ring import rule (`node:fs`/`node:child_process` forbidden in the named pure modules) is a second structure rule; the passport byte-identity check moves here from S10 (one line, cheap); floors are measured after S1b.
- S3 (L, unchanged size): `Adapter` interface with `invoke`; `spawn-step.ts` as the spawn transport; four live callers, not five (claim 41); commit (1) moves the agent classes to `src/core/operations/test/agents.ts` (not `src/core/agents/`, claim 33); `RawResult`, `classifyResult`, registry, `FrameworkError`, the JSON error envelope, `errors.md` rewrite.
- S4 (L): add the `SurfAgent` catch-site basis (claim 45), Bombadil status from typed fields (claim 46), and `TestResult.determination` alongside `passed`; `summarizeTestResult` renders `determination`.
- S5 (L): `RunContext.receiptStore` as an interface with the file implementation in `artifacts.ts`; per-operation `receipts.dir` default (claim 47); `effect.reason` rendered in every envelope (claim 50); `mutation.allowOrigins` read from the kernel config schema (S1).
- S6 (L): `Session` interface in the kernel (`browser-session.ts` declares it), the surf implementation, explore as a step list, effect map, `js` declaration and denylist, `--retry 1`, revocation, `owned_tab_required`; commit (3) becomes "delete `surf-client.ts`" with `Session` exported from `index.ts` as the browser surface; no facade.
- S7 (L): `--config` on `surf plan|apply` or a defined allowlist source (claim 48); the runner is built from `Session` in submit mode; `mutation: external` and `operator_only` leave the manifest entry (they are documentation; the sentence goes in `description`).
- S8 (L), S9 (L): unchanged, with agent-browser built on the `Adapter` template including an HTTP invoke for `/json/*` and `explainUnreachable` living on `Session`, not `SurfClient`.
- S10 (M): contract-sync remainder (commander/manifest/`cli.md`, generated help, schemas, `types.md` unions, and the `RuntimeConfigLike` mirror if it survives S1), `coverage:raise`, posture and README; the release note is finished here, started in S1b.
- Dependency graph change: `S1 → S1b → S2 → S3 → S4 → S5 → S6 → {S7, S8, S9} → S10`; S6 no longer carries the version bump, so a partial S6 leaves 0.4.0 already published with the removals only.

### Changes each packet needs beyond the review's amendments

- P1: `runStep` is the only mutating caller of `Adapter.invoke`; `ReceiptStore` is an interface; `receipts.dir` default per operation; Bombadil's `verify` reads a typed trace fact, not a regex; `effect.reason` surfaces in envelopes.
- P2: `--config` (or the named allowlist source) on plan and apply; the runner is built from `Session`; `mutation: external` and `operator_only` leave the manifest.
- P3: none beyond A6, A8, A15, A17, A20; the deferred in-frame probe needs `frame.switch` classified as `browser_session` scope, which P1's map can state now.
- P4: never-loaded becomes never-imported; child-coverage merge proven before the floor; floors set after S1b; passport byte check in S2; the ring boundary added to the structure check.
- P5: the `SurfAgent` catch site and Bombadil status are named call sites; `TestResult.determination` is the top-level consumer; `author:` provenance in `declaredBy`.
- P6: agent-browser is an `Adapter` with two invokes (HTTP, spawn); the observer is a `Session.observe` step; nothing else.

### Defer or delete

Delete now (S1, S1b): `command-runner.ts` and `runCommand`; `SurfFlowBuilder`; the `SurfClient` public surface, then the file (S6); the `quantum` CLI route; the prediction and quantum exports; `createNexus`, `NexusOrchestrator`, `NexusConfig`, the default export; `scripts/test-agent-browser.sh`. Defer with a name: `SideEffectWitness` (network, navigation and DOM witness around read-only steps); the in-frame positive probe (P3 Q5); `within` landmark scoping (P6); the http adapter; exit code 2 for the third state; a shared `Spec` artifact for LLM-authored replayable tests; the persistent CI receipt store; the `src/core/kernel/` and `src/core/adapters/` directory move (the plan already defers it).

### Open operator decisions (five)

- D1 Remove `quantum` and prediction from the runtime at 0.4.0. Recommendation: yes; delete the route and the exports, keep the simulator source only if a future promotion has a data shape and a target contract (posture rule 7). If the operator keeps them: passport rows become `parked`, README row 94 stops saying Implemented, both declare `read_only`, and they are excluded from the coverage floor so they do not inflate it.
- D2 `SurfClient` public API. Recommendation: delete; export `Session` (read steps, `plan`, `apply`) as the browser surface at 0.4.0. If kept: the review's facade over `Session` with the effect map and `evaluate(code, {effect, reason})` (plan S6 as written), every mapping not live-verified marked `unverified` in the passport, and the plan's §0 "trim the builder" fallback withdrawn.
- D3 Exit code for the third state. Recommendation: keep exit 0/1 in this programme, with `determination` in every envelope and `unverified | indeterminate` mapping to 1; revisit exit 2 once consumers read the envelope. If exit 2 now: `docs/api/errors.md:14-19`, `bin`, `consumer:smoke` and the CI scripts change in S4.
- D4 Config schema ownership. Recommendation: move `TestCapabilitiesConfigSchema` to the kernel in S1 commit (4) so `mutation.allowOrigins` and `receipts.dir` have one source for every operation and the kernel stops importing a consumer. If the operator prefers to leave it in `orchestrator.ts`: `surf apply` needs its own allowlist file, which creates a second authority over the world and contradicts A6.
- D5 CI interlock. Recommendation: fail closed; a mutating operation refuses when `receipts.dir` resolves inside an ephemeral workspace unless the operator sets `receipts.ephemeral: true`, recorded in every receipt. If the operator prefers documentation only: the plan §5 sentence "CI without a persistent path is not interlocked" stands and `doctor` warns.

## Summary

- A1 Evidence before verdict: a pass exists only from evidence the run obtained; absence of failure is nothing.
- A2 Unknown is irreducible over a channel the framework does not own; the design must survive it, not classify it away.
- A3 Intent is durable outside the process before the act, because the process is what dies.
- A4 Ownership decides the regime: compare-and-swap where the post-state is readable, at-most-once plus recorded human reset where it is not.
- A5 Every gate is a replayable function of recorded fields; a model may lower a verdict, never raise one.
- A6 Authority is held, not checked: the operator's world declaration and the runner's construction are the only authorities; prose and exports are not.
- A7 Evidence outlives its producer: typed, provenance-carrying, content-addressed; text markers are renderings.
- Part 2 decision: contextual dominance with a hard partition; a thin two-ring evidence kernel (reference monitor for effects and `ok`, pure exported ring for classification and determination) over replaceable adapters; orchestration, diagnosis and healing are consumers without authority; the route is strangler extraction, types first, deletions before floors.
- Largest change 1: the boundary is `Adapter.invoke` and a kernel `Session` interface, not `spawnStep` over a surf-owned `BrowserSession`; the cycle break is the first move because deep import fails today, and the config schema leaves `orchestrator.ts` with it.
- Largest change 2: `SurfClient`, `SurfFlowBuilder`, the `quantum` route and the prediction exports leave the runtime in a new S1b at 0.4.0, before the ratchet floor is set; the never-loaded check becomes never-imported and the dead runner is deleted rather than migrated.
- Largest change 3: the run verdict becomes a Determination with a basis that reaches the envelope; plan, apply and heal read one config authority from the kernel.
- Open: D1 quantum/prediction removal (yes), D2 SurfClient deletion (yes, against the review and the plan's §0), D3 exit code for the third state (keep 0/1 now), D4 config schema in the kernel (yes), D5 CI interlock fail-closed (yes).
