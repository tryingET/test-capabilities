import fs from "node:fs";
import path from "node:path";

const HEAL_IGNORED_DIRECTORIES = new Set([".git", "coverage", "dist", "node_modules"]);
export const MAX_HEAL_SOURCE_FILE_BYTES = 5 * 1024 * 1024;

function isPathInsideRoot(candidateRealPath: string, rootRealPath: string): boolean {
  const relative = path.relative(rootRealPath, candidateRealPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoSymlink(filePath: string, label: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new Error(`Heal ${label} not found: ${filePath}.`);
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Heal ${label} must not be a symlink: ${filePath}.`);
  }

  return stat;
}

function assertReadableDirectory(rootDir: string): string {
  const rootStat = assertNoSymlink(rootDir, "directory");

  if (!rootStat.isDirectory()) {
    throw new Error(
      `Heal directory is not a directory: ${rootDir}. Use --dir with a directory path.`,
    );
  }

  return fs.realpathSync(rootDir);
}

function isSourceCandidate(fileName: string): boolean {
  return /\.(c|m)?[jt]sx?$/.test(fileName);
}

function assertContainedRegularSourceFile(filePath: string, rootRealPath: string): void {
  const stat = assertNoSymlink(filePath, "source file");
  if (!stat.isFile()) {
    return;
  }

  const realPath = fs.realpathSync(filePath);
  if (!isPathInsideRoot(realPath, rootRealPath)) {
    throw new Error(`Heal source file resolved outside scan root: ${filePath}.`);
  }

  if (stat.size > MAX_HEAL_SOURCE_FILE_BYTES) {
    throw new Error(
      `Heal source file exceeds maximum size of ${MAX_HEAL_SOURCE_FILE_BYTES} bytes: ${filePath}.`,
    );
  }
}

export function collectFiles(rootDir: string): string[] {
  const rootRealPath = assertReadableDirectory(rootDir);

  const files: string[] = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const currentDir = pending.pop() as string;
    const currentStat = assertNoSymlink(currentDir, "directory");
    if (!currentStat.isDirectory()) {
      throw new Error(`Heal traversal target is not a directory: ${currentDir}.`);
    }

    const currentRealPath = fs.realpathSync(currentDir);
    if (!isPathInsideRoot(currentRealPath, rootRealPath)) {
      throw new Error(`Heal directory resolved outside scan root: ${currentDir}.`);
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const entryStat = assertNoSymlink(fullPath, "path");

      if (entryStat.isDirectory()) {
        if (!HEAL_IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(fullPath);
        }
        continue;
      }

      if (isSourceCandidate(entry.name)) {
        assertContainedRegularSourceFile(fullPath, rootRealPath);
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}
