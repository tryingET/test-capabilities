/**
 * Leaf capability matrix (implementation plan S1, review A18, adjudication 40).
 *
 * This module imports nothing under operations/: the orchestrator reads its
 * agent, intelligence, quantum and chaos support states from here, which breaks
 * the capabilities -> operations -> dispatch -> demo -> orchestrator ->
 * capabilities cycle that made a deep import of dispatch.js throw a TDZ
 * ReferenceError on CLI_ROUTE_MANIFEST. The CLI half of the matrix (command
 * and surf-action statuses derived from the route manifest) is composed in
 * ./capabilities.ts, which may import operations/.
 */

import type { RuntimeConfigLike } from "./config.js";
import { renderUnsupported } from "./runtime-contract.js";

export type CapabilityStatus = "implemented" | "unsupported";

export const ORCHESTRATOR_CAPABILITY_MATRIX = {
  agents: {
    bombadil: "implemented",
    surf: "implemented",
    "api-fuzzer": "unsupported",
    "cli-tester": "implemented",
    "terminal-fuzzer": "implemented",
  },
  intelligence: {
    selfHealing: "unsupported",
    prediction: "unsupported",
    correlation: "implemented",
    collective: "unsupported",
  },
  quantum: "implemented",
  chaos: "unsupported",
} as const;

type IntelligenceKey = keyof typeof ORCHESTRATOR_CAPABILITY_MATRIX.intelligence;

export function validateCapabilityContract(config: RuntimeConfigLike): void {
  const enabledAgents = Object.entries(config.agents ?? {}).filter(
    ([, agent]) => agent.enabled !== false,
  );

  if (enabledAgents.length === 0) {
    throw new Error(
      "At least one enabled agent is required. The current orchestrator capability contract supports the 'bombadil', 'surf', 'cli-tester', and 'terminal-fuzzer' agents.",
    );
  }

  const unsupportedAgents = enabledAgents
    .filter(([, agent]) => ORCHESTRATOR_CAPABILITY_MATRIX.agents[agent.type] !== "implemented")
    .map(([name, agent]) => `${name}:${agent.type}`);

  if (unsupportedAgents.length > 0) {
    throw renderUnsupported(
      "agent type(s)",
      unsupportedAgents,
      "Disable them or switch to the supported 'bombadil', 'surf', 'cli-tester', and/or 'terminal-fuzzer' orchestrator paths.",
    );
  }

  const unsupportedIntelligence = Object.entries(config.intelligence ?? {})
    .filter(
      ([key, enabled]) =>
        enabled === true &&
        ORCHESTRATOR_CAPABILITY_MATRIX.intelligence[key as IntelligenceKey] !== "implemented",
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

  const needsCli = enabledAgents.some(
    ([, agent]) =>
      agent.type === "cli-tester" || (agent.type === "terminal-fuzzer" && !agent.terminal?.command),
  );
  if (needsCli && !config.targets?.cli) {
    throw new Error(
      "The enabled 'cli-tester' or 'terminal-fuzzer' agent requires targets.cli to be configured with an executable command or path unless terminal.command is configured.",
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
