import type { TestCapabilitiesConfig } from "../orchestrator.js";

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function applyTargetOverride(
  config: TestCapabilitiesConfig,
  target?: string,
): TestCapabilitiesConfig {
  if (!target) {
    return config;
  }

  const targets = { ...(config.targets ?? {}) };
  const nextTargets = isUrl(target) ? { ...targets, web: target } : { ...targets, cli: target };

  return {
    ...config,
    targets: nextTargets,
  };
}

function hasWebTargetConsumer(config: TestCapabilitiesConfig): boolean {
  const hasSupportedWebAgent = Object.values(config.agents ?? {}).some(
    (agent) => agent.enabled !== false && (agent.type === "bombadil" || agent.type === "surf"),
  );

  return config.quantum?.enabled === true || hasSupportedWebAgent;
}

export function assertMeaningfulTestTargetOverride(
  target: string | undefined,
  config: TestCapabilitiesConfig,
): void {
  if (typeof target !== "string") {
    return;
  }

  if (!isUrl(target)) {
    return;
  }

  if (!hasWebTargetConsumer(config)) {
    throw new Error(
      "URL targets for 'test' require a real web-consuming runtime path. Enable quantum, enable the supported 'bombadil' or 'surf' agent, or pass a CLI command/path target instead.",
    );
  }
}
