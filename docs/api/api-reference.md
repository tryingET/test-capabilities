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
  ROOT_CAUSE_FAILURE_CLASSES,
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
  Observation,
  Prediction,
  QuantumResult,
  RootCauseFailureClass,
  VERSION,
} from 'test-capabilities';
```

---

## Quick reference

| What you want | Use this |
|---------------|----------|
| Dispatch a shipped CLI verb through the shared operation kernel | `executeCliOperation(route, input)` |
| Inspect the shipped CLI/kernel surface | `CLI_OPERATION_REGISTRY` / `CLI_ROUTE_MANIFEST` |
| Run zero-external-dependency diagnostics | `executeCliOperation({ command: 'doctor' }, {})` |
| Run the supported orchestrator path | `createNexus(config).run()` |
| Inspect bounded root-cause class vocabulary | `ROOT_CAUSE_FAILURE_CLASSES` / `RootCauseFailureClass` |
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

### Zero-external-dependency doctor

```typescript
const doctor = await executeCliOperation({ command: 'doctor' }, {});

console.log(doctor.status); // 'pass' when required package/runtime checks pass
console.log(doctor.summary.optionalWarnings); // optional Surf/Bombadil runtime warnings
```

`doctor` is the recommended first-run path for public consumers because it does not require Surf Go or Bombadil-compatible external tools.

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
- a resolvable Surf Go runtime when the supported Surf agent is enabled: `TEST_CAPABILITIES_SURF_GO_BIN`, a source checkout referenced by `TEST_CAPABILITIES_SURF_GO_REPO`, or `surf-go` on `PATH`
- a Bombadil binary through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, repo-local `external/bombadil`, or `bombadil` on `PATH` when the supported Bombadil agent is enabled

---

## Result shape

```typescript
interface TestResult {
  passed: boolean;
  duration: number;
  findings: Finding[];
  coverage: CoverageReport;
  observations?: Observation[];
  predictions?: Prediction[];
  quantumInsights?: QuantumInsights;
}
```

When correlation is enabled, `observations` can include diagnostic `root_cause` and `propagation` entries. These are evidence-bounded and non-authoritative: root-cause observations expose the selected bounded class as `semantics.failureClass`, and propagation observations expose the bounded heuristic link as `semantics.propagationLink`.

```typescript
import { ROOT_CAUSE_FAILURE_CLASSES } from 'test-capabilities';
import type { RootCauseFailureClass } from 'test-capabilities';

const knownClass: RootCauseFailureClass = 'command_resolution';
console.log(ROOT_CAUSE_FAILURE_CLASSES.includes(knownClass)); // true
```

---

## Version

```typescript
import { VERSION } from 'test-capabilities';
console.log(VERSION); // '0.1.0'
```
