# test-capabilities

Testing infrastructure for the AI-native era — NEXUS framework, LLM-driven testing guides, and autonomous quality assurance tooling.

> Previously tracked in this workspace as `testers`.

## Vision

> *We don't build tests. We build the immune system of software.*

See [docs/project/vision.md](docs/project/vision.md) for the full vision.

## Components

| Path | Description |
|------|-------------|
| `src/` | NEXUS testing framework (orchestrator, self-healing, quantum simulator, prediction engine) |
| `bin/nexus` | NEXUS CLI |
| `external/bombadil` | Bombadil property-based testing binary |
| `prompts/` | LLM testing prompts (cli-tester, web-tester, api-tester) |
| `docs/` | Testing guides and frameworks |

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/project/vision.md](docs/project/vision.md) | Project vision and strategic direction |
| [docs/NEXUS-TESTING-FRAMEWORK.md](docs/NEXUS-TESTING-FRAMEWORK.md) | NEXUS autonomous testing framework |
| [docs/LLM-TESTING-GUIDE.md](docs/LLM-TESTING-GUIDE.md) | Guide for LLM-driven testing |
| [docs/DECISION-MATRIX.md](docs/DECISION-MATRIX.md) | Tool selection decision matrix |
| [docs/api/](docs/api/) | NEXUS API reference docs |

## Commands

```bash
# Quality gates
npm run check          # Full CI check (lint + test)
npm run lint           # Lint check
npm run fix            # Auto-fix lint issues

# Build
npm run build          # TypeScript build

# NEXUS CLI
npm run nexus          # Run NEXUS CLI

# Testing
npm test               # Run tests
npm run test:ci-targeted  # CI-targeted smoke tests

# Docs discovery
npm run docs:list      # List relevant docs for a task
npm run docs:list:workspace  # Workspace-wide doc scan
```

## Structure

```
test-capabilities/
├── bin/               # NEXUS CLI
├── docs/
│   ├── api/           # NEXUS API reference
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
├── src/               # NEXUS framework source
│   ├── core/          # Orchestrator
│   ├── healing/       # Self-healing
│   ├── integrations/  # External tool clients
│   ├── prediction/    # Prediction engine
│   └── quantum/       # Quantum simulator
├── scripts/           # CI, quality gates, tooling
└── tests/             # Test files
```
