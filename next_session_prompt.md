---
summary: "Stable bootstrap for test-capabilities sessions: use AK as task authority, keep this file lightweight, and do not split handoff across multiple files."
read_when:
  - "At the start of every work session"
  - "When resuming work in test-capabilities and you need the stable handoff/bootstrap contract"
---

# Next Session Prompt

## SESSION TRIGGER
Reading this file means start immediately.
Do not ask for permission to begin.

## AUTHORITATIVE ORDER
Use these in this order:

1. **AK DB** — canonical task queue / active work state for this repo
2. **This file** — stable bootstrap + repo-specific guardrails only
3. **Canonical repo docs** — README, vision, org/system context, API/framework docs
4. **`governance/work-items.json`** — compatibility projection only, not the source of truth

Do **not** treat this file as a live status database.
Do **not** recreate `NEXT_SESSION_PROMPT.md` or split handoff across multiple files again.

## STABLE CONTEXT
- Repo: `/home/tryinget/ai-society/softwareco/owned/test-capabilities`
- Intent: testing capability repo for TEST-CAPABILITIES framework, guides, prompts, and integrations
- This repo is **not** the FCOS proving-lane control surface.
- Role split:
  - product/testing capability repo: `softwareco/owned/test-capabilities`
  - dedicated canary/proving lane repo: `softwareco/owned/fcos-proving-lane`
- Current stack baseline: Node 22 + npm + TypeScript (`pi-ts` lane)
- Canonical current-work authority is AK.
- `governance/work-items.json` is the exported compatibility projection.
- First-class deferred task semantics are **not** implemented in AK yet; do not invent new repo-local queue shapes while waiting for that slice.

## DURABLE GUARDRAILS
- Keep this file short and current.
- Keep only one handoff file: `next_session_prompt.md`.
- Do not mirror queryable runtime/task state in prose when AK/CLI can answer it directly.
- Do not extend `governance/work-items.json` with custom deferred-task structures.
- Temporary deferred backlog lives in `governance/deferred-tasks.json` until AK gains first-class deferral support.
- Until AK gains explicit deferral support, use AK for **current actionable tasks** only.
- If AK shows no current ready slice for this repo, choose one parked item from `governance/deferred-tasks.json`, promote it into AK as a fresh current task, and work it immediately rather than extending local sidecar semantics.
- Keep FCOS proving-lane evidence isolated to `fcos-proving-lane`.
- Continue evolving testing product capabilities and docs here; avoid reintroducing control-plane semantics.
- Operation-kernel refactor trigger: if `src/core/operations.ts` grows beyond the current 4 shipped verbs or gains a second adapter surface beyond the CLI, split it into route manifest vs executor modules before adding more behavior.

## DEFAULT READ PATH FOR NEXT SESSION
1. `AGENTS.md`
2. `README.md`
3. `docs/project/vision.md`
4. `docs/org_context/org-summary.md`
5. `docs/system4d/container.md`
6. `docs/system4d/fog.md`
7. Relevant implementation/docs for the chosen slice

If planning needs the parked backlog, also read `governance/deferred-tasks.json`.

If a future session needs narrative capture, create a repo-local `diary/YYYY-MM-DD--type-scope-summary.md` and then keep only the latest pointer here.

## NEXT-SESSION START COMMANDS
```bash
cd /home/tryinget/ai-society/softwareco/owned/test-capabilities
git status --short
npm run check
npm run release:check

# Canonical task authority lives in AK
cd /home/tryinget/ai-society/softwareco/owned/agent-kernel
source ./.ak-env-v2
./scripts/ak-v2.sh task list -F json | rg -C 3 '/home/tryinget/ai-society/softwareco/owned/test-capabilities|test-capabilities'

# If nothing current is ready, inspect parked backlog before creating a fresh AK task
cd /home/tryinget/ai-society/softwareco/owned/test-capabilities
uv run python -m json.tool governance/deferred-tasks.json
```

## PROJECTION / COMPATIBILITY COMMANDS
Use only when you intentionally need the legacy compatibility artifact refreshed:

```bash
cd /home/tryinget/ai-society/softwareco/owned/agent-kernel
source ./.ak-env-v2
./scripts/ak-v2.sh work-items export \
  --repo /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --path /home/tryinget/ai-society/softwareco/owned/test-capabilities/governance/work-items.json
```

## SESSION-END RULE
When ending a future session:

1. update this file only if the stable bootstrap or next-entry pointers changed
2. keep AK as the authority for current task state
3. keep `governance/work-items.json` as the exported compatibility projection
4. keep parked future work in `governance/deferred-tasks.json` until AK grows first-class deferral support
