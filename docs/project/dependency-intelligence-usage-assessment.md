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

Initial coarse assessment:

```text
/tmp/test-capabilities-depintel-usage-assessment-20260519193934
```

API/symbol/callsite assessment:

```text
/tmp/test-capabilities-depintel-api-surface-20260519201013
```

API member assessment:

```text
/tmp/test-capabilities-depintel-api-members-20260519201920
```

Object-flow/member-chain assessment:

```text
/tmp/test-capabilities-depintel-object-flow-20260519203456
```

Key outputs:

```text
/tmp/test-capabilities-depintel-object-flow-20260519203456/depdiet/dependency-review-program.v1.json
/tmp/test-capabilities-depintel-object-flow-20260519203456/depdiet/depmodel.json
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

- `chalk` — runtime styling; imported once in `bin/test-capabilities` as default import; observed member surface is `bold`, `cyan`, `dim`, `green`, `red`, and `yellow`.
- `commander` — CLI parsing; imported once in `bin/test-capabilities` as `{ Command }`; observed object-flow surface is `new Command`, `name`, `description`, `version`, `command`, `argument`, `option`, `action`, and `parseAsync`.

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

The API/symbol/callsite slice adds bounded used-surface evidence:

```json
{
  "chalk": {
    "symbols": ["default"],
    "usedApiMembers": ["bold", "cyan", "dim", "green", "red", "yellow"],
    "recordCount": 1,
    "callsites": ["bin/test-capabilities:10"]
  },
  "commander": {
    "symbols": ["Command"],
    "usedApiMembers": ["action", "argument", "command", "description", "name", "new Command", "option", "parseAsync", "version"],
    "recordCount": 1,
    "callsites": ["bin/test-capabilities:11"]
  },
  "figlet": {
    "symbols": ["default"],
    "usedApiMembers": ["textSync"],
    "recordCount": 1,
    "callsites": ["bin/test-capabilities:12"]
  },
  "zod": {
    "symbols": ["z", "ZodType", "ZodTypeDef"],
    "recordCount": 9
  }
}
```

This is the first slice that moves beyond “does the dependency have an accepted role?” toward:

```text
role + static usage surface + runtime observation + transitive footprint
-> replacement/reimplementation review signal
```

The `reimplementation-review` level still means “inspect used API surface and proof requirements,” not “replace/remove now.” Any actual dependency change needs a separate candidate patch and target validation workflow.
