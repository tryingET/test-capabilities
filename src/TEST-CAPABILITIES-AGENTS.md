---
summary: "Agent-facing entrypoint and routing guide for TEST-CAPABILITIES commands and docs."
read_when:
  - "You are handling this repo through an agent workflow"
  - "You need a quick command/doc routing surface for common user intents"
type: "reference"
---

# AGENTS.md

> **TEST-CAPABILITIES — agent routing surface for the current fail-closed runtime**

---

## Current runtime contract

TEST-CAPABILITIES exposes a mix of:
- **capability-backed runtime paths** that execute today
- **library surfaces** that can be used directly from TypeScript
- **unsupported CLI placeholders** that fail clearly instead of pretending success

The shipped CLI verbs are routed through a shared operation kernel (`CLI_OPERATION_REGISTRY` + `executeCliOperation(...)`).

### Supported CLI/runtime surfaces
- `test-capabilities doctor [--json]`
  - zero-external-dependency first-run diagnostics; missing Surf/Bombadil runtimes warn but do not fail
- `test-capabilities init [--output <file>] [--target <command>] [--force] [--print] [--json]`
  - generates a minimal valid `cli-tester` config and refuses overwrites unless `--force` is present
- `test-capabilities demo [--json]`
  - zero-external-dependency functional demo; runs the shipped `examples/demo/cli-demo.mjs` fixture through `cli-tester`
- `test-capabilities test --config <file> [--target <url-or-path>] [--quick] [--json]`
  - non-URL targets override `targets.cli`
  - URL targets override `targets.web` when `quantum.enabled: true` or an enabled `bombadil`/`surf` agent provides the supported web runtime path
  - URL targets do not replace `targets.cli` when `cli-tester` is still enabled for the run
- `test-capabilities surf explore --url <url>`
- `test-capabilities quantum --target <url> [--branches <n>] [--collapse]`
- `test-capabilities heal --dir <path> [--dry-run] [--findings-input <file>] [--proposal-output <file>] [--verification-output <file>] [--proposal-input <file>] [--checkpoint-ref <ref>]`

### Supported orchestrator path today
- `bombadil` agent
- `surf` agent
- `cli-tester` agent
- `correlation: true`
- `quantum` when `targets.web` is present
- Surf Go runtime resolution: `TEST_CAPABILITIES_SURF_GO_BIN` → source checkout referenced by `TEST_CAPABILITIES_SURF_GO_REPO` → `surf-go` on `PATH`
- Bombadil binary resolution: `TEST_CAPABILITIES_BOMBADIL_BIN` → built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO` → repo-local `external/bombadil` → `bombadil` on `PATH`

### Unsupported in the current CLI wrapper
- `test-capabilities predict`
- `test-capabilities visualize`
- `test-capabilities report`
- `test --autonomous`
- `test --self-heal`
- `test --predict`
- `test --fail-threshold`
- extra surf actions: `flow`, `assert`, `compare`, `replay`

---

## Quick decision tree

```text
What does the user want?
│
├─ "Check installation" ──────────→ test-capabilities doctor [--json]
│
├─ "Create starting config" ──────→ test-capabilities init [--output test-capabilities.yaml]
│
├─ "Run built-in demo" ───────────→ test-capabilities demo [--json]
│
├─ "Run the supported suite" ─────→ test-capabilities test --config <file> [--quick] [--json]
│
├─ "Quick CLI smoke" ─────────────→ test-capabilities test --quick --target node --config <file>
│
├─ "Fix broken tests" ────────────→ test-capabilities heal --dir <path> [--dry-run] [--findings-input <file>] [--proposal-output <file>] [--verification-output <file>] [--proposal-input <file>] [--checkpoint-ref <ref>]
│
├─ "Explore edge cases" ──────────→ test-capabilities quantum --target <url>
│
├─ "Browser automation API" ──────→ Read ../docs/api/api-surf.md
│
├─ "Prediction as library API" ───→ Read ../docs/api/api-prediction.md
│
└─ "Exact command contract" ──────→ Read ../docs/api/cli.md
```

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Supported command completed successfully |
| 1 | Configuration error, unsupported surface, or runtime failure |

---

## Output shape

### CLI

The supported CLI currently prints a human-readable summary, for example:

```text
Health:  pass
Findings: 0
Coverage: user=unmeasured api=unmeasured edge=100% overall=partial(100%)
Coverage gaps: userFlows, apiEndpoints
```

### Library API

Programmatic usage returns either a `TestResult` (via the orchestrator) or a typed operation-kernel envelope (via `executeCliOperation(...)`); see `../docs/api/api-reference.md` and `../docs/api/types.md`.

---

## Documentation map

| Task | Read this |
|------|-----------|
| Exact CLI behavior | `../docs/api/cli.md` |
| Programmatic API | `../docs/api/api-reference.md` |
| SurfClient browser API | `../docs/api/api-surf.md` |
| Self-healing APIs | `../docs/api/api-healing.md` |
| Prediction engine API | `../docs/api/api-prediction.md` |
| Quantum APIs | `../docs/api/api-quantum.md` |
| Runtime-accurate examples | `../docs/api/examples.md` |
| Integration patterns | `../docs/api/patterns.md` |
| Error handling | `../docs/api/errors.md` |
| Config contract | `../docs/api/config.md` |
| Type definitions | `../docs/api/types.md` |
| Product/runtime overview | `../README.md` |

---

## One-line reference

```bash
test-capabilities doctor [--json]
test-capabilities init [--output <file>] [--target <command>] [--force] [--print] [--json]
test-capabilities test --config <file> [--target <url-or-path>] [--quick] [--json]
test-capabilities surf explore --url <url>
test-capabilities quantum --target <url> [--branches N] [--collapse]
test-capabilities heal --dir <path> [--dry-run] [--findings-input <file>] [--proposal-output <file>] [--verification-output <file>] [--proposal-input <file>] [--checkpoint-ref <ref>]
```

---

*Version: 0.1.0*
