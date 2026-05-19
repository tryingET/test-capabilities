import test from "node:test";
import assert from "node:assert/strict";

import chalk from "chalk";

const forcedColorChalk = new chalk.Instance({ level: 1 });
const noColorChalk = new chalk.Instance({ level: 0 });

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
