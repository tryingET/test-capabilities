---
summary: "SF12/IW24 owning-repo dogfood result for read-only AK handoff preflight via Pi intercom."
read_when:
  - "You need the SF12/IW24 handoff-preflight dogfood result for test-capabilities."
  - "You are checking whether AK handoff preflight catches cross-repo handoff issues before claim or mutation."
type: "dogfood"
task_id: 3084
---

# AK handoff-preflight dogfood on test-capabilities

## Purpose

Validate the owning-repo side of an SF12/IW24 cross-repo handoff where Pi intercom carries the coordination packet and AK provides a read-only handoff preflight before the receiver claims or mutates the target task.

Question:

> Can a read-only AK handoff preflight verify repo identity, task ownership, claimability, scope, authority boundaries, and dirty-state before the owning-repo session mutates AK or git state?

## Inputs

Envelope file:

```text
/tmp/ak-sf12-iw24-handoff-preflight-envelope.json
```

Handoff id:

```text
AK-XHANDOFF-2026-05-17-SF12-IW24-PREFLIGHT-DOGFOOD-001
```

Target AK task:

```text
3084 — [AK dogfood] Validate handoff preflight via Pi intercom
```

Allowed and required repo-content path:

```text
docs/project/2026-05-17-ak-handoff-preflight-dogfood.md
```

Forbidden path class:

```text
docs/_core/**
```

## Preflight command

Run from the owning repo before claim or mutation:

```bash
/home/tryinget/ai-society/softwareco/owned/agent-kernel/target/debug/ak \
  --db /home/tryinget/ai-society/society.v2.db \
  task handoff preflight \
  --envelope /tmp/ak-sf12-iw24-handoff-preflight-envelope.json \
  -F json
```

Result:

```text
status: accepted
ok: true
read_only: true
```

Key check statuses:

| Check | Status | Meaning |
|---|---:|---|
| `envelope_parse` | pass | Parsed `ak.cross_repo_handoff.v1` envelope. |
| `repo_identity` | pass | Current repo matched `receiver.repo_path`. |
| `task_exists` | pass | Target task `#3084` existed. |
| `task_repo_ownership` | pass | Target task belonged to the receiver repo. |
| `claimability` | pass | Task status `pending` was acceptable for this envelope. |
| `scope_match` | pass | Envelope paths were covered by AK task scope. |
| `authority_boundaries` | pass | Source-owner mutation was not authorized; owning-repo AK mutations were required. |
| `dirty_state` | pass | Receiver git worktree was clean before claim/mutation. |

Non-actions reported by preflight:

- no AK DB writes;
- no task claim or completion;
- no task contract or guardrail mutation;
- no intercom authority;
- no FCOS mutation;
- no source-owner mutation.

## Dogfood finding

The handoff preflight solved the main remaining gap from the prior intercom rerun: the receiver no longer had to manually infer whether it was in the correct owning repo or whether the task/scope/authority conditions were safe before claiming and mutating.

What worked:

- The preflight was truly read-only and ran before task claim or repo mutation.
- It gave an explicit `accepted` status with individual pass/fail checks.
- It verified the exact receiver repo path rather than relying on prose in the intercom message.
- It checked target task existence, task ownership, claimability, scope coverage, authority boundaries, and dirty git state in one operator-visible result.
- The accepted result made the subsequent owning-repo AK mutations straightforward: claim the task, author contract/guardrails, write the scoped report, validate, record evidence, complete, and commit.

Remaining gaps:

- The receiver still manually translates the accepted preflight into follow-on AK mutations; the preflight does not emit a command packet for scope/contract/guardrail/evidence authoring.
- The `expected_peer` field is reported but not yet a strong session-identity gate for the active Pi receiver.
- The workflow still depends on the controller placing the envelope on a shared filesystem path and telling the receiver which debug AK binary to use.

## Validation

Required validation for this owning-repo dogfood:

```bash
npm run check
git diff --check
```

Result: pass.

## SF12/IW24 implication

This is positive evidence for the SF12/IW24 direction: a typed, read-only AK handoff preflight can turn prose-shaped intercom coordination into a bounded, inspectable safety gate before cross-repo task mutation.

The next product improvement is not to make intercom authoritative. It is to make the post-acceptance path more ergonomic: a generated receiver command packet or guided reconciliation surface could reduce manual translation while preserving AK task/evidence/git receipts as durable truth.

## Non-actions and preserved boundaries

This dogfood did not:

- mutate `docs/_core/**`;
- change source code or supported capability states;
- mutate FCOS control-board, Prompt Vault, Pi/runtime, KES, ROCS, templates, steward/publication, Oracle/DSPx, or unrelated files;
- treat intercom as task/evidence/completion authority;
- claim SF12 or IW24 complete by itself.
