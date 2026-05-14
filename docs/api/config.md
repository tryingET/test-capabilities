---
summary: "Reference for the test-capabilities.yaml configuration contract."
read_when:
  - "You are authoring or validating a TEST-CAPABILITIES config file"
  - "You need field-level configuration examples and expectations"
type: "reference"
---

# Configuration

> Exact configuration contract for the current fail-closed runtime.

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
| `type` | `bombadil | surf | api-fuzzer | cli-tester` |
| `enabled` | boolean |
| `intensity` | `gentle | normal | aggressive` |
| `duration` | string |
| `focus` | string[] |

If an enabled agent uses `api-fuzzer`, runtime validation fails clearly.
If an enabled agent uses `surf`, runtime validation requires `targets.web` and a resolvable Surf Go runtime: `TEST_CAPABILITIES_SURF_GO_BIN`, `TEST_CAPABILITIES_SURF_GO_REPO`, the conventional workspace-local `softwareco/contrib/surf-cli-go` checkout, or `surf-go` on `PATH`. Explicit Surf Go repo env vars fail closed when invalid instead of silently switching to PATH.
If an enabled agent uses `bombadil`, runtime validation requires `targets.web` and a Bombadil binary that can be resolved through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built checkout pointed to by `TEST_CAPABILITIES_BOMBADIL_REPO`, the conventional workspace-local `softwareco/contrib/bombadil`, repo-local `external/bombadil`, or `bombadil` on `PATH`.
A source checkout only overrides the vendored fallback after it has a built `target/release/bombadil` or `target/debug/bombadil`; upstream Bombadil currently also expects `trunk` and `esbuild` for local builds, or its Nix shell.

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
