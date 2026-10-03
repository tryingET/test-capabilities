import assert from "node:assert/strict";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

/**
 * The surf command mapping (`surf-args.ts`, moved out of `surf-runtime.ts` for AK #6221): each
 * command maps explicitly, and arguments a mapping cannot carry are refused, never passed on.
 */

const { translateSurfArgs } = await importRuntimeModule("core/surf-args.js");
const viaRuntime = (await importRuntimeModule("core/surf-runtime.js")).translateSurfArgs;

test("the mapping is still exported where it always was", () => {
  assert.equal(viaRuntime, translateSurfArgs);
});

test("commands without arguments or with one map to surf's own names", () => {
  for (const [command, args, expected] of [
    ["back", [], ["back"]],
    ["forward", [], ["forward"]],
    ["network.get", ["r1"], ["network.get", "r1", "--json"]],
    ["network.body", ["r1"], ["network.body", "r1"]],
    ["emulate.device", ["iPhone 15"], ["emulate.device", "iPhone 15"]],
    ["scroll.down", [], ["scroll", "down"]],
  ]) {
    assert.deepEqual(translateSurfArgs(command, args), expected, command);
  }
});

test("arguments a mapping cannot carry are refused with the reason", () => {
  for (const [command, args, reason] of [
    ["js", ["--file"], /--file requires a value/],
    ["js", ["one", "two"], /too many positional arguments \(one two\)/],
    ["js", [], /missing code or --file/],
    ["go", [], /missing url/],
    ["select", ["#country"], /missing value/],
    ["do", ["--file"], /--file requires a path/],
    ["do", ["--file", "flow.json", "--name"], /--name value pairs/],
    ["emulate.viewport", ["--height", "1"], /missing --width/],
    ["emulate.viewport", ["--width", "x", "--height", "1"], /--width must be numeric/],
    [
      "emulate.viewport",
      ["--width", "1", "--height", "1", "--scale", "z"],
      /--scale must be numeric/,
    ],
    ["scroll.diagonal", [], /Unsupported surf command mapping for 'scroll\.diagonal'/],
  ]) {
    assert.throws(() => translateSurfArgs(command, args), reason, `${command} ${args.join(" ")}`);
  }
});
