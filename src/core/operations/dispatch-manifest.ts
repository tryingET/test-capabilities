import { DEMO_OPERATION, executeDemoOperation } from "./demo-operation.js";
import { DOCTOR_OPERATION, executeDoctorOperation } from "./doctor-operation.js";
import { executeHealOperation, HEAL_OPERATION } from "./heal-operation.js";
import { executeQuantumOperation, QUANTUM_OPERATION } from "./quantum-operation.js";
import { executeSurfExploreOperation, SURF_EXPLORE_OPERATION } from "./surf-explore-operation.js";
import { executeTestOperation, TEST_OPERATION } from "./test-operation.js";
import type {
  CliCommand,
  CliOperationInputUnion,
  CliOperationResult,
  CliRoute,
  CliRouteManifestEntry,
  OperationDefinition,
  OperationStatus,
  SurfAction,
} from "./types.js";

export const CLI_OPERATION_REGISTRY = {
  test: TEST_OPERATION,
  doctor: DOCTOR_OPERATION,
  demo: DEMO_OPERATION,
  "surf.explore": SURF_EXPLORE_OPERATION,
  quantum: QUANTUM_OPERATION,
  heal: HEAL_OPERATION,
} as const;

export const CLI_ROUTE_MANIFEST = [
  {
    command: "test",
    status: "implemented",
    operationId: "test",
    description: TEST_OPERATION.description,
  },
  {
    command: "doctor",
    status: "implemented",
    operationId: "doctor",
    description: DOCTOR_OPERATION.description,
  },
  {
    command: "demo",
    status: "implemented",
    operationId: "demo",
    description: DEMO_OPERATION.description,
  },
  {
    command: "surf",
    status: "implemented",
    description: "Command group for surf-backed browser operations",
  },
  {
    command: "surf",
    action: "explore",
    status: "implemented",
    operationId: "surf.explore",
    description: SURF_EXPLORE_OPERATION.description,
  },
  {
    command: "surf",
    action: "flow",
    status: "unsupported",
    description: "Registered surf action that currently fails clearly",
  },
  {
    command: "surf",
    action: "assert",
    status: "unsupported",
    description: "Registered surf action that currently fails clearly",
  },
  {
    command: "surf",
    action: "compare",
    status: "unsupported",
    description: "Registered surf action that currently fails clearly",
  },
  {
    command: "surf",
    action: "replay",
    status: "unsupported",
    description: "Registered surf action that currently fails clearly",
  },
  {
    command: "quantum",
    status: "implemented",
    operationId: "quantum",
    description: QUANTUM_OPERATION.description,
  },
  {
    command: "heal",
    status: "implemented",
    operationId: "heal",
    description: HEAL_OPERATION.description,
  },
  {
    command: "predict",
    status: "unsupported",
    description: "Registered command that currently fails clearly",
  },
  {
    command: "visualize",
    status: "unsupported",
    description: "Registered command that currently fails clearly",
  },
  {
    command: "report",
    status: "unsupported",
    description: "Registered command that currently fails clearly",
  },
] as const satisfies readonly CliRouteManifestEntry[];

export function resolveCliRoute(route: CliRoute): CliRouteManifestEntry | undefined {
  const routeAction = "action" in route ? route.action : undefined;

  for (const entry of CLI_ROUTE_MANIFEST) {
    const entryAction = "action" in entry ? entry.action : undefined;
    if (entry.command === route.command && entryAction === routeAction) {
      return entry;
    }
  }

  return undefined;
}

export function getCliCommandStatus(command: CliCommand): OperationStatus | undefined {
  for (const entry of CLI_ROUTE_MANIFEST) {
    if (entry.command === command && !("action" in entry)) {
      return entry.status;
    }
  }

  return undefined;
}

export function getSurfActionStatus(action: SurfAction): OperationStatus | undefined {
  for (const entry of CLI_ROUTE_MANIFEST) {
    if (entry.command === "surf" && "action" in entry && entry.action === action) {
      return entry.status;
    }
  }

  return undefined;
}

export type RegisteredOperation = OperationDefinition<CliOperationInputUnion, CliOperationResult>;

export {
  executeDemoOperation,
  executeDoctorOperation,
  executeHealOperation,
  executeQuantumOperation,
  executeSurfExploreOperation,
  executeTestOperation,
};
