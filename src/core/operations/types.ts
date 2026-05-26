import type { ZodType, ZodTypeDef } from "zod";
import type { HealingProposal, HealingProposalVerification } from "../../healing/self-healing.js";
import type { QuantumResult } from "../../quantum/simulator.js";
import type { CoverageReport, TestCapabilitiesConfig, TestResult } from "../orchestrator.js";

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
export type SurfAction = "explore" | "flow" | "assert" | "compare" | "replay";
export type OperationId =
  | "test"
  | "doctor"
  | "demo"
  | "init"
  | "surf.explore"
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
  record?: boolean;
  validate?: boolean;
  baseline?: string;
  aiDiff?: boolean;
  file?: string;
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
}

export interface TestOperationSummary {
  health: "pass" | "fail";
  findings: number;
  coverage: CoverageReport;
  predictions: number;
  quantumUniverses?: number;
}

export interface TestOperationResultEnvelope {
  operationId: "test";
  mode: "quick" | "standard";
  input: Required<Pick<TestOperationInput, "config" | "quick" | "json">> &
    Omit<TestOperationInput, "config" | "quick" | "json">;
  effectiveConfig: TestCapabilitiesConfig;
  summary: TestOperationSummary;
  result: TestResult;
}

export interface DoctorOperationResultEnvelope {
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

export interface DemoOperationResultEnvelope {
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

export interface InitOperationResultEnvelope {
  operationId: "init";
  input: Required<InitOperationInput>;
  template: "cli-smoke";
  outputPath: string;
  written: boolean;
  configText: string;
  nextCommands: string[];
}

export interface SurfExploreOperationResultEnvelope {
  operationId: "surf.explore";
  input: Required<Pick<SurfExploreOperationInput, "url">> & Omit<SurfExploreOperationInput, "url">;
  result: {
    command: string;
    args: string[];
    runtime?: {
      flavor: "surf-go";
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
      status: "verified" | "partial";
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
        kind: "state" | "dom" | "links";
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

export interface QuantumOperationResultEnvelope {
  operationId: "quantum";
  input: Required<Pick<QuantumOperationInput, "target" | "branches" | "collapse">>;
  result: QuantumResult;
}

export interface HealProposalArtifactRef {
  path: string;
  schemaVersion: 1;
  proposalCount: number;
}

export interface HealVerificationArtifactRef {
  path: string;
  schemaVersion: 1;
  status: HealingProposalVerification["status"];
  proposalCount: number;
}

export interface ReplacementValidationOperationResultEnvelope {
  operationId: "replacement-validation";
  input: Required<Pick<ReplacementValidationOperationInput, "action" | "request" | "json">> &
    Pick<ReplacementValidationOperationInput, "out">;
  requestPath: string;
  result: import("../replacement-validation.js").ReplacementValidationResult;
}

export interface HealOperationResultEnvelope {
  operationId: "heal";
  input: Required<Pick<HealOperationInput, "dir" | "dryRun">> &
    Pick<HealOperationInput, "proposalOutput" | "verificationOutput" | "proposalInput">;
  proposals: HealingProposal[];
  appliedCount: number;
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
  | QuantumOperationResultEnvelope
  | HealOperationResultEnvelope
  | ReplacementValidationOperationResultEnvelope;

export type CliOperationInputUnion =
  | TestOperationInput
  | DoctorOperationInput
  | DemoOperationInput
  | InitOperationInput
  | SurfExploreOperationInput
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
  execute: (input: TParsedInput) => Promise<TResult>;
}
