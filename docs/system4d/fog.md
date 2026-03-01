---
summary: "System4D: Fog (risks/assumptions/exceptions/debt) for this repo."
read_when:
  - "When tracking uncertainty"
---

# System4D — Fog

## Known Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| LLM API costs spike | Medium | High | Budget per operation, cache results |
| Bombadil binary drifts out of date | Medium | Low | Pin version, document update process |
| AI-generated tests miss edge cases | High | Medium | Human review required on all generated tests |
| Tool ecosystem fragmentation | Medium | Medium | Abstraction layer over direct tool usage |

## Assumptions

1. **Node 20+ is available** — No support for older runtimes
2. **Users have LLM API access** — Core features require Claude/GPT-4
3. **Browser automation works** — Requires Chrome/Chromium installed
4. **Local-first is acceptable** — Some features work offline

## Exceptions

- `external/` — Vendored binaries not managed by npm
- `src/examples/` — Example code, lint rules relaxed
- `ontology/` — Generated artifacts, not manually edited

## Technical Debt

| Debt | Origin | Priority |
|------|--------|----------|
| No tsconfig.json | Project is ESM-first, not TypeScript-compiled | Low |
| Convex references remain | Historical, may need cleanup | Low |
| Example files have unused functions | Demo code, intentional | Low |

## Open Questions

1. Should collective intelligence (pattern sharing) be opt-in or opt-out?
2. What's the budget threshold for LLM operations in CI?
3. How do we version the NEXUS framework for external consumers?
