---
summary: "Short org context snapshot for this repo."
read_when:
  - "When onboarding or making decisions affected by org rules"
---

# Org Summary

## Ownership

- **Lane:** `owned` (SoftwareCo operates this repo)
- **Owner handle:** `@software-owner`
- **Parent:** `~/ai-society/softwareco/`

## Tech Stack

- **Runtime:** Node.js 20+ (ESM)
- **Language:** TypeScript
- **Quality:** Biome (lint/format), Node test runner
- **Testing tools:** Bombadil (property-based), agent-browser (browser automation)

## Key Integrations

- `tech-stack-core` lane: `pi-ts` (see `policy/stack-lane.json`)
- Docs discovery: `~/ai-society/core/agent-scripts/scripts/docs-list.mjs`

## Conventions

- No secrets in git
- MR workflow (no direct pushes to main)
- Run `./scripts/install-hooks.sh` after cloning
