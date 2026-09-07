---
summary: "Design packet for one result-classification contract across the CLI, API and browser testers: strip transport bookkeeping before judging, empty payload is a failure unless declared, exit codes / error codes / JSON error objects normalise into one typed outcome, and the healer and report consume only that outcome."
read_when:
  - "You implement or review result handling in the orchestrator agents, command runner, surf runtime/client or surf explore"
  - "You add a tester (api-fuzzer, a new surf action) and need to know what counts as pass, fail, empty or unclassifiable"
  - "You debug a run that passed although the command, page or endpoint produced nothing"
type: "design"
---

# Result classification contract (2026-09-07)

Row 5 of `docs/project/2026-09-07-surf-learnings-assessment.md`. Sources: the surf-cli-go HOSTERR lesson
(`contrib/docs/learnings/2026-09-06-surf-cli-go-deep-dive.md:182-185`: bookkeeping keys `_resolvedTabId`/`_hint`
appended to every response made data errors exit 0; strip transport metadata before classifying; never let a
"row with an `error` field" exit 0), the zero-rows invariant (`...-deep-dive.md:214-216`, `upwork_jobs.go`
`--allow-empty-results`; the libgen download that stores the error in the row and exits 0,
`...-restricted-verbs-research.md:83-85`), and surf upstream PR #258 (`...-2026-09-07-surf-cli-upstream-prs.md:41`,
`...-branch-dogfood.md:204-205`): first error line ends with `[code]`, `--json` prints `{"error": {code, message,
details}}` on stdout, `stripTransportKeys` removes `id`/`_resolvedWindowId` for `page.readiness`, `frame.diagnose`
and `extract --json` only.

## Problem

Every tester decides pass/fail from a different signal, and several paths read "nothing happened" as success:

1. CLI tester: `src/core/orchestrator.ts:2161-2186` classifies `--help` by `result.code !== 0 || timedOut` only.
   Exit 0 with empty stdout and stderr returns `findings: []`, `edgeCases: 100`. Live reproduction: `targets.cli: "true"`
   passes the suite. The failure evidence at `:2173` is `stderr || stdout || exit code`, mixing channels.
2. Command runner: `src/core/operations/command-runner-core.ts:33-41` returns `{code: 0, stdout: ""}` as success and
   `:13` folds stderr and stdout into one message on failure, so progress lines (surf's `[surf] attempt n/m`,
   `screenshot saved to:`) become the "error".
3. Surf runtime: `src/core/surf-runtime.ts:388` returns `ok: true` for any exit 0. `parseSurfJsonOutput`
   (`:272-297`) refuses empty stdout and unwraps the `{result, target, notice}` wrapper, but strips no bookkeeping
   keys; upstream strips `id`/`_resolvedWindowId` for three tools only, so other `--json` payloads still carry them.
4. Surf client: `src/integrations/surf-client.ts:809-816` resolves `success: true, message: stdout.trim()` on exit 0
   regardless of content; `extract` (`:737-738`) turns a missing `rows` array into `[]` with `rowCount: null` and no
   failure, relying on surf to have raised `empty_result` (`:709-710`); `attachScreenshotIfEnabled` (`:783-788`) can
   return `{success: true, error: "..."}`, the "success object with an error field" class from HOSTERR.
5. Surf explore already has the invariant, but hardcoded: empty stdout is refused (`surf-explore-operation.ts:416-420`),
   the links probe passes `--allow-empty` unconditionally (`:541`) and labels it "zero rows accepted explicitly"
   (`:570`); `empty` is a settled readiness state (`:81`) although the operation never passes an empty marker.
6. Bombadil and terminal fuzzer: `src/core/orchestrator.ts:1940-1945` and `:2025-2028` map `completed` and
   `budget_exhausted` to `edgeCases: 100` without looking at output; stdout/stderr are grepped for `error|failed` only
   while rendering evidence for an already-failed run (`:1871-1878`), never for classification.
7. Status derivation: `normalizeKnownAgentResult` (`:1705-1708`) sets `passed` when `findings.length === 0`; success
   evidence is a synthesized string (`:1723`, `:1816`). `TestResult.passed` (`:634`) is `!blockingFindings &&
   coverage.overall > 0`. No typed outcome exists between the process result and the finding.
8. API tester exists only as a prompt: `prompts/api-tester.md:96` `res.ok ? "pass" : "fail"` (HTTP 200 with an empty
   body is a pass); `prompts/cli-tester.md:89-93` records `exit_code`/`output` but the verdict rule is free text.
   `agent:api-fuzzer` is `unsupported` in `governance/capability-passport.json`, so the contract must be written
   before the agent exists.
9. Healer and report consume strings: `src/core/operations/heal-operation.ts:138-145` accepts `evidence: string[]`
   (passthrough), `src/healing/self-healing.ts:671-710` regex-mines selectors from evidence text;
   `summarizeTestResult` (`src/core/operations/test-operation.ts:43-51`) reduces to `pass|fail` + counts.

## Placement

One pure module, `src/core/result-classification.ts` (no I/O, no surf or child-process imports), with one entry point
`classifyResult(input: RawResult, declaration: ExpectDeclaration | undefined): ResultOutcome` (revised by refinement: the
declaration carries `output`, `empty_marker`, `payload` and `error_envelope`, plus the protocol-derived defaults). Call sites:
`command-runner-core.ts:runCommand`, `surf-runtime.ts:runSurfCommand`, `surf-client.ts:run`/`extract`, the four
orchestrator agents (`CliTesterAgent`, `SurfAgent`, `BombadilAgent`, `TerminalFuzzerAgent`; the `SurfAgent` catch site
at `orchestrator.ts:2101-2117` must carry the outcome's basis instead of folding every explore error into one critical
finding, and Bombadil status comes from typed fields, exit contract and trace presence, never from `looksLikeViolation`'s
regex at `bombadil-runtime.ts:196-198`; revised by adjudication: claims 45, 46) and the explore probes
(`runJsProbe`, `runLinksProbe`, `gateReadiness`). The healer (`heal-operation.ts`) and the report
(`test-operation.ts`, `docs/api/types.md`) read `ResultOutcome` and nothing else. Config declarations live in the
strict zod schema in `src/core/orchestrator.ts:44-176` and in `docs/api/config.md`; operations declare in code.

Revised by architecture review (A7, Q3): this module defines `RawResult { source, exitCode, signal, stdout, stderr,
durationMs, httpStatus?, body? }`, and the kernel owns one process boundary, `spawnStep(source, argv, { timeoutMs, env }):
RawResult`. `SurfClient.run`, `runSurfCommand`, `command-runner-core.runCommand`, `CliTesterAgent.runCommand` and
`runBombadil` become callers of it, so the classifier has one input shape and the mutation-safety packet's `runStep` can
be the only mutating caller (checked by a contract test that greps `src/` for `spawn(`/`spawnSync(` outside the kernel).

## Current state

- Exit-code-only classification in the CLI tester and command runner; surf paths have error codes (`SurfCommandError`,
  `surf-runtime.ts:67-89`, `parseSurfErrorOutput` `:303-339` handles JSON error objects, `[code]` suffix, fallback).
- Emptiness handled in three inconsistent ways: refused (`parseSurfJsonOutput:274`, `assertProbeEvidence:416`),
  accepted by hardcoded flag (`runLinksProbe:541`), ignored (CLI tester, Bombadil, HTTP prompt).
- Transport separation exists only for the surf `{result, target, notice}` wrapper (`surf-runtime.ts:285-294`).
- Root-cause classes (`orchestrator.ts:268-280`) are a separate, evidence-text-driven vocabulary; they stay.
- Test fixtures: `tests/fixtures/fake-surf.mjs` has `FAKE_SURF_FAIL_ON` (exit 9) and `FAKE_SURF_EMPTY_ON` (exit 0,
  no output, `:25`, `:116-118`); no zero-rows or bookkeeping-only fixture.

## Contract

### Outcome type

```ts
export type OutcomeClass = "success" | "declared_empty" | "empty" | "error" | "timeout" | "spawn_failed" | "unclassifiable";
// revised by refinement: `basis` separates "no evidence" from "target fault" so the healer and report never
// present an undeclared empty run as a bug in the target.
export type OutcomeBasis = "evidence" | "fault" | "no_evidence" | "contradiction" | "indeterminate";
// revised by architecture review (A4): `indeterminate` = transport failed with no signal from the target (timeout,
// signal, null exit) on a mutating step; set by the mutation ledger when its outcome is `unknown`; healer and report
// treat it like `contradiction` (nothing to heal, not a target fault).
export interface ResultOutcome {
  class: OutcomeClass;
  ok: boolean;                         // true only for "success" | "declared_empty"
  basis: OutcomeBasis;                 // evidence: success|declared_empty; fault: error|timeout|spawn_failed;
                                       // no_evidence: empty; contradiction: unclassifiable
  code: string;                        // "ok" | "declared_empty" | "empty_result" | "exit_<n>" | "signal_<name>" | "timeout"
                                       // | "spawn_failed" | "invalid_output" | "unclassifiable" | surf code | "http_<status>"
  source: "cli" | "surf" | "http" | "bombadil";
  transport: { exitCode: number | null; signal?: string; httpStatus?: number; durationMs?: number;
               stderr: string;                        // whole channel, trimmed, capped; never payload
               bookkeeping: Record<string, unknown>;  // surf only; every stripped key lands here
               contradictions: string[] };            // e.g. "exit 0 with error object"
  payload: { kind: "stdout" | "json" | "rows" | "body" | "trace"; bytes: number; rowCount?: number; empty: boolean };
  emptiness?: { declared: boolean; declaredBy: string; marker?: string; markerMatched?: boolean };
  error?: { code: string; message: string; details?: Record<string, unknown>; origin: "json_error_object" | "stderr_code_line" | "exit_code" | "payload_error_field" | "http_status" };
  recorded: string[];                  // signals seen under no contract and therefore not interpreted:
                                       // "stderr_error_line", "payload_error_key_present", "tester_verdict_overruled"
  evidence: string[];                  // at least one line, first line is `outcome:<class>:<code>`, second `basis:<basis>`
}
```

### Classification order (deterministic; the first matching step decides)

1. Transport failure: spawn error → `spawn_failed`; timeout/kill signal → `timeout` (code `timeout` or `signal_<name>`).
   Basis `fault` for read-only steps; `indeterminate` when the step is mutating and the mutation ledger records
   `unknown` (revised by architecture review: A4).
2. Separate channels, before any judgement (revised by refinement: stderr is a channel, not candidate payload, so
   the progress-line pattern list is gone). Exit code, signal and HTTP status go to `transport`; stderr goes whole
   (trimmed, capped) to `transport.stderr` and is never payload, never the basis for `empty`, never pattern-stripped.
   For `source: "surf"` only: the `{result, target, notice}` wrapper is unwrapped and bookkeeping keys move from the
   payload object into `transport.bookkeeping` (the versioned set `id`, `_resolvedWindowId`, `_resolvedTabId`,
   `_hint`, plus any top-level key starting with `_`). For `cli` and `http` nothing is stripped: an unknown target's
   `_meta` is payload. What remains on stdout or in the body is the payload.
3. Error signals, interpreted only under an owned or declared contract (revised by refinement; unowned shapes are
   recorded in `recorded`, not interpreted). Basis `fault`.
   - `surf`: JSON `{"error": {code, message, details}}` on stdout; first stderr line `Error: <message> [code]` (code
     defaults to `error`); an `error` field on an extract row (`payload_error_field`, code `row_error`); non-zero
     exit (`exit_<n>`). An error object with exit 0 is an error; the exit 0 goes to `transport.contradictions`.
   - `cli`: non-zero exit (`exit_<n>`) decides. With `expect.payload: json` declared: unparsable stdout →
     `invalid_output`; a non-null top-level `error` key with exit 0 → step 6. Without the declaration stdout is
     opaque; an `Error:` line on stderr or an `error` key in stdout is recorded (`stderr_error_line`,
     `payload_error_key_present`) and does not change the class.
   - `http`: status outside the declared set (`http_<status>`). A 2xx status with a JSON body carrying a non-null
     top-level `error` → step 6 (status and body disagree), unless `expect.error_envelope: true` is declared, in which
     case the envelope wins and the class is `error` with origin `json_error_object`.
   - `bombadil`: a runtime error → `error`; `violation` is not the classifier's business (see Non-goals).
   - the framework's own `SurfActionResult` shape: `success: true` carrying `error` → step 6.
4. Emptiness. Basis `no_evidence` unless declared. The payload is empty when stdout after step 2 is whitespace, the
   JSON payload is `null`/`{}`/`[]`, `rows` is `[]` and `rowCount` is `0` or `null`, the HTTP body has zero bytes, or
   (revised by refinement) the Bombadil trace file is missing or has zero bytes (`payload.kind: "trace"`; the runtime
   exposes no step count, `bombadil-runtime.ts:55-58`). Declarations come from config (`expect`), from operation
   code, or from protocol (`http` 204, 304, and any HEAD response, echoed as `declaredBy: "protocol:http_<status>"`).
   A declaration authored by an LLM tester (plan fields, `a11y-role` assertions, `frameHint`) carries
   `declaredBy: "author:<tester>"` and is enforced deterministically like any other (revised by adjudication: claim 4).
   Empty + declaration with a matched marker (or a declaration without marker) → `declared_empty` (ok, basis
   `evidence`). Empty without declaration, or marker not matched → `empty`, code `empty_result`, `ok: false`.
5. Otherwise `success`, code `ok`, basis `evidence`.
6. Anything that reaches no class (JSON expected but unparsable, scalar where an object was required, a `success: true`
   object carrying `error`, a 2xx with an undeclared error envelope, readiness state outside the typed set) →
   `unclassifiable`, `ok: false`, basis `contradiction`, with the raw preview in evidence. Unclassifiable never becomes
   a pass and never becomes a retry.

### Declaring acceptable emptiness

Config (strict schema; the key is added to `AgentConfigSchema`, which lives in the kernel `src/core/config.ts` after
operator decision D4, and to `docs/api/config.md`; `RuntimeConfigLike` is derived from the schema, not hand-mirrored;
revised by adjudication: claim 49):

```yaml
agents:
  cli-smoke:
    type: cli-tester
    expect:
      output: required        # required (default) | empty
      empty_marker: "no results"   # optional; when set, must match the trimmed stdout or the surf `--empty-text` state
      payload: opaque         # opaque (default) | json  — revised by refinement: only a declared json payload is
                              # parsed for an error envelope; opaque stdout is judged for emptiness alone
      error_envelope: false   # http/json only — revised by refinement: true lets a 2xx `{"error": ...}` body win
                              # over the status (class error); false (default) makes it `unclassifiable`
```

Operations declare in code with the same shape, and the declaration is echoed in the outcome as
`emptiness.declaredBy` (`config:agents.cli-smoke.expect`, `operation:surf.explore.links` or, for HTTP 204/304/HEAD,
`protocol:http_<status>`; revised by refinement: protocol facts count as declarations so the default does not
produce systematic false fails where emptiness is the protocol's own meaning). Surf explore keeps
accepting zero link rows, because its payload is the probe object (`__testCapabilitiesSurfExploreProbe`, `href`,
`title`), not the rows; the declaration becomes an explicit `SURF_EXPLORE_LINKS_EMPTINESS` constant replacing the bare
`--allow-empty` at `surf-explore-operation.ts:541`, and the readiness gate accepts `empty` only when the operation
passed an empty marker (it passes none today, so `empty` becomes a `page_not_ready` refusal at `:300-306`).

### Error codes

Surf codes pass through unchanged (`page_login`, `page_challenge`, `page_not_found`, `page_error`, `page_timeout`,
`empty_result`, `no_output`, `browser_error`, `spawn_failed`). Process codes are `exit_<n>`, `signal_<name>`,
`timeout`. HTTP codes are `http_<status>`. Classifier-owned codes are `ok`, `declared_empty`, `empty_result`,
`row_error`, `invalid_output`, `unclassifiable`. The vocabulary is exported as `RESULT_OUTCOME_CODES` and asserted by
a contract test; unknown codes from surf are kept verbatim and marked `error`, never `success`. Recorded-signal
names (`stderr_error_line`, `payload_error_key_present`, `tester_verdict_overruled`) are exported as
`RESULT_RECORDED_SIGNALS` and asserted the same way; a recorded signal never changes a class. Framework codes are carried by `FrameworkError { code, details }`
(`src/core/runtime-contract.ts`) and registered in `src/core/error-codes.ts` as namespaced `as const` arrays with a
uniqueness test; the CLI prints `[code]` in text mode and `{"error": {code, message, details}}` with exit 1 under
`--json`, the same shape this classifier parses from surf; `docs/api/errors.md` is updated with it (revised by
architecture review: A6, Q5).

### Backwards compatibility

- `Finding` and `Observation` (`orchestrator.ts:300-313`) gain optional `outcome?: ResultOutcome`; the evidence array
  keeps its existing lines and gains the `outcome:<class>:<code>` first line, mirroring the `failureClass:<class>`
  convention (`docs/api/types.md:417`). Existing `test --json` receipts stay parseable; `heal --findings-input`
  accepts old and new envelopes because `HealingFindingSchema` is passthrough (`heal-operation.ts:145`).
- `TestOperationSummary` gains `outcomes: Record<OutcomeClass, number>` and `bases: Record<OutcomeBasis, number>`;
  `health` semantics do not change. `TestResult` gains `determination: { value: verified | failed | unverified |
  indeterminate, basis, reason }` next to `passed`, which becomes `determination.value === "verified"`, so the third
  state reaches the top level; exit codes stay 0/1 with `unverified | indeterminate` mapping to 1 and exit 2 revisited
  once consumers read the envelope (revised by adjudication: claim 7; operator decision D3).
- `governance/capability-passport.json` gains `contract:result-classification` (generated by
  `scripts/generate-capability-passport.mjs`) with the contract test as evidence.
- `SurfCommandError` keeps `code`, `details`, `exitCode`, `stdout`, `stderr` and gains `outcome`.

## Behaviour and failure modes

- Fail closed: `unclassifiable` and `empty` are failures with `severity: critical` findings for CLI and browser
  sensors (they block `TestResult.passed` and set the sensor's coverage to 0). Revised by refinement: the finding for
  `empty` describes "no evidence", not a target failure; its recommendation names both resolutions, fix the target's
  output or declare `expect.output: empty` (verbatim, and `init` writes `# expect: { output: empty }` as a commented
  hint; revised by architecture review: A16), and the evidence carries `basis:no_evidence`. The finding for
  `unclassifiable` describes the contradiction and carries `basis:contradiction`.
- The healer proposes only from findings with `basis: fault` (revised by refinement); it refuses `no_evidence`
  (no selector evidence can exist), `contradiction` (nothing to heal from contradictory evidence) and `indeterminate`
  (the mutation ledger's `unknown`; nothing is known about the target, A4). Legacy findings
  without an outcome are accepted with a `legacy_evidence` note until the cutover test flips.
- LLM testers (`prompts/cli-tester.md`, `prompts/api-tester.md`) receive the outcome as their floor (revised by
  refinement): a tester may add findings and may lower a verdict, but a tester `verdict: pass` for a step whose
  outcome is not ok is discarded, recorded as `tester_verdict_overruled`, and the step stays failed. The receipts
  state that the classifier is a floor; semantic correctness of a `success` payload is the tester's finding, never
  the classifier's class.
- The report renders `outcome.code`, `outcome.basis` and `transport.exitCode` side by side so an "exit 0 but error
  object" case is visible; bookkeeping keys and `recorded` signals are shown under transport, never as payload.
- Stderr is rendered as a labelled channel in failure evidence (`exit_<n>` first line, then a stderr excerpt) instead
  of being folded into one message (`renderCommandExitFailure`, `command-runner-core.ts:13`). Revised by refinement:
  no progress-line pattern list exists; a wrong bookkeeping constant (surf only) shows up as a recorded stripped key
  in evidence instead of silently changing a verdict.

## Non-goals

Retry policy and mutation safety (`2026-09-07-mutation-safety-design.md`); implementing the `api-fuzzer` agent (the
contract is written so it inherits `source: "http"`); changing surf upstream; changing the root-cause failure-class
vocabulary; rewriting the LLM prompts beyond stating the contract; classifying Bombadil violations (they stay
`property_violation` findings; the classifier only decides whether the run produced a payload).

## Risks

- Legitimately silent commands (`--quiet`, `true`) now fail until declared, and that cost is permanent: the run
  alone cannot distinguish "did the right thing quietly" from "did nothing". Mitigated by the `expect.output: empty`
  declaration, a finding that says "no evidence" rather than "bug", and protocol-level declarations for HTTP so the
  default does not fire systematically where emptiness is the protocol's meaning (revised by refinement).
- Contract scoping leaves a `cli` target that prints `Error:` to stderr and exits 0 as `success` (revised by
  refinement: the classifier no longer interprets unowned shapes). The line is recorded as `stderr_error_line`; the
  tester layer may raise a finding from it (it may lower a verdict, never raise one). The alternative, interpreting
  every `Error:` line and `error` key on every target, manufactures false errors of the same class as the false
  passes this packet removes.
- Surf explore coverage may drop where pages report `empty` readiness; mitigated by the explicit marker path and a
  dogfood comparison before/after.
- Bookkeeping key drift across surf versions; scoped to `source: "surf"` (revised by refinement), mitigated by the
  `_`-prefix rule, recording every stripped key, and the version probe already in `surf-runtime.ts`.
- Duplicated error detection between `parseSurfErrorOutput` and the classifier; mitigated by making the classifier the
  only caller of the parser.
- `transport.stderr` capping can hide the line a human needs; mitigated by keeping the cap generous (the first and
  last N lines) and by the full stderr still reaching `SurfCommandError.stderr`.

## Verification and dogfood plan

1. `tests/result_classification_contract.test.mjs`: fixtures per class and source (cli: exit 0 empty, exit 0 output,
   exit 2 stderr, signal, timeout, exit 0 with `Error:` on stderr and output on stdout → `success` +
   `stderr_error_line`, exit 0 with `_meta` in stdout JSON under `payload: opaque` → payload kept; surf: JSON error
   object with exit 0, `[code]` stderr line, bookkeeping-only payload, `{rows: [], rowCount: 0}` with and without
   declaration, scalar payload, `success: true` + `error`; http: 200 empty body → `empty`, 204 empty body →
   `declared_empty` by protocol, 200 body, 200 with `{"error": {...}}` → `unclassifiable` without and `error` with
   `error_envelope: true`, 404, 500 with JSON error; bombadil: completed with a missing trace → `empty`, completed
   with a trace → `success`). Asserts order, codes, `ok`, `basis`, stripped-key and recorded-signal recording, and
   that no fixture reaches `ok: true` without a non-empty payload or a declaration.
2. Extend `tests/command_runner_contract.test.mjs`, `tests/surf_runtime_contract.test.mjs`,
   `tests/surf_client_contract.test.mjs`, `tests/orchestrator_fail_closed_contract.test.mjs` (CLI tester with
   `targets.cli: "true"` must fail; with `expect.output: empty` must pass and carry `declared_empty`).
3. Fake surf: add `FAKE_SURF_ZERO_ROWS_ON` (exit 0, `{"rows":[],"rowCount":0,"mode":"owned-tab"}`) and
   `FAKE_SURF_BOOKKEEPING_ONLY_ON` (exit 0, `{"id":1,"_resolvedWindowId":2}`) to `tests/fixtures/fake-surf.mjs`; explore
   must report `declared_empty` for the links probe and `empty` for a state probe.
4. Live CLI tester: `targets.cli: "true"` (exit 0, empty) → suite fails with `empty_result`; `targets.cli:
   "./scripts/rocs.sh"` or the demo fixture → `ok`; a command printing only to stderr with exit 0 → `empty`.
5. Live surf explore against the agent browser (`scripts/test-agent-browser.sh`, per
   `docs/project/2026-09-07-surf-cli-migration-live-run.md`): docs.python.org (ready, rows), a search page with
   `--empty-text` semantics (readiness `empty` → refusal without a marker), and the GitHub login bounce (`page_login`
   → `error`). Record before/after `coverage.userFlows` in a diary entry.
6. Gates: `npm run check`, `npm test`, `loop-impact-plan` → `loop-impact-wide` when it says so; regenerate the passport.

## Open questions

- Does surf ever return readiness `empty` without `--empty-text`? If yes, the refusal in the explore gate needs a
  marker-less acceptance path or explore must start passing a marker.
- Closed by refinement: `expect` lives per agent (the sensor that produces the payload owns its declaration; the
  base rate of legitimate emptiness differs per sensor), with protocol-level declarations as a third source; a
  per-target layer is not needed for the API agent to inherit the contract.
- Closed by refinement: a Bombadil `completed` run is `success` only with a non-empty trace payload; a missing or
  empty trace is `empty` (no evidence), not `unclassifiable` (nothing contradicts). A step count, when the runtime
  exposes one, refines emptiness but does not change the class set.
- Closed by refinement: stderr is transport, never payload, for every source; the `Error: <message> [code]` line is
  interpreted for `source: "surf"` only. The earlier proposed default ("payload") contradicted dogfood item 4 and is
  withdrawn.

## Decision log

- 2026-09-07: one classifier module, pure and shared, instead of per-tester fixes; every tester passes through it.
  Confirmed by refinement: per-tester judgement fails because no tester has a refusal state, not because testers
  judge badly.
- 2026-09-07: transport is separated before classification (HOSTERR lesson); stripped keys are recorded, never dropped.
  Revised by refinement: stderr is a recorded channel for every source and never payload; the progress-line pattern
  list is dropped; bookkeeping stripping is scoped to `source: "surf"`. Reason: the pattern list existed only because
  stderr was treated as candidate payload, and `_`-prefix stripping on unowned payloads loses real data.
- 2026-09-07: error object beats exit code; exit 0 with an error object is an error. Revised by refinement: only under
  an owned or declared contract (surf envelope, `[code]` line and rows; the framework's own action result; a declared
  `expect.payload: json` / `error_envelope`). On opaque `cli` stdout and `http` bodies the exit code or status decides
  and the signal is recorded. Reason: "never let a row with an `error` field exit 0" is a theorem about rows surf owns
  and shotgun parsing about rows it does not; the false errors it would manufacture are the same class of bug as the
  false passes.
- 2026-09-07: empty payload is a failure by default; acceptance is declared in config (`expect`) or in operation code
  and echoed in the outcome; surf explore's zero-rows acceptance becomes such a declaration. Revised by refinement:
  kept, with two constraints. `empty` carries `basis: no_evidence` and is never presented as a target fault, and
  protocol facts (HTTP 204/304/HEAD) count as declarations. Reason: the loss matrix is asymmetric (a false pass is
  invisible and compounds, a false fail names its own fix), so the default fails closed; but the false fail is only
  cheap if it attributes honestly and does not fire where emptiness is the protocol's own meaning.
- 2026-09-07: `unclassifiable` is a terminal failure class; nothing downstream may reinterpret it. Confirmed by
  refinement; it carries `basis: contradiction`.
- 2026-09-07: healer and report read `ResultOutcome` only; free-text evidence remains for humans and legacy receipts.
  Revised by refinement: the healer proposes from `basis: fault` only.
- 2026-09-07 (added by refinement): LLM tester verdicts are monotone over the outcome. A tester may add findings and
  lower a verdict; it may never lift `ok: false`; an overruled `pass` is recorded. Reason: the floor must be a
  replayable function of recorded fields and must not be steerable through the payload it judges.
- 2026-09-07 (added by refinement): a Bombadil `completed` run is `success` only with a non-empty trace payload.
  Reason: `completed` → `edgeCases: 100` without a payload is the same silent pass as `targets.cli: "true"`.
- 2026-09-07 (revised by architecture review: A4): `basis` gains `indeterminate` so the mutation-safety packet's
  `unknown` never renders as a target fault.
- 2026-09-07 (revised by architecture review: A7, Q3): `RawResult` and one kernel `spawnStep` are defined here; the
  five process runners become callers.
- 2026-09-07 (revised by architecture review: A6, Q5): the framework adopts surf's error envelope and `[code]` suffix
  through `FrameworkError` and the code registry.
- 2026-09-07 (revised by architecture review: A16): the `empty` finding names `expect.output: empty` verbatim and `init`
  emits the commented hint.
- 2026-09-07 (revised by adjudication: claims 4, 7; operator decision D3): `declaredBy` gains `author:`; the run verdict
  is a `Determination` with a basis next to `passed`; exit codes stay 0/1 for now.
- 2026-09-07 (revised by adjudication: claims 45, 46, 49; operator decision D4): the `SurfAgent` catch site and Bombadil
  status are named call sites of this contract; the config schema lives in the kernel and `RuntimeConfigLike` is
  derived from it.

## Refinement (many-of-the-greats)

Adjudication run on 2026-09-07 against the code as it stands: `runCommand` throws on non-zero and returns
`{code: 0, stdout: ""}` as success (`command-runner-core.ts:33-41`); `runSurfCommand` returns `ok: true` for any
exit 0 and calls `parseSurfErrorOutput` only on non-zero (`surf-runtime.ts:373-388`); `SurfClient.run` resolves
`success: true, message: stdout.trim()` on exit 0 (`surf-client.ts:809-816`); `gateReadiness` treats `empty` as
settled (`surf-explore-operation.ts:81`, `:300-306`) while `runLinksProbe` hardcodes `--allow-empty` (`:541`);
`CliTesterAgent` decides `--help` by `timedOut || code !== 0` (`orchestrator.ts:2161`). The packet above was written
before this section; the sections it changes are marked `revised by refinement:`.

### QUESTION

In a fail-closed testing framework whose pass verdict is consumed by a healer and a report, should the pass/fail
decision for every sensor run (CLI process, surf browser command, HTTP call, Bombadil run) be made by one central,
pure classifier that maps the raw result onto a closed set of outcome classes, with `ok: true` reachable only through
a non-empty payload or an explicit emptiness declaration; as opposed to (a) each sensor deciding by its own signal,
(b) the Unix rule that exit 0 is success and stdout is opaque data, or (c) the LLM tester judging the raw output?
Underneath that: what proposition does "pass" assert, "the target did not fail" or "this run produced evidence that
the target works"; given the answer, is "empty is failure unless declared" the correct default; and which signals may
a classifier interpret at all when it does not own the shape they arrive in?

### MODE 1 — MANY OF THE GREATS

#### School 1: Unix exit-code and composability tradition
- Core claim: the exit status is the only universal, author-controlled, composable success signal. Stdout is data,
  stderr is diagnostics, silence is success. A program that exits 0 has done what it was asked; nothing outside it is
  entitled to a second opinion.
- Premises: the program's author is the sole authority on what the program's success means; callers compose programs
  without interpreting their output; interpretation belongs to the next program in the pipe, which receives stdout
  and nothing else.
- Strongest case: `true` prints nothing and is correct. `grep -q`, `--quiet`, `rm -f`, every idempotent command that
  had nothing to do: correct, silent, exit 0. Any rule that reads silence as failure is a rule about the caller's
  expectations, not about the program. Every heuristic laid over stdout, an `error` key here, a `_`-prefixed key
  there, is an interpretation of a shape the interpreter does not own, and each one manufactures a new class of false
  verdicts. When the exit code is wrong, the bug is in the program and the fix is in the program.
- What it sees that others miss: that "empty output is failure" is a statement about the test, not the target; that
  a classifier which second-guesses exit codes on unowned shapes trades one silent error for another; that stderr
  with exit 0 is the normal shape of a warning, not a contradiction.

#### School 2: Type-driven contracts ("parse, don't validate")
- Core claim: interpret a signal exactly once, at the boundary, into a closed type that makes illegal states
  unrepresentable; interpret only signals whose shape is a contract you own or were given; carry everything else
  through unread.
- Premises: scattered validation re-derives the same fact at every call site with different answers (which is
  precisely the nine problem items above); a sum type with an explicit "I could not parse this" variant is the
  mechanism that stops validation from leaking; a rule applied to a shape nobody promised is not parsing, it is
  guessing.
- Strongest case: the framework owns three shapes, surf's error envelope and `[code]` line (upstream PR #258), surf
  extract rows, and its own `SurfActionResult`. On those, "an error object with exit 0 is an error" is a theorem.
  Generalised to any row of any CLI or any JSON body of any API, `error`-field-on-any-row becomes shotgun parsing:
  `{"error": null, "data": [...]}` fails, a log viewer whose rows have an `error` column fails, a CLI that emits
  `_meta` loses payload to bookkeeping. The HOSTERR lesson is true inside surf-cli-go, which owns its rows; it is not
  a law of nature.
- What it sees that others miss: that the packet's step 2 and step 3 heuristics are inherited from a tool that owned
  its schema and are being applied to tools that do not; that `unclassifiable` is not a failure of the classifier but
  its most important output.

#### School 3: Statistical decision theory of test verdicts
- Core claim: a verdict is a decision under uncertainty; choose the default by the loss matrix, not by symmetry. A
  false pass is invisible, compounds (the healer and report build on it), and is detected only by an incident. A
  false fail is visible, names its own fix, and is corrected once.
- Premises: the two error types have different costs and different base rates per sensor; a `--help` that prints
  nothing is anomalous (base rate near zero), an HTTP 204 with an empty body is normal (base rate high); the cost of
  a false fail is bounded only if the finding attributes correctly and the correction is cheap.
- Strongest case: the assessment's row 5 names the motive exactly, "an empty result reading as success is the silent
  false negative". `targets.cli: "true"` passing a suite with `edgeCases: 100` is not a corner case, it is the
  framework asserting coverage it did not obtain. Fail closed where legitimate emptiness is rare; declare at the
  protocol level where it is common; never let the false-fail finding claim a "critical bug in the target" when the
  evidence only supports "no evidence".
- What it sees that others miss: that `empty` is not a fault, it is the absence of information, and a finding that
  reports it as a target bug is itself a false claim; that alarm fatigue from a wrongly placed default is a real
  second-order cost, which is why the default must be per sensor, not global.

#### School 4: Observability and structured-logging engineering
- Core claim: separate channels before interpreting any of them; record the raw signal complete and structured;
  a verdict must be a replayable function of recorded fields.
- Premises: any classification derived from text folding (`stderr.trim() || stdout.trim() || "exited with code"`) or
  from a regex over concatenated output (`/violation|error|failed/i` at `orchestrator.ts:1871-1878`) is unreproducible
  and cannot be audited after the fact; a signal that is stripped without being recorded has changed a verdict
  silently.
- Strongest case: the surf progress lines becoming "the error" is not a pattern-matching problem, it is a channel
  problem: stderr was folded into a payload it never belonged to. Recording stderr whole as transport removes the
  need for a pattern list at all. The `outcome:<class>:<code>` first line and every stripped key under
  `transport.bookkeeping` are what make the verdict replayable.
- What it sees that others miss: that a versioned list of progress-line patterns is a symptom, not a fix; that the
  packet's own dogfood item 4 (stderr-only exit 0 is `empty`) and open question 4 (stderr as payload by default)
  contradict each other because the channel discipline was never stated.

#### School 5: LLM-as-judge
- Core claim: only a reader of meaning can say whether `--help` printed help, whether a 200 body is a stubbed error
  page, whether "0 results" is the right answer for that query. Structure is blind to content; tests exist to verify
  behaviour and behaviour is semantic.
- Premises: rubric-driven judgement generalises where a closed class set cannot; the cost of a fixed vocabulary is
  every failure it has no word for.
- Strongest case: `success` with a non-empty payload is still no evidence of correctness. A CLI that prints its
  version when asked for help is `success` to the classifier and a bug to any reader. The classifier is a floor, and
  a framework that stops at the floor tests plumbing, not the product.
- What it sees that others miss: that the closed contract will be satisfied by wrong output forever, and only a
  semantic layer above it can catch that.

#### School 6: Safety-critical fail-closed reliability
- Core claim: every path must reach an explicit state; the absence of an error is not the presence of success;
  anything unrecognised is a refusal with a reason; any default that widens acceptance is declared at the point of
  use and auditable.
- Premises: silent degradation is the worst failure mode; a system that cannot say "I don't know" will say "yes";
  interlocks bypassed in code (`--allow-empty` hardcoded, `completed` mapped to `edgeCases: 100`,
  `{success: true, error: "..."}`) are the failures that ship.
- Strongest case: the framework's product posture is fail-closed. `unclassifiable` as a terminal state that nothing
  downstream may reinterpret is the interlock; a declaration echoed into the outcome (`declaredBy`) is the audit
  trail; the closed class set is what makes "every path reaches a state" checkable by a contract test.
- What it sees that others miss: that the question "who classifies" is secondary to "can the classifier refuse";
  per-tester judgement fails not because testers are wrong but because none of them has a refusal state.

### MODE 2 — CONFRONTATION

#### Clash 1: Unix tradition vs fail-closed reliability
- Fundamental contradiction: what "pass" asserts. Unix success is the program's proposition, "I did what I was
  asked". The framework's pass is the framework's proposition, "this run is evidence the target works". Both are true
  at once for `true`; they are propositions about different subjects.
- Incompatible assumptions: Unix assumes the caller does not interpret; interpreting is the framework's entire job.
- What Unix explains better: why silent commands are correct, why exit code is the fault signal inside the process
  boundary, why heuristics on unowned stdout create new errors.
- What fail-closed explains better: why `targets.cli: "true"` passing is unacceptable: not because `true` is wrong,
  but because the test asserted nothing and reported 100.
- Residual tension: for a target whose correct behaviour is silence, the run alone cannot distinguish "did the right
  thing quietly" from "did nothing". A declaration is the only bridge. That cost is permanent and must not be
  engineered away by a smarter heuristic.

#### Clash 2: Type-driven contracts vs the HOSTERR heuristics
- Fundamental contradiction: "never let a row with an `error` field exit 0" (a rule about rows surf-cli-go owns)
  against "interpret only shapes you own". Generalised to any payload it is validation of unknown structure.
- Incompatible assumptions: "any row" versus "owned row".
- What HOSTERR explains better: the one row with an error field that exited 0 and hid for weeks.
- What type-driven explains better: the false errors that the generalised rule will manufacture on `cli` and `http`
  payloads, which are the same class of bug as the false passes, pointed the other way.
- Residual tension: resolvable. Scope the rule to owned or declared shapes; record the key's presence everywhere
  else. The disagreement was verbal once the scope is named.

#### Clash 3: Decision theory vs Unix on the default
- Fundamental contradiction: whether a verdict is a fact (the exit status) or a decision with costs.
- Incompatible assumptions: symmetric ignorance ("don't guess") versus asymmetric loss ("the invisible error must be
  made impossible, the visible one cheap").
- What decision theory explains better: the assessment's motive; the base-rate argument for `--help`; why the default
  must be fail closed at the verdict boundary.
- What Unix explains better: alarm fatigue and declaration sprawl when the default is applied where legitimate
  emptiness is common (HTTP 204, 304, HEAD, DELETE), and the false claim in a "critical bug" finding for a
  misconfigured test.
- Residual tension: resolvable by placing the default per sensor and by letting protocol facts count as declarations.
  The attribution problem is not resolvable by the classifier: `empty` can say "no evidence"; it cannot say whose
  fault that is.

#### Clash 4: LLM-as-judge vs the deterministic classifier
- Fundamental contradiction: verdict as replayable function of recorded fields versus verdict as interpretation.
- Incompatible assumptions: determinism and reproducibility versus semantic reach. Target output is untrusted input;
  an LLM verdict can be steered by the stdout or page text it judges.
- What the LLM explains better: correctness beyond plumbing; the help text that is not help.
- What the classifier explains better: why `res.ok ? "pass" : "fail"` in a prompt is not a contract; why the same
  run must classify identically twice; why the floor cannot be attackable through the payload.
- Residual tension: resolvable by direction only. The LLM may lower a verdict (add findings); it may never raise one
  (`ok: false` is not overridable). Irreducible: the ceiling stays semantic and non-deterministic, and the framework
  must say so in its receipts rather than pretend the floor is the ceiling.

#### Clash 5: Observability vs the packet's progress-line stripping
- Fundamental contradiction: none. The pattern list exists only because stderr was treated as candidate payload.
- Incompatible assumptions: "strip known noise from stderr" versus "stderr is never payload".
- What the packet's version explains better: nothing the channel rule does not also explain.
- What observability explains better: the packet's own contradiction between dogfood item 4 and open question 4.
- Residual tension: none once stderr is a recorded channel. Surf's `Error: <message> [code]` line survives as a
  contract-bearing exception scoped to `source: "surf"`.

### MODE 3 — INTEGRATION OR DECISION
- Chosen path: Contextual Dominance.
- Result: each school governs one region and no school governs outside it.
  1. At the verdict boundary (what may become `ok: true`): fail-closed reliability dominates, decision theory sets
     the default. `ok: true` requires a non-empty payload or a declaration; declarations come from config, from
     operation code, or from protocol (HTTP 204/304, HEAD). `empty` is a distinct basis, "no evidence", never
     reported as a target fault.
  2. Inside the process boundary for `source: "cli"`: Unix dominates. Exit code is the fault signal. Stdout is opaque
     payload judged only for emptiness unless a payload contract is declared. Stderr is diagnostics: recorded whole,
     never payload, never the basis for `empty`, never pattern-stripped.
  3. Inside the classifier: type-driven contracts dominate. Error signals are interpreted only under owned or
     declared shapes (surf envelope and `[code]` line, surf extract rows, the framework's own action result, a
     declared JSON envelope for `cli`/`http`). Everything else is recorded and has no effect on the class.
  4. Above the classifier: LLM-as-judge is subordinate and monotone. It receives the outcome as its floor, may add
     findings, may never lift `ok`.
  5. As substrate: observability. Every ignored, stripped or contradicting signal appears in `transport` or
     `recorded`, and the first evidence line is the outcome.
- Why this path is justified: the schools were answering different questions (what is success for a program; what
  is evidence for a test; what may be interpreted; what the loss is; what a reader can see). Assigning each its
  region dissolves the verbal disagreements (Clashes 2 and 5) and leaves the real ones (Clashes 1, 3, 4) exposed
  where they belong: as declarations the operator must make, as attribution the classifier must not fake, and as a
  semantic ceiling the framework must not claim to reach.
- What remains unresolved: silence-as-correct-behaviour needs a declaration, permanently. `empty` cannot say whether
  the target or the test is at fault; only the operator or a semantic layer can. Semantic correctness is outside the
  contract, and the receipts must say the classifier is a floor.

### PRACTICAL CONSEQUENCE

The packet keeps one pure, shared, fail-closed classifier with a closed class set, and keeps "empty is failure
unless declared". Six things change. (1) `ResultOutcome` gains `basis: "evidence" | "fault" | "no_evidence" |
"contradiction"`, so the healer heals only `fault` and the report never renders `empty` as a target bug. (2) Stderr
becomes a recorded channel, never payload; the progress-line pattern list is deleted; the contradiction between
dogfood item 4 and open question 4 is settled in favour of item 4. (3) Error-signal interpretation is scoped to
owned or declared contracts: surf's envelope, `[code]` line and rows; the framework's own action result; a declared
`expect.payload: json` envelope for `cli`/`http`. On opaque `cli` stdout and `http` bodies, exit code and status
decide and `error` keys are recorded, not interpreted. (4) Bookkeeping-key stripping is scoped to `source: "surf"`.
(5) Protocol-level emptiness declarations exist for HTTP (204, 304, HEAD), echoed as `declaredBy:
"protocol:http_<status>"`. (6) LLM testers receive the outcome as a floor and cannot raise it; a prompt verdict of
`pass` on a non-ok outcome is discarded and recorded. Open questions 1, 3 and 4 are closed below; 2 stays open.
