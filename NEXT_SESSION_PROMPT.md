# NEXT_SESSION_PROMPT.md — testers

---

## TRUE INTENT

**testers** is a testing infrastructure repo. It needs rocs-cli + ontology, but the distribution chain is broken at the L1 template level. Fix the templates first, then come back.

---

## TESTERS STATUS: COMMITTING NOW

```
testers:
├── Structure: ✅ Aligned with pi-extensions patterns
├── Quality: ✅ npm run check passes
├── Docs: ✅ Vision (27KB), system4d (all 4), org_context filled
├── Lint: ✅ All biome errors fixed
├── rocs-cli: ⏳ BLOCKED (needs L1 template fix)
└── ontology: ⏳ BLOCKED (needs rocs-cli first)
```

**39 files staged** - committing now.

---

## SESSION 2026-02-23/24 SUMMARY

**Done:**
- Restructured repo to align with pi-extensions patterns
- Added: `examples/`, `external/bombadil`, `ontology/`, `policy/stack-lane.json`
- Added: `biome.jsonc`, `scripts/quality-gate.sh` for unified quality gates
- Added: `docs/project/vision.md` (27KB vision document)
- Filled: `docs/org_context/`, `docs/system4d/*` (all 4 files)
- Updated: `AGENTS.md`, `README.md`, `CODEOWNERS`, `.gitignore`, CI workflows
- Removed: `docs/owned/`, `convex/README.md`, moved `bombadil` to external/
- Fixed: 18 files with biome lint issues

**Remaining (next session):**
- Add rocs-cli when L1 templates are fixed
- Create `ontology/manifest.yaml` + testing domain concepts
- Run `rocs build` to generate dist/

---

## BLOCKERS (TRACKED IN tpl-template-repo)

See: `~/ai-society/core/tpl-template-repo/NEXT_SESSION_PROMPT.md`

---

*Updated: 2026-02-24 (commit execution in progress)*
