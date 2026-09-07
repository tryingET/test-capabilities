/**
 * The framework's error carrier and the shape it renders in.
 *
 * Pure ring: no I/O. Every refusal the framework raises is a `FrameworkError` with a registered
 * code (`src/core/error-codes.ts`), so the CLI can print `<message> [code]` in text mode and the
 * surf-shaped envelope `{"error": {code, message, details}}` under `--json` with exit 1
 * (architecture review A6, Q5; result-classification packet, "Error codes"). The classifier
 * parses that same shape back out of surf, so one contract runs in both directions.
 */

import { UNCLASSIFIED_ERROR_CODE } from "./error-codes.js";

export class FrameworkError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "FrameworkError";
    this.code = code;
    this.details = details;
  }
}

export function isFrameworkError(error: unknown): error is FrameworkError {
  return error instanceof FrameworkError;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

interface ZodLikeIssue {
  message?: unknown;
  path?: unknown;
  code?: unknown;
}

function zodIssues(error: unknown): ZodLikeIssue[] | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as ZodLikeIssue[]) : undefined;
}

/** The message a human reads: schema issues are joined, everything else speaks for itself. */
export function renderErrorMessage(error: unknown): string {
  const issues = zodIssues(error);
  if (issues) {
    const messages = issues
      .map((issue) => issue?.message)
      .filter((message): message is string => typeof message === "string" && message.length > 0);
    if (messages.length > 0) {
      return messages.join("\n");
    }
  }

  return error instanceof Error ? error.message : String(error);
}

/**
 * The code an error carries. A `FrameworkError` names its own; a schema failure is
 * `config_invalid`; anything else is `unclassified_error`, which says exactly that rather than
 * pretending to a code the registry does not have.
 */
export function errorCode(error: unknown): string {
  if (isFrameworkError(error)) {
    return error.code;
  }
  if (zodIssues(error)) {
    return "config_invalid";
  }
  return UNCLASSIFIED_ERROR_CODE;
}

export function errorDetails(error: unknown): Record<string, unknown> | undefined {
  if (isFrameworkError(error)) {
    return error.details;
  }
  const issues = zodIssues(error);
  if (issues) {
    return {
      issues: issues.map((issue) => ({
        path: Array.isArray(issue?.path) ? issue.path.join(".") : undefined,
        message: typeof issue?.message === "string" ? issue.message : undefined,
      })),
    };
  }
  return undefined;
}

/** `{"error": {code, message, details}}` - the same envelope surf prints under `--json`. */
export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  const details = errorDetails(error);
  return {
    error: {
      code: errorCode(error),
      message: renderErrorMessage(error),
      ...(details === undefined ? {} : { details }),
    },
  };
}

/** `<message> [code]` - the text-mode rendering, matching surf's first error line. */
export function renderErrorLine(error: unknown): string {
  return `${renderErrorMessage(error)} [${errorCode(error)}]`;
}

export function renderUnsupported(
  category: string,
  values: string[],
  guidance: string,
  code: string,
): FrameworkError {
  return new FrameworkError(
    code,
    `Unsupported ${category}: ${values.join(", ")}. Outside the current capability contract. ${guidance}`,
    { category, values },
  );
}
