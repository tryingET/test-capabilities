import { z } from "zod";

export const REPLACEMENT_VALIDATION_REQUEST_SCHEMA_VERSION =
  "testcapabilities.replacement-validation-request.v1";
export const REPLACEMENT_VALIDATION_RESULT_SCHEMA_VERSION =
  "testcapabilities.replacement-validation-result.v1";

export const REPLACEMENT_VALIDATION_NON_AUTHORIZATIONS = Object.freeze({
  mutationAuthority: false,
  dependencyChangeAuthority: false,
  removalAuthority: false,
  replacementAuthority: false,
  mergeAuthority: false,
  releaseAuthority: false,
  trustCertificationAuthority: false,
});

const ArtifactRefSchema = z
  .object({
    kind: z.string().min(1),
    path: z.string().min(1),
    digest: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
  })
  .strict();

const ImpactScopeSchema = z
  .object({
    packageNames: z.array(z.string().min(1)).default([]),
    changedPaths: z.array(z.string().min(1)).default([]),
    requiredProofCodes: z.array(z.string().min(1)).default([]),
    validationCommands: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const ReplacementValidationRequestSchema = z
  .object({
    schemaVersion: z.literal(REPLACEMENT_VALIDATION_REQUEST_SCHEMA_VERSION),
    target: z
      .object({
        repositoryPath: z.string().min(1).optional(),
        repositoryRef: z.string().min(1).optional(),
      })
      .strict()
      .default({}),
    candidateChangeRef: ArtifactRefSchema.optional(),
    evidenceRefs: z.array(ArtifactRefSchema).default([]),
    impactScope: ImpactScopeSchema.optional(),
    dryRun: z.boolean().default(true),
  })
  .strict();

export type ReplacementValidationRequest = z.infer<
  typeof ReplacementValidationRequestSchema
>;

export type ReplacementValidationStatus = "planned" | "unsupported";

export interface ReplacementValidationDiagnostic {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
}

export interface ReplacementValidationSelectedCommand {
  command: string;
  mode: "planned-not-executed";
  authority: string;
}

export interface ReplacementValidationResult {
  schemaVersion: typeof REPLACEMENT_VALIDATION_RESULT_SCHEMA_VERSION;
  status: ReplacementValidationStatus;
  requestSummary: {
    target: ReplacementValidationRequest["target"];
    candidateChangeRef?: ReplacementValidationRequest["candidateChangeRef"];
    packageNames: string[];
    changedPaths: string[];
    requiredProofCodes: string[];
    dryRun: boolean;
  };
  selectedCommands: ReplacementValidationSelectedCommand[];
  execution: {
    executed: false;
    reason: string;
  };
  diagnostics: ReplacementValidationDiagnostic[];
  nonAuthorizations: typeof REPLACEMENT_VALIDATION_NON_AUTHORIZATIONS;
  authority: string;
}

const DEP_SURGEON_REF_KINDS = new Set(["dep-surgeon-plan", "dep-surgeon-result"]);
const RESULT_AUTHORITY =
  "Replacement validation planning is target validation guidance only; it does not authorize mutation, dependency change, removal, replacement, merge, release, or trust certification.";

function unsupportedResult(
  diagnostics: ReplacementValidationDiagnostic[],
  parsedRequest?: ReplacementValidationRequest,
): ReplacementValidationResult {
  return {
    schemaVersion: REPLACEMENT_VALIDATION_RESULT_SCHEMA_VERSION,
    status: "unsupported",
    requestSummary: {
      target: parsedRequest?.target ?? {},
      ...(parsedRequest?.candidateChangeRef
        ? { candidateChangeRef: parsedRequest.candidateChangeRef }
        : {}),
      packageNames: parsedRequest?.impactScope?.packageNames ?? [],
      changedPaths: parsedRequest?.impactScope?.changedPaths ?? [],
      requiredProofCodes: parsedRequest?.impactScope?.requiredProofCodes ?? [],
      dryRun: parsedRequest?.dryRun ?? true,
    },
    selectedCommands: [],
    execution: {
      executed: false,
      reason: "No validation commands were executed because the request did not pass the validation membrane.",
    },
    diagnostics,
    nonAuthorizations: REPLACEMENT_VALIDATION_NON_AUTHORIZATIONS,
    authority: RESULT_AUTHORITY,
  };
}

function diagnosticFromIssue(issue: z.ZodIssue): ReplacementValidationDiagnostic {
  return {
    level: "error",
    code: "replacementValidation.requestInvalid",
    message: `${issue.path.join(".") || "request"}: ${issue.message}`,
  };
}

export function createReplacementValidationPlan(
  input: unknown,
): ReplacementValidationResult {
  const parsed = ReplacementValidationRequestSchema.safeParse(input);
  if (!parsed.success) {
    return unsupportedResult(parsed.error.issues.map(diagnosticFromIssue));
  }

  const request = parsed.data;
  const diagnostics: ReplacementValidationDiagnostic[] = [];

  if (!request.candidateChangeRef) {
    diagnostics.push({
      level: "error",
      code: "replacementValidation.candidateChangeRefRequired",
      message:
        "Replacement validation requires an explicit dep-surgeon plan/result reference.",
    });
  } else if (!DEP_SURGEON_REF_KINDS.has(request.candidateChangeRef.kind)) {
    diagnostics.push({
      level: "error",
      code: "replacementValidation.depSurgeonRefRequired",
      message:
        "Replacement validation accepts only dep-surgeon-plan or dep-surgeon-result candidate references.",
    });
  }

  if (!request.impactScope) {
    diagnostics.push({
      level: "error",
      code: "replacementValidation.impactScopeRequired",
      message:
        "Replacement validation requires explicit impact scope and repo-local validation commands.",
    });
  } else {
    if (request.impactScope.packageNames.length === 0) {
      diagnostics.push({
        level: "error",
        code: "replacementValidation.packageNamesRequired",
        message: "Impact scope must name at least one package under validation.",
      });
    }

    if (request.impactScope.validationCommands.length === 0) {
      diagnostics.push({
        level: "error",
        code: "replacementValidation.commandsRequired",
        message:
          "Impact scope must provide explicit repo-local validation commands; commands are planned, not executed.",
      });
    }
  }

  if (diagnostics.length > 0) {
    return unsupportedResult(diagnostics, request);
  }

  return {
    schemaVersion: REPLACEMENT_VALIDATION_RESULT_SCHEMA_VERSION,
    status: "planned",
    requestSummary: {
      target: request.target,
      candidateChangeRef: request.candidateChangeRef,
      packageNames: request.impactScope?.packageNames ?? [],
      changedPaths: request.impactScope?.changedPaths ?? [],
      requiredProofCodes: request.impactScope?.requiredProofCodes ?? [],
      dryRun: request.dryRun,
    },
    selectedCommands: (request.impactScope?.validationCommands ?? []).map((command) => ({
      command,
      mode: "planned-not-executed",
      authority: "Command selection is a validation plan only; execution requires an explicit caller.",
    })),
    execution: {
      executed: false,
      reason:
        "Replacement validation membrane only plans target-owned validation commands and never mutates dependencies.",
    },
    diagnostics: [
      {
        level: "info",
        code: "replacementValidation.plannedOnly",
        message:
          "Validation commands were selected for a candidate change, but no command was executed by this planning membrane.",
      },
    ],
    nonAuthorizations: REPLACEMENT_VALIDATION_NON_AUTHORIZATIONS,
    authority: RESULT_AUTHORITY,
  };
}
