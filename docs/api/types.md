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
  propagationTopology?: PropagationTopology;
}

interface PropagationTopology {
  edges?: PropagationEdge[];
  includeDefaults?: boolean;
}

interface PropagationEdge {
  upstream: string;
  downstream: string;
}
```

Runtime capability note:
- `correlation` may be enabled
- `propagationTopology.includeDefaults` controls whether default edges (`api -> web`, `cli -> api`, `cli -> web`) are included
- `propagationTopology.edges[]` can add custom dependency edges with non-empty, distinct `upstream` and `downstream` component names; self-edges are rejected
- propagation topology only enables low-calibration non-authoritative `propagation` observations after both dependent components already have high-calibration `root_cause` observations and a bounded propagation-link heuristic matches
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
  observations?: Observation[];
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

### `Observation`

```typescript
type ObservationProtocol = 'observation.v1';
type ObservationKind =
  | 'runtime'
  | 'coverage'
  | 'property'
  | 'smoke'
  | 'correlation'
  | 'synthesis'
  | 'root_cause'
  | 'propagation';
type ObservationStatus = 'passed' | 'failed' | 'skipped' | 'errored';
type ObservationCalibrationLevel = 'low' | 'medium' | 'high';

interface ObservationCalibration {
  level: ObservationCalibrationLevel;
  signalCount: number;
  sensorCount: number;
  findingCount: number;
  basis: string[];
}

interface ObservationSemantics {
  component: string;
  interpretation: string;
  nextStep?: string;
  calibration?: ObservationCalibration;
}

interface Observation {
  protocol: ObservationProtocol;
  id: string;
  agent: string;
  kind: ObservationKind;
  status: ObservationStatus;
  subject: string;
  summary: string;
  evidence: string[];
  coverage?: Partial<CoverageReport>;
  semantics?: ObservationSemantics;
  findingIds: string[];
  timestamp: Date;
}
```

Runtime note:
- observations are diagnostic sensor events, not pass/fail authority
- `observations` is optional in the public type for compatibility with historical `TestResult` objects; orchestrator runs populate it
- findings still drive blocking severity and correlation; observations explain what each supported sensor actually measured
- known orchestrator agents emit observations for Surf coverage, Bombadil property exploration, and CLI smoke execution
- when `intelligence.correlation` is not `false`, the orchestrator can add non-authoritative synthesis/correlation observations that summarize component and suite-level sensor meaning without changing pass/fail semantics
- when same-component evidence has at least two independent failed-or-errored observed current-run evidence units from at least two sensors that agree on the same failure class, the orchestrator can also emit `root_cause` observations with deterministic calibration metadata; derived observations do not count separately from their source findings, and the result identifies an evidence-bounded current failure class, not a forecast or probability claim
- when dependent components both have high-calibration `root_cause` observations and a bounded propagation-link heuristic matches the configured topology, the orchestrator can emit low-calibration `propagation` observations; these declare non-authoritative heuristic status, expose calibration metadata, report `sensorCount` as the sum of the two linked root-cause sensor counts, and must not be treated as causal proof

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
      coverageScore: number;
      probesVerified: number;
      probesRequired: number;
    };
    coverage: {
      userFlows: number;
      status: 'verified' | 'partial';
      requestedDepth: number;
      reachedDepth: number;
      pagesDiscovered: number;
      pagesVisited: number;
      pagesVerified: number;
      probesRequired: number;
      probesVerified: number;
    };
    pages: Array<{
      url: string;
      depth: number;
      verified: boolean;
      probes: Array<{
        kind: 'state' | 'dom' | 'links';
        url: string;
        depth: number;
        verified: boolean;
        signal?: string;
        error?: string;
      }>;
      discoveredUrls: string[];
    }>;
  };
}
```

Runtime note:
- `url` is required; `depth` is implemented as a bounded integer from `1` to `3`
- the operation navigates with Surf Go, verifies explicit browser-state and DOM probes, and uses a links probe for same-origin depth expansion
- `coverage.userFlows` is a graded score from verified probes over required probes; unsupported or failed deeper pages reduce the score instead of becoming fake 100% coverage
- `record`, `validate`, `baseline`, `aiDiff`, and `file` fail closed when provided to the shipped kernel path
