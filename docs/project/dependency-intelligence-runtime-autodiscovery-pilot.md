---
summary: "Runtime-autodiscovery dependency-intelligence pilot for test-capabilities using runtime-trace-insights Node package autodiscovery and dep-diet scenario-set fusion."
read_when:
  - "Reviewing stronger runtime dependency evidence for test-capabilities."
  - "Checking whether runtime dependency observations are manually declared or autodiscovered."
type: "project"
---

# Dependency-intelligence runtime autodiscovery pilot

## Design membrane

This pilot replaces manually declared `--observed-package` evidence with runtime package autodiscovery:

```text
runtime-trace-insights Node package autodiscovery per scenario
+ reused target-specific Gardener static output
-> dep-diet scenario-set static/runtime fusion
-> dep-viz scenario-set report render
```

The outputs are dependency evidence for review. They are not dependency removal, remediation, exploitability, disclosure, merge, release, or trust-certification authority.

Boundary principle:

```text
runtime-loaded in this scenario set != exhaustively covered
static/runtime unobserved != unused
```

## What changed from the prior pilots

Earlier pilots used manually declared `--observed-package` values. That proved the commands ran with declared observations, but it did not discover packages actually loaded by Node.

This pilot used `runtime-trace-insights:277048c`, which adds `--package-autodiscovery`. Runtime-trace-insights injected bounded Node loader/preload instrumentation through `NODE_OPTIONS`, recorded ESM resolve/CommonJS load events, mapped `node_modules` paths back to npm package ids, and emitted `evidence.kind: runtime-package-autodiscovery`.

`dep-diet:6b816e1` then consumed all four runtime bundles as one scenario set and preserved per-package scenario metadata in the depmodel.

## Temporary artifact root

Controller-produced artifacts live under:

```text
/tmp/test-capabilities-depintel-autodiscovery-20260519085727
```

These artifacts are evidence outputs, not repo-owned source files. They can be regenerated from the commands below.

## Runtime scenarios

| Scenario | Command | Autodiscovered package count | Result |
|---|---|---:|---|
| `doctor` | `node ./bin/test-capabilities doctor --json` | 27 | pass |
| `demo` | `node ./bin/test-capabilities demo --json` | 27 | pass |
| `test-fixture` | `node ./bin/test-capabilities test --config examples/demo/test-capabilities.yaml --json` | 27 | pass |
| `capability-drill` | `bash ./scripts/capability-drill.sh --json --surf-mode shim --skip-build` | 27 | pass |

The fixture config exists at:

```text
examples/demo/test-capabilities.yaml
```

The capability drill used `--surf-mode shim` and `--skip-build` to keep runtime cost and side effects bounded.

## Commands run

### Runtime autodiscovery bundles

```bash
cd /home/tryinget/ai-society/softwareco/owned/runtime-trace-insights

node scripts/runtime_trace_bundle.mjs record /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --package-autodiscovery \
  --out /tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/doctor.runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-doctor-autodiscovery \
  -- node ./bin/test-capabilities doctor --json

node scripts/runtime_trace_bundle.mjs record /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --package-autodiscovery \
  --out /tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/demo.runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-demo-autodiscovery \
  -- node ./bin/test-capabilities demo --json

node scripts/runtime_trace_bundle.mjs record /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --package-autodiscovery \
  --out /tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/test-fixture.runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-test-fixture-autodiscovery \
  -- node ./bin/test-capabilities test --config examples/demo/test-capabilities.yaml --json

node scripts/runtime_trace_bundle.mjs record /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --package-autodiscovery \
  --out /tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/capability-drill.runtime-trace-bundle.json \
  --run-id fcos-test-capabilities-capability-drill-autodiscovery \
  -- bash ./scripts/capability-drill.sh --json --surf-mode shim --skip-build
```

### Static evidence

The target-specific Gardener output from the first pilot was reused because the target dependency graph did not change in this follow-up:

```text
/tmp/test-capabilities-depintel-autodiscovery-20260519085727/gardener/output/test_capabilities_dependency_analysis.json
```

### dep-diet scenario-set fusion

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-diet
node scripts/depdiet.mjs analyze /home/tryinget/ai-society/softwareco/owned/test-capabilities \
  --gardener-output /tmp/test-capabilities-depintel-autodiscovery-20260519085727/gardener/output/test_capabilities_dependency_analysis.json \
  --runtime-bundle /tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/doctor.runtime-trace-bundle.json \
  --runtime-bundle /tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/demo.runtime-trace-bundle.json \
  --runtime-bundle /tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/test-fixture.runtime-trace-bundle.json \
  --runtime-bundle /tmp/test-capabilities-depintel-autodiscovery-20260519085727/runtime/capability-drill.runtime-trace-bundle.json \
  --out-depmodel /tmp/test-capabilities-depintel-autodiscovery-20260519085727/depdiet/scenario-set.depmodel.json \
  --json --compact \
  > /tmp/test-capabilities-depintel-autodiscovery-20260519085727/depdiet/analyze.json
```

### dep-viz render

```bash
cd /home/tryinget/ai-society/softwareco/owned/dep-viz
go run ./cmd/depviz report \
  --model /tmp/test-capabilities-depintel-autodiscovery-20260519085727/depdiet/scenario-set.depmodel.json \
  --out /tmp/test-capabilities-depintel-autodiscovery-20260519085727/depviz/scenario-set/report \
  --render-only
```

## Result summary

The scenario-set depmodel reported:

```json
{
  "modelVersion": "depmodel.v1",
  "packages": 281,
  "edges": 351,
  "observedPackages": 27,
  "classifications": {
    "declared-unobserved": 253,
    "static-central-unobserved": 1,
    "runtime-only": 21,
    "static-runtime-confirmed": 6
  }
}
```

Static/runtime-confirmed packages under the scenario set:

```text
chalk@4.1.2
commander@12.1.0
figlet@1.10.0
js-yaml@4.1.1
ora@5.4.1
zod@3.25.76
```

All 27 runtime-observed packages were observed in all four scenarios. This mostly reflects that these commands share the same CLI startup/import path; it is useful evidence, but not comprehensive application coverage.

Runtime-only packages are not removal targets. They are hidden-root review prompts: inspect runtime trace source paths, static evidence, and lockfile edges before interpreting them.

## Artifact digests

| Artifact | SHA-256 |
|---|---|
| `runtime/doctor.runtime-trace-bundle.json` | `11cfc4b636492c79cb9b5bd2c3ecde82c11766c9a78f69abe20198a4466dfd6b` |
| `runtime/demo.runtime-trace-bundle.json` | `e94b1c6bcc52477a30cbe1b7ad3517ee842f14e2d021a91e3d4ba9008130597a` |
| `runtime/test-fixture.runtime-trace-bundle.json` | `6e56bcc872004f746b2d9cf6331ab441fa01bf50d67a56cc8b50980c951fb7a2` |
| `runtime/capability-drill.runtime-trace-bundle.json` | `2d552601c73590183475ee4666a890039395acb90901429b1b9ed4a8fd3f6b33` |
| `gardener/output/test_capabilities_dependency_analysis.json` | `40d3704fa5d28cf963d4939ef435f8df436e52d30da1234917ed1e9b0039fcbf` |
| `depdiet/scenario-set.depmodel.json` | `b183ed9290b733ac9275f9fdc1ad1f5f0abd8af2efe80caa3d8f4f87ac52d95f` |
| `depdiet/analyze.json` | `7d1f2ab5d226bf9a4fc6596821e330abd83249ed2e7a31845c12807fdb5fa319` |
| `depviz/scenario-set/report/index.html` | `5c3e9d2ff16b73ba1d1cc178c8f43f091e111165d39ccd2864d3c50a4e1d1a9a` |

The full artifact digest list is at:

```text
/tmp/test-capabilities-depintel-autodiscovery-20260519085727/SHA256SUMS
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
cd /home/tryinget/ai-society/softwareco/owned/runtime-trace-insights
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
git diff --check
npm test

cd /home/tryinget/ai-society/softwareco/owned/dep-diet
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
git diff --check
npm test

cd /home/tryinget/ai-society/softwareco/owned/test-capabilities
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
git diff --check
npm run docs:list -- --task "dependency intelligence runtime autodiscovery" --top 5
```

## Follow-up

This is stronger evidence than manually declared observations. The next meaningful improvement would be scenario diversity: commands that avoid the shared CLI startup path, package-level library API probes, or deeper instrumentation of child-process and dynamic/plugin paths.
