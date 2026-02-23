# Getting Started

> From zero to autonomous testing in 5 minutes.

---

## Prerequisites

- Node.js 18+
- Chrome/Chromium (for browser testing)

---

## Installation

```bash
# Core framework
npm install -g @nexus/testing-framework

# Surf-CLI integration (recommended for browser testing)
npm install -g surf-cli
surf install <extension-id>  # After loading extension in Chrome

# Bombadil for fuzzing (optional)
curl -sL https://github.com/antithesishq/bombadil/releases/latest/download/bombadil -o bombadil
chmod +x bombadil
```

---

## Your First Test

```bash
# Quick sanity check
nexus test --quick --target https://your-app.com

# Full autonomous test
nexus test --target https://your-app.com --autonomous
```

Output:

```
🚀 NEXUS v2.0.0

Testing: https://your-app.com

✓ Explorer: 34 actions, 0 violations
✓ Navigator: 3 flows passed
✓ Coverage: 89%

Health Score: 94

📊 Report saved to ./reports/2026-02-22/
```

---

## Configuration

Create `nexus.yaml`:

```yaml
version: '2.0'
name: 'My App'

targets:
  web: 'https://myapp.com'

agents:
  explorer:
    type: bombadil
    intensity: aggressive
    
  navigator:
    type: surf
    ai_validation: true

intelligence:
  self_healing: true
  prediction: true
```

Run with config:

```bash
nexus test --config nexus.yaml
```

---

## Next Steps

- [Examples](examples.md) - Common use cases
- [CLI Reference](cli.md) - All commands and options
- [API Reference](api-reference.md) - Programmatic usage
