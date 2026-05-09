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
| `--target <url-or-path>` | Override one target. Non-URLs map to `targets.cli`. URLs map to `targets.web` and are only accepted when a real web consumer is enabled for the run (currently: `quantum.enabled: true` or an enabled `bombadil` agent). | none |
| `--quick` | Disable quantum and prediction overlays for a deterministic smoke run | `false` |

Important:
- the current supported orchestrator agents are `bombadil` and `cli-tester`
- a URL `--target` does **not** replace `targets.cli` when `cli-tester` is still enabled for the run
- `test --quick --target https://...` still works when an enabled `bombadil` agent is the active web consumer
- Bombadil resolution order is `TEST_CAPABILITIES_BOMBADIL_BIN`, then a built checkout from `TEST_CAPABILITIES_BOMBADIL_REPO` or the conventional workspace-local `softwareco/contrib/bombadil`, then repo-local `external/bombadil`, then `bombadil` on `PATH`
- an unbuilt contrib/source checkout does not override the fallback chain; the runtime reports that you still need a built `target/release|debug/bombadil` plus upstream `trunk`/`esbuild` prerequisites (or the Bombadil Nix shell)

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
An explicit `--url` is required; the kernel no longer defaults to `about:blank` because that created success-shaped no-op runs.

```bash
test-capabilities surf explore --url https://example.com
```

Options:

| Option | Description |
|--------|-------------|
| `--url <url>` | Required target URL |
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
| `--target <url>` | Required target URL for the simulator | none |
| `--branches <n>` | Positive integer branch count | `100` |
| `--collapse` | Use `significance` collapse instead of `coverage` | `false` |

An explicit `--target` is required so the command cannot silently simulate a placeholder site.
Invalid branch counts such as `0`, negative values, or non-numeric strings fail closed.
Non-URL targets also fail closed instead of being simulated as if they were valid browser URLs.

---

### `test-capabilities heal`

Run the selector-healing workflow.

```bash
test-capabilities heal --dir ./tests --dry-run
test-capabilities heal --dir ./tests --dry-run \
  --proposal-output artifacts/heal-proposals.json \
  --verification-output artifacts/heal-verification.json

test-capabilities heal --dir ./tests --checkpoint-ref checkpoint/test-capabilities/heal-001
```

| Option | Description | Default |
|--------|-------------|---------|
| `--dir <path>` | Directory to scan for test files (must exist) | `./tests` |
| `--dry-run` | Show proposals without applying them | `false` |
| `--proposal-output <file>` | Write a dry-run proposal artifact as JSON for review or replay-ledger follow-through | unset |
| `--verification-output <file>` | Write a dry-run verification artifact after checking proposals in memory | unset |
| `--checkpoint-ref <ref>` | External checkpoint identity required before applying healing proposals | unset |

Missing or non-directory `--dir` values fail closed instead of reporting an empty success.
The healing scan skips common generated/dependency directories such as `node_modules`, `dist`, `coverage`, and `.git`.
Proposal and verification artifacts are dry-run only: requesting `--proposal-output` or `--verification-output` without `--dry-run` fails closed instead of writing misleading mutation artifacts.
When applying fixes, the kernel requires `--checkpoint-ref` if proposals would mutate files, then validates the full per-file proposal set before writing so same-line rewrites do not leave partial mutations behind.
The checkpoint ref must come from an external checkpoint/restore authority; this command records the identity but does not create checkpoints or perform rollback.

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
