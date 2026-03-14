---
summary: "API reference for failure prediction engines, inputs, and outputs."
read_when:
  - "You are wiring ML-style prediction into TEST-CAPABILITIES"
  - "You need method-level details for prediction APIs"
type: "reference"
---

# Prediction API

> Prediction is currently a **library surface**. The fail-closed CLI wrapper does **not** expose `test-capabilities predict` as a supported command today.

---

## PredictionEngine

### Constructor

```typescript
import { PredictionEngine } from 'test-capabilities';

const engine = new PredictionEngine();
```

### `analyze(metrics)`

Analyze metrics and return ranked predictions.

```typescript
const predictions = await engine.analyze({
  errorRate: 0.05,
  responseTimeP95: 1200,
  cpuUsage: 0.6,
  memoryUsage: 0.7,
  diskUsage: 0.4,
  timeSinceDeployment: 24,
  hourOfDay: 14,
  dayOfWeek: 3,
  sessionDepthAvg: 4.5,
  rageClickRate: 0.08,
  abandonmentRate: 0.15,
  bounceRate: 0.3,
  filesChanged: 12,
  linesAdded: 250,
  linesDeleted: 100,
  testCoverageDelta: -0.02,
  recentFailures: 3,
  avgTimeBetweenFailures: 8,
});
```

### Prediction shape

```typescript
interface Prediction {
  component: string;
  probability: number;     // 0-1
  confidence: number;      // 0-1
  trigger: string;
  preventiveAction: string;
  timeHorizon: string;
  relatedMetrics: string[];
  riskScore: number;
}
```

### Example

```typescript
for (const prediction of predictions) {
  console.log(`${prediction.component}: ${(prediction.probability * 100).toFixed(1)}%`);
  console.log(`  trigger: ${prediction.trigger}`);
  console.log(`  horizon: ${prediction.timeHorizon}`);
  console.log(`  prevention: ${prediction.preventiveAction}`);
}
```

---

## Utility methods

### `getTopRisks(n)`

```typescript
const topRisks = engine.getTopRisks(5);
```

### `getPredictionsByComponent(component)`

```typescript
const checkoutRisks = engine.getPredictionsByComponent('checkout');
```

### `getPredictionsByHorizon(horizon)`

```typescript
const urgentRisks = engine.getPredictionsByHorizon('< 1 hour');
```

---

## Training and feedback

### `addTrainingData(data)`

```typescript
await engine.addTrainingData({
  input: metrics,
  outcome: {
    failed: true,
    component: 'checkout',
    failureType: 'timeout',
  },
});
```

### `recordOutcome(predictionId, failed)`

```typescript
await engine.recordOutcome('pred_001', true);
```

---

## Custom models

```typescript
import type {
  Prediction,
  PredictionInput,
  PredictionModel,
  TrainingData,
} from 'test-capabilities';

class CustomPredictor implements PredictionModel {
  name = 'custom-predictor';
  version = '1.0.0';
  features = ['errorRate', 'responseTimeP95'];

  async predict(input: PredictionInput): Promise<Prediction[]> {
    return [];
  }

  async train(data: TrainingData[]): Promise<void> {
    console.log(`training on ${data.length} records`);
  }
}

const engine = new PredictionEngine(new CustomPredictor());
```

---

## PredictionCollector

```typescript
import { PredictionCollector } from 'test-capabilities';

const collector = new PredictionCollector();
const metrics = await collector.collectMetrics('service-a');
```

### Current collector behavior

At the moment, `PredictionCollector` returns **deterministic placeholder metrics per source string** until a real collector is wired in.

That means:
- repeated calls with the same source return the same metric shape
- different sources produce different deterministic values
- this is suitable for contract testing and local experimentation, not for claiming real telemetry ingestion

### `startCollection(interval)`

Starts periodic collection and returns a cleanup function.

```typescript
const stop = await collector.startCollection(60000);

// later
stop();
```

---

## CLI status

The current CLI wrapper does **not** support direct prediction execution.

If you run:

```bash
test-capabilities predict
```

it fails clearly as an unsupported command in the current capability contract.
