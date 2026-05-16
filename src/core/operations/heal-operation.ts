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
  proposalInput: z.string().min(1).optional(),
  checkpointRef: z.string().min(1).optional(),
  findingsInput: z.string().min(1).optional(),
});

const MAX_FINDINGS_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_PROPOSAL_INPUT_BYTES = 5 * 1024 * 1024;

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

async function assertSafeInputFile(
  filePath: string,
  label: string,
  maxBytes: number,
): Promise<number> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new Error(`ENOENT: ${label} not found: ${filePath}`);
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
  if (stat.size > maxBytes) {
    throw new Error(`${label} exceeds maximum size of ${maxBytes} bytes: ${filePath}`);
  }

  return stat.size;
}

async function assertNoExistingSymlinkPathComponents(
  directoryPath: string,
  label: string,
): Promise<void> {
  const resolvedDirectoryPath = path.resolve(directoryPath);
  const { root } = path.parse(resolvedDirectoryPath);
  const relativeParts = path.relative(root, resolvedDirectoryPath).split(path.sep).filter(Boolean);
  let currentPath = root;

  for (const part of relativeParts) {
    currentPath = path.join(currentPath, part);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(currentPath);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} directory component must not be a symlink: ${currentPath}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${label} directory component is not a directory: ${currentPath}`);
    }
  }
}

async function assertSafeArtifactOutputPath(artifactPath: string): Promise<void> {
  try {
    const stat = await fs.lstat(artifactPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Healing artifact output must not be a symlink: ${artifactPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Healing artifact output path is not a regular file: ${artifactPath}`);
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function writeJsonArtifactAtomically(artifactPath: string, artifact: unknown): Promise<void> {
  const artifactDirectory = path.dirname(artifactPath);
  await assertNoExistingSymlinkPathComponents(artifactDirectory, "Healing artifact output");
  await fs.mkdir(artifactDirectory, { recursive: true });
  await assertNoExistingSymlinkPathComponents(artifactDirectory, "Healing artifact output");
  await assertSafeArtifactOutputPath(artifactPath);

  const tempPath = path.join(
    artifactDirectory,
    `.${path.basename(artifactPath)}.${process.pid}.${Date.now()}.tmp`,
  );

  let tempCreated = false;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(tempPath, "wx");
    tempCreated = true;
    await handle.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, artifactPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (tempCreated) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

const HealingFindingSchema = z
  .object({
    id: z.string().min(1),
    component: z.string().min(1),
    description: z.string().min(1),
    evidence: z.array(z.string()).min(1),
  })
  .passthrough();

const HealingProposalSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive().optional(),
  oldSelector: z.string().min(1),
  newSelector: z.string().min(1),
  confidence: z.number().min(0).max(1),
  strategy: z.string().min(1),
  requiresReview: z.boolean(),
  triggeringFindingId: z.string().min(1).optional(),
});

const HealProposalArtifactInputSchema = z
  .object({
    schema_version: z.literal(1),
    artifact_kind: z.literal("test-capabilities.heal.proposal"),
    operation_id: z.literal("heal"),
    proposals: z.array(HealingProposalSchema),
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

function isPathInsideRoot(candidateRealPath: string, rootRealPath: string): boolean {
  const relative = path.relative(rootRealPath, candidateRealPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertSafeHealRoot(rootDir: string): Promise<string> {
  const stat = await fs.lstat(rootDir);
  if (stat.isSymbolicLink()) {
    throw new Error(`Healing proposal apply directory must not be a symlink: ${rootDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Healing proposal apply directory must be a directory: ${rootDir}`);
  }
  return fs.realpath(rootDir);
}

async function constrainProposalTargetsToHealRoot(
  proposals: HealingProposal[],
  rootDir: string,
): Promise<HealingProposal[]> {
  const rootRealPath = await assertSafeHealRoot(rootDir);

  return Promise.all(
    proposals.map(async (proposal) => {
      if (!path.isAbsolute(proposal.file)) {
        throw new Error(
          `proposal-input target file must be absolute to avoid cwd-dependent apply behavior: ${proposal.file}`,
        );
      }
      const resolvedFile = path.resolve(proposal.file);
      let stat: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stat = await fs.lstat(resolvedFile);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          throw new Error(`proposal-input target file not found: ${resolvedFile}`);
        }
        throw error;
      }

      if (stat.isSymbolicLink()) {
        throw new Error(`proposal-input target file must not be a symlink: ${resolvedFile}`);
      }
      if (!stat.isFile()) {
        throw new Error(`proposal-input target must be a regular file: ${resolvedFile}`);
      }

      const targetRealPath = await fs.realpath(resolvedFile);
      if (!isPathInsideRoot(targetRealPath, rootRealPath)) {
        throw new Error(
          `proposal-input target resolved outside heal directory: ${resolvedFile}. Use --dir to set the intended mutation boundary.`,
        );
      }

      return { ...proposal, file: resolvedFile };
    }),
  );
}

function normalizeHealProposalArtifactInput(parsed: unknown): HealingProposal[] {
  const result = HealProposalArtifactInputSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `proposal-input must be a test-capabilities.heal.proposal schema v1 artifact: ${result.error.message}`,
    );
  }

  const reviewRequired = result.data.proposals.filter((proposal) => proposal.requiresReview);
  if (reviewRequired.length > 0) {
    throw new Error(
      `proposal-input contains ${reviewRequired.length} proposal(s) that require review and cannot be applied automatically.`,
    );
  }

  return result.data.proposals;
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

  await writeJsonArtifactAtomically(artifactPath, artifact);

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

  await writeJsonArtifactAtomically(artifactPath, artifact);

  return {
    path: artifactPath,
    schemaVersion: 1,
    status: verification.status,
    proposalCount: verification.proposalCount,
  };
}

async function readJsonInputFile(
  filePath: string,
  label: string,
  maxBytes: number,
): Promise<unknown> {
  await assertSafeInputFile(filePath, label, maxBytes);

  const raw = await fs.readFile(filePath, "utf-8");
  if (Buffer.byteLength(raw, "utf-8") > maxBytes) {
    throw new Error(`${label} exceeds maximum size of ${maxBytes} bytes after read: ${filePath}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} must be valid JSON: ${detail}`);
  }
}

async function runHealOperation(
  normalized: NormalizedHealOperationInput,
): Promise<HealOperationResultEnvelope> {
  if ((normalized.proposalOutput || normalized.verificationOutput) && !normalized.dryRun) {
    throw new Error(
      "Healing proposal and verification artifacts are only supported with --dry-run.",
    );
  }
  if (normalized.proposalInput && normalized.dryRun) {
    throw new Error(
      "Healing --proposal-input applies reviewed proposals and cannot be combined with --dry-run.",
    );
  }
  if (normalized.proposalInput && !normalized.checkpointRef) {
    throw new Error(
      "Healing apply from --proposal-input requires --checkpoint-ref from an external checkpoint/restore authority.",
    );
  }
  if (normalized.proposalInput && normalized.findingsInput) {
    throw new Error(
      "Healing --proposal-input cannot be combined with --findings-input; proposal artifacts already contain the proposals to apply.",
    );
  }

  const healer = new TestFileHealer({ rootDir: path.resolve(normalized.dir) });
  let files: string[] = [];
  let proposals: HealingProposal[] = [];

  if (normalized.proposalInput) {
    const proposalInputPath = path.resolve(normalized.proposalInput);
    proposals = await constrainProposalTargetsToHealRoot(
      normalizeHealProposalArtifactInput(
        await readJsonInputFile(proposalInputPath, "proposal-input", MAX_PROPOSAL_INPUT_BYTES),
      ),
      path.resolve(normalized.dir),
    );
  } else {
    // Load diagnostic findings when evidence-backed mode is requested.
    let findings: HealingFinding[] | undefined;
    if (normalized.findingsInput) {
      const findingsPath = path.resolve(normalized.findingsInput);
      findings = normalizeHealingFindingsInput(
        await readJsonInputFile(findingsPath, "findings-input", MAX_FINDINGS_INPUT_BYTES),
      );
    }

    files = collectFiles(path.resolve(normalized.dir));

    for (const file of files) {
      const fileProposals = await healer.analyzeFile(file, findings);
      proposals.push(...fileProposals);
    }
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
