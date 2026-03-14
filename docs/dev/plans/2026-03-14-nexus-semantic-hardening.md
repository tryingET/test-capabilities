---
summary: "Implementation plan for semantic hardening on the operation kernel, healer, and quantum simulator."
read_when:
  - "You are implementing the post-review nexus hardening pass"
  - "You need the acceptance criteria for semantic fail-closed fixes after the operation-kernel rollout"
type: "plan"
---

# 2026-03-14 — Nexus semantic hardening plan

## Goal
Close the semantic gaps found in the deep adversarial review so the operation kernel is not only route-correct but meaning-correct.

## Acceptance
- `quantum` rejects invalid non-URL targets.
- Healing no longer treats ordinary string payloads as selectors.
- Healing applies multiple proposals transactionally without partial file mutation on failure.
- Quantum result semantics stop advertising dead/inflated discovery metrics.
- Docs and adversarial fixtures reflect the tightened contract.
- `npm run check` and `npm run release:check` pass.

## Risks
- Tightening selector extraction could drop previously inferred healing proposals if the matcher becomes too narrow.
- Transactional healing needs deterministic ordering so recorded columns remain stable.
- Quantum discovery changes may require doc/example updates if counts shift materially.

## Notes
- Prefer explicit rejection over accepted-but-meaningless behavior.
- Add semantic fixtures, not only route-level tests.
- Keep the CLI wrapper thin; hardening belongs in the kernel / core runtime layers.
