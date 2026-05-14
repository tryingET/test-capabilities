export {
  assertKnownSurfExecutionRoute,
  executeCliOperation,
  type RouteRecord,
  requireManifestEntry,
  requireRegisteredOperation,
  throwUnavailableManifestEntry,
  throwUnsupportedCommand,
} from "./dispatch-execution.js";
export {
  CLI_OPERATION_REGISTRY,
  CLI_ROUTE_MANIFEST,
  executeDemoOperation,
  executeDoctorOperation,
  executeHealOperation,
  executeQuantumOperation,
  executeSurfExploreOperation,
  executeTestOperation,
  getCliCommandStatus,
  getSurfActionStatus,
  type RegisteredOperation,
  resolveCliRoute,
} from "./dispatch-manifest.js";
