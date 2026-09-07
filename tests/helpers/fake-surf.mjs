import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const FAKE_SURF_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "fake-surf.mjs",
);

const ENV_KEYS = [
  "FAKE_SURF_STATE_DIR",
  "FAKE_SURF_PAGES",
  "FAKE_SURF_MODE",
  "FAKE_SURF_DOCTOR",
  "FAKE_SURF_FAIL_ON",
  "FAKE_SURF_EMPTY_ON",
  "FAKE_SURF_ZERO_ROWS_ON",
  "FAKE_SURF_BOOKKEEPING_ONLY_ON",
  "FAKE_SURF_LOG",
  "FAKE_SURF_ECHO",
];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Write a `surf` wrapper script that runs the fake fixture with its configuration baked into
 * the script, so both in-process callers and child CLI processes see the same fake browser.
 *
 * options: { pages, mode, doctor, failOn, emptyOn, zeroRowsOn, bookkeepingOnlyOn, echo, log, name }
 */
export function createFakeSurf(options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-fake-surf-"));
  const stateDir = path.join(dir, "state");
  const logFile = options.log === false ? undefined : path.join(dir, "calls.log");
  const env = {
    FAKE_SURF_STATE_DIR: stateDir,
    FAKE_SURF_PAGES: options.pages ? JSON.stringify(options.pages) : undefined,
    FAKE_SURF_MODE: options.mode,
    FAKE_SURF_DOCTOR: options.doctor,
    FAKE_SURF_FAIL_ON: Array.isArray(options.failOn) ? options.failOn.join(",") : options.failOn,
    FAKE_SURF_EMPTY_ON: Array.isArray(options.emptyOn)
      ? options.emptyOn.join(",")
      : options.emptyOn,
    FAKE_SURF_ZERO_ROWS_ON: Array.isArray(options.zeroRowsOn)
      ? options.zeroRowsOn.join(",")
      : options.zeroRowsOn,
    FAKE_SURF_BOOKKEEPING_ONLY_ON: Array.isArray(options.bookkeepingOnlyOn)
      ? options.bookkeepingOnlyOn.join(",")
      : options.bookkeepingOnlyOn,
    FAKE_SURF_LOG: logFile,
    FAKE_SURF_ECHO: options.echo ? "1" : undefined,
  };
  const exports = ENV_KEYS.filter((key) => env[key] !== undefined)
    .map((key) => `export ${key}=${shellQuote(env[key])}`)
    .join("\n");
  const binDir = path.join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const surfPath = path.join(binDir, options.name ?? "surf");
  writeFileSync(
    surfPath,
    `#!/bin/sh\n${exports}\nexec ${shellQuote(process.execPath)} ${shellQuote(FAKE_SURF_FIXTURE)} "$@"\n`,
    { mode: 0o755 },
  );

  return {
    dir,
    binDir,
    path: surfPath,
    logFile,
    calls() {
      if (!logFile) {
        return [];
      }
      try {
        return readCalls(logFile);
      } catch {
        return [];
      }
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function readCalls(logFile) {
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const RUNTIME_ENV_KEYS = [
  "TEST_CAPABILITIES_SURF_BIN",
  "TEST_CAPABILITIES_SURF_GO_BIN",
  "TEST_CAPABILITIES_SURF_GO_REPO",
];

/** Point the in-process runtime at a fake surf for the duration of `callback`. */
export async function withFakeSurfEnv(surfPath, callback) {
  const previous = Object.fromEntries(RUNTIME_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.TEST_CAPABILITIES_SURF_BIN = surfPath;
  delete process.env.TEST_CAPABILITIES_SURF_GO_BIN;
  delete process.env.TEST_CAPABILITIES_SURF_GO_REPO;

  try {
    return await callback();
  } finally {
    for (const key of RUNTIME_ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

/** Env overlay for child CLI processes: no surf at all (neither PATH nor ~/.local/bin). */
export function noSurfEnv(extra = {}) {
  return {
    PATH: path.dirname(process.execPath),
    HOME: mkdtempSync(path.join(os.tmpdir(), "test-capabilities-no-home-")),
    TEST_CAPABILITIES_SURF_BIN: "",
    TEST_CAPABILITIES_SURF_GO_BIN: "",
    TEST_CAPABILITIES_SURF_GO_REPO: "",
    ...extra,
  };
}

/** A page map where every listed URL is ready and lists the given same-origin links. */
export function readyPages(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([url, page]) => [
      url,
      { title: "Example Domain", readiness: "ready", links: [], ...page },
    ]),
  );
}
