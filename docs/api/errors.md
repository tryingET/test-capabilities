---
summary: "Troubleshooting guide for common TEST-CAPABILITIES errors and recovery steps."
read_when:
  - "A command or integration is failing and you need recovery guidance"
  - "You are documenting or diagnosing expected failure modes"
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

---

## Common errors

### Config file missing

```text
Config file not found: /path/to/test-capabilities.yaml
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
Unsupported CLI command(s): predict. Outside the current capability contract.
```

**Cause**
- You invoked a registered but unsupported command such as `predict`, `visualize`, or `report`

**Fix**
1. Use a currently implemented command: `test`, `surf explore`, `quantum`, or `heal`
2. If you need direct library access, use the TypeScript API instead of the CLI placeholder surface

---

### Unsupported test option

```text
Unsupported option(s) for 'test': --predict. Outside the current capability contract.
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
Unsupported option(s) for 'surf explore': --record. Outside the current capability contract.
```

**Cause**
- You passed a surf explore flag that the shipped kernel has not wired to real behavior yet

**Fix**
- Use only:
  - `--url`

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

### Unsupported surf action

```text
Unsupported surf action(s): typo. Outside the current capability contract.
```

**Cause**
- You invoked a surf action that the shipped kernel does not recognize or support

**Fix**
- Use `surf explore` for the current CLI wrapper
- Use `SurfClient` directly if you need richer browser behavior programmatically

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

### Invalid SurfClient JSON payload

```text
Invalid JSON output from surf network: warning: capture disabled
```

**Cause**
- A surf command that should return JSON printed warnings or plain text without a parseable payload
- The current runtime now fails clearly instead of silently treating malformed structured output as empty data

**Fix**
- Re-run the underlying surf command directly to inspect stdout/stderr
- Remove the warning-producing condition or upgrade the wrapper/parser contract so the command emits a parseable JSON payload

---

### Unsupported SurfClient config option

```text
Unsupported SurfClient config option(s): socketPath. Outside the current capability contract.
```

**Cause**
- You passed a `SurfClient` constructor option that the current runtime does not wire to real surf behavior
- Currently only `autoScreenshot` and `screenshotResize` are supported

**Fix**
- Remove `socketPath`, `networkCapture`, and `networkPath`
- Use only the supported config keys until the runtime grows a real implementation path

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
Unsupported agent type(s): api:api-fuzzer. Outside the current capability contract.
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

For Surf, make sure Surf Go is resolvable through `TEST_CAPABILITIES_SURF_GO_BIN`, a source checkout referenced by `TEST_CAPABILITIES_SURF_GO_REPO`, or `surf-go` on `PATH`.
For Bombadil, make sure the binary can be resolved through `TEST_CAPABILITIES_BOMBADIL_BIN`, a built source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO`, repo-local `external/bombadil`, or `bombadil` on `PATH`.
If you only cloned the source repo, build it first so `target/release|debug/bombadil` exists; upstream Bombadil currently also expects `trunk` and `esbuild` for local builds, or its Nix shell.

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
Unsupported config section(s): chaos. Outside the current capability contract.
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
