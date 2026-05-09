---
summary: "Recovery-backed repair readiness slice for test-capabilities healing proposal artifacts."
read_when:
  - "When extending heal, repair, generation, rollback, or Replay Fabric integration behavior"
  - "When deciding what must be true before self-healing or self-generation can become supported runtime behavior"
type: "reference"
system4d:
  container: "Bounded repair-readiness contract for future autonomous testing mutations."
  compass: "Make every risky repair explainable, reviewable, verifiable, and recoverable before claiming autonomy."
  engine: "dry-run proposal artifact -> verification evidence -> external checkpoint/restore authority -> replay-ledger milestones."
  fog: "Replay Fabric can become the recovery ledger, but it must not be treated as the rollback executor."
---

# Recovery-backed Repair Readiness — first slice

## Purpose

This note defines the first safe step toward recovery-backed repair/generation behavior in `test-capabilities`.

The current slice is intentionally small:

```text
heal --dry-run --proposal-output <file> --verification-output <file>
```

It writes durable JSON proposal and verification artifacts for review or future Replay Fabric artifact follow-through while mutating no source files.

When mutation mode is used later (`dryRun: false`), the operation requires an external checkpoint identity before applying any proposal.

## Boundary

This slice does **not** make self-healing autonomous.
It does **not** emit Replay Fabric milestones yet.
It does **not** create checkpoints.
It does **not** restore, undo, reset, or roll back anything.

Truthful split:

- `test-capabilities` owns proposal analysis and the dry-run artifact shape.
- An external checkpoint/restore tool must own any future checkpoint and restore execution.
- Replay Fabric may later record recovery milestones and artifact follow-through, but only as ledger/guidance.

## Proposal artifact contract

The proposal artifact is JSON with:

- `schema_version: 1`
- `artifact_kind: "test-capabilities.heal.proposal"`
- `operation_id: "heal"`
- `input` including `dir`, `dryRun`, `proposalOutput`, optional `verificationOutput`, and optional `checkpointRef`
- `mutation.mode: "dry_run"`
- `mutation.applied_count: 0`
- `mutation.external_checkpoint_required_for_apply: true`
- optional `mutation.external_checkpoint_ref` when `checkpointRef` was supplied
- `mutation.replay_fabric_guidance_only: true`
- `summary.scanned_file_count`
- `summary.proposal_count`
- `summary.file_count_with_proposals`
- `proposals[]` using the existing `HealingProposal` shape

The artifact is allowed only when `dryRun` is true. Requesting a proposal artifact during mutation mode fails closed.

## Verification artifact contract

The verification artifact is JSON with:

- `schema_version: 1`
- `artifact_kind: "test-capabilities.heal.verification"`
- `operation_id: "heal"`
- optional `proposal_artifact.path`
- the same dry-run mutation posture fields as the proposal artifact
- `verification.mode: "in_memory_apply_check"`
- `verification.status: "pass" | "fail"`
- `verification.proposalCount`
- `verification.checkedFileCount`
- `verification.failures[]`

This verifies that the proposal set can still be applied in memory to the current files at the recorded lines/columns. It does not execute tests, mutate files, or prove product correctness.

The artifact is allowed only when `dryRun` is true. Requesting a verification artifact during mutation mode fails closed.

## Checkpoint identity contract

`checkpointRef` is a factual identity produced by an external checkpoint/restore authority.
It is not created or validated by `test-capabilities` in this slice.

Rules:

- dry-run mode may include `checkpointRef` so artifacts can be correlated with an already-created checkpoint,
- apply mode requires `checkpointRef` when there is at least one proposal to mutate,
- a no-op apply with zero proposals does not require a checkpoint because it mutates nothing,
- `checkpointRef` must not imply Replay Fabric performed or can perform rollback,
- future Replay Fabric events may record the same ref as guidance/follow-through only.

Good examples:

```text
checkpoint/test-capabilities/heal-2026-04-30T12-00-00Z
asc-rewind/checkpoint/abc123
rewind/demo-main-001
```

## Why these are the first proof objects

A future repair/autonomy lane needs durable objects that can be reviewed, attached to a ledger, and correlated with checkpoint facts.
The proposal artifact says what would change. The verification artifact says whether the proposal set is internally applicable to the current files without mutation.

They can become future Replay Fabric `artifactRef` values without implying Replay Fabric owns mutation or rollback execution.

## Promotion gates before broader repair support

Before any stronger self-healing or self-generation behavior is promoted, the runtime needs:

1. proposal artifact emitted before mutation,
2. verification artifact emitted for proposal applicability and later runtime/test evidence,
3. externally-owned checkpoint identity for mutation mode,
4. externally-owned restore/undo proof for rollback posture,
5. optional Replay Fabric recovery milestones that record facts only,
6. human-review gate for risk-bearing changes,
7. fail-closed behavior when any required authority or artifact is missing.

## Current command

```bash
node ./bin/test-capabilities heal \
  --dir ./tests \
  --dry-run \
  --proposal-output artifacts/heal-proposals.json \
  --verification-output artifacts/heal-verification.json \
  --checkpoint-ref checkpoint/test-capabilities/heal-demo-001

node ./bin/test-capabilities heal \
  --dir ./tests \
  --checkpoint-ref checkpoint/test-capabilities/heal-apply-001
```
