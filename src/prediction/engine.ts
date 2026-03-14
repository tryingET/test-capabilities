/**
 * TEST-CAPABILITIES Prediction Engine
 * ML-powered failure prediction
 */

// ============================================
// TYPES
// ============================================

export interface PredictionInput {
  // System metrics
  errorRate: number;
  responseTimeP95: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;

  // Temporal features
  timeSinceDeployment: number;
  hourOfDay: number;
  dayOfWeek: number;

  // User behavior
  sessionDepthAvg: number;
  rageClickRate: number;
  abandonmentRate: number;
  bounceRate: number;

  // Code metrics
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  testCoverageDelta: number;

  // Historical
  recentFailures: number;
  avgTimeBetweenFailures: number;
}

export interface Prediction {
  component: string;
  probability: number;
  confidence: number;
  trigger: string;
  preventiveAction: string;
  timeHorizon: string;
  relatedMetrics: string[];
  riskScore: number;
}

export interface PredictionModel {
  name: string;
  version: string;
  features: string[];
  predict(input: PredictionInput): Promise<Prediction[]>;
  train(data: TrainingData[]): Promise<void>;
}

export interface TrainingData {
  input: PredictionInput;
  outcome: {
    failed: boolean;
    component?: string;
    failureType?: string;
  };
}

const PREDICTION_INPUT_FIELDS = [
  "errorRate",
  "responseTimeP95",
  "cpuUsage",
  "memoryUsage",
  "diskUsage",
  "timeSinceDeployment",
  "hourOfDay",
  "dayOfWeek",
  "sessionDepthAvg",
  "rageClickRate",
  "abandonmentRate",
  "bounceRate",
  "filesChanged",
  "linesAdded",
  "linesDeleted",
  "testCoverageDelta",
  "recentFailures",
  "avgTimeBetweenFailures",
] as const satisfies readonly (keyof PredictionInput)[];

function validatePredictionInput(input: PredictionInput): void {
  const invalidFields = PREDICTION_INPUT_FIELDS.filter((field) => {
    const value = input[field];
    return typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value);
  });

  if (invalidFields.length > 0) {
    throw new Error(
      `Prediction input is incomplete or invalid. Provide finite numeric values for: ${invalidFields.join(", ")}.`,
    );
  }
}

// ============================================
// GRADIENT BOOSTING PREDICTOR (Simplified)
// ============================================

export class GradientBoostingPredictor implements PredictionModel {
  name = "gradient-boost";
  version = "1.0.0";
  features = [
    "errorRate",
    "responseTimeP95",
    "memoryUsage",
    "timeSinceDeployment",
    "rageClickRate",
    "abandonmentRate",
    "recentFailures",
  ];

  // Simplified model weights (would be trained)
  private weights = {
    checkout: { errorRate: 0.3, responseTimeP95: 0.2, abandonmentRate: 0.4 },
    search: { errorRate: 0.25, responseTimeP95: 0.35, rageClickRate: 0.3 },
    auth: { errorRate: 0.35, memoryUsage: 0.2, recentFailures: 0.25 },
    api: { responseTimeP95: 0.4, errorRate: 0.3, memoryUsage: 0.15 },
  };

  async predict(input: PredictionInput): Promise<Prediction[]> {
    validatePredictionInput(input);
    const predictions: Prediction[] = [];

    for (const [component, weights] of Object.entries(this.weights)) {
      const score = this.calculateScore(input, weights);
      const riskScore = this.calculateRiskScore(input, component);

      if (score > 0.1) {
        predictions.push({
          component,
          probability: score,
          confidence: this.calculateConfidence(input, component),
          trigger: this.identifyTrigger(input, weights),
          preventiveAction: this.suggestPrevention(component, input),
          timeHorizon: this.estimateTimeHorizon(score),
          relatedMetrics: this.getRelatedMetrics(input, weights),
          riskScore,
        });
      }
    }

    return predictions.sort((a, b) => b.probability - a.probability);
  }

  async train(_data: TrainingData[]): Promise<void> {
    // The shipped predictor is a fixed-weight placeholder model. Training is a deliberate no-op
    // until a real persisted model update path exists.
  }

  private getMetricValue(input: PredictionInput, feature: string): number {
    const value = input[feature as keyof PredictionInput];
    return typeof value === "number" ? value : 0;
  }

  private normalizeFeature(feature: string, value: number): number {
    switch (feature) {
      case "errorRate":
      case "abandonmentRate":
      case "rageClickRate":
      case "bounceRate":
      case "cpuUsage":
      case "memoryUsage":
      case "diskUsage":
        return Math.max(0, Math.min(1, value));
      case "responseTimeP95":
        return Math.max(0, Math.min(1, (value - 200) / 1800));
      case "recentFailures":
        return Math.max(0, Math.min(1, value / 10));
      default:
        return Math.max(0, Math.min(1, value));
    }
  }

  private calculateScore(input: PredictionInput, weights: Record<string, number>): number {
    let score = 0;
    let totalWeight = 0;

    for (const [feature, weight] of Object.entries(weights)) {
      const value = this.normalizeFeature(feature, this.getMetricValue(input, feature));
      score += value * weight;
      totalWeight += weight;
    }

    return totalWeight === 0 ? 0 : Math.min(1, score / totalWeight);
  }

  private calculateRiskScore(input: PredictionInput, _component: string): number {
    // Composite risk score considering multiple factors
    const systemRisk = (input.cpuUsage + input.memoryUsage + input.diskUsage) / 3;
    const userRisk = (input.rageClickRate + input.abandonmentRate + input.bounceRate) / 3;
    const historyRisk = Math.min(1, input.recentFailures / 10);

    return systemRisk * 0.3 + userRisk * 0.4 + historyRisk * 0.3;
  }

  private calculateConfidence(input: PredictionInput, _component: string): number {
    // Confidence is grounded in the fixed runtime schema rather than whatever keys the caller happened to provide.
    const completeness =
      PREDICTION_INPUT_FIELDS.filter((field) => Number.isFinite(input[field])).length /
      PREDICTION_INPUT_FIELDS.length;
    return 0.35 + completeness * 0.55;
  }

  private identifyTrigger(input: PredictionInput, weights: Record<string, number>): string {
    const sortedFeatures = Object.entries(weights).sort((a, b) => b[1] - a[1]);

    const topFeature = sortedFeatures[0]?.[0] ?? "errorRate";
    const value = this.getMetricValue(input, topFeature);

    return this.featureToTrigger(topFeature, value);
  }

  private featureToTrigger(feature: string, value: number): string {
    const triggers: Record<string, (v: number) => string> = {
      errorRate: (v) => (v > 0.05 ? "High error rate detected" : "Elevated error rate"),
      responseTimeP95: (v) => (v > 2000 ? "Severe latency spike" : "Response time degradation"),
      memoryUsage: (v) => (v > 0.9 ? "Critical memory pressure" : "Memory usage elevated"),
      abandonmentRate: (v) => (v > 0.3 ? "High user abandonment" : "Rising abandonment rate"),
      rageClickRate: (v) => (v > 0.1 ? "User frustration detected" : "Click frustration rising"),
      recentFailures: (v) => (v > 5 ? "Recent failure cluster" : "Elevated failure frequency"),
    };

    return triggers[feature]?.(value) || `Elevated ${feature}`;
  }

  private suggestPrevention(component: string, input: PredictionInput): string {
    const preventions: Record<string, Record<string, string>> = {
      checkout: {
        high_latency: "Add circuit breaker for payment service",
        high_errors: "Implement retry with exponential backoff",
        high_abandonment: "Simplify checkout flow, add progress indicators",
      },
      search: {
        high_latency: "Add query timeout and result caching",
        high_errors: "Implement search fallback to cached results",
        high_rage: "Add search suggestions and auto-complete",
      },
      auth: {
        high_errors: "Review auth token refresh logic",
        high_memory: "Check for memory leaks in session management",
        high_failures: "Review recent auth changes for regressions",
      },
      api: {
        high_latency: "Scale horizontally or add caching layer",
        high_errors: "Review API rate limits and error handling",
        high_memory: "Review request/response payload sizes",
      },
    };

    const componentPreventions = preventions[component] || {};
    const topIssue =
      input.responseTimeP95 > 1000
        ? "high_latency"
        : input.errorRate > 0.05
          ? "high_errors"
          : input.rageClickRate > 0.1
            ? "high_rage"
            : "high_abandonment";

    return componentPreventions[topIssue] || "Monitor closely and review logs";
  }

  private estimateTimeHorizon(probability: number): string {
    if (probability > 0.7) return "< 1 hour";
    if (probability > 0.5) return "1-6 hours";
    if (probability > 0.3) return "6-24 hours";
    return "1-7 days";
  }

  private formatMetric(feature: string, value: number): string {
    switch (feature) {
      case "responseTimeP95":
        return `${Math.round(value)}ms`;
      case "recentFailures":
      case "filesChanged":
      case "linesAdded":
      case "linesDeleted":
        return String(Math.round(value));
      case "timeSinceDeployment":
      case "avgTimeBetweenFailures":
        return `${value.toFixed(1)}h`;
      default:
        return `${(value * 100).toFixed(1)}%`;
    }
  }

  private getRelatedMetrics(input: PredictionInput, weights: Record<string, number>): string[] {
    return Object.entries(weights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([feature]) => {
        const value = this.getMetricValue(input, feature);
        return `${feature}: ${this.formatMetric(feature, value)}`;
      });
  }
}

// ============================================
// PREDICTION ENGINE
// ============================================

export class PredictionEngine {
  private model: PredictionModel;
  private historicalData: TrainingData[] = [];
  private recentPredictions: Prediction[] = [];

  constructor(model?: PredictionModel) {
    this.model = model || new GradientBoostingPredictor();
  }

  async analyze(currentMetrics: PredictionInput): Promise<Prediction[]> {
    validatePredictionInput(currentMetrics);

    // Get predictions from model
    const predictions = await this.model.predict(currentMetrics);
    const enrichedPredictions = predictions.map((prediction) => this.enrichWithHistory(prediction));

    // Store the same enriched predictions that callers receive.
    this.recentPredictions = enrichedPredictions;

    return enrichedPredictions;
  }

  async addTrainingData(data: TrainingData): Promise<void> {
    this.historicalData.push(data);

    // Retrain periodically
    if (this.historicalData.length % 100 === 0) {
      await this.model.train(this.historicalData);
    }
  }

  async recordOutcome(_predictionId: string, _failed: boolean): Promise<void> {
    // Track prediction accuracy for model improvement
    // In production, this would update the model's performance metrics
  }

  private enrichWithHistory(prediction: Prediction): Prediction {
    // Add historical context to predictions
    const similarFailures = this.historicalData.filter(
      (d) => d.outcome.failed && d.outcome.component === prediction.component,
    ).length;

    return {
      ...prediction,
      confidence: Math.min(0.95, prediction.confidence + similarFailures * 0.01),
    };
  }

  getTopRisks(n: number = 5): Prediction[] {
    return [...this.recentPredictions].sort((a, b) => b.riskScore - a.riskScore).slice(0, n);
  }

  getPredictionsByComponent(component: string): Prediction[] {
    return this.recentPredictions.filter((p) => p.component === component);
  }

  getPredictionsByHorizon(horizon: string): Prediction[] {
    return this.recentPredictions.filter((p) => p.timeHorizon === horizon);
  }
}

// ============================================
// PREDICTION COLLECTOR
// ============================================

export class PredictionCollector {
  private seededRandomFromString(seedText: string): () => number {
    let seed = 0;

    for (const char of seedText) {
      seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    }

    if (seed === 0) {
      seed = 1;
    }

    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
  }

  async collectMetrics(source: string): Promise<PredictionInput> {
    // Collect metrics from various sources.
    // Until a real collector is wired in, keep placeholder values deterministic.
    const random = this.seededRandomFromString(source || "auto");
    const hourOfDay = Math.floor(random() * 24);
    const dayOfWeek = Math.floor(random() * 7);

    return {
      // System metrics (deterministic placeholder values)
      errorRate: random() * 0.1,
      responseTimeP95: 500 + random() * 2000,
      cpuUsage: random(),
      memoryUsage: random() * 0.8,
      diskUsage: random() * 0.7,

      // Temporal
      timeSinceDeployment: random() * 72,
      hourOfDay,
      dayOfWeek,

      // User behavior (deterministic placeholder values)
      sessionDepthAvg: 3 + random() * 5,
      rageClickRate: random() * 0.2,
      abandonmentRate: random() * 0.4,
      bounceRate: random() * 0.5,

      // Code metrics
      filesChanged: Math.floor(random() * 50),
      linesAdded: Math.floor(random() * 500),
      linesDeleted: Math.floor(random() * 300),
      testCoverageDelta: random() * 0.1 - 0.05,

      // Historical
      recentFailures: Math.floor(random() * 10),
      avgTimeBetweenFailures: random() * 24,
    };
  }

  async startCollection(interval: number = 60000): Promise<() => void> {
    // Start periodic metric collection
    const handle = setInterval(async () => {
      await this.collectMetrics("auto");
      // Store or process metrics
    }, interval);

    return () => {
      clearInterval(handle);
    };
  }
}

// ============================================
// EXPORTS
// ============================================

export default PredictionEngine;
