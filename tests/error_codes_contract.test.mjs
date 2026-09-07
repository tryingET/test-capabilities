import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const {
  CAPABILITY_ERROR_CODES,
  CLI_ERROR_CODES,
  EFFECT_ERROR_CODES,
  EXPLORE_ERROR_CODES,
  FRAMEWORK_ERROR_CODES,
  isKnownResultOutcomeCode,
  isRegisteredFrameworkErrorCode,
  RESULT_OUTCOME_CODES,
  RESULT_RECORDED_SIGNALS,
  SURF_PASSTHROUGH_CODES,
  UNCLASSIFIED_ERROR_CODE,
} = await importRuntimeModule("core/error-codes.js");
const {
  FrameworkError,
  isFrameworkError,
  renderErrorLine,
  renderErrorMessage,
  renderUnsupported,
  toErrorEnvelope,
} = await importRuntimeModule("core/runtime-contract.js");

const repoRoot = new URL("..", import.meta.url).pathname;

/** Comments describe the rule; only code raises an error. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, "");
}

function listSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listSourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

test("every registered code is unique across the namespaces", () => {
  const all = [
    ...CAPABILITY_ERROR_CODES,
    ...CLI_ERROR_CODES,
    ...EXPLORE_ERROR_CODES,
    ...EFFECT_ERROR_CODES,
  ];
  assert.deepEqual([...new Set(all)].sort(), [...all].sort());
  assert.deepEqual([...FRAMEWORK_ERROR_CODES].sort(), [...all].sort());

  const outcomeCodes = [...RESULT_OUTCOME_CODES];
  assert.deepEqual([...new Set(outcomeCodes)], outcomeCodes);
  const signals = [...RESULT_RECORDED_SIGNALS];
  assert.deepEqual([...new Set(signals)], signals);
});

test("every code is a lowercase snake_case identifier", () => {
  for (const code of [
    ...FRAMEWORK_ERROR_CODES,
    ...RESULT_OUTCOME_CODES,
    ...RESULT_RECORDED_SIGNALS,
    ...SURF_PASSTHROUGH_CODES,
  ]) {
    assert.match(code, /^[a-z][a-z0-9_]*$/, `code is not snake_case: ${code}`);
  }
});

test("every FrameworkError literal in src/ uses a registered code", () => {
  const offenders = [];
  const literal = /new FrameworkError\(\s*"([^"]+)"/g;
  for (const file of listSourceFiles(path.join(repoRoot, "src"))) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(literal)) {
      if (!isRegisteredFrameworkErrorCode(match[1])) {
        offenders.push(`${path.relative(repoRoot, file)}: ${match[1]}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "register the code in src/core/error-codes.ts before raising it (architecture review A6)",
  );
});

test("every renderUnsupported call in src/ passes a registered code", () => {
  const offenders = [];
  const call = /renderUnsupported\(([\s\S]{0,400}?)\);/g;
  for (const file of listSourceFiles(path.join(repoRoot, "src"))) {
    const name = path.relative(repoRoot, file);
    if (name === "src/core/runtime-contract.ts") {
      continue;
    }
    const source = stripComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(call)) {
      const codes = [...match[1].matchAll(/"([a-z][a-z0-9_]*)"/g)].map((entry) => entry[1]);
      const registered = codes.filter((code) => isRegisteredFrameworkErrorCode(code));
      if (registered.length === 0) {
        offenders.push(`${name}: ${match[1].trim().slice(0, 60)}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("FrameworkError carries its code and details and renders the [code] suffix", () => {
  const error = new FrameworkError("config_invalid", "the config is wrong", { path: "a.yaml" });
  assert.equal(isFrameworkError(error), true);
  assert.equal(error instanceof Error, true);
  assert.equal(error.name, "FrameworkError");
  assert.equal(error.code, "config_invalid");
  assert.deepEqual(error.details, { path: "a.yaml" });
  assert.equal(renderErrorLine(error), "the config is wrong [config_invalid]");
  assert.deepEqual(toErrorEnvelope(error), {
    error: {
      code: "config_invalid",
      message: "the config is wrong",
      details: { path: "a.yaml" },
    },
  });
});

test("renderUnsupported names the category, the values and a registered code", () => {
  const error = renderUnsupported(
    "CLI command(s)",
    ["predict"],
    "Use test.",
    "unsupported_command",
  );
  assert.equal(isFrameworkError(error), true);
  assert.equal(error.code, "unsupported_command");
  assert.match(error.message, /^Unsupported CLI command\(s\): predict\./);
  assert.deepEqual(error.details, { category: "CLI command(s)", values: ["predict"] });
});

test("a schema failure is config_invalid with its issues in details", () => {
  const zodLike = {
    issues: [
      { path: ["agents", "web"], message: "web is required" },
      { path: [], message: "config is invalid" },
    ],
  };
  assert.equal(renderErrorMessage(zodLike), "web is required\nconfig is invalid");
  const envelope = toErrorEnvelope(zodLike);
  assert.equal(envelope.error.code, "config_invalid");
  assert.deepEqual(envelope.error.details, {
    issues: [
      { path: "agents.web", message: "web is required" },
      { path: "", message: "config is invalid" },
    ],
  });
});

test("an unregistered failure says so instead of borrowing a code", () => {
  const envelope = toErrorEnvelope(new Error("something broke"));
  assert.equal(envelope.error.code, UNCLASSIFIED_ERROR_CODE);
  assert.equal(envelope.error.code, "unclassified_error");
  assert.equal(envelope.error.details, undefined);
  assert.equal(renderErrorLine("a bare string"), "a bare string [unclassified_error]");
  assert.equal(toErrorEnvelope({ issues: "not an array" }).error.code, "unclassified_error");
});

test("outcome codes cover the classifier vocabulary, the patterns and the surf pass-throughs", () => {
  for (const code of RESULT_OUTCOME_CODES) {
    assert.equal(isKnownResultOutcomeCode(code), true, code);
  }
  for (const code of SURF_PASSTHROUGH_CODES) {
    assert.equal(isKnownResultOutcomeCode(code), true, code);
  }
  for (const code of [
    "exit_0",
    "exit_9",
    "exit_-1",
    "signal_SIGKILL",
    "http_404",
    "http_unknown",
  ]) {
    assert.equal(isKnownResultOutcomeCode(code), true, code);
  }
  for (const code of ["exit_x", "signal_lowercase", "http_4040", "made_up"]) {
    assert.equal(isKnownResultOutcomeCode(code), false, code);
  }
});
