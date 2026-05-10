import type { ZodType, ZodTypeDef } from "zod";
import type { HealingProposal, HealingProposalVerification } from "../../healing/self-healing.js";
import type { QuantumResult } from "../../quantum/simulator.js";
import type { CoverageReport, TestCapabilitiesConfig, TestResult } from "../orchestrator.js";

export type OperationStatus = "implemented" | "unsupported";
export type CliCommand = "test" | "surf" | "predict" | "quantum" | "heal" | "visualize" | "report";
export type SurfAction = "explore" | "flow" | "assert" | "compare" | "replay";
export type OperationId = "test" | "surf.explore" | "quantum" | "heal";
export type CliRoute =
  | { command: "test" }
  | { command: "surf"; action: SurfAction }
  | { command: "predict" }
  | { command: "quantum" }
  | { command: "heal" }
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
  checkpointRef?: string;
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
  input: Required<Pick<TestOperationInput, "config" | "quick">> &
    Omit<TestOperationInput, "config" | "quick">;
  effectiveConfig: TestCapabilitiesConfig;
  summary: TestOperationSummary;
  result: TestResult;
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

export interface HealOperationResultEnvelope {
  operationId: "heal";
  input: Required<Pick<HealOperationInput, "dir" | "dryRun">> &
    Pick<HealOperationInput, "proposalOutput">;
  proposals: HealingProposal[];
  appliedCount: number;
  proposalArtifact?: HealProposalArtifactRef;
  verification?: HealingProposalVerification;
  verificationArtifact?: HealVerificationArtifactRef;
  checkpointRef?: string;
}

export type CliOperationResult =
  | TestOperationResultEnvelope
  | SurfExploreOperationResultEnvelope
  | QuantumOperationResultEnvelope
  | HealOperationResultEnvelope;

export type CliOperationInputUnion =
  | TestOperationInput
  | SurfExploreOperationInput
  | QuantumOperationInput
  | HealOperationInput;

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
