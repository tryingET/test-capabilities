#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
    env: {
      ...process.env,
      NPM_CONFIG_MIN_RELEASE_AGE: "0",
      ...(options.env ?? {}),
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return result;
}

async function retry(label, attempts, fn) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      const delayMs = attempt * 15_000;
      console.error(`${label} attempt ${attempt}/${attempts} failed; retrying in ${delayMs}ms`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
  throw lastError;
}

const mode = process.argv[2] ?? "public";
if (mode !== "public") {
  throw new Error(`unsupported public-cli-contract mode: ${mode}`);
}

const packageSpec = argValue("--package") ?? `${pkg.name}@${argValue("--version") ?? pkg.version}`;
const attempts = Number(argValue("--attempts") ?? 8);
const version = packageSpec.includes("@") ? packageSpec.split("@").at(-1) : pkg.version;

await retry("npm view", attempts, () => {
  const view = run("npm", ["view", packageSpec, "version"]);
  assert.equal(view.stdout.trim(), version, `npm view should resolve exact ${packageSpec}`);
});

const publicCliTempDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-public-cli-"));
try {
  await retry("public CLI", attempts, () => {
    const execPackage = (binName, args) =>
      run("npm", ["exec", "--yes", "--package", packageSpec, "--", binName, ...args], {
        cwd: publicCliTempDir,
      });

    const help = execPackage("test-capabilities", ["--help"]);
    assert.match(help.stdout, /TEST-CAPABILITIES|Usage|Commands/i);
    const doctor = execPackage("test-capabilities", ["doctor", "--json"]);
    const doctorPayload = JSON.parse(doctor.stdout);
    assert.equal(doctorPayload.operationId, "doctor");
    assert.equal(doctorPayload.status, "pass");
    const alias = execPackage("tc", ["--help"]);
    assert.match(alias.stdout, /TEST-CAPABILITIES|Usage|Commands/i);
    const demo = execPackage("test-capabilities", ["demo", "--json"]);
    const payload = JSON.parse(demo.stdout);
    assert.equal(payload.operationId, "demo");
    assert.equal(payload.summary.health, "pass");
  });
} finally {
  rmSync(publicCliTempDir, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, packageSpec }, null, 2));
