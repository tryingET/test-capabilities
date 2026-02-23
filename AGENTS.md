# AGENTS.md — testers

## Intent
Template for an owned repo (context + code + tests).

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

## Read order
1) `docs/_core/`
2) `docs/org_context/`
3) `docs/owned/`
4) `docs/decisions/`
5) `docs/learnings/`
6) `docs/system4d/`
