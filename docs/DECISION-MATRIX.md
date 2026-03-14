---
summary: "Decision matrix for choosing the right testing tool or approach."
read_when:
  - "You are choosing between Bombadil, Stagehand, agent-browser, or adjacent tools"
  - "You need a quick decision aid for testing-mode selection"
type: "reference"
---

# LLM Testing: Decision Matrix & Tool Comparison

> When to use what, and why.

## Quick Decision Tree

```
What are you testing?
│
├─ CLI / Scripts ──────────────────→ BATS + verify.sh
│
├─ Web UI (property-based fuzzing) → Bombadil
│
├─ Web UI (AI navigates) ──────────→ Stagehand
│
├─ Web UI (LLM sees & clicks) ─────→ agent-browser
│
├─ Desktop / OS control ───────────→ Open Interpreter
│
├─ Code editing + terminal ────────→ Claude Code / pi
│
└─ Everything (general agent) ─────→ Open Interpreter
```

---

## Tool Comparison

| Tool | Scope | Best For | Approach |
|------|-------|----------|----------|
| **verify.sh** | CLI smoke tests | CI validation | Deterministic checks |
| **BATS** | CLI tests | Complex assertions | Bash test framework |
| **Bombadil** | Web UI | Finding edge cases | Property-based fuzzing |
| **Stagehand** | Web UI | AI-driven navigation | Natural language + code |
| **agent-browser** | Web UI | LLM browsing | CLI + @ref handles |
| **pi-agent-browser** | Web (in pi) | LLM browses for you | pi extension |
| **Open Interpreter** | Computer | General OS control | Code execution agent |
| **Open Computer Use** | Cloud Linux | Secure sandbox desktop | E2B + any LLM |
| **Piglet** | Windows | Desktop automation | Native Zig driver |
| **Claude Code** | Code + terminal | Dev workflows | Anthropic's CLI agent |
| **pi** | Code + terminal | Dev workflows | Your current agent |

---

## By Use Case

### By Platform

| Platform | Best Tools |
|----------|------------|
| **Linux CLI** | verify.sh, BATS, Open Interpreter |
| **Linux GUI** | Open Computer Use (E2B), Open Interpreter |
| **Web** | Bombadil, Stagehand, agent-browser |
| **Windows** | Piglet, Open Interpreter |
| **macOS** | Open Interpreter, agent-browser (web) |
| **Cross-platform** | Open Interpreter, Stagehand (web) |

### 1. CI/CD Verification (No AI)

**Use**: `verify.sh` + `BATS`

```bash
# Fast, deterministic, no API costs
./verify.sh
bats tests/
```

**Why**: Zero cost, runs in any CI, deterministic output.

---

### 2. Web UI Fuzzing (Find Edge Cases)

**Use**: `Bombadil`

```bash
./bombadil test https://your-app.com --headless
```

**Why**: Autonomously explores, finds bugs you didn't think to test, property-based.

**Not for**: Specific user flows you want to verify exactly.

---

### 3. Web UI Testing (AI Navigates)

**Use**: `Stagehand` or `agent-browser`

```typescript
// Stagehand - natural language actions
await stagehand.act("click the login button");
await stagehand.act("fill email with test@example.com");
```

```bash
# agent-browser - CLI + @refs
agent-browser open https://your-app.com
agent-browser snapshot -i    # Get @e1, @e2, @e3...
agent-browser click @e1
agent-browser fill @e2 "text"
```

**Why**: AI handles dynamic content, no brittle selectors.

**Not for**: Property-based exploration (use Bombadil).

---

### 4. LLM Tests Your Web App (In Agent)

**Use**: `pi-agent-browser` (for pi)

```
You: Test the checkout flow on my e-commerce site

LLM uses browser tool:
  browser open https://shop.example.com
  browser snapshot -i
  browser click @e5    # Add to cart
  browser click @e12   # Checkout
  browser fill @e3 "test@example.com"
  browser screenshot   # Verify visually
```

**Why**: LLM decides what to test, sees the page, reports issues.

**Not for**: CI/CD (expensive, non-deterministic).

---

### 5. General Computer Control

**Use**: `Open Interpreter`

```python
from interpreter import interpreter

interpreter.chat("Open Chrome, go to gmail.com, and check for new emails")
interpreter.chat("Edit the config.yaml file and add a new entry")
interpreter.chat("Run the tests and fix any failures")
```

**Why**: Can do *anything* - browse, code, edit files, run commands.

**Not for**: 
- Production CI (requires approval prompts)
- Deterministic testing
- Cheap/fast testing

---

### 6. Code + Terminal (Development)

**Use**: `pi` or `Claude Code`

```bash
pi                    # Your current agent
claude                # Anthropic's CLI
```

**Why**: Built for coding, understands codebase, edits files safely.

**Not for**: General OS control outside development.

---

## Cost vs Capability Matrix

| Tool | Cost | Speed | Scope | Determinism | Platform |
|------|------|-------|-------|-------------|----------|
| verify.sh | Free | Instant | CLI | 100% | Any |
| BATS | Free | Fast | CLI | 100% | Any |
| Bombadil | Free | Medium | Web | High | Any |
| Stagehand | LLM cost | Medium | Web | Medium | Any |
| agent-browser | Free (browser) | Fast | Web | High | Any |
| pi-agent-browser | LLM cost | Medium | Web | Medium | Any |
| Open Interpreter | LLM cost | Slow | Computer | Low | Any |
| Open Computer Use | E2B + LLM | Slow | Cloud Linux | Low | Cloud |
| Piglet | Free/Paid | Fast | Windows | High | Windows |
| pi / Claude Code | LLM cost | Medium | Code | Medium | Any |

---

## When to Use Each

### Use Bombadil When:
- You want to *discover* bugs, not verify flows
- Property-based testing fits (invariants, guarantees)
- Your app has complex state transitions
- You want autonomous exploration

### Use Stagehand When:
- You want AI to navigate, but with code control
- Natural language actions are easier than selectors
- You need caching for repeated actions
- Building production test suites

### Use agent-browser When:
- You want LLM to browse but don't need AI navigation
- CLI integration with any LLM
- Screenshot + vision verification
- Low cost (no AI in the browser layer)

### Use pi-agent-browser When:
- Using pi and want the LLM to browse
- Visual verification of web apps
- Testing flows interactively

### Use Open Interpreter When:
- Need general computer control
- Multi-step workflows across apps
- Desktop automation
- File manipulation + web + code in one session

### Use Open Computer Use When:
- Need a secure sandbox (can't run on host)
- Testing Linux GUI apps
- Want cloud desktop with any LLM
- Need isolation from your machine

### Use Piglet When:
- Windows desktop automation
- RPA on Windows apps
- Testing Windows software
- Need native Windows control

### Use verify.sh / BATS When:
- CI/CD verification
- Zero budget
- Must be deterministic
- Simple pass/fail checks

---

## Combination Strategies

### Full Coverage Strategy

```
1. verify.sh ────────→ CI smoke test (free, fast)
2. BATS ─────────────→ CI regression (free, structured)
3. Bombadil ─────────→ Nightly fuzzing (free, exploratory)
4. Stagehand ────────→ Critical flows (paid, reliable)
5. Open Interpreter ─→ Ad-hoc exploration (paid, powerful)
```

### Budget Strategy

```
1. verify.sh ────────→ All CI (free)
2. Bombadil ─────────→ Weekly runs (free)
3. agent-browser ────→ Manual testing (free browser, any LLM)
```

---

## New Additions

### Open Computer Use (E2B)

**What**: Secure cloud Linux computer controlled by open-source LLMs.

**Install**:
```bash
git clone https://github.com/e2b-dev/open-computer-use
cd open-computer-use
poetry install
poetry run start
```

**Use**:
```bash
poetry run start --prompt "use the web browser to get the current weather in sf"
```

**Capabilities**:
- Cloud Linux desktop (E2B sandbox)
- Keyboard, mouse, shell control
- Live display streaming
- 10+ LLM support (Llama, DeepSeek, Gemini, GPT-4o, Claude, etc.)
- OS-Atlas/ShowUI for visual grounding

**Tradeoffs**:
| Pro | Con |
|-----|-----|
| Secure sandbox | Requires E2B API key |
| Works with any LLM | Cloud-only (no local) |
| Live display stream | Python-only |
| Multi-LLM support | Complex setup |

**Best for**: Cloud desktop automation, testing Linux GUI apps

---

### Piglet (Pig)

**What**: Windows desktop automation driver with high-level API.

**Install**:
```powershell
# PowerShell
$toolDir = "$env:USERPROFILE\.piglet"
New-Item -ItemType Directory -Force -Path $toolDir
Invoke-WebRequest -Uri "https://github.com/pig-dot-dev/piglet/releases/download/v0.0.7/piglet.exe" -OutFile "$toolDir\piglet.exe"
# Add to PATH...
```

**Use** (Python SDK):
```python
from pig import Client
client = Client()

machine = client.machines.local()
with machine.connect() as conn:
    conn.key("super")           # Press Windows key
    conn.type("hello world!")   # Type text
```

**API**:
```
computer/
├── display/    # Screenshots, dimensions
├── window/     # Element tree (coming)
├── input/      # Keyboard, mouse control
├── fs/         # File operations (coming)
└── shell/      # Commands (coming)
```

**Tradeoffs**:
| Pro | Con |
|-----|-----|
| Native Windows | Windows-only |
| Written in Zig (fast) | Early stage |
| Local or remote | Requires Pig account for remote |
| DOM-like window tree | Limited API so far |

**Best for**: Windows desktop automation, RPA, testing Windows apps

---

### Open Interpreter

**What**: General-purpose computer agent that runs code locally.

**Install**:
```bash
pip install open-interpreter
# or
pipx install open-interpreter
```

**Use**:
```shell
interpreter
> Open Chrome and search for "best pizza near me"
> Create a chart from this CSV file
> Run the tests and summarize failures
```

**Capabilities**:
- Python/JS/Shell execution
- Browser control
- File operations
- Data analysis
- Any code you'd run locally

**Status**: ⚠️ Requires pip (not validated on this system)

**Tradeoffs**:
| Pro | Con |
|-----|-----|
| Can do anything | Requires approval prompts |
| Local execution | AGPL license |
| No limits | Expensive for simple tasks |
| Flexible | Non-deterministic |

**Best for**: General computer control, multi-app workflows, ad-hoc automation

### Claude Code

**What**: Anthropic's CLI agent (like pi).

**Install**:
```bash
npm install -g @anthropic-ai/claude-code
claude
```

**Use**: Similar to pi - code understanding, edits, terminal.

---

## Recommendations

### For Your prompt-vault CLI

```
Best:   verify.sh + BATS (already done ✓)
Maybe:  Open Interpreter for exploratory testing
Skip:   Bombadil, Stagehand (web-only)
```

### For a Web App

```
Best:   verify.sh (smoke) + Bombadil (fuzzing) + Stagehand (flows)
Maybe:  Open Interpreter for complex multi-step tests
Skip:   agent-browser if you use Stagehand
```

### For Desktop/App Testing

```
Linux:   Open Computer Use (cloud) or Open Interpreter (local)
Windows: Piglet (native) or Open Interpreter
macOS:   Open Interpreter
```

### For CI/CD

```
Best:   verify.sh + BATS + shellcheck
Maybe:  Bombadil in nightly builds
Skip:   LLM-based tools (cost, non-determinism)
```

### For Sandbox/Isolation

```
Best:   Open Computer Use (E2B sandbox)
Maybe:  Docker + your own scripts
Skip:   Tools that run on your host
```
