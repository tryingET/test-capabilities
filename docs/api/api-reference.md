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

Inside this repo, build locally with:

```bash
npm install
npm run build
```

For consumer validation, use the packed artifact / tarball flow exercised by `npm run consumer:smoke` rather than assuming a public registry install.

---

## Core exports

```typescript
import {
  // Runtime helpers
  CAPABILITY_MATRIX,
  CLI_OPERATION_REGISTRY,
  CLI_ROUTE_MANIFEST,
  assertSupportedCliCommand,
  createNexus,
  createTestCapabilities,
  executeCliOperation,
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
| Dispatch a shipped CLI verb through the shared operation kernel | `executeCliOperation(route, input)` |
| Inspect the shipped CLI/kernel surface | `CLI_OPERATION_REGISTRY` / `CLI_ROUTE_MANIFEST` |
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

## `executeCliOperation(route, input)`

Dispatch a shipped verb through the same typed kernel the CLI wrapper uses.

```typescript
import { executeCliOperation } from 'test-capabilities';

const output = await executeCliOperation(
  { command: 'test' },
  {
    config: './test-capabilities.yaml',
    target: 'node',
    quick: true,
  },
);

console.log(output.operationId); // 'test'
console.log(output.summary.health);
```

Use this when you want the fail-closed shipped command surface without shelling out to `bin/test-capabilities`.

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
- currently that means `bombadil`, `surf`, and/or `cli-tester`
- `targets.cli` when `cli-tester` is enabled
- `targets.web` when `bombadil` or `surf` is enabled or `quantum.enabled` is true
- a resolvable Surf Go runtime when the supported Surf agent is enabled: `TEST_CAPABILITIES_SURF_GO_BIN`, `TEST_CAPABILITIES_SURF_GO_REPO`, the conventional workspace-local `softwareco/contrib/surf-cli-go` checkout, or `surf-go` on `PATH`
- a Bombadil binary through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built checkout pointed to by `TEST_CAPABILITIES_BOMBADIL_REPO`, the conventional workspace-local `softwareco/contrib/bombadil`, repo-local `external/bombadil`, or `bombadil` on `PATH` when the supported Bombadil agent is enabled

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
console.log(VERSION); // '0.1.0'
```
