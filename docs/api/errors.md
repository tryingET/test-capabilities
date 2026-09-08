---
summary: "Error contract for TEST-CAPABILITIES: the [code] text line, the {\"error\": {code, message, details}} JSON envelope, the registered code vocabulary, the result-outcome classes the classifier assigns, and recovery steps for the common failures."
read_when:
  - "A command or integration is failing and you need recovery guidance"
  - "You parse the CLI output and need the error envelope, the exit codes and the code vocabulary"
  - "You add a refusal to the runtime and need to know where its code is registered"
type: "reference"
---

# Error Handling

> Current failure modes for the fail-closed runtime.

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Supported command completed successfully |
| `1` | Configuration error, unsupported surface, or runtime failure |

The framework keeps two exit codes (operator decision D3). The third state - a run that produced
no evidence either way - is carried in the envelope, not in the exit status: from slice S4 every
`test` envelope has `determination: { value, basis, reason }` next to `passed`, and `unverified`
and `indeterminate` map to exit 1 like a failure. Exit code 2 is revisited once consumers read
the envelope.

---

## Error shape

Every failure the runtime raises carries a registered code (`src/core/error-codes.ts`) on a
`FrameworkError`, and leaves the CLI in one of two renderings:

Text mode - one red line on **stderr**, with the code in brackets, the same shape surf uses:

```text
Surf explore requires --url with a valid URL. [config_invalid]
```

`--json` - the envelope on **stdout**, exit 1, and nothing else on stdout:

```json
{
  "error": {
    "code": "config_not_found",
    "message": "Config file not found: /repo/test-capabilities.yaml",
    "details": { "path": "/repo/test-capabilities.yaml" }
  }
}
```

`details` is optional and its shape depends on the code: `{ category, values }` for an
unsupported surface, `{ issues: [{ path, message }] }` for a schema failure, `{ path }` for a
missing config file. The library exports `FrameworkError`, `isFrameworkError`, `toErrorEnvelope`
and `renderErrorLine` so a programmatic caller renders the same two shapes.

### Registered codes

| Code | Raised when |
|------|-------------|
| `unsupported_command` | A registered but unimplemented CLI command (`predict`, `visualize`, `report`) was invoked |
| `unsupported_surf_action` | A `surf` action other than `explore`, `plan` or `apply` was invoked, or the action was missing |
| `unsupported_option` | An option outside the implemented set was passed to `test` or `surf explore`, or an option belonging to another surf action was passed (`--field` to `explore`, `--depth` to `plan`) |
| `unsupported_agent_type` | An enabled agent has a type the orchestrator contract does not implement |
| `unsupported_intelligence` | An `intelligence.*` capability was enabled that is not wired to a runtime |
| `unsupported_config_section` | A config section (today: `chaos`) was enabled without a runtime |
| `invalid_route_payload` | A CLI route object reached the kernel without a usable command |
| `config_invalid` | A config file or CLI input failed its schema; `details.issues` lists path and message |
| `config_not_found` | `--config` (or the default path) names a file that does not exist |
| `page_not_ready` | `surf explore` reached a page state it cannot probe (and no empty marker declared that state acceptable) |
| `probe_unverified` | A `surf explore` probe produced no verified browser evidence, so no user-flow coverage may be claimed from it |
| `unclassified_error` | The framework raised an error the registry does not name yet. It is never a verdict about the target |
| `effect_unclassified` | An operation or a step reached the kernel without an effect class. There is no default class: no class, no capability, no run |
| `effect_declaration_invalid` | A declaration contradicts its class (a `precondition` or `verify` on a read-only step, a mutating step without a scope, a `verify` that answered `applied` with no evidence) |
| `mutation_retry_refused` | A mutating step declared `maxAttempts > 1` or a `retryOn` list. Mutating steps are attempted exactly once |
| `mutation_replay_refused` | The same idempotency key twice in one run, or a receipt for it on disk that is still `attempting` or `unknown`. The message names the receipt and the exact `--supersede-receipt <id>` line |
| `mutation_outcome_unknown` | A mutating step reported nothing (timeout, signal, tab gone) and no `verify` promoted it. The run fails closed; `error.details.receipts` carries the receipt |
| `mutation_step_not_started` | A mutating step's process never started (the binary could not be executed). Nothing happened, so the receipt settles `failed` and the key is not locked |
| `mutation_receipt_write_failed` | The `attempting` receipt did not reach disk. The step was not run |
| `precondition_failed` | The content a workspace write expected to find is not what is there now. Nothing was written |
| `read_only_violation` | A `read_only` claim failed the static denylist before the step ran. Declare `mutating` instead of weakening the list |
| `read_only_violation_observed` | A read-only attempt's own evidence shows the target moved. The remaining retry budget is forfeit |
| `owned_tab_required` | A target-affecting browser command was asked to run without a tab this run created |
| `mutation_origin_not_allowed` | A mutating step whose subject is a web origin that `mutation.allowOrigins` does not name |
| `mutation_receipts_ephemeral` | `receipts.dir` resolves inside a workspace that does not survive the run (`$TMPDIR`, a CI job workspace, a linked git worktree). Set `receipts.ephemeral: true` (or `TEST_CAPABILITIES_RECEIPTS_EPHEMERAL=1`) to accept that, or point `receipts.dir` somewhere durable |
| `plan_field_not_found` | A `surf plan --field` locator matched no element on the gated page. No artifact is written |
| `plan_field_ambiguous` | A `--field` locator matched more than one element, or no CSS selector resolves to exactly the element it found |
| `value_via_button_refused` | A `--field` locator resolves to a button, a link or a submit input. A value is set only through the field's own input: this is the "Set bid" rule |
| `plan_field_unreachable` | The field is not addressable from the top document and the page carries frames. Diagnose the frame boundary before planning against it |
| `plan_stale` | The page no longer matches the plan's fingerprint (URL, form count, field identity or the buttons around them). Re-plan; nothing is healed |
| `field_readback_mismatch` | The value read back out of the field is not the value the plan intended. The refusal names the field id and its selector, never the value |
| `fill_side_effect_observed` | The page navigated, or the form vanished, while filling. A dry run that moved the page is a failed dry run, never a passed one |
| `submit_origin_not_allowed` | The world: `mutation.allowOrigins` does not name the plan's origin. No flag and no environment variable adds one |
| `submit_gate_closed` | The intent: `--submit` without `--confirm-plan`, or `--confirm-plan` without `--submit` |
| `submit_plan_mismatch` | The intent: `--confirm-plan` does not equal the token recomputed from the plan file, or the file no longer hashes to its own `approval_token` (an edited plan) |
| `submit_already_attempted` | At-most-once: a submit-mode receipt for this `plan_id` already exists, whatever its outcome. Fill-mode receipts never block a submit |
| `plan_submit_ambiguous` | The plan recorded more than one submit candidate. Re-plan with `--submit-text` or `--submit-selector` |
| `plan_submit_missing` | The plan recorded no submit control at all (often an SPA with no owning form). Re-plan with `--submit-selector` |
| `submit_control_disabled` | The submit control was still `disabled` when `surf.submit.controlEnableTimeoutMs` ran out |
| `submit_control_changed` | The submit control is no longer unique, or no longer inside the fields' owning form, after the fill |
| `submit_postcondition_unmet` | The click was sent and the post-condition was never observed. `submitted: "unknown"`, the receipt is `unknown`, and the plan can never be submitted again |

Codes from tools the framework does not own pass through verbatim and are never rewritten:
surf's `page_login`, `page_challenge`, `page_not_found`, `page_error`, `page_timeout`,
`empty_result`, `no_output`, `browser_error`, `spawn_failed`.

---

## Result outcomes

A failure is not the only way a run can produce no verdict. Every sensor result (CLI process,
surf command, HTTP call, Bombadil run) is classified once, by one pure function
(`classifyResult`, `src/core/result-classification.ts`), into a closed class set with an explicit
basis. `ok` is true only for `success` and `declared_empty`.

| Class | `ok` | Basis | Code | Meaning |
|-------|------|-------|------|---------|
| `success` | yes | `evidence` | `ok` | A payload was produced and no error signal was found |
| `declared_empty` | yes | `evidence` | `declared_empty` | The payload was empty and emptiness was declared (config `expect`, operation code, or an HTTP protocol fact) |
| `empty` | no | `no_evidence` | `empty_result` | The payload was empty and nothing declared that acceptable. This is the absence of information, not a claim that the target is broken |
| `error` | no | `fault` | surf code, `exit_<n>`, `http_<status>`, `row_error` | An error signal arrived under a contract the framework owns or the operator declared |
| `timeout` | no | `fault` or `indeterminate` | `timeout`, `signal_<NAME>` | The step was killed at its budget or by a signal. On a mutating step the basis is `indeterminate`: nothing is known about the target |
| `spawn_failed` | no | `fault` or `indeterminate` | `spawn_failed` | The process never started |
| `unclassifiable` | no | `contradiction` | `unclassifiable`, `invalid_output` | The reply contradicts itself (exit 0 with an error envelope in a declared JSON payload, `success: true` carrying an error, a JSON payload that does not parse). Nothing downstream may reinterpret it |

Two rules follow from the basis, and both are deliberate: the healer proposes only from
`basis: fault`, and a finding for `empty` says "no evidence", never "bug in the target". The
first two evidence lines of every classified step are `outcome:<class>:<code>` and
`basis:<basis>`, so a verdict can be replayed from the receipt.

Signals that arrive under no contract are recorded and change no class: `stderr_error_line`
(an `Error:` line on stderr from a CLI target that exited 0), `payload_error_key_present` (an
`error` key in opaque stdout), `tester_verdict_overruled` (an LLM tester's `pass` on a step whose
outcome is not `ok`).

An empty payload is a failure by default. Declare it where emptiness is correct:

```yaml
agents:
  cli-smoke:
    type: cli-tester
    expect:
      output: empty          # required (default) | empty
      empty_marker: "no results"   # optional; must match the trimmed stdout or surf's empty state
```

---

## Common errors

### Config file missing

```text
Config file not found: /path/to/test-capabilities.yaml [config_not_found]
```

**Cause**
- `--config` points at a missing file
- default `./test-capabilities.yaml` does not exist

**Fix**
1. Create the file
2. Or point `--config` at the correct path

---

### Unsupported command

```text
Unsupported CLI command(s): predict. Outside the current capability contract. This command currently has no capability-backed implementation. [unsupported_command]
```

**Cause**
- You invoked a registered but unsupported command such as `predict`, `visualize`, or `report`

**Fix**
1. Use a currently implemented command: `test`, `surf explore`, `quantum`, or `heal`
2. If you need direct library access, use the TypeScript API instead of the CLI placeholder surface

---

### Unsupported test option

```text
Unsupported option(s) for 'test': --predict. Outside the current capability contract. [unsupported_option]
```

**Cause**
- You passed an option that the current `test` runtime does not implement

**Fix**
- Use only:
  - `--config`
  - `--target`
  - `--quick`

---

### Unsupported surf explore option

```text
Unsupported option(s) for 'surf explore': --record. Outside the current capability contract. [unsupported_option]
```

**Cause**
- You passed a surf explore flag that the shipped kernel has not wired to real behavior yet

**Fix**
- Use only:
  - `--url`
  - `--depth`
  - `--json`

---

### Missing surf explore URL

```text
Surf explore requires --url with a valid URL.
```

**Cause**
- You invoked `surf explore` without `--url`

**Fix**
- Pass a fully qualified URL such as `https://example.com`

---

### Invalid surf explore URL

```text
Surf explore target must be a valid URL.
```

**Cause**
- `--url` was present but not a valid URL

**Fix**
- Pass a fully qualified URL such as `https://example.com`

---

### Surf explore refused by a typed readiness state

```
Surf explore refused https://github.com/settings/profile: page readiness is 'login' [page_login]: Page is not ready: login at https://github.com/login. Evidence: 1 visible password field(s); URL path /login looks like a login route
```

**Cause**:
- `surf wait.ready` classified the owned tab as `login`, `challenge`, `not-found`, `error`, or timed out (`page_timeout`) before the framework probed it

**Fix**:
- Log the agent browser into the site first, pick a public URL, or fix the target; the framework never probes an unclassified or bounced page

---

### Surf CLI without the readiness/extract mechanisms

```
surf 2.18.0 via path_surf (/usr/local/bin/surf) lacks wait.ready and extract. Surf explore requires the surf-cli build with typed page readiness and owned-tab extraction ...
```

**Cause**:
- The resolved `surf` is an upstream build without the `feat/site-independent-mechanisms` branch

**Fix**:
- Install the branch build and point `TEST_CAPABILITIES_SURF_BIN` at it, or put it first on `PATH`

---

### Retired surf-go env vars

```
TEST_CAPABILITIES_SURF_GO_BIN is set, but the surf-go fork runtime was retired (upstream deleted, binary removed). Unset it and use TEST_CAPABILITIES_SURF_BIN, 'surf' on PATH, or ~/.local/bin/surf from nicobailon/surf-cli.
```

**Fix**:
- Unset `TEST_CAPABILITIES_SURF_GO_BIN` / `TEST_CAPABILITIES_SURF_GO_REPO`

---

### Unsupported surf action

```text
Unsupported surf action(s): typo. Outside the current capability contract. [unsupported_surf_action]
```

**Cause**
- You invoked a surf action that the shipped kernel does not recognize or support

**Fix**
- Use `surf explore` for the current CLI wrapper
- Richer programmatic browser behavior arrives as the kernel `Session` interface in the 0.4.0 release line (`SurfClient` is no longer exported)

---

### Missing quantum target

```text
Quantum simulation requires --target with a valid URL.
```

**Cause**
- You invoked `quantum` without `--target`

**Fix**
- Pass a fully qualified URL such as `https://example.com`

---

### Invalid quantum branch count

```text
Invalid value for --branches: 0. Use a positive integer.
```

**Cause**
- `--branches` was `0`, negative, or non-numeric

**Fix**
- Pass a positive integer such as `1`, `100`, or `250`

---

### Invalid quantum target

```text
Quantum target must be a valid URL.
```

**Cause**
- `--target` was not a valid URL

**Fix**
- Pass a fully qualified URL such as `https://example.com`

---

### Invalid JSON payload from a surf command

```text
Invalid JSON output from surf network: warning: capture disabled
```

**Cause**
- A surf command that should return JSON printed warnings or plain text without a parseable payload
- The runtime fails clearly instead of silently treating malformed structured output as empty data

**Fix**
- Re-run the underlying surf command directly to inspect stdout/stderr
- Remove the warning-producing condition or upgrade the wrapper/parser contract so the command emits a parseable JSON payload

---

### Empty result where output was required

```text
outcome:empty:empty_result
basis:no_evidence
```

**Cause**
- The command, page or endpoint produced no payload: an empty stdout, `{}`/`[]`/`null`, zero extract rows, a zero-byte HTTP body, or a Bombadil run without a trace
- Nothing declared that emptiness acceptable

**Fix**
1. Fix the target so it produces output, or
2. Declare it: `expect: { output: empty }` on the agent (with an optional `empty_marker`), which turns the run into `declared_empty`

This is the one refusal that says nothing about the target: `basis: no_evidence` means the run
carries no information, so the healer refuses to propose from it.

---

### Prediction input invalid

```text
Prediction input is incomplete or invalid. Provide finite numeric values for: ...
```

**Cause**
- A library caller passed a partial metrics object
- one or more fields were `NaN`, `Infinity`, or otherwise non-finite

**Fix**
- Provide the full `PredictionInput` shape with finite numeric values for every field
- If you only have partial telemetry, model that upstream before calling `PredictionEngine.analyze(...)`

---

### Heal directory missing

```text
Heal directory not found: /path/to/tests. Use --dir with an existing directory.
```

**Cause**
- `--dir` points at a missing path

**Fix**
1. Create the directory first
2. Or point `--dir` at an existing test directory

---

### No enabled supported agents

```text
At least one enabled agent is required. The current orchestrator capability contract supports the 'bombadil', 'surf', and 'cli-tester' agents.
```

**Cause**
- `agents` is missing
- all agents are disabled
- only unsupported agent types are enabled

**Fix**
Configure at least one enabled `bombadil`, `surf`, or `cli-tester` agent.

---

### Unsupported agent type

```text
Unsupported agent type(s): api:api-fuzzer. Outside the current capability contract. [unsupported_agent_type]
```

**Cause**
- An enabled agent uses `api-fuzzer`

**Fix**
- Disable those agents for the orchestrator path
- Keep `bombadil`, `surf`, and/or `cli-tester` as the enabled orchestrator agents

---

### Web agent target missing

```text
The enabled 'bombadil' agent requires targets.web to be configured with a valid URL origin.
The enabled 'surf' agent requires targets.web to be configured with a valid URL origin.
```

**Cause**
- `bombadil` or `surf` is enabled but `targets.web` is missing

**Fix**
Add a web target, for example:

```yaml
targets:
  web: 'https://example.com'
```

For Surf, make sure the surf CLI is resolvable through `TEST_CAPABILITIES_SURF_BIN`, `surf` on `PATH`, or `~/.local/bin/surf`, has the `wait.ready`/`extract` mechanisms, and that `surf doctor --browser chromium` is OK.
For Bombadil, make sure the binary can be resolved through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, repo-local `external/bombadil`, or `bombadil` on `PATH`.
If you only cloned the source repo, build it first so `target/release|debug/bombadil` exists; upstream Bombadil 0.5 no longer requires `esbuild`, though source builds may still need `trunk` or the project Nix shell.

---

### CLI target missing

```text
The enabled 'cli-tester' agent requires targets.cli to be configured with an executable command or path.
```

**Cause**
- `cli-tester` is enabled but `targets.cli` is missing

**Fix**
Add a CLI target, for example:

```yaml
targets:
  cli: 'node'
```

---

### CLI smoke command failed

```text
CLI smoke command failed: ./bin/myapp --help
```

**Cause**
- The configured command does not exist
- it is not executable
- `--help` exits non-zero
- the process timed out

**Fix**
1. Run the configured command manually with `--help`
2. Ensure the executable exists and has execute permissions
3. If the executable path contains spaces, quote it in `targets.cli`

Example:

```yaml
targets:
  cli: '"/tmp/my tools/fake cli.sh"'
```

---

### Quantum configuration invalid

```text
Quantum simulation requires targets.web so the simulator has a URL to model.
```

**Cause**
- `quantum.enabled: true` but `targets.web` is absent

**Fix**
Add a web target or disable quantum for that run.

---

### Chaos enabled without runtime support

```text
Unsupported config section(s): chaos. Outside the current capability contract. [unsupported_config_section]
```

**Cause**
- `chaos.enabled: true`
- `chaos.experiments` configured while chaos is not implemented

**Fix**
Keep chaos disabled until a capability-backed runtime exists.

---

## Troubleshooting order

1. Validate the config file exists
2. Check for unsupported commands or flags
3. Verify enabled agents are currently supported
4. Run the configured CLI target manually with `--help`
5. Re-run `npm test` and `npm run check` after changes
