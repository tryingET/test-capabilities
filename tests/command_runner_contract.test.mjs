import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { renderCommandExitFailure, renderSpawnFailure, runCommand } = await importRuntimeModule(
  "core/operations/command-runner-core.js",
);

test("runCommand captures stdout and stderr on success", async () => {
  const result = await runCommand(process.execPath, [
    "-e",
    "process.stdout.write('ok'); process.stderr.write('warn');",
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ok");
  assert.equal(result.stderr, "warn");
});

test("runCommand rejects non-zero exits with the surfaced process output", async () => {
  await assert.rejects(
    async () =>
      runCommand(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(2);"]),
    /boom/,
  );
});

test("runCommand rejects missing commands with a surfaced spawn error", async () => {
  await assert.rejects(
    async () => runCommand("/definitely/not/a/real/binary", []),
    /Failed to run \/definitely\/not\/a\/real\/binary/,
  );
});

test("renderCommandExitFailure preserves stderr first, then stdout, then exit status fallback", () => {
  assert.equal(renderCommandExitFailure("node", 2, "ok", "boom").message, "boom");
  assert.equal(renderCommandExitFailure("node", 2, "ok", "   ").message, "ok");
  assert.equal(
    renderCommandExitFailure("node", 2, "   ", "   ").message,
    "node exited with code 2",
  );
});

test("renderSpawnFailure preserves the command label in the surfaced error", () => {
  const error = renderSpawnFailure("node", new Error("spawn exploded"));
  assert.match(error.message, /Failed to run node: spawn exploded/);
});
