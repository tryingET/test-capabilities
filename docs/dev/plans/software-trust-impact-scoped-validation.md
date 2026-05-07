---
summary: "Plan for test-capabilities impact-scoped validation handoffs for Software Trust dependency replacement candidates."
read_when:
  - "Designing or consuming test-capabilities validation for dep-surgeon replacement plans/results."
  - "Choosing impact-scoped test surfaces for Software Trust Corridor candidate patches."
  - "Checking that replacement validation does not become merge, release, exploitability, or trust authority."
type: "contract"
---

# Software Trust impact-scoped validation handoff

## Purpose

This plan defines the first test-capabilities handoff contract for dependency replacement candidates in the Software Trust Remediation Corridor.

It is intentionally a design/contract slice, not a new runtime claim. It should guide the first implementation of an impact-scoped validation operation without implying that test-capabilities already certifies candidate replacements.

## Corridor position

```text
dep-diet replacement intent
-> dep-surgeon replacement plan/result
-> test-capabilities impact-scoped validation
-> runtime-trace-insights after-change re-observation
-> dep-viz before/after explanation
-> dep-redteam review when security-driven
-> ts-quality bounded trust/adoption proof
```

`test-capabilities` owns behavioral validation planning/results for the candidate replacement. It does not own dependency evidence fusion, patch generation, runtime trace truth, vulnerability validation, or final trust certification.

## Input handoff: replacement validation request

A future runtime surface should accept a request shaped like this:

```json
{
  "schemaVersion": "testcapabilities.replacement-validation-request.v1",
  "requestId": "tc-request-001",
  "source": {
    "owner": "dep-surgeon",
    "replacementPlanRef": "depsurgeon-plan-123",
    "replacementResultRef": "depsurgeon-result-123"
  },
  "target": {
    "repoPath": "/path/to/target",
    "baseRef": "HEAD",
    "candidateRef": "candidate-worktree-or-branch"
  },
  "impactScope": {
    "changedFiles": ["package.json", "src/parser.ts"],
    "manifestFiles": ["package.json"],
    "lockfiles": ["package-lock.json"],
    "staticIntroducerPaths": [["npm:zod@3.23.8"]],
    "runtimeObservedPaths": ["src/parser.ts"],
    "publicCapabilities": ["cli:parse"],
    "repoSmokeCommands": ["npm test"]
  },
  "evidenceRefs": [
    "depdiet-intent-123",
    "runtime-trace-before-123",
    "runtime-trace-after-123"
  ],
  "authority": {
    "mergeAuthority": false,
    "releaseAuthority": false,
    "exploitabilityAuthority": false,
    "disclosureAuthority": false,
    "trustCertificationAuthority": false
  }
}
```

The `impactScope` should be assembled from:

1. files changed by the candidate patch;
2. manifest and lockfile deltas;
3. Gardener/dep-diet static introducer paths and dependency centrality context;
4. runtime-trace-insights before/after observed paths and commands;
5. public CLI/API/UI capabilities touched by changed files;
6. a repo smoke gate that the target repo owner accepts as relevant.

## Output handoff: validation result

A future runtime surface should emit a result shaped like this:

```json
{
  "schemaVersion": "testcapabilities.replacement-validation-result.v1",
  "requestId": "tc-request-001",
  "status": "passed | failed | inconclusive | unsupported",
  "validatedScope": {
    "commandsRun": ["npm test"],
    "filesCovered": ["src/parser.ts"],
    "capabilitiesCovered": ["cli:parse"]
  },
  "findings": [
    {
      "severity": "info | warning | error",
      "message": "What changed or failed",
      "evidencePath": "out/test-capabilities/replacement-validation.json"
    }
  ],
  "gaps": [
    {
      "code": "runtime-path-uncovered",
      "message": "Observed runtime path had no matching validation command."
    }
  ],
  "authority": {
    "mergeAuthority": false,
    "releaseAuthority": false,
    "exploitabilityAuthority": false,
    "disclosureAuthority": false,
    "trustCertificationAuthority": false
  }
}
```

`passed` means the requested impact scope passed the selected checks. It does not mean the replacement is globally safe, production-ready, releasable, exploitable/non-exploitable, or trust-certified.

## Selection rules

Prefer the narrowest test surface that truthfully exercises the candidate's impact:

1. If files changed under a known package/module, run that module's direct tests first.
2. If runtime-trace-insights observed a command/path before replacement, rerun the comparable command after replacement when feasible.
3. If dep-diet introducer paths point to public CLI/API/UI surfaces, include at least one capability probe for that surface.
4. If only manifest/lockfiles changed, run install/lockfile integrity and the repo smoke gate before broader suites.
5. If no meaningful impact scope can be derived, return `unsupported` or `inconclusive` instead of inventing coverage.

## Non-authorizations

A replacement validation result does not authorize:

- merge;
- release;
- dependency removal as a policy conclusion;
- exploitability or non-exploitability claims;
- disclosure;
- trust certification.

Those conclusions require owner-specific downstream evidence, usually dep-redteam for vulnerability-specific claims and ts-quality for bounded trust/adoption proof.

## First implementation notes

The first runtime slice should be conservative:

- add a typed request/result parser;
- fail closed when required impact-scope fields are missing;
- support a dry-run planning mode that prints selected commands before execution;
- run only explicit repo-local commands supplied by the request or target repo config;
- emit machine-readable gaps instead of silently widening to whole-repo testing;
- preserve source artifact references from dep-diet, dep-surgeon, and runtime-trace-insights.

This plan should be replaced by code/tests/docs only when those surfaces exist. Until then, describe this as a planned handoff contract, not an implemented validation capability.
