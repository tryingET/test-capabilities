---
summary: "How-to guide for bootstrapping test-capabilities in a new repo without creating adoption debt."
read_when:
  - "You are starting a new repo and want test-capabilities from day one"
  - "You want a greenfield setup path before adding Surf Go or Bombadil-compatible runtimes"
type: "how-to"
---

# Greenfield bootstrap how-to

This guide is for agents and operators adding `test-capabilities` to a **new** repository.

Use this when the repo is still flexible enough that you can choose target commands, config shape, CI scripts, and optional runtime boundaries up front. Use [brownfield integration](brownfield-integration-how-to.md) when the repo already has meaningful structure, tests, or external browser/property tooling.

Canonical product semantics still live in:

- [`../api/cli.md`](../api/cli.md)
- [`../api/config.md`](../api/config.md)
- [`../api/getting-started.md`](../api/getting-started.md)

This guide is about **adoption shape**, not replacing those command contracts.

## Greenfield goal

A good greenfield setup starts with one boring, truthful proof before adding advanced surfaces.

Start with:

```text
safe CLI command that supports --help
  -> test-capabilities init
  -> doctor
  -> test --quick --json
  -> CI/release smoke
```

Do not start by enabling unsupported autonomy, prediction, collective learning, API fuzzing, or report/visualize commands. Those surfaces intentionally fail closed today.

## Bootstrap recipe

### 1) Pick the first target command

Choose a command that is safe to execute with `--help` and does not mutate state.

Good first targets:

- `node`
- `npm`
- a repo-local CLI with a read-only `--help`
- a small script fixture dedicated to smoke testing

Avoid first targets that require credentials, network access, browsers, databases, or production state.

### 2) Generate the config instead of hand-authoring it

From the target repo:

```bash
test-capabilities init --output test-capabilities.yaml --target node
```

Use `--print` if you want to review before writing:

```bash
test-capabilities init --target node --print
```

The generated config enables only `cli-tester`, disables unsupported intelligence/autonomy modes, and validates against the same config schema used by `test`.

### 3) Run doctor before running the target

```bash
test-capabilities doctor --config test-capabilities.yaml --target node
```

`doctor` checks package/runtime basics, config shape, and target executability without running the target command. Missing Surf Go or Bombadil-compatible runtimes are warnings, not failures, for this first path.

### 4) Run the first smoke with machine-readable output

```bash
test-capabilities test --config test-capabilities.yaml --quick --json
```

For the first greenfield proof, expect:

- `operationId: "test"`
- `summary.health: "pass"`
- zero findings for a healthy CLI target
- an `observation.v1` CLI smoke observation
- explicit coverage gaps for unmeasured web/API dimensions

The coverage gaps are not failure theater; they state what the first slice did not try to measure.

### 5) Add a repo-local script

In the target repo, add a boring script such as:

```json
{
  "scripts": {
    "capability:doctor": "test-capabilities doctor --config test-capabilities.yaml --target node",
    "capability:smoke": "test-capabilities test --config test-capabilities.yaml --quick --json"
  }
}
```

Then wire `npm run capability:smoke` into CI only after it is green locally.

### 6) Add optional web/property runtimes later

Only after the CLI smoke path is stable, add advanced integrations:

- Surf Go for `surf explore` or the `surf` orchestrator agent
- a Bombadil-compatible runtime for property/web exploration
- `heal` for reviewable selector repair proposals
- `quantum` for direct simulator exploration

Each advanced surface should get its own config example and proof command. Do not mix all surfaces into the first adoption commit.

## Greenfield anti-patterns

Avoid these:

- hand-writing config when `init` can generate the first valid baseline
- enabling unsupported autonomy/prediction flags and treating their fail-closed errors as bugs
- making Surf Go or Bombadil mandatory for the first proof
- using a mutating command as the first `cli-tester` target
- hiding JSON output from CI/agents when `--json` exists
- treating partial coverage as failure instead of an honest measurement boundary

## Definition of a good greenfield start

A greenfield repo is in good shape when:

- `test-capabilities doctor` passes for required checks
- `test-capabilities init` generated the first config or the config clearly matches its shape
- `test-capabilities test --quick --json` passes for one safe CLI target
- CI has a small smoke script that does not require optional external runtimes
- docs state which surfaces are intentionally not measured yet
- optional Surf/Bombadil/healing/quantum work is left as later bounded additions
