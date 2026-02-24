import assert from "node:assert/strict";
import test from "node:test";

function isEnabled(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const runtimeTest = isEnabled(process.env.RUN_CONVEX_RUNTIME_TESTS) ? test : test.skip;

runtimeTest("runtime gate: explicit Convex endpoint metadata required", () => {
  const hasUrl = String(process.env.CONVEX_URL ?? "").trim().length > 0;
  const hasDeployment = String(process.env.CONVEX_DEPLOYMENT ?? "").trim().length > 0;

  assert.ok(
    hasUrl || hasDeployment,
    "Set CONVEX_URL or CONVEX_DEPLOYMENT before enabling RUN_CONVEX_RUNTIME_TESTS=1",
  );
});
