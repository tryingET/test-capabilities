---
summary: "Product posture snapshot for test-capabilities: current capability maturity, truthful runtime boundary, major gaps, and proof signals."
read_when:
  - "When selecting or reviewing test-capabilities product direction from current maturity rather than task history"
  - "When deciding whether a testing capability is implemented, bounded, unsupported, or future vision"
  - "When bridging docs/project/vision.md to maintainer planning, tasks, decisions, or capability-passport evidence"
type: "reference"
system4d:
  container: "Testing infrastructure for the AI-native era."
  compass: "Testing should think, adapt, and evolve without pretending unsupported capabilities are real."
  engine: "Ship bounded capability slices, fail closed, verify with deterministic checks, then widen."
  fog: "The product is still converging from testing vision toward packaged, capability-backed runtime surfaces."
---

# Product Posture: test-capabilities

## Purpose

This file is the bridge between durable vision and active execution authority.

It captures where `test-capabilities` stands as a product/runtime, what target operator experience it is converging toward, which maturity gaps matter most, and what proof would close those gaps.

It does **not** replace:

- shipped runtime/source truth in code, tests, README, API docs, generated artifacts, or release checks
- maintainer task, decision, direction, evidence, or release authority
- `docs/project/vision.md` as the durable north-star narrative
- `governance/capability-passport.json` as the generated capability inventory
- focused implementation plans under `docs/dev/plans/` when a non-trivial change needs design capture

Do not turn this file into a task log, changelog, queue mirror, handoff file, or second direction substrate.

## Posture in one sentence

`test-capabilities` has crossed from aspirational testing-framework narrative into a fail-closed TypeScript CLI/package with an evidence kernel (typed run identity, effect classes, a mutation ledger over durable receipts, one `Session` scope for the browser, a pure result classifier and a run `Determination` with a basis), zero-external `doctor` and `demo` first-run paths, supported `test`/`heal`/`surf explore`/`surf plan`/`surf apply` routes, a parked `quantum` route and parked prediction library API (present, tested, not testing capabilities), implemented `cli-tester`, `surf`, and Bombadil-backed orchestrator paths, normalized observation events, deterministic calibrated root-cause observations for independent same-component failed-or-errored observed evidence from at least two sensors with same-class agreement, low-calibration non-authoritative propagation observations for bounded dependency-topology links, property/behavior/release checks, and a generated capability passport; its main maturity gap is now validating deeper cross-sensor synthesis empirically without blurring supported runtime behavior with the larger autonomous-testing vision.

## Product maturity map

| Area | Current posture | Target posture | Main gap | Proof of closure |
|---|---|---|---|---|
| Capability contract | Runtime support is explicit and fail-closed through `src/core/capability-matrix.ts` + `src/core/capabilities.ts`, the operation registry, and contract tests; since the 2026-09-07 surf-learnings programme a quality ratchet holds coverage floors, file-size budgets, the import graph, the pure-ring rule and the passport byte identity, and a contract-sync stage compares the commander command set, the `docs/api/cli.md` status table, the generated CLI-help and export captures, the `docs/api/types.md` unions, the published schemas and the config mirror against the runtime. Unsupported agents, commands, flags, and intelligence surfaces fail clearly; `doctor` and `demo` provide zero-external first-run proof paths. | Operators can trust that every advertised capability is wired to a real implementation path with tests, docs, and release checks. | Some narrative docs still describe future autonomy/prediction as if it were product behavior. | README, vision, posture, capability passport, and tests agree on implemented vs unsupported vs future surfaces. |
| Operation kernel | CLI routes run through `src/core/operations.ts` and trust-sized operation modules. | Adding a new command or adapter means adding a typed route, schema, executor, result envelope, docs, and contract tests. | The kernel can grow into a central bottleneck if more verbs/adapters are added without another split. | A new capability lands without duplicating CLI wrapper logic or inflating `operations.ts` beyond a manifest/export seam. |
| Orchestrator sensors | `cli-tester`, `surf`, `bombadil`, and the experimental `terminal-fuzzer` are implemented; Surf wraps the supported `surf explore` path on the upstream nicobailon/surf-cli CLI (branch `feat/site-independent-mechanisms`) resolved from `TEST_CAPABILITIES_SURF_BIN`, `PATH`, or `~/.local/bin/surf`, probes the build for `wait.ready`/`extract` and refuses older builds, runs in an owned tab gated by typed readiness states, verifies explicit browser-state/DOM probes and `extract`-backed link rows, supports bounded same-origin `--depth` exploration, and fails closed on retired `surf-go` env vars, unreadable readiness, or unverified seed Surf output; Bombadil resolves from explicit env, built source checkout, repo-local binary, or `PATH`, exposes Bombadil 0.5 request headers, trace output, trace reproduction, viewport/instrumentation/permission knobs, and `test-external` debugger settings through typed config, and wraps `bombadil terminal test` through a bounded terminal-fuzzer config. Packed consumers intentionally treat Bombadil as an external binary requirement. Since the surf-learnings programme every sensor runs as a step list over one boundary (`Adapter.invoke` with a single spawn transport), every browser step runs inside one owned-tab `Session`, an element the readiness gate cannot reach gets a typed frame determination, and an optional read-only a11y snapshot channel (agent-browser over the loopback CDP endpoint) can observe the same tab without owning it. | Sensor integrations become a small, typed parliament of real observers with normalized findings and evidence. | `api-fuzzer` remains unsupported; packed Bombadil consumers must provide an external Bombadil binary and Surf consumers must provide a resolvable surf CLI with the readiness/extract mechanisms plus a running browser with the surf extension; the retired `surf-go` fork is unsupported; the `SurfClient` library class left the public API in 0.4.0 (D2) and the browser surface returns as the kernel `Session` interface in this release line. The terminal-fuzzer slice is bounded and experimental, not a production terminal-autonomy claim. | Supported sensors have deterministic fixtures/smokes, generated passport evidence, and packed-consumer proof for external binary requirements. |
| Intelligence layer | Finding correlation exists inside the orchestrator, supported agents emit `observation.v1` diagnostic events, and the orchestrator can add non-authoritative component-level semantic synthesis, suite-level observation correlation, deterministic calibrated `root_cause` observations for independent same-component failed-or-errored observed evidence from at least two sensors with same-class agreement, and non-authoritative `propagation` observations when dependent components both have high-calibration root_causes linked by a bounded propagation heuristic (e.g., api timeout paired with web runtime failures, same-timeout shared infrastructure, or schema drift paired with web runtime failures) across default or operator-configured topology edges, while suppressing generic component-failure-only, non-latency same-class, Surf evidence-gap, auth-boundary, network-connectivity, resource-exhaustion, and configuration-error propagation overclaims; `root-cause:corpus` dogfoods CLI, API, API auth-boundary/network-connectivity/resource-exhaustion/configuration, Surf, selector/DOM, Bombadil/property ambiguity, and propagation synthesis guardrails with structured `semantics.failureClass` / `semantics.propagationLink` plus machine-readable root-cause and propagation coverage floors; `runtime-diagnostic:corpus` adds a narrow real-`cli-tester` subprocess proof lane for command-resolution, timeout, mixed-class, and correlation-disabled guardrails. Prediction, collective learning, and self-healing intelligence flags are unsupported; the `PredictionEngine` library API and the `quantum` route/`QuantumSimulator` are parked (present and tested, producing no target evidence, never a `Finding`, `Observation` or verdict input). | Cognitive surfaces turn observations into correlation, synthesis, calibrated diagnosis, and eventually prediction while preserving budget and local/privacy constraints. | Root-cause observations are deterministic and evidence-bounded, but the corpus is still fixture-based plus a narrow real-subprocess lane rather than empirically broad; propagation topology is configurable but remains a heuristic input, not causal proof; prediction and collective learning remain vision-level until backed by empirical/runtime proof. | A broader calibrated root-cause corpus has measurable inputs, deterministic tests, acceptance thresholds, and explicit privacy posture before any prediction promotion. |
| Motor/autonomy layer | `heal` provides a heuristic selector repair workflow with optional `--findings-input` for evidence-backed proposals that cite `triggeringFindingId`; every write is a conditional `EffectStep` on the kernel ledger with a precondition hash re-read immediately before the rename, an after-hash verification and compensation limited to siblings whose own receipt says `applied`; `surf apply` is the only other motor surface and it is gated by a reviewed plan, a content-bound approval token and the operator's origin allowlist; autonomous self-healing, self-generation, self-evolution, and chaos execution are not shipped. | The system can propose bounded repairs/generation with human review and no hidden auto-merge authority. | Current runtime is not yet a true motor cortex; vision language should not imply it is. Replay Fabric is a good fit for rollback/recovery history and guidance, not restore execution authority. | Repair/generation actions produce reviewable artifacts, verification evidence, externally-owned checkpoint/restore facts, Replay Fabric-style recovery milestones, and human-approval gates. |
| Packaging/release | 0.4.0 removed `SurfClient`, `SurfFlowBuilder`, the `Nexus*` aliases and the default export before any quality floor was measured; the packed surface is proven by `consumer:smoke` (removed names absent, parked quantum/prediction exports present, `Session` exported) and its full inventory is the generated `docs/api/exports.generated.md` that contract-sync holds byte-identical. Package entrypoints, built `dist/`, packed-artifact smoke, root-cause corpus dogfooding, runtime diagnostic corpus dogfooding, packed consumer root-cause and propagation invariant proof, and `release:check` exist; the packed artifact intentionally excludes repo-local `external/bombadil` and verifies the external-tool failure path plus calibrated diagnosis survival through distribution. | Consumers receive only intentional package contents and clear external-tool requirements while release preflight preserves calibrated diagnosis invariants. | Future releases may still revisit vendoring, but the current distribution posture is external Bombadil for packed consumers; the root-cause corpus is bounded fixture proof and the runtime diagnostic corpus is a narrow real-subprocess proof rather than empirical product telemetry. | Release checks prove package contents, CLI entrypoints, root-cause corpus invariants, runtime diagnostic corpus invariants, the external Bombadil requirement, and that packed dist/ produces correct calibrated `root_cause` plus low-calibration non-authoritative `propagation` observations through the library API. |
| Direction substrate | Maintainer planning systems may track strategic frames, implementation waves, tasks, decisions, and evidence; `governance/work-items.json` remains a compatibility projection only. | Product posture selects strategic frames while docs remain narrative/reference. | Keep product posture and capability-surface changes synchronized without turning this file into a live queue mirror. | Maintainer planning state names the next strategic frame or implementation wave without recreating handoff files. |

## Dependency-intelligence consumer posture

Recent dependency-intelligence pilots used `test-capabilities` as a target repo and behavior-validation consumer. CLI startup probes, public API probes, and module-specific probes exposed different dependency contexts without turning runtime observation into removal authority.

The durable boundary is:

```text
test-capabilities owns target source facts, accepted scenarios, and validation response
dependency-intelligence standards/classifications/rendering/security proof stay with their owner repos
```

Say “`test-capabilities` is a dependency-intelligence target/behavior-validation consumer” rather than “`test-capabilities` owns dependency-intelligence standards.”

## Current strengths

- The runtime is fail-closed: unsupported config sections, agents, commands, and flags error instead of pretending success.
- The CLI is backed by a typed operation kernel rather than ad-hoc command branches.
- `test`, `heal`, and `surf explore` have real operation paths (`quantum` stays registered but parked); `heal --dry-run --proposal-output --verification-output` can emit durable proposal and in-memory verification artifacts without mutating files, and apply-mode healing now requires an externally-owned `--checkpoint-ref` before mutating files, with `--proposal-input` available when operators want apply to consume a previously reviewed proposal artifact instead of recomputing proposals.
- `cli-tester`, Surf-backed, and Bombadil-backed orchestrator execution are implemented and covered by contract/regression checks; Surf user-flow coverage is now graded by verified explicit probes instead of process success, and supported agents emit normalized observation events with correlation-gated component-level semantic synthesis, suite-level correlation, calibrated root-cause observations for independent same-component failed-or-errored observed evidence from at least two sensors with same-class agreement, and non-authoritative propagation observations linking dependent component failures through default or operator-configured dependency topology, dogfooded by `npm run root-cause:corpus` and a narrower real-subprocess `npm run runtime-diagnostic:corpus` lane for `cli-tester` calibration.
- Bombadil runtime resolution is explicit: `TEST_CAPABILITIES_BOMBADIL_BIN`, then a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, then repo-local `external/bombadil`, then `bombadil` on `PATH`; Bombadil 0.5-specific browser-test options are typed through `agents.<name>.bombadil`, and the bounded terminal-fuzzer slice is typed through `agents.<name>.terminal`.
- Property tests, behavior scenarios, targeted CI smoke, capability drill, root-cause corpus dogfooding, richer Bombadil smoke, and packed-consumer release checks are part of the verification surface.
- `governance/capability-passport.json` gives a generated inventory of implemented, parked, and unsupported surfaces.
- Nothing reaches the world without a declared effect class, and nothing mutating happens without a receipt on stable storage first: an interrupted mutating run refuses its own repeat until an operator supersedes the receipt it left, and `doctor` reports what is in doubt.
- A verdict is a `Determination` with a basis, so "the command exited 0 and said nothing" is `unverified`, not a pass, and a refusal, an empty result and a target fault are distinguishable in the envelope and in the exit path.
- The durable vision is strong enough to guide future capability selection while the README now provides a truthful current capability contract.

## Current gaps

- `docs/project/vision.md` now separates north-star ambition from shipped capability truth, but it still needs to remain aligned whenever runtime support states change.
- Prediction, collective learning, self-healing intelligence, API fuzzing, chaos, visualization, reports, and several advanced flags remain unsupported.
- Future Bombadil vendoring remains a separate explicit decision: the current package posture is external Bombadil for packed consumers, verified by `consumer:smoke` and documented in `docs/project/bombadil-distribution-posture.md`.
- Maintainer planning records the current strategic frame (`SF1`) and completed implementation waves (`IW1` recovery/distribution proof, `IW2` calibrated root-cause synthesis, `IW3` evidence-backed healing and release readiness, and `IW4` multi-component propagation linkage); the remaining gap is keeping direction references synchronized with product posture without making docs a queue mirror.
- The `heal` surface is useful but not yet the autonomous motor cortex described by the vision.
- Rollback posture needs an explicit checkpoint/restore authority outside test-capabilities plus a replay ledger integration; Replay Fabric appears to fit the ledger/guidance side, but not the executor side.
- Root-cause synthesis is deterministic and diagnostic with a bounded fixture corpus and coverage floors, including same-component mixed-class suppression for CLI/API evidence, linked finding/current-run evidence disagreement suppression, API auth-boundary, API/web network-connectivity, API/CLI/web resource-exhaustion, API/CLI/web configuration-error classification, recommendation-only keyword suppression, component-isolation proof that unrelated ambiguous signals or suppressed ambiguous components do not suppress another component's calibrated same-run diagnosis, simultaneous component-scoped proof for independent CLI/API failures, three-sensor agreement calibration beyond the exactly-two baseline, Bombadil+CLI cross-component simultaneous diagnoses, three-way Surf+CLI+API simultaneous diagnoses, and machine-readable API/CLI/web propagation subject/link coverage for latency linkage into web runtime failure, schema-drift-to-UI runtime failure, same-timeout shared-infra links, plus guardrails that generic component failures, non-latency same-class failures, Surf evidence gaps, auth-boundary failures, network-connectivity failures, resource-exhaustion failures, or configuration errors alone do not imply propagation. A narrow real-subprocess `cli-tester` diagnostic corpus now proves single-sensor suppression, two-sensor `command_resolution`, two-sensor `timeout_or_latency`, same-component mixed-class suppression, correlation-disabled suppression, unique observation IDs, and no prediction/causal/repair-order wording through actual supported agent execution. The broader diagnosis layer is still not empirically broad or predictive; future intelligence/autonomy slices need broader fixture proof and privacy/approval boundaries before they are promoted from aspiration to supported capability.

## Target product experience

A fresh operator should be able to:

1. read `docs/project/vision.md` for durable ambition,
2. read this file for current product maturity and major gaps,
3. read `README.md` for the current fail-closed capability contract and commands,
4. inspect `governance/capability-passport.json` when they need generated capability inventory detail,
5. inspect maintainer planning systems for live direction, task, decision, and evidence truth when available,
6. choose the smallest truthful capability slice,
7. implement through typed runtime contracts, tests, docs, and release checks,
8. leave future work in maintainer planning rather than a repo-local handoff file.

## Near-term convergence path

1. Keep `docs/project/vision.md` aligned with the fail-closed capability contract whenever support states change.
2. Keep the packed-consumer Bombadil external-tool contract and root-cause corpus dogfood lane covered whenever package contents, binary resolution, or diagnosis semantics change; revisit intentional vendoring only through an explicit distribution decision.
3. Keep maintainer planning linked to concrete tasks/evidence as the calibrated diagnosis frontier advances instead of reviving handoff files or markdown micro-plans.
4. Continue broadening the calibrated root-cause corpus beyond the current CLI, Surf, selector/DOM, Bombadil/property, API contract/runtime/auth-boundary/network-connectivity/resource-exhaustion/configuration, same-component mixed-class, linked finding/current-run disagreement, component-isolation, simultaneous component-scoped, three-sensor agreement, multi-component (Bombadil+CLI, Surf+CLI+API) fixtures, and narrow real-subprocess `cli-tester` diagnostic corpus before attempting prediction or autonomy.
5. Use the dry-run healing proposal and verification artifacts, proposal-input apply path, and apply-mode checkpoint-ref requirement as the first recovery-readiness proof objects for future Replay Fabric follow-through.
6. For autonomous repair/generation, keep rollback as an externally-owned checkpoint/restore flow and evaluate Replay Fabric as the recovery-milestone ledger before promoting any runtime support.
7. Treat prediction, collective learning, and autonomous repair/generation as research-to-product promotions: require data shape, privacy posture, acceptance thresholds, deterministic tests, and human-review gates before support-state changes.
8. Keep the generated capability passport current after capability-surface changes.
9. Closed (plan S8): `surf frame.diagnose` is wired into the root-cause workflow as `Session.explainUnreachable`, a read-only observation over the owned tab. Topology is typed evidence and the gate is a separate determination (`excluded`, `confirmed`, `suspected`, `undetermined`, `unavailable`); `frame_boundary` is filed only for `confirmed`, which in this release line requires the test author's `--frame-hint`, and every determination short of exclusion is reported as `browser_coverage_gap` - a limit of the sensor, not a fault of the target. The healer refuses on `confirmed`/`undetermined`/`unavailable` and caveats on `suspected`. New follow-up: the in-frame positive probe (`frame.switch`, a read-only query, switch back) is what would confirm a frame boundary without a hint; it changes extension state for the tab and is designed together with mutation safety. The `SurfClient` class left the public API in 0.4.0 and the kernel `Session` interface replaces it (plan S6); the migration off the retired `surf-go` fork is documented in `docs/project/2026-09-07-surf-cli-migration-live-run.md`.

10. Open (filed as AK #5567): whether the a11y channel's `tabLeak` carries more than evidence. agent-browser 0.35.1 strands one `about:blank` page target per new session, pinned or not, so the packet's page-count check fires on every healthy run; the channel reports the count and the leaked URLs on the captured artifact and changes no verdict. Turning it into a refusal is a P6 amendment, not an implementation choice.
11. Open (filed as AK #5568): `agents.<name>.readySelector` in the config schema. Until it lands, a `test` orchestrator run cannot produce an element-reach failure, so the frame determination reaches the report only through `surf explore --ready-selector`; the agent's copy of the rule is proved by the contract suite and the root-cause corpus.
12. Open (filed as AK #5569): the in-frame positive probe. `frame.switch --index` plus a read-only query for the failing selector is what would confirm a frame boundary without the test author's hint; it changes extension state for the tab and is designed together with mutation safety.
13. Deferred by name in the surf-learnings plan and unchanged by its implementation: `SideEffectWitness` (a network, navigation and DOM witness around read-only steps); `within` landmark scoping and a structured a11y producer; the http adapter row reserved in the adapter table; exit code 2 for the third determination state (operator decision D3 keeps 0/1 until consumers read the envelope); a shared `Spec` artifact for LLM-authored replayable tests; a persistent CI receipt store (the runtime refuses an ephemeral one instead); a cross-run receipt index; per-click Bombadil receipts; and the `src/core/kernel/` + `src/core/adapters/` directory move (the rings are an import rule the structure check enforces, not a directory).
14. Standing structure debt, each with a ledger entry naming its scheduled shrink: `orchestrator.ts` (1721 lines; correlation, root cause and propagation move to a diagnosis consumer), `self-healing.ts` (1192; the strategy list and the write path split), `surf-explore-operation.ts` (1033; the probe/coverage split) and `surf-runtime.ts` (845; the argv translation table moves behind the adapter's `translate()` seam).

## Hard rules for status language

- Say "implemented" only when a capability has a real runtime path plus tests/docs appropriate to its surface.
- Say "unsupported" when the runtime intentionally fails closed.
- Say "parked" for present artifacts that are not consumer-facing supported capabilities.
- Say "future vision" for prediction, collective learning, self-generation, self-evolution, and broad autonomy until they have proof-backed runtime contracts.
- Say "Replay Fabric can record recovery milestones and bounded guidance" rather than "Replay Fabric performs rollback."
- Say "Bombadil agent is supported" but "vendored Bombadil binary is parked as a consumer-facing package surface" unless the distribution policy changes.
- Say "maintainer planning systems own live task/direction/evidence truth" rather than encoding current queue state in docs.
- Say "product posture guides strategic selection" rather than "product posture is the current plan."

## Authority map

- Durable ambition: `docs/project/vision.md`
- Product posture: this file
- Current capability contract and commands: `README.md`
- Runtime capability matrix: `src/core/capability-matrix.ts` (leaf: agents, intelligence, quantum, chaos) composed with the CLI statuses in `src/core/capabilities.ts`
- Config schema: `src/core/config.ts`
- Operation kernel: `src/core/operations.ts` and `src/core/operations/`
- Orchestrator runtime: `src/core/orchestrator.ts`
- Bombadil runtime: `src/core/bombadil-runtime.ts`
- Generated capability inventory: `governance/capability-passport.json`
- Capability-passport generator: `scripts/generate-capability-passport.mjs`
- Live execution truth: maintainer planning tasks, direction, decisions, evidence, and receipts where available
- Compatibility projection only: `governance/work-items.json`
- Focused implementation plans: `docs/dev/plans/`
- Crystallized learning: `docs/learnings/` when present
