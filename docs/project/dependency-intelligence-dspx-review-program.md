---
summary: "DSPx-generated dependency review program for test-capabilities dependency-intelligence dogfood."
read_when:
  - "Reviewing the test-capabilities dependency-intelligence review-program dogfood."
  - "Rerunning or inspecting the target-bound DSPx generated dependency review program."
type: "evidence"
---

# Dependency-intelligence DSPx review program

This repo now carries a target-bound DSPx generated DSPy review program for dependency-intelligence review dogfood.

The program is generated from dep-diet's `dependency-review-program.v1` contract and is intentionally review-only:

```text
dependency evidence -> source-owner review findings + next evidence actions
not -> dependency removal / replacement / merge / release authority
```

## Source contracts

- dep-diet contract: `/home/tryinget/ai-society/softwareco/owned/dep-diet/docs/project/dependency-review-program.v1.md`
- dep-diet schema: `/home/tryinget/ai-society/softwareco/owned/dep-diet/schemas/depdiet.dependency-review-program.v1.schema.json`
- dep-viz rendering contract: `/home/tryinget/ai-society/softwareco/owned/dep-viz/docs/project/dependency-review-program-rendering.md`
- test-capabilities target posture: `docs/project/vision.md`, `docs/project/product-posture.md`

## Generated artifact layout

```text
.dependency-intelligence/dspx/
  intent.yaml
  gate/
    generation_target_contract.json
    generation_fitness_suite.json
    generation_gate_preflight.json
  generated-program/
    signature.py
    module.py
    program.py
    eval_smoke.py
    eval_examples.py
    eval_behavior.py
    manifest.json
    generation_traceability.json
    generation_fitness_results.json
```

The source intent is committed so the program can be regenerated after the dep-diet contract, target scenarios, or dependency-review policy changes.

## Generation commands

Executed from `/home/tryinget/ai-society/softwareco/owned/dspx`:

```bash
TC=/home/tryinget/ai-society/softwareco/owned/test-capabilities
GATE="$TC/.dependency-intelligence/dspx/gate"
GEN="$TC/.dependency-intelligence/dspx/generated-program"

just dspx program-gen target-contract \
  --intent "$TC/.dependency-intelligence/dspx/intent.yaml" \
  --out "$GATE/generation_target_contract.json" \
  --json

just dspx program-gen fitness-suite \
  --target-contract "$GATE/generation_target_contract.json" \
  --out "$GATE/generation_fitness_suite.json" \
  --json

just dspx program-gen verify-generation-gate \
  --intent "$TC/.dependency-intelligence/dspx/intent.yaml" \
  --target-contract "$GATE/generation_target_contract.json" \
  --fitness-suite "$GATE/generation_fitness_suite.json" \
  --out "$GATE/generation_gate_preflight.json" \
  --json

just dspx program-gen \
  --intent "$TC/.dependency-intelligence/dspx/intent.yaml" \
  --outdir "$GEN" \
  --generation-gate-preflight "$GATE/generation_gate_preflight.json" \
  --print-manifest

just dspx program-gen traceability \
  --manifest "$GEN/manifest.json" \
  --target-contract "$GATE/generation_target_contract.json" \
  --out "$GEN/generation_traceability.json" \
  --json

just dspx program-gen fitness-results \
  --manifest "$GEN/manifest.json" \
  --target-contract "$GATE/generation_target_contract.json" \
  --fitness-suite "$GATE/generation_fitness_suite.json" \
  --traceability "$GEN/generation_traceability.json" \
  --out "$GEN/generation_fitness_results.json" \
  --json
```

## Gate result

`generation_gate_preflight.json` reports:

```json
{
  "schema_version": "gen-generation-gate-preflight-v1",
  "status": "generation_allowed",
  "fail_closed_reasons": []
}
```

`generation_fitness_results.json` reports:

```json
{
  "schema_version": "gen-fitness-results-v1",
  "status": "fitness_passed",
  "rendered_state": "eligible_for_downstream_evidence_review",
  "verifier_non_guarantee": "semantic_truth_domain_acceptance_or_activation"
}
```

Interpretation:

```text
eligible_for_downstream_evidence_review != accepted dependency truth
```

## Program behavior contract

The generated signature accepts:

- `dependency_review_program_json`;
- `depmodel_json`;
- `target_context_json`.

It emits:

- `review_findings_json`;
- `next_evidence_actions_json`;
- `authority_boundary_json`.

The program must preserve these boundaries:

- `declared-unobserved` means unobserved under the supplied scenario set, not unused;
- dep-viz rendering is explanation, not remediation authority;
- dep-redteam is optional and security/advisory-specific;
- source-owner review is required before accepting dependency role, removal, replacement, merge, or release decisions;
- all mutation/removal/replacement/merge/release/exploitability/disclosure/trust authority flags remain false.

## Current use

This is the first generated target-bound review-program dogfood. It is ready to be used with the next dep-diet review packet for test-capabilities.

It does not by itself change dependencies, validate replacements, close FCOS items, mutate AK, or certify security posture.
