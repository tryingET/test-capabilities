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
| `src/` | TEST-CAPABILITIES testing framework (operation kernel, orchestrator, self-healing, quantum simulator, prediction engine) |
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

This proves the package can load, run a real CLI command through `cli-tester`, and emit `observation.v1` diagnostic evidence without Surf Go, Bombadil, network access, or a target application.
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

`doctor` has no Surf/Bombadil requirement: missing optional external runtimes are reported as warnings while package/runtime readiness checks remain required.

The shipped CLI verbs now run through a typed **operation kernel** exposed at `src/core/operations.ts` and implemented in trust-sized modules under `src/core/operations/`.
That registry owns the supported routes, their input schemas, their executors, and their structured result shapes so the CLI wrapper stays thin.
For Surf-backed web exploration, Surf Go is the standard runtime. The supported orchestrator resolves it through `TEST_CAPABILITIES_SURF_GO_BIN`, a source checkout referenced by `TEST_CAPABILITIES_SURF_GO_REPO`, or `surf-go` on `PATH`. A Surf Go source checkout can run via `go -C <repo>/go run ./cmd/surf-go`; build `surf-go` first for faster runs. Explicit Surf Go repo env vars fail closed when invalid instead of silently switching to a different runtime. `surf explore` now runs explicit browser-state/DOM/link probes, supports bounded same-origin `--depth` exploration from 1-3, and reports graded user-flow coverage from verified probe counts; empty output, help text, warning-only output, and target URLs without a matching browser-state probe fail closed as unverified coverage.
For Bombadil-backed web exploration, the supported orchestrator resolves the binary through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, repo-local `external/bombadil`, or `bombadil` on `PATH`.
A Bombadil-compatible source checkout only overrides the parked repo-local fallback once it has a built `target/release/bombadil` or `target/debug/bombadil`; upstream Bombadil 0.5 centralizes builds and no longer requires `esbuild`, though local source builds may still need project-specific prerequisites such as `trunk` or the project Nix shell.
Bombadil 0.5 request headers, trace output paths, trace reproduction, viewport/instrumentation/permission knobs, and `test-external` debugger settings are exposed through `agents.<name>.bombadil` config. Bombadil's disabled-control skipping, quiescence timers, and dialog auto-accept behavior come from the resolved Bombadil binary itself. A bounded experimental `terminal-fuzzer` agent wraps `bombadil terminal test -- <command> [args...]` and emits normalized `observation.v1` runtime evidence for terminal/CLI targets without claiming production stability or autonomy.
Packed npm consumers should treat Bombadil as an external tool requirement: the package intentionally excludes `external/bombadil`, and `npm run consumer:smoke` verifies that a packed consumer without `TEST_CAPABILITIES_BOMBADIL_BIN`, `TEST_CAPABILITIES_BOMBADIL_REPO`, or `bombadil` on `PATH` receives a clear failing Bombadil finding instead of a fake pass. See [docs/project/bombadil-distribution-posture.md](docs/project/bombadil-distribution-posture.md) and [docs/adoption/bombadil-0.5-how-to.md](docs/adoption/bombadil-0.5-how-to.md). The same packed-consumer smoke also proves calibrated `root_cause` and low-calibration non-authoritative `propagation` observations survive through the distributed library API.

### Implemented today

| Surface | Status | Notes |
|---------|--------|-------|
| `doctor` command | Implemented | Zero-external-dependency package and environment diagnostics; optional Surf Go/Bombadil-compatible runtimes warn when absent instead of failing |
| `init` command | Implemented | Generates a minimal valid `test-capabilities.yaml` for the zero-external-dependency `cli-tester` path and refuses overwrites without `--force` |
| `demo` command | Implemented | Built-in zero-external-dependency functional demo for the polished `cli-smoke-observation` use case |
| `test` command | Implemented | Supports `--config`, `--target`, `--quick`; URL targets apply when `quantum.enabled: true` or a supported `bombadil`/`surf` agent is enabled, and they only replace `targets.cli` when no `cli-tester` smoke is enabled |
| `bombadil` orchestrator agent | Implemented | Runs a bounded Bombadil exploration budget against `targets.web`; resolves the binary through explicit env, a built source checkout, repo-local parked fallback, or `PATH` |
| `terminal-fuzzer` orchestrator agent | Implemented | Experimental bounded wrapper for `bombadil terminal test -- <command> [args...]`; emits `observation.v1` runtime evidence for CLI/terminal targets and fails closed on missing Bombadil or target command |
| `surf` orchestrator agent | Implemented | Runs the supported `surf explore` operation against `targets.web`; resolves Surf Go from explicit env, a source checkout, or `surf-go` on `PATH`, then reports graded user-flow coverage from verified browser-state/DOM probes |
| `cli-tester` orchestrator agent | Implemented | Executes `<targets.cli> --help` as a capability-backed smoke |
| `quantum` command | Implemented | Uses the shared simulator path |
| `surf explore` | Implemented | Runs Surf Go navigation plus explicit browser-state/DOM probes, optionally follows same-origin links with `--depth 1..3`, and fails closed unless the seed page verifies browser-state evidence |
| `heal` command | Implemented | Heuristic selector repair workflow; `--findings-input` accepts orchestrator findings JSON so proposals cite diagnostic evidence as `triggeringFindingId` |
| normalized observations | Implemented | Supported orchestrator agents emit `observation.v1` diagnostic events for Surf coverage, Bombadil property exploration, and CLI smoke execution; when correlation is enabled, runs can also include component-level semantic synthesis, suite-level observation correlation, deterministic `root_cause` observations for at least two same-component independent failed-or-errored observed evidence units that agree on the same failure class, and low-calibration non-authoritative `propagation` observations across configured dependency edges |
| finding correlation | Implemented | Cross-finding synthesis inside the orchestrator; observation-native synthesis and calibrated root-cause observations summarize multi-sensor meaning without becoming pass/fail authority or prediction |

### Explicitly unsupported for now

These surfaces fail clearly when enabled or invoked:

- orchestrator agents: `api-fuzzer`
- orchestrator intelligence flags: `self_healing`, `prediction`, `collective`
- `chaos` execution
- CLI commands: `predict`, `visualize`, `report`
- `test` flags: `--autonomous`, `--self-heal`, `--predict`, `--fail-threshold`, `--upload-artifacts`, `--report`
- surf actions: `flow`, `assert`, `compare`, `replay`

## Commands

```bash
# Quality gates
npm run check          # Full CI check (lint + test)
npm run lint           # Lint check
npm run fix            # Auto-fix lint issues
npm run consumer:smoke # Packed-artifact consumer contract smoke
npm run truth:gate       # Cross-check portable runtime/package/docs/passport truth surfaces
npm run release:check    # Release preflight (quality + root-cause corpus + truth gate + packed-artifact verification)

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
node ./bin/test-capabilities quantum --target https://example.com
node ./bin/test-capabilities surf explore --url https://example.com
node ./bin/test-capabilities heal --dir ./tests --dry-run
node ./bin/test-capabilities heal --dir ./tests --dry-run \
  --proposal-output artifacts/heal-proposals.json \
  --verification-output artifacts/heal-verification.json
node ./bin/test-capabilities heal --dir ./tests --dry-run \
  --findings-input artifacts/orchestrator-findings.json \
  --proposal-output artifacts/heal-proposals.json
node ./bin/test-capabilities heal --dir ./tests --checkpoint-ref checkpoint/test-capabilities/heal-001

# Testing
npm test                  # Run node contract tests
npm run test:property     # fast-check invariant lane for config, route selection, and orchestrator behavior
npm run test:behavior     # cucumber-backed CLI workflow scenarios mapped to docs/examples
npm run test:ci-targeted  # CI-targeted smoke tests
npm run capability:drill  # Repo-local end-to-end drill for shipped capabilities
npm run root-cause:corpus # Dogfood calibrated root-cause diagnosis invariants
npm run bombadil:smoke    # Richer Bombadil regression smoke against a deterministic local fixture

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
- `surf explore` runs through the shipped wrapper path and rejects invalid URLs
- `test` runs a surf-backed orchestrator agent against a deterministic local fixture
- library drills for orchestrator correlation and prediction input validation; contract tests cover calibrated root-cause observation synthesis

Surf modes:

```bash
# Auto-detect: use Surf Go when available, otherwise a deterministic shim
npm run capability:drill

# Force the deterministic shim path
bash ./scripts/capability-drill.sh --surf-mode shim

# Require a real Surf Go runtime (surf-go or source-checkout Surf Go)
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
```

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
