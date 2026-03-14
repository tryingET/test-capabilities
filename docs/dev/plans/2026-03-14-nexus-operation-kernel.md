---
summary: "Implementation plan for the nexus operation-kernel change."
read_when:
  - "Reviewing the intent and acceptance criteria for the 2026-03-14 nexus implementation"
  - "Auditing why the operation kernel was introduced"
type: "plan"
---

# 2026-03-14 — Nexus operation-kernel implementation plan

## Goal
Implement the nexus intervention for `test-capabilities`: a single typed operation kernel that owns the shipped CLI verbs (`test`, `surf explore`, `quantum`, `heal`) and keeps the CLI wrapper thin.

## Acceptance
- Shipped verbs dispatch through one typed registry/executor layer.
- CLI capability metadata derives from that layer instead of duplicating route truth.
- Docs mention the operation kernel and stay runtime-accurate.
- Tests cover the registry/dispatch contract.
- `npm run check` and `npm run release:check` pass.

## Risks
- Type drift between commander option shapes and the new typed kernel.
- Packaged-artifact smoke could miss newly exported symbols if not updated.
- Docs may lag if the kernel is added without API reference updates.

## Notes
- Keep unsupported commands/actions fail-closed.
- Do not expand roadmap behavior; only unify the shipped surface.
