# testers

LLM testing framework and utilities for ai-society.

## Components

- **nexus/** — Nexus testing framework
- **bombadil** — Testing binary
- **prompts/** — Test prompts
- **docs/** — Testing guides and decision matrices

## Documentation

- `docs/LLM-TESTING-GUIDE.md` — Guide for LLM testing
- `docs/NEXUS-TESTING-FRAMEWORK.md` — Nexus framework docs
- `docs/DECISION-MATRIX.md` — Decision framework

## Commands

```bash
npm run lint
npm run test:ci-targeted
npm test
```

## Runtime gate conventions

Runtime-heavy checks are opt-in and disabled by default.

- Enable gate: `RUN_CONVEX_RUNTIME_TESTS=1`
- Provide runtime endpoint metadata:
  - `CONVEX_URL`, or
  - `CONVEX_DEPLOYMENT`

See `docs/owned/runtime-gates.md` for details.
