---
summary: "Placement assessment for the mechanisms discovered during the surf-cli / pic / surf-cli-go work: which belong in test-capabilities, which in surf-cli or Pi, which are deferred; the input to the six design packets."
read_when:
  - "You pick up one of the 2026-09-07 design packets (mutation safety, submit gate, frame root cause, quality ratchet, result classification, a11y snapshot channel)."
  - "You wonder why a surf-derived idea was or was not adopted here."
type: "reference"
---

# Placement assessment: surf-derived mechanisms (2026-09-07)

Sources (read them, they carry the evidence and file references):
- `~/ai-society/softwareco/contrib/docs/learnings/2026-09-06-surf-cli-go-restricted-verbs-research.md` (never-retry-mutations, prepare/apply, the "Set bid" incident, error classification lesson)
- `~/ai-society/softwareco/contrib/docs/learnings/2026-09-06-surf-cli-go-deep-dive.md` (owned-tab lifecycle, zero-rows invariant, frame diagnose, visible-state login detection)
- `~/ai-society/softwareco/contrib/docs/learnings/2026-09-06-pic-deep-dive.md` and `2026-09-06-pic-execution.md` (coverage ratchet + changed-lines gate, contract-sync and structure/cycle checks, atomic checkpoint store, page-reload recovery, typed typescript tool)
- `~/ai-society/softwareco/contrib/docs/learnings/2026-09-07-surf-cli-branch-dogfood.md`, `2026-09-07-surf-cli-upstream-prs.md` (what already landed in surf: readiness states, extract, frame.diagnose, error codes, transport-key stripping)
- this repo: `docs/project/2026-09-07-surf-cli-migration-live-run.md`, `src/core/surf-runtime.ts`, `src/core/operations/*.ts`, `src/integrations/surf-client.ts`, `scripts/quality-gate.sh`, `docs/project/product-posture.md`

test-capabilities is a fail-closed testing framework (CLI, browser, property, healing, diagnostic root cause). The
test is therefore: does the mechanism make a *test run* safer, more truthful, or better at explaining failure? Features
that make an *agent* more capable belong to surf-cli or Pi instead.

| # | mechanism | fits | where | why | packet |
|---|---|---|---|---|---|
| 1 | read-only vs mutating operation classification; never retry a mutation; receipt per mutating attempt | yes | test-capabilities operation contract (`types.ts`, orchestrator, heal, surf explore) | healing/retry loops must never double-submit; today retry is implicit and untyped | `2026-09-07-mutation-safety-design.md` |
| 2 | prepare/apply split with an explicit submit gate for mutating browser actions; "never click a form-level button to set a value" | yes | test-capabilities browser operations first; surf-cli `form.plan`/`form.apply` proposal as a later upstream PR | the Upwork "Set bid" incident is the failure a testing framework must make impossible; dry-run by default | `2026-09-07-submit-gate-design.md` |
| 3 | `frame.diagnose` as a root-cause step | yes | test-capabilities diagnostic/root-cause workflow (`SurfClient.diagnoseFrames` exists, unused) | "selector not found" becomes cross-origin / OOPIF / shadow-hosted / hidden with evidence | `2026-09-07-frame-root-cause-design.md` |
| 4 | coverage ratchet with changed-lines gate; contract-sync, file-size and import-cycle checks | yes | this repo's `scripts/quality-gate.sh` and CI; TIP candidate for the org template afterwards | matches the "immune system" posture; generic, small scripts | `2026-09-07-quality-ratchet-design.md` |
| 5 | strip transport metadata before classifying errors; empty result is a failure unless explicitly accepted | yes | test-capabilities result classification across CLI, API and browser testers (explore already has zero-rows) | an empty result reading as success is the silent false negative | `2026-09-07-result-classification-design.md` |
| 6 | accessibility snapshot with element refs (agent-browser over CDP) as a second observation channel | yes, optional | test-capabilities browser observation, flavor gated on the CDP port (only Chromium (Agent) has it) | cheaper, more stable evidence for LLM-driven test generation than DOM dumps or screenshots | `2026-09-07-a11y-snapshot-channel-design.md` |
| 7 | atomic checkpoint store, page-reload recovery | no, defer | — | the framework has no long-lived browser sessions to resume; revisit if runs become resumable | none |
| 8 | typed typescript tool, fail-closed context compilation, run-scoped RPC | no | Pi (`owned/pi-extensions`, spike branch `spike/pic-typescript-tool`) | agent capability, not test truth | none here |
| 9 | site-specific verbs (ChatGPT, Claude, Upwork, shadow libraries) | no | reference only | ToS/copyright exposure, no test value | none |

Constraints every packet must respect: fail closed (unknown → refuse with reason), no silent degradation, deterministic
checks, owned tabs only in the browser, nothing acts on the operator's personal browsers, main-first commits with the
repo's quality gates (`npm run check`, `npm test`, `loop-impact-plan` → `loop-impact-wide` when it says so).
