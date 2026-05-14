---
summary: "How-to guide for integrating test-capabilities into an existing repo without broad fake-green claims."
read_when:
  - "You are adding test-capabilities to an existing repo"
  - "You need a brownfield rollout recipe for CLI, Surf Go, Bombadil-compatible, or healing surfaces"
type: "how-to"
---

# Brownfield integration how-to

This guide is for agents and operators adding `test-capabilities` to an **existing** repository.

Use [greenfield bootstrap](greenfield-bootstrap-how-to.md) instead when the target repo is new enough to shape its commands and CI from scratch. Use [minimal CLI smoke walkthrough](minimal-cli-smoke-walkthrough.md) when you only need the smallest concrete first proof.

## Brownfield goal

Brownfield adoption improves by narrowing the first proof, not by pointing the whole tool at everything.

Start with one safe target and one supported surface:

```text
inventory existing repo
  -> pick safe CLI target
  -> generate/review config with init
  -> doctor
  -> test --quick --json
  -> route advanced Surf/Bombadil/healing work separately
```

## Rollout recipe

### 1) Inventory target surfaces

Before writing config, identify:

- one CLI command that safely supports `--help`
- whether the repo has a local web app suitable for Surf Go exploration
- whether a Bombadil-compatible runtime is already installed or buildable
- whether selector-healing proposals would be useful and reviewable
- which CI job can run a zero-external smoke without credentials or network assumptions

Do not make optional browser/property runtimes block the first CLI smoke proof.

### 2) Generate a narrow baseline config

```bash
test-capabilities init --output test-capabilities.yaml --target '<safe-command>'
```

If `test-capabilities.yaml` already exists, do not overwrite it blindly. Use:

```bash
test-capabilities init --target '<safe-command>' --print
```

Then merge only the needed baseline fields.

### 3) Run diagnostics before running tests

```bash
test-capabilities doctor --config test-capabilities.yaml --target '<safe-command>' --json
```

Classify the output honestly:

- required package/runtime/config/target checks must pass
- missing Surf Go is acceptable until you adopt `surf`
- missing Bombadil-compatible runtime is acceptable until you adopt `bombadil`
- invalid explicit runtime env vars are blockers because they would make later runs ambiguous

### 4) Run the first supported path

```bash
test-capabilities test --config test-capabilities.yaml --quick --json
```

This first path should prove only CLI smoke + observation diagnostics. It should not claim browser coverage, API coverage, prediction, autonomous repair, or causal root cause.

Useful checks in the JSON envelope:

- `operationId` is `test`
- `summary.health` matches the intended pass/fail state
- `result.observations` includes CLI smoke evidence
- `summary.coverage.gaps` names unmeasured dimensions
- unsupported flags are absent from the config and command line

### 5) Add one advanced surface at a time

After the CLI smoke path is stable, add optional surfaces as separate slices.

#### Surf Go slice

Use when the repo has a real web target and Surf Go is resolvable:

```bash
test-capabilities doctor --target https://example.com --json
test-capabilities surf explore --url https://example.com --depth 1
```

Then add a `surf` orchestrator agent only when the standalone explore path is boring.

#### Bombadil-compatible slice

Use when a Bombadil-compatible binary is available:

```bash
TEST_CAPABILITIES_BOMBADIL_BIN=/path/to/bombadil \
  test-capabilities test --config test-capabilities.bombadil.yaml --target https://example.com --quick --json
```

A source checkout must be built first and referenced through `TEST_CAPABILITIES_BOMBADIL_REPO`. Packed npm consumers should still treat Bombadil-compatible tooling as external.

#### Healing slice

Use when selector repair proposals can be reviewed:

```bash
test-capabilities heal --dir ./tests --dry-run \
  --proposal-output artifacts/heal-proposals.json \
  --verification-output artifacts/heal-verification.json
```

Apply mode requires an external `--checkpoint-ref`. The command records that identity but does not create checkpoints or perform rollback.

### 6) Record the adoption state

Add a small repo-local note such as `docs/dev/test-capabilities-current-vs-target.md` in the target repo. It should answer:

- current supported slice(s)
- command(s) to rerun them
- optional runtimes intentionally absent or required
- known gaps and unsupported surfaces
- next bounded surface, if any

Keep this note repo-local. It is more useful than a broad copied product overview.

## Brownfield anti-patterns

Avoid these:

- treating a missing optional Surf/Bombadil runtime as a reason not to adopt the CLI smoke path
- enabling all agents at once in the first config
- using production URLs or mutating CLIs as first targets
- converting diagnostic `root_cause` or `propagation` observations into causal proof
- hiding unsupported autonomy/prediction failures by removing fail-closed checks
- committing generated proposal/report artifacts unless the target repo intentionally retains them

## Definition of good brownfield adoption

A brownfield repo is in good shape when:

- one safe CLI smoke path is repeatable from a normal checkout
- `doctor` required checks pass
- optional runtime warnings are understood and routed
- JSON output is available for CI/agents
- advanced surfaces are separate follow-up slices
- a repo-local current-vs-target note states what is live, what is not measured, and what is next
