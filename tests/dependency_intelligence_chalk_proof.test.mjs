import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import chalk from "chalk";

import { runtimeEnv } from "./helpers/runtime-dist.mjs";

const binPath = new URL("../bin/test-capabilities", import.meta.url).pathname;

const forcedColorChalk = new chalk.Instance({ level: 1 });
const noColorChalk = new chalk.Instance({ level: 0 });

function runDoctor(extraEnv = {}) {
  return spawnSync(process.execPath, [binPath, "doctor"], {
    encoding: "utf8",
    env: runtimeEnv({
      PATH: path.dirname(process.execPath),
      TEST_CAPABILITIES_SURF_GO_BIN: "",
      TEST_CAPABILITIES_SURF_GO_REPO: "",
      TEST_CAPABILITIES_BOMBADIL_BIN: "",
      TEST_CAPABILITIES_BOMBADIL_REPO: "",
      ...extraEnv,
    }),
  });
}

const USED_STYLE_MEMBER_CASES = [
  ["bold", "\u001B[1mvalue\u001B[22m"],
  ["cyan", "\u001B[36mvalue\u001B[39m"],
  ["dim", "\u001B[2mvalue\u001B[22m"],
  ["green", "\u001B[32mvalue\u001B[39m"],
  ["red", "\u001B[31mvalue\u001B[39m"],
  ["yellow", "\u001B[33mvalue\u001B[39m"],
];

test("dependency intelligence: current chalk style surface is bounded and deterministic under forced color", () => {
  assert.deepEqual(
    USED_STYLE_MEMBER_CASES.map(([member]) => member),
    ["bold", "cyan", "dim", "green", "red", "yellow"],
  );

  for (const [member, expected] of USED_STYLE_MEMBER_CASES) {
    assert.equal(forcedColorChalk[member]("value"), expected, member);
  }
});

test("dependency intelligence: current chalk style surface preserves no-color passthrough", () => {
  for (const [member] of USED_STYLE_MEMBER_CASES) {
    assert.equal(noColorChalk[member]("value"), "value", member);
  }
});

test("dependency intelligence: CLI doctor preserves current forced-color chalk rendering", () => {
  const result = runDoctor({ FORCE_COLOR: "1", NO_COLOR: undefined });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout.startsWith("\u001B[36m"), true);
  assert.match(result.stdout, /\u001B\[36m[\s\S]*\u001B\[39m\n\u001B\[2m  Fail-closed Testing Capability Framework/);
  assert.match(result.stdout, /\u001B\[2m  Fail-closed Testing Capability Framework v[\d.]+\u001B\[22m/);
  assert.match(result.stdout, /\u001B\[32mpass\u001B\[39m Node\.js runtime/);
  assert.match(result.stderr, /\u001B\[32m✔\u001B\[39m Doctor passed/);
});

test("dependency intelligence: CLI doctor preserves current no-color chalk rendering", () => {
  const result = runDoctor({ FORCE_COLOR: undefined, NO_COLOR: "1" });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout.includes("\u001B["), false);
  assert.equal(result.stderr.includes("\u001B["), false);
  assert.match(result.stdout, /  Fail-closed Testing Capability Framework v[\d.]+/);
  assert.match(result.stdout, /pass Node\.js runtime/);
  assert.match(result.stderr, /✔ Doctor passed/);
});
