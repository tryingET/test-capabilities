# AGENTS.md — test-capabilities

## Intent
Testing infrastructure for the AI-native era — TEST-CAPABILITIES framework, LLM-driven testing guides, and autonomous quality assurance tooling.

## Guardrails
- No secrets in git.
- Never push to `main`; MRs only.
- Treat `docs/_core/**` as immutable.
- Run `./scripts/install-hooks.sh` after cloning/scaffolding to enforce local pre-commit/pre-push CI gates.

## Shared tooling
- Docs discovery/scoping: `./scripts/docs-list.sh --task "<task>" --top 8`
- Prompt read-scope allowlist: `./scripts/docs-list.sh --from-prompt <prompt-file> --paths-only --wikilink`
- Code-file triage (optional/experimental): `./scripts/code-list.sh`
- Tech stack lanes list: `./scripts/tech-stack.sh list`
- Tech stack lane details: `./scripts/tech-stack.sh show <py|ts|pi-ts|go> --prefer-repo`
- Quality gate: `npm run check` (lint + test)

## Read order
1) `docs/_core/`
2) `docs/project/vision.md`
3) `docs/org_context/`
4) `docs/learnings/`
5) `docs/system4d/`
6) `docs/TEST-CAPABILITIES-TESTING-FRAMEWORK.md`
7) `docs/LLM-TESTING-GUIDE.md`
