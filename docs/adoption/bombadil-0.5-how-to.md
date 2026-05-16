---
summary: "Public adoption guide for using Bombadil 0.5 with test-capabilities browser and terminal-fuzzer slices."
read_when:
  - "When adopting Bombadil-backed browser testing through test-capabilities"
  - "When configuring the experimental terminal-fuzzer agent"
type: "how-to"
---

# Bombadil 0.5 adoption guide

Bombadil support in `test-capabilities` is intentionally fail-closed and bounded. You provide a Bombadil 0.5+ binary; `test-capabilities` provides typed config, runtime execution, findings, and normalized `observation.v1` evidence.

## Install or point at Bombadil

Preferred for consumers:

```bash
export TEST_CAPABILITIES_BOMBADIL_BIN=/path/to/bombadil
bombadil --version
```

Packed npm installs do not include Bombadil binaries. If no binary is available, Bombadil-backed agents fail with a runtime finding instead of reporting success.

## Browser property exploration

```yaml
version: "2.0"
name: bombadil-browser-smoke
targets:
  web: "http://127.0.0.1:3000"
agents:
  browser:
    type: bombadil
    enabled: true
    duration: 10s
    bombadil:
      output_path: .test-capabilities/bombadil-traces
      headers:
        X-Test-Capabilities: bombadil-0.5
      width: 1280
      height: 720
      instrument_javascript: [files]
      chrome_grant_permissions: [local-network-access]
```

Run:

```bash
npx test-capabilities test --config ./test-capabilities.yaml --json
```

The wrapper passes Bombadil 0.5 browser-test options through to the resolved binary. Disabled-control skipping, quiescence timers, and dialog auto-accept are Bombadil runtime behavior, not emulated behavior in this package.

## Trace reproduction

When Bombadil emits a trace, reproduce it by setting `reproduce_trace`:

```yaml
agents:
  browser-repro:
    type: bombadil
    enabled: true
    bombadil:
      reproduce_trace: .test-capabilities/bombadil-traces/trace.jsonl
```

The wrapper omits `--exit-on-violation` during reproduction so Bombadil controls replay behavior.

## Experimental terminal fuzzer

The `terminal-fuzzer` agent is a typed, bounded slice over:

```bash
bombadil terminal test -- <command> [args...]
```

Example:

```yaml
version: "2.0"
name: bombadil-terminal-smoke
targets:
  cli: "node"
agents:
  terminal:
    type: terminal-fuzzer
    enabled: true
    duration: 5s
    terminal:
      args: ["--version"]
```

Or set the command inside the agent:

```yaml
agents:
  terminal:
    type: terminal-fuzzer
    enabled: true
    terminal:
      command: "node"
      args: ["--version"]
```

This emits an `observation.v1` runtime observation for the `cli` component when Bombadil provides terminal evidence. It is not a production-stability claim, autonomy claim, or replacement for deterministic CLI contract tests.

## Release verification note

If a local Bombadil source build fails because the environment lacks Zig, Nix shell support, or terminal/ghostty prerequisites, verify `test-capabilities` against the upstream Bombadil release binary through `TEST_CAPABILITIES_BOMBADIL_BIN`.
