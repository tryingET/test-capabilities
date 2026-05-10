import { renderUnsupported } from "../runtime-contract.js";
import type { OperationStatus } from "./types.js";

const unsupportedTestOptionGuidance =
  "Use only --config, --target, and --quick until the remaining paths are implemented.";
const unsupportedSurfExploreOptionGuidance =
  "Use only --url and --depth until the remaining surf explore flags are wired to real runtime behavior.";

export const TEST_OPTION_SUPPORT = {
  target: "implemented",
  config: "implemented",
  quick: "implemented",
  autonomous: "unsupported",
  selfHeal: "unsupported",
  predict: "unsupported",
  failThreshold: "unsupported",
  uploadArtifacts: "unsupported",
  report: "unsupported",
} as const satisfies Record<string, OperationStatus>;

export const SURF_EXPLORE_OPTION_SUPPORT = {
  url: "implemented",
  depth: "implemented",
  record: "unsupported",
  validate: "unsupported",
  baseline: "unsupported",
  aiDiff: "unsupported",
  file: "unsupported",
} as const satisfies Record<string, OperationStatus>;

function isProvidedOption(value: unknown): boolean {
  return value !== undefined && value !== false;
}

function collectUnsupportedOptions<TSupport extends Record<string, OperationStatus>>(
  support: TSupport,
  options: Partial<Record<keyof TSupport, unknown>>,
): string[] {
  return Object.entries(support)
    .filter(
      ([key, status]) =>
        status !== "implemented" && isProvidedOption(options[key as keyof typeof options]),
    )
    .map(([key]) => `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`);
}

export function assertSupportedTestOptions(
  options: Partial<Record<keyof typeof TEST_OPTION_SUPPORT, unknown>>,
): void {
  const unsupported = collectUnsupportedOptions(TEST_OPTION_SUPPORT, options);

  if (unsupported.length > 0) {
    throw renderUnsupported("option(s) for 'test'", unsupported, unsupportedTestOptionGuidance);
  }
}

export function assertSupportedSurfExploreOptions(
  options: Partial<Record<keyof typeof SURF_EXPLORE_OPTION_SUPPORT, unknown>>,
): void {
  const unsupported = collectUnsupportedOptions(SURF_EXPLORE_OPTION_SUPPORT, options);

  if (unsupported.length > 0) {
    throw renderUnsupported(
      "option(s) for 'surf explore'",
      unsupported,
      unsupportedSurfExploreOptionGuidance,
    );
  }
}
