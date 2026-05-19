---
summary: "Dogfood evidence for dep-diet direct dependency usage-depth and replacement-opportunity assessments."
read_when:
  - "Reviewing test-capabilities dependency usage-depth evidence."
  - "Checking which direct dependencies are replacement or reimplementation review candidates."
type: "evidence"
---

# Dependency-intelligence usage assessment

This document records the first `dep-diet` direct dependency usage-depth / replacement-opportunity dogfood for `test-capabilities`.

The assessment is review evidence only. It does not authorize dependency removal, replacement, mutation, merge, or release.

## Artifact

```text
/tmp/test-capabilities-depintel-usage-assessment-20260519193934
```

Key outputs:

```text
/tmp/test-capabilities-depintel-usage-assessment-20260519193934/depdiet/dependency-review-program.v1.json
/tmp/test-capabilities-depintel-usage-assessment-20260519193934/depdiet/depmodel.json
```

## Summary

`dep-diet` emitted one direct-root usage assessment for each accepted direct dependency root:

```json
{
  "assessmentCount": 13,
  "opportunities": {
    "low-review": 5,
    "medium-review": 6,
    "reimplementation-review": 2
  }
}
```

## Current review signals

Runtime-observed direct roots with small current footprint flagged for reimplementation review:

- `chalk` — runtime styling; inspect used API surface before considering a local wrapper or smaller replacement.
- `commander` — CLI parsing; inspect actual command/option surface before considering a smaller parser or local implementation.

Runtime-observed direct roots currently treated as lower replacement priority:

- `@cucumber/cucumber` — behavior/BDD test tooling; high transitive footprint, but role evidence is confirmed.
- `figlet` — runtime/demo banner output.
- `js-yaml` — runtime/config loading.
- `ora` — runtime spinner/status UX.
- `zod` — runtime validation.

Declared but unobserved in the current runtime scenario set; lifecycle-specific review remains expected before replacement planning:

- `@biomejs/biome`
- `@types/figlet`
- `@types/node`
- `@typescript/native-preview`
- `fast-check`
- `vitest`

## Interpretation

This is the first slice that moves beyond “does the dependency have an accepted role?” toward:

```text
role + static usage surface + runtime observation + transitive footprint
-> replacement/reimplementation review signal
```

The `reimplementation-review` level still means “inspect used API surface and proof requirements,” not “replace/remove now.” Any actual dependency change needs a separate candidate patch and target validation workflow.
