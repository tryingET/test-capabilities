---
summary: "System4D: Container (boundary/constraints) for this repo."
read_when:
  - "When scoping work"
---

# System4D — Container

## Boundaries

### In Scope

- TEST-CAPABILITIES framework (orchestrator, self-healing, quantum simulator, prediction)
- LLM testing prompts and guides
- Testing tool integrations (Bombadil, agent-browser, Stagehand)
- Decision matrices for tool selection
- Vision and strategic documentation

### Out of Scope

- Running production tests (this is infrastructure, not a test runner)
- Hosting testing services
- LLM model training

## Constraints

| Constraint | Value |
|------------|-------|
| Node version | >= 22 |
| Module type | ESM only |
| Quality gate | Biome + Node test runner |
| Privacy | Local-first correlation, opt-in collective |

## Dependencies

- `tech-stack-core` (lane: pi-ts)
- `agent-scripts` (docs-list, code-list)
- External tools: Bombadil binary, agent-browser CLI

## Risk Surface

- **LLM costs** — Expensive operations need budgeting
- **Non-determinism** — AI-generated tests need human review
- **Tool churn** — Testing tools evolve rapidly; maintain flexibility
