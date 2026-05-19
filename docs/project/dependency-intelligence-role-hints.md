---
summary: "Source-owner dependency role hints for interpreting dependency-intelligence scenario evidence."
read_when:
  - "Reviewing dependency-intelligence role categories for test-capabilities."
  - "Checking why declared-unobserved direct dependencies are not automatically unused."
type: "evidence"
---

# Dependency-intelligence role hints

`test-capabilities` carries broad lifecycle/tooling role hints at:

```text
.dependency-intelligence/dependency-role-hints.v1.json
```

The file intentionally annotates direct dependency roots and a few platform/optional introducer families. It does not tag every transitive package.

## Purpose

Role hints answer:

```text
Which lifecycle scenario should exercise this dependency?
```

They do not answer:

```text
Can this dependency be removed or replaced?
```

## Categories used

- `runtime` — shipped CLI/runtime behavior, such as `commander`, `chalk`, `ora`, `figlet`, `js-yaml`, and `zod`.
- `test-tooling` — test execution support, such as `vitest`, `@cucumber/cucumber`, and `fast-check`.
- `type-tooling` — typecheck/build typing support, such as `@types/*` and `@typescript/native-preview`.
- `lint-format-tooling` — lint/format support, such as `@biomejs/biome`.
- `platform-optional-binary` — OS/arch-specific package families, such as `@biomejs/cli-*`, `@typescript/native-preview-*`, `@esbuild/*`, and `@rollup/rollup-*`.

## Validation evidence

Role hints schema validation passed:

```text
node /home/tryinget/ai-society/softwareco/owned/dep-diet/scripts/validate_depdiet_schema_payload.mjs \
  dependency.role.hints.v1 \
  .dependency-intelligence/dependency-role-hints.v1.json
```

Dogfood artifact root:

```text
/tmp/test-capabilities-depintel-role-hints-20260519141156
```

Dep-diet consumed the hints and emitted role annotations in the review-program packet:

```json
{
  "roleAnnotationCount": 79,
  "roles": {
    "lint-format-tooling": 1,
    "platform-optional-binary": 63,
    "test-tooling": 3,
    "type-tooling": 3,
    "runtime": 9
  },
  "unmatched": 0
}
```

## Boundary

A role hint changes scenario-expectation context. For example, `test-tooling` unobserved in a CLI scenario is expected unless a matching test scenario was included.

Role hints do not authorize dependency mutation, removal, replacement, merge, release, exploitability, disclosure, or trust decisions.
