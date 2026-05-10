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

## Operation-kernel types

### `CliRoute`

```typescript
type CliRoute =
  | { command: 'test' }
  | { command: 'surf'; action: 'explore' | 'flow' | 'assert' | 'compare' | 'replay' }
  | { command: 'predict' }
  | { command: 'quantum' }
  | { command: 'heal' }
  | { command: 'visualize' }
  | { command: 'report' };
```

### `CliRouteManifestEntry`

```typescript
interface CliRouteManifestEntry {
  command: CliCommand;
  action?: SurfAction;
  status: 'implemented' | 'unsupported';
  operationId?: 'test' | 'surf.explore' | 'quantum' | 'heal';
  description: string;
}
```

### `CliOperationResult`

```typescript
type CliOperationResult =
  | TestOperationResultEnvelope
  | SurfExploreOperationResultEnvelope
  | QuantumOperationResultEnvelope
  | HealOperationResultEnvelope;
```

These shapes back the exported `CLI_OPERATION_REGISTRY`, `CLI_ROUTE_MANIFEST`, and `executeCliOperation(...)` kernel.

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
- `bombadil`, `surf`, and `cli-tester` are currently supported by the fail-closed orchestrator path
- `surf` requires `targets.web` plus a resolvable Surf Go runtime (`TEST_CAPABILITIES_SURF_GO_BIN`, `TEST_CAPABILITIES_SURF_GO_REPO`, workspace `surf-cli-go`, or `surf-go` on `PATH`)
- `bombadil` requires `targets.web` plus a Bombadil binary resolved through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built checkout pointed to by `TEST_CAPABILITIES_BOMBADIL_REPO`, the conventional workspace-local `softwareco/contrib/bombadil`, repo-local `external/bombadil`, or `bombadil` on `PATH`

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

### `TestOperationResultEnvelope`

```typescript
interface TestOperationResultEnvelope {
  operationId: 'test';
  mode: 'quick' | 'standard';
  input: TestOperationInput;
  effectiveConfig: TestCapabilitiesConfig;
  summary: {
    health: 'pass' | 'fail';
    findings: number;
    coverage: CoverageReport;
    predictions: number;
    quantumUniverses?: number;
  };
  result: TestResult;
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
type CoverageDimension = 'userFlows' | 'apiEndpoints' | 'edgeCases';
type CoverageStatus = 'verified' | 'partial' | 'unmeasured';

interface CoverageReport {
  userFlows: number;
  apiEndpoints: number;
  edgeCases: number;
  overall: number;
  measuredDimensions: CoverageDimension[];
  unmeasuredDimensions: CoverageDimension[];
  status: CoverageStatus;
}
```

Runtime note:
- `overall` is computed from the dimensions that were actually measured in the run
- `status: 'partial'` means some dimensions were measured but the coverage summary is still incomplete
- `unmeasuredDimensions` keeps missing denominators explicit instead of silently folding them into the percentage

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

Runtime note:
- the prediction library validates the full numeric shape at runtime
- missing, `NaN`, or non-finite fields fail closed instead of producing synthetic confidence

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

### `QuantumOperationResultEnvelope`

```typescript
interface QuantumOperationResultEnvelope {
  operationId: 'quantum';
  input: {
    target: string;
    branches: string;
    collapse: boolean;
  };
  result: QuantumResult;
}
```

Runtime note:
- `target` is required and must be a valid URL or the kernel fails closed
- `branches` must parse as a positive integer or the kernel fails closed

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
  column?: number;
  oldSelector: string;
  newSelector: string;
  confidence: number;
  strategy: string;
  requiresReview: boolean;
}
```

Runtime note:
- low-confidence healing candidates can surface a `newSelector` from `SelfHealingEngine.heal(...)`
- they are not treated as successful healing unless they cross the verification threshold, and CLI/file-healing paths keep them out of the auto-apply success path

### `HealOperationResultEnvelope`

```typescript
interface HealingProposalVerification {
  status: 'pass' | 'fail';
  proposalCount: number;
  checkedFileCount: number;
  failures: Array<{ file: string; message: string }>;
}

interface HealProposalArtifactRef {
  path: string;
  schemaVersion: 1;
  proposalCount: number;
}

interface HealVerificationArtifactRef {
  path: string;
  schemaVersion: 1;
  status: HealingProposalVerification['status'];
  proposalCount: number;
}

interface HealOperationResultEnvelope {
  operationId: 'heal';
  input: {
    dir: string;
    dryRun: boolean;
    proposalOutput?: string;
    verificationOutput?: string;
    checkpointRef?: string;
  };
  proposals: HealingProposal[];
  appliedCount: number;
  proposalArtifact?: HealProposalArtifactRef;
  verification?: HealingProposalVerification;
  verificationArtifact?: HealVerificationArtifactRef;
  checkpointRef?: string;
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

### `SurfExploreOperationResultEnvelope`

```typescript
interface SurfExploreOperationResultEnvelope {
  operationId: 'surf.explore';
  input: {
    url: string;
    depth?: string;
    record?: boolean;
    validate?: boolean;
    baseline?: string;
    aiDiff?: boolean;
    file?: string;
  };
  result: {
    command: string;
    args: string[];
    runtime?: {
      flavor: 'surf-go';
      provider: string;
      resolutionNotes: string[];
    };
    stdout: string;
    stderr: string;
    code: number;
    evidence: {
      verified: true;
      url: string;
      signal: string;
    };
  };
}
```

Runtime note:
- `url` is required and is the only implemented `surf explore` option today
- the operation navigates with Surf Go and then verifies a browser-state probe containing the target URL before returning `evidence.verified: true`
- `depth`, `record`, `validate`, `baseline`, `aiDiff`, and `file` fail closed when provided to the shipped kernel path
