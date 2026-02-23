# Type Definitions

> Complete TypeScript types.

---

## Core Types

### NexusConfig

```typescript
interface NexusConfig {
  version: '2.0';
  name: string;
  targets: Target;
  agents?: Record<string, AgentConfig>;
  intelligence?: IntelligenceConfig;
  quantum?: QuantumConfig;
  chaos?: ChaosConfig;
  reporting?: ReportingConfig;
  execution?: ExecutionConfig;
}
```

### Target

```typescript
interface Target {
  web?: string;   // URL
  api?: string;   // URL
  cli?: string;   // Path
}
```

### AgentConfig

```typescript
interface AgentConfig {
  type: 'bombadil' | 'surf' | 'api-fuzzer' | 'cli-tester';
  enabled?: boolean;
  intensity?: 'gentle' | 'normal' | 'aggressive';
  duration?: string;
  focus?: string[];
}
```

---

## Result Types

### TestResult

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

### Finding

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

### CoverageReport

```typescript
interface CoverageReport {
  userFlows: number;      // 0-100
  apiEndpoints: number;   // 0-100
  edgeCases: number;      // 0-100
  overall: number;        // 0-100
}
```

---

## Prediction Types

### PredictionInput

```typescript
interface PredictionInput {
  // System metrics
  errorRate: number;        // 0-1
  responseTimeP95: number;  // ms
  cpuUsage: number;         // 0-1
  memoryUsage: number;      // 0-1
  diskUsage: number;        // 0-1

  // Temporal
  timeSinceDeployment: number;  // hours
  hourOfDay: number;            // 0-23
  dayOfWeek: number;            // 0-6

  // User behavior
  sessionDepthAvg: number;
  rageClickRate: number;    // 0-1
  abandonmentRate: number;  // 0-1
  bounceRate: number;       // 0-1

  // Code metrics
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  testCoverageDelta: number;  // -1 to 1

  // Historical
  recentFailures: number;
  avgTimeBetweenFailures: number;  // hours
}
```

### Prediction

```typescript
interface Prediction {
  component: string;
  probability: number;     // 0-1
  confidence: number;      // 0-1
  trigger: string;
  preventiveAction: string;
  timeHorizon: string;
  relatedMetrics: string[];
  riskScore: number;       // 0-1
}
```

---

## Quantum Types

### QuantumConfig

```typescript
interface QuantumConfig {
  branches: number;
  collapseStrategy: 'significance' | 'diversity' | 'coverage';
  maxDepth: number;
  timeout: number;
  seed?: number;
}
```

### QuantumResult

```typescript
interface QuantumResult {
  branchesSimulated: number;
  uniquePaths: number;
  collapsedFindings: Discovery[];
  edgeCases: Discovery[];
  rareBugs: RareBug[];
  coverage: QuantumCoverage;
  duration: number;
}
```

### Discovery

```typescript
interface Discovery {
  type: 'bug' | 'edge_case' | 'rare_path' | 'performance_issue' | 'ux_issue';
  severity: Severity;
  description: string;
  reproduction: QuantumAction[];
  probability: number;
  evidence: string[];
}
```

### QuantumAction

```typescript
interface QuantumAction {
  type: 'click' | 'type' | 'scroll' | 'navigate' | 'wait' | 'custom';
  target: string;
  value?: string;
  timestamp: number;
}
```

### RareBug

```typescript
interface RareBug {
  description: string;
  probability: string;  // e.g., '0.3%'
  impact: 'low' | 'medium' | 'high' | 'critical';
  reproduction?: string;
}
```

---

## Healing Types

### HealingContext

```typescript
interface HealingContext {
  originalSelector: string;
  action: 'click' | 'fill' | 'assert' | 'hover';
  description?: string;
  screenshot?: Buffer;
  lastKnownGood?: ElementSnapshot;
}
```

### HealingResult

```typescript
interface HealingResult {
  success: boolean;
  newSelector?: string;
  confidence: number;  // 0-1
  strategy: string;
  metadata?: Record<string, unknown>;
}
```

### ElementSnapshot

```typescript
interface ElementSnapshot {
  selector: string;
  role?: string;
  text?: string;
  label?: string;
  ariaLabel?: string;
  position?: { x: number; y: number };
  attributes: Record<string, string>;
}
```

### HealingProposal

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

## Surf Types

### SurfElement

```typescript
interface SurfElement {
  ref: string;       // e.g., 'e5'
  role?: string;
  name?: string;
  text?: string;
  level?: number;
  selector?: string;
}
```

### SurfSnapshot

```typescript
interface SurfSnapshot {
  url: string;
  title: string;
  elements: SurfElement[];
  raw: string;
}
```

### NetworkRequest

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

---

## Utility Types

### IntelligenceConfig

```typescript
interface IntelligenceConfig {
  selfHealing?: boolean;
  prediction?: boolean;
  correlation?: boolean;
  collective?: boolean;
}
```

### ChaosConfig

```typescript
interface ChaosConfig {
  enabled: boolean;
  experiments: Record<string, number[]>;
}
```

### ReportingConfig

```typescript
interface ReportingConfig {
  formats: ('json' | 'html' | 'markdown')[];
  output: string;
  includeArtifacts: string[];
  upload?: {
    enabled: boolean;
    destination: string;
    retention: string;
  };
}
```

### ExecutionConfig

```typescript
interface ExecutionConfig {
  parallel: boolean;
  maxWorkers: number;
  timeoutPerTest: string;
  retryCount: number;
  failFast: boolean;
}
```
