---
summary: "Repo-local engineering-core adoption for test-capabilities."
read_when:
  - "You are selecting engineering lanes, disciplines, or validation evidence for test-capabilities work."
  - "You need repo-local deviations from shared engineering-core guidance."
type: "reference"
---

# test-capabilities engineering guidance

## Upstream owner

Shared engineering lane and discipline guidance comes from `/home/tryinget/ai-society/core/engineering-core`.
This file records the repo-local selected subset for test-capabilities, a TypeScript/Pi testing capability infrastructure. The repo `AGENTS.md` remains the operating authority for repo-specific workflow, source-owner boundaries, and read order.

Machine-readable selection lives in `policy/engineering-lane.json`.

## Selected lanes

- `pi-ts`

```bash
uv tool -n run --from ~/ai-society/core/engineering-core engineering-core show pi-ts
```

## Selected disciplines

- `validation`
- `testing`
- `security-privacy`
- `documentation`
- `dependency-governance`
- `observability`
- `specification-and-dsls`
- `engineering-reasoning`

Catalog/list commands:

```bash
uv tool -n run --from ~/ai-society/core/engineering-core engineering-core catalog --pretty
uv tool -n run --from ~/ai-society/core/engineering-core engineering-core list-disciplines
uv tool -n run --from ~/ai-society/core/engineering-core engineering-core list-templates
```

## Repo-local deviations and emphasis

- Prefer repo-local deterministic wrappers, workspace commands, `Justfile` targets, and package/app-local scripts over ad-hoc commands.
- Keep package/app-local validation and release behavior in the owning package or app surface.
- Treat this file as a selector and override note, not a replacement for `AGENTS.md` or runtime task/evidence authority.
- When local practice intentionally diverges from engineering-core guidance, record the reason here or in the owning project/decision document.

## Canonical local commands

- `npm run check`
- `npm run verify`
- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run ci:full`
- `npm run ci:smoke`
- `npm run quality:ci`

## Repo loop validation

test-capabilities adopts `repo-loop-validation-v1` for fail-closed testing capability and diagnostic loop work. The machine-readable declaration lives in `policy/engineering-lane.json`.

- `loop-doctor`: `npm run loop-doctor` (non-failing git/Node/npm diagnostics)
- `loop-verify-fast`: `npm run loop-verify-fast` (maps to `npm run test:ci-targeted`)
- `loop-impact-plan`: `npm run loop-impact-plan` (changed-file listing plus run/wide recommendation)
- `loop-impact-run`: `npm run loop-impact-run` (maps to the repo-declared `npm run check` quality gate)
- `loop-impact-wide`: `npm run loop-impact-wide` (maps to `npm run verify` / release preflight validation)
- `loop-landing-check`: `npm run loop-landing-check` (maps to the repo-declared `npm run check` quality gate)

These commands produce repo-local evidence for loop orchestration. They do not replace AK task/evidence/decision authority, release approval, package publication authority, merge approval, or downstream production activation authority.

## Validation evidence expectations

For engineering-core adoption metadata changes:

```bash
python -m json.tool policy/engineering-lane.json >/tmp/test-capabilities-engineering-lane.json
node /home/tryinget/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
```

For code/runtime changes, follow `AGENTS.md` and run the smallest truthful local validation command for the touched surface.
