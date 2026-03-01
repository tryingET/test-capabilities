# API Reference

> Programmatic access to TEST-CAPABILITIES.

---

## Installation

```bash
npm install @test-capabilities/testing-framework
```

---

## Core Exports

```typescript
import {
  // Core
  createNexus,
  NexusOrchestrator,
  
  // Browser
  SurfClient,
  SurfFlowBuilder,
  
  // Self-healing
  SelfHealingEngine,
  TestFileHealer,
  
  // Prediction
  PredictionEngine,
  GradientBoostingPredictor,
  
  // Quantum
  QuantumSimulator,
  QuantumTestRunner,
  
  // Types
  NexusConfig,
  TestResult,
  Finding,
  Prediction,
  QuantumResult,
} from '@test-capabilities/testing-framework';
```

---

## Quick Reference

| What you want | Use this |
|---------------|----------|
| Run full suite | `createNexus(config).run()` |
| Browser control | `new SurfClient()` |
| Build flows | `new SurfFlowBuilder(client)` |
| Fix broken tests | `new SelfHealingEngine().heal(ctx)` |
| Predict failures | `new PredictionEngine().analyze(metrics)` |
| Quantum simulation | `new QuantumTestRunner().run(url)` |

---

## Detailed API Docs

- **[SurfClient](api-surf.md)** - Browser automation
- **[Self-Healing](api-healing.md)** - Auto-fix broken tests
- **[Prediction](api-prediction.md)** - ML failure prediction
- **[Quantum](api-quantum.md)** - Parallel universe simulation
- **[Types](types.md)** - Full type definitions

---

## createNexus(config)

Create an orchestrator instance.

```typescript
import { createNexus } from '@test-capabilities/testing-framework';

const test-capabilities = createNexus({
  version: '2.0',
  name: 'My App',
  targets: {
    web: 'https://myapp.com',
  },
});

const result = await test-capabilities.run();
```

### Config

```typescript
interface NexusConfig {
  version: '2.0';
  name: string;
  targets: {
    web?: string;
    api?: string;
    cli?: string;
  };
  agents?: Record<string, AgentConfig>;
  intelligence?: {
    selfHealing?: boolean;
    prediction?: boolean;
    correlation?: boolean;
  };
  quantum?: {
    enabled?: boolean;
    branches?: number;
  };
}
```

### Result

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
import { VERSION } from '@test-capabilities/testing-framework';
console.log(VERSION); // '2.0.0'
```
