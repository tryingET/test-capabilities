import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { collectFiles } from "../../healing/collect-files.js";
import type {
  HealingFinding,
  HealingProposal,
  HealingProposalVerification,
} from "../../healing/self-healing.js";
import { TestFileHealer } from "../../healing/self-healing.js";
import type {
  HealOperationInput,
  HealOperationResultEnvelope,
  OperationDefinition,
} from "./types.js";

export const HealOperationInputSchema = z.object({
  dir: z.string().optional().default("./tests"),
  dryRun: z.boolean().optional().default(false),
  proposalOutput: z.string().min(1).optional(),
  verificationOutput: z.string().min(1).optional(),
  checkpointRef: z.string().min(1).optional(),
  findingsInput: z.string().min(1).optional(),
});

const MAX_FINDINGS_INPUT_BYTES = 5 * 1024 * 1024;

const HealingFindingSchema = z
  .object({
    id: z.string().min(1),
    component: z.string().min(1),
    description: z.string().min(1),
    evidence: z.array(z.string()).min(1),
  })
  .passthrough();

const HealingFindingsInputSchema = z.array(HealingFindingSchema);

const HealingFindingsObjectSchema = z
  .object({ findings: HealingFindingsInputSchema })
  .passthrough();
const HealingFindingsTestEnvelopeSchema = z
  .object({ result: z.object({ findings: HealingFindingsInputSchema }).passthrough() })
  .passthrough();

function hasAmbiguousFindingsShapes(parsed: unknown): boolean {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    "findings" in parsed &&
    "result" in parsed &&
    typeof parsed.result === "object" &&
    parsed.result !== null &&
    "findings" in parsed.result
  );
}

function normalizeHealingFindingsInput(parsed: unknown): HealingFinding[] {
  if (hasAmbiguousFindingsShapes(parsed)) {
    throw new Error(
      "findings-input is ambiguous: provide either top-level findings[] or a test --json envelope with result.findings[], not both.",
    );
  }

  const arrayResult = HealingFindingsInputSchema.safeParse(parsed);
  if (arrayResult.success) {
    return arrayResult.data;
  }

  const objectResult = HealingFindingsObjectSchema.safeParse(parsed);
  if (objectResult.success) {
    return objectResult.data.findings;
  }

  const testEnvelopeResult = HealingFindingsTestEnvelopeSchema.safeParse(parsed);
  if (testEnvelopeResult.success) {
    return testEnvelopeResult.data.result.findings;
  }

  throw new Error(
    `findings-input must be a JSON array of finding objects, an object with findings[], or a test --json envelope with result.findings[]; each finding needs string id, component, description, and evidence string[]: ${arrayResult.error.message}`,
  );
}

type NormalizedHealOperationInput = z.output<typeof HealOperationInputSchema>;

interface HealMutationPosture {
  mode: "dry_run";
  applied_count: 0;
  external_checkpoint_required_for_apply: true;
  external_checkpoint_ref?: string;
  replay_fabric_guidance_only: true;
}

interface HealProposalArtifact {
  schema_version: 1;
  artifact_kind: "test-capabilities.heal.proposal";
  generated_at: string;
  operation_id: "heal";
  input: NormalizedHealOperationInput;
  mutation: HealMutationPosture;
  summary: {
    scanned_file_count: number;
    proposal_count: number;
    file_count_with_proposals: number;
  };
  proposals: HealingProposal[];
}

interface HealVerificationArtifact {
  schema_version: 1;
  artifact_kind: "test-capabilities.heal.verification";
  generated_at: string;
  operation_id: "heal";
  input: NormalizedHealOperationInput;
  proposal_artifact?: {
    path: string;
    schema_version: 1;
  };
  mutation: HealMutationPosture;
  verification: HealingProposalVerification & {
    mode: "in_memory_apply_check";
  };
}

function dryRunMutationPosture(input: NormalizedHealOperationInput): HealMutationPosture {
  return {
    mode: "dry_run",
    applied_count: 0,
    external_checkpoint_required_for_apply: true,
    ...(input.checkpointRef ? { external_checkpoint_ref: input.checkpointRef } : {}),
    replay_fabric_guidance_only: true,
  };
}

async function writeProposalArtifact(
  outputPath: string,
  input: NormalizedHealOperationInput,
  scannedFileCount: number,
  proposals: HealingProposal[],
): Promise<HealOperationResultEnvelope["proposalArtifact"]> {
  const artifactPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });

  const artifact: HealProposalArtifact = {
    schema_version: 1,
    artifact_kind: "test-capabilities.heal.proposal",
    generated_at: new Date().toISOString(),
    operation_id: "heal",
    input,
    mutation: dryRunMutationPosture(input),
    summary: {
      scanned_file_count: scannedFileCount,
      proposal_count: proposals.length,
      file_count_with_proposals: new Set(proposals.map((proposal) => proposal.file)).size,
    },
    proposals,
  };

  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");

  return {
    path: artifactPath,
    schemaVersion: 1,
    proposalCount: proposals.length,
  };
}

async function writeVerificationArtifact(
  outputPath: string,
  input: NormalizedHealOperationInput,
  verification: HealingProposalVerification,
  proposalArtifact: HealOperationResultEnvelope["proposalArtifact"],
): Promise<HealOperationResultEnvelope["verificationArtifact"]> {
  const artifactPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });

  const artifact: HealVerificationArtifact = {
    schema_version: 1,
    artifact_kind: "test-capabilities.heal.verification",
    generated_at: new Date().toISOString(),
    operation_id: "heal",
    input,
    ...(proposalArtifact
      ? {
          proposal_artifact: {
            path: proposalArtifact.path,
            schema_version: proposalArtifact.schemaVersion,
          },
        }
      : {}),
    mutation: dryRunMutationPosture(input),
    verification: {
      ...verification,
      mode: "in_memory_apply_check",
    },
  };

  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");

  return {
    path: artifactPath,
    schemaVersion: 1,
    status: verification.status,
    proposalCount: verification.proposalCount,
  };
}

async function runHealOperation(
  normalized: NormalizedHealOperationInput,
): Promise<HealOperationResultEnvelope> {
  if ((normalized.proposalOutput || normalized.verificationOutput) && !normalized.dryRun) {
    throw new Error(
      "Healing proposal and verification artifacts are only supported with --dry-run.",
    );
  }

  // Load diagnostic findings when evidence-backed mode is requested.
  let findings: HealingFinding[] | undefined;
  if (normalized.findingsInput) {
    const findingsPath = path.resolve(normalized.findingsInput);
    const stat = await fs.stat(findingsPath);
    if (!stat.isFile()) {
      throw new Error(`findings-input must be a file: ${findingsPath}`);
    }
    if (stat.size > MAX_FINDINGS_INPUT_BYTES) {
      throw new Error(
        `findings-input exceeds maximum size of ${MAX_FINDINGS_INPUT_BYTES} bytes: ${findingsPath}`,
      );
    }

    const raw = await fs.readFile(findingsPath, "utf-8");
    if (Buffer.byteLength(raw, "utf-8") > MAX_FINDINGS_INPUT_BYTES) {
      throw new Error(
        `findings-input exceeds maximum size of ${MAX_FINDINGS_INPUT_BYTES} bytes after read: ${findingsPath}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`findings-input must be valid JSON: ${detail}`);
    }

    findings = normalizeHealingFindingsInput(parsed);
  }

  const healer = new TestFileHealer();
  const files = collectFiles(path.resolve(normalized.dir));
  const proposals: HealingProposal[] = [];

  for (const file of files) {
    const fileProposals = await healer.analyzeFile(file, findings);
    proposals.push(...fileProposals);
  }

  if (!normalized.dryRun && proposals.length > 0 && !normalized.checkpointRef) {
    throw new Error(
      "Healing apply requires --checkpoint-ref from an external checkpoint/restore authority.",
    );
  }

  if (!normalized.dryRun) {
    await healer.applyProposals(proposals);
  }

  const proposalArtifact = normalized.proposalOutput
    ? await writeProposalArtifact(normalized.proposalOutput, normalized, files.length, proposals)
    : undefined;
  const verification = normalized.verificationOutput
    ? await healer.verifyProposals(proposals)
    : undefined;
  const verificationArtifact = normalized.verificationOutput
    ? await writeVerificationArtifact(
        normalized.verificationOutput,
        normalized,
        verification as HealingProposalVerification,
        proposalArtifact,
      )
    : undefined;

  return {
    operationId: "heal",
    input: normalized,
    proposals,
    appliedCount: normalized.dryRun ? 0 : proposals.length,
    ...(proposalArtifact ? { proposalArtifact } : {}),
    ...(verification ? { verification } : {}),
    ...(verificationArtifact ? { verificationArtifact } : {}),
    ...(normalized.checkpointRef ? { checkpointRef: normalized.checkpointRef } : {}),
  };
}

export const HEAL_OPERATION = {
  id: "heal",
  route: { command: "heal" },
  description: "Run the selector-healing workflow",
  inputSchema: HealOperationInputSchema,
  execute: runHealOperation,
} satisfies OperationDefinition<NormalizedHealOperationInput, HealOperationResultEnvelope>;

export async function executeHealOperation(
  input: HealOperationInput,
): Promise<HealOperationResultEnvelope> {
  return runHealOperation(HealOperationInputSchema.parse(input));
}
