---
summary: "Accepted source-owner dependency role decisions for direct dependency roots."
read_when:
  - "Reviewing accepted dependency roles for test-capabilities."
  - "Checking which lifecycle scenario should validate a direct dependency."
type: "evidence"
---

# Dependency-intelligence role decisions

`test-capabilities` records source-owner dependency role decisions at:

```text
.dependency-intelligence/dependency-role-decisions.v1.json
```

This file promotes the broad role hints into accepted review-context facts for direct dependency roots.

## Purpose

Role decisions answer:

```text
Why is this direct dependency here, and which lifecycle scenario should validate it?
```

They do not answer:

```text
Can this dependency be removed, replaced, merged, released, or certified?
```

## Current decisions

Runtime dependencies with confirmed evidence:

- `chalk` — runtime
- `commander` — runtime
- `figlet` — runtime/demo
- `js-yaml` — runtime/config-load
- `ora` — runtime
- `zod` — runtime/API validation

Tooling dependencies with expected lifecycle-specific evidence:

- `@biomejs/biome` — lint/format tooling
- `@cucumber/cucumber` — test/BDD tooling; behavior-test evidence is confirmed
- `@types/figlet` — type tooling
- `@types/node` — type tooling
- `@typescript/native-preview` — type tooling
- `fast-check` — test/property tooling
- `vitest` — test/unit tooling

## Evidence interpretation

- `confirmed`: the prior review-program evidence observed the runtime dependency in relevant scenarios.
- `expected-not-observed`: absence from CLI/runtime evidence is expected because the dependency belongs to a non-runtime lifecycle.
- `scenario-gap`: the role is accepted, but the needed lifecycle scenario was not part of the evidence set.

Current behavior-test evidence closes the prior Cucumber scenario gap:

```text
@cucumber/cucumber -> test-tooling -> behavior-test/BDD evidence confirmed
```

## Validation

The decisions file validates against dep-diet's schema:

```bash
node /home/tryinget/ai-society/softwareco/owned/dep-diet/scripts/validate_depdiet_schema_payload.mjs \
  dependency.role.decisions.v1 \
  .dependency-intelligence/dependency-role-decisions.v1.json
```

Dep-diet can compare current review evidence against the accepted ledger:

```bash
node /home/tryinget/ai-society/softwareco/owned/dep-diet/scripts/depdiet.mjs analyze . \
  --gardener-output <gardener-output.json> \
  --runtime-bundle <runtime-trace-bundle.json> \
  --out-depmodel <depmodel.json> \
  --out-review-program <dependency-review-program.v1.json> \
  --dependency-role-hints .dependency-intelligence/dependency-role-hints.v1.json \
  --dependency-role-decisions .dependency-intelligence/dependency-role-decisions.v1.json
```

Latest dogfood artifacts:

```text
/tmp/test-capabilities-bdd-runtime-trace-20260519184819
/tmp/test-capabilities-depintel-bdd-role-decisions-accepted-20260519184928
```

The behavior-test runtime trace was recorded with:

```bash
node /home/tryinget/ai-society/softwareco/owned/runtime-trace-insights/scripts/runtime_trace_bundle.mjs record \
  /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --package-autodiscovery \
  --observed-package @cucumber/cucumber@12.8.1 \
  --out /tmp/test-capabilities-bdd-runtime-trace-20260519184819/runtime/behavior-bdd.runtime-trace-bundle.json \
  --run-id test-capabilities-behavior-bdd-cucumber \
  -- npm run test:behavior:raw --silent
```

Artifact hashes:

```text
1688b6451b699177837348619b5fc7e317fa1e35299567c7c51061fbdf36a9ea  /tmp/test-capabilities-bdd-runtime-trace-20260519184819/runtime/behavior-bdd.runtime-trace-bundle.json
436548862ad3041373f6efeb8e5e1afcc8f4acbe06b8f3329ef7a8ae485e998d  /tmp/test-capabilities-depintel-bdd-role-decisions-accepted-20260519184928/depdiet/dependency-review-program.v1.json
4b97294b0b8776d7c3635177d324b94c64253adaa26271e895b48a8fc848a4be  /tmp/test-capabilities-depintel-bdd-role-decisions-accepted-20260519184928/depdiet/depmodel.json
```

Comparison summary:

```json
{
  "confirmed": 7,
  "expected-not-observed": 6
}
```

No direct-root role decision remains in `scenario-gap` for the current evidence set.

## Boundary

Accepted role decisions are source-owner facts for review and drift detection. They do not authorize dependency mutation, removal, replacement, merge, release, exploitability, disclosure, or trust decisions.
