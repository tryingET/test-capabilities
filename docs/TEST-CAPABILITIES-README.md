---
summary: "Short product-facing introduction to TEST-CAPABILITIES and its core commands."
read_when:
  - "You need a concise overview of what TEST-CAPABILITIES is"
  - "You are sharing or reviewing the quick introduction surface"
type: "reference"
---

# TEST-CAPABILITIES

> **The testing framework that tests itself — with a fail-closed runtime contract.**

---

## What is this?

TEST-CAPABILITIES is a testing framework and library suite spanning:
- orchestrated CLI smoke/testing flows
- browser automation via `SurfClient`
- self-healing helpers
- prediction APIs
- quantum simulation

The key rule for the shipped CLI/runtime is: **unsupported surfaces fail clearly instead of pretending success**.

The shipped verbs are now owned by an explicit **operation kernel** (`CLI_OPERATION_REGISTRY` + `executeCliOperation(...)`) so the CLI wrapper is only an adapter.

---

## Quick start

From this repo:

```bash
npm install
npm run build
node ./bin/test-capabilities test --quick --config ./test-capabilities.yaml --target node
```

From a packaged consumer install, use the same `test-capabilities` command surface with a capability-backed config.

---

## What is implemented today?

### Supported CLI/runtime surfaces
- `test-capabilities test --config <file> [--target <url-or-path>] [--quick]`
  - non-URL targets override `targets.cli`
  - URL targets override `targets.web` and are only meaningful when `quantum.enabled: true`
  - URL targets do not replace the required `targets.cli` smoke target
- `test-capabilities surf explore --url <url>`
- `test-capabilities quantum --target <url>`
- `test-capabilities heal --dir <path>`

### Unsupported in the current CLI wrapper
- `test-capabilities predict`
- `test-capabilities report`
- `test-capabilities visualize`
- `test --autonomous`
- `test --self-heal`
- `test --predict`
- extra surf actions beyond `explore`

### Library APIs available directly
- `CLI_OPERATION_REGISTRY` / `executeCliOperation`
- `PredictionEngine`
- `SelfHealingEngine`
- `QuantumSimulator`
- `SurfClient`
- `createNexus` / `createTestCapabilities`

---

## Why TEST-CAPABILITIES?

| Before | After |
|--------|-------|
| Tests and docs drift apart silently | Runtime and docs are expected to converge |
| Unsupported features degrade into placeholders | Unsupported features fail clearly |
| Browser, CLI, prediction, and simulation feel fragmented | One package exposes the surfaces explicitly |
| Consumer contract is assumed | Consumer contract is smoke-tested with packed artifacts |

---

## Documentation

| What you want | Where to go |
|---------------|-------------|
| Get started | [api/getting-started.md](api/getting-started.md) |
| See examples | [api/examples.md](api/examples.md) |
| Use the API | [api/api-reference.md](api/api-reference.md) |
| Exact CLI/runtime contract | [api/cli.md](api/cli.md) |
| Configuration | [api/config.md](api/config.md) |
| Error handling | [api/errors.md](api/errors.md) |
| I'm an AI agent | [../AGENTS.md](../AGENTS.md) |

---

## Commands

```bash
test-capabilities test --config ./test-capabilities.yaml [--quick] [--target <url-or-path>]
# URL targets only apply when quantum is enabled; CLI smoke still requires targets.cli
test-capabilities surf explore --url https://example.com
test-capabilities quantum --target https://example.com --branches 100 --collapse
test-capabilities heal --dir ./tests --dry-run
```

Unsupported commands fail clearly instead of emitting placeholder output.

---

## Architecture

```text
CLI/runtime contract
├── operation kernel
│   ├── test          → capability-backed orchestrator path
│   ├── surf explore  → surf wrapper executor
│   ├── quantum       → simulator path
│   └── heal          → selector-healing workflow
└── unsupported route → explicit error

Library surface
├── CLI_OPERATION_REGISTRY / executeCliOperation
├── SurfClient
├── SelfHealingEngine
├── PredictionEngine
├── QuantumSimulator
└── createNexus / createTestCapabilities
```

---

## License

See [`../LICENSE`](../LICENSE): MIT-style terms with the same restricted-party rider used by the pi-extensions packages.

---

> *The best test is the one whose contract matches reality.*
