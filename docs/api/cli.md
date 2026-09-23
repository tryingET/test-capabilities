---
summary: "Command reference for the TEST-CAPABILITIES CLI."
read_when:
  - "You need exact CLI commands, flags, or subcommand behavior"
  - "You are mapping a user request onto the CLI surface"
type: "reference"
---

# CLI Reference

> Exact runtime contract for the current CLI.

The CLI is **fail-closed**:
- supported surfaces execute
- unsupported surfaces error clearly
- missing config or unsupported flags do not silently degrade into placeholder behavior

The shipped verbs are owned by a typed **operation registry** (`CLI_OPERATION_REGISTRY`).
The `bin/test-capabilities` wrapper is now a thin adapter over that kernel: it parses flags, dispatches through `executeCliOperation(...)`, and renders the structured result.

---

## Operation kernel

Programmatic dispatch is available through the exported operation kernel:

```typescript
import { CLI_OPERATION_REGISTRY, executeCliOperation } from 'test-capabilities';

console.log(Object.keys(CLI_OPERATION_REGISTRY));

const result = await executeCliOperation(
  { command: 'test' },
  {
    config: './test-capabilities.yaml',
    target: 'node',
    quick: true,
  },
);
```

This registry currently owns the shipped verbs:
- `doctor`
- `init`
- `demo`
- `test`
- `surf explore`
- `quantum`
- `heal`
- `replacement-validation`

---

## Implemented commands

### `test-capabilities doctor`

Run zero-external-dependency package and environment diagnostics. This is the public first-run happy path: it verifies required package/runtime basics and reports optional external surf CLI or Bombadil-compatible runtimes as warnings when absent. A found surf CLI is probed for its version and mechanisms and `surf doctor --browser <TEST_CAPABILITIES_SURF_BROWSER|chromium> --json` is summarized (socket path, manifest, failing checks) in the `external.surf` check; the check passes only when the readiness/extract mechanisms exist and `surf doctor` is OK.

```bash
test-capabilities doctor
test-capabilities doctor --json
test-capabilities doctor --config ./test-capabilities.yaml
test-capabilities doctor --target node
```

Required checks:
- Node.js 22+
- package metadata is present, versioned, and publishable
- `LICENSE` and `README.md` are present
- `dist/index.js`, `bin/test-capabilities`, and `test-capabilities.yaml` are present
- the packaged sample config parses as a valid `test-capabilities` config, or `--config <file>` parses if provided
- `--target <command-or-url>` resolves a CLI executable without running it, or validates an HTTP(S) URL target

Optional checks:
- surf CLI runtime via `TEST_CAPABILITIES_SURF_BIN`, `surf` on `PATH`, or `~/.local/bin/surf` (`external.surf`; the retired `surf-go` env vars are reported as a warning)
- Bombadil-compatible runtime via `TEST_CAPABILITIES_BOMBADIL_BIN`, `TEST_CAPABILITIES_BOMBADIL_REPO`, or `bombadil` on `PATH`

Missing optional runtimes do not fail `doctor`.

### `test-capabilities init`

Generate a minimal valid `test-capabilities.yaml` for the zero-external-dependency `cli-tester` path.

```bash
test-capabilities init
test-capabilities init --output ./test-capabilities.local.yaml --target node
test-capabilities init --print
test-capabilities init --force
```

Supported options:

| Option | Description | Default |
|--------|-------------|---------|
| `--output <file>` | Config file to write | `test-capabilities.yaml` |
| `--target <command>` | CLI command/path for `targets.cli` | `node` |
| `--force` | Overwrite an existing output file | `false` |
| `--print` | Print the generated YAML instead of writing a file | `false` |
| `--json` | Print the full machine-readable init envelope | `false` |

The generated config enables only `cli-tester`, disables unsupported intelligence/autonomy flags, and validates against the same config schema used by `test`. It refuses to overwrite an existing file unless `--force` is present.

### `test-capabilities demo`

Run the built-in zero-external-dependency demo fixture. This is the first functional proof path after `doctor`: it executes a shipped demo CLI through the same `cli-tester` orchestrator path that user targets use.

```bash
test-capabilities demo
test-capabilities demo --json
```

The demo uses `examples/demo/cli-demo.mjs` and an equivalent checked-in config at `examples/demo/test-capabilities.yaml`. It requires only Node.js and the installed package files; surf CLI and Bombadil-compatible runtimes remain optional. The text and JSON output both identify the polished core use case as `cli-smoke-observation`: CLI smoke plus `observation.v1` diagnostics, with next commands for replacing the demo target with a real CLI.

### `test-capabilities test`

Run the capability-backed orchestrator path.

```bash
test-capabilities test [options]
test-capabilities test --config examples/demo/test-capabilities.yaml --json
```

Supported options:

| Option | Description | Default |
|--------|-------------|---------|
| `--config <file>` | Path to `test-capabilities.yaml` | `test-capabilities.yaml` |
| `--target <url-or-path>` | Override one target. Non-URLs map to `targets.cli`. URLs map to `targets.web` and are only accepted when a real web consumer is enabled for the run (currently: `quantum.enabled: true` or an enabled `bombadil` or `surf` agent). | none |
| `--quick` | Disable quantum and prediction overlays for a deterministic smoke run | `false` |
| `--json` | Print the full machine-readable operation envelope for agents/CI instead of the banner and human summary | `false` |

Important:
- `--json` emits the same `TestOperationResultEnvelope` returned by `executeCliOperation({ command: 'test' }, input)`, including `operationId`, normalized `input`, `effectiveConfig`, `summary`, and the full orchestrator `result`
- the current supported orchestrator agents are `bombadil`, `surf`, and `cli-tester`
- a URL `--target` does **not** replace `targets.cli` when `cli-tester` is still enabled for the run
- `test --quick --target https://...` still works when an enabled `bombadil` or `surf` agent is the active web consumer
- Bombadil resolution order is `TEST_CAPABILITIES_BOMBADIL_BIN`, then a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, then repo-local `external/bombadil`, then `bombadil` on `PATH`
- an unbuilt source checkout does not override the fallback chain; the runtime reports that you still need a built `target/release|debug/bombadil` plus source-project prerequisites such as `trunk` or a Nix shell

Accepted but currently unsupported options:

| Option | Current behavior |
|--------|------------------|
| `--autonomous` | Fails with an unsupported-option error |
| `--self-heal` | Fails with an unsupported-option error |
| `--predict` | Fails with an unsupported-option error |
| `--fail-threshold <level>` | Fails with an unsupported-option error |
| `--upload-artifacts` | Fails with an unsupported-option error |
| `--report <dir>` | Fails with an unsupported-option error |

---

### `test-capabilities surf explore`

Run the resolved surf CLI (nicobailon/surf-cli, resolution `TEST_CAPABILITIES_SURF_BIN` → `surf` on `PATH` → `~/.local/bin/surf`) through the supported `explore` action. `test-capabilities surf explore --url <url>` first probes the build (`surf --version`, `surf --help-full`) and refuses a build without `wait.ready` and `extract`; it then opens an owned tab (`surf tab.new <url>`), gates it with `surf wait.ready --tab-id <id> --json` (states `login`, `challenge`, `not-found`, `error`, or a timeout refuse the page with the surf code such as `[page_login]` and the evidence lines), runs explicit browser-state and DOM probes through `surf js --tab-id <id> --json`, extracts same-origin links through `surf extract --tab-id <id> --allow-empty --json` when `--depth` asks for more pages, closes the tab, and verifies that observed page state matches the target (or landed) URL before reporting coverage. Commands never act on the browser's active tab.
An explicit `--url` is required; the kernel no longer defaults to `about:blank` because that created success-shaped no-op runs. Non-empty stdout is not evidence by itself: help text, warnings, and target URLs without a matching browser-state probe fail closed as unverified coverage. `--depth 2` or `--depth 3` adds bounded same-origin link discovery and turns user-flow coverage into a graded verified-probe score instead of a binary process-success signal.

```bash
test-capabilities surf explore --url https://example.com
# bounded same-origin exploration with graded coverage
test-capabilities surf explore --url https://example.com --depth 2
# wait for an element, and diagnose the page's frames when it cannot be reached
test-capabilities surf explore --url https://example.com --ready-selector '#results' --json
# assert which frame the target lives in; the only way to confirm a frame boundary
test-capabilities surf explore --url https://example.com --ready-selector '#play' \
  --frame-hint 'urlPrefix=https://www.youtube.com/embed/' --json
# attach the read-only accessibility observation channel to the tab the run already owns
test-capabilities surf explore --url https://example.com --a11y-snapshot=required --json
```

Options:

| Option | Description |
|--------|-------------|
| `--url <url>` | Required target URL |
| `--depth <n>` | Optional bounded same-origin exploration depth, integer `1`-`3`; deeper pages contribute graded coverage only when their probes verify |
| `--ready-selector <css>` | A visible CSS selector the readiness gate waits for (`surf wait.ready --selector`). A selector the gate cannot reach refuses with `[element_unreachable]` and carries a frame diagnosis taken in the same tab |
| `--frame-probe` | With `--ready-selector` and no `--frame-hint`: for each top-level candidate frame, `frame.switch --index <domIndex>`, one `wait.element` for the selector, `frame.main`. A hit in exactly one candidate, with every candidate probed and answering, confirms the frame; hits in several are `undetermined`; anything else stays `suspected` - absence never excludes. Nested frames and frames without an answering content script count as unprobed and block a confirmation. A `frame.main` that fails closes the tab (`frame_context_unrestored`). Off by default |
| `--frame-hint <kind=value>` | `urlPrefix=<prefix>` or `selector=<css>`, asserting which frame the `--ready-selector` target lives in. Only valid with `--ready-selector`; a shape the framework cannot read, or a hint that resolves to zero, several or an unreachable frame, refuses rather than weakening the determination |
| `--a11y-snapshot[=mode]` | Attach the a11y observation channel (agent-browser over the loopback CDP endpoint). `optional` (the bare flag) records an `unavailable` observation and continues; `required` fails the page with `[a11y_channel_unavailable]`. Default `off`, so an envelope without the flag is unchanged |
| `--json` | Print the full machine-readable operation envelope; a failure prints `{"error": {code, message, details}}` and exits 1 |
| `--record` | Fails with an unsupported-option error until wired to a real runtime path |
| `--validate` | Fails with an unsupported-option error until wired to a real runtime path |
| `--baseline <dir>` | Fails with an unsupported-option error until wired to a real runtime path |
| `--ai-diff` | Fails with an unsupported-option error until wired to a real runtime path |
| `--file <path>` | Fails with an unsupported-option error until wired to a real runtime path |

#### Frame root cause

A `--ready-selector` the gate cannot reach is not reported as selector drift. Explore runs one
read-only `surf frame.diagnose` in the tab it already owns, classifies the inventory, and
answers in the kernel determination shape:

| `determination` | what it means | what a consumer may do |
|---|---|---|
| `excluded` | the page carries no frame a main-document selector could be missing into | the failure is filed by the existing rules (`selector_or_dom_drift`); the healer proposes as before |
| `confirmed` | `--frame-hint` resolved to exactly one candidate whose content script answers | the root cause is `frame_boundary`; the healer refuses a rewrite and records a `frame.switch` suggestion |
| `suspected` | frames exist and nothing links the failing selector to any of them | `browser_coverage_gap`; the healer may still propose, with `requiresReview: true` and a typed caveat that `heal --apply` refuses |
| `undetermined` | the inventory disagrees with itself, the page moved, or the hint does not resolve to one reachable frame | `browser_coverage_gap`; the healer refuses |
| `unavailable` | `frame.diagnose` failed or is not in this surf build | `browser_coverage_gap`; the healer refuses |

The diagnosis is read once per page visit and the raw inventory is written to
`<receipts.dir>/<runId>/frame-diagnosis-*.json` at mode 0600; `probes[].frameRootCause` in the
envelope carries the capped evidence (at most ten candidates, `src` abbreviated to 160
characters, surf's warnings verbatim). The framework never infers which frame a selector meant:
without `--frame-hint`, `suspected` is the strongest answer it will give.

#### A11y snapshot observation channel

An optional, read-only *second* observation channel: surf keeps the tab and every action, and
agent-browser attaches to the same CDP target and only reads. It is off by default, and nothing
about it is a fallback - a missing binary, a version below `0.35.1`, a non-loopback or
unreachable endpoint, an ambiguous tab binding or an empty tree is a typed refusal, never a
browser this framework launched.

Per page the channel reads `/json/list` over HTTP, binds the one page target whose URL is the
readiness href, pins one session (`--session test-capabilities-<runId> --pin-tab`) to that
target id, takes one `snapshot -i --json`, and ends its session before surf closes the tab.

The artifact (`a11y-snapshot.v1`, kind `test-capabilities.a11y.snapshot`) is written to
`<receipts.dir>/<runId>/a11y-snapshot-*.json` at mode 0600 and holds the tree's text, its refs
map, the role counts and `semanticCoverage`. `pages[].observations[]` in the envelope carries
the digest, the refs map, the counts and the file's path - never the ~8 KB text.

| field | what it is |
|---|---|
| `digest` | `sha256:<hex>` of the snapshot text. A ref is valid **iff** a fresh snapshot's digest equals the digest that minted it; a reload that leaves the tree byte-identical keeps it valid, a navigation does not |
| `refs` | `{ "e28": { role, name } }`, straight from the producer. `eN` is a within-snapshot reading aid; what crosses runs is `{role, name}` |
| `roleCounts` | how many nodes of each role the tree named |
| `semanticCoverage` | the `dom` probe's `anchors`/`buttons`/`inputs` counts against the tree's. A gap is the number of controls the page has and the browser cannot name; assert those through surf selectors. Absent with `coverageReason: "dom_probe_missing"` when the `dom` probe did not verify - never zeros |
| `tabLeak` | pages that appeared while the channel held its session, with `before`, `after`, `urls` and `attribution`. Only the channel acts in that window, so every such page is its own. `known_producer_stray` - exactly one `about:blank` from an agent-browser version measured to strand one per session (0.35.1, 0.38.0) - is evidence in both modes. `unexplained` is everything else: evidence under `optional`, a `tab_leak` refusal under `required` |

Environment: `TEST_CAPABILITIES_AGENT_BROWSER_BIN` (else `agent-browser` on `PATH`, else
`~/.npm-global/bin/agent-browser`), `TEST_CAPABILITIES_CDP_ENDPOINT` (default
`http://127.0.0.1:9222`, loopback only), `TEST_CAPABILITIES_AGENT_BROWSER_SESSION_PREFIX`
(default `test-capabilities`). `doctor` reports all three as `external.agent_browser`.

Unsupported surf actions:
- `flow`
- `assert`
- `compare`
- `replay`

These actions fail clearly instead of emitting placeholder output.

---

### `test-capabilities surf plan`

Read a form in an owned tab and write the artifact an operator reviews before anything is filled or submitted. `surf plan` is read-only: it opens a tab, gates it with `wait.ready`, runs one page-side expression that reads the form, closes the tab, and writes `test-capabilities.surf.plan` v1 with mode 0600 (it carries the values the run intends to type).

```bash
test-capabilities surf plan \
  --url https://example.com/search \
  --field 'label:Search packages=surf-cli' \
  --submit-text 'Search' \
  --out plan.json \
  --config test-capabilities.yaml
```

In text mode the approval token is the only line on stdout, so it can be copied into `surf apply --confirm-plan`; the one-line summary goes to stderr.

| Option | Description |
|--------|-------------|
| `--url <url>` | Required page to read |
| `--field <locator>=<value>` | Required, repeatable. `<locator>` is `label:<text>`, `selector:<css>` or `name:<input name>`; the split is at the first `=` outside brackets, so `selector:input[name=q]=surf-cli` works |
| `--submit-text <text>` | Narrow the submit candidates by the control's normalised visible text |
| `--submit-selector <css>` | Narrow them by CSS; the only way to identify a submit on a page with no owning form |
| `--out <file>` | Required path for the plan artifact (0600) |
| `--config <file>` | Config holding `mutation.allowOrigins`, `receipts.dir` and `surf.submit.*`; same lookup as `test`, default `test-capabilities.yaml` |
| `--json` | Print the operation envelope; the envelope names the plan's path, id and token and never carries the intended values |

The plan records every field with its resolved selector and `set_via: field_input`; the one control that may be clicked, or an explicit `ambiguous`/`none` with the candidate list; the form-level buttons that may never be clicked (`forbidden_controls`); a page fingerprint; and `approval_token`, a sha256 over the RFC 8785 canonical form of the origin, the fields' selectors and intended values, and the submit selector.

Refused before any artifact exists: `plan_field_not_found`, `plan_field_ambiguous`, `plan_field_unreachable` (a locator that matched nothing runs the same `frame.diagnose` observation explore does: `excluded` means the field is simply absent, anything else means a frame could hold it and the refusal carries `details.determination`), and `value_via_button_refused` when a field locator resolves to a button, a link or a submit input — a value is set only through the field's own input. An ambiguous or missing submit does not refuse the plan; it is recorded, so a fill-only dry run stays possible.

---

### `test-capabilities surf apply`

Carry out a plan. Filling is the default and clicks nothing; submitting needs the gate.

```bash
# dry run: set the plan's values, read them back, click nothing
test-capabilities surf apply --plan plan.json --config test-capabilities.yaml

# submit: the origin must be allowlisted and the token must match the plan's content
test-capabilities surf apply --plan plan.json --submit \
  --confirm-plan sha256:… --until-url-prefix https://example.com/done \
  --config test-capabilities.yaml
```

| Option | Description |
|--------|-------------|
| `--plan <file>` | Required plan artifact; the target, the fields and the control all come from it |
| `--submit` | Open the submit gate; needs `--confirm-plan` and an allowlisted origin |
| `--confirm-plan <token>` | The approval token `surf plan` printed, recomputed from the plan's content |
| `--until-url-prefix <p>` / `--until-text <t>` | The post-condition to observe after the click; the default is "the URL leaves the plan's page" |
| `--receipt-out <file>` | Export this run's mutation receipts as one JSON artifact (the per-receipt files under `receipts.dir` are written either way) |
| `--config <file>` | Config holding `mutation.allowOrigins`, `receipts.dir` and `surf.submit.*` |
| `--json` | Print the operation envelope |

In submit mode the refusals are ordered, and all of them happen before a tab is opened: the world (`submit_origin_not_allowed`), the intent (`submit_gate_closed`, `submit_plan_mismatch`), at-most-once (`submit_already_attempted`, keyed on submit-mode receipts only, so a fill dry run never blocks the submit of its own plan) and identification (`plan_submit_ambiguous`, `plan_submit_missing`). After that the page must still match the plan's fingerprint (`plan_stale`), every value must read back (`field_readback_mismatch`), the page must not move on its own (`fill_side_effect_observed`), and the control must be enabled, unique and still in the fields' form (`submit_control_disabled`, `submit_control_changed`).

A fill needs the origin declared too: a fill is a bounded mutation, not a safe one, and the kernel ledger gates every mutating step whose subject is a web origin (`mutation_origin_not_allowed`).

The click is preceded by a receipt on disk and followed by the post-condition, which is that receipt's verification. A post-condition that never arrives leaves `submitted: "unknown"`, the receipt `unknown` and exit 1; it is never retried, and the plan can never be submitted again.

---

### `test-capabilities replacement-validation plan`

Plan dependency replacement validation from an explicit `testcapabilities.replacement-validation-request.v1` JSON file, usually emitted by `dep-surgeon` from a replacement plan.

```bash
test-capabilities replacement-validation plan \
  --request out/dep-surgeon/testcap-validation-request.json \
  --out out/test-capabilities/replacement-validation-result.json \
  --json
```

Options:

| Option | Description | Default |
|--------|-------------|---------|
| `--request <file>` | Required `testcapabilities.replacement-validation-request.v1` input | none |
| `--out <file>` | Optional result artifact path for `testcapabilities.replacement-validation-result.v1` | none |
| `--json` | Print the machine-readable operation envelope | `false` |

This command is a validation membrane. It selects explicit target-owned validation commands from the request but does not execute them. A planned result does not authorize dependency mutation, replacement, merge, release, or trust certification.

---

### `test-capabilities quantum`

Run the shared quantum simulator. **Parked** (D1): the route stays registered, contacts no target and produces no target evidence; its output is never a `Finding`, an `Observation` or a test verdict.

```bash
test-capabilities quantum --target https://example.com --branches 100 --collapse
```

| Option | Description | Default |
|--------|-------------|---------|
| `--target <url>` | Required target URL for the simulator | none |
| `--branches <n>` | Positive integer branch count | `100` |
| `--collapse` | Use `significance` collapse instead of `coverage` | `false` |

An explicit `--target` is required so the command cannot silently simulate a placeholder site.
Invalid branch counts such as `0`, negative values, or non-numeric strings fail closed.
Non-URL targets also fail closed instead of being simulated as if they were valid browser URLs.

---

### `test-capabilities heal`

Run the selector-healing workflow.

```bash
test-capabilities heal --dir ./tests --dry-run
test-capabilities heal --dir ./tests --dry-run \
  --proposal-output artifacts/heal-proposals.json \
  --verification-output artifacts/heal-verification.json

test-capabilities heal --dir ./tests --dry-run \
  --findings-input artifacts/orchestrator-findings.json \
  --proposal-output artifacts/heal-proposals.json

test-capabilities heal --dir ./tests --checkpoint-ref checkpoint/test-capabilities/heal-001

test-capabilities heal --dir ./tests \
  --proposal-input artifacts/heal-proposals.json \
  --checkpoint-ref checkpoint/test-capabilities/heal-001
```

| Option | Description | Default |
|--------|-------------|---------|
| `--dir <path>` | Directory to scan for test files (must exist) | `./tests` |
| `--dry-run` | Show proposals without applying them | `false` |
| `--proposal-output <file>` | Write a dry-run proposal artifact as JSON for review or replay-ledger follow-through | unset |
| `--verification-output <file>` | Write a dry-run verification artifact after checking proposals in memory | unset |
| `--proposal-input <file>` | Apply proposals from a previously emitted proposal artifact; requires `--checkpoint-ref` and target files must stay inside `--dir` | unset |
| `--findings-input <file>` | Read diagnostic findings JSON and cite matching evidence as `triggeringFindingId` on proposals | unset |
| `--checkpoint-ref <ref>` | External checkpoint identity required before applying healing proposals | unset |
| `--receipt-output <file>` | Apply mode only: export this run's mutation receipts as one JSON artifact | unset |
| `--supersede-receipt <receipt_id>` | Apply mode only: proceed past an in-doubt receipt you have inspected; the new receipt records which one it supersedes | unset |

Missing or non-directory `--dir` values fail closed instead of reporting an empty success.
The healing scan skips common generated/dependency directories such as `node_modules`, `dist`, `coverage`, and `.git`.
Proposal and verification artifacts are dry-run only: requesting `--proposal-output` or `--verification-output` without `--dry-run` fails closed instead of writing misleading mutation artifacts.
`--findings-input` is caller-supplied diagnostic evidence, not causal authority: it must be exactly one of a bounded JSON array of finding objects, an object with `findings`, or a `test --json` envelope with `result.findings`; each finding needs string `id`, `component`, `description`, and `evidence` fields, and malformed or ambiguous input fails closed before scanning or writing artifacts.
When findings are provided, healing only proposes selector repairs for selectors cited by finding evidence and adds `triggeringFindingId`; equivalent selector spellings such as `getByTestId('old-login')` and `[data-testid="old-login"]` are normalized for matching without turning evidence into causal proof. Without findings, healing uses the heuristic file scan without provenance claims.
When applying fixes, the kernel requires `--checkpoint-ref` if proposals would mutate files, then validates the full per-file proposal set before writing so same-line rewrites do not leave partial mutations behind. `--proposal-input` applies proposals from a prior proposal artifact instead of recomputing them; proposal target paths must be absolute, regular files inside `--dir`, and non-symlinked.
The checkpoint ref must come from an external checkpoint/restore authority; this command records the identity but does not create checkpoints or perform rollback.
Every applied file is a conditional write behind a mutation receipt: the receipt reaches `receipts.dir` before the write, the content hash the proposal was planned against is re-read immediately before the rename (`precondition_failed` on drift, nothing written), and a receipt left `attempting` or `unknown` refuses the next run for that file until `--supersede-receipt <receipt_id>` records an operator's decision to proceed. `--receipt-output` is the aggregate export; the per-receipt files exist either way. `doctor` reports the store, whether it survives the run, and how many receipts are in doubt.

---

## Registered but unsupported commands

These commands are present so the CLI can fail clearly and consistently:

- `test-capabilities predict`
- `test-capabilities visualize`
- `test-capabilities report`

Current behavior:
- exit non-zero
- print an explicit unsupported-command error

---

## Exit behavior

| Exit code | Meaning |
|-----------|---------|
| `0` | Supported command completed successfully |
| `1` | Configuration error, unsupported surface, or runtime failure |

---

## Runtime capability summary

These route statuses are mirrored by the exported operation registry / route manifest so docs, CLI dispatch, and contract tests share one source of truth. `npm run contract:sync` compares this table against `CLI_ROUTE_MANIFEST` row by row and fails on any surface either side is missing.

| Surface | Status |
|---------|--------|
| `doctor` | implemented |
| `init` | implemented |
| `demo` | implemented |
| `test` | implemented |
| `surf explore` | implemented |
| `surf plan` | implemented |
| `surf apply` | implemented |
| `quantum` | implemented |
| `heal` | implemented |
| `replacement-validation` | implemented |
| `surf flow` | unsupported |
| `surf assert` | unsupported |
| `surf compare` | unsupported |
| `surf replay` | unsupported |
| `predict` | unsupported |
| `visualize` | unsupported |
| `report` | unsupported |
