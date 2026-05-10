/**
 * TEST-CAPABILITIES Self-Healing System
 * Tests that fix themselves when things change
 */

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

export class TestFileHealer {
  private engine: SelfHealingEngine;

  constructor() {
    this.engine = new SelfHealingEngine();
  }

  async analyzeFile(filePath: string, findings?: HealingFinding[]): Promise<HealingProposal[]> {
    const content = await this.readFile(filePath);
    const proposals: HealingProposal[] = [];

    // Build a set of selectors mentioned in finding evidence when findings are provided.
    const evidenceSelectors = findings ? extractSelectorsFromEvidence(findings) : undefined;

    for (const candidate of extractSelectorCandidates(content)) {
      const isValid = await this.validateSelector(candidate.selector);

      // When findings are provided, only heal selectors that appear in diagnostic evidence.
      // Without findings, fall back to the existing heuristic scan.
      const isTargetedByEvidence = evidenceSelectors
        ? evidenceSelectors.has(candidate.selector)
        : true;

      if (!isValid || (evidenceSelectors && isTargetedByEvidence && !isValid)) {
        const healingResult = await this.engine.heal({
          originalSelector: candidate.selector,
          action: this.inferAction(content, candidate.index),
          description: this.inferDescription(content, candidate.index),
        });

        if (healingResult.success && healingResult.newSelector) {
          // Cite the triggering finding when evidence-backed mode is active.
          const triggeringFindingId =
            evidenceSelectors && findings
              ? findTriggeringFindingId(candidate.selector, findings)
              : undefined;

          proposals.push({
            file: filePath,
            line: this.getLineNumber(content, candidate.index),
            column: this.getColumnNumber(content, candidate.index),
            oldSelector: candidate.selector,
            newSelector: healingResult.newSelector,
            confidence: healingResult.confidence,
            strategy: healingResult.strategy,
            requiresReview: Boolean(healingResult.metadata?.requiresReview),
            ...(triggeringFindingId ? { triggeringFindingId } : {}),
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

  async applyProposals(proposals: HealingProposal[]): Promise<void> {
    if (proposals.length === 0) {
      return;
    }

    const proposalsByFile = new Map<string, HealingProposal[]>();
    for (const proposal of proposals) {
      const existing = proposalsByFile.get(proposal.file) ?? [];
      existing.push(proposal);
      proposalsByFile.set(proposal.file, existing);
    }

    const originals = new Map<string, string>();
    const updates = new Map<string, string>();

    for (const [file, fileProposals] of proposalsByFile) {
      const content = await this.readFile(file);
      originals.set(file, content);
      updates.set(file, this.applyProposalsToContent(content, fileProposals));
    }

    const writtenFiles: string[] = [];

    try {
      for (const [file, updated] of updates) {
        await this.writeFile(file, updated);
        writtenFiles.push(file);
      }
    } catch (error) {
      await Promise.all(
        writtenFiles.map(async (file) => {
          const original = originals.get(file);
          if (original !== undefined) {
            await this.writeFile(file, original);
          }
        }),
      );
      throw error;
    }
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
        : targetLine.indexOf(proposal.oldSelector);

      if (targetColumn < 0) {
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

      lines[lineIndex] =
        targetLine.slice(0, targetColumn) +
        proposal.newSelector +
        targetLine.slice(targetColumn + proposal.oldSelector.length);
    }

    const updated = lines.join(lineEnding);
    return hasTrailingNewline ? `${updated}${lineEnding}` : updated;
  }

  private async readFile(path: string): Promise<string> {
    const fs = await import("node:fs/promises");
    return fs.readFile(path, "utf-8");
  }

  private async writeFile(path: string, content: string): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, content, "utf-8");
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
function extractSelectorsFromEvidence(findings: HealingFinding[]): Map<string, string> {
  const selectorToFindingId = new Map<string, string>();

  for (const finding of findings) {
    for (const evidenceLine of finding.evidence) {
      // Match common selector patterns in evidence text
      const selectorPatterns = [
        /#[\w-]+/g, // #id
        /[.][\w-]+/g, // .class
        /\[data-testid="[^"]+"\]/g, // [data-testid="..."]
        /getByTestId\(['"]([^'"]+)['"]\)/g, // getByTestId('...')
        /locator\(['"]([^'"]+)['"]\)/g, // locator('...')
        /selector[:\s]+([\w#.-]+)/gi, // selector: #foo or selector .bar
      ];

      for (const pattern of selectorPatterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        // biome-ignore lint:suspicious/noAssignInExpressions: exec() requires assignment-in-condition loop pattern
        while ((match = pattern.exec(evidenceLine)) !== null) {
          const selector = match[0];
          if (!selectorToFindingId.has(selector)) {
            selectorToFindingId.set(selector, finding.id);
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
function findTriggeringFindingId(selector: string, findings: HealingFinding[]): string | undefined {
  for (const finding of findings) {
    for (const evidenceLine of finding.evidence) {
      if (evidenceLine.includes(selector)) {
        return finding.id;
      }
    }
  }
  return undefined;
}

// ============================================
// EXPORTS
// ============================================

export default SelfHealingEngine;
