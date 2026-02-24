---
summary: "System4D: Engine (states/invariants/lifecycle) for this repo."
read_when:
  - "When defining invariants and lifecycle"
---

# System4D — Engine

## Invariants

1. **Quality gate must pass** — `npm run check` is non-negotiable
2. **No secrets in git** — Use `.env` files (gitignored)
3. **Biome formatting enforced** — No merge without lint pass
4. **Tests are code** — Same review standards apply

## Lifecycle States

```
Idea → Draft → Review → Merge → Release
        │        │
        └──┬─────┘
           ▼
       npm run check
       (must pass)
```

## Quality Flow

```
pre-commit → lint
pre-push   → lint + typecheck + test
ci         → full check + smoke tests
```

## Naming Conventions

| Type | Pattern |
|------|---------|
| Test files | `*.test.mjs`, `*.test.ts` |
| Scripts | `kebab-case.sh`, `kebab-case.mjs` |
| Docs | `UPPERCASE-WITH-DASHES.md` (top-level), `lowercase.md` (nested) |
| Prompts | `kebab-case.md` |
