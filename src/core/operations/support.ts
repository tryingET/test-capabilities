import { renderUnsupported } from "../runtime-contract.js";
import type { OperationStatus } from "./types.js";

const unsupportedTestOptionGuidance =
  "Use only --config, --target, and --quick until the remaining paths are implemented.";
const unsupportedSurfExploreOptionGuidance =
  "Use only --url and --depth until the remaining surf explore flags are wired to real runtime behavior.";

/**
 * The three surf actions share one commander command, so an option that belongs to another
 * action has to be refused rather than silently stripped: `--submit` handed to a plan, or
 * `--depth` handed to an apply, is a caller that believes something the run will not do
 * (submit-gate packet §5, "fail closed everywhere").
 */
const SURF_EXPLORE_ONLY_OPTIONS = [
  "depth",
  "readySelector",
  "frameHint",
  "a11ySnapshot",
  "record",
  "validate",
  "baseline",
  "aiDiff",
  "file",
];
const SURF_PLAN_ONLY_OPTIONS = ["field", "submitText", "submitSelector", "out"];
/** `surf apply` takes its target from the plan, so naming a URL on the command line is a lie. */
const SURF_TARGET_URL_OPTION = ["url"];
const SURF_APPLY_ONLY_OPTIONS = [
  "plan",
  "submit",
  "confirmPlan",
  "untilUrlPrefix",
  "untilText",
  "receiptOut",
  "supersedeReceipt",
];

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
  json: "implemented",
  readySelector: "implemented",
  frameHint: "implemented",
  a11ySnapshot: "implemented",
  record: "unsupported",
  validate: "unsupported",
  baseline: "unsupported",
  aiDiff: "unsupported",
  file: "unsupported",
} as const satisfies Record<string, OperationStatus>;

function isProvidedOption(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== undefined && value !== false;
}

function refuseForeignOptions(
  action: string,
  options: Record<string, unknown>,
  foreign: readonly string[],
  guidance: string,
): void {
  const provided = foreign
    .filter((key) => isProvidedOption(options[key]))
    .map((key) => `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`);
  if (provided.length > 0) {
    throw renderUnsupported(
      `option(s) for 'surf ${action}'`,
      provided,
      guidance,
      "unsupported_option",
    );
  }
}

/** `surf plan` takes the plan options and `--config`; nothing from explore or apply. */
export function assertSupportedSurfPlanOptions(options: Record<string, unknown>): void {
  refuseForeignOptions(
    "plan",
    options,
    [...SURF_EXPLORE_ONLY_OPTIONS, ...SURF_APPLY_ONLY_OPTIONS],
    "Use --url, --field, --submit-text or --submit-selector, --out, --config and --json; a plan reads a form and writes an artifact, it never carries one out.",
  );
}

/** `surf apply` takes the apply options and `--config`; nothing from explore or plan. */
export function assertSupportedSurfApplyOptions(options: Record<string, unknown>): void {
  refuseForeignOptions(
    "apply",
    options,
    [...SURF_EXPLORE_ONLY_OPTIONS, ...SURF_PLAN_ONLY_OPTIONS, ...SURF_TARGET_URL_OPTION],
    "Use --plan, --submit with --confirm-plan, --until-url-prefix or --until-text, --receipt-out, --config and --json; what is filled, and where, is decided by the plan, not by the command line.",
  );
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
    throw renderUnsupported(
      "option(s) for 'test'",
      unsupported,
      unsupportedTestOptionGuidance,
      "unsupported_option",
    );
  }
}

export function assertSupportedSurfExploreOptions(
  options: Partial<Record<keyof typeof SURF_EXPLORE_OPTION_SUPPORT, unknown>>,
): void {
  refuseForeignOptions(
    "explore",
    options as Record<string, unknown>,
    [...SURF_PLAN_ONLY_OPTIONS, ...SURF_APPLY_ONLY_OPTIONS],
    "Those options belong to 'surf plan' and 'surf apply'; explore reads pages and never fills a form.",
  );
  const unsupported = collectUnsupportedOptions(SURF_EXPLORE_OPTION_SUPPORT, options);

  if (unsupported.length > 0) {
    throw renderUnsupported(
      "option(s) for 'surf explore'",
      unsupported,
      unsupportedSurfExploreOptionGuidance,
      "unsupported_option",
    );
  }
}
