---
summary: "Short public project context snapshot for this repo."
read_when:
  - "When onboarding or making decisions affected by project conventions"
---

# Project Summary

## Ownership

- **Project:** `test-capabilities`
- **Package:** `test-capabilities`
- **Repository:** `https://github.com/tryingET/test-capabilities`
- **Maintainers:** repository maintainers

## Tech Stack

- **Runtime:** Node.js 22+ (ESM)
- **Language:** TypeScript
- **Quality:** Biome (lint/format), Node test runner
- **Testing tools:** Bombadil-compatible property exploration, Surf Go-compatible browser exploration, CLI smoke execution

## Key Integrations

- Public package smoke: `npm run consumer:smoke`
- Release preflight: `npm run release:check`
- Docs discovery: `npm run docs:list`

## Conventions

- No secrets in git.
- Run `./scripts/install-hooks.sh` after cloning if you want local pre-commit/pre-push gates.
- Keep public docs aligned with shipped fail-closed runtime behavior; mark future autonomy/prediction language as vision, not current support.
