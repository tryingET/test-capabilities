import { renderUnsupported } from "../runtime-contract.js";
import {
  CLI_OPERATION_REGISTRY,
  getSurfActionStatus,
  type RegisteredOperation,
  resolveCliRoute,
} from "./dispatch-manifest.js";
import type {
  CliOperationInputUnion,
  CliOperationResult,
  CliRoute,
  CliRouteManifestEntry,
  OperationId,
  SurfAction,
} from "./types.js";

export type RouteRecord = Partial<Record<"command" | "action", unknown>>;

export function assertKnownSurfExecutionRoute(routeRecord: RouteRecord): void {
  if (routeRecord.command !== "surf") {
    return;
  }

  if (typeof routeRecord.action !== "string" || routeRecord.action.length === 0) {
    throw renderUnsupported(
      "surf action(s)",
      ["(missing action)"],
      "Specify the implemented 'explore' action.",
    );
  }

  if (getSurfActionStatus(routeRecord.action as SurfAction) === undefined) {
    throw renderUnsupported(
      "surf action(s)",
      [routeRecord.action],
      "Only 'explore' is currently backed by a real surf execution path.",
    );
  }
}

export function throwUnsupportedCommand(routeRecord: RouteRecord, route: CliRoute): never {
  if (typeof routeRecord.command === "string") {
    throw renderUnsupported(
      "CLI command(s)",
      [routeRecord.command],
      "This command currently has no capability-backed implementation.",
    );
  }

  throw new Error(`Invalid CLI route payload: ${JSON.stringify(route)}`);
}

export function requireManifestEntry(route: CliRoute): CliRouteManifestEntry {
  const routeRecord = route as RouteRecord;
  assertKnownSurfExecutionRoute(routeRecord);

  const manifestEntry = resolveCliRoute(route);
  if (manifestEntry) {
    return manifestEntry;
  }

  throwUnsupportedCommand(routeRecord, route);
}

export function throwUnavailableManifestEntry(manifestEntry: CliRouteManifestEntry): never {
  if (manifestEntry.command === "surf" && manifestEntry.action) {
    throw renderUnsupported(
      "surf action(s)",
      [manifestEntry.action],
      "Only 'explore' is currently backed by a real surf execution path.",
    );
  }

  throw renderUnsupported(
    "CLI command(s)",
    [manifestEntry.command],
    "This command currently has no capability-backed implementation.",
  );
}

export function requireRegisteredOperation(
  manifestEntry: CliRouteManifestEntry,
): RegisteredOperation {
  const unavailable = manifestEntry.status !== "implemented" || !manifestEntry.operationId;
  if (unavailable) {
    throwUnavailableManifestEntry(manifestEntry);
  }

  const operationId = manifestEntry.operationId as OperationId;
  const operation = CLI_OPERATION_REGISTRY[operationId] as RegisteredOperation;
  return operation;
}

export function executeCliOperation(
  route: CliRoute,
  rawInput: CliOperationInputUnion,
): Promise<CliOperationResult> {
  const manifestEntry = requireManifestEntry(route);
  const operation = requireRegisteredOperation(manifestEntry);
  const normalizedInput = operation.inputSchema.parse(rawInput);
  return operation.execute(normalizedInput);
}
