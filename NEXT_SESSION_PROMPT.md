# NEXT_SESSION_PROMPT.md — test-capabilities

## TRUE INTENT

`test-capabilities` (formerly `testers`) is a product repo for testing capabilities:
- NEXUS framework,
- testing guides/prompts,
- tool integration patterns.

It is **not** the FCOS proving lane control surface.

## FCOS ROLE SPLIT

- Product/testing capability repo: `softwareco/owned/test-capabilities`
- Dedicated canary/proving lane repo: `softwareco/owned/fcos-proving-lane`

## Session 2026-03-01

### Done
- Renamed `src/nexus/` → `src/test-capabilities/` for consistency
- Updated path references in README.md and docs/system4d/fog.md
- Renamed package from `testers` → `test-capabilities` in package.json
- Verified quality gate still passes
- Investigated lost `testers/` folder (deleted via `rm -rf`, not in Feb 20 backup)
- Confirmed: bombadil binary working, surf-cli missing, surf-client.ts present

### Remaining
- Recover original `testers/` project (surf-cli, pi-extensions integrations) when time permits
- Backup location: `/mnt/c/Users/mjpa/backup.tar` (88GB, Feb 20 - too early)
- Install/configure surf-cli for surf-client.ts integration

### Commit status
- Changes staged for commit: rename to test-capabilities, doc updates, new ontology/tools

## NEXT FOCUS

- Continue evolving testing product capabilities and docs.
- Keep FCOS proving-lane evidence isolated to `fcos-proving-lane`.
- Avoid reintroducing control-plane semantics into this repo.
