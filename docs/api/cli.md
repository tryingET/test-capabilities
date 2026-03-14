---
summary: "Command reference for the TEST-CAPABILITIES CLI."
read_when:
  - "You need exact CLI commands, flags, or subcommand behavior"
  - "You are mapping a user request onto the CLI surface"
type: "reference"
---

# CLI Reference

> Exact runtime contract for the current CLI.

The CLI is **fail-closed**:
- supported surfaces execute
- unsupported surfaces error clearly
- missing config or unsupported flags do not silently degrade into placeholder behavior

The shipped verbs are owned by a typed **operation registry** (`CLI_OPERATION_REGISTRY`).
The `bin/test-capabilities` wrapper is now a thin adapter over that kernel: it parses flags, dispatches through `executeCliOperation(...)`, and renders the structured result.

---

## Operation kernel

Programmatic dispatch is available through the exported operation kernel:

```typescript
import { CLI_OPERATION_REGISTRY, executeCliOperation } from 'test-capabilities';

console.log(Object.keys(CLI_OPERATION_REGISTRY));

const result = await executeCliOperation(
  { command: 'test' },
  {
    config: './test-capabilities.yaml',
    target: 'node',
    quick: true,
  },
);
```

This registry currently owns the shipped verbs:
- `test`
- `surf explore`
- `quantum`
- `heal`

---

## Implemented commands

### `test-capabilities test`

Run the capability-backed orchestrator path.

```bash
test-capabilities test [options]
```

Supported options:

| Option | Description | Default |
|--------|-------------|---------|
| `--config <file>` | Path to `test-capabilities.yaml` | `test-capabilities.yaml` |
| `--target <url-or-path>` | Override one target. URLs map to `targets.web`; non-URLs map to `targets.cli`. | none |
| `--quick` | Disable quantum and prediction overlays for a deterministic smoke run | `false` |

Accepted but currently unsupported options:

| Option | Current behavior |
|--------|------------------|
| `--autonomous` | Fails with an unsupported-option error |
| `--self-heal` | Fails with an unsupported-option error |
| `--predict` | Fails with an unsupported-option error |
| `--fail-threshold <level>` | Fails with an unsupported-option error |
| `--upload-artifacts` | Fails with an unsupported-option error |
| `--report <dir>` | Fails with an unsupported-option error |

---

### `test-capabilities surf explore`

Run the real surf CLI through the supported `explore` action.

```bash
test-capabilities surf explore --url https://example.com
```

Options:

| Option | Description |
|--------|-------------|
| `--url <url>` | Target URL |
| `--depth <n>` | Accepted by the wrapper for compatibility; current implementation opens the URL |
| `--record` | Accepted by the wrapper; no extra runtime behavior yet |
| `--validate` | Accepted by the wrapper; no extra runtime behavior yet |
| `--baseline <dir>` | Accepted by the wrapper; no extra runtime behavior yet |
| `--ai-diff` | Accepted by the wrapper; no extra runtime behavior yet |

Unsupported surf actions:
- `flow`
- `assert`
- `compare`
- `replay`

These actions fail clearly instead of emitting placeholder output.

---

### `test-capabilities quantum`

Run the shared quantum simulator.

```bash
test-capabilities quantum --target https://example.com --branches 100 --collapse
```

| Option | Description | Default |
|--------|-------------|---------|
| `--target <url>` | Target URL for the simulator | `https://example.com` |
| `--branches <n>` | Number of branches to simulate | `100` |
| `--collapse` | Use `significance` collapse instead of `coverage` | `false` |

---

### `test-capabilities heal`

Run the selector-healing workflow.

```bash
test-capabilities heal --dir ./tests --dry-run
```

| Option | Description | Default |
|--------|-------------|---------|
| `--dir <path>` | Directory to scan for test files | `./tests` |
| `--dry-run` | Show proposals without applying them | `false` |

---

## Registered but unsupported commands

These commands are present so the CLI can fail clearly and consistently:

- `test-capabilities predict`
- `test-capabilities visualize`
- `test-capabilities report`

Current behavior:
- exit non-zero
- print an explicit unsupported-command error

---

## Exit behavior

| Exit code | Meaning |
|-----------|---------|
| `0` | Supported command completed successfully |
| `1` | Configuration error, unsupported surface, or runtime failure |

---

## Runtime capability summary

These route statuses are mirrored by the exported operation registry / route manifest so docs, CLI dispatch, and contract tests share one source of truth.

| Surface | Status |
|---------|--------|
| `test` | implemented |
| `surf explore` | implemented |
| `quantum` | implemented |
| `heal` | implemented |
| `predict` | unsupported |
| `visualize` | unsupported |
| `report` | unsupported |
