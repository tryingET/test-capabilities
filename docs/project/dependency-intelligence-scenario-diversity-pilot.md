---
summary: "Scenario-diversity dependency-intelligence pilot for test-capabilities using non-CLI/package-level runtime-autodiscovery probes."
read_when:
  - "Reviewing dependency evidence from non-CLI test-capabilities runtime probes."
  - "Checking whether CLI startup dependencies are separated from package-level API dependencies."
type: "project"
---

# Dependency-intelligence scenario-diversity pilot

## Design membrane

This pilot tests whether non-CLI/package-level probes provide better dependency evidence than more shared CLI commands:

```text
package-level runtime-autodiscovery probes
+ reused target-specific Gardener static output
-> dep-diet scenario-set fusion
-> dep-viz report render
```

The outputs are dependency evidence for review. They are not dependency removal, remediation, exploitability, disclosure, merge, release, or trust-certification authority.

Boundary principle:

```text
non-CLI observed != exhaustive package coverage
unobserved under these probes != unused
```

## Temporary artifact root

Controller-produced artifacts live under:

```text
/tmp/test-capabilities-depintel-scenario-diversity-20260519090938
```

Probe scripts are captured under:

```text
/tmp/test-capabilities-depintel-scenario-diversity-20260519090938/probes
```

## Probe set

| Scenario | Probe shape | Observed package count | Result |
|---|---|---:|---|
| `index-load` | import `dist/index.js` and inspect public exports | 2 | pass |
| `api-doctor` | call `executeCliOperation({ command: "doctor" })` through public API | 2 | pass |
| `api-demo` | call `executeCliOperation({ command: "demo" })` through public API | 2 | pass |
| `api-test-fixture` | call `executeCliOperation({ command: "test" })` with `examples/demo/test-capabilities.yaml` | 2 | pass |
| `quantum-module` | import `dist/quantum/simulator.js` and run `QuantumTestRunner` | 0 | pass |
| `healing-module` | import `dist/healing/self-healing.js` and instantiate `SelfHealingEngine` | 0 | pass |
| `surf-runtime-module` | import `dist/core/surf-runtime.js` and resolve shim mode | 0 | pass |

These probes intentionally avoid the `bin/test-capabilities` CLI startup path. That separated package-level/API dependencies from CLI rendering dependencies such as `chalk`, `commander`, `figlet`, and `ora`.

## Commands run

For each probe:

```bash
cd /home/tryinget/ai-society/softwareco/owned/runtime-trace-insights
node scripts/runtime_trace_bundle.mjs record /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --package-autodiscovery \
  --out /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/runtime/<scenario>.runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-<scenario>-diversity \
  -- node /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/probes/<scenario>.mjs
```

Then dep-diet fused all seven runtime bundles as one scenario set:

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-diet
node scripts/depdiet.mjs analyze /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --gardener-output /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/gardener/output/test_capabilities_dependency_analysis.json \
  --runtime-bundle /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/runtime/index-load.runtime-trace-bundle.json \
  --runtime-bundle /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/runtime/api-doctor.runtime-trace-bundle.json \
  --runtime-bundle /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/runtime/api-demo.runtime-trace-bundle.json \
  --runtime-bundle /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/runtime/api-test-fixture.runtime-trace-bundle.json \
  --runtime-bundle /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/runtime/quantum-module.runtime-trace-bundle.json \
  --runtime-bundle /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/runtime/healing-module.runtime-trace-bundle.json \
  --runtime-bundle /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/runtime/surf-runtime-module.runtime-trace-bundle.json \
  --out-depmodel /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/depdiet/scenario-diversity.depmodel.json \
  --json --compact
```

Dep-viz render:

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-viz
go run ./cmd/depviz report \
  --model /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/depdiet/scenario-diversity.depmodel.json \
  --out /tmp/test-capabilities-depintel-scenario-diversity-20260519090938/depviz/scenario-diversity/report \
  --render-only
```

## Result summary

The scenario-diversity depmodel reported:

```json
{
  "packages": 281,
  "edges": 351,
  "observedPackages": 2,
  "classifications": {
    "declared-unobserved": 278,
    "static-central-unobserved": 1,
    "static-runtime-confirmed": 2
  }
}
```

Observed packages:

```text
js-yaml@4.1.1 -> observed by index-load, api-doctor, api-demo, api-test-fixture
zod@3.25.76 -> observed by index-load, api-doctor, api-demo, api-test-fixture
```

The module-specific probes (`quantum-module`, `healing-module`, `surf-runtime-module`) observed no external npm packages, which is useful evidence: those paths are currently Node-builtin/local-code heavy under these probes.

## Interpretation

This is more diagnostic than the prior shared-CLI scenario set:

- shared CLI startup observed 27 packages, including presentation/CLI dependencies;
- non-CLI/package-level probes observed only `js-yaml` and `zod` for public API/operation loading;
- direct quantum, healing, and surf-runtime module probes observed no external npm packages;
- therefore, some dependencies are tied to CLI startup/rendering rather than core package-level paths.

This does not prove the other packages are unused. It only separates observed runtime contexts and narrows the next review questions.

## Artifact digests

| Artifact | SHA-256 |
|---|---|
| `runtime/index-load.runtime-trace-bundle.json` | `1832f7862be9cf36bf20df57a2b2c1b0720b2ccfa0b674d13a0d14fa35f78888` |
| `runtime/api-doctor.runtime-trace-bundle.json` | `3f2020b51e8253a97390d05f7b4fa960a8be464f9a5df85891f57079fc75b568` |
| `runtime/api-demo.runtime-trace-bundle.json` | `7dd647f993e82168c160dbb39db36eab11551236e6a907444df5fee84028971d` |
| `runtime/api-test-fixture.runtime-trace-bundle.json` | `255dcbdffc59030430e40ef1f3e50ec503481bb1f20935166af2168900edf0ed` |
| `runtime/quantum-module.runtime-trace-bundle.json` | `88f069b6627b536c089673922147a8cb385c859cd89babd10a6ee913a55e5102` |
| `runtime/healing-module.runtime-trace-bundle.json` | `a65ab6400c9b325b07657b59cdd03cce2bb968c172086343245534873430f246` |
| `runtime/surf-runtime-module.runtime-trace-bundle.json` | `13b1c92595ac17b128a582aa5b352702cf10c66043e2200cd54576d0a00d15db` |
| `gardener/output/test_capabilities_dependency_analysis.json` | `40d3704fa5d28cf963d4939ef435f8df436e52d30da1234917ed1e9b0039fcbf` |
| `depdiet/scenario-diversity.depmodel.json` | `4959f660bfec8c2f50bc2d61e6d1c2861d676eaf2380fe59fd95be74fcd10cf8` |
| `depdiet/analyze.json` | `23560cdeeef5ca103bd687943bcb5832c724567f610612d0fa91d8242aa66507` |
| `depviz/scenario-diversity/report/index.html` | `210d91c4d081d975a1ffd8c3e934298c484c7bfbba99c76da389669230891428` |

## dep-redteam applicability

No vulnerability triage or dep-viz exploitability-validation handoff existed in these outputs, so dep-redteam remains out of scope.

## Validation

Validation for this target-doc slice:

```bash
cd /home/tryinget/ai-society/softwareco/owned/test-capabilities
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
git diff --check
npm run docs:list -- --task "dependency intelligence scenario diversity" --top 5
```

## Follow-up

The next useful review is architectural: decide which dependency groups are expected for CLI startup, public API loading, and module-specific internals. That can lead to review questions or tests, but not direct removal authority from this evidence alone.
