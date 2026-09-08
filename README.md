---
summary: "Project overview and operator guide for test-capabilities."
read_when:
  - "You are onboarding to test-capabilities"
  - "You need commands, structure, or current repo scope"
type: "reference"
---

# test-capabilities

Fail-closed testing capability framework for CLI, browser, property, healing, and diagnostic root-cause workflows.

> Previously tracked in this workspace as `testers`.

## Vision

> *We don't build tests. We build the immune system of software.*

See [docs/project/vision.md](docs/project/vision.md) for the durable north-star vision and [docs/project/product-posture.md](docs/project/product-posture.md) for the current product maturity snapshot.

## Components

| Path | Description |
|------|-------------|
| `src/` | TEST-CAPABILITIES testing framework (operation kernel, orchestrator, self-healing; the quantum simulator and prediction engine are parked: present, tested, not testing capabilities) |
| `bin/test-capabilities` | TEST-CAPABILITIES CLI |
| `external/bombadil` | Parked repo-local Bombadil-compatible binary fallback, intentionally excluded from packed npm artifacts |
| `examples/demo/` | Built-in zero-external-dependency demo fixture for first functional proof |
| `prompts/` | LLM testing prompts (cli-tester, web-tester, api-tester) |
| `docs/` | Testing guides and frameworks |

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/project/vision.md](docs/project/vision.md) | Durable product vision and strategic direction |
| [docs/project/product-posture.md](docs/project/product-posture.md) | Current product maturity, supported/unsupported boundary, and major gaps |
| [docs/TEST-CAPABILITIES-FRAMEWORK.md](docs/TEST-CAPABILITIES-FRAMEWORK.md) | TEST-CAPABILITIES autonomous testing framework |
| [docs/LLM-TESTING-GUIDE.md](docs/LLM-TESTING-GUIDE.md) | Guide for LLM-driven testing |
| [docs/DECISION-MATRIX.md](docs/DECISION-MATRIX.md) | Tool selection decision matrix |
| [docs/adoption/](docs/adoption/) | Greenfield, brownfield, minimal first-run, and Bombadil 0.5 adoption guides |
| [docs/dev/ts-quality-screening.md](docs/dev/ts-quality-screening.md) | Repo-local deterministic screening proof path via `ts-quality` |
| [docs/npm-publishing-checklist.md](docs/npm-publishing-checklist.md) | Public npm release readiness checklist |
| [docs/releases/release-workflow.md](docs/releases/release-workflow.md) | GitHub Release → npm Trusted Publishing workflow |
| [docs/api/](docs/api/) | TEST-CAPABILITIES API reference docs |

## Polished core use case

The first public release is centered on one zero-external-dependency flow: **CLI smoke + observation diagnostics**.

```bash
node ./bin/test-capabilities doctor --json
node ./bin/test-capabilities demo --json
```

This proves the package can load, run a real CLI command through `cli-tester`, and emit `observation.v1` diagnostic evidence without a surf CLI, Bombadil, network access, or a target application.
For the full `doctor -> init -> demo -> test --json` path, use [Minimal CLI smoke walkthrough](docs/adoption/minimal-cli-smoke-walkthrough.md). For adoption strategy, use [Greenfield bootstrap](docs/adoption/greenfield-bootstrap-how-to.md) or [Brownfield integration](docs/adoption/brownfield-integration-how-to.md). See [`examples/demo/README.md`](examples/demo/README.md) for the packaged demo fixture.

## Capability Contract

The runtime is now fail-closed.
If a config section, agent, command, or flag is not wired to a real implementation path, the CLI errors instead of pretending success.

First public happy path:

```bash
npx test-capabilities doctor
# or from a checkout
node ./bin/test-capabilities doctor --json
```

`doctor` has no Surf/Bombadil requirement: missing optional external runtimes are reported as warnings while package/runtime readiness checks remain required. When a surf CLI is found, `doctor` probes its version and mechanisms and runs `surf doctor --browser <TEST_CAPABILITIES_SURF_BROWSER|chromium> --json`, reporting the native-host socket and manifest state.

The shipped CLI verbs now run through a typed **operation kernel** exposed at `src/core/operations.ts` and implemented in trust-sized modules under `src/core/operations/`.
That registry owns the supported routes, their input schemas, their executors, and their structured result shapes so the CLI wrapper stays thin.
For Surf-backed web exploration, the runtime is the upstream [nicobailon/surf-cli](https://github.com/nicobailon/surf-cli) CLI (`surf`, v2.18.0) built from the `feat/site-independent-mechanisms` branch, which adds typed page readiness (`wait.ready`/`page.readiness`), owned-tab extraction (`extract`) and `frame.diagnose`. The supported orchestrator resolves it through `TEST_CAPABILITIES_SURF_BIN`, `surf` on `PATH`, or `~/.local/bin/surf`, probes `surf --version` and `surf --help-full`, and refuses to explore with a build that lacks `wait.ready` or `extract` instead of degrading silently. The retired `surf-go` fork is not supported: `TEST_CAPABILITIES_SURF_GO_BIN`/`TEST_CAPABILITIES_SURF_GO_REPO` fail closed with a retirement message. `surf explore` opens its own tab (`tab.new`), gates it with `wait.ready` (login, challenge, not-found, error and timeout states refuse the page with the surf error code), runs explicit browser-state/DOM probes through `js`, extracts same-origin links through `extract` for bounded `--depth` exploration from 1-3, closes the tab, and reports graded user-flow coverage from verified probe counts; empty output, non-JSON output, and probe results without a matching browser-state URL fail closed as unverified coverage. The `SURF_SOCKET` environment variable is passed through to the surf CLI unchanged.
For Bombadil-backed web exploration, the supported orchestrator resolves the binary through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, repo-local `external/bombadil`, or `bombadil` on `PATH`.
A Bombadil-compatible source checkout only overrides the parked repo-local fallback once it has a built `target/release/bombadil` or `target/debug/bombadil`; upstream Bombadil 0.5 centralizes builds and no longer requires `esbuild`, though local source builds may still need project-specific prerequisites such as `trunk` or the project Nix shell.
Bombadil 0.5 request headers, trace output paths, trace reproduction, viewport/instrumentation/permission knobs, and `test-external` debugger settings are exposed through `agents.<name>.bombadil` config. Bombadil's disabled-control skipping, quiescence timers, and dialog auto-accept behavior come from the resolved Bombadil binary itself. A bounded experimental `terminal-fuzzer` agent wraps `bombadil terminal test -- <command> [args...]` and emits normalized `observation.v1` runtime evidence whose subject is the resolved terminal command, without claiming production stability or autonomy.
Packed npm consumers should treat Bombadil as an external tool requirement: the package intentionally excludes `external/bombadil`, and `npm run consumer:smoke` verifies that a packed consumer without `TEST_CAPABILITIES_BOMBADIL_BIN`, `TEST_CAPABILITIES_BOMBADIL_REPO`, or `bombadil` on `PATH` receives a clear failing Bombadil finding instead of a fake pass. See [docs/project/bombadil-distribution-posture.md](docs/project/bombadil-distribution-posture.md) and [docs/adoption/bombadil-0.5-how-to.md](docs/adoption/bombadil-0.5-how-to.md). The same packed-consumer smoke also proves calibrated `root_cause` and low-calibration non-authoritative `propagation` observations survive through the distributed library API.

### Implemented today

| Surface | Status | Notes |
|---------|--------|-------|
| `doctor` command | Implemented | Zero-external-dependency package and environment diagnostics; optional surf CLI/Bombadil-compatible runtimes warn when absent instead of failing; a found surf CLI is probed for version, mechanisms and `surf doctor` socket/manifest state |
| `init` command | Implemented | Generates a minimal valid `test-capabilities.yaml` for the zero-external-dependency `cli-tester` path and refuses overwrites without `--force` |
| `demo` command | Implemented | Built-in zero-external-dependency functional demo for the polished `cli-smoke-observation` use case |
| `test` command | Implemented | Supports `--config`, `--target`, `--quick`; URL targets apply when `quantum.enabled: true` or a supported `bombadil`/`surf` agent is enabled, and they only replace `targets.cli` when no `cli-tester` smoke is enabled |
| `bombadil` orchestrator agent | Implemented | Runs a bounded Bombadil exploration budget against `targets.web`; resolves the binary through explicit env, a built source checkout, repo-local parked fallback, or `PATH` |
| `terminal-fuzzer` orchestrator agent | Implemented | Experimental bounded wrapper for `bombadil terminal test -- <command> [args...]`; emits `observation.v1` runtime evidence for the resolved CLI/terminal command and fails closed on missing Bombadil or target command |
| `surf` orchestrator agent | Implemented | Runs the supported `surf explore` operation against `targets.web`; resolves the surf CLI from `TEST_CAPABILITIES_SURF_BIN`, `PATH`, or `~/.local/bin/surf`, then reports graded user-flow coverage from verified browser-state/DOM probes |
| `cli-tester` orchestrator agent | Implemented | Executes `<targets.cli> --help` as a capability-backed smoke |
| `surf explore` | Implemented | Opens an owned surf tab, gates it with `wait.ready` typed states, runs explicit browser-state/DOM probes, optionally follows same-origin links through `extract` with `--depth 1..3`, and fails closed unless the seed page verifies browser-state evidence |
| `heal` command | Implemented | Heuristic selector repair workflow; `--findings-input` accepts orchestrator findings JSON so proposals cite diagnostic evidence as `triggeringFindingId`; apply mode can consume a reviewed `--proposal-input` artifact and still requires an external `--checkpoint-ref` |
| normalized observations | Implemented | Supported orchestrator agents emit `observation.v1` diagnostic events for Surf coverage, Bombadil property exploration, and CLI smoke execution; when correlation is enabled, runs can also include component-level semantic synthesis, suite-level observation correlation, deterministic `root_cause` observations for at least two same-component independent failed-or-errored observed evidence units that agree on the same failure class, and low-calibration non-authoritative `propagation` observations across configured dependency edges |
| finding correlation | Implemented | Cross-finding synthesis inside the orchestrator; observation-native synthesis and calibrated root-cause observations summarize multi-sensor meaning without becoming pass/fail authority or prediction |

### Parked (present, tested, not testing capabilities)

Operator decision D1 (2026-09-07) keeps these in the runtime with no route deletion, marked truthfully:

| Surface | Status | Notes |
|---|---|---|
| `quantum` command | Parked | The route stays registered and its simulator tests pass, but it contacts no target and produces no target evidence; it never writes a `Finding` or `Observation` and never influences `TestResult.passed` or the run determination; `dist/quantum/**` is excluded from the coverage floor |
| `QuantumSimulator` / `QuantumTestRunner` library API | Parked | Same rule as the command; exported for library consumers, not a testing capability |
| `PredictionEngine` / `PredictionCollector` / `GradientBoostingPredictor` library API | Parked | Produces no target evidence; the `intelligence.prediction` config flag stays unsupported and fails closed; `dist/prediction/**` is excluded from the coverage floor |

### Explicitly unsupported for now

These surfaces fail clearly when enabled or invoked:

- orchestrator agents: `api-fuzzer`
- orchestrator intelligence flags: `self_healing`, `prediction`, `collective`
- `chaos` execution
- CLI commands: `predict`, `visualize`, `report`
- `test` flags: `--autonomous`, `--self-heal`, `--predict`, `--fail-threshold`, `--upload-artifacts`, `--report`
- surf actions: `flow`, `assert`, `compare`, `replay`

## Changes in 0.4.0

The 0.4.0 line removes surface before any quality floor is measured, then adds the kernel objects from the 2026-09-07 surf-learnings plan. Removed at 0.4.0 (each with its replacement):

| Removed | Replacement |
|---|---|
| `SurfClient` and `SurfFlowBuilder` (library exports) and the `SurfConfig`/`SurfSnapshot`/`SurfElement`/`SurfActionResult`/`NetworkRequest`/`SurfExtract*`/`SurfReadiness*`/`SurfWaitReadyOptions`/`SurfFrameDiagnosis` types | the kernel `Session` interface with `SurfSession` (`open`, `gate`, `step`, `evaluate`, `observe`, `close`; one owned tab, closed in `finally`), exported from the package root - see `docs/api/api-surf.md`. The CLI path `test-capabilities surf explore` and `executeCliOperation({ command: 'surf', action: 'explore' }, { url })` are the same step list over that session. |
| `createNexus`, `NexusOrchestrator`, `NexusConfig`, the default export | `createTestCapabilities`, `TestCapabilitiesOrchestrator`, `TestCapabilitiesConfig` |
| `command-runner` internals and `scripts/test-agent-browser.sh` | none (dead code; the script launched its own Chrome against the owned-browser rule) |

Also in this line: the config schema lives in `src/core/config.ts` and is exported from the package root under the same names; `heal` derives `appliedCount` from proven writes and refuses to re-apply a healed selector as a prefix; the runtime import cycle that broke deep imports of `dist/core/operations/dispatch.js` is gone; `quantum` and the prediction engine are marked parked (see below).

The browser surface is a scope, not an object with authority. Every surf command carries a static effect class the caller cannot override; the run acts only in a tab it created (`owned_tab_required` otherwise); page-side `js` has no class until the caller declares one, and a `read_only` claim is checked against a denylist before any process starts (`read_only_violation`); a read-only attempt whose own evidence shows the page moved forfeits its retry budget (`read_only_violation_observed`); and a browser step whose process reported nothing is `unknown` behind a receipt, never a target fault. Later slices append here.

## Commands

```bash
# Quality gates
npm run check          # Full CI check (lint + test)
npm run lint           # Lint check
npm run fix            # Auto-fix lint issues
npm run consumer:smoke # Packed-artifact consumer contract smoke
npm run truth:gate       # Cross-check portable runtime/package/docs/passport truth surfaces
npm run release:check    # Release preflight (quality + truth-gated diagnostic corpora + packed-artifact verification)

# First-run proof (full walkthrough: docs/adoption/minimal-cli-smoke-walkthrough.md)
node ./bin/test-capabilities doctor
node ./bin/test-capabilities demo --json

# Build
npm run build          # TypeScript build

# TEST-CAPABILITIES CLI
npm run test-capabilities                # Run TEST-CAPABILITIES CLI
node ./bin/test-capabilities init --output ./test-capabilities.yaml --target node --force
node ./bin/test-capabilities doctor --config ./test-capabilities.yaml --target node --json
node ./bin/test-capabilities test --config ./test-capabilities.yaml --json
node ./bin/test-capabilities quantum --target https://example.com   # parked route (D1): simulator output, no target evidence
node ./bin/test-capabilities surf explore --url https://example.com
node ./bin/test-capabilities heal --dir ./tests --dry-run
node ./bin/test-capabilities heal --dir ./tests --dry-run \
  --proposal-output artifacts/heal-proposals.json \
  --verification-output artifacts/heal-verification.json
node ./bin/test-capabilities heal --dir ./tests --dry-run \
  --findings-input artifacts/orchestrator-findings.json \
  --proposal-output artifacts/heal-proposals.json
node ./bin/test-capabilities heal --dir ./tests --checkpoint-ref checkpoint/test-capabilities/heal-001
node ./bin/test-capabilities heal --dir ./tests \
  --proposal-input artifacts/heal-proposals.json \
  --checkpoint-ref checkpoint/test-capabilities/heal-001

# Testing
npm test                  # Run node contract tests
npm run test:property     # fast-check invariant lane for config, route selection, and orchestrator behavior
npm run test:behavior     # cucumber-backed CLI workflow scenarios mapped to docs/examples
npm run test:ci-targeted  # CI-targeted smoke tests
npm run capability:drill  # Repo-local end-to-end drill for shipped capabilities
npm run root-cause:corpus        # Dogfood calibrated root-cause diagnosis invariants
npm run runtime-diagnostic:corpus # Dogfood calibrated diagnosis through real cli-tester subprocesses
npm run bombadil:smoke           # Richer Bombadil regression smoke against a deterministic local fixture

# Docs discovery
npm run docs:list            # List relevant docs for a task
npm run docs:list:workspace  # Workspace-wide doc scan
```

## Screening proof path

Repo-local `ts-quality` screening currently starts with a narrow operation-kernel slice over the test-capabilities source surface. For the wrapper, commands, and changed-scope rules, see [docs/dev/ts-quality-screening.md](docs/dev/ts-quality-screening.md).

## Capability drill

To exercise the shipped capabilities against deterministic local fixtures, run:

```bash
npm run capability:drill
```

What it checks today:
- `test` succeeds on a real CLI smoke target and rejects inert URL overrides in quick mode
- `quantum` succeeds on an explicit local URL and fails closed when `--target` is missing
- `heal` proposes selector fixes without rewriting payload literals or custom-helper strings
- `heal --dry-run --proposal-output <file> --verification-output <file>` writes durable proposal and in-memory verification artifacts for review or future replay-ledger follow-through without mutating files
- `heal` requires `--checkpoint-ref` from an external checkpoint/restore authority before applying proposals that mutate files
- `heal --proposal-input <artifact> --checkpoint-ref <ref>` applies proposals from a previously emitted proposal artifact instead of recomputing them during apply
- `surf explore` runs through the shipped wrapper path and rejects invalid URLs
- `test` runs a surf-backed orchestrator agent against a deterministic local fixture
- library drills for orchestrator correlation and prediction input validation; contract tests cover calibrated root-cause observation synthesis

Surf modes:

```bash
# Auto-detect: use the real surf CLI when `surf doctor` is OK, otherwise a deterministic shim
npm run capability:drill

# Force the deterministic shim path
bash ./scripts/capability-drill.sh --surf-mode shim

# Require a real surf CLI whose `surf doctor --browser chromium` is OK
bash ./scripts/capability-drill.sh --surf-mode real

# Emit machine-readable JSON for automation
bash ./scripts/capability-drill.sh --json --surf-mode shim --skip-build
```

The JSON mode returns a structured summary with `ok`, `surfMode`, `summary`, and per-check status entries so CI or agent tooling can consume the drill result without scraping terminal text.

## Root-cause calibration corpus

To dogfood the calibrated diagnostic layer against deterministic fixture cases, use:

```bash
npm run root-cause:corpus
```

To prove the same root-cause synthesis path through real supported `cli-tester` subprocess execution, use:

```bash
npm run runtime-diagnostic:corpus
```

What it checks today:
- single-agent CLI or Surf failures do not emit `root_cause`
- two independent observed CLI command-resolution or timeout failures classify as `command_resolution` or `timeout_or_latency`, including shell not-found wording, while app crashes do not masquerade as command resolution
- two independent observation-only API signals can classify as `contract_mismatch`, including API contract violation, property-kind payload evidence, and response-payload/required-field wording that must not masquerade as Bombadil/property failure or selector drift
- bounded non-contract classes include API authentication/authorization evidence as `auth_or_permission`, API/web connection/DNS/TLS evidence as `network_connectivity`, API/CLI/web rate-limit/quota/memory/disk/file-descriptor/pool-exhaustion evidence as `resource_exhaustion`, and API/CLI/web missing environment/configuration evidence as `configuration_error`
- executable-resolution evidence still classifies as `command_resolution` even when the missing executable is named `config` or `app-config`; real config-file/value evidence remains `configuration_error`
- generic API runtime, property-kind runtime, stack-trace, validation, or schema exceptions without contract/auth/network/resource/configuration evidence remain `component_failure_surface`; recommendation-only keywords are not classifying evidence
- two independent observed Surf failures classify as `browser_coverage_gap`, including generic DOM coverage wording that must not masquerade as selector drift
- two independent observed selector/DOM drift failures classify as `selector_or_dom_drift`, including selector-contract wording, while single-sensor or unobserved selector drift does not emit `root_cause`
- two independent observed Bombadil failures classify as `property_violation`, including required-property validation wording that must not masquerade as API contract mismatch
- two independent sensors linked to the same API finding classify as `contract_mismatch`, even when generic browser words appear in the observations
- finding-only, mixed-class evidence, all-passing linked sensors, single-sensor multi-finding, unobserved conflicting findings, partially observed evidence pairs, linked finding/current-run evidence disagreement, and same-component mixed CLI/API failure classes do not emit `root_cause`
- unrelated ambiguous signals in one component, including a suppressed same-component mixed-class ambiguity, do not suppress a calibrated same-run diagnosis for another component
- independent CLI and API failures can emit simultaneous component-scoped `root_cause` observations
- three-sensor agreement produces high-calibration `root_cause` with signalCount and sensorCount reflecting all three observers
- independent Bombadil + CLI failures emit two component-scoped `root_cause` observations (property_violation + command_resolution)
- three-way simultaneous Surf + CLI + API failures emit three component-scoped `root_cause` observations
- propagation synthesis covers default `api -> web`, `cli -> api`, and `cli -> web` edges, including API latency links with web runtime failures, same-timeout shared-infra links, and API schema-drift-to-UI links with web runtime failures; it supports `intelligence.propagationTopology` overrides for custom edges, suppresses generic component-failure-only, non-latency same-class, and Surf evidence-gap overclaims, and stays low-calibration/non-authoritative
- root-cause and propagation output exclude prediction language and synthetic `corr-*` IDs; auth-boundary, network-connectivity, resource-exhaustion, or configuration failures do not imply downstream propagation without a separately promoted bounded link

Machine-readable mode emits aggregate coverage floors, exact release truth-lock counts, per-case expected/actual classification, root-cause count, calibration counts, linked finding IDs, propagation counts, propagation subjects, propagation links, and no-propagation guardrail markers for automation without scraping terminal text. Runtime observations also expose structured `semantics.failureClass` for `root_cause` and `semantics.propagationLink` for `propagation` while retaining evidence strings for backward-compatible inspection:

```bash
npm run --silent root-cause:corpus -- --json
npm run --silent runtime-diagnostic:corpus -- --json
```

The runtime diagnostic corpus is intentionally narrower than the fixture corpus: it creates temporary local CLI fixtures and checks single-sensor suppression, two-sensor `command_resolution`, two-sensor `timeout_or_latency`, same-component mixed-class suppression, correlation-disabled suppression, unique observation IDs, and absence of prediction/causal/repair-order language without using network, databases, or external binaries.

## Bombadil richer smoke fixture

To run a richer local Bombadil regression against a deterministic multi-control fixture, use:

```bash
npm run bombadil:smoke
```

What it does:
- serves `examples/bombadil-rich/site/` on a temporary local port
- runs Bombadil directly and expects trace artifacts under a temporary output directory
- runs `test-capabilities test --quick` with a Bombadil-backed config against the same local fixture

Useful options:

```bash
# Reuse an already-built dist/
bash ./scripts/bombadil-rich-smoke.sh --skip-build

# Run only the direct Bombadil phase
bash ./scripts/bombadil-rich-smoke.sh --direct-only

# Run only the TEST-CAPABILITIES wrapper phase
bash ./scripts/bombadil-rich-smoke.sh --tc-only

# Keep the generated fixture/output directory for inspection
bash ./scripts/bombadil-rich-smoke.sh --keep-temp
```

The richer fixture currently lives at `examples/bombadil-rich/site/` and includes intra-origin navigation, toggles, select inputs, a form, and stateful UI so Bombadil can explore more than the minimal capability-drill page.

## Structure

```
test-capabilities/
├── bin/               # TEST-CAPABILITIES CLI
├── docs/
│   ├── api/           # TEST-CAPABILITIES API reference
│   ├── project/       # Vision, goals
│   ├── _core/         # Immutable core docs
│   ├── org_context/   # Organizational context
│   ├── learnings/     # Crystallized patterns
│   └── system4d/      # System4D framework docs
├── examples/          # Test patterns, sample specs
├── external/          # Vendored tools (bombadil)
├── flows/             # Test flow definitions
├── ontology/          # Generated test artifacts
├── policy/            # Stack lane, security policies
├── prompts/           # LLM testing prompts
├── src/               # TEST-CAPABILITIES framework source
│   ├── core/          # Orchestrator
│   ├── healing/       # Self-healing
│   ├── integrations/  # External tool clients
│   ├── prediction/    # Prediction engine
│   └── quantum/       # Quantum simulator
├── scripts/           # CI, quality gates, tooling
└── tests/             # Test files
```
