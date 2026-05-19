---
summary: "Dependency-intelligence corridor pilot for test-capabilities using Gardener static evidence, runtime-trace-insights, dep-diet, and dep-viz."
read_when:
  - "Reviewing dependency evidence for test-capabilities."
  - "Checking whether static/runtime dependency classifications have removal or remediation authority."
type: "project"
---

# Dependency-intelligence corridor pilot

## Design membrane

This pilot ran the dependency-intelligence corridor against this repo as a target:

```text
test-capabilities doctor command
-> runtime-trace-insights runtime bundle
-> Gardener target-specific static analysis
-> dep-diet static/runtime fusion
-> dep-viz report render
```

The result is dependency evidence for review. It is not dependency removal, remediation, exploitability, disclosure, merge, release, or trust-certification authority.

Boundary principle:

```text
static centrality != runtime observation != declared-unobserved status != removal authority
```

## Representative runtime command

The selected zero-external representative command was:

```bash
node ./bin/test-capabilities doctor --json
```

The prior fresh scout run confirmed the command exited successfully with:

```text
requiredPassed=10
requiredFailed=0
```

## Temporary artifact root

Controller-produced artifacts live under:

```text
/tmp/test-capabilities-depintel-controller-20260519080023
```

These artifacts are evidence outputs, not repo-owned source files. They can be regenerated from the commands below.

## Commands run

### Runtime bundle

The runtime bundle was preserved from the fresh scout run:

```text
/tmp/test-capabilities-depintel-scoutpeer-mpc2xv5w/runtime/runtime-trace-bundle.json
```

It was copied to:

```text
/tmp/test-capabilities-depintel-controller-20260519080023/runtime/runtime-trace-bundle.json
```

The equivalent regeneration command is:

```bash
cd /home/tryinget/ai-society/softwareco/owned/runtime-trace-insights
node scripts/runtime_trace_bundle.mjs record \
  /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --observed-package commander@12.0.0 \
  --out /tmp/test-capabilities-depintel-controller-20260519080023/runtime/runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-doctor \
  -- node ./bin/test-capabilities doctor --json
```

### Target-specific Gardener static evidence

```bash
cd /tmp/test-capabilities-depintel-controller-20260519080023/gardener
uv run --project /home/tryinget/ai-society/softwareco/contrib/gardener \
  python -m gardener.main_cli \
  /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  -o test_capabilities \
  --machine-summary \
  --scope all
```

### dep-diet fusion

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-diet
node scripts/depdiet.mjs analyze \
  /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --gardener-output /tmp/test-capabilities-depintel-controller-20260519080023/gardener/output/test_capabilities_dependency_analysis.json \
  --runtime-bundle /tmp/test-capabilities-depintel-controller-20260519080023/runtime/runtime-trace-bundle.json \
  --out-depmodel /tmp/test-capabilities-depintel-controller-20260519080023/depdiet/depmodel.json \
  --json --compact \
  > /tmp/test-capabilities-depintel-controller-20260519080023/depdiet/analyze.json
```

### dep-viz render

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-viz
go run ./cmd/depviz report \
  --model /tmp/test-capabilities-depintel-controller-20260519080023/depdiet/depmodel.json \
  --out /tmp/test-capabilities-depintel-controller-20260519080023/depviz/report \
  --render-only
```

## Artifact digests

| Artifact | SHA-256 |
|---|---|
| `runtime/runtime-trace-bundle.json` | `47c4a414b17b0735435546f31ce453d4607a18400161e5fc19809ea34999fed5` |
| `gardener/output/test_capabilities_dependency_analysis.json` | `40d3704fa5d28cf963d4939ef435f8df436e52d30da1234917ed1e9b0039fcbf` |
| `gardener/output/test_capabilities_dependency_summary.json` | `7919fd39ddbb4bd26ef608b89c5e03e3658c1c74c3ba8fc184a6bc9652acb14e` |
| `depdiet/analyze.json` | `f70c02a413f83c8896d2947057374b3ad967b332682aedc937cda1b83e94dd84` |
| `depdiet/depmodel.json` | `07de947a4aae3d0de9f1ea92d1e1249d1a4c5878eea9188e039517e03b36e7cd` |
| `depdiet/depmodel.summary.json` | `4e63cea806ed68e3a3921c491d3edcf0c26a5771cee29d06fd972cab308a293b` |
| `depdiet/vulnerability-summary.json` | `529c03e107a4721e2c3bbf25974ce0f1394cf1f3cc5af32a66cb90fe617e44f4` |
| `depviz/report/index.html` | `f5f9706d95c787449d16f9a535f2bdad98ff3b010ae513ab99c7dd6e112c5a15` |

## dep-diet summary

The fused depmodel summary was:

```json
{
  "modelVersion": "depmodel.v1",
  "modules": 1,
  "packages": 282,
  "edges": 352,
  "observedPackages": 1,
  "observedRows": [
    {
      "name": "commander",
      "version": "12.0.0",
      "packageId": "npm:commander@12.0.0",
      "classification": "static-runtime-confirmed",
      "evidenceKind": "runtime-command-observation",
      "commandLine": "node ./bin/test-capabilities doctor --json"
    }
  ],
  "classifications": {
    "declared-unobserved": 279,
    "static-central-unobserved": 2,
    "static-runtime-confirmed": 1
  }
}
```

`depdiet/analyze.json` also reported:

```json
{
  "packageCount": 289,
  "edgeCount": 270,
  "findingCount": 289,
  "introducerPathCount": 228,
  "staticRuntimeEvidence": {
    "staticRuntimeConfirmed": 1,
    "staticCentralUnobserved": 2,
    "runtimeOnly": 0,
    "declaredUnobserved": 279,
    "ambiguousEvidence": 0,
    "reviewSignals": {
      "hiddenRoot": 0,
      "declaredUnobservedReview": 279,
      "criticalSoil": 0,
      "riskyCore": 2,
      "ambiguousEvidence": 0
    },
    "authorityNote": "Static/runtime evidence is context for review, not standalone removal permission."
  }
}
```

## dep-redteam applicability

Dep-redteam was not applicable for this pilot because no vulnerability triage handoff existed:

```json
{
  "vulnPackages": 0,
  "vulnCount": 0,
  "triageClusters": 0,
  "depRedteamApplicable": false
}
```

## Interpretation

The pilot produced target-specific static/runtime dependency evidence for this repo. It confirms that `commander@12.0.0` was both statically present and observed by the representative `doctor` command. It also identifies many declared but unobserved packages under that single runtime scenario.

Those classifications are evidence-seeking prompts. They do not mean that unobserved dependencies are unused. More representative runtime scenarios would be needed before drawing stronger conclusions.

## Follow-up

Recommended follow-up work should be routed through explicit owner surfaces:

1. Add one or more representative runtime commands beyond `doctor`, such as `demo`, `test` against a fixture, or `capability:drill`, if their runtime cost and side effects are acceptable.
2. Re-run runtime-trace-insights and dep-diet with those scenarios to compare classifications.
3. Use dep-viz report output for operator review.
4. Keep dep-redteam out of scope until a dep-viz exploitability-validation handoff exists.
5. Use `ts-quality` as durable quality/adoption proof unless a TypeScript/JavaScript source change is being reviewed.
