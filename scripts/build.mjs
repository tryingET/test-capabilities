import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolveBuildDistDir();
const tmpRoot = path.join(repoRoot, ".tmp");
const lockDir = path.join(tmpRoot, "build.lock");
const baseTsconfig = path.join(repoRoot, "tsconfig.json");
const tsgoEntrypoint = path.join(
  repoRoot,
  "node_modules",
  "@typescript",
  "native-preview",
  "bin",
  "tsgo.js",
);

function assertTsgoExecutable() {
  if (!existsSync(tsgoEntrypoint)) {
    console.error(`build: missing tsgo CLI at ${tsgoEntrypoint}`);
    process.exit(1);
  }

  const smoke = spawnSync(process.execPath, [tsgoEntrypoint, "--version"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (smoke.status !== 0) {
    console.error(
      [
        "build: tsgo native compiler is unavailable or incomplete.",
        "Install optional native dependencies with `npm ci` / `npm install` without `--omit=optional`.",
      ].join("\n"),
    );
    process.exit(typeof smoke.status === "number" ? smoke.status : 1);
  }
}

function resolveBuildDistDir() {
  const override = process.env.TEST_CAPABILITIES_BUILD_DIST_DIR;
  if (!override) {
    return path.join(repoRoot, "dist");
  }
  if (path.isAbsolute(override)) {
    throw new Error("build: TEST_CAPABILITIES_BUILD_DIST_DIR must be repo-relative");
  }

  const normalized = override.replaceAll(path.sep, "/");
  if (!normalized.startsWith(".tmp/")) {
    throw new Error("build: TEST_CAPABILITIES_BUILD_DIST_DIR overrides must stay under .tmp/");
  }

  return path.resolve(repoRoot, override);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireBuildLock() {
  mkdirSync(tmpRoot, { recursive: true });
  const deadline =
    Date.now() + Number(process.env.TEST_CAPABILITIES_BUILD_LOCK_TIMEOUT_MS ?? 120_000);
  const token = randomUUID();

  while (Date.now() < deadline) {
    try {
      mkdirSync(lockDir);
      writeFileSync(
        path.join(lockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }, null, 2),
        "utf8",
      );
      return () => releaseBuildLock(token);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      sleepSync(100);
    }
  }

  const owner = readBuildLockOwner();
  const ownerText = owner?.pid ? ` owned by pid ${owner.pid}` : "";
  throw new Error(
    `build: timed out waiting for another build to release .tmp/build.lock${ownerText}; remove the lock manually only after confirming no build is active`,
  );
}

function releaseBuildLock(token) {
  if (readBuildLockOwner()?.token === token) {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function readBuildLockOwner() {
  try {
    const parsed = JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }

    return {
      pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
      token: typeof parsed.token === "string" ? parsed.token : undefined,
    };
  } catch {
    return undefined;
  }
}

function toTsconfigPath(value) {
  const relative = path.relative(path.dirname(value.from), value.to).replaceAll(path.sep, "/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function writeStagingTsconfig(stagingRoot) {
  const stagingTsconfig = path.join(stagingRoot, "tsconfig.build.json");
  writeFileSync(
    stagingTsconfig,
    JSON.stringify(
      {
        extends: toTsconfigPath({ from: stagingTsconfig, to: baseTsconfig }),
        compilerOptions: {
          outDir: "./dist",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return stagingTsconfig;
}

function publishDist(stagedDistDir) {
  if (!existsSync(stagedDistDir)) {
    throw new Error(`build: compiler did not produce staged dist at ${stagedDistDir}`);
  }

  assertSafeGeneratedDirectory(distDir, "dist");
  mkdirSync(distDir, { recursive: true });
  assertSafeGeneratedDirectory(distDir, "dist");
  cpSync(stagedDistDir, distDir, { recursive: true, force: true, dereference: false });
  removeEntriesMissingFromSource(distDir, stagedDistDir);
}

function assertSafeGeneratedDirectory(directory, label) {
  assertPathInsideRepo(directory, label);
  if (!existsSync(directory)) {
    return;
  }

  const stat = lstatSync(directory);
  if (stat.isSymbolicLink()) {
    throw new Error(`build: refusing to publish to ${label} because it is a symbolic link`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`build: refusing to publish to ${label} because it is not a directory`);
  }

  const realRepoRoot = realpathSync(repoRoot);
  const realDirectory = realpathSync(directory);
  assertPathInside(realRepoRoot, realDirectory, label);

  assertNoSymlinksInside(directory, label);
}

function assertPathInsideRepo(directory, label) {
  assertPathInside(repoRoot, path.resolve(directory), label);
}

function assertPathInside(parent, candidate, label) {
  const relative = path.relative(parent, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`build: refusing to publish to ${label} outside the repository`);
  }
}

function assertNoSymlinksInside(directory, label) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const entryStat = lstatSync(entryPath);
    if (entryStat.isSymbolicLink()) {
      throw new Error(`build: refusing to publish to ${label} because it contains a symbolic link`);
    }
    if (entryStat.isDirectory()) {
      assertNoSymlinksInside(entryPath, label);
    }
  }
}

function removeEntriesMissingFromSource(targetDir, sourceDir) {
  for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
    const targetPath = path.join(targetDir, entry.name);
    const sourcePath = path.join(sourceDir, entry.name);

    if (!existsSync(sourcePath)) {
      rmSync(targetPath, { recursive: true, force: true });
      continue;
    }

    const targetStat = lstatSync(targetPath);
    const sourceStat = lstatSync(sourcePath);
    if (targetStat.isDirectory() && sourceStat.isDirectory()) {
      removeEntriesMissingFromSource(targetPath, sourcePath);
    }
  }
}

assertTsgoExecutable();

let releaseLock;
let stagingRoot;
let exitCode = 0;
try {
  releaseLock = acquireBuildLock();
  stagingRoot = mkdtempSync(path.join(tmpRoot, "build-"));
  const stagingTsconfig = writeStagingTsconfig(stagingRoot);

  const result = spawnSync(process.execPath, [tsgoEntrypoint, "-p", stagingTsconfig], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (typeof result.status === "number" && result.status !== 0) {
    exitCode = result.status;
  } else if (result.signal) {
    console.error(`build: tsgo exited via signal ${result.signal}`);
    exitCode = 1;
  } else if (typeof result.status !== "number") {
    console.error("build: tsgo exited without a status code");
    exitCode = 1;
  } else {
    publishDist(path.join(stagingRoot, "dist"));
  }
} finally {
  if (stagingRoot) {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
  releaseLock?.();
}

process.exit(exitCode);
