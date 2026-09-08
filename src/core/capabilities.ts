import { ORCHESTRATOR_CAPABILITY_MATRIX } from "./capability-matrix.js";
import {
  getCliCommandStatus,
  getSurfActionStatus,
  SURF_EXPLORE_OPTION_SUPPORT,
  TEST_OPTION_SUPPORT,
} from "./operations.js";
import { renderUnsupported } from "./runtime-contract.js";

export type { CapabilityStatus } from "./capability-matrix.js";
export { ORCHESTRATOR_CAPABILITY_MATRIX, validateCapabilityContract } from "./capability-matrix.js";
export { assertSupportedTestOptions } from "./operations.js";

export const CAPABILITY_MATRIX = {
  orchestrator: ORCHESTRATOR_CAPABILITY_MATRIX,
  cli: {
    commands: {
      test: getCliCommandStatus("test") ?? "unsupported",
      doctor: getCliCommandStatus("doctor") ?? "unsupported",
      demo: getCliCommandStatus("demo") ?? "unsupported",
      init: getCliCommandStatus("init") ?? "unsupported",
      surf: getCliCommandStatus("surf") ?? "unsupported",
      heal: getCliCommandStatus("heal") ?? "unsupported",
      quantum: getCliCommandStatus("quantum") ?? "unsupported",
      "replacement-validation": getCliCommandStatus("replacement-validation") ?? "unsupported",
      predict: getCliCommandStatus("predict") ?? "unsupported",
      visualize: getCliCommandStatus("visualize") ?? "unsupported",
      report: getCliCommandStatus("report") ?? "unsupported",
    },
    testOptions: TEST_OPTION_SUPPORT,
    surfExploreOptions: SURF_EXPLORE_OPTION_SUPPORT,
    surfActions: {
      explore: getSurfActionStatus("explore") ?? "unsupported",
      plan: getSurfActionStatus("plan") ?? "unsupported",
      apply: getSurfActionStatus("apply") ?? "unsupported",
      flow: getSurfActionStatus("flow") ?? "unsupported",
      assert: getSurfActionStatus("assert") ?? "unsupported",
      compare: getSurfActionStatus("compare") ?? "unsupported",
      replay: getSurfActionStatus("replay") ?? "unsupported",
    },
  },
} as const;

type CliCommand = keyof typeof CAPABILITY_MATRIX.cli.commands;
type SurfAction = keyof typeof CAPABILITY_MATRIX.cli.surfActions;

export function assertSupportedCliCommand(command: CliCommand): void {
  if (CAPABILITY_MATRIX.cli.commands[command] !== "implemented") {
    throw renderUnsupported(
      "CLI command(s)",
      [command],
      "This command currently has no capability-backed implementation.",
      "unsupported_command",
    );
  }
}

export function assertSupportedSurfAction(action: string): asserts action is SurfAction {
  const status = CAPABILITY_MATRIX.cli.surfActions[action as SurfAction];
  if (status !== "implemented") {
    throw renderUnsupported(
      "surf action(s)",
      [action],
      "Implemented surf actions are 'explore', 'plan' and 'apply'.",
      "unsupported_surf_action",
    );
  }
}
