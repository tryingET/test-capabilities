---
summary: "AK coordination dogfood for test-capabilities as the SF12/IW24 external-repo testing ground."
read_when:
  - "You need the result of the SF12/IW24 external-repo AK coordination dogfood."
  - "You are checking whether AK coordination worked in test-capabilities without agent-kernel-local assumptions."
type: "dogfood"
task_id: 3071
---

# AK coordination dogfood on test-capabilities

## Purpose

Use `test-capabilities` as the real external-repo testing ground for `agent-kernel` `SF12/IW24`.

Question:

> Can AK coordinate bounded work in a repo outside `agent-kernel` from repo posture and task state through validation/evidence without falling back to SG/TG/OP ceremony or source-owner drift?

## Scope

Target AK task:

```text
3071 — [AK dogfood] Validate AK coordination path on test-capabilities
```

Allowed mutation in this repo was limited to this dogfood report and scoped read/validation surfaces.

## Orientation used

Read/checked:

- `AGENTS.md` — repo guardrails, especially `docs/_core/**` immutability and `npm run check` as quality gate.
- `README.md` — current capability contract and operator commands.
- `docs/project/product-posture.md` — fail-closed runtime posture and current maturity gaps.
- `docs/project/vision.md` — durable north-star, explicitly not shipped capability truth.
- `governance/capability-passport.json` — generated capability projection, informational not task authority.
- AK task state for task `3071`.

## Validation run

```bash
npm run check
```

Result: pass.

Observed quality gate summary:

- lint passed;
- 229 node tests passed, 1 skipped;
- 4 behavior scenarios passed;
- capability passport and truth-gate checks stayed aligned;
- root-cause and runtime-diagnostic corpus checks passed as part of the quality gate.

## AK coordination findings

### What worked

- AK repo registration found `test-capabilities` as its own repo scope.
- A target-repo task with bounded scope could be created for the external dogfood.
- Task contract and guardrails could be authored from inside the target repo.
- The task contract made the repo-specific validation (`npm run check`) explicit before completion.
- Repo posture and README gave enough context to validate current capability-contract health without inventing a planning document.

### Friction / useful failure

- Attempting to set task contract/guardrails for target-repo task `3071` from the `agent-kernel` cwd failed closed because task `3071` belongs to `/home/tryinget/ai-society/softwareco/owned/test-capabilities`.
- That is the correct authority boundary, but it is operator-friction for cross-repo coordination: the controller has to remember to `cd` into the owning repo before mutating target task execution semantics.

### SF12 implication

This dogfood is positive evidence for `SF12`: AK can coordinate a bounded external repo task through repo posture, task scope, contracts, guardrails, validation, and evidence.

It also reveals a real cross-repo usability gap that belongs inside `SF12/IW24`: cross-repo task handoff should make the owning-repo mutation boundary more visible and ergonomic, instead of relying on the operator to discover it through a failed command.

## Non-actions

This dogfood did not:

- change supported capability states;
- mutate `docs/_core/**`;
- change source code;
- mutate Prompt Vault, Pi/runtime, KES, ROCS, templates, steward/publication, Oracle/DSPx, or FCOS-control-board;
- claim `SF12` complete by itself.
