/**
 * The run verdict as a Determination.
 *
 * Pure ring (implementation plan §1): no I/O, so the verdict is a replayable function of the
 * recorded outcomes and nothing else (axiom A5). A step has a `ResultOutcome` with a basis; the
 * run has a `Determination` over those outcomes (architecture adjudication prisoner 6, claim 7).
 * `TestResult.passed` becomes `determination.value === "verified"`, so the third state - a run
 * that produced no evidence either way - reaches the top level instead of being folded into
 * `fail`. Exit codes stay 0/1 with `unverified` and `indeterminate` mapping to 1 (operator
 * decision D3); exit 2 is revisited once consumers read the envelope.
 *
 * The same type is reused by slice S8 for the frame root cause, which is why `candidates` is
 * part of the shape: a determination names the values its evidence could still support.
 */

import type {
  ExpectDeclaration,
  OutcomeBasis,
  OutcomeClass,
  ResultOutcome,
} from "./result-classification.js";
import { OUTCOME_BASES, OUTCOME_CLASSES } from "./result-classification.js";

/**
 * The four states a run can reach.
 *
 * - `verified`: the run obtained evidence that the target works.
 * - `failed`: the run obtained evidence that the target is broken.
 * - `unverified`: the run obtained no evidence either way (an undeclared empty payload, a
 *   self-contradictory reply, or no measured coverage at all).
 * - `indeterminate`: a step that may have changed the target never reported an outcome, so
 *   nothing about the target may be claimed (axiom A2, review A4).
 */
export const DETERMINATION_VALUES = ["verified", "failed", "unverified", "indeterminate"] as const;

export type DeterminationValue = (typeof DETERMINATION_VALUES)[number];

/**
 * The kernel determination *shape*, over whatever closed value set a question has.
 *
 * The run verdict answers in `DeterminationValue`; slice S8's frame question answers in
 * `FrameDeterminationValue` (`excluded | confirmed | suspected | undetermined | unavailable`).
 * What the kernel owns is the shape, not the vocabulary: a value, the outcome basis it rests
 * on, the values the same evidence could still support, and one line naming what decided it.
 * A gate that cannot fill all four has not finished thinking.
 */
export interface DeterminationOf<TValue extends string> {
  value: TValue;
  /** the outcome basis the value rests on; the same axis a step outcome carries */
  basis: OutcomeBasis;
  /** the values the recorded evidence could still support, worst first; always includes `value` */
  candidates: TValue[];
  /** one line naming the evidence that decided it, so the verdict can be read without the run */
  reason: string;
}

/** The run verdict (adjudication claim 7, operator decision D3). */
export type Determination = DeterminationOf<DeterminationValue>;

/**
 * What the composition knows beyond the step outcomes. `expectations` are the declarations in
 * force for the run: they never change the value (the declaration already decided each step's
 * class inside `classifyResult`), they are named in the reason so a `declared_empty` pass is
 * readable as a choice the operator made.
 */
export interface DeterminationContext {
  expectations?: readonly ExpectDeclaration[];
  /** findings with severity high or critical; a blocking finding without an outcome is legacy */
  blockingFindings?: number;
  /** `coverage.overall`; 0 means no sensor measured anything */
  coverage?: number;
}

/**
 * Precedence, strongest claim first.
 *
 * `failed` wins over `indeterminate`: a proven fault is evidence, and folding it into "nothing
 * is known" would delete a fact rather than claim less. Fail-closed means refusing to assert
 * success without proof, not weakening a proof of failure. The indeterminate step stays visible
 * in `bases` and in its own outcome, which is where the warning belongs (peer consultation,
 * slice S4 note). Between the two states that have no evidence, `indeterminate` outranks
 * `unverified` because it additionally says the target may already have been changed.
 */
const VALUE_PRECEDENCE: readonly DeterminationValue[] = [
  "failed",
  "indeterminate",
  "unverified",
  "verified",
];

function countBases(outcomes: readonly ResultOutcome[]): Record<OutcomeBasis, number> {
  const counts = Object.fromEntries(OUTCOME_BASES.map((entry) => [entry, 0])) as Record<
    OutcomeBasis,
    number
  >;
  for (const outcome of outcomes) {
    counts[outcome.basis] += 1;
  }
  return counts;
}

function declarationSummary(context: DeterminationContext): string {
  const declaredBy = [...new Set((context.expectations ?? []).map((entry) => entry.declaredBy))];
  return declaredBy.length === 0 ? "" : ` declarations: ${declaredBy.sort().join(", ")}.`;
}

/**
 * The run verdict over the step outcomes.
 *
 * Precedence is `failed` (evidence of a fault), then `indeterminate` (a step whose effect on
 * the target is unknown), then `unverified` (no evidence either way), then `verified`, which is
 * reached only when at least one step produced evidence and nothing blocked. See
 * `VALUE_PRECEDENCE` for why a proven fault outranks an unknown effect.
 *
 * A run with no classified outcome falls back to the legacy signal the orchestrator has always
 * had (blocking findings and measured coverage), so an agent that does not classify yet is
 * reported honestly instead of being called unverified for a reason that is about the framework.
 */
export function determineRun(
  outcomes: readonly ResultOutcome[],
  context: DeterminationContext = {},
): Determination {
  const bases = countBases(outcomes);
  const blocking = context.blockingFindings ?? 0;
  const coverage = context.coverage ?? 0;
  const declarations = declarationSummary(context);
  const candidates: DeterminationValue[] = [];

  if (bases.indeterminate > 0) {
    candidates.push("indeterminate");
  }
  if (bases.fault > 0 || blocking > 0) {
    candidates.push("failed");
  }
  if (bases.no_evidence > 0 || bases.contradiction > 0 || coverage <= 0) {
    candidates.push("unverified");
  }
  if (bases.evidence > 0 || (outcomes.length === 0 && coverage > 0)) {
    candidates.push("verified");
  }
  if (candidates.length === 0) {
    candidates.push("unverified");
  }

  const value =
    VALUE_PRECEDENCE.find((candidate) => candidates.includes(candidate)) ?? "unverified";

  return {
    value,
    basis: basisFor(value, bases),
    candidates: VALUE_PRECEDENCE.filter((candidate) => candidates.includes(candidate)),
    reason: reasonFor(value, bases, { blocking, coverage, steps: outcomes.length, declarations }),
  };
}

/** The axis the value rests on; `unverified` says which kind of absence it found. */
function basisFor(value: DeterminationValue, bases: Record<OutcomeBasis, number>): OutcomeBasis {
  switch (value) {
    case "verified":
      return "evidence";
    case "failed":
      return "fault";
    case "indeterminate":
      return "indeterminate";
    default:
      return bases.no_evidence === 0 && bases.contradiction > 0 ? "contradiction" : "no_evidence";
  }
}

function reasonFor(
  value: DeterminationValue,
  bases: Record<OutcomeBasis, number>,
  facts: { blocking: number; coverage: number; steps: number; declarations: string },
): string {
  const stepSummary =
    facts.steps === 0
      ? "no classified step"
      : `${facts.steps} classified step(s) (${(Object.keys(bases) as OutcomeBasis[])
          .filter((basis) => bases[basis] > 0)
          .map((basis) => `${basis}:${bases[basis]}`)
          .join(" ")})`;
  const tail = `${stepSummary}, ${facts.blocking} blocking finding(s), coverage ${facts.coverage}%.${facts.declarations}`;

  switch (value) {
    case "indeterminate":
      return `A step that may have changed the target never reported an outcome, so nothing about the target is known: ${tail}`;
    case "failed":
      return `The run obtained evidence of a fault: ${tail}`;
    case "unverified":
      return `The run obtained no evidence either way; this is not a claim that the target is broken: ${tail}`;
    default:
      return `Every classified step produced evidence and nothing blocked: ${tail}`;
  }
}

/**
 * The counts the report renders next to the determination. Every key of the closed set is
 * present, zeros included, so the envelope shape does not depend on what a run happened to see.
 */
export function countOutcomeClasses(
  outcomes: readonly ResultOutcome[],
): Record<OutcomeClass, number> {
  const counts = Object.fromEntries(OUTCOME_CLASSES.map((entry) => [entry, 0])) as Record<
    OutcomeClass,
    number
  >;
  for (const outcome of outcomes) {
    counts[outcome.class] += 1;
  }
  return counts;
}

export function countOutcomeBases(
  outcomes: readonly ResultOutcome[],
): Record<OutcomeBasis, number> {
  return countBases(outcomes);
}

/** Ordered by how much the basis claims; the worst is the one a sensor's report leads with. */
const BASIS_WEIGHT: Record<OutcomeBasis, number> = {
  evidence: 0,
  no_evidence: 1,
  contradiction: 2,
  indeterminate: 3,
  fault: 4,
};

/** The outcome a sensor's observation is rendered from: the one that claims the most. */
export function worstOutcome(outcomes: readonly ResultOutcome[]): ResultOutcome | undefined {
  return outcomes.reduce<ResultOutcome | undefined>(
    (worst, outcome) =>
      worst === undefined || BASIS_WEIGHT[outcome.basis] > BASIS_WEIGHT[worst.basis]
        ? outcome
        : worst,
    undefined,
  );
}

/**
 * The two lines every consumer reads first (`outcome:<class>:<code>`, `basis:<basis>`), rendered
 * from the typed field rather than re-derived from prose (result-classification packet,
 * "Backwards compatibility").
 */
export function outcomeEvidenceLines(outcome: ResultOutcome | undefined): string[] {
  return outcome === undefined
    ? []
    : [`outcome:${outcome.class}:${outcome.code}`, `basis:${outcome.basis}`];
}
