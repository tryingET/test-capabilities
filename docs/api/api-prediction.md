# Prediction API

> ML-powered failure prediction.

---

## PredictionEngine

### Constructor

```typescript
import { PredictionEngine } from '@test-capabilities/testing-framework';

const engine = new PredictionEngine();
```

### `analyze(metrics)`

Analyze system metrics and predict failures.

```typescript
const predictions = await engine.analyze({
  // System metrics
  errorRate: 0.05,           // 0-1
  responseTimeP95: 1200,     // ms
  cpuUsage: 0.6,             // 0-1
  memoryUsage: 0.7,          // 0-1
  diskUsage: 0.4,            // 0-1

  // Temporal
  timeSinceDeployment: 24,   // hours
  hourOfDay: 14,             // 0-23
  dayOfWeek: 3,              // 0-6

  // User behavior
  sessionDepthAvg: 4.5,
  rageClickRate: 0.08,       // 0-1
  abandonmentRate: 0.15,     // 0-1
  bounceRate: 0.3,           // 0-1

  // Code metrics
  filesChanged: 12,
  linesAdded: 250,
  linesDeleted: 100,
  testCoverageDelta: -0.02,  // -1 to 1

  // Historical
  recentFailures: 3,
  avgTimeBetweenFailures: 8, // hours
});
```

### Prediction

```typescript
interface Prediction {
  component: string;         // e.g., 'checkout', 'search'
  probability: number;       // 0-1
  confidence: number;        // 0-1
  trigger: string;           // What's causing the risk
  preventiveAction: string;  // Recommended action
  timeHorizon: string;       // '< 1 hour', '1-6 hours', '6-24 hours', '1-7 days'
  relatedMetrics: string[];  // Contributing metrics
  riskScore: number;         // Composite risk score
}
```

### Example

```typescript
const predictions = await engine.analyze(metrics);

for (const p of predictions) {
  console.log(`\n${p.component}: ${(p.probability * 100).toFixed(1)}% failure risk`);
  console.log(`  Trigger: ${p.trigger}`);
  console.log(`  Horizon: ${p.timeHorizon}`);
  console.log(`  Prevention: ${p.preventiveAction}`);
}

// checkout: 34.2% failure risk
//   Trigger: High traffic
//   Horizon: 1-6 hours
//   Prevention: Add rate limiting
```

---

## Utility Methods

### `getTopRisks(n)`

Get top N highest risk predictions.

```typescript
const topRisks = engine.getTopRisks(5);
```

### `getPredictionsByComponent(component)`

Filter predictions by component.

```typescript
const checkoutRisks = engine.getPredictionsByComponent('checkout');
```

### `getPredictionsByHorizon(horizon)`

Filter by time horizon.

```typescript
const urgentRisks = engine.getPredictionsByHorizon('< 1 hour');
```

---

## Training (Advanced)

### `addTrainingData(data)`

Add training data to improve the model.

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

Record whether a prediction was accurate.

```typescript
await engine.recordOutcome('pred_001', true); // Prediction was correct
```

---

## Custom Models

### Implement PredictionModel

```typescript
import { PredictionModel, PredictionInput, Prediction } from '@test-capabilities/testing-framework';

class CustomPredictor implements PredictionModel {
  name = 'custom-predictor';
  version = '1.0.0';
  features = ['errorRate', 'responseTimeP95'];

  async predict(input: PredictionInput): Promise<Prediction[]> {
    // Your ML model logic
    return predictions;
  }

  async train(data: TrainingData[]): Promise<void> {
    // Training logic
  }
}

const engine = new PredictionEngine(new CustomPredictor());
```

---

## CLI Usage

```bash
test-capabilities predict --target https://myapp.com
test-capabilities predict --target https://myapp.com --horizon 48
```

---

## Metrics Collection

### PredictionCollector

```typescript
import { PredictionCollector } from '@test-capabilities/testing-framework';

const collector = new PredictionCollector();

// Collect from APM tools, logs, etc.
const metrics = await collector.collectMetrics('auto');

// Start periodic collection
await collector.startCollection(60000); // Every minute
```
