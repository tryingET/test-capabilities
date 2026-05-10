---
summary: "Product posture snapshot for test-capabilities: current capability maturity, truthful runtime boundary, major gaps, and proof signals."
read_when:
  - "When selecting or reviewing test-capabilities product direction from current maturity rather than task history"
  - "When deciding whether a testing capability is implemented, bounded, unsupported, or future vision"
  - "When bridging docs/project/vision.md to AK direction, tasks, decisions, or capability-passport evidence"
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
- AK task, decision, direction, evidence, or receipt authority
- `docs/project/vision.md` as the durable north-star narrative
- `governance/capability-passport.json` as the generated capability inventory
- focused implementation plans under `docs/dev/plans/` when a non-trivial change needs design capture

Do not turn this file into a task log, changelog, queue mirror, handoff file, or second direction substrate.

## Posture in one sentence

`test-capabilities` has crossed from aspirational testing-framework narrative into a fail-closed TypeScript CLI/package with an operation kernel, supported `test`/`quantum`/`heal`/`surf explore` routes, implemented `cli-tester`, `surf`, and Bombadil-backed orchestrator paths, normalized observation events, deterministic calibrated root-cause observations for independent same-component failed-or-errored observed evidence from at least two sensors with same-class agreement, property/behavior/release checks, and a generated capability passport; its main maturity gap is now validating deeper cross-sensor synthesis empirically without blurring supported runtime behavior with the larger autonomous-testing vision.

## Product maturity map

| Area | Current posture | Target posture | Main gap | Proof of closure |
|---|---|---|---|---|
| Capability contract | Runtime support is explicit and fail-closed through `src/core/capabilities.ts`, the operation registry, and contract tests. Unsupported agents, commands, flags, and intelligence surfaces fail clearly. | Operators can trust that every advertised capability is wired to a real implementation path with tests, docs, and release checks. | Some narrative docs still describe future autonomy/prediction as if it were product behavior. | README, vision, posture, capability passport, and tests agree on implemented vs unsupported vs future surfaces. |
| Operation kernel | CLI routes run through `src/core/operations.ts` and trust-sized operation modules. | Adding a new command or adapter means adding a typed route, schema, executor, result envelope, docs, and contract tests. | The kernel can grow into a central bottleneck if more verbs/adapters are added without another split. | A new capability lands without duplicating CLI wrapper logic or inflating `operations.ts` beyond a manifest/export seam. |
| Orchestrator sensors | `cli-tester`, `surf`, and `bombadil` are implemented; Surf wraps the supported `surf explore` path, standardizes on Surf Go from env/workspace/`PATH`, verifies explicit browser-state/DOM/link probes, supports bounded same-origin `--depth` exploration, and fails closed on invalid explicit Surf Go repo env vars or unverified seed Surf output; Bombadil resolves from explicit env, built contrib checkout, repo-local binary, or `PATH`. Packed consumers intentionally treat Bombadil as an external binary requirement. | Sensor integrations become a small, typed parliament of real observers with normalized findings and evidence. | `api-fuzzer` remains unsupported; packed Bombadil consumers must provide an external Bombadil binary, and Surf consumers must provide a resolvable Surf Go runtime. | Supported sensors have deterministic fixtures/smokes, generated passport evidence, and packed-consumer proof for external binary requirements. |
| Intelligence layer | Finding correlation exists inside the orchestrator, supported agents emit `observation.v1` diagnostic events, and the orchestrator can add non-authoritative component-level semantic synthesis, suite-level observation correlation, and deterministic calibrated `root_cause` observations for independent same-component failed-or-errored observed evidence from at least two sensors with same-class agreement; `root-cause:corpus` dogfoods CLI, API, Surf, selector/DOM, and Bombadil/property ambiguity with machine-readable coverage floors. Prediction, collective learning, and self-healing intelligence flags are unsupported. | Cognitive surfaces turn observations into correlation, synthesis, calibrated diagnosis, and eventually prediction while preserving budget and local/privacy constraints. | Root-cause observations are deterministic and evidence-bounded, but the corpus is still fixture-based and heuristic rather than empirically broad; prediction and collective learning remain vision-level until backed by empirical/runtime proof. | A broader calibrated root-cause corpus has measurable inputs, deterministic tests, acceptance thresholds, and explicit privacy posture before any prediction promotion. |
| Motor/autonomy layer | `heal` provides a heuristic selector repair workflow; autonomous self-healing, self-generation, self-evolution, and chaos execution are not shipped. | The system can propose bounded repairs/generation with human review and no hidden auto-merge authority. | Current runtime is not yet a true motor cortex; vision language should not imply it is. Replay Fabric is a good fit for rollback/recovery history and guidance, not restore execution authority. | Repair/generation actions produce reviewable artifacts, verification evidence, externally-owned checkpoint/restore facts, Replay Fabric-style recovery milestones, and human-approval gates. |
| Packaging/release | Package entrypoints, built `dist/`, packed-artifact smoke, root-cause corpus dogfooding, and `release:check` exist; the packed artifact intentionally excludes repo-local `external/bombadil` and verifies the external-tool failure path. | Consumers receive only intentional package contents and clear external-tool requirements while release preflight preserves calibrated diagnosis invariants. | Future releases may still revisit vendoring, but the current distribution posture is external Bombadil for packed consumers; the root-cause corpus is bounded fixture proof rather than empirical product telemetry. | Release checks prove package contents, CLI entrypoints, root-cause corpus invariants, and the external Bombadil requirement. |
| Direction substrate | AK is canonical task/direction authority where available; this repo has a native strategic frame (`SF1`), the recovery/distribution proof wave is completed (`IW1`), and the next work wave is calibrated root-cause synthesis (`IW2`), while `governance/work-items.json` remains a compatibility projection only. | Product posture selects strategic frames, AK carries live direction/tasks/decisions/evidence, and docs remain narrative/reference. | Keep product posture, AK direction, and capability-surface changes synchronized without turning this file into a live queue mirror. | AK direction/task state names the next strategic frame or implementation wave without recreating handoff files. |

## Current strengths

- The runtime is fail-closed: unsupported config sections, agents, commands, and flags error instead of pretending success.
- The CLI is backed by a typed operation kernel rather than ad-hoc command branches.
- `test`, `quantum`, `heal`, and `surf explore` have real operation paths; `heal --dry-run --proposal-output --verification-output` can emit durable proposal and in-memory verification artifacts without mutating files, and apply-mode healing now requires an externally-owned `--checkpoint-ref` before mutating files.
- `cli-tester`, Surf-backed, and Bombadil-backed orchestrator execution are implemented and covered by contract/regression checks; Surf user-flow coverage is now graded by verified explicit probes instead of process success, and supported agents emit normalized observation events with correlation-gated component-level semantic synthesis, suite-level correlation, and calibrated root-cause observations for independent same-component failed-or-errored observed evidence from at least two sensors with same-class agreement, dogfooded by `npm run root-cause:corpus`.
- Bombadil runtime resolution is explicit: `TEST_CAPABILITIES_BOMBADIL_BIN`, then a built checkout from `TEST_CAPABILITIES_BOMBADIL_REPO` or conventional `softwareco/contrib/bombadil`, then repo-local `external/bombadil`, then `bombadil` on `PATH`.
- Property tests, behavior scenarios, targeted CI smoke, capability drill, root-cause corpus dogfooding, richer Bombadil smoke, and packed-consumer release checks are part of the verification surface.
- `governance/capability-passport.json` gives a generated inventory of implemented, parked, and unsupported surfaces.
- The durable vision is strong enough to guide future capability selection while the README now provides a truthful current capability contract.

## Current gaps

- `docs/project/vision.md` now separates north-star ambition from shipped capability truth, but it still needs to remain aligned whenever runtime support states change.
- Prediction, collective learning, self-healing intelligence, API fuzzing, chaos, visualization, reports, and several advanced flags remain unsupported.
- Future Bombadil vendoring remains a separate explicit decision: the current package posture is external Bombadil for packed consumers, verified by `consumer:smoke`.
- AK-native direction now names the current strategic frame and work wave; the remaining gap is keeping direction references synchronized with product posture without making docs a queue mirror.
- The `heal` surface is useful but not yet the autonomous motor cortex described by the vision.
- Rollback posture needs an explicit checkpoint/restore authority outside test-capabilities plus a replay ledger integration; Replay Fabric appears to fit the ledger/guidance side, but not the executor side.
- Root-cause synthesis is deterministic and diagnostic with a bounded fixture corpus and coverage floors, including same-component mixed-class suppression for CLI/API evidence, linked finding/current-run evidence disagreement suppression, component-isolation proof that unrelated ambiguous signals or suppressed ambiguous components do not suppress another component's calibrated same-run diagnosis, simultaneous component-scoped proof for independent CLI/API failures, three-sensor agreement calibration beyond the exactly-two baseline, Bombadil+CLI cross-component simultaneous diagnoses, and three-way Surf+CLI+API simultaneous diagnoses. It is still not empirically broad or predictive; future intelligence/autonomy slices need broader fixture proof and privacy/approval boundaries before they are promoted from aspiration to supported capability.

## Target product experience

A fresh operator should be able to:

1. read `docs/project/vision.md` for durable ambition,
2. read this file for current product maturity and major gaps,
3. read `README.md` for the current fail-closed capability contract and commands,
4. inspect `governance/capability-passport.json` when they need generated capability inventory detail,
5. inspect AK for live direction, task, decision, and evidence truth,
6. choose the smallest truthful capability slice,
7. implement through typed runtime contracts, tests, docs, and release checks,
8. leave future work in AK direction/tasks/decisions rather than a repo-local handoff file.

## Near-term convergence path

1. Keep `docs/project/vision.md` aligned with the fail-closed capability contract whenever support states change.
2. Keep the packed-consumer Bombadil external-tool contract and root-cause corpus dogfood lane covered whenever package contents, binary resolution, or diagnosis semantics change; revisit intentional vendoring only through an explicit distribution decision.
3. Keep AK-native direction (`SF1`, completed `IW1`, next `IW2`) linked to concrete tasks/evidence as the calibrated root-cause frontier advances instead of reviving handoff files or markdown micro-plans.
4. Continue broadening the calibrated root-cause corpus beyond the current CLI, Surf, selector/DOM, Bombadil/property, API contract/runtime, same-component mixed-class, linked finding/current-run disagreement, component-isolation, simultaneous component-scoped, three-sensor agreement, and multi-component (Bombadil+CLI, Surf+CLI+API) fixtures before attempting prediction or autonomy.
5. Use the dry-run healing proposal and verification artifacts plus the apply-mode checkpoint-ref requirement as the first recovery-readiness proof objects for future Replay Fabric follow-through.
6. For autonomous repair/generation, keep rollback as an externally-owned checkpoint/restore flow and evaluate Replay Fabric as the recovery-milestone ledger before promoting any runtime support.
7. Treat prediction, collective learning, and autonomous repair/generation as research-to-product promotions: require data shape, privacy posture, acceptance thresholds, deterministic tests, and human-review gates before support-state changes.
8. Keep the generated capability passport current after capability-surface changes.

## Hard rules for status language

- Say "implemented" only when a capability has a real runtime path plus tests/docs appropriate to its surface.
- Say "unsupported" when the runtime intentionally fails closed.
- Say "parked" for present artifacts that are not consumer-facing supported capabilities.
- Say "future vision" for prediction, collective learning, self-generation, self-evolution, and broad autonomy until they have proof-backed runtime contracts.
- Say "Replay Fabric can record recovery milestones and bounded guidance" rather than "Replay Fabric performs rollback."
- Say "Bombadil agent is supported" but "vendored Bombadil binary is parked as a consumer-facing package surface" unless the distribution policy changes.
- Say "AK owns live task/direction/evidence truth" rather than encoding current queue state in docs.
- Say "product posture guides strategic selection" rather than "product posture is the current plan."

## Authority map

- Durable ambition: `docs/project/vision.md`
- Product posture: this file
- Current capability contract and commands: `README.md`
- Runtime capability matrix: `src/core/capabilities.ts`
- Operation kernel: `src/core/operations.ts` and `src/core/operations/`
- Orchestrator runtime: `src/core/orchestrator.ts`
- Bombadil runtime: `src/core/bombadil-runtime.ts`
- Generated capability inventory: `governance/capability-passport.json`
- Capability-passport generator: `scripts/generate-capability-passport.mjs`
- Live execution truth: AK task, direction, decision, evidence, and receipts
- Compatibility projection only: `governance/work-items.json`
- Focused implementation plans: `docs/dev/plans/`
- Crystallized learning: `docs/learnings/` when present
