---
summary: "Packaged zero-external-dependency demo for the CLI smoke + observation diagnostics use case."
read_when:
  - "You want the fastest functional proof that test-capabilities works after install"
  - "You are validating the packaged demo fixture"
type: "guide"
---

# Built-in demo: CLI smoke + observation diagnostics

This fixture is the polished first public use case for `test-capabilities`.
It proves the package can run a real CLI command through the fail-closed `cli-tester` orchestrator path and emit `observation.v1` diagnostic evidence without Surf Go, Bombadil, network access, or a target application.

## Commands

From a source checkout:

```bash
node ./bin/test-capabilities doctor --json
node ./bin/test-capabilities demo --json
```

From an installed package:

```bash
test-capabilities doctor --json
test-capabilities demo --json
```

Then replace the demo target with a safe CLI command that supports `--help`:

```bash
test-capabilities doctor --target node
test-capabilities test --target node --quick
```

## What this demo proves

- the installed CLI can load the built runtime
- the shipped `examples/demo/cli-demo.mjs` fixture resolves and runs with `--help`
- the orchestrator records a passing `observation.v1` smoke signal
- the JSON envelope is stable enough for agents and CI smoke probes

Surf Go and Bombadil-compatible runtimes remain optional until you need browser/property exploration.
