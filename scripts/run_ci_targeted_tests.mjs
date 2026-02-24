import { spawnSync } from "node:child_process";

function isEnabled(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function writeBuffered(stream, output) {
  if (typeof output !== "string" || output.trim().length === 0) {
    return;
  }

  const target = stream === "stderr" ? process.stderr : process.stdout;
  target.write(output.endsWith("\n") ? output : `${output}\n`);
}

const tests = ["tests/ci_targeted_smoke.test.mjs"];

if (isEnabled(process.env.RUN_CONVEX_RUNTIME_TESTS)) {
  tests.push("tests/convex_runtime_contract_enforcement.test.mjs");
}

const verbose = isEnabled(process.env.CI_TARGETED_TEST_VERBOSE);

console.log(
  verbose
    ? `ci-targeted: running ${tests.length} file(s) in verbose mode.`
    : `ci-targeted: running ${tests.length} file(s) in quiet mode.`,
);

const result = spawnSync(process.execPath, ["--test", ...tests], {
  env: process.env,
  stdio: verbose ? "inherit" : "pipe",
  encoding: verbose ? undefined : "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

if (typeof result.status === "number" && result.status === 0) {
  if (!verbose) {
    console.log("ci-targeted: ok (set CI_TARGETED_TEST_VERBOSE=1 for full per-test output).");
  }
  process.exit(0);
}

if (!verbose) {
  writeBuffered("stdout", result.stdout);
  writeBuffered("stderr", result.stderr);
}

process.exit(result.status ?? 1);
