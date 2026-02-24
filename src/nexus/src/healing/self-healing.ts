/**
 * NEXUS Self-Healing System
 * Tests that fix themselves when things change
 */

// ============================================
// TYPES
// ============================================

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

export class SelfHealingEngine {
  private strategies: HealingStrategy[] = [];

  constructor() {
    this.registerDefaultStrategies();
  }

  private registerDefaultStrategies(): void {
    // Strategy 1: Test ID fallback
    this.register({
      name: "testid-fallback",
      priority: 10,
      execute: async (ctx) => {
        const testIdMatch = ctx.originalSelector.match(/data-testid="([^"]+)"/);
        if (testIdMatch) {
          return {
            success: true,
            newSelector: `[data-testid="${testIdMatch[1]}"]`,
            confidence: 0.95,
            strategy: "testid-fallback",
          };
        }
        return { success: false, confidence: 0, strategy: "testid-fallback" };
      },
    });

    // Strategy 2: Role-based fallback
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
          // Would integrate with vision AI (GPT-4V, Claude Vision, etc.)
          // For now, return a simulated result
          return {
            success: true,
            newSelector: `// AI-detected: ${ctx.description}`,
            confidence: 0.65,
            strategy: "vision-ai",
            metadata: { requiresReview: true },
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
          // Would search for elements near the last known position
          return {
            success: true,
            newSelector: `// Nearby element search placeholder`,
            confidence: 0.5,
            strategy: "nearby-search",
            metadata: { requiresReview: true },
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

    // Return best attempt even if below threshold
    const best = attempts.reduce(
      (best, curr) => (curr.confidence > best.confidence ? curr : best),
      { success: false, confidence: 0, strategy: "none" },
    );

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

  async analyzeFile(filePath: string): Promise<HealingProposal[]> {
    const content = await this.readFile(filePath);
    const proposals: HealingProposal[] = [];

    // Extract selectors from test file
    const selectorPattern =
      /(?:getByRole|getByTestId|getByText|locator|click|fill)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let match: RegExpExecArray | null = selectorPattern.exec(content);

    while (match !== null) {
      const selector = match[1];
      const isValid = await this.validateSelector(selector);

      if (!isValid) {
        const healingResult = await this.engine.heal({
          originalSelector: selector,
          action: this.inferAction(content, match.index),
          description: this.inferDescription(content, match.index),
        });

        if (healingResult.success && healingResult.newSelector) {
          proposals.push({
            file: filePath,
            line: this.getLineNumber(content, match.index),
            oldSelector: selector,
            newSelector: healingResult.newSelector,
            confidence: healingResult.confidence,
            strategy: healingResult.strategy,
            requiresReview: healingResult.metadata?.requiresReview as boolean,
          });
        }
      }
      match = selectorPattern.exec(content);
    }

    return proposals;
  }

  async applyProposal(proposal: HealingProposal): Promise<void> {
    const content = await this.readFile(proposal.file);
    const updated = content.replace(proposal.oldSelector, proposal.newSelector);
    await this.writeFile(proposal.file, updated);
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
    // Would run actual validation against the application
    // For now, simulate based on heuristics
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
}

export interface HealingProposal {
  file: string;
  line: number;
  oldSelector: string;
  newSelector: string;
  confidence: number;
  strategy: string;
  requiresReview: boolean;
}

// ============================================
// EXPORTS
// ============================================

export default SelfHealingEngine;
