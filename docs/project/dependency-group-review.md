---
summary: "Owner review of test-capabilities dependency groups after dependency-intelligence pilots."
read_when:
  - "Reviewing test-capabilities package dependencies after dependency-intelligence evidence."
  - "Deciding whether runtime observations support dependency-group expectations or follow-up review."
type: "project"
---

# Dependency group review

## Design membrane

This owner-side review consumes the dependency-intelligence pilots for `test-capabilities` and classifies dependency groups by expected runtime role.

Inputs:

- `docs/project/dependency-intelligence-corridor-pilot.md`
- `docs/project/dependency-intelligence-multiscenario-pilot.md`
- `docs/project/dependency-intelligence-runtime-autodiscovery-pilot.md`
- `docs/project/dependency-intelligence-scenario-diversity-pilot.md`
- `package.json`
- direct import scan over `src/`, `bin/`, `scripts/`, and `tests/`

Boundary principle:

```text
runtime-observed in a scenario != required everywhere
runtime-unobserved in a scenario != unused
source import role + package manifest + scenario evidence -> review posture
```

This review does not authorize dependency removal, replacement, remediation, publication, or release.

## Current declared runtime dependencies

`package.json` declares six runtime dependencies:

| Dependency | Source-owner role | Import evidence | Runtime evidence interpretation | Review posture |
|---|---|---|---|---|
| `commander` | CLI command parser | `bin/test-capabilities` imports `Command` | Observed in CLI scenarios and shared CLI startup/autodiscovery runs. Not observed in package-level probes that bypass `bin/`. | Expected CLI-startup dependency. Keep as runtime dependency while the CLI entrypoint remains commander-backed. |
| `chalk` | CLI presentation / terminal color | `bin/test-capabilities` imports `chalk` | Observed in shared CLI startup/autodiscovery runs. Not observed in package-level API probes. | Expected CLI-startup presentation dependency. Review only if a no-color/minimal CLI mode becomes a packaging goal. |
| `figlet` | CLI banner/presentation | `bin/test-capabilities` imports `figlet` | Observed in shared CLI startup/autodiscovery runs. Not observed in package-level API probes. | Expected CLI-startup presentation dependency, but a future UX/packaging review could ask whether banner rendering belongs on every CLI startup path. |
| `ora` | CLI spinner/presentation | `bin/test-capabilities` imports `ora` | Observed in shared CLI startup/autodiscovery runs. Not observed in package-level API probes. | Expected CLI-startup presentation dependency. Review only if startup cost or non-interactive output policy changes. |
| `js-yaml` | YAML config parsing/emission | `src/core/operations/config-load-core.ts`, `init-operation.ts`, and `surf-explore-operation.ts` import `js-yaml`; tests/scripts also consume YAML | Observed in CLI fixture/capability scenarios and package-level API probes that exercise config/operation loading. | Expected public API/config dependency. Keep as runtime dependency while YAML config remains supported. |
| `zod` | Runtime input/config/result schemas | operation modules and orchestrator import `zod` | Observed in CLI and package-level API probes. Module-specific probes may bypass schema-heavy routes. | Expected operation-kernel/public API dependency. Keep as runtime dependency while schemas are runtime-validated. |

## Dev-only dependencies

The remaining package entries are dev/build/test dependencies in `package.json`:

| Dependency | Role | Review posture |
|---|---|---|
| `@biomejs/biome` | lint/format quality tooling | Expected dev dependency. |
| `@cucumber/cucumber` | behavior tests | Expected dev dependency while behavior scenarios remain part of the proof suite. |
| `@types/figlet` | TypeScript typing for `figlet` | Expected dev typing dependency paired with runtime `figlet`. |
| `@types/node` | Node TypeScript typing | Expected dev dependency. |
| `@typescript/native-preview` | native TypeScript preview compiler used by repo quality checks | Expected dev/build dependency under current quality posture. |
| `fast-check` | property tests | Expected dev dependency. |
| `vitest` | test tooling dependency retained in manifest | Review prompt: direct current scripts use `node --test` and Cucumber; verify whether Vitest is still required before any removal proposal. |

## Scenario interpretation

The dependency-intelligence runs now separate three useful runtime contexts:

1. **CLI startup/rendering path** observes the presentation/parser set: `commander`, `chalk`, `figlet`, `ora`, plus config/schema dependencies when commands reach those routes.
2. **Public API / operation-kernel path** observes `js-yaml` and `zod` without the CLI presentation stack when probes bypass `bin/test-capabilities`.
3. **Module-specific internals** such as quantum, healing, and surf-runtime can run under the chosen probes without external npm packages, which is evidence that those modules are currently local-code/Node-builtin heavy in the probed paths.

This is a more useful architecture signal than a flat observed/unobserved list. It suggests the dependency surface is mostly coherent:

```text
CLI shell: commander + chalk + figlet + ora
Config/API/kernel: js-yaml + zod
Internal modules: mostly local code / Node builtins under current probes
Dev proof suite: biome + cucumber + types + tsgo + fast-check + vitest review prompt
```

## Follow-up review prompts

These are review prompts, not actions:

1. **Vitest manifest review**: confirm whether `vitest` still has a live role. If not, open a separate dependency-removal proposal with tests and packed-consumer proof.
2. **CLI presentation budget**: decide whether `figlet` and `ora` should remain eager imports in `bin/test-capabilities` or become lazy/conditional if startup cost or non-interactive output policy becomes important.
3. **Package/API boundary test**: preserve at least one package-level probe that imports/uses the public API without loading `bin/test-capabilities`, because it guards against accidentally coupling API consumers to CLI presentation dependencies.
4. **Dependency replacement/removal authority**: route any actual dependency removal through a separate owner-approved change, ideally with dep-surgeon or equivalent replacement evidence, test-capabilities validation, and ts-quality adoption proof.

## Non-authorizations

This review does not authorize:

- dependency removal or pruning;
- replacement or remediation;
- public disclosure;
- release or merge approval;
- treating runtime-unobserved packages as unused;
- treating CLI presentation dependencies as package-level API dependencies;
- source-owner fact mutation from FCOS.

## Validation

Validation for this review slice:

```bash
cd /home/tryinget/ai-society/softwareco/owned/test-capabilities
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
git diff --check
npm run docs:list -- --task "dependency group review" --top 5
```
