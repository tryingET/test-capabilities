---
summary: "Reference for the test-capabilities.yaml configuration contract."
read_when:
  - "You are authoring or validating a TEST-CAPABILITIES config file"
  - "You need field-level configuration examples and expectations"
type: "reference"
---

# Configuration

> Exact configuration contract for the current fail-closed runtime.

The schema lives in one place, `src/core/config.ts` (`TestCapabilitiesConfigSchema`, `TargetSchema`, `AgentConfigSchema`, and the derived `TestCapabilitiesConfig` and `RuntimeConfigLike` types), and is exported from the package root; the orchestrator, `test --config`, `init` and the capability matrix all parse through it.

The parser is strict:
- unknown top-level keys are rejected
- unknown nested keys in supported sections are rejected
- alias forms such as `self_healing`, `collapse_strategy`, and `max_depth` are normalized

---

## Minimal supported config

```yaml
version: '2.0'
name: 'CLI Smoke Suite'

targets:
  cli: 'node'

agents:
  cli:
    enabled: true
    type: cli-tester
    intensity: normal

intelligence:
  self_healing: false
  prediction: false
  correlation: true
  collective: false

quantum:
  enabled: false

chaos:
  enabled: false
```

This succeeds because the current orchestrator supports:
- the `cli-tester` agent
- correlation enabled
- quantum disabled or explicitly configured against `targets.web`
- chaos disabled

Surf-backed and Bombadil-backed web runs are also supported when you enable a `surf` or `bombadil` agent and provide `targets.web`.

---

## Supported top-level keys

| Key | Required | Notes |
|-----|----------|-------|
| `version` | yes | Must be `"2.0"` |
| `name` | yes | Human-readable suite name |
| `targets` | yes | `web`, `api`, and/or `cli` |
| `agents` | no | At least one enabled supported agent is still required by runtime |
| `intelligence` | no | `correlation: true` is supported and may emit synthesis, suite correlation, and calibrated `root_cause` observations |
| `quantum` | no | Supported when `targets.web` is present |
| `chaos` | no | Must remain disabled for now |
| `receipts` | no | Where the mutation ledger keeps its receipts, and whether the store is declared ephemeral |
| `mutation` | no | The origins a mutating step may act on; empty by default |

Rejected top-level keys in the current runtime include:
- `healing`
- `reporting`
- `alerts`
- `performance`
- `accessibility`
- `security`
- `execution`
- `env`
- `hooks`

---

## `targets`

```yaml
targets:
  web: 'https://example.com'
  api: 'https://api.example.com'
  cli: 'node'
```

| Field | Type | Notes |
|-------|------|-------|
| `web` | URL string | Required when `quantum.enabled: true` or a `bombadil`/`surf` agent is enabled |
| `api` | URL string | Parsed but not currently used by the supported orchestrator path |
| `cli` | string | Required when `cli-tester` is enabled |

---

## `agents`

Schema-supported types:
- `bombadil`
- `surf`
- `api-fuzzer`
- `cli-tester`

Runtime-supported types:
- `bombadil`
- `surf`
- `cli-tester`

Example:

```yaml
agents:
  cli:
    enabled: true
    type: cli-tester
    intensity: normal
```

Supported fields:

| Field | Type |
|-------|------|
| `type` | `bombadil | surf | api-fuzzer | cli-tester | terminal-fuzzer` |
| `enabled` | boolean |
| `intensity` | `gentle | normal | aggressive` |
| `duration` | string |
| `focus` | string[] |
| `expect` | object | Optional declaration of the payload shape this agent's steps produce |
| `observation` | object | Optional second observation channels for `type: surf` agents |
| `readySelector` / `ready_selector` | string | Optional CSS selector a `type: surf` agent's readiness gate waits for; refused on any other agent type |
| `frameProbe` / `frame_probe` | boolean | Optional in-frame probe of the candidate frames when no `frameHint` is given (the config twin of `--frame-probe`); needs `readySelector`, `type: surf` only |
| `frameHint` / `frame_hint` | string | Optional `urlPrefix=<prefix>` or `selector=<css>` naming the frame the `readySelector` target lives in; needs `readySelector`, `type: surf` only |
| `bombadil` | object | Optional Bombadil-specific runtime options for `type: bombadil` agents |
| `terminal` | object | Optional terminal target options for `type: terminal-fuzzer` agents |

### `agents.<name>.expect`

A step that exits successfully and produces no payload obtained no evidence, so the run is
reported as `unverified` rather than passed. That is the default because an empty result read as
a pass is a silent false negative. When emptiness is the expected shape, declare it here and the
outcome becomes `declared_empty`, which passes and records who declared it.

| Field | Type | Notes |
|-------|------|-------|
| `output` | `required \| empty` | `empty` accepts a payload-free run as a pass |
| `empty_marker` | string | The fixed line the command prints when it legitimately has nothing to report; checked against the payload |
| `payload` | `opaque \| json` | `json` lets the classifier read a structured error object; `opaque` means text nothing may interpret |
| `error_envelope` | boolean | The command reports errors as a JSON envelope, so an error field is authoritative |

```yaml
agents:
  cli:
    enabled: true
    type: cli-tester
    expect:
      output: empty
      empty_marker: 'No results'
```

The declaration appears in the run's determination as `config:agents.<name>.expect`. Operations
may declare on their own authority instead (for example `operation:surf.explore.links`, where a
page legitimately has no same-origin links), and an agent with no config declares what it knows
about the step it ran as `author:<agent>`.

### `agents.<name>.observation`

The second, read-only observation channels a browser agent attaches. Off by default, so a config
written before this key produces the same envelope it always did.

| Field | Type | Notes |
|-------|------|-------|
| `a11ySnapshot` / `a11y_snapshot` | `off \| optional \| required` | The accessibility snapshot channel (Chromium's accessibility tree of the owned tab over the loopback CDP endpoint). `optional` records an `unavailable` observation and continues; `required` fails the page with `a11y_channel_unavailable` |

```yaml
agents:
  web:
    enabled: true
    type: surf
    observation:
      a11ySnapshot: optional
```

surf keeps the tab and every action; the channel attaches to that tab's page target over the
loopback DevTools endpoint (`TEST_CAPABILITIES_CDP_ENDPOINT`, default `http://127.0.0.1:9222`),
reads Chromium's accessibility tree and detaches. An endpoint that is not loopback, not listening
or not Chromium, a tab that is not exactly one target, or an empty tree is a typed refusal. The
artifact is written under `receipts.dir/<runId>/` at mode 0600; `docs/api/cli.md` has the field
table.

### `agents.<name>.readySelector`

The element a surf agent's explore must reach before it probes the page - the config twin of
`surf explore --ready-selector`. A page that is ready but never shows the selector is an
element-reach failure: the agent takes one read-only `frame.diagnose` in the same tab and files
one finding carrying the typed `frameRootCause` determination, with its marker line first in the
evidence. Without the key the agent names no element, so a `test` run cannot produce a frame
determination at all.

```yaml
agents:
  web:
    enabled: true
    type: surf
    readySelector: '#play'
```

Without a hint the strongest answer is `suspected`, reported as `browser_coverage_gap`.
`frameHint` is the config twin of `--frame-hint`: the test author's assertion of which frame the
selector lives in, read by the same strict parser. A hint that resolves to exactly one reachable
candidate makes the determination `confirmed`, which files `frame_boundary`; a hint that
resolves to none, several or an unreachable frame is `undetermined`, never a weaker suspicion.

```yaml
agents:
  web:
    type: surf
    readySelector: '#play'
    frameHint: 'urlPrefix=https://www.youtube.com/embed/'
```

Both keys are refused on a non-surf agent, where nothing would wait for them, and `frameHint`
is refused without `readySelector` or in a shape the parser cannot read.

Bombadil-specific fields under `agents.<name>.bombadil`:

| Field | Type | Notes |
|-------|------|-------|
| `command` | `test | test-external` | Defaults to `test`; `test-external` is for externally managed browser targets |
| `output_path` / `outputPath` | string | Passed to Bombadil `--output-path` so traces/screenshots are saved for `bombadil inspect` |
| `headers` | object | Passed as repeated Bombadil 0.5 `--header KEY=VALUE` request headers |
| `reproduce_trace` / `reproduceTrace` | string | Passed as Bombadil 0.5 `--reproduce`; omits `--exit-on-violation` because reproduction is mutually exclusive with it |
| `width` / `height` | positive integer | Browser viewport size |
| `device_scale_factor` / `deviceScaleFactor` | positive number | Browser viewport scale |
| `instrument_javascript` / `instrumentJavaScript` | `files|inline`[] | Passed as Bombadil `--instrument-javascript` |
| `chrome_grant_permissions` / `chromeGrantPermissions` | string[] | Passed as Bombadil `--chrome-grant-permissions` |
| `headless` | boolean | Defaults to true for `command: test`; set false for a visible browser |
| `noSandbox` | boolean | Passed as Bombadil `--no-sandbox` for `command: test` |
| `remote_debugger` / `remoteDebugger` | URL string | Passed as `--remote-debugger` for `command: test-external` |
| `create_target` / `createTarget` | boolean | Passed as `--create-target` for `command: test-external` |

Terminal-fuzzer-specific fields under `agents.<name>.terminal`:

| Field | Type | Notes |
|-------|------|-------|
| `command` | string | Optional command to pass after `bombadil terminal test --`; defaults to `targets.cli` |
| `args` / `command_args` | string[] | Optional command arguments passed after the command |

The Bombadil 0.5 disabled-control skipping, quiescence timers, and dialog auto-accept behavior are runtime capabilities of the Bombadil binary itself; test-capabilities does not emulate or claim them unless the resolved Bombadil binary provides them. The experimental Bombadil terminal fuzzer is a bounded `terminal-fuzzer` agent that emits `observation.v1` runtime evidence for the resolved terminal command; it is not a production stability or autonomy claim.

If an enabled agent uses `api-fuzzer`, runtime validation fails clearly.
If an enabled agent uses `surf`, runtime validation requires `targets.web` and a resolvable surf CLI (nicobailon/surf-cli with `wait.ready`/`extract`): `TEST_CAPABILITIES_SURF_BIN`, `surf` on `PATH`, or `~/.local/bin/surf`. An invalid `TEST_CAPABILITIES_SURF_BIN` and the retired `TEST_CAPABILITIES_SURF_GO_BIN`/`TEST_CAPABILITIES_SURF_GO_REPO` fail closed instead of silently switching runtimes. `TEST_CAPABILITIES_SURF_BROWSER` (default `chromium`) selects the browser `doctor` inspects; `SURF_SOCKET` is passed through to surf.
If an enabled agent uses `bombadil`, runtime validation requires `targets.web` and a Bombadil binary that can be resolved through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, repo-local `external/bombadil`, or `bombadil` on `PATH`.
If an enabled agent uses `terminal-fuzzer`, runtime validation requires `targets.cli` or `agents.<name>.terminal.command`, plus a resolvable Bombadil binary.
A source checkout only overrides the vendored fallback after it has a built `target/release/bombadil` or `target/debug/bombadil`; upstream Bombadil 0.5 no longer requires `esbuild`, though source builds may still need `trunk` or the project Nix shell.

---

## `receipts`

```yaml
receipts:
  dir: '.test-capabilities/receipts'   # default; resolved against this config file's directory
  ephemeral: false                     # default
```

Every mutating step writes a receipt here **before** it acts, and reads the directory back
before the next attempt with the same key: a receipt that is still `attempting` or `unknown`
refuses the rerun (`mutation_replay_refused`) until an operator passes
`--supersede-receipt <receipt_id>`. Nothing under `receipts.dir` is ever deleted by the
framework; deleting it by hand is an interlock reset with the same standing as superseding.

The base the relative `dir` is resolved against is defined per operation, because `heal`,
`init` and `replacement-validation` run without a config file at all: this config file's
directory for `test`, `--dir` for `heal`, the working directory for the rest.
`TEST_CAPABILITIES_RECEIPTS_DIR` overrides all of them and is the only way to point the store
somewhere else for an operation that takes no config.

`ephemeral: false` is fail-closed (operator decision D5): when `receipts.dir` resolves inside a
workspace that does not survive the run — `$TMPDIR`, a CI job workspace, a linked git worktree —
a mutating operation refuses with `mutation_receipts_ephemeral`, because an interlock that
vanishes with the workspace is not an interlock. Setting `ephemeral: true` (or
`TEST_CAPABILITIES_RECEIPTS_EPHEMERAL=1`) accepts that, and every receipt written under it
records `"ephemeral_store": true` so it never overstates what it protects.

---

## `mutation`

```yaml
mutation:
  allowOrigins:            # or allow_origins
    - 'http://127.0.0.1:8080'
```

The operator's declaration of which web origins this suite may *act* on. It is empty by
default, and a mutating step whose subject is a web origin outside it refuses with
`mutation_origin_not_allowed` before anything is spawned — the Bombadil agent included, which
is a behaviour change for existing Bombadil configs. Reading a page never consults this key;
only steps that may change the target do. `surf apply` consults it twice: once for the whole
run before a tab is opened (`submit_origin_not_allowed` in submit mode) and once per act in the
ledger. Filling a form is one of those acts, so a dry run on an origin this key does not name
is refused as well — a fill is a bounded mutation, not a safe one.

`surf plan` and `surf apply` read this key, `receipts.dir` and `surf.submit.*` through
`--config`, using the same lookup `test` uses. There is no environment variable and no CLI flag
that adds an origin; the allowlist is the operator's declaration about the world.

---

## `surf`

```yaml
surf:
  submit:
    postconditionTimeoutMs: 15000   # or postcondition_timeout_ms
    controlEnableTimeoutMs: 5000    # or control_enable_timeout_ms
```

The two bounded waits of the submit gate. `postconditionTimeoutMs` bounds the wait for the
effect the operator declared with `--until-url-prefix` / `--until-text` (or, by default, for the
URL to leave the plan's page); when it runs out the submit is `unknown`, never retried.
`controlEnableTimeoutMs` bounds the wait for a submit control that is disabled until the form
validates, after which the run refuses with `submit_control_disabled` having clicked nothing.
There is no `surf.receipts.dir`: receipts live under the one `receipts.dir` above.

---

## `intelligence`

```yaml
intelligence:
  self_healing: false
  prediction: false
  correlation: true
  collective: false
  propagation_topology:
    include_defaults: true
    edges:
      - upstream: api
        downstream: web
```

Alias mapping:
- `self_healing` → `selfHealing`
- `propagation_topology` → `propagationTopology`
- `include_defaults` → `includeDefaults`

Supported current runtime state:
- `correlation: true`, including non-authoritative synthesis, suite correlation, deterministic `root_cause` observations when same-component evidence has at least two independent failed-or-errored observed current-run evidence units from at least two sensors that agree on the same failure class, and low-calibration non-authoritative `propagation` observations when configured dependency edges have bounded propagation-link support
- `propagationTopology.includeDefaults: true|false`, where defaults are `api -> web`, `cli -> api`, and `cli -> web`
- `propagationTopology.edges[]` custom edges with non-empty, distinct `upstream` and `downstream` strings; self-edges are rejected
- `selfHealing: false`
- `prediction: false`
- `collective: false`

`root_cause` observations are diagnostic and evidence-bounded. Derived observations do not count separately from their source findings, finding recommendations are not treated as classifying evidence, and root-cause output does not use probability, time horizon, or later-failure claims. Current bounded failure classes include `auth_or_permission`, `browser_coverage_gap`, `command_resolution`, `component_failure_surface`, `configuration_error`, `contract_mismatch`, `network_connectivity`, `property_violation`, `resource_exhaustion`, `selector_or_dom_drift`, and `timeout_or_latency`; emitted `root_cause` observations expose the selected class as `semantics.failureClass`. Precedence is evidence-scoped: API contract evidence wins over incidental auth/network/timeout-like wording, CLI executable-resolution evidence wins over config-like executable names, and real config-file/value evidence remains `configuration_error`. `targets.cli` is trusted local execution input for `cli-tester`: it is parsed with `shell: false` and output is capped, but the configured executable still runs on the operator machine. `propagation` observations are also diagnostic: they stay low-calibration, declare non-authoritative heuristic status, expose `semantics.propagationLink`, and must not be treated as causal proof.

If `selfHealing`, `prediction`, or `collective` are enabled, runtime validation fails clearly.

---

## `quantum`

```yaml
quantum:
  enabled: true
  branches: 100
  collapse_strategy: significance
  max_depth: 20
  timeout: 30s
```

Alias mapping:
- `collapse_strategy` → `collapseStrategy`
- `max_depth` → `maxDepth`

| Field | Type | Notes |
|-------|------|-------|
| `enabled` | boolean | Requires `targets.web` |
| `branches` | positive integer | Number of branches |
| `collapse_strategy` / `collapseStrategy` | `significance | diversity | coverage` | Collapse behavior |
| `max_depth` / `maxDepth` | positive integer | Maximum branch depth |
| `timeout` | positive number or duration string | Supports `ms`, `s`, `m` |

---

## `chaos`

```yaml
chaos:
  enabled: false
```

Schema shape:

```yaml
chaos:
  enabled: false
  experiments: []
```

Current runtime rule:
- `chaos.enabled` must be `false`
- `chaos.experiments` must be absent or empty

Any enabled chaos configuration fails clearly because there is no capability-backed chaos execution path yet.
