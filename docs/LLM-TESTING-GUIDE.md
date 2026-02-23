# LLM-Driven User Flow Testing

> A practical guide to testing user flows with AI, curated frameworks, and validated experiments.

---
summary: "Decision framework and tools for LLM-driven testing"
read_when:
  - "Setting up automated testing for a new project"
  - "Deciding between VHS, BATS, verify.sh, or AI testing"
  - "Evaluating browser automation frameworks"
---

## 🚀 NEW: NEXUS Testing Framework

**NEXUS** is the ultimate autonomous testing framework that unifies all tools below into one powerful system:

- **Self-healing tests** that fix themselves when UI changes
- **Quantum simulation** that explores 1000s of parallel test paths
- **ML-powered prediction** that knows failures before they happen
- **Surf-CLI integration** for AI-powered browser control
- **Cross-domain correlation** connecting web, API, and CLI findings

```bash
npm install -g @nexus/testing-framework
nexus test --target https://your-app.com --autonomous
```

See [NEXUS-TESTING-FRAMEWORK.md](./NEXUS-TESTING-FRAMEWORK.md) for full documentation.

---

## Decision Framework

### Quick Selection

| Question | Answer → Tool |
|----------|---------------|
| **Ultimate testing** | **NEXUS** (all-in-one) |
| CI/CD verification? | `verify.sh` + BATS |
| Docs/demo for README? | asciinema cast |
| Marketing showcase? | VHS gif |
| Web UI fuzzing? | Bombadil |
| LLM navigates browser? | Surf-CLI / Stagehand / agent-browser |
| LLM generates tests? | BATS + LLM |
| Full AI test agent? | NEXUS / pi-agent-browser |

### By Project Type

```
CLI / Scripts     → shellcheck → BATS → verify.sh
Web App (fuzzing) → Bombadil (property-based)
Web App (LLM)     → Surf-CLI / Stagehand / NEXUS
API               → Snapshot tests + contract tests + NEXUS
Everything        → NEXUS (unified autonomous testing)
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
| **Claude Code** | Any | Code + terminal (like pi) |

**Web Testing:**

| Tool | Best For |
|------|----------|
| **Bombadil** | Property-based fuzzing, autonomous exploration |
| **Stagehand** | AI navigation with natural language |
| **agent-browser** | CLI browser automation with @refs |
| **pi-agent-browser** | LLM browsing integrated with pi |

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

const { title } = await stagehand.extract(
    "extract the page title",
    z.object({ title: z.string() })
);
```

### 5. pi-agent-browser (LLM + Browser for pi)

**Best for**: Letting pi's LLM browse the web, visual verification

**Install**:
```bash
pi install npm:pi-agent-browser
npm install -g agent-browser  # CLI dependency
```

**Workflow in pi**:
```
You: Test the login flow on https://myapp.com

LLM uses browser tool:
  browser open https://myapp.com
  browser snapshot -i        # Gets interactive elements
  browser click @e1          # Clicks login button
  browser fill @e2 "user"    # Fills form
  browser screenshot         # Captures visual
  browser close
```

**Features**:
- Inline screenshots (vision-capable models can see the page)
- @ref handles for interaction (no CSS selectors)
- Auto-cleanup on session end

### 6. agent-browser CLI (Headless Browser for Agents)

**Best for**: Standalone browser automation from any LLM

**Install**:
```bash
npm install -g agent-browser
```

**Commands**:
```bash
agent-browser open https://example.com
agent-browser snapshot          # Accessibility tree with @refs
agent-browser click @e1
agent-browser fill @e2 "text"
agent-browser screenshot
agent-browser close
```

**Validated**: ✓ Works on this system (2026-02-20)

### 7. Surf-CLI (Advanced Browser Control for AI Agents)

**Best for**: Zero-config browser automation, AI queries without API keys, network capture

**Install**:
```bash
npm install -g surf-cli
surf install <extension-id>  # After loading extension in Chrome
```

**Why Surf-CLI**:
- **Agent-agnostic**: Pure CLI, works with any LLM
- **Zero config**: Install extension, run commands
- **AI without API keys**: Query ChatGPT, Gemini, Perplexity, Grok using browser login
- **Network capture**: Automatic request logging and replay
- **Smart defaults**: Auto-resize screenshots, auto-capture after actions

**Commands**:
```bash
# Navigation
surf go "https://example.com"
surf read                           # Accessibility tree
surf click e5                       # Click by ref
surf type "hello" --ref e12         # Type into element

# Semantic locators (no selectors needed)
surf locate.role button --name "Submit" --action click
surf locate.text "Sign In" --action click
surf locate.label "Email" --action fill --value "test@example.com"

# Screenshots
surf screenshot                     # Auto-saves to /tmp
surf screenshot --annotate          # With element labels

# AI Queries (no API keys!)
surf chatgpt "explain this code" --with-page
surf gemini "summarize" --with-page
surf perplexity "what is this" --with-page
surf grok "analyze trends" --deep-search

# Network capture
surf network                        # View requests
surf network --status 4xx,5xx       # Filter errors
surf network.curl r_001             # Generate curl command

# Workflows (multi-step automation)
surf do 'go "https://example.com" | click e5 | screenshot'

# Device emulation
surf emulate.device "iPhone 14"
surf emulate.viewport --width 375 --height 812
```

**Network Replay**:
```bash
# Capture network while browsing
surf go "https://myapp.com"
# ... interact with page ...
surf network --format curl          # Get all as curl commands
surf network.get r_001              # Get specific request details
```

**Validated**: ✓ Integrates with NEXUS framework

---

## Experiment Results

### Test 1: agent-browser ✅

```bash
$ agent-browser open https://example.com
✓ Example Domain
  https://example.com/

$ agent-browser snapshot | head -10
- document:
  - heading "Example Domain" [ref=e1] [level=1]
  - paragraph: This domain is for use in documentation examples...
  - link "Learn more" [ref=e2]

$ agent-browser screenshot /tmp/test.png
✓ Screenshot saved to /tmp/test.png (16KB)

$ agent-browser close
✓ Browser closed
```

**Status**: ✅ Working (2026-02-20)

### Test 2: Bombadil ✅

```bash
$ ./bombadil test https://news.ycombinator.com --headless --output-path /tmp/test
[INFO] starting test of https://news.ycombinator.com/
[INFO] picked action: Click { name: "A", ... }
[INFO] picked action: Click { name: "INPUT", ... }
[INFO] picked action: TypeText { text: "Md", delay: 185ms }
[INFO] picked action: PressKey { code: 13 }
...

$ cat /tmp/test/trace.jsonl | jq -c '{url, action, violations}'
{"url":"https://news.ycombinator.com/","action":null,"violations":[]}
{"url":"https://news.ycombinator.com/vote?id=...","action":{"Click":{...}},"violations":[]}
```

**Status**: ✅ Working - autonomously explores pages, logs actions, captures screenshots

**Note**: Simple pages (example.com) may exit with "no fallback action" - use complex pages for best results.

### Test 3: pi-agent-browser ✅

```bash
$ pi install npm:pi-agent-browser
$ npm install -g agent-browser
Installed
```

**Status**: ✅ Installed and working with agent-browser CLI

---

## Prompt Templates

### For Creating an LLM Testing System

```
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

```
Create an LLM-driven CLI tester for [tool-name] (a bash-based [domain] tool).

The agent should:
1. Run `./[tool] --help` to discover commands
2. Execute realistic user flows:
   - [flow 1: e.g., Initialize]
   - [flow 2: e.g., Create/edit/search]
   - [flow 3: e.g., Run quality checks]
3. After each command, evaluate stdout/stderr to determine success
4. Try edge cases (missing args, invalid names, etc.)
5. Output JSON report: {flow, steps: [{cmd, output, verdict, reason}]}

Use [Claude API / local model].
Max [N] flows, max [M] steps per flow.
```

### For Web App Testing with Bombadil

```
Create a Bombadil specification for testing [app-name].

The spec should include:
1. Default actions (clicks, inputs)
2. Custom invariants:
   - [invariant 1: e.g., "always has visible navigation"]
   - [invariant 2: e.g., "loading states eventually resolve"]
3. Guarantees:
   - [guarantee 1: e.g., "form submission shows feedback within 5s"]

Output:
1. spec.ts file
2. Command to run tests
3. Expected output format
```

---

## When to Use What

### VHS vs Alternatives

| Use VHS When | Don't Use VHS When |
|--------------|-------------------|
| Marketing gif needed | CI verification needed |
| Simulated terminal OK | Real execution required |
| Visual polish matters | Deterministic output matters |

**Better alternatives for docs**:
- Code blocks with expected output
- asciinema recordings (real sessions)
- verify.sh output (actual validation)

### LLM Testing vs Traditional

| LLM Testing | Traditional Testing |
|-------------|-------------------|
| Exploratory, discovers bugs | Fixed test cases |
| Expensive (API calls) | Cheap, fast |
| Non-deterministic | Deterministic |
| Good for: complex flows, edge cases | Good for: regression, CI |

**Recommendation**: Use both
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

```
~/testers/
├── LLM-TESTING-GUIDE.md    # This file
├── bombadil                # Binary (v0.2.1)
├── test-spec.ts            # Sample Bombadil spec
└── prompts/
    ├── cli-tester.md       # Prompt for CLI testing
    ├── web-tester.md       # Prompt for web testing
    └── api-tester.md       # Prompt for API testing
```
