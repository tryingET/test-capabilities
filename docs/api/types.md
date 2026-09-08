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
  | { command: 'doctor' }
  | { command: 'demo' }
  | { command: 'init' }
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
  operationId?: 'test' | 'doctor' | 'demo' | 'init' | 'surf.explore' | 'quantum' | 'heal';
  description: string;
}
```

### `CliOperationResult`

```typescript
type CliOperationResult =
  | TestOperationResultEnvelope
  | DoctorOperationResultEnvelope
  | DemoOperationResultEnvelope
  | InitOperationResultEnvelope
  | SurfExploreOperationResultEnvelope
  | QuantumOperationResultEnvelope
  | HealOperationResultEnvelope;
```

These shapes back the exported `CLI_OPERATION_REGISTRY`, `CLI_ROUTE_MANIFEST`, and `executeCliOperation(...)` kernel.

Every member also carries the run fields the kernel stamps on it (additive, optional so older
envelopes stay valid):

```typescript
interface OperationEffectEnvelope {
  runId?: string;                            // the run; a nested operation shares its parent's
  effect?: EffectDeclaration;                // this operation's class, with the reason rendered
  mutations?: MutationReceiptEnvelopeCopy[]; // the run's receipts, redacted
}
```

### `EffectDeclaration`

```typescript
type EffectClass = "read_only" | "mutating";
type MutationScope = "target" | "workspace" | "browser_session";

interface EffectDeclaration {
  effect: EffectClass;
  scope?: MutationScope; // required when mutating; browser_session is also legal read-only
  reason: string;        // one line, rendered in every receipt and refusal
}
```

Every operation declares one, as a value or as a function of its input (`heal --dry-run` reads,
`heal --proposal-input` writes). There is no default class: an operation that resolves to
neither is refused with `effect_unclassified` before its input is executed. `test` resolves to
the worst class of the agents it enables.

### `MutationReceipt`

One receipt per mutating step, written to `receipts.dir` **before** the step acts and rewritten
atomically after it (`artifact_kind: "test-capabilities.mutation.receipt"`, `schema_version: 1`):

```typescript
interface MutationReceipt {
  schema_version: 1;
  artifact_kind: "test-capabilities.mutation.receipt";
  receipt_id: string;
  run_id: string;
  operation_id: string;
  step_id: string;
  effect: "mutating";
  scope: MutationScope;
  subject: string;             // a file path, a URL, a command display
  intent: string;
  idempotency_key: string;     // sha256(operation | step | subject | intent) by default
  attempt: 1;
  started_at: string;
  finished_at?: string;
  precondition?: string;       // workspace only: the sha256 the write expected to find
  outcome: "attempting" | "applied" | "failed" | "unknown";
  verified_by?: "post_read";
  evidence: string[];
  error?: { code: string; message: string };
  checkpoint_ref?: string;
  compensation_of?: string;    // a restore of a sibling file, never after `unknown`
  supersedes?: string;         // set by --supersede-receipt
  ephemeral_store?: boolean;   // the store was declared ephemeral (receipts.ephemeral)
  details?: Record<string, unknown>;
}
```

`attempting` and `unknown` are *in doubt*: while a receipt for a key is in either state, the
next run of that step is refused with `mutation_replay_refused` naming the receipt and the exact
`--supersede-receipt <id>` line. `applied` and `failed` are definite and do not block. The
envelope copies (`mutations[]`, `TestResult.mutations`) carry hashes, codes, refs and counts
only, plus the `path` of the file on disk; the file itself may carry values.

### `DoctorOperationResultEnvelope`

```typescript
interface DoctorCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  required: boolean;
  detail: string;
}

interface DoctorOperationResultEnvelope {
  operationId: 'doctor';
  input: { json: boolean; config?: string; target?: string };
  packageRoot: string;
  status: 'pass' | 'fail';
  summary: {
    requiredPassed: number;
    requiredFailed: number;
    optionalWarnings: number;
  };
  checks: DoctorCheck[];
}
```

Runtime note:
- `doctor` is the zero-external-dependency diagnostic happy path; missing surf CLI or Bombadil-compatible runtimes produce optional warnings, not failure; the `external.surf` check carries a `data` object with the surf version, mechanisms, and `surf doctor` summary
- required checks cover Node version, package metadata/version, license/readme, built runtime entrypoint, CLI entrypoint, sample config presence, config shape, and optional `--target` CLI executable or URL validation
- `target` executability is checked by resolving the executable without running the target command

### `DemoOperationResultEnvelope`

```typescript
interface CoreUseCaseGuide {
  id: 'cli-smoke-observation';
  title: string;
  purpose: string;
  proves: string[];
  commands: string[];
  nextSteps: string[];
}

interface DemoOperationResultEnvelope {
  operationId: 'demo';
  input: { json: boolean };
  packageRoot: string;
  demo: {
    name: string;
    cliFixture: string;
    configFixture: string;
  };
  coreUseCase: CoreUseCaseGuide;
  effectiveConfig: TestCapabilitiesConfig;
  summary: TestOperationSummary;
  result: TestResult;
}
```

Runtime note:
- `demo` is the zero-external-dependency functional happy path; it runs `examples/demo/cli-demo.mjs` through the same `cli-tester` orchestrator path real CLI targets use
- `coreUseCase` names the polished release identity: CLI smoke plus `observation.v1` diagnostics, with concrete follow-up commands for replacing the demo target with a real CLI
- `demo --json` returns the full operation envelope for agents and CI probes

### `InitOperationResultEnvelope`

```typescript
interface InitOperationResultEnvelope {
  operationId: 'init';
  input: {
    output: string;
    target: string;
    force: boolean;
    print: boolean;
    json: boolean;
  };
  template: 'cli-smoke';
  outputPath: string;
  written: boolean;
  configText: string;
  nextCommands: string[];
}
```

Runtime note:
- `init` generates a minimal valid `test-capabilities.yaml` for the zero-external-dependency `cli-tester` path
- the generated config enables only `cli-tester`, disables unsupported autonomy/intelligence modes, and validates against the same config schema used by `test`
- writes refuse to overwrite existing files unless `force` / `--force` is set; `print` / `--print` emits YAML without writing

---

## Core config types

### `TestCapabilitiesConfig`

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
  type: 'bombadil' | 'surf' | 'api-fuzzer' | 'cli-tester' | 'terminal-fuzzer';
  enabled?: boolean;
  intensity?: 'gentle' | 'normal' | 'aggressive';
  duration?: string;
  focus?: string[];
  bombadil?: BombadilOptions;
  terminal?: BombadilTerminalOptions;
}

interface BombadilTerminalOptions {
  command?: string;
  args?: string[];
}

interface BombadilOptions {
  command?: 'test' | 'test-external';
  outputPath?: string;
  headers?: Record<string, string>;
  reproduceTrace?: string;
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  instrumentJavaScript?: Array<'files' | 'inline'>;
  chromeGrantPermissions?: string[];
  headless?: boolean;
  noSandbox?: boolean;
  remoteDebugger?: string;
  createTarget?: boolean;
}
```

Schema note:
- all four `type` values are valid at parse time

Runtime capability note:
- `bombadil`, `surf`, and `cli-tester` are currently supported by the fail-closed orchestrator path
- `surf` requires `targets.web` plus a resolvable surf CLI (`TEST_CAPABILITIES_SURF_BIN`, `surf` on `PATH`, or `~/.local/bin/surf`) with the `wait.ready`/`extract` mechanisms
- `bombadil` requires `targets.web` plus a Bombadil binary resolved through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, repo-local `external/bombadil`, or `bombadil` on `PATH`
- Bombadil 0.5 runtime options are exposed through `bombadil`: request `headers`, `outputPath`, `reproduceTrace`, viewport/instrumentation/permission knobs, and `test-external` debugger settings.
- Experimental Bombadil terminal fuzzing is exposed through the `terminal-fuzzer` agent and `terminal` options; it runs `bombadil terminal test -- <command> [args...]` and emits bounded `observation.v1` runtime evidence whose subject is the resolved terminal command, without production-autonomy claims.

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
  passed: boolean;              // determination.value === "verified" and nothing else
  determination: Determination; // the run verdict with its basis (D3)
  outcomes: ResultOutcome[];    // every step the run classified, in agent order
  duration: number;
  findings: Finding[];
  coverage: CoverageReport;
  observations?: Observation[];
  mutations?: MutationReceiptEnvelopeCopy[]; // absent when the run mutated nothing
  predictions?: Prediction[];
  quantumInsights?: QuantumInsights;
}
```

### `TestOperationResultEnvelope`

`test-capabilities test --json` prints this full envelope without the banner or spinner output, so agents and CI can consume the same structured result that the operation kernel returns.

```typescript
interface TestOperationResultEnvelope {
  operationId: 'test';
  mode: 'quick' | 'standard';
  input: TestOperationInput & { config: string; quick: boolean; json: boolean };
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
const ROOT_CAUSE_FAILURE_CLASSES = [
  'auth_or_permission',
  'browser_coverage_gap',
  'command_resolution',
  'component_failure_surface',
  'configuration_error',
  'contract_mismatch',
  'network_connectivity',
  'property_violation',
  'resource_exhaustion',
  'selector_or_dom_drift',
  'timeout_or_latency',
] as const;
type RootCauseFailureClass = (typeof ROOT_CAUSE_FAILURE_CLASSES)[number];

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
  failureClass?: RootCauseFailureClass;
  propagationLink?: string;
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
- known orchestrator agents emit observations for Surf coverage, Bombadil property exploration, terminal-fuzzer runtime execution, and CLI smoke execution
- when `intelligence.correlation` is not `false`, the orchestrator can add non-authoritative synthesis/correlation observations that summarize component and suite-level sensor meaning without changing pass/fail semantics
- when same-component evidence has at least two independent failed-or-errored observed current-run evidence units from at least two sensors that agree on the same failure class, the orchestrator can also emit `root_cause` observations with deterministic calibration metadata; derived observations do not count separately from their source findings, and the result identifies an evidence-bounded current failure class, not a forecast or probability claim
- root-cause failure classes are emitted as `semantics.failureClass` and retained in evidence as `failureClass:<class>` for backward-compatible text inspection; the class vocabulary is exposed as the typed `RootCauseFailureClass` plus runtime `ROOT_CAUSE_FAILURE_CLASSES`; the current bounded vocabulary includes `auth_or_permission`, `browser_coverage_gap`, `command_resolution`, `component_failure_surface`, `configuration_error`, `contract_mismatch`, `network_connectivity`, `property_violation`, `resource_exhaustion`, `selector_or_dom_drift`, and `timeout_or_latency`; finding recommendations are not treated as classifying evidence; precedence is evidence-scoped so API contract evidence wins over incidental auth/network/timeout-like wording, CLI executable-resolution evidence wins over config-like executable names, and real config-file/value evidence remains `configuration_error`
- when dependent components both have high-calibration `root_cause` observations and a bounded propagation-link heuristic matches the configured topology, the orchestrator can emit low-calibration `propagation` observations; these declare non-authoritative heuristic status, expose calibration metadata plus `semantics.propagationLink`, report `sensorCount` as the sum of the two linked root-cause sensor counts, and must not be treated as causal proof

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
    proposalInput?: string;
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
    json?: boolean;
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
      flavor: 'surf';
      provider: 'explicit_bin' | 'path_surf' | 'home_local_bin';
      resolutionNotes: string[];
      version?: string;
      mechanisms?: Record<string, boolean>;
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
      tabId?: number;
      verified: boolean;
      readiness?: {
        state: 'ready' | 'empty' | 'loading' | 'login' | 'challenge' | 'not-found' | 'error' | 'unknown';
        code?: string;      // page_login, page_challenge, page_not_found, page_error, page_timeout
        message?: string;
        href?: string;
        title?: string;
        readyState?: string;
        polls?: number;
        waited?: number;
        evidence: string[];
      };
      probes: Array<{
        kind: 'state' | 'dom' | 'links';
        url: string;
        depth: number;
        verified: boolean;
        signal?: string;
        error?: string;
        code?: string;      // surf error code when the probe failed
      }>;
      discoveredUrls: string[];
      links?: { rowCount: number; attempts: number };
    }>;
  };
}
```

Runtime note:
- `url` is required; `depth` is implemented as a bounded integer from `1` to `3`
- the operation opens an owned surf tab, gates it with `wait.ready` typed states, verifies explicit browser-state and DOM `js` probes, uses `extract` (zero rows accepted explicitly) for same-origin depth expansion, and closes the tab
- `coverage.userFlows` is a graded score from verified probes over required probes; unsupported or failed deeper pages reduce the score instead of becoming fake 100% coverage
- `record`, `validate`, `baseline`, `aiDiff`, and `file` fail closed when provided to the shipped kernel path

---

## Kernel boundary and result types

These are the kernel objects slice S3 introduced: one boundary (`Adapter.invoke`), one transport
behind it (`spawn-step.ts`), one classifier and one error carrier. `RawResult`, `ResultOutcome`,
`ExpectDeclaration` and `FrameworkError` are in the pure ring: they import neither `node:fs` nor
`node:child_process`, so a verdict is a replayable function of recorded fields.

### `RawResult`

What every transport answers with, before any judgement.

```typescript
interface RawResult {
  source: 'cli' | 'surf' | 'http' | 'bombadil';
  exitCode: number | null;      // null when killed by a signal or never started
  signal?: string | null;
  stdout: string;
  stderr: string;               // diagnostics; never payload
  durationMs?: number;
  timedOut?: boolean;           // the framework's own budget killed the step
  spawnFailure?: string;        // the transport never produced a result
  httpStatus?: number;
  httpMethod?: string;          // so HEAD can declare its own emptiness
  body?: string;
  trace?: { path?: string; bytes?: number };   // Bombadil's typed run evidence
  effect?: 'read_only' | 'mutating';           // a mutating transport failure is indeterminate
}
```

### `ResultOutcome`

```typescript
type OutcomeClass =
  | 'success' | 'declared_empty' | 'empty' | 'error' | 'timeout' | 'spawn_failed' | 'unclassifiable';
type OutcomeBasis = 'evidence' | 'fault' | 'no_evidence' | 'contradiction' | 'indeterminate';

interface ResultOutcome {
  class: OutcomeClass;
  ok: boolean;                  // true only for 'success' and 'declared_empty'
  basis: OutcomeBasis;
  code: string;                 // 'ok' | 'declared_empty' | 'empty_result' | 'exit_<n>' |
                                // 'signal_<NAME>' | 'timeout' | 'spawn_failed' | 'invalid_output' |
                                // 'unclassifiable' | 'row_error' | a surf code | 'http_<status>'
  source: 'cli' | 'surf' | 'http' | 'bombadil';
  transport: {
    exitCode: number | null;
    signal?: string;
    httpStatus?: number;
    durationMs?: number;
    stderr: string;                        // whole channel, trimmed and capped
    bookkeeping: Record<string, unknown>;  // surf only; every stripped key lands here
    contradictions: string[];              // e.g. 'exit 0 with error object'
  };
  payload: { kind: 'stdout' | 'json' | 'rows' | 'body' | 'trace'; bytes: number; rowCount?: number; empty: boolean };
  emptiness?: { declared: boolean; declaredBy: string; marker?: string; markerMatched?: boolean };
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    origin: 'json_error_object' | 'stderr_code_line' | 'exit_code' | 'payload_error_field' | 'http_status';
  };
  recorded: string[];           // signals seen under no contract: 'stderr_error_line',
                                // 'payload_error_key_present', 'tester_verdict_overruled'
  evidence: string[];           // first line 'outcome:<class>:<code>', second 'basis:<basis>'
}
```

### `Determination`

The run verdict, next to `passed` (adjudication claim 7, operator decision D3). `passed` is
`determination.value === "verified"` and nothing else, so the third state - a run that produced
no evidence either way - reaches the top level instead of being folded into `false`. Exit codes
stay 0/1: `unverified` and `indeterminate` map to 1.

```typescript
type DeterminationValue = 'verified' | 'failed' | 'unverified' | 'indeterminate';

interface Determination {
  value: DeterminationValue;
  basis: OutcomeBasis;            // the axis the value rests on
  candidates: DeterminationValue[];  // the values the evidence could still support, worst first
  reason: string;                 // the classified steps, blocking findings, coverage, declarations
}

determineRun(outcomes: ResultOutcome[], context?: {
  expectations?: ExpectDeclaration[];
  blockingFindings?: number;      // high/critical findings whose basis is `fault` or absent
  coverage?: number;              // coverage.overall
}): Determination
```

| Value | Reached when | Meaning |
|-------|--------------|---------|
| `failed` | any step basis `fault`, or a blocking finding | the run obtained evidence of a fault |
| `indeterminate` | any step basis `indeterminate` | a step that may have changed the target never reported an outcome |
| `unverified` | any step basis `no_evidence` or `contradiction`, or no measured coverage | the run obtained no evidence either way; not a claim about the target |
| `verified` | at least one step basis `evidence`, nothing blocking, coverage above zero | the run obtained evidence that the target works |

Precedence is `failed` > `indeterminate` > `unverified` > `verified`: a proven fault is evidence,
and folding it into "nothing is known" would delete a fact rather than claim less. A finding
whose outcome basis is not `fault` never counts as blocking, so an undeclared empty payload is
`unverified` and never renders as a target failure.

`TestResult` gains `determination` and `outcomes` (every classified step, in agent order), and
`TestOperationSummary` gains `determination` plus the `outcomes` and `bases` counts with every
key of the closed sets present.

### `ExpectDeclaration`

The declaration that makes an empty payload acceptable. The keys are the config keys of
`agents.<name>.expect`, so a declaration travels from the config file to the classifier without a
hand-written mirror; `declaredBy` records where it came from (`config:agents.<name>.expect`,
`operation:surf.explore.links`, `protocol:http_204`, `author:<tester>`).

```typescript
interface ExpectDeclaration {
  output?: 'required' | 'empty';
  empty_marker?: string;
  payload?: 'opaque' | 'json';
  error_envelope?: boolean;
  declaredBy: string;
}
```

Runtime note: the `expect` block is not yet read from the config schema; operations and adapters
pass declarations in code, and slice S4 adds `AgentConfigSchema.expect`.

### `Adapter`

Every sensor is one of these, and `invokeAdapter` is the only composition of its members.

```typescript
interface Adapter<TResolution, TProbe> {
  readonly id: 'cli' | 'surf' | 'http' | 'bombadil' | 'agent-browser';
  resolve(env?: NodeJS.ProcessEnv): TResolution;
  probe(resolution: TResolution): TProbe;
  translate(step: AdapterStep, resolution: TResolution): AdapterInvocation;
  effects(step: AdapterStep): AdapterEffect;
  invoke(invocation: AdapterInvocation, context?: AdapterContext): Promise<RawResult>;
  normalize(raw: RawResult, declaration?: ExpectDeclaration): ResultOutcome;
}

interface AdapterEffect {
  effect: 'read_only' | 'mutating' | 'unclassified';
  scope?: 'target' | 'workspace' | 'browser_session';
  reason: string;               // one line; it is rendered in receipts and refusals
}
```

Runtime note: `effects` is a declaration today; slice S5 adds the ledger that enforces it and
turns `unclassified` into an `effect_unclassified` refusal.

### `FrameworkError` and `ErrorEnvelope`

```typescript
class FrameworkError extends Error {
  readonly code: string;                              // registered in src/core/error-codes.ts
  readonly details: Record<string, unknown> | undefined;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
```

`toErrorEnvelope(error)` produces the `--json` shape and `renderErrorLine(error)` the
`<message> [code]` text line; both are exported from the package root. `SurfCommandError` extends
`FrameworkError` and passes surf's own code through verbatim. See `docs/api/errors.md` for the
code vocabulary and the outcome classes.
