/**
 * TEST-CAPABILITIES Self-Healing System
 * Tests that fix themselves when things change
 */

import { createHash } from "node:crypto";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import path from "node:path";
import type { EffectDeclaration } from "../core/effects.js";
import { idempotencyKeyFor, MutationError } from "../core/effects.js";
import type { MutationReceipt } from "../core/receipt-store.js";
import type { RunContext } from "../core/run-context.js";
import { createRunContext } from "../core/run-context.js";

const MAX_HEAL_SOURCE_FILE_BYTES = 5 * 1024 * 1024;

/** The class every healing write declares: the workspace is state the framework owns. */
export const HEAL_WRITE_EFFECT: EffectDeclaration = {
  effect: "mutating",
  scope: "workspace",
  reason: "rewrites selectors in a test file the operator pointed --dir at",
};

/**
 * The key of one file's rewrite: the file, the content it was planned against and the change
 * itself. A legitimate second heal of a further-drifted file gets a new key; a replay of the
 * same plan against the same content does not (mutation-safety packet, decision log).
 */
export function healStepKey(
  file: string,
  before: string,
  proposals: readonly HealingProposal[],
): string {
  const change = proposals
    .map((proposal) => `${proposal.line}:${proposal.oldSelector}->${proposal.newSelector}`)
    .join(",");
  return idempotencyKeyFor("heal", {
    id: `heal.apply:${file}`,
    subject: `${file}|${sha256Of(before)}`,
    intent: change,
  });
}

/**
 * What a healing write attempt means. A write that never reached the rename definitely did not
 * land and is `failed`; a rename that threw may have landed and is `unknown`, which the step's
 * `verify` read-back may then promote. Nothing here can produce `failed` from a rename.
 */
export function settleHealWrite(
  error: unknown,
  afterHash: string,
): { outcome: "applied" | "failed" | "unknown"; evidence?: string[] } {
  if (error instanceof HealWriteError && error.stage === "rename") {
    return { outcome: "unknown", evidence: [`rename failed: ${error.message}`] };
  }
  if (error !== undefined) {
    return { outcome: "failed" };
  }
  return { outcome: "applied", evidence: [`after ${afterHash}`] };
}

export function sha256Of(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf-8").digest("hex")}`;
}

/**
 * Where a failed write stopped. A write that never reached the rename definitely did not land;
 * a rename that threw may have landed, and the difference is the difference between `failed`
 * and `unknown` (mutation-safety packet, "Behaviour and failure modes").
 */
export class HealWriteError extends Error {
  readonly stage: "prepare" | "rename";

  constructor(stage: "prepare" | "rename", cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "HealWriteError";
    this.stage = stage;
  }
}

function isPathInsideRoot(candidateRealPath: string, rootRealPath: string): boolean {
  const relative = path.relative(rootRealPath, candidateRealPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// ============================================
// TYPES
// ============================================

/**
 * Minimal finding shape accepted by the healer.
 * Matches the orchestrator Finding schema subset needed for evidence-backed healing.
 */
export interface HealingFinding {
  id: string;
  component: string;
  description: string;
  evidence: string[];
  /**
   * The classified outcome the finding was rendered from, when the producer classified it.
   * Only `basis: "fault"` is a statement about the target, and only such a finding may drive a
   * selector rewrite; a finding without an outcome is legacy input and keeps its pre-S4 meaning
   * (result-classification packet, refinement; plan S4).
   */
  outcome?: { basis: string };
  /**
   * Why an element this finding is about could not be reached (slice S8). The typed field is
   * authoritative; the `frame-root-cause:` marker line in `evidence` is read only for a finding
   * written before it existed (architecture review A20).
   */
  frameRootCause?: {
    determination: { value: string; reason?: string };
    primaryTag?: string | null;
    hint?: string | null;
    candidates?: Array<{
      domIndex: number | null;
      origin: string | null;
      primaryTag: string | null;
    }>;
    confirmedCandidate?: {
      domIndex: number | null;
      frameId?: number | null;
      origin: string | null;
      tags?: string[];
    } | null;
  };
}

/**
 * A selector the healer will not rewrite, and why.
 *
 * Refusals are review artifacts: they carry what a reviewer would have to do instead (for a
 * `confirmed` frame boundary, the `frame.switch` the repair actually needs), and `heal --apply`
 * never consumes one. A refusal is not a failure of the run - it is the healer saying that the
 * information it has does not license the act.
 */
export interface HealingRefusal {
  triggeringFindingId?: string;
  selector: string;
  reason: string;
  code: string;
  suggestion?: {
    kind: "frame.switch";
    index?: number;
    frameId?: number;
    urlPrefix: string;
    hops: number;
  };
}

/**
 * The caveat a `suspected` frame determination puts on a proposal.
 *
 * The proposal still exists - a healer that goes silent on every page with a consent banner or
 * an ad frame is a healer that gets turned off - but it carries `requiresReview: true` and this
 * record of what the reviewer must check, and the apply path refuses it structurally rather
 * than by prose (frame-root-cause packet, Clash 2).
 */
export interface HealingFrameCaveat {
  determination: string;
  findingId?: string;
  reason: string;
  candidates: Array<{ domIndex: number | null; origin: string | null; primaryTag: string | null }>;
}

/** What a determination permits the healer to do with a selector (packet, permission table). */
export type FramePermission = "heal" | "caveat" | "refuse";

export function framePermissionFor(determination: string | undefined): FramePermission {
  switch (determination) {
    case undefined:
    case "excluded":
      return "heal";
    case "suspected":
      return "caveat";
    default:
      // `confirmed` (the rewrite is wrong by construction), `undetermined` and `unavailable`
      // (there is no candidate list to show a reviewer).
      return "refuse";
  }
}

/** The determination in force for a finding: typed field first, marker line for legacy input. */
export function frameDeterminationOfFinding(finding: HealingFinding): string | undefined {
  if (finding.frameRootCause) {
    return finding.frameRootCause.determination.value;
  }
  for (const line of finding.evidence) {
    const match = /^frame-root-cause:\s+determination=(\w+)\b/.exec(line.trim());
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

export interface HealingStrategy {
  name: string;
  priority: number;
  execute: (context: HealingContext) => Promise<HealingResult>;
}

export interface HealingContext {
  originalSelector: string;
  action: "click" | "fill" | "assert" | "hover";
  description?: string;
  screenshot?: Buffer;
  lastKnownGood?: ElementSnapshot;
}

export interface HealingResult {
  success: boolean;
  newSelector?: string;
  confidence: number;
  strategy: string;
  metadata?: Record<string, unknown>;
}

export interface ElementSnapshot {
  selector: string;
  role?: string;
  text?: string;
  label?: string;
  ariaLabel?: string;
  position?: { x: number; y: number };
  attributes: Record<string, string>;
}

// ============================================
// HEALING ENGINE
// ============================================

function stripLegacySelectorPrefix(selector: string): string | undefined {
  const replacements: Array<[RegExp, string]> = [
    [/^(?:old-|deprecated-)(.+)$/, "$1"],
    [/^([#.])(?:old-|deprecated-)(.+)$/, "$1$2"],
    [/^(\[data-testid=")(?:old-|deprecated-)([^"]+)("\])$/, "$1$2$3"],
    [/^(\[data-testid=')(?:old-|deprecated-)([^']+)('\])$/, "$1$2$3"],
    [/^(\/\/\*\[@id=")(?:old-|deprecated-)([^"]+)("\])$/, "$1$2$3"],
    [/^(\/\/\*\[@id=')(?:old-|deprecated-)([^']+)('\])$/, "$1$2$3"],
    [/^(\/\/\*\[@name=")(?:old-|deprecated-)([^"]+)("\])$/, "$1$2$3"],
    [/^(\/\/\*\[@name=')(?:old-|deprecated-)([^']+)('\])$/, "$1$2$3"],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(selector)) {
      return selector.replace(pattern, replacement);
    }
  }

  return undefined;
}

const SELECTOR_EXTRACTION_PATTERNS = [
  /getByTestId\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
  /locator\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g,
  /(?:\b(?:[\w$]*page|[\w$]*frame)|this\.(?:page|frame))\s*\.\s*click\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*(?:,|\))/gi,
  /(?:\b(?:[\w$]*page|[\w$]*frame)|this\.(?:page|frame))\s*\.\s*fill\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,/gi,
] as const;

interface ExtractedSelectorCandidate {
  selector: string;
  index: number;
}

function extractSelectorCandidates(content: string): ExtractedSelectorCandidate[] {
  const candidates: ExtractedSelectorCandidate[] = [];

  for (const pattern of SELECTOR_EXTRACTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(content);

    while (match !== null) {
      const selector = match[2];
      const selectorIndexInMatch = match[0].indexOf(selector);
      const index = selectorIndexInMatch >= 0 ? match.index + selectorIndexInMatch : match.index;

      candidates.push({ selector, index });
      match = pattern.exec(content);
    }
  }

  return candidates.sort((left, right) => left.index - right.index);
}

export class SelfHealingEngine {
  private strategies: HealingStrategy[] = [];

  constructor() {
    this.registerDefaultStrategies();
  }

  private registerDefaultStrategies(): void {
    // Strategy 1: Legacy prefix normalization
    this.register({
      name: "legacy-prefix-trim",
      priority: 5,
      execute: async (ctx) => {
        const normalizedSelector = stripLegacySelectorPrefix(ctx.originalSelector);
        if (normalizedSelector && normalizedSelector !== ctx.originalSelector) {
          return {
            success: true,
            newSelector: normalizedSelector,
            confidence: 0.8,
            strategy: "legacy-prefix-trim",
          };
        }
        return { success: false, confidence: 0, strategy: "legacy-prefix-trim" };
      },
    });

    // Strategy 2: Test ID fallback
    this.register({
      name: "testid-fallback",
      priority: 10,
      execute: async (ctx) => {
        const testIdMatch = ctx.originalSelector.match(/data-testid=(?:"([^"]+)"|'([^']+)')/);
        const testId = testIdMatch?.[1] ?? testIdMatch?.[2];
        if (testId) {
          return {
            success: true,
            newSelector: `[data-testid="${testId}"]`,
            confidence: 0.95,
            strategy: "testid-fallback",
          };
        }
        return { success: false, confidence: 0, strategy: "testid-fallback" };
      },
    });

    // Strategy 3: Role-based fallback
    this.register({
      name: "role-fallback",
      priority: 20,
      execute: async (ctx) => {
        if (ctx.lastKnownGood?.role) {
          const newSelector = `role=${ctx.lastKnownGood.role}`;
          if (ctx.lastKnownGood.text) {
            return {
              success: true,
              newSelector: `${newSelector}[name="${ctx.lastKnownGood.text}"]`,
              confidence: 0.85,
              strategy: "role-fallback",
            };
          }
          return {
            success: true,
            newSelector,
            confidence: 0.75,
            strategy: "role-fallback",
          };
        }
        return { success: false, confidence: 0, strategy: "role-fallback" };
      },
    });

    // Strategy 3: Text content search
    this.register({
      name: "text-search",
      priority: 30,
      execute: async (ctx) => {
        if (ctx.lastKnownGood?.text) {
          const escapedText = ctx.lastKnownGood.text.replace(/"/g, '\\"');
          return {
            success: true,
            newSelector: `text=${escapedText}`,
            confidence: 0.7,
            strategy: "text-search",
          };
        }
        return { success: false, confidence: 0, strategy: "text-search" };
      },
    });

    // Strategy 4: Visual/AI-based detection
    this.register({
      name: "vision-ai",
      priority: 40,
      execute: async (ctx) => {
        if (ctx.screenshot && ctx.description) {
          // A real vision backend is not wired into this runtime yet, so fail closed instead of
          // inventing a pseudo-selector that looks actionable.
          return {
            success: false,
            confidence: 0.65,
            strategy: "vision-ai",
            metadata: {
              requiresReview: true,
              reason: `Vision-based healing candidate requires an external model for '${ctx.description}'.`,
            },
          };
        }
        return { success: false, confidence: 0, strategy: "vision-ai" };
      },
    });

    // Strategy 5: XPath fallback
    this.register({
      name: "xpath-fallback",
      priority: 50,
      execute: async (ctx) => {
        if (ctx.lastKnownGood?.attributes) {
          const attrs = ctx.lastKnownGood.attributes;
          if (attrs.id) {
            return {
              success: true,
              newSelector: `//*[@id="${attrs.id}"]`,
              confidence: 0.9,
              strategy: "xpath-fallback",
            };
          }
          if (attrs.name) {
            return {
              success: true,
              newSelector: `//*[@name="${attrs.name}"]`,
              confidence: 0.8,
              strategy: "xpath-fallback",
            };
          }
        }
        return { success: false, confidence: 0, strategy: "xpath-fallback" };
      },
    });

    // Strategy 6: Nearby element search
    this.register({
      name: "nearby-search",
      priority: 60,
      execute: async (ctx) => {
        if (ctx.lastKnownGood?.position) {
          // A position-only hint is not enough to synthesize a trustworthy selector in this runtime.
          return {
            success: false,
            confidence: 0.5,
            strategy: "nearby-search",
            metadata: {
              requiresReview: true,
              reason:
                "Nearby-search requires a real DOM/vision lookup before it can emit selectors.",
            },
          };
        }
        return { success: false, confidence: 0, strategy: "nearby-search" };
      },
    });
  }

  register(strategy: HealingStrategy): void {
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => a.priority - b.priority);
  }

  async heal(context: HealingContext): Promise<HealingResult> {
    const attempts: HealingResult[] = [];

    for (const strategy of this.strategies) {
      const result = await strategy.execute(context);
      attempts.push(result);

      if (result.success && result.confidence >= 0.7) {
        return result;
      }
    }

    const best = attempts.reduce<HealingResult>(
      (currentBest, current) =>
        current.confidence > currentBest.confidence ? current : currentBest,
      { success: false, confidence: 0, strategy: "none" },
    );

    if (best.newSelector) {
      return {
        ...best,
        success: false,
        metadata: {
          ...best.metadata,
          requiresReview: true,
        },
      };
    }

    return best;
  }
}

// ============================================
// TEST FILE HEALER
// ============================================

const SELECTOR_TOKEN_CHAR = /[A-Za-z0-9_-]/;

function isSelectorTokenBoundary(line: string, column: number, length: number): boolean {
  const before = column > 0 ? line[column - 1] : "";
  const after = line[column + length] ?? "";
  return !SELECTOR_TOKEN_CHAR.test(before) && !SELECTOR_TOKEN_CHAR.test(after);
}

function readSelectorToken(line: string, column: number, length: number): string {
  let start = column;
  while (start > 0 && SELECTOR_TOKEN_CHAR.test(line[start - 1])) {
    start -= 1;
  }
  let end = column + length;
  while (end < line.length && SELECTOR_TOKEN_CHAR.test(line[end])) {
    end += 1;
  }
  return line.slice(start, end);
}

/** First occurrence of `selector` in `line` that is a whole token, or -1. */
function findSelectorTokenColumn(line: string, selector: string): number {
  let from = 0;
  while (from <= line.length) {
    const index = line.indexOf(selector, from);
    if (index < 0) {
      return -1;
    }
    if (isSelectorTokenBoundary(line, index, selector.length)) {
      return index;
    }
    from = index + 1;
  }
  return -1;
}

export class TestFileHealer {
  private engine: SelfHealingEngine;
  private readonly rootRealPath?: string;
  private readonly refusals: HealingRefusal[] = [];

  constructor(options: { rootDir?: string } = {}) {
    this.engine = new SelfHealingEngine();
    if (options.rootDir) {
      const rootPath = path.resolve(options.rootDir);
      let rootStat: Stats;
      try {
        rootStat = lstatSync(rootPath);
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        if (code === "ENOENT") {
          throw new Error(
            `Heal directory not found: ${rootPath}. Use --dir with an existing directory.`,
          );
        }
        throw error;
      }
      if (rootStat.isSymbolicLink()) {
        throw new Error(`Healing root must not be a symlink: ${rootPath}`);
      }
      if (!rootStat.isDirectory()) {
        throw new Error(`Healing root must be a directory: ${rootPath}`);
      }
      this.rootRealPath = realpathSync(rootPath);
    }
  }

  /**
   * The selectors this healer declined to rewrite, in the order it met them.
   *
   * They accumulate across `analyzeFile` calls, because one heal run scans many files and the
   * artifact reports one list. `heal --apply` never consumes a refusal.
   */
  frameRefusals(): readonly HealingRefusal[] {
    return [...this.refusals];
  }

  async analyzeFile(filePath: string, findings?: HealingFinding[]): Promise<HealingProposal[]> {
    const content = await this.readFile(filePath);
    // The content this proposal was made against. It travels through the proposal artifact and
    // becomes the write's precondition, so an apply against drifted content is impossible by
    // construction rather than by bookkeeping (mutation-safety packet, refinement 5).
    const fileSha256 = sha256Of(content);
    const proposals: HealingProposal[] = [];

    // Build a set of selectors mentioned in finding evidence when findings are provided.
    const evidenceSelectors = findings ? extractSelectorsFromEvidence(findings) : undefined;
    const findingsById = new Map((findings ?? []).map((finding) => [finding.id, finding]));

    for (const candidate of extractSelectorCandidates(content)) {
      const isValid = await this.validateSelector(candidate.selector);

      // When findings are provided, only heal selectors that appear in diagnostic evidence.
      // Without findings, fall back to the existing heuristic scan.
      const candidateAliases = selectorAliases(candidate.selector);
      const isTargetedByEvidence = evidenceSelectors
        ? candidateAliases.some((alias) => evidenceSelectors.has(alias))
        : true;

      if (!isValid && (!evidenceSelectors || isTargetedByEvidence)) {
        // Cite the triggering finding when evidence-backed mode is active.
        const triggeringFindingId =
          evidenceSelectors && findings
            ? findTriggeringFindingId(candidate.selector, evidenceSelectors)
            : undefined;
        const triggering = triggeringFindingId ? findingsById.get(triggeringFindingId) : undefined;
        const determination = triggering ? frameDeterminationOfFinding(triggering) : undefined;
        const permission = framePermissionFor(determination);

        // Refuse before the strategies run: a rewrite the determination does not license is
        // not a proposal a reviewer should have to reject.
        if (permission === "refuse") {
          this.refusals.push(
            frameRefusalFor(candidate.selector, triggering, determination as string),
          );
          continue;
        }

        const healingResult = await this.engine.heal({
          originalSelector: candidate.selector,
          action: this.inferAction(content, candidate.index),
          description: this.inferDescription(content, candidate.index),
        });

        if (healingResult.success && healingResult.newSelector) {
          const frameCaveat =
            permission === "caveat" ? frameCaveatFor(triggering as HealingFinding) : undefined;
          proposals.push({
            file: filePath,
            fileSha256,
            line: this.getLineNumber(content, candidate.index),
            column: this.getColumnNumber(content, candidate.index),
            oldSelector: candidate.selector,
            newSelector: healingResult.newSelector,
            confidence: healingResult.confidence,
            strategy: healingResult.strategy,
            // A frame-suspected page never heals without a human. That is the price the
            // refinement accepted so that a healer does not go silent on every page with an
            // embed, and the review gate - not prose - is what enforces it.
            requiresReview: Boolean(healingResult.metadata?.requiresReview) || Boolean(frameCaveat),
            ...(triggeringFindingId ? { triggeringFindingId } : {}),
            ...(frameCaveat ? { frameCaveat } : {}),
          });
        }
      }
    }

    return proposals;
  }

  async applyProposal(proposal: HealingProposal): Promise<void> {
    const content = await this.readFile(proposal.file);
    const updated = this.applyProposalsToContent(content, [proposal]);
    await this.writeFile(proposal.file, updated);
  }

  async verifyProposals(proposals: HealingProposal[]): Promise<HealingProposalVerification> {
    const proposalsByFile = new Map<string, HealingProposal[]>();
    for (const proposal of proposals) {
      const existing = proposalsByFile.get(proposal.file) ?? [];
      existing.push(proposal);
      proposalsByFile.set(proposal.file, existing);
    }

    const failures: HealingProposalVerificationFailure[] = [];

    for (const [file, fileProposals] of proposalsByFile) {
      try {
        const content = await this.readFile(file);
        this.applyProposalsToContent(content, fileProposals);
      } catch (error) {
        failures.push({
          file,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      status: failures.length === 0 ? "pass" : "fail",
      proposalCount: proposals.length,
      checkedFileCount: proposalsByFile.size,
      failures,
    };
  }

  /**
   * Apply proposals file by file, one conditional write per file.
   *
   * Every write is an `EffectStep` on the ledger (mutation-safety packet, refinement 5 and 6):
   * the key is `sha256(operation | step | file | intent)` over the file and its planned change,
   * the `precondition` is the content hash the proposal was made against and is re-read
   * immediately before the rename, the after-hash read-back is the step's `verify`, and a write
   * that fails after earlier files landed compensates only those - each with its own receipt,
   * never after an `unknown`.
   *
   * Returns the files whose rewrite was proven, and the receipts of the run.
   */
  async applyProposals(
    proposals: HealingProposal[],
    context?: RunContext,
  ): Promise<{ written: string[]; receipts: MutationReceipt[] }> {
    if (proposals.length === 0) {
      return { written: [], receipts: [] };
    }

    const run =
      context ?? createRunContext({ operationId: "heal", effect: HEAL_WRITE_EFFECT, input: {} });

    const proposalsByFile = new Map<string, HealingProposal[]>();
    for (const proposal of proposals) {
      const existing = proposalsByFile.get(proposal.file) ?? [];
      existing.push(proposal);
      proposalsByFile.set(proposal.file, existing);
    }

    const originals = new Map<string, string>();
    const updates = new Map<string, string>();
    const preconditions = new Map<string, string | undefined>();

    for (const [file, fileProposals] of proposalsByFile) {
      const content = await this.readFile(file);
      originals.set(file, content);
      updates.set(file, this.applyProposalsToContent(content, fileProposals));
      // A proposal artifact written before 0.4.0 carries no hash; such a proposal is applied
      // without a compare-and-swap and the receipt says so, rather than being refused.
      preconditions.set(file, fileProposals.find((proposal) => proposal.fileSha256)?.fileSha256);
    }

    const written: string[] = [];
    const receiptsByFile = new Map<string, MutationReceipt>();

    try {
      for (const [file, updated] of updates) {
        const before = originals.get(file) as string;
        const precondition = preconditions.get(file);
        await run.ledger.runStep<void>({
          id: `heal.apply:${file}`,
          effect: HEAL_WRITE_EFFECT,
          subject: file,
          intent: `replace ${(proposalsByFile.get(file) as HealingProposal[]).length} selector(s)`,
          idempotencyKey: healStepKey(file, before, proposalsByFile.get(file) as HealingProposal[]),
          ...(precondition
            ? { precondition, readPrecondition: async () => sha256Of(await this.readFile(file)) }
            : {}),
          details: {
            file_sha256_before: sha256Of(before),
            proposal_count: (proposalsByFile.get(file) as HealingProposal[]).length,
            ...(precondition ? {} : { precondition: "absent (legacy proposal artifact)" }),
          },
          run: async () => {
            await this.writeFile(file, updated);
          },
          settle: (attempt) => settleHealWrite(attempt.error, sha256Of(updated)),
          // The one read-only post-read that may promote an `unknown` write: the file either
          // holds the planned content or it does not.
          verify: async () => {
            const after = sha256Of(await this.readFile(file));
            return after === sha256Of(updated)
              ? { result: "applied" as const, evidence: [`after ${after}`] }
              : { result: "indeterminate" as const, evidence: [`read back ${after}`] };
          },
        });
        written.push(file);
        const receipt = run.ledger.receipts().at(-1);
        if (receipt) {
          receiptsByFile.set(file, receipt);
        }
      }
    } catch (error) {
      // A refusal that changed nothing speaks for itself: wrapping `precondition_failed` in a
      // partial-write summary would hide the code the operator has to act on (review A16).
      if (error instanceof MutationError && written.length === 0) {
        throw error;
      }
      const cause = error instanceof Error ? error.message : String(error);
      const restoreFailures = await this.compensate(run, written, receiptsByFile, originals);

      const summary = `Healing apply wrote ${written.length} of ${updates.size} file(s) before failing: ${cause}`;
      if (restoreFailures.length > 0) {
        throw new Error(
          `${summary}. Restore failed for ${restoreFailures.length} file(s); healed content remains on disk: ${restoreFailures.join("; ")}`,
        );
      }
      throw new Error(
        written.length > 0
          ? `${summary}. Restored ${written.length} file(s) to their original content: ${written.join(", ")}`
          : summary,
      );
    }

    return { written, receipts: run.ledger.receipts() };
  }

  /**
   * Undo the siblings that definitely landed, and only those. Compensation is confined to
   * owned storage after a definite sibling outcome; a file whose own write ended `unknown` is
   * never restored, because the restore could destroy the very content whose fate is unknown
   * (mutation-safety packet, refinement 6).
   */
  private async compensate(
    run: RunContext,
    written: string[],
    receiptsByFile: Map<string, MutationReceipt>,
    originals: Map<string, string>,
  ): Promise<string[]> {
    const restoreFailures: string[] = [];
    for (const file of written) {
      const original = originals.get(file);
      const receipt = receiptsByFile.get(file);
      if (original === undefined || receipt === undefined || receipt.outcome !== "applied") {
        continue;
      }
      try {
        await run.ledger.runStep<void>({
          id: `heal.restore:${file}`,
          effect: HEAL_WRITE_EFFECT,
          subject: file,
          intent: "restore the file this run had already healed",
          idempotencyKey: `${receipt.idempotency_key}:compensation`,
          compensationOf: receipt.receipt_id,
          details: { file_sha256_restored: sha256Of(original) },
          run: async () => {
            await this.writeFile(file, original);
          },
          settle: (attempt) => settleHealWrite(attempt.error, sha256Of(original)),
        });
      } catch (restoreError) {
        restoreFailures.push(
          `${file}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        );
      }
    }
    return restoreFailures;
  }

  private applyProposalsToContent(content: string, proposals: HealingProposal[]): string {
    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
    const hasTrailingNewline = content.endsWith("\n");
    const trimmedContent = hasTrailingNewline
      ? content.slice(0, content.endsWith("\r\n") ? -2 : -1)
      : content;
    const lines = trimmedContent.length > 0 ? trimmedContent.split(/\r?\n/) : [""];

    const orderedProposals = [...proposals].sort((left, right) => {
      const leftColumn = left.column ?? -1;
      const rightColumn = right.column ?? -1;
      return (
        right.line - left.line ||
        rightColumn - leftColumn ||
        right.oldSelector.length - left.oldSelector.length
      );
    });

    for (const proposal of orderedProposals) {
      const lineIndex = proposal.line - 1;

      if (lineIndex < 0 || lineIndex >= lines.length) {
        throw new Error(`Healing proposal line out of range: ${proposal.file}:${proposal.line}`);
      }

      const targetLine = lines[lineIndex];
      const targetColumn = proposal.column
        ? proposal.column - 1
        : findSelectorTokenColumn(targetLine, proposal.oldSelector);

      if (targetColumn < 0) {
        const rawColumn = targetLine.indexOf(proposal.oldSelector);
        if (rawColumn >= 0) {
          const found = readSelectorToken(targetLine, rawColumn, proposal.oldSelector.length);
          throw new Error(
            `Healing proposal selector mismatch at ${proposal.file}:${proposal.line}. Expected '${proposal.oldSelector}' as a whole token but found '${found}' (already healed or a longer selector).`,
          );
        }
        throw new Error(
          `Healing proposal selector mismatch at ${proposal.file}:${proposal.line}. Expected '${proposal.oldSelector}'.`,
        );
      }

      if (
        targetLine.slice(targetColumn, targetColumn + proposal.oldSelector.length) !==
        proposal.oldSelector
      ) {
        throw new Error(
          `Healing proposal selector mismatch at ${proposal.file}:${proposal.line}${proposal.column ? `:${proposal.column}` : ""}. Expected '${proposal.oldSelector}'.`,
        );
      }

      // Boundary guard: the match must be a whole selector token. Without it a
      // proposal '#btn' -> '#btn-new' re-applied to an already healed line
      // matches the prefix of '#btn-new' and yields '#btn-new-new'.
      if (!isSelectorTokenBoundary(targetLine, targetColumn, proposal.oldSelector.length)) {
        const found = readSelectorToken(targetLine, targetColumn, proposal.oldSelector.length);
        throw new Error(
          `Healing proposal selector mismatch at ${proposal.file}:${proposal.line}${proposal.column ? `:${proposal.column}` : ""}. Expected '${proposal.oldSelector}' as a whole token but found '${found}' (already healed or a longer selector).`,
        );
      }

      lines[lineIndex] =
        targetLine.slice(0, targetColumn) +
        proposal.newSelector +
        targetLine.slice(targetColumn + proposal.oldSelector.length);
    }

    const updated = lines.join(lineEnding);
    return hasTrailingNewline ? `${updated}${lineEnding}` : updated;
  }

  private async assertSafeHealingFile(filePath: string): Promise<Stats> {
    const fs = await import("node:fs/promises");
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Healing file must not be a symlink: ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Healing path is not a regular file: ${filePath}`);
    }
    if (stat.size > MAX_HEAL_SOURCE_FILE_BYTES) {
      throw new Error(
        `Healing file exceeds maximum size of ${MAX_HEAL_SOURCE_FILE_BYTES} bytes: ${filePath}`,
      );
    }
    if (this.rootRealPath) {
      const realPath = await fs.realpath(filePath);
      if (!isPathInsideRoot(realPath, this.rootRealPath)) {
        throw new Error(`Healing file resolved outside root: ${filePath}`);
      }
    }
    return stat;
  }

  private async readFile(filePath: string): Promise<string> {
    const fs = await import("node:fs/promises");
    await this.assertSafeHealingFile(filePath);
    return fs.readFile(filePath, "utf-8");
  }

  private async writeFile(filePath: string, content: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const originalStat = await this.assertSafeHealingFile(filePath);

    const parentDir = path.dirname(filePath);
    if (this.rootRealPath) {
      const parentRealPath = await fs.realpath(parentDir);
      if (!isPathInsideRoot(parentRealPath, this.rootRealPath)) {
        throw new Error(`Healing file parent resolved outside root: ${parentDir}`);
      }
    }

    const tempPath = path.join(
      parentDir,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
    );

    let tempCreated = false;
    let renaming = false;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(tempPath, "wx", originalStat.mode & 0o777);
      tempCreated = true;
      await handle.writeFile(content, "utf-8");
      await handle.close();
      handle = undefined;
      renaming = true;
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (tempCreated) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
      throw new HealWriteError(renaming ? "rename" : "prepare", error);
    }
  }

  private async validateSelector(selector: string): Promise<boolean> {
    // The shipped file-healing path uses a conservative local heuristic: selectors with known stale
    // prefixes are treated as invalid so they can be proposed for normalization.
    return !selector.includes("old-") && !selector.includes("deprecated-");
  }

  private inferAction(content: string, index: number): "click" | "fill" | "assert" | "hover" {
    const surrounding = content.slice(Math.max(0, index - 50), index + 50);
    if (surrounding.includes("click")) return "click";
    if (surrounding.includes("fill")) return "fill";
    if (surrounding.includes("expect")) return "assert";
    if (surrounding.includes("hover")) return "hover";
    return "click";
  }

  private inferDescription(content: string, index: number): string {
    // Look for test description or comments nearby
    const lines = content.slice(0, index).split("\n");
    const recentLines = lines.slice(-5);

    for (const line of recentLines) {
      const descMatch = line.match(/(?:test|it|describe)\s*\(\s*['"`]([^'"`]+)['"`]/);
      if (descMatch) return descMatch[1];
    }

    return "unknown element";
  }

  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split("\n").length;
  }

  private getColumnNumber(content: string, index: number): number {
    const lastNewline = content.lastIndexOf("\n", index - 1);
    return index - lastNewline;
  }
}

export interface HealingProposal {
  file: string;
  /**
   * sha256 of the file as it was when this proposal was made. The apply re-reads the file and
   * refuses with `precondition_failed` when it no longer matches, so a proposal can never be
   * applied to content it was not planned against. Absent on artifacts written before 0.4.0.
   */
  fileSha256?: string;
  line: number;
  column?: number;
  oldSelector: string;
  newSelector: string;
  confidence: number;
  strategy: string;
  requiresReview: boolean;
  /**
   * When heal is fed diagnostic findings, this cites the finding that triggered
   * the proposal. Absent when heal runs from pure file scanning.
   */
  triggeringFindingId?: string;
  /**
   * A frame boundary may explain the failure this proposal answers, and nothing links the
   * failing selector to a frame. The proposal is kept so the reviewer sees it, `requiresReview`
   * is forced, and `heal --apply` refuses it (slice S8).
   */
  frameCaveat?: HealingFrameCaveat;
}

export interface HealingProposalVerificationFailure {
  file: string;
  message: string;
}

export interface HealingProposalVerification {
  status: "pass" | "fail";
  proposalCount: number;
  checkedFileCount: number;
  failures: HealingProposalVerificationFailure[];
}

// ============================================
// EVIDENCE-BACKED HEALING HELPERS
// ============================================

/**
 * Extract selector-like strings from finding evidence.
 * Matches CSS selectors, data-testid attributes, and XPath fragments that appear
 * in orchestrator finding evidence arrays.
 */
function selectorAliases(selector: string): string[] {
  const aliases = new Set<string>([selector]);

  const testIdAttribute = selector.match(/^\[data-testid=(?:"([^"]+)"|'([^']+)')\]$/);
  const testId = testIdAttribute?.[1] ?? testIdAttribute?.[2];
  if (testId) {
    aliases.add(testId);
  }

  return [...aliases];
}

/**
 * Whether a finding may drive a selector rewrite.
 *
 * A classified finding qualifies only on `basis: "fault"`: `no_evidence` says the run learned
 * nothing, `contradiction` says the reply cannot be read at all, and `indeterminate` says a step
 * may already have changed the target. Rewriting a selector from any of those would be acting on
 * information the run does not have. An unclassified finding is legacy input and is accepted, so
 * receipts written before S4 still heal.
 */

function frameCandidatesOf(finding: HealingFinding | undefined) {
  return (finding?.frameRootCause?.candidates ?? []).map((candidate) => ({
    domIndex: candidate.domIndex,
    origin: candidate.origin,
    primaryTag: candidate.primaryTag,
  }));
}

/**
 * What a reviewer would have to do instead of a rewrite.
 *
 * The `frame.switch` suggestion is offered only for `confirmed`, because that is the only
 * determination that names a frame. Extension frame ids are per load, so the suggestion always
 * carries the origin as well and a consumer must re-diagnose before switching.
 */
function frameRefusalFor(
  selector: string,
  finding: HealingFinding | undefined,
  determination: string,
): HealingRefusal {
  const confirmed = finding?.frameRootCause?.confirmedCandidate ?? undefined;
  const reason =
    determination === "confirmed"
      ? `the target of '${selector}' is inside a frame a main-document selector cannot reach, so no CSS rewrite can succeed: the repair is a structural change to the step, not a substitution`
      : determination === "unavailable"
        ? `the frame diagnosis for '${selector}' was not taken, so nothing is known about whether a frame explains the failure`
        : `the frame diagnosis for '${selector}' could not be resolved (${finding?.frameRootCause?.determination.reason ?? "the inventory or the hint did not resolve"}), so there is no candidate list a reviewer could check`;
  return {
    ...(finding?.id ? { triggeringFindingId: finding.id } : {}),
    selector,
    reason,
    code: "heal_frame_refused",
    ...(confirmed
      ? {
          suggestion: {
            kind: "frame.switch" as const,
            ...(confirmed.domIndex === null ? {} : { index: confirmed.domIndex }),
            ...(confirmed.frameId === null || confirmed.frameId === undefined
              ? {}
              : { frameId: confirmed.frameId }),
            urlPrefix: confirmed.origin ?? "",
            hops: (confirmed.tags ?? []).includes("nested_frame") ? 2 : 1,
          },
        }
      : {}),
  };
}

/** The caveat a `suspected` determination attaches; the reviewer's checklist. */
function frameCaveatFor(finding: HealingFinding): HealingFrameCaveat {
  return {
    determination: "suspected",
    ...(finding.id ? { findingId: finding.id } : {}),
    reason:
      finding.frameRootCause?.determination.reason ??
      "a frame boundary may explain this failure and nothing links the failing selector to a frame",
    candidates: frameCandidatesOf(finding),
  };
}

function isHealableFinding(finding: HealingFinding): boolean {
  return finding.outcome === undefined || finding.outcome.basis === "fault";
}

function extractSelectorsFromEvidence(findings: HealingFinding[]): Map<string, string> {
  const selectorToFindingId = new Map<string, string>();

  for (const finding of findings.filter(isHealableFinding)) {
    for (const evidenceLine of finding.evidence) {
      // Match common selector patterns in evidence text
      const selectorPatterns = [
        /#[\w-]+/g, // #id
        /[.][\w-]+/g, // .class
        /\[data-testid=(?:"[^"]+"|'[^']+')\]/g, // [data-testid="..."] or [data-testid='...']
        /getByTestId\(['"]([^'"]+)['"]\)/g, // getByTestId('...')
        /locator\(['"]([^'"]+)['"]\)/g, // locator('...')
        /selector[:\s]+([\w#.-]+)/gi, // selector: #foo or selector .bar
      ];

      for (const pattern of selectorPatterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        // biome-ignore lint:suspicious/noAssignInExpressions: exec() requires assignment-in-condition loop pattern
        while ((match = pattern.exec(evidenceLine)) !== null) {
          const selector = match[1] ?? match[0];
          for (const alias of selectorAliases(selector)) {
            if (!selectorToFindingId.has(alias)) {
              selectorToFindingId.set(alias, finding.id);
            }
          }
        }
      }
    }
  }

  return selectorToFindingId;
}

/**
 * Find the first finding ID that references a given selector in its evidence.
 */
function findTriggeringFindingId(
  selector: string,
  selectorToFindingId: Map<string, string>,
): string | undefined {
  for (const alias of selectorAliases(selector)) {
    const findingId = selectorToFindingId.get(alias);
    if (findingId) {
      return findingId;
    }
  }
  return undefined;
}

// ============================================
// EXPORTS
// ============================================

export default SelfHealingEngine;
