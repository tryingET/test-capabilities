---
summary: "Quick-start guide for installing and running TEST-CAPABILITIES."
read_when:
  - "You are starting from zero with this framework"
  - "You need the shortest path to a working first run"
type: "guide"
---

# Getting Started

> Shortest path to a real successful run on the current fail-closed runtime.

---

## Prerequisites

- Node.js 22+
- A CLI command or executable you can safely run with `--help`
- Optional: a Surf Go runtime if you want to use `test-capabilities surf explore` or the `surf` orchestrator agent. Resolution order is `TEST_CAPABILITIES_SURF_GO_BIN`, a source checkout referenced by `TEST_CAPABILITIES_SURF_GO_REPO`, then `surf-go` on `PATH`.
- Optional for Bombadil-backed web exploration: a Bombadil-compatible binary exposed through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, or `bombadil` on `PATH`; source builds may require their own toolchain such as `trunk`, `esbuild`, or a project-provided Nix shell

---

## Installation

```bash
npm install
npm run build
```

For packaged-consumer verification, use the tarball flow exercised by `npm run consumer:smoke` rather than assuming a public registry install.

---

## First functional proof

Run diagnostics, generate a minimal config, then run the built-in zero-external-dependency demo fixture:

```bash
node ./bin/test-capabilities doctor
node ./bin/test-capabilities init --print
node ./bin/test-capabilities init --output ./test-capabilities.local.yaml --target node
node ./bin/test-capabilities doctor --target node
node ./bin/test-capabilities demo
```

The generated config enables only `cli-tester`, disables unsupported autonomy/intelligence modes, and refuses to overwrite existing files unless you pass `--force`. The demo runs `examples/demo/cli-demo.mjs` through the same `cli-tester` orchestrator path used for real CLI targets. It does not require Surf Go, Bombadil, network access, or a target application. This is the polished `cli-smoke-observation` use case for the first public release: prove config generation, CLI smoke execution, and `observation.v1` diagnostics first, then replace the demo target with your own safe CLI command.

Machine-readable output is available for agents and CI probes:

```bash
node ./bin/test-capabilities init --output ./test-capabilities.yaml --target node --force
node ./bin/test-capabilities doctor --config ./test-capabilities.yaml --target node --json
node ./bin/test-capabilities demo --json
node ./bin/test-capabilities test --config examples/demo/test-capabilities.yaml --json
```

---

## Your first successful run

Create `test-capabilities.yaml`:

```yaml
version: '2.0'
name: 'First Run'

targets:
  cli: 'node'

agents:
  cli:
    enabled: true
    type: cli-tester
    intensity: normal

intelligence:
  self_healing: false
  prediction: false
  correlation: true
  collective: false

quantum:
  enabled: false

chaos:
  enabled: false
```

Run it:

```bash
test-capabilities test --quick --config test-capabilities.yaml
# add --json for the full TestOperationResultEnvelope
```

Expected shape of output:

```text
Autonomous Testing Framework v0.1.0
Testing complete (pass).
Health:  pass
Findings: 0
Coverage: user=unmeasured api=unmeasured edge=100% overall=partial(100%)
Coverage gaps: userFlows, apiEndpoints
```

`overall` is now marked as `partial(...)` whenever the run measured only a subset of the documented dimensions, while `Coverage gaps` keeps the missing denominators explicit instead of silently folding them into the percentage.

---

## Browser exploration

If a Surf runtime is resolvable:

```bash
test-capabilities surf explore --url https://example.com
```

Only `explore` is currently supported through the CLI wrapper.

---

## Rich Bombadil local smoke

If you want a deterministic local Bombadil regression check instead of pointing at a live app immediately, run:

```bash
npm run bombadil:smoke
```

This serves the checked-in fixture under `examples/bombadil-rich/site/`, runs Bombadil directly, then runs the TEST-CAPABILITIES Bombadil-backed wrapper against the same fixture.

---

## Quantum simulation

```bash
test-capabilities quantum --target https://example.com --branches 100 --collapse
```

Use this when you want direct simulator output instead of the orchestrator CLI-smoke path.

---

## What is implemented today

### Implemented
- `test` with `--config`, `--target`, `--quick`
- `bombadil` orchestrator agent
- `surf` orchestrator agent
- `cli-tester` orchestrator agent
- correlation enabled in config
- `quantum` command
- `heal` command
- `surf explore`

### Unsupported and fail-closed
- orchestrator agents: `api-fuzzer`
- orchestrator intelligence: `self-healing`, `prediction`, `collective`
- chaos execution
- CLI commands: `predict`, `visualize`, `report`
- `test` flags: `--autonomous`, `--self-heal`, `--predict`, `--fail-threshold`, `--upload-artifacts`, `--report`
- surf actions: `flow`, `assert`, `compare`, `replay`

---

## Next steps

- [Minimal CLI smoke walkthrough](../adoption/minimal-cli-smoke-walkthrough.md)
- [Greenfield bootstrap how-to](../adoption/greenfield-bootstrap-how-to.md)
- [Brownfield integration how-to](../adoption/brownfield-integration-how-to.md)
- [CLI Reference](cli.md)
- [Configuration](config.md)
- [Examples](examples.md)
- [Patterns](patterns.md)
