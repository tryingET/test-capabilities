import type { ZodType, ZodTypeDef } from "zod";
import type {
  HealingProposal,
  HealingProposalVerification,
  HealingRefusal,
} from "../../healing/self-healing.js";
import type { QuantumResult } from "../../quantum/simulator.js";
import type { A11ySnapshotObservation } from "../a11y-snapshot.js";
import type { ApplyFieldResult, ApplyMode } from "../browser-session.js";
import type { TestCapabilitiesConfig } from "../config.js";
import type { Determination } from "../determination.js";
import type { EffectDeclaration } from "../effects.js";
import type { FrameRootCause } from "../frame-root-cause.js";
import type { CoverageReport, TestResult } from "../orchestrator.js";
import type { OutcomeBasis, OutcomeClass, ResultOutcome } from "../result-classification.js";
import type { OperationEffectEnvelope, RunContext } from "../run-context.js";
import type {
  PlanFieldControl,
  PlanFingerprint,
  PlanForbiddenControl,
  PlanRuntime,
  PlanSubmit,
  SubmitStatus,
} from "../surf-plan.js";

export type OperationStatus = "implemented" | "unsupported";
export type CliCommand =
  | "test"
  | "doctor"
  | "demo"
  | "init"
  | "surf"
  | "predict"
  | "quantum"
  | "heal"
  | "replacement-validation"
  | "visualize"
  | "report";
export type SurfAction = "explore" | "plan" | "apply" | "flow" | "assert" | "compare" | "replay";
export type OperationId =
  | "test"
  | "doctor"
  | "demo"
  | "init"
  | "surf.explore"
  | "surf.plan"
  | "surf.apply"
  | "quantum"
  | "heal"
  | "replacement-validation";
export type CliRoute =
  | { command: "test" }
  | { command: "doctor" }
  | { command: "demo" }
  | { command: "init" }
  | { command: "surf"; action: SurfAction }
  | { command: "predict" }
  | { command: "quantum" }
  | { command: "heal" }
  | { command: "replacement-validation" }
  | { command: "visualize" }
  | { command: "report" };

export interface CliRouteManifestEntry {
  command: CliCommand;
  action?: SurfAction;
  status: OperationStatus;
  operationId?: OperationId;
  description: string;
}

export interface TestOperationInput {
  json?: boolean;
  target?: string;
  config?: string;
  autonomous?: boolean;
  selfHeal?: boolean;
  predict?: boolean;
  quick?: boolean;
  failThreshold?: string;
  uploadArtifacts?: boolean;
  report?: string;
}

export interface SurfExploreOperationInput {
  url?: string;
  depth?: string;
  json?: boolean;
  /** a visible CSS selector the readiness gate waits for; the trigger for the frame diagnosis */
  readySelector?: string;
  /** `urlPrefix=…` or `selector=…`; the only v1 route to a `confirmed` frame determination */
  frameHint?: string;
  /** probe the candidate frames in-frame when no hint is given (AK #5569) */
  frameProbe?: boolean;
  /** `off` (default) | `optional` | `required`: the a11y observation channel (slice S9) */
  a11ySnapshot?: string | boolean;
  record?: boolean;
  validate?: boolean;
  baseline?: string;
  aiDiff?: boolean;
  file?: string;
}

/** `surf plan` (submit-gate packet §4.1). `--field` repeats; `--out` names the artifact. */
export interface SurfPlanOperationInput {
  url?: string;
  field?: string[];
  submitText?: string;
  submitSelector?: string;
  out?: string;
  config?: string;
  json?: boolean;
}

/** `surf apply` (submit-gate packet §4.2). Fill is the default; submit needs both gate flags. */
export interface SurfApplyOperationInput {
  plan?: string;
  submit?: boolean;
  confirmPlan?: string;
  untilUrlPrefix?: string;
  untilText?: string;
  receiptOut?: string;
  config?: string;
  json?: boolean;
}

export interface QuantumOperationInput {
  target?: string;
  branches?: string;
  collapse?: boolean;
}

export interface HealOperationInput {
  dir?: string;
  dryRun?: boolean;
  proposalOutput?: string;
  verificationOutput?: string;
  proposalInput?: string;
  checkpointRef?: string;
  /**
   * Path to a JSON file containing orchestrator findings (observation.v1 Finding[]).
   * When provided, healing proposals cite triggeringFindingId so each repair is
   * traceable to diagnostic evidence instead of pure file scanning.
   */
  findingsInput?: string;
}

export interface DoctorOperationInput {
  json?: boolean;
  /**
   * Optional user config to validate. When omitted, doctor validates the packaged
   * sample config so first-run diagnostics stay zero-setup.
   */
  config?: string;
  /**
   * Optional CLI target command/path to resolve without executing it.
   * URL targets are accepted as web targets and do not require CLI executability.
   */
  target?: string;
}

export interface DemoOperationInput {
  json?: boolean;
}

export interface InitOperationInput {
  output?: string;
  target?: string;
  force?: boolean;
  print?: boolean;
  json?: boolean;
}

export interface ReplacementValidationOperationInput {
  action: "plan";
  request: string;
  out?: string;
  json?: boolean;
}

export interface DoctorCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  required: boolean;
  detail: string;
  data?: Record<string, unknown>;
}

export interface TestOperationSummary {
  health: "pass" | "fail";
  /** the run verdict with its basis; `health` is `pass` only for `verified` (D3) */
  determination: Determination;
  findings: number;
  coverage: CoverageReport;
  /** how many classified steps landed in each outcome class, zeros included */
  outcomes: Record<OutcomeClass, number>;
  /** how many classified steps landed on each basis, zeros included */
  bases: Record<OutcomeBasis, number>;
  predictions: number;
  quantumUniverses?: number;
}

export interface TestOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "test";
  mode: "quick" | "standard";
  input: Required<Pick<TestOperationInput, "config" | "quick" | "json">> &
    Omit<TestOperationInput, "config" | "quick" | "json">;
  effectiveConfig: TestCapabilitiesConfig;
  summary: TestOperationSummary;
  result: TestResult;
}

export interface DoctorOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "doctor";
  input: Required<Pick<DoctorOperationInput, "json">> & Omit<DoctorOperationInput, "json">;
  packageRoot: string;
  status: "pass" | "fail";
  summary: {
    requiredPassed: number;
    requiredFailed: number;
    optionalWarnings: number;
  };
  checks: DoctorCheck[];
}

export interface CoreUseCaseGuide {
  id: "cli-smoke-observation";
  title: string;
  purpose: string;
  proves: string[];
  commands: string[];
  nextSteps: string[];
}

export interface DemoOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "demo";
  input: Required<DemoOperationInput>;
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

export interface InitOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "init";
  input: Required<InitOperationInput>;
  template: "cli-smoke";
  outputPath: string;
  written: boolean;
  configText: string;
  nextCommands: string[];
}

export type SurfExploreReadinessState =
  | "ready"
  | "empty"
  | "loading"
  | "login"
  | "challenge"
  | "not-found"
  | "error"
  | "unknown";

export interface SurfExplorePageReadiness {
  state: SurfExploreReadinessState;
  code?: string;
  message?: string;
  href?: string;
  title?: string;
  readyState?: string;
  polls?: number;
  waited?: number;
  evidence: string[];
}

export interface SurfExploreProbeResult {
  kind: "state" | "dom" | "links";
  url: string;
  depth: number;
  verified: boolean;
  signal?: string;
  error?: string;
  code?: string;
  /**
   * The classified outcome of the surf command behind this probe (slice S4). `basis` is the
   * attribution axis: `fault` is a target or transport failure, `no_evidence` is an empty
   * payload nothing declared acceptable, and `evidence` is the only basis a verified probe has.
   */
  outcome?: ResultOutcome;
  /**
   * Why an element this probe named could not be reached (slice S8). Present only when
   * `--ready-selector` was given and the gate could not reach it: one `frame.diagnose` in the
   * same owned tab, classified into the kernel determination shape. `determination.value` is
   * the field every consumer reads; the `frame-root-cause:` evidence lines are its rendering.
   */
  frameRootCause?: FrameRootCause;
}

export interface SurfExplorePageResult {
  url: string;
  depth: number;
  tabId?: number;
  verified: boolean;
  readiness?: SurfExplorePageReadiness;
  probes: SurfExploreProbeResult[];
  /**
   * What the registered read-only observers saw on this page (slice S9). Each entry carries the
   * digest, the refs map, the counts and the artifact's path - never the snapshot text, which
   * stays in the 0600 file (architecture review A10). Absent when no channel was asked for, so
   * an existing run's envelope is byte-identical.
   */
  observations?: A11ySnapshotObservation[];
  discoveredUrls: string[];
  links?: {
    rowCount: number;
    attempts: number;
  };
}

export interface SurfExploreOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "surf.explore";
  input: Required<Pick<SurfExploreOperationInput, "url">> & Omit<SurfExploreOperationInput, "url">;
  result: {
    command: string;
    args: string[];
    runtime?: {
      flavor: "surf";
      provider: string;
      resolutionNotes: string[];
      version?: string;
      mechanisms?: Record<string, boolean>;
      /** the a11y observation channel this run asked for, when it asked for one (slice S9) */
      a11yChannel?: {
        mode: "optional" | "required";
        channel: string;
        tool?: string;
        version?: string;
        endpoint?: string;
        status: "captured" | "unavailable";
        reason?: string;
      };
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
      status: "verified" | "partial";
      requestedDepth: number;
      reachedDepth: number;
      pagesDiscovered: number;
      pagesVisited: number;
      pagesVerified: number;
      probesRequired: number;
      probesVerified: number;
    };
    pages: SurfExplorePageResult[];
  };
}

export interface SurfPlanEnvelopeField {
  id: string;
  /** `<kind>:<value>` as the operator wrote it; the intended value stays in the 0600 artifact */
  locator: string;
  resolvedSelector: string;
  control: PlanFieldControl;
  setVia: "field_input";
}

export interface SurfPlanOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "surf.plan";
  input: Required<Pick<SurfPlanOperationInput, "url" | "out">> &
    Omit<SurfPlanOperationInput, "url" | "out">;
  plan: {
    path: string;
    planId: string;
    /** the content hash `surf apply --submit --confirm-plan` must present */
    approvalToken: string;
    artifactKind: string;
    schemaVersion: number;
  };
  result: {
    target: {
      url: string;
      origin: string;
      landedHref: string;
      title: string;
      readiness: { state: string; evidence: string[] };
    };
    runtime: PlanRuntime;
    fields: SurfPlanEnvelopeField[];
    submit: PlanSubmit;
    forbiddenControls: PlanForbiddenControl[];
    fingerprint: PlanFingerprint;
  };
  notes: string[];
}

export interface SurfApplyOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "surf.apply";
  input: Required<Pick<SurfApplyOperationInput, "plan" | "submit">> &
    Omit<SurfApplyOperationInput, "plan" | "submit">;
  plan: { path: string; planId: string };
  /** the receipt an operator looks at first: the submit if there was one, else the last fill */
  receipt?: { path: string; outcome: string };
  /** where `--receipt-out` exported this run's receipts, when it was asked for */
  receiptExport?: string;
  result: {
    mode: ApplyMode;
    /** `true` only when the post-condition was observed; `"unknown"` never reaches a verdict */
    submitted: boolean | "unknown";
    fields: ApplyFieldResult[];
    submit: {
      status: SubmitStatus;
      control?: string;
      clicked: boolean;
      postCondition?: { kind: string; expected: string };
    };
    /** the verbs this run issued with what they addressed, values elided: the click evidence */
    surfCalls: string[];
  };
  notes: string[];
}

export interface QuantumOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "quantum";
  input: Required<Pick<QuantumOperationInput, "target" | "branches" | "collapse">>;
  result: QuantumResult;
}

export interface HealProposalArtifactRef {
  path: string;
  schemaVersion: 1;
  proposalCount: number;
}

export interface HealReceiptArtifactRef {
  path: string;
  schemaVersion: 1;
  receiptCount: number;
  appliedCount: number;
}

export interface HealVerificationArtifactRef {
  path: string;
  schemaVersion: 1;
  status: HealingProposalVerification["status"];
  proposalCount: number;
}

export interface ReplacementValidationOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "replacement-validation";
  input: Required<Pick<ReplacementValidationOperationInput, "action" | "request" | "json">> &
    Pick<ReplacementValidationOperationInput, "out">;
  requestPath: string;
  result: import("../replacement-validation.js").ReplacementValidationResult;
}

export interface HealOperationResultEnvelope extends OperationEffectEnvelope {
  operationId: "heal";
  input: Required<Pick<HealOperationInput, "dir" | "dryRun">> &
    Pick<HealOperationInput, "proposalOutput" | "verificationOutput" | "proposalInput">;
  proposals: HealingProposal[];
  /**
   * Selectors the healer declined to rewrite, with the reason and - for a confirmed frame
   * boundary - the `frame.switch` the repair actually needs (slice S8). Review artifacts:
   * `heal --apply` never consumes one.
   */
  refusals: HealingRefusal[];
  /** the number of proposals whose file the ledger settled as `applied` */
  appliedCount: number;
  receiptArtifact?: HealReceiptArtifactRef;
  proposalArtifact?: HealProposalArtifactRef;
  verification?: HealingProposalVerification;
  verificationArtifact?: HealVerificationArtifactRef;
  checkpointRef?: string;
}

export type CliOperationResult =
  | TestOperationResultEnvelope
  | DoctorOperationResultEnvelope
  | DemoOperationResultEnvelope
  | InitOperationResultEnvelope
  | SurfExploreOperationResultEnvelope
  | SurfPlanOperationResultEnvelope
  | SurfApplyOperationResultEnvelope
  | QuantumOperationResultEnvelope
  | HealOperationResultEnvelope
  | ReplacementValidationOperationResultEnvelope;

export type CliOperationInputUnion =
  | TestOperationInput
  | DoctorOperationInput
  | DemoOperationInput
  | InitOperationInput
  | SurfExploreOperationInput
  | SurfPlanOperationInput
  | SurfApplyOperationInput
  | QuantumOperationInput
  | HealOperationInput
  | ReplacementValidationOperationInput;

export interface OperationDefinition<
  TParsedInput,
  TResult extends CliOperationResult,
  TRawInput = unknown,
> {
  id: OperationId;
  route: Extract<CliRoute, { command: CliCommand }>;
  description: string;
  inputSchema: ZodType<TParsedInput, ZodTypeDef, TRawInput>;
  /**
   * What this operation may do to the world (mutation-safety packet, "Declaration points").
   * The function form is for mode-dependent operations (`heal --dry-run` reads, `heal
   * --proposal-input` writes). The registry resolves it *before* `execute` and refuses with
   * `effect_unclassified` if the result is not one of the two classes: there is no default.
   */
  effect: EffectDeclaration | ((input: TParsedInput) => EffectDeclaration);
  /**
   * The kernel mints the {@link RunContext} and passes it in, so an operation - and any
   * operation nested inside it - shares one run id, one ledger and one receipt store
   * (architecture review A5, adjudication claim 1).
   */
  execute: (input: TParsedInput, context: RunContext) => Promise<TResult>;
}

export type { OperationEffectEnvelope, RunContext };
