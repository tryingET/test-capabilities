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

## Example 4: surf exploration

```bash
test-capabilities surf explore --url https://example.com
```

---

## Example 5: selector healing as a library workflow

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

## Example 6: prediction engine as a direct library API

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

## Example 7: quantum simulation

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

## Example 8: packaged consumer smoke

```bash
npm run consumer:smoke
```

Use this to verify the packed artifact still exposes a working consumer contract.

---

## Example 9: repo-local capability drill

```bash
npm run capability:drill
```

This repo-local harness exercises the currently shipped capabilities against deterministic local fixtures.
By default it auto-detects `surf`: if `surf` is on `PATH`, the drill uses the real command; otherwise it installs a temporary shim so the wrapper path can still be verified.

```bash
# Force the deterministic surf shim
bash ./scripts/capability-drill.sh --surf-mode shim

# Require a real surf install
bash ./scripts/capability-drill.sh --surf-mode real

# Emit machine-readable JSON for CI / agent consumers
bash ./scripts/capability-drill.sh --json --surf-mode shim --skip-build
```
