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

### No enabled supported agents

```text
At least one enabled agent is required. The current orchestrator capability contract supports the 'cli-tester' agent.
```

**Cause**
- `agents` is missing
- all agents are disabled
- only unsupported agent types are enabled

**Fix**
Configure at least one enabled `cli-tester` agent.

---

### Unsupported agent type

```text
Unsupported agent type(s): web:surf. Outside the current capability contract.
```

**Cause**
- An enabled agent uses `surf`, `bombadil`, or `api-fuzzer`

**Fix**
- Disable those agents for the orchestrator path
- Keep `cli-tester` as the enabled orchestrator agent

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
