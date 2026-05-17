---
summary: "Rerun finding for AK coordination dogfood via Pi intercom owning-repo handoff."
read_when:
  - "You need the SF12/IW24 rerun result for owning-repo handoff ergonomics."
  - "You are checking whether Pi intercom improved cross-repo AK coordination for test-capabilities."
type: "dogfood"
task_id: 3076
---

# AK coordination dogfood rerun via Pi intercom

## Purpose

Rerun the `test-capabilities` owning-repo side of the AK coordination dogfood after the first pass found an ergonomics gap: the `agent-kernel` controller could discover the target repo boundary only after an owning-repo mutation failed from the wrong cwd.

Question:

> Does a Pi intercom handoff from the controller to an already-running owning-repo session solve the handoff ergonomics without turning intercom into durable task/evidence authority?

## Scope

Target AK task:

```text
3076 — [AK dogfood] Rerun coordination path via Pi intercom handoff
```

Allowed repo-content mutation was limited to this report:

```text
docs/project/2026-05-17-ak-coordination-dogfood-rerun.md
```

AK task scope, done contract, and guardrails were authored from the `test-capabilities` cwd. Intercom remained a coordination channel only; AK task state, AK evidence, validation output, and git receipts remain the durable truth surfaces.

## Orientation used

Read/checked:

- `AGENTS.md` — repo guardrails, especially `docs/_core/**` immutability and `npm run check` as the quality gate.
- `docs/project/vision.md` — durable north-star, explicitly not shipped capability truth.
- `docs/project/product-posture.md` — fail-closed runtime posture and current maturity gaps.
- `docs/project/2026-05-17-ak-coordination-dogfood.md` — first dogfood pass and original cross-repo cwd friction.
- AK task state for task `3076`.

## Rerun finding

Pi intercom materially improved the owning-repo handoff ergonomics.

What improved:

- The controller message named the owning repo path, exact AK task id, validation commands, required report path, mutation boundaries, and reply shape in one packet.
- The owning-repo session could acknowledge coordination without treating the message as authority.
- The owning-repo session then claimed task `3076`, authored task scope/contract/guardrails from the correct cwd, ran repo-local validation, recorded AK evidence, and committed only the report file.
- The operator did not have to rediscover the owning repo by trial-and-error failed AK mutations.

Remaining gap:

- The handoff is still prose-shaped. The receiving session must manually translate the intercom packet into AK scope, done contract, guardrails, evidence, and completion actions.
- There is no typed handoff envelope that can preflight whether the target session is in the owning repo, whether the task is claimable, and whether the requested mutation paths match task scope before work begins.
- Intercom correctly remains non-authoritative, but the boundary depends on agent discipline rather than a first-class AK handoff receipt.

## Validation

Required bounded validation for this rerun:

```bash
npm run check
git diff --check
```

Result: pass.

## SF12/IW24 implication

The rerun is positive evidence that Pi intercom can solve the practical cross-repo handoff ergonomics for an external owning repo when the controller includes exact repo/task/scope/validation details.

The remaining product opportunity is to make this pattern typed and preflightable: a controller should be able to issue an owning-repo handoff packet that the receiver can reconcile into AK task scope/contract/evidence without manual prose parsing, while still preserving the rule that intercom is coordination only and AK/git receipts are durable truth.

## Non-actions

This rerun did not:

- mutate `docs/_core/**`;
- change source code or supported capability states;
- mutate FCOS control-board, Prompt Vault, Pi/runtime, KES, ROCS, templates, steward/publication, Oracle/DSPx, or unrelated files;
- treat intercom as task, evidence, or completion authority;
- claim `SF12` or `IW24` complete by itself.
