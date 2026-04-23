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

See [docs/project/vision.md](docs/project/vision.md) for the full vision.

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
| [docs/project/vision.md](docs/project/vision.md) | Project vision and strategic direction |
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

### Implemented today

| Surface | Status | Notes |
|---------|--------|-------|
| `test` command | Implemented | Supports `--config`, `--target`, `--quick`; URL targets only apply when `quantum.enabled: true` and do not replace the required `targets.cli` smoke target |
| `cli-tester` orchestrator agent | Implemented | Executes `<targets.cli> --help` as a capability-backed smoke |
| `quantum` command | Implemented | Uses the shared simulator path |
| `surf explore` | Implemented | Runs the real surf CLI if available |
| `heal` command | Implemented | Heuristic selector repair workflow |
| finding correlation | Implemented | Cross-finding synthesis inside the orchestrator |

### Explicitly unsupported for now

These surfaces fail clearly when enabled or invoked:

- orchestrator agents: `bombadil`, `surf`, `api-fuzzer`
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
npm run release:check  # Release preflight (quality + packed-artifact verification)

# Build
npm run build          # TypeScript build

# TEST-CAPABILITIES CLI
npm run test-capabilities                # Run TEST-CAPABILITIES CLI
node ./bin/test-capabilities test --config ./test-capabilities.yaml
node ./bin/test-capabilities quantum --target https://example.com
node ./bin/test-capabilities surf explore --url https://example.com
node ./bin/test-capabilities heal --dir ./tests --dry-run

# Testing
npm test                  # Run tests
npm run test:ci-targeted  # CI-targeted smoke tests
npm run capability:drill  # Repo-local end-to-end drill for shipped capabilities

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
- `surf explore` runs through the shipped wrapper path and rejects invalid URLs
- library drills for orchestrator correlation and prediction input validation

Surf modes:

```bash
# Auto-detect: use real surf if installed, otherwise a deterministic shim
npm run capability:drill

# Force the deterministic shim path
bash ./scripts/capability-drill.sh --surf-mode shim

# Require a real surf install on PATH
bash ./scripts/capability-drill.sh --surf-mode real

# Emit machine-readable JSON for automation
bash ./scripts/capability-drill.sh --json --surf-mode shim --skip-build
```

The JSON mode returns a structured summary with `ok`, `surfMode`, `summary`, and per-check status entries so CI or agent tooling can consume the drill result without scraping terminal text.

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
