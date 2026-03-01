# TEST-CAPABILITIES

> **The testing framework that tests itself.**

---

## What is this?

TEST-CAPABILITIES is an autonomous testing framework. It writes tests, heals them when they break, and predicts failures before they happen.

```bash
test-capabilities test --target https://your-app.com
```

---

## Quick Start

```bash
# Install
npm install -g @test-capabilities/framework

# Run
test-capabilities test --target https://your-app.com
```

Returns: health score, bugs found, coverage report, failure predictions.

---

## Why TEST-CAPABILITIES?

| Before | After |
|--------|-------|
| Write tests manually | Tests write themselves |
| Tests break on UI changes | Tests heal themselves |
| Find bugs after shipping | Predict bugs before they ship |
| 5 different tools | 1 unified framework |

---

## Documentation

| What you want | Where to go |
|---------------|-------------|
| **Get started** | [docs/getting-started.md](docs/getting-started.md) |
| **See examples** | [docs/examples.md](docs/examples.md) |
| **Use the API** | [docs/api-reference.md](docs/api-reference.md) |
| **Go deep** | [docs/advanced.md](docs/advanced.md) |
| **I'm an AI agent** | [AGENTS.md](AGENTS.md) |

---

## Commands

```bash
test-capabilities test          # Run full test suite
test-capabilities test --quick  # Fast sanity check
test-capabilities surf          # Browser testing
test-capabilities predict       # ML failure prediction
test-capabilities quantum       # Parallel universe simulation
test-capabilities heal          # Fix broken tests
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                 TEST-CAPABILITIES CORE                   │
│                                             │
│   ┌────────┐ ┌────────┐ ┌────────┐        │
│   │ SURF   │ │BOMBADIL│ │  API   │        │
│   │Browser │ │Fuzzing │ │Fuzzer  │        │
│   └───┬────┘ └───┬────┘ └───┬────┘        │
│       └──────────┼──────────┘              │
│                  ▼                          │
│       ┌───────────────────┐                │
│       │ INTELLIGENCE LAYER│                │
│       │ • Self-Healing    │                │
│       │ • Prediction      │                │
│       │ • Correlation     │                │
│       └───────────────────┘                │
└─────────────────────────────────────────────┘
```

---

## License

MIT

---

> *The best test is the one that writes itself.*
