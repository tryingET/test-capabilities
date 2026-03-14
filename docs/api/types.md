---
summary: "Type reference for the core TypeScript surface of TEST-CAPABILITIES."
read_when:
  - "You need the canonical TypeScript shapes for config, results, and APIs"
  - "You are aligning code with the documented type surface"
type: "reference"
---

# Type Definitions

> Runtime-accurate summary of the exported TypeScript surface.

Where schema support and runtime support differ, this document calls that out explicitly.

---

## Core config types

### `TestCapabilitiesConfig` / `NexusConfig`

```typescript
interface TestCapabilitiesConfig {
  version: '2.0';
  name: string;
  targets: Target;
  agents?: Record<string, AgentConfig>;
  intelligence?: IntelligenceConfig;
  quantum?: QuantumConfig;
  chaos?: ChaosConfig;
}
```

### `Target`

```typescript
interface Target {
  web?: string; // URL
  api?: string; // URL
  cli?: string; // command or path
}
```

### `AgentConfig`

```typescript
interface AgentConfig {
  type: 'bombadil' | 'surf' | 'api-fuzzer' | 'cli-tester';
  enabled?: boolean;
  intensity?: 'gentle' | 'normal' | 'aggressive';
  duration?: string;
  focus?: string[];
}
```

Schema note:
- all four `type` values are valid at parse time

Runtime capability note:
- only `cli-tester` is currently supported by the fail-closed orchestrator path

### `IntelligenceConfig`

```typescript
interface IntelligenceConfig {
  selfHealing?: boolean;
  prediction?: boolean;
  correlation?: boolean;
  collective?: boolean;
}
```

Runtime capability note:
- `correlation` may be enabled
- `selfHealing`, `prediction`, and `collective` must currently remain `false` or omitted for the orchestrator path

### `QuantumConfig`

```typescript
interface QuantumConfig {
  enabled?: boolean;
  branches?: number;
  collapseStrategy?: 'significance' | 'diversity' | 'coverage';
  maxDepth?: number;
  timeout?: number | string;
}
```

Alias support in config parsing:
- `collapse_strategy` → `collapseStrategy`
- `max_depth` → `maxDepth`

### `ChaosConfig`

```typescript
interface ChaosConfig {
  enabled: boolean;
  experiments?: unknown[];
}
```

Runtime capability note:
- chaos must currently stay disabled in the orchestrator path

---

## Result types

### `TestResult`

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

### `Finding`

```typescript
type FindingType =
  | 'bug'
  | 'performance'
  | 'security'
  | 'accessibility'
  | 'ux'
  | 'api_contract'
  | 'race_condition'
  | 'memory_leak'
  | 'visual_regression';

type Severity = 'low' | 'medium' | 'high' | 'critical';

interface Finding {
  id: string;
  type: FindingType;
  severity: Severity;
  component: string;
  description: string;
  evidence: string[];
  recommendation: string;
  timestamp: Date;
}
```

### `CoverageReport`

```typescript
interface CoverageReport {
  userFlows: number;
  apiEndpoints: number;
  edgeCases: number;
  overall: number;
}
```

---

## Prediction types

> The prediction engine is exported as a library surface even though orchestrator prediction is currently fail-closed.

### `PredictionInput`

```typescript
interface PredictionInput {
  errorRate: number;
  responseTimeP95: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  timeSinceDeployment: number;
  hourOfDay: number;
  dayOfWeek: number;
  sessionDepthAvg: number;
  rageClickRate: number;
  abandonmentRate: number;
  bounceRate: number;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  testCoverageDelta: number;
  recentFailures: number;
  avgTimeBetweenFailures: number;
}
```

### `Prediction`

```typescript
interface Prediction {
  component: string;
  probability: number;
  confidence: number;
  trigger: string;
  preventiveAction: string;
  timeHorizon: string;
  relatedMetrics: string[];
  riskScore: number;
}
```

---

## Quantum types

### `QuantumResult`

```typescript
interface QuantumResult {
  branchesSimulated: number;
  uniquePaths: number;
  collapsedFindings: Discovery[];
  edgeCases: Discovery[];
  rareBugs: Discovery[];
  coverage: QuantumCoverage;
  duration: number;
}
```

### `Discovery`

```typescript
interface Discovery {
  type: 'bug' | 'edge_case' | 'rare_path' | 'performance_issue' | 'ux_issue';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  reproduction: QuantumAction[];
  probability: number;
  evidence: string[];
}
```

### `QuantumAction`

```typescript
interface QuantumAction {
  type: 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'custom';
  target: string;
  value?: string;
  timestamp: number;
}
```

---

## Healing types

### `HealingContext`

```typescript
interface HealingContext {
  originalSelector: string;
  action: 'click' | 'fill' | 'assert' | 'hover';
  description?: string;
  screenshot?: Buffer;
  lastKnownGood?: ElementSnapshot;
}
```

### `HealingProposal`

```typescript
interface HealingProposal {
  file: string;
  line: number;
  oldSelector: string;
  newSelector: string;
  confidence: number;
  strategy: string;
  requiresReview: boolean;
}
```

---

## Surf types

### `SurfSnapshot`

```typescript
interface SurfSnapshot {
  url: string;
  title: string;
  elements: SurfElement[];
  raw: string;
}
```

### `NetworkRequest`

```typescript
interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  status: number;
  type: string;
  duration: number;
  request?: unknown;
  response?: unknown;
}
```
