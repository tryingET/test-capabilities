---
summary: "Example-driven guide for common TEST-CAPABILITIES usage patterns."
read_when:
  - "You want concrete examples before implementing against the framework"
  - "You need copy-adaptable usage patterns for common tasks"
type: "reference"
---

# Examples

> Runtime-accurate examples for the current supported surface.

---

## Example 1: operation-kernel dispatch

```typescript
import { executeCliOperation } from 'test-capabilities';

const output = await executeCliOperation(
  { command: 'test' },
  {
    config: './test-capabilities.yaml',
    target: 'node',
    quick: true,
  },
);

console.log(output.operationId, output.summary.health);
```

---

## Example 2: CLI smoke through the orchestrator

```yaml
# test-capabilities.yaml
version: '2.0'
name: 'CLI Smoke'

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

```bash
test-capabilities test --quick --config test-capabilities.yaml
```

---

## Example 3: Programmatic orchestrator usage

```typescript
import { createTestCapabilities } from 'test-capabilities';

const suite = createTestCapabilities({
  version: '2.0',
  name: 'Programmatic CLI Smoke',
  targets: { cli: 'node' },
  agents: {
    cli: {
      enabled: true,
      type: 'cli-tester',
      intensity: 'normal',
    },
  },
  intelligence: {
    selfHealing: false,
    prediction: false,
    correlation: true,
    collective: false,
  },
  quantum: { enabled: false },
  chaos: { enabled: false },
});

const result = await suite.run();
console.log(result.passed, result.coverage);
```

---

## Example 4: Bombadil-backed web exploration

```yaml
version: '2.0'
name: 'Bombadil Web Exploration'

targets:
  web: 'https://example.com'

agents:
  web:
    enabled: true
    type: bombadil
    intensity: normal
    duration: 10s

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

```bash
TEST_CAPABILITIES_BOMBADIL_BIN=/path/to/bombadil \
  test-capabilities test --config test-capabilities.yaml --target https://example.com --quick
```

Or, if you have a source checkout:

```bash
TEST_CAPABILITIES_BOMBADIL_REPO=/path/to/bombadil-source \
  test-capabilities test --config test-capabilities.yaml --target https://example.com --quick
```

If you are running inside this repo checkout, the orchestrator can use a built Bombadil-compatible source checkout referenced by `TEST_CAPABILITIES_BOMBADIL_REPO` before falling back to repo-local `external/bombadil` and then `bombadil` on `PATH`.
A source checkout only overrides the vendored fallback after it has a built binary; upstream Bombadil currently also expects `trunk` and `esbuild` for local builds, or its Nix shell.

For a richer deterministic local regression, use the checked-in fixture runner:

```bash
npm run bombadil:smoke

# Or call the script directly when you want narrower control
bash ./scripts/bombadil-rich-smoke.sh --direct-only
bash ./scripts/bombadil-rich-smoke.sh --tc-only
```

This serves `examples/bombadil-rich/site/` on a temporary local port, runs Bombadil directly against it, and then runs the TEST-CAPABILITIES Bombadil-backed wrapper on the same fixture.

---

## Example 5: surf exploration

```bash
test-capabilities surf explore --url https://example.com
```

---

## Example 6: selector healing as a library workflow

```typescript
import { TestFileHealer } from 'test-capabilities';

const healer = new TestFileHealer();
const proposals = await healer.analyzeFile('./tests/login.spec.ts');

for (const proposal of proposals) {
  console.log(`${proposal.file}:${proposal.line}`);
  console.log(`- ${proposal.oldSelector}`);
  console.log(`+ ${proposal.newSelector}`);
}
```

---

## Example 7: prediction engine as a direct library API

> The prediction engine exists as a library surface, but it is not currently wired into the supported orchestrator CLI path.

```typescript
import { PredictionEngine } from 'test-capabilities';

const engine = new PredictionEngine();
const predictions = await engine.analyze({
  errorRate: 0.02,
  responseTimeP95: 600,
  cpuUsage: 0.3,
  memoryUsage: 0.4,
  diskUsage: 0.2,
  timeSinceDeployment: 3,
  hourOfDay: 10,
  dayOfWeek: 2,
  sessionDepthAvg: 4,
  rageClickRate: 0.02,
  abandonmentRate: 0.03,
  bounceRate: 0.1,
  filesChanged: 2,
  linesAdded: 30,
  linesDeleted: 10,
  testCoverageDelta: 0.01,
  recentFailures: 0,
  avgTimeBetweenFailures: 48,
});

console.log(predictions[0]);
```

---

## Example 8: quantum simulation

```typescript
import { QuantumTestRunner } from 'test-capabilities';

const runner = new QuantumTestRunner({
  branches: 200,
  collapseStrategy: 'significance',
  seed: 42,
});

const result = await runner.run('https://example.com');
console.log(result.collapsedFindings.length);
```

---

## Example 9: packaged consumer smoke

```bash
npm run consumer:smoke
```

Use this to verify the packed artifact still exposes a working consumer contract.

---

## Example 10: repo-local capability drill

```bash
npm run capability:drill
```

This repo-local harness exercises the currently shipped capabilities against deterministic local fixtures.
By default it auto-detects Surf Go; `--surf-mode shim` forces a deterministic temporary `surf-go` shim so the wrapper path can be verified without a browser host. Real mode accepts `surf-go` or a source checkout referenced by `TEST_CAPABILITIES_SURF_GO_REPO`.

```bash
# Force the deterministic surf-go shim
bash ./scripts/capability-drill.sh --surf-mode shim

# Require a real Surf runtime
bash ./scripts/capability-drill.sh --surf-mode real

# Emit machine-readable JSON for CI / agent consumers
bash ./scripts/capability-drill.sh --json --surf-mode shim --skip-build
```
