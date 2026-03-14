import assert from "node:assert/strict";
import test from "node:test";
import {
  GradientBoostingPredictor,
  PredictionCollector,
  PredictionEngine,
} from "../src/prediction/engine.ts";

test("PredictionCollector returns deterministic placeholder metrics per source", async () => {
  const collector = new PredictionCollector();

  const first = await collector.collectMetrics("https://example.com");
  const second = await collector.collectMetrics("https://example.com");
  const third = await collector.collectMetrics("https://another.example.com");

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, third);
});

test("PredictionCollector startCollection returns a cleanup handle", async () => {
  const collector = new PredictionCollector();
  const stop = await collector.startCollection(5);

  assert.equal(typeof stop, "function");
  stop();
});

test("PredictionEngine keeps ordinary latency from saturating risk to 100%", async () => {
  const engine = new PredictionEngine();
  const predictions = await engine.analyze({
    errorRate: 0.01,
    responseTimeP95: 500,
    cpuUsage: 0.2,
    memoryUsage: 0.3,
    diskUsage: 0.1,
    timeSinceDeployment: 1,
    hourOfDay: 10,
    dayOfWeek: 1,
    sessionDepthAvg: 2,
    rageClickRate: 0.01,
    abandonmentRate: 0.02,
    bounceRate: 0.03,
    filesChanged: 1,
    linesAdded: 10,
    linesDeleted: 2,
    testCoverageDelta: 0,
    recentFailures: 0,
    avgTimeBetweenFailures: 24,
  });

  assert.equal(predictions.length > 0, true);
  assert.equal(
    predictions.every((prediction) => prediction.probability < 1),
    true,
  );
  assert.equal(
    predictions.every((prediction) => !prediction.relatedMetrics.includes("50000.0%")),
    true,
  );
});

test("PredictionEngine rejects incomplete metric payloads instead of inventing confidence", async () => {
  const engine = new PredictionEngine();

  await assert.rejects(
    async () =>
      engine.analyze({
        errorRate: 0.9,
        responseTimeP95: 3000,
      }),
    /Prediction input is incomplete or invalid/,
  );
});

test("GradientBoostingPredictor validates the full runtime input shape", async () => {
  const predictor = new GradientBoostingPredictor();

  await assert.rejects(
    async () =>
      predictor.predict({
        errorRate: 0.9,
        responseTimeP95: 3000,
      }),
    /Prediction input is incomplete or invalid/,
  );
});

test("PredictionEngine stores the same enriched predictions that analyze returns", async () => {
  const model = {
    name: "fake",
    version: "1",
    features: [],
    async predict() {
      return [
        {
          component: "checkout",
          probability: 0.8,
          confidence: 0.4,
          trigger: "x",
          preventiveAction: "y",
          timeHorizon: "24h",
          relatedMetrics: [],
          riskScore: 0.9,
        },
      ];
    },
    async train() {},
  };

  const completeMetrics = {
    errorRate: 0.01,
    responseTimeP95: 500,
    cpuUsage: 0.2,
    memoryUsage: 0.3,
    diskUsage: 0.1,
    timeSinceDeployment: 1,
    hourOfDay: 10,
    dayOfWeek: 1,
    sessionDepthAvg: 2,
    rageClickRate: 0.01,
    abandonmentRate: 0.02,
    bounceRate: 0.03,
    filesChanged: 1,
    linesAdded: 10,
    linesDeleted: 2,
    testCoverageDelta: 0,
    recentFailures: 0,
    avgTimeBetweenFailures: 24,
  };

  const engine = new PredictionEngine(model);
  for (let i = 0; i < 10; i += 1) {
    await engine.addTrainingData({
      input: completeMetrics,
      outcome: { failed: true, component: "checkout" },
    });
  }

  const returned = await engine.analyze(completeMetrics);
  const stored = engine.getPredictionsByComponent("checkout");

  assert.deepEqual(stored, returned);
});
