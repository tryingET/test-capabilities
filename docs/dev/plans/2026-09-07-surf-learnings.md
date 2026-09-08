---
summary: "Cross-link entry for the 2026-09-07 surf-learnings programme: where its plan, its six design packets, its review and adjudication, its eleven slice notes, its live-run transcripts and its closeout live."
read_when:
  - "You are looking for the implementation plan behind the evidence kernel, the submit gate, the frame root cause, the quality ratchet or the a11y channel."
  - "You want the closeout for the largest implementation programme this repo has run, or the slice note for one part of it."
type: "plan"
---

# 2026-09-07 — Surf learnings programme (cross-link)

The programme's own documents live under `docs/project/` because they are design and evidence rather than a
repo-local plan file. This entry exists so `docs/dev/plans/` names them.

## Goal

Turn six refined design packets - mutation safety, submit gate, frame root cause, quality ratchet, result
classification, a11y snapshot channel - into a two-ring evidence kernel over replaceable adapters, in eleven ordered,
collision-free slices, under five confirmed operator decisions.

## Where everything is

| what | where |
|---|---|
| the plan (slices, artifact ownership, risks, commit boundaries) | `docs/project/2026-09-07-surf-learnings-implementation-plan.md` |
| the assessment that started it | `docs/project/2026-09-07-surf-learnings-assessment.md` |
| the six packets | `docs/project/2026-09-07-{mutation-safety,submit-gate,frame-root-cause,quality-ratchet,result-classification,a11y-snapshot-channel}-design.md` |
| the architecture review (A1-A20) and the adjudication (claims 1-55) | `docs/project/2026-09-07-architecture-review.md`, `-architecture-adjudication.md` |
| what each slice actually did, with gates and deviations | `docs/project/2026-09-07-slice-s1-s1b-notes.md` … `-slice-s9-notes.md` |
| live transcripts (never gating) | `docs/project/2026-09-07-{surf-cli-migration,mutation-safety,submit-gate,frame-root-cause,a11y-snapshot}-live-run.md` |
| **the closeout: what changed, measured, and what was deferred** | `docs/project/2026-09-07-surf-learnings-closeout.md` |

## Acceptance (met at `aee95f4`, 2026-09-08)

- Every operation declares an effect class; nothing mutating reaches the world except through the ledger, behind a
  receipt that is fsynced before the act.
- One browser `Session` scope, one process transport behind four adapters, one pure classifier, one determination.
- Floors, structure budget and contract sync are enforced by the gate at measured truth.
- `npm run check` and `npm run release:check` pass; 612 tests, 611 pass, 1 skipped.
