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
- Optional: `surf` installed if you want to use `test-capabilities surf explore`
- Optional: a Bombadil binary exposed through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, or `bombadil` on `PATH` if you want Bombadil-backed web exploration outside this repo checkout
- Optional for local ai-society workspace development: a built `softwareco/contrib/bombadil/target/release|debug/bombadil`; upstream Bombadil currently also expects `trunk` and `esbuild` for local builds, or its Nix shell

---

## Installation

```bash
npm install
npm run build
```

For packaged-consumer verification, use the tarball flow exercised by `npm run consumer:smoke` rather than assuming a public registry install.

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

If `surf` is installed and on `PATH`:

```bash
test-capabilities surf explore --url https://example.com
```

Only `explore` is currently supported through the CLI wrapper.

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
- `cli-tester` orchestrator agent
- correlation enabled in config
- `quantum` command
- `heal` command
- `surf explore`

### Unsupported and fail-closed
- orchestrator agents: `surf`, `api-fuzzer`
- orchestrator intelligence: `self-healing`, `prediction`, `collective`
- chaos execution
- CLI commands: `predict`, `visualize`, `report`
- `test` flags: `--autonomous`, `--self-heal`, `--predict`, `--fail-threshold`, `--upload-artifacts`, `--report`
- surf actions: `flow`, `assert`, `compare`, `replay`

---

## Next steps

- [CLI Reference](cli.md)
- [Configuration](config.md)
- [Examples](examples.md)
- [Patterns](patterns.md)
