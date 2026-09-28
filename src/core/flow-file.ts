/**
 * The flow file of `surf flow` (AK #6164; design `docs/project/2026-09-28-surf-flow-design.md`
 * section 3): a closed step language an LLM can write and an operator can review.
 *
 * Pure ring: no I/O. This module owns the file's shape, its normalization (step ids filled by
 * position) and the approval token over the normalized content. Everything is validated closed:
 * an unknown key, action or field is refused, never ignored, because the effect class, the
 * receipt and the submit gate of every step are derived from what this module accepts.
 */

import { z } from "zod";
import { canonicalDigest } from "./canonical-json.js";
import { parseChord } from "./cdp-keys.js";
import { frameOriginPath } from "./frame-address.js";
import { FrameworkError } from "./runtime-contract.js";
import { isWellFormedShadowPath } from "./shadow-path.js";

export const SURF_FLOW_SCHEMA_VERSION = 1;
/** at most this many steps: a flow is a journey, not a load test */
export const SURF_FLOW_MAX_STEPS = 500;
export const SURF_FLOW_MAX_TIMEOUT_MS = 30_000;

const httpUrl = (value: string) => /^https?:$/.test(new URL(value).protocol);

const Selector = z
  .string()
  .min(1)
  .refine(isWellFormedShadowPath, { message: "must not hold an empty shadow path segment" });
/** a CSS selector or shadow path, or a role and name found afresh in the accessibility tree */
const Target = z.union([
  Selector,
  z.object({ role: z.string().min(1), name: z.string() }).strict(),
]);
const Condition = z.union([
  z.object({ selector: Selector }).strict(),
  z.object({ text: z.string().min(1) }).strict(),
  z.object({ url_prefix: z.string().min(1) }).strict(),
]);
const Expect = z.union([
  z.object({ url_prefix: z.string().min(1) }).strict(),
  z.object({ text: z.string().min(1) }).strict(),
  z.object({ left_url: z.literal(true) }).strict(),
]);
const common = {
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "must be 1-64 of A-Z a-z 0-9 _ -")
    .optional(),
  frame: z
    .string()
    .url()
    .refine((url) => frameOriginPath(url) !== undefined, "must be an HTTP(S) URL")
    .optional(),
  timeout_ms: z.number().int().positive().max(SURF_FLOW_MAX_TIMEOUT_MS).optional(),
};
const submitting = { submit: z.literal(true).optional(), expect: Expect.optional() };
const Key = z.string().refine(
  (key) => {
    try {
      parseChord(key);
      return true;
    } catch {
      return false;
    }
  },
  { message: "is not a key this channel can press" },
);

const StepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("wait"), for: Condition, ...common }).strict(),
  z
    .object({
      action: z.literal("assert"),
      that: z.union([
        ...Condition.options,
        z.object({ field: z.object({ target: Selector, equals: z.string() }).strict() }).strict(),
      ]),
      ...common,
    })
    .strict(),
  z.object({ action: z.literal("fill"), target: Target, value: z.string(), ...common }).strict(),
  z
    .object({ action: z.literal("select"), target: Target, value: z.string().min(1), ...common })
    .strict(),
  z.object({ action: z.literal("check"), target: Target, ...common }).strict(),
  z.object({ action: z.literal("uncheck"), target: Target, ...common }).strict(),
  z.object({ action: z.literal("click"), target: Target, ...submitting, ...common }).strict(),
  z
    .object({ action: z.literal("press"), key: Key, target: Target, ...submitting, ...common })
    .strict(),
]);

const FlowSchema = z
  .object({
    schema_version: z.literal(SURF_FLOW_SCHEMA_VERSION),
    url: z.string().url().refine(httpUrl, "must be an HTTP(S) URL"),
    steps: z.array(StepSchema).min(1).max(SURF_FLOW_MAX_STEPS),
  })
  .strict()
  .superRefine((flow, issues) => {
    const seen = new Set<string>();
    flow.steps.forEach((step, index) => {
      const id = step.id ?? `s${index + 1}`;
      if (seen.has(id)) {
        issues.addIssue({ code: "custom", path: ["steps", index, "id"], message: "is not unique" });
      }
      seen.add(id);
      if ("expect" in step && step.expect !== undefined && step.submit !== true) {
        issues.addIssue({
          code: "custom",
          path: ["steps", index, "expect"],
          message: "belongs to a submit step (submit: true)",
        });
      }
    });
  });

type ParsedStep = z.output<typeof StepSchema>;
/** One step, its id filled: `s<n>` by position when the file named none. */
export type FlowStep = ParsedStep & { id: string };
export type FlowAction = FlowStep["action"];
export type FlowTarget = z.output<typeof Target>;

export interface SurfFlow {
  schema_version: typeof SURF_FLOW_SCHEMA_VERSION;
  url: string;
  steps: FlowStep[];
}

/** Parse a flow file's content, or refuse with the path and the first issues in the message. */
export function parseFlow(raw: unknown, flowPath: string): SurfFlow {
  const parsed = FlowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FrameworkError(
      "config_invalid",
      `The flow at ${flowPath} is not a surf flow v${SURF_FLOW_SCHEMA_VERSION}: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}. Nothing ran.`,
      {
        path: flowPath,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    );
  }
  return {
    schema_version: SURF_FLOW_SCHEMA_VERSION,
    url: parsed.data.url,
    steps: parsed.data.steps.map((step, index) => ({ ...step, id: step.id ?? `s${index + 1}` })),
  };
}

/**
 * `sha256:<hex>` over the RFC 8785 canonical form of the whole normalized flow: an approval binds
 * to every step as reviewed, and any edit is a new flow with a new token. It is the flow's id in
 * receipts. It is not a secret and grants nothing on its own.
 */
export function flowApprovalToken(flow: SurfFlow): string {
  return canonicalDigest(flow);
}

/** An act changes the page and is receipted; `wait` and `assert` only read it. */
export function isFlowAct(step: FlowStep): boolean {
  return step.action !== "wait" && step.action !== "assert";
}

/** A step declared a submit: the only kind that may act on a form-level control. */
export function isSubmitStep(step: FlowStep): boolean {
  return "submit" in step && step.submit === true;
}

/** What a step addresses, as receipts and the envelope name it; never a value. */
export function describeFlowTarget(step: FlowStep): string {
  if (step.action === "wait") return describeCondition(step.for);
  if (step.action === "assert") {
    return "field" in step.that ? step.that.field.target : describeCondition(step.that);
  }
  const target =
    typeof step.target === "string" ? step.target : `${step.target.role} "${step.target.name}"`;
  return step.action === "press" ? `${step.key} on ${target}` : target;
}

function describeCondition(condition: z.output<typeof Condition>): string {
  if ("selector" in condition) return condition.selector;
  if ("url_prefix" in condition) return `url ${condition.url_prefix}`;
  return "text";
}
