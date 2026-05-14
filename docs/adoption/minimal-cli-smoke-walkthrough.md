---
summary: "Smallest concrete walkthrough for a zero-external-dependency test-capabilities adoption."
read_when:
  - "You want the shortest concrete first run for test-capabilities"
  - "You need a copy-adaptable CLI smoke example before adding optional runtimes"
type: "tutorial"
---

# Minimal CLI smoke walkthrough

This walkthrough is the smallest useful adoption of `test-capabilities`: one safe CLI target, one generated config, one doctor run, and one machine-readable smoke.

It requires only Node.js 22+ and a command that can safely run with `--help`.

## 1) Verify the installed CLI

```bash
test-capabilities doctor --json
```

From a source checkout, use:

```bash
node ./bin/test-capabilities doctor --json
```

A healthy first result has `operationId: "doctor"` and `status: "pass"`. Missing Surf Go or Bombadil-compatible runtimes are optional warnings.

## 2) Generate a minimal config

```bash
test-capabilities init --output test-capabilities.yaml --target node
```

If a config already exists, preview instead:

```bash
test-capabilities init --target node --print
```

The generated config enables only the supported `cli-tester` path.

## 3) Run the built-in demo

```bash
test-capabilities demo --json
```

This proves the packaged fixture at `examples/demo/cli-demo.mjs` works through the same orchestrator path used for real CLI targets.

## 4) Run your first target

```bash
test-capabilities doctor --config test-capabilities.yaml --target node --json
test-capabilities test --config test-capabilities.yaml --quick --json
```

For your own command, replace `node` with a safe executable or command path that supports `--help`.

## 5) Interpret the result

For a healthy CLI smoke, expect:

- `operationId: "test"`
- `summary.health: "pass"`
- `result.passed: true`
- no findings
- at least one CLI smoke observation
- explicit coverage gaps for web/API dimensions that were not measured

Those gaps are honest scope markers. They do not mean the CLI smoke failed.

## 6) CI script

A minimal package script in the target repo can be:

```json
{
  "scripts": {
    "capability:doctor": "test-capabilities doctor --config test-capabilities.yaml --target node --json",
    "capability:smoke": "test-capabilities test --config test-capabilities.yaml --quick --json"
  }
}
```

Run `capability:doctor` before `capability:smoke` in CI so setup/config failures are separated from target smoke failures.

## Done when

The first slice is done when:

- `doctor --json` passes required checks
- `init` generated or informed the committed config
- `demo --json` passes in the install environment
- `test --quick --json` passes against one safe target
- optional Surf Go, Bombadil-compatible, healing, and quantum work is explicitly left for later slices
