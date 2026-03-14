import assert from "node:assert/strict";
import test from "node:test";
import { PredictionCollector, PredictionEngine } from "../src/prediction/engine.ts";

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
