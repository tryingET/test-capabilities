/**
 * TEST-CAPABILITIES Quantum Test Simulator
 * Run ALL possible test paths simultaneously
 */

import { randomUUID } from "node:crypto";

// ============================================
// TYPES
// ============================================

export interface QuantumConfig {
  branches: number;
  collapseStrategy: "significance" | "diversity" | "coverage";
  maxDepth: number;
  timeout: number;
  seed?: number;
}

export interface QuantumBranch {
  id: string;
  seed: number;
  path: QuantumAction[];
  state: QuantumState;
  discoveries: Discovery[];
  terminated: boolean;
  terminationReason?: string;
}

export interface QuantumAction {
  type: "click" | "type" | "scroll" | "navigate" | "wait" | "custom";
  target: string;
  value?: string;
  timestamp: number;
}

export interface QuantumState {
  url: string;
  elements: string[];
  forms: string[];
  errors: string[];
  network: NetworkState;
  performance: PerformanceState;
}

export interface NetworkState {
  requestCount: number;
  errorCount: number;
  avgLatency: number;
  slowRequests: string[];
}

export interface PerformanceState {
  tti: number;
  fcp: number;
  lcp: number;
  cls: number;
}

export interface Discovery {
  type: "bug" | "edge_case" | "rare_path" | "performance_issue" | "ux_issue";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  reproduction: QuantumAction[];
  probability: number;
  evidence: string[];
}

export interface QuantumResult {
  branchesSimulated: number;
  uniquePaths: number;
  collapsedFindings: Discovery[];
  edgeCases: Discovery[];
  rareBugs: Discovery[];
  coverage: QuantumCoverage;
  duration: number;
}

export interface QuantumCoverage {
  elements: number;
  paths: number;
  states: number;
  transitions: number;
}

// ============================================
// QUANTUM SIMULATOR
// ============================================

export class QuantumSimulator {
  private config: QuantumConfig;
  private branches: QuantumBranch[] = [];
  private discoveries: Discovery[] = [];
  private pathSet: Set<string> = new Set();

  constructor(config: Partial<QuantumConfig> = {}) {
    this.config = {
      branches: 100,
      collapseStrategy: "significance",
      maxDepth: 20,
      timeout: 60000,
      seed: Date.now(),
      ...config,
    };
  }

  async simulate(initialState: QuantumState): Promise<QuantumResult> {
    const startTime = Date.now();
    const deadline = startTime + this.config.timeout;
    let branchesSimulated = 0;

    this.branches = [];
    this.discoveries = [];
    this.pathSet = new Set();

    // Initialize parallel universes
    this.initializeBranches(initialState);

    // Simulate each branch deterministically
    for (const branch of this.branches) {
      if (Date.now() >= deadline) {
        branch.terminated = true;
        branch.terminationReason = "timeout";
        break;
      }
      branchesSimulated += 1;
      await this.simulateBranch(branch, deadline);
    }

    // Collapse the wave function
    const collapsedFindings = this.collapseWaveform();
    const edgeCases = this.uniqueDiscoveries(
      this.discoveries.filter((discovery) => discovery.type === "edge_case"),
    );
    const rareBugs = this.uniqueDiscoveries(
      this.discoveries.filter(
        (discovery) => discovery.type === "bug" && discovery.probability < 0.01,
      ),
    );

    // Calculate coverage
    const coverage = this.calculateCoverage();

    return {
      branchesSimulated,
      uniquePaths: this.pathSet.size,
      collapsedFindings,
      edgeCases,
      rareBugs,
      coverage,
      duration: Date.now() - startTime,
    };
  }

  private initializeBranches(initialState: QuantumState): void {
    const baseSeed = this.config.seed ?? Date.now();
    for (let i = 0; i < this.config.branches; i++) {
      this.branches.push({
        id: randomUUID(),
        seed: baseSeed + i,
        path: [],
        state: this.cloneState(initialState),
        discoveries: [],
        terminated: false,
      });
    }
  }

  private async simulateBranch(branch: QuantumBranch, deadline: number): Promise<void> {
    const random = this.seededRandom(branch.seed);

    for (let depth = 0; depth < this.config.maxDepth; depth++) {
      if (branch.terminated) break;
      if (Date.now() >= deadline) {
        branch.terminated = true;
        branch.terminationReason = "timeout";
        break;
      }

      // Choose action based on quantum probability
      const action = this.chooseAction(branch, random, depth);
      branch.path.push(action);

      // Simulate action
      const newState = await this.applyAction(branch.state, action, random);
      branch.state = newState;

      // Check for discoveries
      const discoveries = this.analyzeForDiscoveries(branch);
      branch.discoveries.push(...discoveries);
      this.discoveries.push(...discoveries);

      // Record path
      const pathKey = this.pathToKey(branch.path);
      this.pathSet.add(pathKey);

      // Check termination conditions
      if (this.shouldTerminate(branch)) {
        branch.terminated = true;
        branch.terminationReason = "natural_end";
      }
    }
  }

  private seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  private cloneState(state: QuantumState): QuantumState {
    return {
      ...state,
      elements: [...state.elements],
      forms: [...state.forms],
      errors: [...state.errors],
      network: {
        ...state.network,
        slowRequests: [...state.network.slowRequests],
      },
      performance: {
        ...state.performance,
      },
    };
  }

  private chooseAction(
    branch: QuantumBranch,
    random: () => number,
    stepIndex: number,
  ): QuantumAction {
    const actionTypes: QuantumAction["type"][] = ["click", "type", "scroll", "navigate", "wait"];
    const weights = [0.4, 0.3, 0.1, 0.1, 0.1]; // Click and type are most common

    // Weighted random selection
    const r = random();
    let cumulative = 0;
    let selectedType = "click";

    for (let i = 0; i < actionTypes.length; i++) {
      cumulative += weights[i];
      if (r <= cumulative) {
        selectedType = actionTypes[i];
        break;
      }
    }

    // Choose target based on current state
    const target = this.chooseTarget(branch.state, selectedType, random);
    const value = selectedType === "type" ? this.generateRandomInput(random) : undefined;

    return {
      type: selectedType as QuantumAction["type"],
      target,
      value,
      timestamp: stepIndex,
    };
  }

  private chooseTarget(state: QuantumState, actionType: string, random: () => number): string {
    switch (actionType) {
      case "click": {
        const clickTargets = state.elements.filter((element) => !element.includes("static"));
        if (clickTargets.length === 0) {
          return "body";
        }
        return clickTargets[Math.floor(random() * clickTargets.length)];
      }
      case "navigate": {
        const navigationTargets = this.deriveNavigationTargets(state);
        return navigationTargets[Math.floor(random() * navigationTargets.length)] ?? state.url;
      }
      default:
        if (state.elements.length === 0) {
          return "body";
        }
        return state.elements[Math.floor(random() * state.elements.length)];
    }
  }

  private deriveNavigationTargets(state: QuantumState): string[] {
    const candidates = new Set<string>();

    if (/^https?:\/\//.test(state.url)) {
      candidates.add(state.url);
    }

    let baseUrl: URL | undefined;
    try {
      baseUrl = new URL(state.url);
    } catch {
      baseUrl = undefined;
    }

    for (const element of state.elements) {
      if (/^https?:\/\//.test(element)) {
        candidates.add(element);
        continue;
      }

      if (!baseUrl) {
        continue;
      }

      if (element.startsWith("/")) {
        candidates.add(new URL(element, baseUrl).toString());
        continue;
      }

      if (element.startsWith("a.")) {
        const slug = element
          .slice(2)
          .trim()
          .replace(/[^a-zA-Z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "");

        if (slug.length > 0) {
          candidates.add(new URL(`/${slug}`, baseUrl).toString());
        }
      }
    }

    return [...candidates];
  }

  private generateRandomInput(random: () => number): string {
    const types = ["email", "text", "number", "password", "search"];
    const type = types[Math.floor(random() * types.length)];

    switch (type) {
      case "email":
        return `test${Math.floor(random() * 10000)}@example.com`;
      case "number":
        return String(Math.floor(random() * 1000));
      case "password":
        return "TestP@ss123!";
      case "search":
        return ["test", "query", "search", "find"][Math.floor(random() * 4)];
      default:
        return "test input";
    }
  }

  private async applyAction(
    state: QuantumState,
    action: QuantumAction,
    random: () => number,
  ): Promise<QuantumState> {
    // Simulate state transition
    const newState = this.cloneState(state);

    switch (action.type) {
      case "click":
        // Simulate potential navigation or state change
        newState.network.requestCount += Math.floor(random() * 5);
        break;
      case "type":
        // Form input
        break;
      case "navigate":
        newState.url = action.target;
        newState.network.requestCount += 1;
        break;
      case "scroll": {
        // Maybe reveal new elements
        const generatedElement = `new-element-${action.timestamp}-${newState.elements.length}`;
        newState.elements = [...newState.elements, generatedElement];
        break;
      }
    }

    // Simulate occasional errors
    if (random() < 0.02) {
      newState.errors.push(`Simulated error on ${action.type}`);
    }

    return newState;
  }

  private analyzeForDiscoveries(branch: QuantumBranch): Discovery[] {
    const discoveries: Discovery[] = [];
    const state = branch.state;
    const latestAction = branch.path[branch.path.length - 1];

    // Check for error patterns
    if (state.errors.length > 0) {
      const latestError = state.errors[state.errors.length - 1];
      const description = `Error detected: ${latestError}`;
      const alreadyRecorded = branch.discoveries.some(
        (discovery) => discovery.type === "bug" && discovery.description === description,
      );

      if (!alreadyRecorded) {
        discoveries.push({
          type: "bug",
          severity: latestError.includes("critical") ? "critical" : "high",
          description,
          reproduction: [...branch.path],
          probability: this.calculateProbability(branch),
          evidence: state.errors,
        });
      }
    }

    // Check for performance issues
    if (state.network.avgLatency > 1000) {
      discoveries.push({
        type: "performance_issue",
        severity: state.network.avgLatency > 2000 ? "critical" : "high",
        description: "High network latency detected",
        reproduction: [...branch.path],
        probability: this.calculateProbability(branch),
        evidence: [`avg latency: ${state.network.avgLatency}ms`],
      });
    }

    if (
      latestAction?.type === "type" &&
      !/^(input|textarea|select)(?:[.#[].*)?$/.test(latestAction.target)
    ) {
      const description = `Input targeted a non-form element: ${latestAction.target}`;
      const alreadyRecorded = branch.discoveries.some(
        (discovery) => discovery.type === "edge_case" && discovery.description === description,
      );

      if (!alreadyRecorded) {
        discoveries.push({
          type: "edge_case",
          severity: "medium",
          description,
          reproduction: [...branch.path],
          probability: this.calculateProbability(branch),
          evidence: [latestAction.target, latestAction.type],
        });
      }
    }

    if (latestAction?.type === "navigate" && !/^https?:\/\//.test(latestAction.target)) {
      const description = `Navigation targeted a non-URL surface: ${latestAction.target}`;
      const alreadyRecorded = branch.discoveries.some(
        (discovery) => discovery.type === "edge_case" && discovery.description === description,
      );

      if (!alreadyRecorded) {
        discoveries.push({
          type: "edge_case",
          severity: "medium",
          description,
          reproduction: [...branch.path],
          probability: this.calculateProbability(branch),
          evidence: [latestAction.target],
        });
      }
    }

    // Check for rare paths
    const pathKey = this.pathToKey(branch.path);
    const isUnique = !this.pathSet.has(pathKey);
    if (isUnique && branch.path.length > 5) {
      discoveries.push({
        type: "rare_path",
        severity: "low",
        description: "Unique navigation path discovered",
        reproduction: [...branch.path],
        probability: this.calculateProbability(branch),
        evidence: branch.path.map((p) => p.type),
      });
    }

    return discoveries;
  }

  private calculateProbability(branch: QuantumBranch): number {
    // More unique paths = lower probability
    const pathUniqueness = 1 / (this.pathSet.size + 1);
    const depthFactor = 1 / (branch.path.length + 1);
    return pathUniqueness * depthFactor * 0.1;
  }

  private shouldTerminate(branch: QuantumBranch): boolean {
    // Terminate on critical errors
    if (branch.state.errors.some((e) => e.includes("critical"))) {
      return true;
    }

    // Terminate only on repeated navigation loops, not on repeated clicks/types against the same element.
    const recentNavigations = branch.path
      .filter((action) => action.type === "navigate")
      .slice(-10)
      .map((action) => action.target);
    if (recentNavigations.length === 10 && new Set(recentNavigations).size < 3) {
      return true;
    }

    return false;
  }

  private pathToKey(path: QuantumAction[]): string {
    return path.map((a) => `${a.type}:${a.target}`).join(">");
  }

  private discoveryKey(discovery: Discovery): string {
    return `${discovery.type}:${discovery.severity}:${discovery.description}`;
  }

  private uniqueDiscoveries(discoveries: Discovery[]): Discovery[] {
    const unique: Discovery[] = [];
    const seen = new Set<string>();

    for (const discovery of discoveries) {
      const key = this.discoveryKey(discovery);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(discovery);
      }
    }

    return unique;
  }

  private collapseWaveform(): Discovery[] {
    const collapsed: Discovery[] = [];
    const seen = new Set<string>();

    // Sort discoveries by significance
    const sorted = [...this.discoveries].sort((a, b) => {
      const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      const aWeight = severityWeight[a.severity];
      const bWeight = severityWeight[b.severity];
      return bWeight - aWeight;
    });

    // Collapse to unique findings
    for (const discovery of sorted) {
      const key = `${discovery.type}:${discovery.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        collapsed.push(discovery);
      }
    }

    // Apply collapse strategy
    switch (this.config.collapseStrategy) {
      case "significance":
        return collapsed.filter((d) => d.severity === "high" || d.severity === "critical");
      case "diversity":
        return this.selectDiverse(collapsed);
      case "coverage":
        return this.selectForCoverage(collapsed);
      default:
        return collapsed.slice(0, 50);
    }
  }

  private selectDiverse(discoveries: Discovery[]): Discovery[] {
    const selected: Discovery[] = [];
    const types = new Set<Discovery["type"]>();

    for (const d of discoveries) {
      if (!types.has(d.type)) {
        types.add(d.type);
        selected.push(d);
      }
    }

    return selected;
  }

  private selectForCoverage(discoveries: Discovery[]): Discovery[] {
    // Select discoveries that maximize path coverage
    const coveredElements = new Set<string>();
    const selected: Discovery[] = [];

    for (const d of discoveries) {
      const elements = d.reproduction.map((a) => a.target);
      const newElements = elements.filter((e) => !coveredElements.has(e));

      if (newElements.length > 0) {
        for (const e of newElements) {
          coveredElements.add(e);
        }
        selected.push(d);
      }
    }

    return selected;
  }

  private calculateCoverage(): QuantumCoverage {
    const elements = new Set<string>();
    const transitions = new Set<string>();

    for (const branch of this.branches) {
      for (const action of branch.path) {
        elements.add(action.target);
      }
      for (let i = 1; i < branch.path.length; i++) {
        transitions.add(`${branch.path[i - 1].target}>${branch.path[i].target}`);
      }
    }

    return {
      elements: elements.size,
      paths: this.pathSet.size,
      states: new Set(this.branches.map((b) => b.state.url)).size,
      transitions: transitions.size,
    };
  }
}

// ============================================
// QUANTUM TEST RUNNER
// ============================================

export class QuantumTestRunner {
  private simulator: QuantumSimulator;

  constructor(config: Partial<QuantumConfig> = {}) {
    this.simulator = new QuantumSimulator(config);
  }

  async run(target: string): Promise<QuantumResult> {
    // Initial state (would be fetched from actual app)
    const initialState: QuantumState = {
      url: target,
      elements: [
        "button.login",
        "button.signup",
        "input.email",
        "input.password",
        "a.about",
        "a.contact",
        "div.content",
      ],
      forms: ["login-form", "signup-form"],
      errors: [],
      network: {
        requestCount: 0,
        errorCount: 0,
        avgLatency: 100,
        slowRequests: [],
      },
      performance: {
        tti: 1500,
        fcp: 800,
        lcp: 1200,
        cls: 0.05,
      },
    };

    return this.simulator.simulate(initialState);
  }
}

// ============================================
// EXPORTS
// ============================================

export default QuantumSimulator;
