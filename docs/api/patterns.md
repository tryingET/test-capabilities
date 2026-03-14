---
summary: "Integration patterns for composing TEST-CAPABILITIES into broader workflows."
read_when:
  - "You are designing how TEST-CAPABILITIES fits into a larger testing flow"
  - "You need reusable implementation patterns rather than single examples"
type: "reference"
---

# Integration Patterns

> Supported integration patterns for the current runtime contract.

---

## Pattern: Capability-backed CLI smoke

```typescript
import { createNexus } from 'test-capabilities';

async function runCliSmoke(command: string) {
  const suite = createNexus({
    version: '2.0',
    name: 'CLI Smoke',
    targets: { cli: command },
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

  return suite.run();
}
```

---

## Pattern: surf exploration wrapper

```bash
test-capabilities surf explore --url https://example.com
```

Use this when you want the TEST-CAPABILITIES command surface but the real work happens inside the installed `surf` binary.

---

## Pattern: direct healing maintenance loop

```typescript
import { TestFileHealer } from 'test-capabilities';
import fs from 'node:fs/promises';

async function maintainTests(files: string[]) {
  const healer = new TestFileHealer();

  for (const file of files) {
    const proposals = await healer.analyzeFile(file);

    for (const proposal of proposals) {
      if (proposal.confidence >= 0.9 && !proposal.requiresReview) {
        await healer.applyProposal(proposal);
      } else {
        await fs.appendFile(
          'healing-review.log',
          `${proposal.file}:${proposal.line} ${proposal.oldSelector} -> ${proposal.newSelector}\n`,
        );
      }
    }
  }
}
```

---

## Pattern: direct prediction monitoring

> The prediction engine is available as a library API even though the orchestrator CLI path keeps prediction fail-closed for now.

```typescript
import { PredictionCollector, PredictionEngine } from 'test-capabilities';

async function samplePrediction() {
  const collector = new PredictionCollector();
  const engine = new PredictionEngine();

  const metrics = await collector.collectMetrics('service-a');
  return engine.analyze(metrics);
}
```

---

## Pattern: quantum canary run

```bash
test-capabilities quantum --target https://staging.example.com --branches 250 --collapse
```

Use this as a separate simulator lane instead of assuming the orchestrator path runs every experimental subsystem.

---

## Pattern: CI contract gate

```yaml
name: TEST-CAPABILITIES Contract Gate

on: [pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
      - run: npm install
      - run: npm run build
      - run: npm test
      - run: npm run consumer:smoke
```

---

## Pattern: fail-closed config review

```yaml
version: '2.0'
name: 'Staging CLI Smoke'

targets:
  cli: 'node'
  web: 'https://staging.example.com'

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
  enabled: true
  branches: 100
  collapse_strategy: significance
  max_depth: 20
  timeout: 30s

chaos:
  enabled: false
```

This pattern works because every enabled feature maps to a real implementation path.
