import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/**
 * What the CLI costs before it does anything (AK #6221): a machine-readable run never loads the
 * banner or the spinner, and Node's compile cache keeps the next start from compiling the same
 * code again - unless `NODE_DISABLE_COMPILE_CACHE` turns it off.
 */

const binPath = new URL("../bin/test-capabilities", import.meta.url).pathname;

/** A resolve hook that reports every load of the banner's and the spinner's packages. */
const WATCH = `data:text/javascript,${encodeURIComponent(`
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "figlet" || specifier === "ora") process.stderr.write("LOADED " + specifier + "\\n");
    return next(specifier, context);
  },
});
`)}`;

function run(args, env = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tc-startup-"));
  const merged = { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1", ...env(dir) };
  // an undefined value unsets the variable
  for (const [key, value] of Object.entries(merged)) if (value === undefined) delete merged[key];
  const result = spawnSync(process.execPath, ["--import", WATCH, binPath, ...args(dir)], {
    encoding: "utf-8",
    env: merged,
  });
  return { ...result, dir };
}

test("a machine-readable run loads neither the banner nor the spinner", () => {
  const result = run(
    (dir) => ["init", "--json", "--output", path.join(dir, "tc.yaml")],
    () => ({}),
  );
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /LOADED (figlet|ora)/);
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("a run for a person still shows the banner and the spinner", () => {
  const result = run(
    (dir) => ["init", "--output", path.join(dir, "tc.yaml")],
    () => ({}),
  );
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Fail-closed Testing Capability Framework/);
    assert.match(result.stderr, /LOADED figlet/);
    assert.match(result.stderr, /LOADED ora/);
  } finally {
    rmSync(result.dir, { recursive: true, force: true });
  }
});

test("the CLI keeps Node's compile cache in the temp dir, and not when it is turned off", () => {
  const cached = run(
    () => ["--version"],
    (dir) => ({ TMPDIR: dir, NODE_DISABLE_COMPILE_CACHE: undefined }),
  );
  const off = run(
    () => ["--version"],
    (dir) => ({ TMPDIR: dir, NODE_DISABLE_COMPILE_CACHE: "1" }),
  );
  try {
    assert.equal(cached.status, 0, cached.stderr);
    const cache = path.join(cached.dir, "node-compile-cache");
    assert.ok(existsSync(cache) && readdirSync(cache).length > 0, "the cache was written");
    assert.equal(off.status, 0, off.stderr);
    assert.equal(existsSync(path.join(off.dir, "node-compile-cache")), false);
  } finally {
    rmSync(cached.dir, { recursive: true, force: true });
    rmSync(off.dir, { recursive: true, force: true });
  }
});
