import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runtimeEnv } from "./helpers/runtime-dist.mjs";

const scriptPath = new URL("../scripts/runtime-diagnostic-corpus.mjs", import.meta.url).pathname;
const repoRoot = new URL("..", import.meta.url).pathname;

test(
  "runtime diagnostic corpus dogfoods real cli-tester root-cause calibration",
  { timeout: 20000 },
  () => {
    const result = spawnSync("node", [scriptPath], {
      encoding: "utf8",
      cwd: repoRoot,
      env: runtimeEnv(),
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[pass\] Real single CLI smoke failure does not emit root_cause/);
    assert.match(
      result.stdout,
      /\[pass\] Real independent CLI smoke failures classify command_resolution/,
    );
    assert.match(result.stdout, /\[pass\] Real CLI timeout failures classify timeout_or_latency/);
    assert.match(
      result.stdout,
      /\[pass\] Real same-component mixed CLI evidence suppresses root_cause/,
    );
    assert.match(
      result.stdout,
      /\[pass\] Real CLI correlation disabled emits no synthesized diagnosis/,
    );
  },
);

test(
  "runtime diagnostic corpus exposes machine-readable bounded coverage",
  { timeout: 20000 },
  () => {
    const result = spawnSync("node", [scriptPath, "--json"], {
      encoding: "utf8",
      cwd: repoRoot,
      env: runtimeEnv(),
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);

    assert.equal(payload.ok, true);
    assert.deepEqual(payload.coverage, {
      cases: 5,
      positiveRootCauseCases: 2,
      noRootCauseGuardrailCases: 3,
      failureClasses: ["command_resolution", "timeout_or_latency"],
    });

    const commandCase = payload.cases.find(
      (entry) => entry.name === "Real independent CLI smoke failures classify command_resolution",
    );
    assert.equal(commandCase?.rootCauseCount, 1);
    assert.deepEqual(commandCase?.actualRootCauses, [
      {
        subject: "cli",
        failureClass: "command_resolution",
        calibration: "high",
        signalCount: 2,
        sensorCount: 2,
      },
    ]);

    const rendered = JSON.stringify(payload);
    assert.equal(
      /predict|probability|horizon|future|will fail|causal proof|repair order/i.test(rendered),
      false,
    );
  },
);
