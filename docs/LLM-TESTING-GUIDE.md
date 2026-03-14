---
summary: "Guide to LLM-driven testing approaches, tools, and tradeoffs."
read_when:
  - "You are evaluating LLM-assisted testing approaches"
  - "You need to compare browser, CLI, and API testing tool options"
type: "guide"
---

# LLM-Driven User Flow Testing

> A practical guide to testing user flows with AI, curated frameworks, and validated experiments.

## 🚀 NEW: TEST-CAPABILITIES Testing Framework

**TEST-CAPABILITIES** aims to unify multiple testing modes behind one system. The current shipped runtime is intentionally **fail-closed**:

- supported paths execute
- unsupported paths error clearly
- experimental/autonomous claims are not treated as shipped behavior unless wired into a real runtime path

### Capability-backed surfaces today
- `test-capabilities test --config <file> [--target <url-or-path>] [--quick]`
  - non-URL targets override `targets.cli`
  - URL targets override `targets.web` only when `quantum.enabled: true`
  - URL targets do not replace the required `targets.cli` smoke target
- `test-capabilities surf explore --url <url>`
- `test-capabilities quantum --target <url>`
- `test-capabilities heal --dir <path>`

### Library surfaces available directly
- `PredictionEngine`
- `SelfHealingEngine`
- `QuantumSimulator`
- `SurfClient`

```bash
npm install
npm run build

# Current safe CLI pattern
cat > test-capabilities.yaml <<'YAML'
version: '2.0'
name: 'CLI Smoke'
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
YAML

test-capabilities test --quick --config test-capabilities.yaml
```

See [TEST-CAPABILITIES-FRAMEWORK.md](./TEST-CAPABILITIES-FRAMEWORK.md) for architecture and [api/cli.md](./api/cli.md) for the exact current CLI contract.

---

## Decision Framework

### Quick Selection

| Question | Answer → Tool |
|----------|---------------|
| **Single supported TEST-CAPABILITIES CLI run?** | **TEST-CAPABILITIES** `test` / `quantum` / `heal` / `surf explore` |
| CI/CD verification? | `verify.sh` + BATS |
| Docs/demo for README? | asciinema cast |
| Marketing showcase? | VHS gif |
| Web UI fuzzing? | Bombadil |
| LLM navigates browser? | Surf-CLI / Stagehand / agent-browser |
| LLM generates tests? | BATS + LLM |
| Direct predictive library API? | `PredictionEngine` |

### By Project Type

```text
CLI / Scripts     → shellcheck → BATS → verify.sh
Web App (fuzzing) → Bombadil (property-based)
Web App (LLM)     → Surf-CLI / Stagehand / agent-browser
API               → Snapshot tests + contract tests + direct library APIs
Everything        → TEST-CAPABILITIES where a capability-backed path exists
```

---

## Tool Catalog

### Tool Catalog

**Desktop/Computer Control:**

| Tool | Platform | Best For |
|------|----------|----------|
| **Open Interpreter** | Any | General computer control, runs code |
| **Open Computer Use** | Cloud Linux | Secure sandbox, any LLM, E2B |
| **Piglet** | Windows | Native Windows automation, Zig-based |
| **Claude Code** | Any | Code + terminal |

**Web Testing:**

| Tool | Best For |
|------|----------|
| **Bombadil** | Property-based fuzzing, autonomous exploration |
| **Stagehand** | AI navigation with natural language |
| **agent-browser** | CLI browser automation with @refs |
| **pi-agent-browser** | LLM browsing integrated with pi |
| **SurfClient / surf-cli** | Browser control through TEST-CAPABILITIES library + CLI wrapper |

**CLI Testing:**

| Tool | Best For |
|------|----------|
| **verify.sh** | Quick smoke tests, CI |
| **BATS** | Complex test suites |
| **shellcheck** | Static analysis |

### 1. verify.sh (Smoke Tests)

**Best for**: Quick CI validation, bash scripts, CLI tools

```bash
#!/usr/bin/env bash
set -euo pipefail
pass=0; fail=0

check() {
    if "$@" >/dev/null 2>&1; then
        echo "✓ $1"; pass=$((pass + 1))
    else
        echo "✗ $1"; fail=$((fail + 1))
    fi
}

check "pv --version" ./scripts/pv --version
check "pv templates" ./scripts/pv templates

echo "Passed: $pass / Failed: $fail"
[ $fail -eq 0 ]
```

### 2. BATS (Bash Automated Testing System)

**Best for**: Complex CLI tests with setup/teardown

```bash
#!/usr/bin/env bats
load 'setup'

@test "pv --version returns version" {
    run ./scripts/pv --version
    [ "$status" -eq 0 ]
    [[ "$output" == *"1.0"* ]]
}
```

### 3. Bombadil (Property-Based Web Testing)

**Best for**: Web UI fuzzing, finding edge cases automatically

**Install**:
```bash
curl -sL https://github.com/antithesishq/bombadil/releases/latest/download/bombadil-x86_64-linux -o bombadil
chmod +x bombadil
```

**Usage**:
```bash
# Minimal spec (uses defaults)
echo 'export * from "@antithesishq/bombadil/defaults";' > spec.ts
bombadil test https://your-app.com --headless
```

**Custom property (invariant)**:
```typescript
import { always, extract } from "@antithesishq/bombadil";
export { clicks } from "@antithesishq/bombadil/defaults/actions";

const title = extract((state) =>
    state.document.querySelector("h1")?.textContent ?? ""
);

export const has_title = always(() => title.current.trim() !== "");
```

**Requires**: Chrome/Chromium installed

### 4. Stagehand (AI Browser Automation)

**Best for**: AI-driven navigation, natural language web automation

**Install**:
```bash
npm install @browserbasehq/stagehand
```

**Usage**:
```typescript
import { Stagehand } from "@browserbasehq/stagehand";

const stagehand = new Stagehand({ env: "LOCAL" });
await stagehand.init();

await stagehand.page.goto("https://example.com");
await stagehand.act("click the login button");
await stagehand.act("fill the email field with test@example.com");
```

### 5. pi-agent-browser (LLM + Browser for pi)

**Best for**: Letting pi's LLM browse the web, visual verification

**Install**:
```bash
pi install npm:pi-agent-browser
npm install -g agent-browser
```

### 6. agent-browser CLI (Headless Browser for Agents)

**Best for**: Standalone browser automation from any LLM

**Install**:
```bash
npm install -g agent-browser
```

### 7. Surf-CLI (Advanced Browser Control for AI Agents)

**Best for**: zero-config browser automation, AI queries without API keys, network capture

**Install**:
```bash
npm install -g surf-cli
surf install <extension-id>
```

**Validated**: works as the browser integration behind TEST-CAPABILITIES `SurfClient` and the supported `test-capabilities surf explore` wrapper.

---

## Prompt Templates

### For Creating an LLM Testing System

```text
Create an LLM-driven user flow tester for a [CLI tool / web app / API].

Requirements:
1. Agent reads [help output / API docs / DOM] to discover available actions
2. Agent executes realistic user flows (happy path + edge cases)
3. Agent evaluates if each flow succeeded or failed
4. Output: structured report with pass/fail + reasoning

Stack:
- Execution: [Playwright / bash subprocess / fetch]
- LLM: [Claude / GPT-4 / local model]
- Format: JSON report with steps, outputs, verdicts

Constraints:
- Must be deterministic (seeded randomness)
- Must log every action for reproducibility
- Budget: max [N] actions per flow, max [M] tokens

Deliverables:
1. Test runner script
2. Prompt template for the agent
3. Example test run with output
```

### For CLI Testing (Specific)

```text
Create an LLM-driven CLI tester for [tool-name] (a bash-based [domain] tool).

The agent should:
1. Run `./[tool] --help` to discover commands
2. Execute realistic user flows
3. After each command, evaluate stdout/stderr to determine success
4. Try edge cases (missing args, invalid names, etc.)
5. Output JSON report: {flow, steps: [{cmd, output, verdict, reason}]}
```

---

## When to Use What

### LLM Testing vs Traditional

| LLM Testing | Traditional Testing |
|-------------|-------------------|
| Exploratory, discovers bugs | Fixed test cases |
| Expensive (API calls) | Cheap, fast |
| Non-deterministic | Deterministic |
| Good for: complex flows, edge cases | Good for: regression, CI |

**Recommendation**: use both
- Traditional (BATS/verify.sh) for CI
- LLM testing for exploratory/edge cases

---

## Quick Start Templates

### Minimal verify.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

check() { "$@" >/dev/null 2>&1 && echo "✓ $1" || echo "✗ $1"; }

check "app runs" ./your-app --version
check "help works" ./your-app --help
```

### Minimal BATS

```bash
#!/usr/bin/env bats
@test "version" { run ./app --version; [ "$status" -eq 0 ]; }
@test "help" { run ./app --help; [[ "$output" == *"Usage"* ]]; }
```

### Minimal Bombadil Spec

```typescript
export * from "@antithesishq/bombadil/defaults";
```

### Minimal Stagehand Test

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
const s = new Stagehand({ env: "LOCAL" });
await s.init();
await s.page.goto("https://example.com");
await s.act("click the first link");
```

---

## File Index

```text
~/test-capabilities/
├── LLM-TESTING-GUIDE.md
├── prompts/
│   ├── cli-tester.md
│   ├── web-tester.md
│   └── api-tester.md
└── docs/api/
    ├── cli.md
    ├── config.md
    ├── examples.md
    └── patterns.md
```
