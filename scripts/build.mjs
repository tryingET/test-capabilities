import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "dist");
const tsgoEntrypoint = path.join(
  repoRoot,
  "node_modules",
  "@typescript",
  "native-preview",
  "bin",
  "tsgo.js",
);

if (!existsSync(tsgoEntrypoint)) {
  console.error(`build: missing tsgo CLI at ${tsgoEntrypoint}`);
  process.exit(1);
}

rmSync(distDir, { recursive: true, force: true });

const result = spawnSync(
  process.execPath,
  [tsgoEntrypoint, "-p", path.join(repoRoot, "tsconfig.json")],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.signal) {
  console.error(`build: tsgo exited via signal ${result.signal}`);
  process.exit(1);
}

console.error("build: tsgo exited without a status code");
process.exit(1);
