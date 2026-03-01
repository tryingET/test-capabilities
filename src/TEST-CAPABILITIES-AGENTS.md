# AGENTS.md

> **TEST-CAPABILITIES Testing Framework — Agent Entry Point**

---

## What is TEST-CAPABILITIES?

TEST-CAPABILITIES is an autonomous testing framework that:
1. Writes tests automatically
2. Heals broken tests when UI changes
3. Predicts failures before they happen
4. Runs parallel quantum simulations

---

## Quick Decision Tree

```
What does user want?
│
├─ "Test my app" ───────────→ test-capabilities test --target <url>
│
├─ "Quick check" ───────────→ test-capabilities test --quick --target <url>
│
├─ "Fix broken tests" ──────→ test-capabilities heal --dir <path>
│
├─ "Predict failures" ──────→ test-capabilities predict --target <url>
│
├─ "Explore edge cases" ────→ test-capabilities quantum --target <url>
│
├─ "Browser automation" ────→ Read [docs/api-surf.md](docs/api-surf.md)
│
└─ "Full autonomous" ───────→ test-capabilities test --target <url> --autonomous
```

---

## Return Codes

| Code | Meaning |
|------|---------|
| 0 | Success (health >= 70) |
| 1 | Test failures |
| 2 | Configuration error |
| 3 | Connection error |
| 4 | Timeout |

---

## Output Format

```json
{
  "health_score": 94,
  "passed": true,
  "findings": [{ "type": "bug", "severity": "medium", "component": "checkout" }],
  "coverage": { "user_flows": 89 },
  "predictions": [{ "component": "search", "probability": 0.34 }]
}
```

---

## Documentation Map

**Read only what you need:**

| Task | Read This |
|------|-----------|
| CLI commands & options | [docs/cli.md](docs/cli.md) |
| Programmatic API | [docs/api-reference.md](docs/api-reference.md) |
| SurfClient (browser) | [docs/api-surf.md](docs/api-surf.md) |
| Self-healing | [docs/api-healing.md](docs/api-healing.md) |
| Prediction engine | [docs/api-prediction.md](docs/api-prediction.md) |
| Quantum simulation | [docs/api-quantum.md](docs/api-quantum.md) |
| Integration patterns | [docs/patterns.md](docs/patterns.md) |
| Error handling | [docs/errors.md](docs/errors.md) |
| Configuration | [docs/config.md](docs/config.md) |
| Type definitions | [docs/types.md](docs/types.md) |

---

## One-Liner Reference

```bash
test-capabilities test --target <url> [--quick] [--autonomous] [--self-heal] [--predict]
test-capabilities surf <action> [args]
test-capabilities predict --target <url>
test-capabilities quantum --target <url> [--branches N]
test-capabilities heal --dir <path>
```

---

*Version: 2.0.0*
