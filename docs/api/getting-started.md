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
Autonomous Testing Framework v2.0.0
Testing complete (pass).
Health:  pass
Findings: 0
Coverage: user=0% api=0% edge=100% overall=33%
```

`overall` is the simple average of `user`, `api`, and `edge`, so unmeasured dimensions still count as `0` instead of inflating the summary.

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
- `cli-tester` orchestrator agent
- correlation enabled in config
- `quantum` command
- `heal` command
- `surf explore`

### Unsupported and fail-closed
- orchestrator agents: `bombadil`, `surf`, `api-fuzzer`
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
