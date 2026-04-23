import { z } from "zod";
import { runCommand } from "./command-runner.js";
import { assertSupportedSurfExploreOptions } from "./support.js";
import type {
  OperationDefinition,
  SurfExploreOperationInput,
  SurfExploreOperationResultEnvelope,
} from "./types.js";

export const SurfExploreOperationInputSchema = z
  .object({
    url: z
      .string({
        required_error: "Surf explore requires --url with a valid URL.",
      })
      .url("Surf explore target must be a valid URL."),
    depth: z.string().optional(),
    record: z.boolean().optional().default(false),
    validate: z.boolean().optional().default(false),
    baseline: z.string().optional(),
    aiDiff: z.boolean().optional().default(false),
    file: z.string().optional(),
  })
  .transform((input) => {
    assertSupportedSurfExploreOptions(input);
    return input;
  });

type NormalizedSurfExploreOperationInput = z.output<typeof SurfExploreOperationInputSchema>;

async function runSurfExploreOperation(
  normalized: NormalizedSurfExploreOperationInput,
): Promise<SurfExploreOperationResultEnvelope> {
  const args = ["go", normalized.url];
  const result = await runCommand("surf", args);

  return {
    operationId: "surf.explore",
    input: normalized,
    result: {
      command: "surf",
      args,
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    },
  };
}

export const SURF_EXPLORE_OPERATION = {
  id: "surf.explore",
  route: { command: "surf", action: "explore" },
  description: "Run the real surf CLI through the supported explore action",
  inputSchema: SurfExploreOperationInputSchema,
  execute: runSurfExploreOperation,
} satisfies OperationDefinition<
  NormalizedSurfExploreOperationInput,
  SurfExploreOperationResultEnvelope
>;

export async function executeSurfExploreOperation(
  input: SurfExploreOperationInput,
): Promise<SurfExploreOperationResultEnvelope> {
  return runSurfExploreOperation(SurfExploreOperationInputSchema.parse(input));
}
