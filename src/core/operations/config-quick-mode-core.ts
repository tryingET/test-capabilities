import type { TestCapabilitiesConfig } from "../orchestrator.js";

function withIntelligenceOverrides(
  config: TestCapabilitiesConfig,
  overrides: Partial<NonNullable<TestCapabilitiesConfig["intelligence"]>>,
): TestCapabilitiesConfig {
  const current = config.intelligence ?? {
    selfHealing: false,
    prediction: false,
    correlation: true,
    collective: false,
  };

  const nextIntelligence = {
    selfHealing: current.selfHealing,
    prediction: current.prediction,
    correlation: current.correlation,
    collective: current.collective,
    ...overrides,
  };

  return {
    ...config,
    intelligence: nextIntelligence,
  };
}

function withQuantumOverrides(
  config: TestCapabilitiesConfig,
  overrides: Partial<NonNullable<TestCapabilitiesConfig["quantum"]>>,
): TestCapabilitiesConfig {
  const current = config.quantum ?? {
    enabled: false,
    branches: 100,
    collapseStrategy: "significance",
    maxDepth: 20,
  };

  const nextQuantum = {
    enabled: current.enabled,
    branches: current.branches,
    collapseStrategy: current.collapseStrategy,
    maxDepth: current.maxDepth,
    timeout: current.timeout,
    ...overrides,
  };

  return {
    ...config,
    quantum: nextQuantum,
  };
}

export function applyQuickMode(config: TestCapabilitiesConfig): TestCapabilitiesConfig {
  const withPredictionDisabled = withIntelligenceOverrides(config, { prediction: false });
  const withQuantumDisabled = withQuantumOverrides(withPredictionDisabled, { enabled: false });
  return withQuantumDisabled;
}
