/**
 * The kernel artifact writer: one durable write path for every file the framework produces.
 *
 * Mediated ring (implementation plan §1): this module touches the filesystem so nothing else
 * has to. It is the file implementation behind the `ReceiptStore` interface
 * (`src/core/receipt-store.ts`; adjudication claim 6) and the writer the healing artifacts use
 * (lifted from `heal-operation.ts:108-136` and extended per architecture review A9).
 *
 * The write is a write-ahead record, not narration (mutation-safety packet, School 2): the
 * bytes reach stable storage *before* the caller acts, so the sequence is
 *   temp file (O_EXCL) -> write -> fsync(file) -> close -> rename -> fsync(directory)
 * and it is performed with the synchronous `node:fs` API so that nothing interleaves between
 * the fsync and the caller's act. `fsync` on the directory is what makes the rename itself
 * survive a power loss; without it the file can exist with no name.
 *
 * Every path is refused before it is written when any component is a symlink, so an artifact
 * can never be redirected out of the directory the operator named.
 */

import fs from "node:fs";
import path from "node:path";
import type { MutationReceipt, ReceiptFilter, ReceiptStore } from "./receipt-store.js";
import { coerceReceipt, MUTATION_RECEIPT_KIND, matchesReceiptFilter } from "./receipt-store.js";
import { FrameworkError } from "./runtime-contract.js";

/** The artifact kinds the framework writes; every artifact carries its kind in the file. */
export const ARTIFACT_KINDS = [
  "test-capabilities.mutation.receipt",
  "test-capabilities.heal.proposal",
  "test-capabilities.heal.verification",
  "test-capabilities.heal.receipts",
  /** the reviewable form plan of the submit gate; 0600 because it carries intended values */
  "test-capabilities.surf.plan",
  /** the aggregate export of an apply run's receipts (`surf apply --receipt-out`) */
  "test-capabilities.surf.apply.receipts",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * Artifacts may carry values, page text and file paths (architecture review A10), so they are
 * owner-only. The envelope copies carry hashes, codes and counts instead.
 */
export const ARTIFACT_FILE_MODE = 0o600;

export interface WriteArtifactOptions {
  /** POSIX mode for the created file; defaults to {@link ARTIFACT_FILE_MODE}. */
  mode?: number;
  /** How the refusals name this artifact, e.g. "Healing artifact output". */
  label?: string;
}

function errorCodeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

/**
 * Refuse a directory whose existing components are not all real directories. A component that
 * does not exist yet is fine: it is created below, and re-checked afterwards.
 */
export function assertNoSymlinkPathComponents(directoryPath: string, label: string): void {
  const resolvedDirectoryPath = path.resolve(directoryPath);
  const { root } = path.parse(resolvedDirectoryPath);
  const relativeParts = path.relative(root, resolvedDirectoryPath).split(path.sep).filter(Boolean);
  let currentPath = root;

  for (const part of relativeParts) {
    currentPath = path.join(currentPath, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(currentPath);
    } catch (error) {
      if (errorCodeOf(error) === "ENOENT") {
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

/** Refuse an output path that already exists as anything but a regular file. */
export function assertSafeArtifactOutputPath(artifactPath: string, label: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(artifactPath);
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${artifactPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${label} path is not a regular file: ${artifactPath}`);
  }
}

function fsyncDirectory(directoryPath: string): void {
  const descriptor = fs.openSync(directoryPath, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Write `artifact` as pretty JSON, durably and atomically. Returns the resolved path.
 *
 * The caller may treat a returned path as a promise that the bytes are on stable storage: the
 * function does not return before `fsync` on the file and on its directory have completed.
 */
export function writeJsonArtifactSync(
  artifactPath: string,
  artifact: unknown,
  options: WriteArtifactOptions = {},
): string {
  const label = options.label ?? "Artifact output";
  const resolvedPath = path.resolve(artifactPath);
  const artifactDirectory = path.dirname(resolvedPath);

  assertNoSymlinkPathComponents(artifactDirectory, label);
  fs.mkdirSync(artifactDirectory, { recursive: true });
  assertNoSymlinkPathComponents(artifactDirectory, label);
  assertSafeArtifactOutputPath(resolvedPath, label);

  const tempPath = path.join(
    artifactDirectory,
    `.${path.basename(resolvedPath)}.${process.pid}.${Date.now()}.tmp`,
  );

  let descriptor: number | undefined;
  let tempCreated = false;
  try {
    descriptor = fs.openSync(tempPath, "wx", options.mode ?? ARTIFACT_FILE_MODE);
    tempCreated = true;
    fs.writeFileSync(descriptor, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, resolvedPath);
    fsyncDirectory(artifactDirectory);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // the write already failed; the close error would hide it
      }
    }
    if (tempCreated) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // leaving a temp file behind is better than replacing the real cause
      }
    }
    throw error;
  }

  return resolvedPath;
}

/** The async face of {@link writeJsonArtifactSync}; the write itself never interleaves. */
export async function writeJsonArtifact(
  artifactPath: string,
  artifact: unknown,
  options: WriteArtifactOptions = {},
): Promise<string> {
  return writeJsonArtifactSync(artifactPath, artifact, options);
}

export interface ArtifactListEntry {
  path: string;
  artifact: Record<string, unknown>;
}

/**
 * Every JSON artifact under `directory` (one nested level, which is the receipt layout
 * `<dir>/<run_id>/<receipt_id>.json`), oldest name first. A missing directory is an empty
 * list; a file that is not JSON at all is not an artifact and is skipped. Symlinks are never
 * followed, in either the directory or the file position.
 */
export function listJsonArtifacts(directory: string, kind?: ArtifactKind): ArtifactListEntry[] {
  const root = path.resolve(directory);
  const entries: ArtifactListEntry[] = [];

  const visit = (current: string, depth: number): void => {
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      if (errorCodeOf(error) === "ENOENT" || errorCodeOf(error) === "ENOTDIR") {
        return;
      }
      throw error;
    }

    for (const entry of [...dirEntries].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) {
          visit(full, depth - 1);
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        continue;
      }
      const artifact = parsed as Record<string, unknown>;
      if (kind !== undefined && artifact.artifact_kind !== kind) {
        continue;
      }
      entries.push({ path: full, artifact });
    }
  };

  visit(root, 1);
  return entries;
}

/**
 * Receipts as files: `<receipts.dir>/<run_id>/<receipt_id>.json`, 0600, one directory per run
 * (mutation-safety packet, §Contract; adjudication claim 6). Nothing is ever deleted here;
 * deleting the directory is documented as an interlock reset with the same standing as
 * `--supersede-receipt`.
 */
export class FileReceiptStore implements ReceiptStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = path.resolve(dir);
  }

  receiptPath(receipt: Pick<MutationReceipt, "run_id" | "receipt_id">): string {
    return path.join(this.dir, receipt.run_id, `${receipt.receipt_id}.json`);
  }

  /**
   * Durable before the act. A failure here is `mutation_receipt_write_failed`: the caller must
   * not run the step, because an attempt nobody recorded is the blind-rerun state this whole
   * mechanism exists to prevent.
   */
  async append(receipt: MutationReceipt): Promise<void> {
    const target = this.receiptPath(receipt);
    try {
      writeJsonArtifactSync(target, receipt, {
        mode: ARTIFACT_FILE_MODE,
        label: "Mutation receipt",
      });
    } catch (error) {
      throw new FrameworkError(
        "mutation_receipt_write_failed",
        `Could not record the mutation receipt at ${target}: ${
          error instanceof Error ? error.message : String(error)
        }. The step was not run. Point receipts.dir at a writable directory (or set TEST_CAPABILITIES_RECEIPTS_DIR) and try again.`,
        { path: target, receipt_id: receipt.receipt_id, step_id: receipt.step_id },
      );
    }
  }

  async list(filter?: ReceiptFilter): Promise<MutationReceipt[]> {
    const receipts: MutationReceipt[] = [];
    for (const entry of listJsonArtifacts(this.dir, MUTATION_RECEIPT_KIND)) {
      const receipt = coerceReceipt(entry.artifact, path.basename(entry.path, ".json"));
      if (receipt && matchesReceiptFilter(receipt, filter)) {
        receipts.push(receipt);
      }
    }
    return receipts;
  }
}
