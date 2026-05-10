---
summary: "Project overview and operator guide for test-capabilities."
read_when:
  - "You are onboarding to test-capabilities"
  - "You need commands, structure, or current repo scope"
type: "reference"
---

# test-capabilities

Testing infrastructure for the AI-native era — TEST-CAPABILITIES framework, LLM-driven testing guides, and autonomous quality assurance tooling.

> Previously tracked in this workspace as `testers`.

## Vision

> *We don't build tests. We build the immune system of software.*

See [docs/project/vision.md](docs/project/vision.md) for the durable north-star vision and [docs/project/product_posture.md](docs/project/product_posture.md) for the current product maturity snapshot.

## Components

| Path | Description |
|------|-------------|
| `src/` | TEST-CAPABILITIES testing framework (operation kernel, orchestrator, self-healing, quantum simulator, prediction engine) |
| `bin/test-capabilities` | TEST-CAPABILITIES CLI |
| `external/bombadil` | Bombadil property-based testing binary |
| `prompts/` | LLM testing prompts (cli-tester, web-tester, api-tester) |
| `docs/` | Testing guides and frameworks |

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/project/vision.md](docs/project/vision.md) | Durable product vision and strategic direction |
| [docs/project/product_posture.md](docs/project/product_posture.md) | Current product maturity, supported/unsupported boundary, and major gaps |
| [docs/TEST-CAPABILITIES-FRAMEWORK.md](docs/TEST-CAPABILITIES-FRAMEWORK.md) | TEST-CAPABILITIES autonomous testing framework |
| [docs/LLM-TESTING-GUIDE.md](docs/LLM-TESTING-GUIDE.md) | Guide for LLM-driven testing |
| [docs/DECISION-MATRIX.md](docs/DECISION-MATRIX.md) | Tool selection decision matrix |
| [docs/dev/ts-quality-screening.md](docs/dev/ts-quality-screening.md) | Repo-local deterministic screening proof path via `ts-quality` |
| [docs/api/](docs/api/) | TEST-CAPABILITIES API reference docs |

## Capability Contract

The runtime is now fail-closed.
If a config section, agent, command, or flag is not wired to a real implementation path, the CLI errors instead of pretending success.

The shipped CLI verbs now run through a typed **operation kernel** exposed at `src/core/operations.ts` and implemented in trust-sized modules under `src/core/operations/`.
That registry owns the supported routes, their input schemas, their executors, and their structured result shapes so the CLI wrapper stays thin.
For Surf-backed web exploration, Surf Go is the standard runtime. The supported orchestrator resolves it through `TEST_CAPABILITIES_SURF_GO_BIN`, an explicit `TEST_CAPABILITIES_SURF_GO_REPO`, the conventional workspace-local `softwareco/contrib/surf-cli-go` checkout, or `surf-go` on `PATH`. A Surf Go source checkout can run via `go -C <repo>/go run ./cmd/surf-go`; build `surf-go` first for faster runs. Explicit Surf Go repo env vars fail closed when invalid instead of silently switching to a different runtime. `surf explore` now runs explicit browser-state/DOM/link probes, supports bounded same-origin `--depth` exploration from 1-3, and reports graded user-flow coverage from verified probe counts; empty output, help text, warning-only output, and target URLs without a matching browser-state probe fail closed as unverified coverage.
For Bombadil-backed web exploration, the supported orchestrator resolves the binary through `TEST_CAPABILITIES_BOMBADIL_BIN`, then a built checkout from `TEST_CAPABILITIES_BOMBADIL_REPO` or the conventional workspace-local `softwareco/contrib/bombadil`, then repo-local `external/bombadil`, then `bombadil` on `PATH`.
A Bombadil contrib checkout only overrides the vendored binary once it has a built `target/release/bombadil` or `target/debug/bombadil`; upstream Bombadil currently needs `trunk` and `esbuild` for local builds, or its Nix shell.
Packed npm consumers should treat Bombadil as an external tool requirement: the package intentionally excludes `external/bombadil`, and `npm run consumer:smoke` verifies that a packed consumer without `TEST_CAPABILITIES_BOMBADIL_BIN`, `TEST_CAPABILITIES_BOMBADIL_REPO`, or `bombadil` on `PATH` receives a clear failing Bombadil finding instead of a fake pass.

### Implemented today

| Surface | Status | Notes |
|---------|--------|-------|
| `test` command | Implemented | Supports `--config`, `--target`, `--quick`; URL targets apply when `quantum.enabled: true` or a supported `bombadil`/`surf` agent is enabled, and they only replace `targets.cli` when no `cli-tester` smoke is enabled |
| `bombadil` orchestrator agent | Implemented | Runs a bounded Bombadil exploration budget against `targets.web`; resolves the binary through explicit env, a built contrib checkout, vendored repo asset, or `PATH` |
| `surf` orchestrator agent | Implemented | Runs the supported `surf explore` operation against `targets.web`; resolves Surf Go from env/workspace or `surf-go` on `PATH`, then reports graded user-flow coverage from verified browser-state/DOM probes |
| `cli-tester` orchestrator agent | Implemented | Executes `<targets.cli> --help` as a capability-backed smoke |
| `quantum` command | Implemented | Uses the shared simulator path |
| `surf explore` | Implemented | Runs Surf Go navigation plus explicit browser-state/DOM probes, optionally follows same-origin links with `--depth 1..3`, and fails closed unless the seed page verifies browser-state evidence |
| `heal` command | Implemented | Heuristic selector repair workflow |
| normalized observations | Implemented | Supported orchestrator agents emit `observation.v1` diagnostic events for Surf coverage, Bombadil property exploration, and CLI smoke execution; when correlation is enabled, runs can also include component-level semantic synthesis, suite-level observation correlation, and deterministic `root_cause` observations for at least two same-component independent failed-or-errored observed evidence units that agree on the same failure class |
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
npm run truth:gate:local # Repo-local truth gate that also requires AK direction state
npm run release:check    # Release preflight (quality + root-cause corpus + truth gate + packed-artifact verification)

# Build
npm run build          # TypeScript build

# TEST-CAPABILITIES CLI
npm run test-capabilities                # Run TEST-CAPABILITIES CLI
node ./bin/test-capabilities test --config ./test-capabilities.yaml
node ./bin/test-capabilities quantum --target https://example.com
node ./bin/test-capabilities surf explore --url https://example.com
node ./bin/test-capabilities heal --dir ./tests --dry-run
node ./bin/test-capabilities heal --dir ./tests --dry-run \
  --proposal-output artifacts/heal-proposals.json \
  --verification-output artifacts/heal-verification.json
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

# Require a real Surf Go runtime (surf-go or workspace contrib surf-cli-go)
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
- two independent observed CLI failures classify as `command_resolution` or `timeout_or_latency`
- two independent observed Surf failures classify as `browser_coverage_gap`
- two independent observed Bombadil failures classify as `property_violation`
- two independent sensors linked to the same API finding classify as `contract_mismatch`
- finding-only, mixed-class evidence, all-passing linked sensors, single-sensor multi-finding, and partially observed evidence pairs do not emit `root_cause`
- root-cause output excludes prediction language and synthetic `corr-*` IDs

Machine-readable mode:

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
