# testers

Testing infrastructure for the AI-native era — NEXUS framework, LLM-driven testing guides, and autonomous quality assurance tooling.

## Vision

> *We don't build tests. We build the immune system of software.*

See [docs/project/vision.md](docs/project/vision.md) for the full vision.

## Components

| Path | Description |
|------|-------------|
| `src/nexus/` | NEXUS testing framework (orchestrator, self-healing, quantum simulator, prediction engine) |
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

## Commands

```bash
# Quality gates
npm run check          # Full CI check (lint + test)
npm run lint           # Lint check
npm run fix            # Auto-fix lint issues

# Testing
npm test               # Run tests
npm run test:ci-targeted  # CI-targeted smoke tests

# Docs discovery
npm run docs:list      # List relevant docs for a task
npm run docs:list:workspace  # Workspace-wide doc scan
```

## Structure

```
testers/
├── docs/
│   ├── project/       # Vision, goals
│   ├── _core/         # Immutable core docs
│   ├── org_context/   # Organizational context
│   ├── learnings/     # Crystallized patterns
│   └── system4d/      # System4D framework docs
├── examples/          # Test patterns, sample specs
├── external/          # Vendored tools (bombadil)
├── ontology/          # Generated test artifacts
├── policy/            # Stack lane, security policies
├── prompts/           # LLM testing prompts
├── src/nexus/         # NEXUS framework source
├── scripts/           # CI, quality gates, tooling
└── tests/             # Test files
```
