---
summary: "Lifecycle SOP for repo changes in test-capabilities."
read_when:
  - "Planning, implementing, verifying, releasing, or maintaining repo changes."
system4d:
  container: "End-to-end repo change operating procedure."
  compass: "Keep runtime, docs, and verification converged."
  engine: "plan -> implement -> verify -> release -> maintain."
  fog: "Skipping maintain/refactor checks hides architecture debt."
---

# Extension SOP

## 1) Plan

- Define scope and acceptance criteria.
- Run `./scripts/docs-list.sh --task "<task>" --top 12` and read the relevant docs.
- Capture implementation intent in `docs/dev/plans/` when the change is non-trivial.
- Confirm risks, dependencies, and runtime contract impact.

## 2) Implement

- Keep shipped behavior behind explicit core contracts.
- Prefer thin adapters over duplicated wrapper logic.
- Update docs and tests as behavior changes.

## 3) Verify

- Run `npm run check`.
- Run focused commands/tests that exercise the changed behavior.
- If lint or formatting remediation is needed, run `npm run fix` and re-verify.
- For packaged-surface changes, run `npm run release:check`.

## 4) Release

- Keep user-facing docs, API docs, and packaged-artifact contract in sync.
- Use `npm run release:check` before merge when the package surface changed.
- Preserve fail-closed behavior for unsupported surfaces unless a real runtime path ships.

## 5) Maintain

- Review the most central edited file for complexity debt.
- Either refactor immediately or record a concrete maintainer follow-up; use `docs/project/product_posture.md` only when the gap changes product maturity or strategic selection.
- Keep `README.md`, `docs/api/*`, `docs/learnings/`, and `docs/project/product_posture.md` current when they are affected.
