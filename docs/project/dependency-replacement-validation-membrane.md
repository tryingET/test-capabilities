---
title: Dependency replacement validation membrane
summary: Generic non-authoritative validation-planning membrane between dep-diet, dep-surgeon, and test-capabilities.
status: draft
updated: 2026-05-19
read_when:
  - You are wiring dependency replacement/reimplementation candidates into test-capabilities validation.
  - You need to understand why dep-diet proof plans do not directly authorize target validation or mutation.
---

# Dependency replacement validation membrane

This membrane prevents dependency-intelligence review evidence from becoming accidental dependency-change authority.

Flow:

```text
dep-diet review evidence / proof-plan ranking
-> dep-surgeon explicit candidate plan or result
-> test-capabilities replacement validation request
-> target-owned validation plan/result
```

`test-capabilities` does not infer a replacement candidate directly from dep-diet. A request must cite a `dep-surgeon-plan` or `dep-surgeon-result` artifact and an explicit impact scope.

## Current surface

Runtime export:

```ts
createReplacementValidationPlan(input)
```

Request schema version:

```text
testcapabilities.replacement-validation-request.v1
```

Published JSON schema:

```text
schemas/testcapabilities.replacement-validation-request.v1.schema.json
```

Result schema version:

```text
testcapabilities.replacement-validation-result.v1
```

Published JSON schema:

```text
schemas/testcapabilities.replacement-validation-result.v1.schema.json
```

The current implementation is planning-only. It selects explicit repo-local validation commands but does not execute them. When a request includes `dependency-tree-persistence-check`, the result surfaces an explicit diagnostic that installed-tree persistence proof is required; the membrane still only plans the check.

CLI handoff:

```bash
test-capabilities replacement-validation plan \
  --request out/dep-surgeon/testcap-validation-request.json \
  --out out/test-capabilities/replacement-validation-result.json \
  --json
```

## Required request shape

A supported request requires the published schema fields:

- `candidateChangeRef.kind`: `dep-surgeon-plan` or `dep-surgeon-result`;
- `candidateChangeRef.path`;
- `impactScope.packageNames[]` with at least one package;
- `impactScope.validationCommands[]` with at least one explicit command.

The runtime parser still fails closed for malformed or incomplete inputs by returning `unsupported` with no selected commands. The published JSON schema defines the supported interop request shape.

## Authority boundary

The result always preserves false authority for mutation, dependency change, removal, replacement, merge, release, exploitability claims, disclosure claims, and trust certification.

A planned validation command means only:

> this target-owned validation command is relevant to the explicit candidate request.

It does not mean the dependency change is safe, approved, merged, released, exploitable/non-exploitable, disclosure-ready, or behaviorally equivalent.
