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
| `--target <url-or-path>` | Override one target. Non-URLs map to `targets.cli`. URLs map to `targets.web` and are only accepted when a real web consumer is enabled for the run (currently: `quantum.enabled: true`). | none |
| `--quick` | Disable quantum and prediction overlays for a deterministic smoke run | `false` |

Important:
- the current supported orchestrator agent is still `cli-tester`
- a URL `--target` does **not** replace the required `targets.cli` smoke target
- `test --quick --target https://...` fails clearly because quick mode disables the only shipped web consumer (`quantum`)

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
| `--depth <n>` | Fails with an unsupported-option error until wired to a real runtime path |
| `--record` | Fails with an unsupported-option error until wired to a real runtime path |
| `--validate` | Fails with an unsupported-option error until wired to a real runtime path |
| `--baseline <dir>` | Fails with an unsupported-option error until wired to a real runtime path |
| `--ai-diff` | Fails with an unsupported-option error until wired to a real runtime path |
| `--file <path>` | Fails with an unsupported-option error until wired to a real runtime path |

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
| `--branches <n>` | Positive integer branch count | `100` |
| `--collapse` | Use `significance` collapse instead of `coverage` | `false` |

Invalid branch counts such as `0`, negative values, or non-numeric strings fail closed.

---

### `test-capabilities heal`

Run the selector-healing workflow.

```bash
test-capabilities heal --dir ./tests --dry-run
```

| Option | Description | Default |
|--------|-------------|---------|
| `--dir <path>` | Directory to scan for test files (must exist) | `./tests` |
| `--dry-run` | Show proposals without applying them | `false` |

Missing or non-directory `--dir` values fail closed instead of reporting an empty success.
The healing scan skips common generated/dependency directories such as `node_modules`, `dist`, `coverage`, and `.git`.

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
