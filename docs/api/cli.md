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
- `doctor`
- `demo`
- `test`
- `surf explore`
- `quantum`
- `heal`

---

## Implemented commands

### `test-capabilities doctor`

Run zero-external-dependency package and environment diagnostics. This is the public first-run happy path: it verifies required package/runtime basics and reports optional external Surf Go or Bombadil-compatible runtimes as warnings when absent.

```bash
test-capabilities doctor
test-capabilities doctor --json
test-capabilities doctor --config ./test-capabilities.yaml
test-capabilities doctor --target node
```

Required checks:
- Node.js 22+
- package metadata is present, versioned, and publishable
- `LICENSE` and `README.md` are present
- `dist/index.js`, `bin/test-capabilities`, and `test-capabilities.yaml` are present
- the packaged sample config parses as a valid `test-capabilities` config, or `--config <file>` parses if provided
- `--target <command-or-url>` resolves a CLI executable without running it, or validates an HTTP(S) URL target

Optional checks:
- Surf Go runtime via `TEST_CAPABILITIES_SURF_GO_BIN`, `TEST_CAPABILITIES_SURF_GO_REPO`, or `surf-go` on `PATH`
- Bombadil-compatible runtime via `TEST_CAPABILITIES_BOMBADIL_BIN`, `TEST_CAPABILITIES_BOMBADIL_REPO`, or `bombadil` on `PATH`

Missing optional runtimes do not fail `doctor`.

### `test-capabilities demo`

Run the built-in zero-external-dependency demo fixture. This is the first functional proof path after `doctor`: it executes a shipped demo CLI through the same `cli-tester` orchestrator path that user targets use.

```bash
test-capabilities demo
test-capabilities demo --json
```

The demo uses `examples/demo/cli-demo.mjs` and an equivalent checked-in config at `examples/demo/test-capabilities.yaml`. It requires only Node.js and the installed package files; Surf Go and Bombadil-compatible runtimes remain optional. The text and JSON output both identify the polished core use case as `cli-smoke-observation`: CLI smoke plus `observation.v1` diagnostics, with next commands for replacing the demo target with a real CLI.

### `test-capabilities test`

Run the capability-backed orchestrator path.

```bash
test-capabilities test [options]
test-capabilities test --config examples/demo/test-capabilities.yaml --json
```

Supported options:

| Option | Description | Default |
|--------|-------------|---------|
| `--config <file>` | Path to `test-capabilities.yaml` | `test-capabilities.yaml` |
| `--target <url-or-path>` | Override one target. Non-URLs map to `targets.cli`. URLs map to `targets.web` and are only accepted when a real web consumer is enabled for the run (currently: `quantum.enabled: true` or an enabled `bombadil` or `surf` agent). | none |
| `--quick` | Disable quantum and prediction overlays for a deterministic smoke run | `false` |
| `--json` | Print the full machine-readable operation envelope for agents/CI instead of the banner and human summary | `false` |

Important:
- `--json` emits the same `TestOperationResultEnvelope` returned by `executeCliOperation({ command: 'test' }, input)`, including `operationId`, normalized `input`, `effectiveConfig`, `summary`, and the full orchestrator `result`
- the current supported orchestrator agents are `bombadil`, `surf`, and `cli-tester`
- a URL `--target` does **not** replace `targets.cli` when `cli-tester` is still enabled for the run
- `test --quick --target https://...` still works when an enabled `bombadil` or `surf` agent is the active web consumer
- Bombadil resolution order is `TEST_CAPABILITIES_BOMBADIL_BIN`, then a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, then repo-local `external/bombadil`, then `bombadil` on `PATH`
- an unbuilt source checkout does not override the fallback chain; the runtime reports that you still need a built `target/release|debug/bombadil` plus source-project prerequisites such as `trunk`, `esbuild`, or a Nix shell

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

Run the resolved Surf Go (`surf-go`) runtime through the supported `explore` action. `test-capabilities surf explore --url <url>` invokes Surf Go as `navigate --url <url>`, then runs explicit browser-state and DOM JavaScript probes and verifies that observed page state matches the target URL before reporting coverage.
An explicit `--url` is required; the kernel no longer defaults to `about:blank` because that created success-shaped no-op runs. Non-empty stdout is not evidence by itself: help text, warnings, and target URLs without a matching browser-state probe fail closed as unverified coverage. `--depth 2` or `--depth 3` adds bounded same-origin link discovery and turns user-flow coverage into a graded verified-probe score instead of a binary process-success signal.

```bash
test-capabilities surf explore --url https://example.com
# bounded same-origin exploration with graded coverage
test-capabilities surf explore --url https://example.com --depth 2
```

Options:

| Option | Description |
|--------|-------------|
| `--url <url>` | Required target URL |
| `--depth <n>` | Optional bounded same-origin exploration depth, integer `1`-`3`; deeper pages contribute graded coverage only when their probes verify |
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
| `doctor` | implemented |
| `demo` | implemented |
| `test` | implemented |
| `surf explore` | implemented |
| `quantum` | implemented |
| `heal` | implemented |
| `predict` | unsupported |
| `visualize` | unsupported |
| `report` | unsupported |
