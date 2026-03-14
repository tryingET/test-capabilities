---
summary: "Entry index for the programmatic TEST-CAPABILITIES API surface."
read_when:
  - "You need the top-level API exports and doc map"
  - "You are looking for the right API subdocument to read next"
type: "reference"
---

# API Reference

> Programmatic access to TEST-CAPABILITIES.

The package exports a broader **library surface** than the currently supported fail-closed CLI wrapper. This document focuses on the exported TypeScript API.

---

## Installation

```bash
npm install test-capabilities
```

---

## Core exports

```typescript
import {
  // Runtime helpers
  CAPABILITY_MATRIX,
  assertSupportedCliCommand,
  createNexus,
  createTestCapabilities,
  validateCapabilityContract,

  // Orchestrator
  NexusOrchestrator,
  TestCapabilitiesOrchestrator,

  // Browser
  SurfClient,
  SurfFlowBuilder,

  // Self-healing
  SelfHealingEngine,
  TestFileHealer,

  // Prediction
  PredictionEngine,
  GradientBoostingPredictor,
  PredictionCollector,

  // Quantum
  QuantumSimulator,
  QuantumTestRunner,

  // Types
  NexusConfig,
  TestResult,
  Finding,
  Prediction,
  QuantumResult,
  VERSION,
} from 'test-capabilities';
```

---

## Quick reference

| What you want | Use this |
|---------------|----------|
| Run the supported orchestrator path | `createNexus(config).run()` |
| Validate a config against the capability contract | `validateCapabilityContract(config)` |
| Browser control | `new SurfClient()` |
| Build flows | `new SurfFlowBuilder(client)` |
| Fix broken tests | `new SelfHealingEngine().heal(ctx)` |
| Predict failures as a library API | `new PredictionEngine().analyze(metrics)` |
| Run quantum simulation | `new QuantumTestRunner().run(url)` |

---

## Detailed API docs

- **[SurfClient](api-surf.md)** - Browser automation
- **[Self-Healing](api-healing.md)** - Auto-fix broken tests
- **[Prediction](api-prediction.md)** - Prediction library APIs
- **[Quantum](api-quantum.md)** - Parallel universe simulation
- **[Types](types.md)** - Full type definitions

---

## `createNexus(config)` / `createTestCapabilities(config)`

Create an orchestrator instance.

```typescript
import { createNexus } from 'test-capabilities';

const suite = createNexus({
  version: '2.0',
  name: 'CLI Smoke',
  targets: {
    cli: 'node',
  },
  agents: {
    cli: {
      enabled: true,
      type: 'cli-tester',
      intensity: 'normal',
    },
  },
  intelligence: {
    selfHealing: false,
    prediction: false,
    correlation: true,
    collective: false,
  },
  quantum: {
    enabled: false,
  },
  chaos: {
    enabled: false,
  },
});

const result = await suite.run();
```

### Important runtime note

The orchestrator is fail-closed.
For the current supported orchestrator path, you must configure:
- at least one enabled supported agent
- currently that means `cli-tester`
- `targets.cli` when `cli-tester` is enabled
- `targets.web` if `quantum.enabled` is true

---

## Result shape

```typescript
interface TestResult {
  passed: boolean;
  duration: number;
  findings: Finding[];
  coverage: CoverageReport;
  predictions?: Prediction[];
  quantumInsights?: QuantumInsights;
}
```

---

## Version

```typescript
import { VERSION } from 'test-capabilities';
console.log(VERSION); // '2.0.0'
```
