---
summary: "Repo-local override notes for the shared tech-stack-core lane used by test-capabilities."
read_when:
  - "Aligning implementation decisions with the TypeScript stack baseline."
  - "Reconciling test-capabilities runtime and tooling choices with the shared pi-ts lane."
---

# tech-stack.local (test-capabilities)

Primary lane:

- `tech-stack-core show pi-ts --prefer-repo`
- `./scripts/tech-stack.sh show pi-ts --prefer-repo`

Executable contract surface:

- `policy/stack-lane.json` pins the upstream lane and retrieval command.
- This file records repo-local deltas for test-capabilities.

Repo-local emphasis:

- Runtime now targets `node >=22`, matching the current pi-ts lane baseline.
- Testing surface currently emphasizes `node --test` plus repo-specific tooling such as bombadil and agent-browser.
- Quality baseline remains Biome-centered and is enforced through `npm run check` plus local hooks/CI.
- Release preflight is now explicit via `npm run release:check` and `npm run release:check:quick`, including packed-artifact consumer-contract smoke validation.
- Auxiliary Python-style utility execution should go through `uv run ...` rather than bare `python -m ...`.
- Optional pi-ts companions (add only when the repo actually benefits):
  - `fast-check` for parser/rendering/selection invariants.
  - `@cucumber/cucumber` only when executable operator/workflow scenarios materially improve shared understanding.
  - `nunjucks` for reusable text/config/prompt/file templates when plain typed render functions are no longer enough.
