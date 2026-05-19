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
- `@cucumber/cucumber` — test/BDD tooling; current evidence has a scenario gap
- `@types/figlet` — type tooling
- `@types/node` — type tooling
- `@typescript/native-preview` — type tooling
- `fast-check` — test/property tooling
- `vitest` — test/unit tooling

## Evidence interpretation

- `confirmed`: the prior review-program evidence observed the runtime dependency in relevant scenarios.
- `expected-not-observed`: absence from CLI/runtime evidence is expected because the dependency belongs to a non-runtime lifecycle.
- `scenario-gap`: the role is accepted, but the needed lifecycle scenario was not part of the evidence set.

The main current scenario gap is:

```text
@cucumber/cucumber -> test-tooling -> needs behavior-test/BDD scenario evidence
```

## Validation

The decisions file validates against dep-diet's schema:

```bash
node /home/tryinget/ai-society/softwareco/owned/dep-diet/scripts/validate_depdiet_schema_payload.mjs \
  dependency.role.decisions.v1 \
  .dependency-intelligence/dependency-role-decisions.v1.json
```

## Boundary

Accepted role decisions are source-owner facts for review and drift detection. They do not authorize dependency mutation, removal, replacement, merge, release, exploitability, disclosure, or trust decisions.
