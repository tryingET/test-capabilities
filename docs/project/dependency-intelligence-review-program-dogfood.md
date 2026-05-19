---
summary: "Dogfood evidence for dep-diet dependency-review-program.v1 plus dep-viz rendering and DSPx generated reviewer execution."
read_when:
  - "Reviewing dependency-intelligence review-program evidence for test-capabilities."
  - "Checking whether dep-diet review packets and DSPx generated review programs have been run against this repo."
type: "evidence"
---

# Dependency-intelligence review-program dogfood

Date: 2026-05-19

Artifact root:

```text
/tmp/test-capabilities-depintel-review-program-20260519123902
```

This dogfood ran the first end-to-end dependency-review-program loop for `test-capabilities`:

```text
runtime-trace-insights bundles + Gardener/static evidence
-> dep-diet dependency-review-program.v1 packet + depmodel.v1
-> dep-viz render
-> DSPx-generated DSPy review program
-> review-only findings + next evidence actions + authority boundary
```

## Inputs

Reused source evidence from the runtime autodiscovery pilot:

- Gardener/static evidence: `/tmp/test-capabilities-depintel-autodiscovery-20260519085727/gardener/output/test_capabilities_dependency_analysis.json`
- runtime bundles:
  - `/tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/doctor.runtime-trace-bundle.json`
  - `/tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/demo.runtime-trace-bundle.json`
  - `/tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/test-fixture.runtime-trace-bundle.json`
  - `/tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/capability-drill.runtime-trace-bundle.json`

Target context supplied to the DSPx generated program kept `acceptedDependencyChanges=false` and carried the explicit source-owner rule: do not interpret `declared-unobserved` as unused.

## Commands

Dep-diet review packet emission:

```bash
DEPDIET=/home/tryinget/ai-society/softwareco/owned/dep-diet
TC=/home/tryinget/ai-society/softwareco/owned/test-capabilities
PREV=/tmp/test-capabilities-depintel-autodiscovery-20260519085727
ART=/tmp/test-capabilities-depintel-review-program-20260519123902

cd "$TC"
node "$DEPDIET/scripts/depdiet.mjs" analyze "$TC" \
  --gardener-output "$PREV/gardener/output/test_capabilities_dependency_analysis.json" \
  --runtime-bundle "$PREV/runtime/doctor.runtime-trace-bundle.json" \
  --runtime-bundle "$PREV/runtime/demo.runtime-trace-bundle.json" \
  --runtime-bundle "$PREV/runtime/test-fixture.runtime-trace-bundle.json" \
  --runtime-bundle "$PREV/runtime/capability-drill.runtime-trace-bundle.json" \
  --out-depmodel "$ART/depdiet/depmodel.json" \
  --out-review-program "$ART/depdiet/dependency-review-program.v1.json" \
  --report-path "$ART/depdiet/report.json" \
  --format json --compact
```

Schema validation:

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-diet
node scripts/validate_depdiet_schema_payload.mjs \
  dependency.review.program.v1 \
  /tmp/test-capabilities-depintel-review-program-20260519123902/depdiet/dependency-review-program.v1.json
```

Dep-viz render:

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-viz
go run ./cmd/depviz report \
  --model /tmp/test-capabilities-depintel-review-program-20260519123902/depdiet/depmodel.json \
  --out /tmp/test-capabilities-depintel-review-program-20260519123902/depviz/report \
  --render-only
```

DSPx generated-program run:

```bash
DSPX=/home/tryinget/ai-society/softwareco/owned/dspx
TC=/home/tryinget/ai-society/softwareco/owned/test-capabilities
GEN="$TC/.dependency-intelligence/dspx/generated-program"
ART=/tmp/test-capabilities-depintel-review-program-20260519123902

cd "$GEN"
uv run --project "$DSPX" --package dspx-core -q python direct_run.py \
  --inputs "$ART/dspx/runtime_inputs.json" \
  --outdir "$ART/dspx/direct" \
  --json

cd "$DSPX"
just dspx program-run \
  --manifest "$GEN/manifest.json" \
  --inputs "$ART/dspx/runtime_inputs.json" \
  --outdir "$ART/dspx/program-run" \
  --skip-oracle-index \
  --json
```

## Dep-diet result

Depmodel summary:

```json
{
  "packages": 281,
  "observed": 27,
  "classifications": {
    "declared-unobserved": 253,
    "static-central-unobserved": 1,
    "runtime-only": 21,
    "static-runtime-confirmed": 6
  }
}
```

Review-program packet summary:

```json
{
  "programId": "depdiet:js:.:dependency-review",
  "scenarioCount": 4,
  "classifications": [
    "declared-unobserved",
    "runtime-only",
    "static-central-unobserved",
    "static-runtime-confirmed"
  ],
  "reviewSignalCount": 275,
  "nextEvidenceActionCount": 275
}
```

Schema validation returned `ok: true` for `dependency.review.program.v1`.

## Dep-viz result

Dep-viz rendered the depmodel successfully:

```text
/tmp/test-capabilities-depintel-review-program-20260519123902/depviz/report/index.html
```

Interpretation remains rendering-only. The report does not authorize dependency removal, replacement, merge, release, exploitability, disclosure, or trust decisions.

## DSPx result

The committed DSPx-generated dependency review program accepted:

- `dependency_review_program_json`
- `depmodel_json`
- `target_context_json`

Direct generated-program run:

```json
{
  "status": "ok",
  "output_files": [
    "review_findings_json",
    "next_evidence_actions_json",
    "authority_boundary_json"
  ],
  "provider": "dspy-lm-auth/codex/gpt-5.5",
  "canonical_notes_mutated": false,
  "dspx_program_run_wrapper_used": false
}
```

Audited `program-run`:

```json
{
  "schema_version": "program-runtime-episode-workflow-v1",
  "status": "ok",
  "runtime_execution": "executed",
  "oracle_index": "skipped"
}
```

Key generated review findings:

- evidence is bounded to four representative command-level scenarios;
- six packages were static/runtime-confirmed;
- one direct package, `npm:@cucumber/cucumber@12.8.1`, was static-central-unobserved and needs source-owner scenario/role review;
- 253 packages were declared-unobserved under the supplied scenario set, not unused;
- 21 packages were runtime-only and should be reconciled through runtime trace source paths, lockfile edges, and static analyzer coverage;
- no dep-redteam request is warranted unless vulnerability or advisory evidence is added.

Generated authority boundary:

```json
{
  "decision": "withheld_pending_source_owner_review",
  "dependencyMutationAllowed": false,
  "mutationAuthority": false,
  "removalAuthority": false,
  "replacementAuthority": false,
  "mergeAuthority": false,
  "releaseAuthority": false,
  "exploitabilityAuthority": false,
  "disclosureAuthority": false,
  "trustCertificationAuthority": false
}
```

## Artifact hashes

```text
f9998221cdd2e1a9571c6cfdbfebc54831169f756965432b4d03cc68fd5c87c1  depdiet/dependency-review-program.v1.json
446e9921e51bb6f14161d03a316b973e691940685ce7fa5991355bd877949b83  depdiet/depmodel.json
8c38030c161c57e340bd7fb0b03d3df316367e61eb633a59f19759148958fe6a  depviz/report/index.html
05c362573e900fcec212f15e986857140110a6cce6b012e0c7879df80e40a471  dspx/direct/direct_run_receipt.json
a969e8d9a2caf5a659ab099fcf2a15de51349469dde20e81ea83375196740de6  dspx/program-run/runtime_episode.json
```

## Boundary

This dogfood proves the review-program loop can run. It does not prove any dependency is unused or approve any dependency change.

Next useful source-owner action is to add target-owned dependency role annotations and/or accepted scenarios for the direct declared-unobserved packages and the Cucumber static-central-unobserved path.
