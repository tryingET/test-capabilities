import type { RunContext } from "../run-context.js";
import { finalizeEnvelope, mintOperationContext } from "../run-context.js";
import { FrameworkError, renderUnsupported } from "../runtime-contract.js";
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
      "unsupported_surf_action",
    );
  }

  if (getSurfActionStatus(routeRecord.action as SurfAction) === undefined) {
    throw renderUnsupported(
      "surf action(s)",
      [routeRecord.action],
      "Only 'explore' is currently backed by a real surf execution path.",
      "unsupported_surf_action",
    );
  }
}

export function throwUnsupportedCommand(routeRecord: RouteRecord, route: CliRoute): never {
  if (typeof routeRecord.command === "string") {
    throw renderUnsupported(
      "CLI command(s)",
      [routeRecord.command],
      "This command currently has no capability-backed implementation.",
      "unsupported_command",
    );
  }

  throw new FrameworkError(
    "invalid_route_payload",
    `Invalid CLI route payload: ${JSON.stringify(route)}`,
    { route },
  );
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
      "unsupported_surf_action",
    );
  }

  throw renderUnsupported(
    "CLI command(s)",
    [manifestEntry.command],
    "This command currently has no capability-backed implementation.",
    "unsupported_command",
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

/** Options an entry point may pass into the run it is minting (`--supersede-receipt`). */
export interface ExecuteCliOperationOptions {
  supersedeReceiptId?: string;
}

/**
 * The one entry point that runs an operation, and the place the run is minted.
 *
 * The order matters: the input is parsed, the effect class is resolved from the parsed input
 * (an operation that resolves to neither class refuses with `effect_unclassified` before
 * anything runs), the run is minted with that class, and only then does `execute` see it. The
 * envelope leaves with the run id, the class and the run's receipts on it (mutation-safety
 * packet, "Declaration points" and "Envelope changes"; architecture review A5).
 */
export async function executeCliOperation(
  route: CliRoute,
  rawInput: CliOperationInputUnion,
  options: ExecuteCliOperationOptions = {},
): Promise<CliOperationResult> {
  const manifestEntry = requireManifestEntry(route);
  const operation = requireRegisteredOperation(manifestEntry);
  const normalizedInput = operation.inputSchema.parse(rawInput);
  const context: RunContext = mintOperationContext(
    operation.id,
    operation.effect,
    normalizedInput as object,
    options.supersedeReceiptId ? { supersedeReceiptId: options.supersedeReceiptId } : {},
  );
  return finalizeEnvelope(await operation.execute(normalizedInput, context), context);
}
