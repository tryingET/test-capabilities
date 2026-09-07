import assert from "node:assert/strict";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { classifyResult, isRecordedSignal } = await importRuntimeModule(
  "core/result-classification.js",
);
const { capChannel, parseSurfErrorOutput, SURF_BOOKKEEPING_KEYS } =
  await importRuntimeModule("core/result-payload.js");
const { isKnownResultOutcomeCode, RESULT_RECORDED_SIGNALS } =
  await importRuntimeModule("core/error-codes.js");

/** A RawResult with the fields a caller always has; every case overrides what it exercises. */
function raw(overrides) {
  return {
    source: "cli",
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    durationMs: 5,
    timedOut: false,
    ...overrides,
  };
}

function assertClosed(outcome) {
  assert.equal(
    [
      "success",
      "declared_empty",
      "empty",
      "error",
      "timeout",
      "spawn_failed",
      "unclassifiable",
    ].includes(outcome.class),
    true,
    `class outside the closed set: ${outcome.class}`,
  );
  assert.equal(
    ["evidence", "fault", "no_evidence", "contradiction", "indeterminate"].includes(outcome.basis),
    true,
    `basis outside the closed set: ${outcome.basis}`,
  );
  assert.equal(outcome.ok, ["success", "declared_empty"].includes(outcome.class));
  assert.equal(outcome.evidence[0], `outcome:${outcome.class}:${outcome.code}`);
  assert.equal(outcome.evidence[1], `basis:${outcome.basis}`);
  // The framework's own code vocabulary is closed; a code from a tool it does not own (surf)
  // passes through verbatim (result-classification packet, "Error codes").
  assert.equal(
    isKnownResultOutcomeCode(outcome.code) || outcome.source === "surf",
    true,
    `unregistered code: ${outcome.code}`,
  );
  for (const signal of outcome.recorded) {
    assert.equal(isRecordedSignal(signal), true, `unregistered recorded signal: ${signal}`);
  }
  return outcome;
}

// ---------------------------------------------------------------- transport

test("a spawn failure is a transport fault, never a target verdict", () => {
  const outcome = assertClosed(
    classifyResult(raw({ exitCode: null, spawnFailure: "spawn missing-binary ENOENT" })),
  );
  assert.equal(outcome.class, "spawn_failed");
  assert.equal(outcome.code, "spawn_failed");
  assert.equal(outcome.basis, "fault");
  assert.equal(outcome.error.message, "spawn missing-binary ENOENT");
  assert.equal(outcome.payload.empty, true);
});

test("a budget kill is a timeout, and a kill signal names the signal", () => {
  const timedOut = assertClosed(
    classifyResult(raw({ exitCode: null, signal: "SIGTERM", timedOut: true, stdout: "partial" })),
  );
  assert.equal(timedOut.class, "timeout");
  assert.equal(timedOut.code, "timeout");
  assert.equal(timedOut.basis, "fault");

  const signalled = assertClosed(classifyResult(raw({ exitCode: null, signal: "SIGKILL" })));
  assert.equal(signalled.class, "timeout");
  assert.equal(signalled.code, "signal_SIGKILL");
});

test("a transport failure on a mutating step is indeterminate, never a fault (review A4)", () => {
  const outcome = assertClosed(
    classifyResult(raw({ exitCode: null, timedOut: true, effect: "mutating" })),
  );
  assert.equal(outcome.class, "timeout");
  assert.equal(outcome.basis, "indeterminate");

  const spawnFailed = assertClosed(
    classifyResult(raw({ exitCode: null, spawnFailure: "ENOENT", effect: "mutating" })),
  );
  assert.equal(spawnFailed.basis, "indeterminate");
});

// ---------------------------------------------------------------- cli

test("cli: exit 0 with output is success; exit 0 with nothing is empty, not a fault", () => {
  const ok = assertClosed(classifyResult(raw({ stdout: "usage: tool [options]\n" })));
  assert.equal(ok.class, "success");
  assert.equal(ok.code, "ok");
  assert.equal(ok.basis, "evidence");
  assert.equal(ok.payload.kind, "stdout");
  assert.equal(ok.payload.empty, false);

  const empty = assertClosed(classifyResult(raw({ stdout: "   \n" })));
  assert.equal(empty.class, "empty");
  assert.equal(empty.code, "empty_result");
  assert.equal(empty.basis, "no_evidence");
  assert.equal(empty.ok, false);
  assert.equal(empty.emptiness.declared, false);
  assert.equal(empty.emptiness.declaredBy, "default:output_required");
});

test("cli: a declared empty output is declared_empty with the declaration echoed", () => {
  const outcome = assertClosed(
    classifyResult(raw({ stdout: "" }), {
      output: "empty",
      declaredBy: "config:agents.cli-smoke.expect",
    }),
  );
  assert.equal(outcome.class, "declared_empty");
  assert.equal(outcome.code, "declared_empty");
  assert.equal(outcome.basis, "evidence");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.emptiness.declaredBy, "config:agents.cli-smoke.expect");
});

test("cli: an empty marker must match, and matching text counts as declared emptiness", () => {
  const unmatched = assertClosed(
    classifyResult(raw({ stdout: "" }), {
      output: "empty",
      empty_marker: "no results",
      declaredBy: "config:agents.cli-smoke.expect",
    }),
  );
  assert.equal(unmatched.class, "empty");
  assert.equal(unmatched.emptiness.markerMatched, false);

  const matched = assertClosed(
    classifyResult(raw({ stdout: "No results\n" }), {
      output: "empty",
      empty_marker: "no results",
      declaredBy: "config:agents.cli-smoke.expect",
    }),
  );
  assert.equal(matched.class, "declared_empty");
  assert.equal(matched.emptiness.markerMatched, true);
  assert.equal(matched.emptiness.marker, "no results");
});

test("cli: a non-zero exit is a fault whose message is the diagnostics channel", () => {
  const outcome = assertClosed(
    classifyResult(raw({ exitCode: 2, stdout: "", stderr: "boom: bad flag\n" })),
  );
  assert.equal(outcome.class, "error");
  assert.equal(outcome.code, "exit_2");
  assert.equal(outcome.basis, "fault");
  assert.equal(outcome.error.origin, "exit_code");
  assert.equal(outcome.error.message, "boom: bad flag");
  assert.equal(outcome.transport.stderr, "boom: bad flag");
});

test("cli: stderr is a channel, never payload and never the basis for empty", () => {
  const outcome = assertClosed(classifyResult(raw({ stdout: "", stderr: "Error: something\n" })));
  assert.equal(outcome.class, "empty");
  assert.equal(outcome.payload.bytes, 0);
  assert.deepEqual(outcome.recorded, ["stderr_error_line"]);
});

test("cli: an Error: line on stderr with output on stdout stays success and is recorded", () => {
  const outcome = assertClosed(
    classifyResult(raw({ stdout: "real payload", stderr: "Error: deprecated flag [warn]" })),
  );
  assert.equal(outcome.class, "success");
  assert.deepEqual(outcome.recorded, ["stderr_error_line"]);
});

test("cli: an error key in opaque stdout is recorded, never interpreted", () => {
  const outcome = assertClosed(
    classifyResult(raw({ stdout: JSON.stringify({ error: "nope", data: [1] }) })),
  );
  assert.equal(outcome.class, "success");
  assert.equal(outcome.payload.kind, "stdout");
  assert.deepEqual(outcome.recorded, ["payload_error_key_present"]);
});

test("cli: an unknown target's _meta stays payload under the default opaque contract", () => {
  const outcome = assertClosed(
    classifyResult(raw({ stdout: JSON.stringify({ _meta: { page: 1 }, rows: [] }) })),
  );
  assert.equal(outcome.class, "success");
  assert.deepEqual(outcome.transport.bookkeeping, {});
});

test("cli: a declared JSON payload that does not parse is unclassifiable, never a pass", () => {
  const outcome = assertClosed(
    classifyResult(raw({ stdout: "not json at all" }), {
      payload: "json",
      declaredBy: "config:agents.api.expect",
    }),
  );
  assert.equal(outcome.class, "unclassifiable");
  assert.equal(outcome.code, "invalid_output");
  assert.equal(outcome.basis, "contradiction");
});

test("cli: a declared JSON error envelope wins only where it was declared", () => {
  const body = JSON.stringify({ error: { message: "downstream refused" } });
  const undeclared = assertClosed(
    classifyResult(raw({ stdout: body }), {
      payload: "json",
      declaredBy: "config:agents.api.expect",
    }),
  );
  assert.equal(undeclared.class, "unclassifiable");
  assert.deepEqual(undeclared.transport.contradictions, [
    "exit 0 with an error envelope in a declared JSON payload",
  ]);

  const declared = assertClosed(
    classifyResult(raw({ stdout: body }), {
      payload: "json",
      error_envelope: true,
      declaredBy: "config:agents.api.expect",
    }),
  );
  assert.equal(declared.class, "error");
  assert.equal(declared.error.origin, "json_error_object");
  assert.equal(declared.error.message, "downstream refused");
});

// ---------------------------------------------------------------- surf

test("surf: a JSON error object beats exit 0 and the contradiction is recorded", () => {
  const outcome = assertClosed(
    classifyResult(
      raw({
        source: "surf",
        exitCode: 0,
        stdout: JSON.stringify({
          error: {
            code: "page_login",
            message: "Page is not ready: login",
            details: { state: "login" },
          },
        }),
      }),
    ),
  );
  assert.equal(outcome.class, "error");
  assert.equal(outcome.code, "page_login");
  assert.equal(outcome.basis, "fault");
  assert.equal(outcome.error.origin, "json_error_object");
  assert.deepEqual(outcome.error.details, { state: "login" });
  assert.deepEqual(outcome.transport.contradictions, ["exit 0 with error object"]);
});

test("surf: the [code] stderr line is read when there is no JSON envelope", () => {
  const outcome = assertClosed(
    classifyResult(
      raw({
        source: "surf",
        exitCode: 1,
        stderr: "Error: The extraction script returned zero rows [empty_result]",
      }),
    ),
  );
  assert.equal(outcome.class, "error");
  assert.equal(outcome.code, "empty_result");
  assert.equal(outcome.error.origin, "stderr_code_line");
});

test("surf: an unknown code is kept verbatim and never becomes success", () => {
  const outcome = assertClosed(
    classifyResult(
      raw({ source: "surf", exitCode: 1, stderr: "Error: brand new failure [some_future_code]" }),
    ),
  );
  assert.equal(outcome.class, "error");
  assert.equal(outcome.code, "some_future_code");
  assert.equal(outcome.ok, false);
  assert.equal(isKnownResultOutcomeCode("some_future_code"), false);
});

test("surf: bookkeeping keys are moved to transport, never dropped and never payload", () => {
  const outcome = assertClosed(
    classifyResult(
      raw({
        source: "surf",
        stdout: JSON.stringify({ id: 1, _resolvedWindowId: 2, _resolvedTabId: 3, _hint: "x" }),
      }),
    ),
  );
  assert.equal(outcome.class, "empty");
  assert.equal(outcome.code, "empty_result");
  assert.deepEqual(
    Object.keys(outcome.transport.bookkeeping).sort(),
    [...SURF_BOOKKEEPING_KEYS].sort(),
  );
  assert.equal(
    outcome.evidence.some((line) => line.startsWith("bookkeeping:")),
    true,
  );
});

test("surf: the explicit-target wrapper is transport and the payload is what it wrapped", () => {
  const outcome = assertClosed(
    classifyResult(
      raw({
        source: "surf",
        stdout: JSON.stringify({
          result: { state: "ready", href: "https://example.com/" },
          target: { tabId: 101 },
          notice: null,
        }),
      }),
    ),
  );
  assert.equal(outcome.class, "success");
  assert.equal(outcome.payload.kind, "json");
  assert.equal(outcome.payload.empty, false);
});

test("surf: zero rows are empty without a declaration and declared_empty with one", () => {
  const rows = raw({
    source: "surf",
    stdout: JSON.stringify({ rows: [], rowCount: 0, mode: "owned-tab" }),
  });

  const undeclared = assertClosed(classifyResult(rows));
  assert.equal(undeclared.class, "empty");
  assert.equal(undeclared.payload.kind, "rows");
  assert.equal(undeclared.payload.rowCount, 0);
  assert.equal(undeclared.basis, "no_evidence");

  const declared = assertClosed(
    classifyResult(rows, { output: "empty", declaredBy: "operation:surf.explore.links" }),
  );
  assert.equal(declared.class, "declared_empty");
  assert.equal(declared.emptiness.declaredBy, "operation:surf.explore.links");
});

test("surf: a row carrying an error field is an error on rows surf owns", () => {
  const outcome = assertClosed(
    classifyResult(
      raw({
        source: "surf",
        exitCode: 0,
        stdout: JSON.stringify({
          rows: [{ href: "/a" }, { error: "download failed" }],
          rowCount: 2,
        }),
      }),
    ),
  );
  assert.equal(outcome.class, "error");
  assert.equal(outcome.code, "row_error");
  assert.equal(outcome.error.origin, "payload_error_field");
  assert.deepEqual(outcome.transport.contradictions, [
    "exit 0 with an error field on an extract row",
  ]);
});

test("surf: a success result carrying an error is unclassifiable, not a pass", () => {
  const outcome = assertClosed(
    classifyResult(
      raw({
        source: "surf",
        stdout: JSON.stringify({ success: true, error: "screenshot failed" }),
      }),
    ),
  );
  assert.equal(outcome.class, "unclassifiable");
  assert.equal(outcome.basis, "contradiction");
  assert.deepEqual(outcome.transport.contradictions, ["success: true with an error field"]);
});

test("surf: a scalar payload is success only when it carries something", () => {
  const scalar = assertClosed(classifyResult(raw({ source: "surf", stdout: '"undefined"' })));
  assert.equal(scalar.class, "success");

  const nullPayload = assertClosed(classifyResult(raw({ source: "surf", stdout: "null" })));
  assert.equal(nullPayload.class, "empty");
});

test("surf: a non-zero exit without a contract-bearing line is exit_<n>", () => {
  const outcome = assertClosed(
    classifyResult(raw({ source: "surf", exitCode: 9, stderr: "surf exploded" })),
  );
  assert.equal(outcome.class, "error");
  assert.equal(outcome.code, "exit_9");
  assert.equal(outcome.error.message, "surf exploded");
});

test("surf: the --empty-text readiness state matches a declared marker", () => {
  const outcome = assertClosed(
    classifyResult(
      raw({
        source: "surf",
        stdout: JSON.stringify({ rows: [], rowCount: 0, readiness: { state: "empty" } }),
      }),
      { output: "empty", empty_marker: "no results", declaredBy: "operation:surf.explore.links" },
    ),
  );
  assert.equal(outcome.class, "declared_empty");
  assert.equal(outcome.emptiness.markerMatched, true);
});

// ---------------------------------------------------------------- http

test("http: 200 with a body is success and 200 with nothing is empty", () => {
  const ok = assertClosed(
    classifyResult(raw({ source: "http", exitCode: 0, httpStatus: 200, body: '{"items":[1]}' })),
  );
  assert.equal(ok.class, "success");
  assert.equal(ok.payload.kind, "body");

  const empty = assertClosed(
    classifyResult(raw({ source: "http", exitCode: 0, httpStatus: 200, body: "" })),
  );
  assert.equal(empty.class, "empty");
  assert.equal(empty.basis, "no_evidence");
});

test("http: 204, 304 and HEAD declare their own emptiness through the protocol", () => {
  for (const [status, method] of [
    [204, "GET"],
    [304, "GET"],
    [200, "HEAD"],
  ]) {
    const outcome = assertClosed(
      classifyResult(
        raw({ source: "http", exitCode: 0, httpStatus: status, httpMethod: method, body: "" }),
      ),
    );
    assert.equal(outcome.class, "declared_empty", `status ${status} ${method}`);
    assert.match(outcome.emptiness.declaredBy, /^protocol:http_/);
  }
});

test("http: a status outside the success range is a fault carrying the status code", () => {
  const notFound = assertClosed(
    classifyResult(raw({ source: "http", exitCode: 0, httpStatus: 404, body: "missing" })),
  );
  assert.equal(notFound.class, "error");
  assert.equal(notFound.code, "http_404");
  assert.equal(notFound.error.origin, "http_status");

  const serverError = assertClosed(
    classifyResult(
      raw({
        source: "http",
        exitCode: 0,
        httpStatus: 500,
        body: JSON.stringify({ error: { code: "boom", message: "server" } }),
      }),
    ),
  );
  assert.equal(serverError.code, "http_500");

  const noStatus = assertClosed(classifyResult(raw({ source: "http", exitCode: 0, body: "x" })));
  assert.equal(noStatus.code, "http_unknown");
});

test("http: a 2xx body that disagrees with the status is unclassifiable unless declared", () => {
  const body = JSON.stringify({ error: { code: "downstream", message: "upstream refused" } });
  const undeclared = assertClosed(
    classifyResult(raw({ source: "http", exitCode: 0, httpStatus: 200, body })),
  );
  assert.equal(undeclared.class, "unclassifiable");
  assert.equal(undeclared.basis, "contradiction");

  const declared = assertClosed(
    classifyResult(raw({ source: "http", exitCode: 0, httpStatus: 200, body }), {
      error_envelope: true,
      declaredBy: "config:agents.api.expect",
    }),
  );
  assert.equal(declared.class, "error");
  assert.equal(declared.error.message, "upstream refused");
});

// ---------------------------------------------------------------- bombadil

test("bombadil: a completed run needs a non-empty trace to be success", () => {
  const withTrace = assertClosed(
    classifyResult(
      raw({ source: "bombadil", exitCode: 0, trace: { path: "/tmp/t.jsonl", bytes: 42 } }),
    ),
  );
  assert.equal(withTrace.class, "success");
  assert.equal(withTrace.payload.kind, "trace");
  assert.equal(withTrace.payload.bytes, 42);

  const missingTrace = assertClosed(classifyResult(raw({ source: "bombadil", exitCode: 0 })));
  assert.equal(missingTrace.class, "empty");
  assert.equal(missingTrace.basis, "no_evidence");

  const emptyTrace = assertClosed(
    classifyResult(raw({ source: "bombadil", exitCode: 0, trace: { path: "/tmp/t", bytes: 0 } })),
  );
  assert.equal(emptyTrace.class, "empty");
});

test("bombadil: a runtime error is a fault; violations are not the classifier's business", () => {
  const outcome = assertClosed(
    classifyResult(
      raw({
        source: "bombadil",
        exitCode: 3,
        stderr: "could not start chrome",
        trace: { bytes: 10 },
      }),
    ),
  );
  assert.equal(outcome.class, "error");
  assert.equal(outcome.code, "exit_3");
});

// ---------------------------------------------------------------- invariants

test("no fixture reaches ok: true without a payload or a declaration", () => {
  const cases = [
    [raw({ stdout: "" }), undefined],
    [raw({ stdout: "  \n " }), undefined],
    [raw({ source: "surf", stdout: "{}" }), undefined],
    [raw({ source: "surf", stdout: "[]" }), undefined],
    [raw({ source: "surf", stdout: JSON.stringify({ rows: [], rowCount: null }) }), undefined],
    [raw({ source: "http", httpStatus: 200, body: "" }), undefined],
    [raw({ source: "bombadil", exitCode: 0 }), undefined],
  ];

  for (const [input, declaration] of cases) {
    const outcome = assertClosed(classifyResult(input, declaration));
    assert.equal(outcome.ok, false, `${outcome.source}/${outcome.class} must not be ok`);
    assert.equal(outcome.class, "empty");
  }

  for (const [input] of cases) {
    const declared = assertClosed(
      classifyResult(input, { output: "empty", declaredBy: "author:cli-tester" }),
    );
    assert.equal(declared.ok, true);
    assert.equal(declared.emptiness.declaredBy, "author:cli-tester");
  }
});

test("the recorded-signal vocabulary is closed and never changes a class", () => {
  assert.deepEqual(
    [...RESULT_RECORDED_SIGNALS],
    ["stderr_error_line", "payload_error_key_present", "tester_verdict_overruled"],
  );
  assert.equal(isRecordedSignal("stderr_error_line"), true);
  assert.equal(isRecordedSignal("invented_signal"), false);

  const outcome = classifyResult(raw({ stdout: "payload", stderr: "Error: warn" }));
  assert.equal(outcome.class, "success");
  assert.deepEqual(outcome.recorded, ["stderr_error_line"]);
});

test("evidence renders transport, payload and the stderr channel side by side", () => {
  const outcome = classifyResult(
    raw({
      source: "surf",
      exitCode: 0,
      stdout: JSON.stringify({ id: 9, rows: [{ a: 1 }], rowCount: 1 }),
      stderr: "[surf] attempt 1/3",
    }),
  );
  const joined = outcome.evidence.join("\n");
  assert.match(joined, /^outcome:success:ok\nbasis:evidence\n/);
  assert.match(joined, /transport:exit:0 durationMs:5/);
  assert.match(joined, /payload:rows bytes:\d+ rows:1/);
  assert.match(joined, /bookkeeping:id/);
  assert.match(joined, /stderr:\n\[surf\] attempt 1\/3/);
});

test("a long diagnostics channel keeps its head and tail", () => {
  const long = Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n");
  const capped = capChannel(long);
  assert.match(capped, /^line 0\n/);
  assert.match(capped, /line 199$/);
  assert.match(capped, /\[\.\.\. 145 line\(s\) elided \.\.\.\]/);
  assert.equal(capChannel("short"), "short");
});

test("parseSurfErrorOutput keeps the runtime's failure shape for callers", () => {
  assert.deepEqual(
    parseSurfErrorOutput(JSON.stringify({ error: { code: "page_error", message: "bad" } }), "", 1, [
      "surf",
    ]),
    { code: "page_error", message: "bad" },
  );
  assert.deepEqual(parseSurfErrorOutput("", "", 4, ["surf", "wait.ready"]), {
    code: "error",
    message: "surf wait.ready exited with code 4",
  });
});
