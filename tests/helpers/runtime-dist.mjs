import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function resolveRuntimeDistRoot() {
  return path.resolve(process.env.TEST_CAPABILITIES_DIST_ROOT ?? path.join(repoRoot, "dist"));
}

export function runtimeModuleUrl(modulePath) {
  return pathToFileURL(path.join(resolveRuntimeDistRoot(), modulePath)).href;
}

export async function importRuntimeModule(modulePath) {
  return import(runtimeModuleUrl(modulePath));
}

export function runtimeEnv(extra = {}) {
  return {
    ...process.env,
    ...extra,
    TEST_CAPABILITIES_DIST_ROOT: extra.TEST_CAPABILITIES_DIST_ROOT ?? resolveRuntimeDistRoot(),
    TEST_CAPABILITIES_PACKAGE_ROOT: extra.TEST_CAPABILITIES_PACKAGE_ROOT ?? path.join(repoRoot),
  };
}
