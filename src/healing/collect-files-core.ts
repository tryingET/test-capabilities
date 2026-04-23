import fs from "node:fs";
import path from "node:path";

const HEAL_IGNORED_DIRECTORIES = new Set([".git", "coverage", "dist", "node_modules"]);

function assertReadableDirectory(rootDir: string): void {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Heal directory not found: ${rootDir}. Use --dir with an existing directory.`);
  }

  if (!fs.statSync(rootDir).isDirectory()) {
    throw new Error(
      `Heal directory is not a directory: ${rootDir}. Use --dir with a directory path.`,
    );
  }
}

function isSourceCandidate(fileName: string): boolean {
  return /\.(c|m)?[jt]sx?$/.test(fileName);
}

export function collectFiles(rootDir: string): string[] {
  assertReadableDirectory(rootDir);

  const files: string[] = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const currentDir = pending.pop() as string;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!HEAL_IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(fullPath);
        }
        continue;
      }

      if (isSourceCandidate(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}
