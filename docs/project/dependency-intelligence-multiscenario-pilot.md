---
summary: "Multi-scenario dependency-intelligence pilot for test-capabilities using runtime-trace-insights, Gardener, dep-diet, and dep-viz."
read_when:
  - "Reviewing multi-scenario dependency evidence for test-capabilities."
  - "Checking dependency-intelligence classifications before drawing removal conclusions."
type: "project"
---

# Dependency-intelligence multi-scenario pilot

## Design membrane

This follow-up extends the dependency-intelligence corridor from one command to multiple representative runtime scenarios for this repo:

```text
runtime-trace-insights per-scenario runtime bundles
+ reused target-specific Gardener static output
-> dep-diet per-scenario static/runtime fusion
-> dep-viz per-scenario report render
-> scenario classification comparison
```

The outputs are dependency evidence for review. They are not dependency removal, remediation, exploitability, disclosure, merge, release, or trust-certification authority.

Boundary principle:

```text
static centrality != runtime observation != declared-unobserved status != unused dependency
```

`runtime-trace-insights` records command-level observations only. The observed packages below were explicitly declared for each command and should not be read as exhaustive instrumentation coverage.

## Temporary artifact root

Controller-produced artifacts live under:

```text
/tmp/test-capabilities-depintel-multiscenario-20260519082444
```

These artifacts are evidence outputs, not repo-owned source files. They can be regenerated from the commands below.

## Runtime scenarios

| Scenario | Command | Declared observed packages | Result |
|---|---|---|---|
| `doctor` | `node ./bin/test-capabilities doctor --json` | `commander@12.0.0` | pass |
| `demo` | `node ./bin/test-capabilities demo --json` | `commander@12.0.0`, `zod@3.22.4` | pass |
| `test-fixture` | `node ./bin/test-capabilities test --config examples/demo/test-capabilities.yaml --json` | `commander@12.0.0`, `js-yaml@4.1.0`, `zod@3.22.4` | pass |
| `capability-drill` | `bash ./scripts/capability-drill.sh --json --surf-mode shim --skip-build` | `commander@12.0.0`, `js-yaml@4.1.0`, `zod@3.22.4` | pass; 12/12 drill checks passed |

The fixture config exists at:

```text
examples/demo/test-capabilities.yaml
```

The capability drill used `--surf-mode shim` and `--skip-build` to keep runtime cost and side effects bounded; the script uses temporary fixtures and cleans them up by default.

## Commands run

### Runtime bundles

```bash
cd /home/tryinget/ai-society/softwareco/owned/runtime-trace-insights

node scripts/runtime_trace_bundle.mjs record /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --observed-package commander@12.0.0 \
  --out /tmp/test-capabilities-depintel-multiscenario-20260519082444/runtime/doctor.runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-doctor-multiscenario \
  -- node ./bin/test-capabilities doctor --json

node scripts/runtime_trace_bundle.mjs record /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --observed-package commander@12.0.0 --observed-package zod@3.22.4 \
  --out /tmp/test-capabilities-depintel-multiscenario-20260519082444/runtime/demo.runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-demo-multiscenario \
  -- node ./bin/test-capabilities demo --json

node scripts/runtime_trace_bundle.mjs record /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --observed-package commander@12.0.0 --observed-package js-yaml@4.1.0 --observed-package zod@3.22.4 \
  --out /tmp/test-capabilities-depintel-multiscenario-20260519082444/runtime/test-fixture.runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-test-fixture-multiscenario \
  -- node ./bin/test-capabilities test --config examples/demo/test-capabilities.yaml --json

node scripts/runtime_trace_bundle.mjs record /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --observed-package commander@12.0.0 --observed-package js-yaml@4.1.0 --observed-package zod@3.22.4 \
  --out /tmp/test-capabilities-depintel-multiscenario-20260519082444/runtime/capability-drill.runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-capability-drill-multiscenario \
  -- bash ./scripts/capability-drill.sh --json --surf-mode shim --skip-build
```

### Static evidence

The target-specific Gardener output from the one-command pilot was reused because the target dependency graph did not change in this follow-up:

```text
/tmp/test-capabilities-depintel-controller-20260519080023/gardener/output/test_capabilities_dependency_analysis.json
```

It was copied to:

```text
/tmp/test-capabilities-depintel-multiscenario-20260519082444/gardener/output/test_capabilities_dependency_analysis.json
```

### dep-diet fusion

For each scenario:

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-diet
node scripts/depdiet.mjs analyze /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --gardener-output /tmp/test-capabilities-depintel-multiscenario-20260519082444/gardener/output/test_capabilities_dependency_analysis.json \
  --runtime-bundle /tmp/test-capabilities-depintel-multiscenario-20260519082444/runtime/<scenario>.runtime-trace-bundle.json \
  --out-depmodel /tmp/test-capabilities-depintel-multiscenario-20260519082444/depdiet/<scenario>/depmodel.json \
  --json --compact \
  > /tmp/test-capabilities-depintel-multiscenario-20260519082444/depdiet/<scenario>/analyze.json
```

### dep-viz render

For each scenario:

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-viz
go run ./cmd/depviz report \
  --model /tmp/test-capabilities-depintel-multiscenario-20260519082444/depdiet/<scenario>/depmodel.json \
  --out /tmp/test-capabilities-depintel-multiscenario-20260519082444/depviz/<scenario>/report \
  --render-only
```

## Classification comparison

`dep-diet` produced per-scenario depmodels with these summaries:

| Scenario | Packages | Edges | Observed packages | `static-runtime-confirmed` | `static-central-unobserved` | `declared-unobserved` |
|---|---:|---:|---:|---:|---:|---:|
| `doctor` | 282 | 352 | 1 | 1 | 2 | 279 |
| `demo` | 283 | 353 | 2 | 2 | 1 | 280 |
| `test-fixture` | 284 | 354 | 3 | 3 | 1 | 280 |
| `capability-drill` | 284 | 354 | 3 | 3 | 1 | 280 |

Observed rows:

```json
{
  "doctor": ["commander@12.0.0"],
  "demo": ["commander@12.0.0", "zod@3.22.4"],
  "test-fixture": ["commander@12.0.0", "js-yaml@4.1.0", "zod@3.22.4"],
  "capability-drill": ["commander@12.0.0", "js-yaml@4.1.0", "zod@3.22.4"]
}
```

Interpretation:

- moving beyond `doctor` increased `static-runtime-confirmed` evidence from 1 package to 2-3 packages;
- `demo`, fixture `test`, and `capability-drill` reduced the `static-central-unobserved` count from 2 to 1 in these runs;
- many packages remain `declared-unobserved`, which means only that these scenarios did not declare command-level observations for them;
- no classification in this pilot authorizes dependency removal or pruning.

## Artifact digests

| Artifact | SHA-256 |
|---|---|
| `runtime/doctor.runtime-trace-bundle.json` | `ba79b29c3050d8a61ef5f49a9460e8b4f13a9f00be4a7c1a2c524f7aeb2e9ba8` |
| `runtime/demo.runtime-trace-bundle.json` | `66202cb47e17fa4352ec17bd618d028a13cfa9cf3168cac73ff3a2bef29df086` |
| `runtime/test-fixture.runtime-trace-bundle.json` | `c774a18f65fbe48280e772a0f4af8ddb2c380952a2dd638ad935dcd61165ee9d` |
| `runtime/capability-drill.runtime-trace-bundle.json` | `bfd3c3c5547ce99d3925ab7244aecfb60e7993fbd1c5caef1f91e1b7f0a44936` |
| `gardener/output/test_capabilities_dependency_analysis.json` | `40d3704fa5d28cf963d4939ef435f8df436e52d30da1234917ed1e9b0039fcbf` |
| `depdiet/doctor/depmodel.json` | `d2218b2cc2b24f4697e256d1747be1e128f2bbc4a28e00f8209ef0c76c8a1e44` |
| `depdiet/demo/depmodel.json` | `6818a944dcae8f2c74988e19233367ad097376c5a2d2e98eef2021c66bbce952` |
| `depdiet/test-fixture/depmodel.json` | `311ed5c536e93f58facc3cc9969f71dc4c3cecdf14f3f342065e9b63c26e69e7` |
| `depdiet/capability-drill/depmodel.json` | `f7f8b203429ee0ba8f19ba43f2662a9b650887609de66ec29e96e06425b29e18` |
| `depdiet/classification-comparison.json` | `05e7418521b4c5538a5e4e50dddc7a152409af4e1fbc63c30288c4f49dba495e` |
| `depviz/doctor/report/index.html` | `fe312714fee28673d519818785230836464ef3e9c45310ab5fe1b49d97239853` |
| `depviz/demo/report/index.html` | `1787a579951b3249023336006e32803869e3d6a8e44b72619864d7e00c9c890c` |
| `depviz/test-fixture/report/index.html` | `3e688ff4f4ba29e145468321e0a8fbf172f2a4bbe61427ec7fd2a30a02ca89bc` |
| `depviz/capability-drill/report/index.html` | `0652dc62a92c9bdd6c2821dbe862250a02800972293ab00ed706311782fd57a0` |

The full artifact digest list is at:

```text
/tmp/test-capabilities-depintel-multiscenario-20260519082444/SHA256SUMS
```

## dep-redteam applicability

No vulnerability triage or dep-viz exploitability-validation handoff existed in these outputs:

```json
{
  "vulnPackages": 0,
  "vulnCount": 0,
  "triageClusters": 0,
  "depRedteamApplicable": false
}
```

So dep-redteam remains out of scope for this follow-up.

## Validation

Validation for this target-doc slice:

```bash
cd /home/tryinget/ai-society/softwareco/owned/test-capabilities
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
git diff --check
npm run docs:list -- --task "dependency intelligence multiscenario" --top 5
```

## Follow-up

Useful next evidence would require either broader runtime instrumentation or more explicit scenario selection. Until then, treat `declared-unobserved` as a prompt to collect evidence, not as an unused-dependency conclusion.
