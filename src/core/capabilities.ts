import {
  getCliCommandStatus,
  getSurfActionStatus,
  SURF_EXPLORE_OPTION_SUPPORT,
  TEST_OPTION_SUPPORT,
} from "./operations.js";
import { renderUnsupported } from "./runtime-contract.js";

export { assertSupportedTestOptions } from "./operations.js";

export type CapabilityStatus = "implemented" | "unsupported";

export const CAPABILITY_MATRIX = {
  orchestrator: {
    agents: {
      bombadil: "implemented",
      surf: "implemented",
      "api-fuzzer": "unsupported",
      "cli-tester": "implemented",
    },
    intelligence: {
      selfHealing: "unsupported",
      prediction: "unsupported",
      correlation: "implemented",
      collective: "unsupported",
    },
    quantum: "implemented",
    chaos: "unsupported",
  },
  cli: {
    commands: {
      test: getCliCommandStatus("test") ?? "unsupported",
      surf: getCliCommandStatus("surf") ?? "unsupported",
      heal: getCliCommandStatus("heal") ?? "unsupported",
      quantum: getCliCommandStatus("quantum") ?? "unsupported",
      predict: getCliCommandStatus("predict") ?? "unsupported",
      visualize: getCliCommandStatus("visualize") ?? "unsupported",
      report: getCliCommandStatus("report") ?? "unsupported",
    },
    testOptions: TEST_OPTION_SUPPORT,
    surfExploreOptions: SURF_EXPLORE_OPTION_SUPPORT,
    surfActions: {
      explore: getSurfActionStatus("explore") ?? "unsupported",
      flow: getSurfActionStatus("flow") ?? "unsupported",
      assert: getSurfActionStatus("assert") ?? "unsupported",
      compare: getSurfActionStatus("compare") ?? "unsupported",
      replay: getSurfActionStatus("replay") ?? "unsupported",
    },
  },
} as const;

type AgentType = keyof typeof CAPABILITY_MATRIX.orchestrator.agents;
type IntelligenceKey = keyof typeof CAPABILITY_MATRIX.orchestrator.intelligence;
type CliCommand = keyof typeof CAPABILITY_MATRIX.cli.commands;
type SurfAction = keyof typeof CAPABILITY_MATRIX.cli.surfActions;

interface RuntimeAgentConfig {
  type: AgentType;
  enabled?: boolean;
}

interface RuntimeIntelligenceConfig {
  selfHealing?: boolean;
  prediction?: boolean;
  correlation?: boolean;
  collective?: boolean;
}

interface RuntimeQuantumConfig {
  enabled?: boolean;
}

interface RuntimeChaosConfig {
  enabled?: boolean;
  experiments?: unknown[];
}

interface RuntimeTargets {
  cli?: string;
  web?: string;
}

interface RuntimeConfigLike {
  agents?: Record<string, RuntimeAgentConfig>;
  intelligence?: RuntimeIntelligenceConfig;
  quantum?: RuntimeQuantumConfig;
  chaos?: RuntimeChaosConfig;
  targets?: RuntimeTargets;
}

export function validateCapabilityContract(config: RuntimeConfigLike): void {
  const enabledAgents = Object.entries(config.agents ?? {}).filter(
    ([, agent]) => agent.enabled !== false,
  );

  if (enabledAgents.length === 0) {
    throw new Error(
      "At least one enabled agent is required. The current orchestrator capability contract supports the 'bombadil', 'surf', and 'cli-tester' agents.",
    );
  }

  const unsupportedAgents = enabledAgents
    .filter(([, agent]) => CAPABILITY_MATRIX.orchestrator.agents[agent.type] !== "implemented")
    .map(([name, agent]) => `${name}:${agent.type}`);

  if (unsupportedAgents.length > 0) {
    throw renderUnsupported(
      "agent type(s)",
      unsupportedAgents,
      "Disable them or switch to the supported 'bombadil', 'surf', and/or 'cli-tester' orchestrator paths.",
    );
  }

  const unsupportedIntelligence = Object.entries(config.intelligence ?? {})
    .filter(
      ([key, enabled]) =>
        enabled === true &&
        CAPABILITY_MATRIX.orchestrator.intelligence[key as IntelligenceKey] !== "implemented",
    )
    .map(([key]) => key);

  if (unsupportedIntelligence.length > 0) {
    throw renderUnsupported(
      "intelligence capability/capabilities",
      unsupportedIntelligence,
      "Set them to false or omit them until they are wired to a real runtime implementation.",
    );
  }

  const chaosEnabled =
    config.chaos?.enabled === true || (config.chaos?.experiments?.length ?? 0) > 0;
  if (chaosEnabled) {
    throw renderUnsupported(
      "config section(s)",
      ["chaos"],
      "Remove chaos settings until a real chaos execution path exists.",
    );
  }

  const needsCli = enabledAgents.some(([, agent]) => agent.type === "cli-tester");
  if (needsCli && !config.targets?.cli) {
    throw new Error(
      "The enabled 'cli-tester' agent requires targets.cli to be configured with an executable command or path.",
    );
  }

  const webAgents = enabledAgents
    .filter(([, agent]) => agent.type === "bombadil" || agent.type === "surf")
    .map(([, agent]) => agent.type);
  if (webAgents.length > 0 && !config.targets?.web) {
    const webAgentList = [...new Set(webAgents)].map((agent) => `'${agent}'`).join(" or ");
    throw new Error(
      `The enabled ${webAgentList} agent requires targets.web to be configured with a valid URL origin.`,
    );
  }

  if (config.quantum?.enabled === true && !config.targets?.web) {
    throw new Error("Quantum simulation requires targets.web so the simulator has a URL to model.");
  }
}

export function assertSupportedCliCommand(command: CliCommand): void {
  if (CAPABILITY_MATRIX.cli.commands[command] !== "implemented") {
    throw renderUnsupported(
      "CLI command(s)",
      [command],
      "This command currently has no capability-backed implementation.",
    );
  }
}

export function assertSupportedSurfAction(action: string): asserts action is SurfAction {
  const status = CAPABILITY_MATRIX.cli.surfActions[action as SurfAction];
  if (status !== "implemented") {
    throw renderUnsupported(
      "surf action(s)",
      [action],
      "Only 'explore' is currently backed by a real surf execution path.",
    );
  }
}
