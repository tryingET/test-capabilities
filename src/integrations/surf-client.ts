/**
 * TEST-CAPABILITIES Surf-CLI Integration
 * Advanced browser testing powered by surf-cli
 */

import { spawn } from "node:child_process";

// ============================================
// TYPES
// ============================================

export interface SurfConfig {
  socketPath?: string;
  autoScreenshot?: boolean;
  screenshotResize?: number;
  networkCapture?: boolean;
  networkPath?: string;
}

export interface SurfElement {
  ref: string;
  role?: string;
  name?: string;
  text?: string;
  level?: number;
  selector?: string;
}

export interface SurfSnapshot {
  url: string;
  title: string;
  elements: SurfElement[];
  raw: string;
}

export interface SurfActionResult {
  success: boolean;
  screenshot?: string;
  message?: string;
  error?: string;
}

export interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  status: number;
  type: string;
  duration: number;
  request?: unknown;
  response?: unknown;
}

// ============================================
// SURF CLIENT
// ============================================

export class SurfClient {
  private config: SurfConfig;

  constructor(config: SurfConfig = {}) {
    this.config = {
      socketPath: "/tmp/surf.sock",
      autoScreenshot: true,
      screenshotResize: 1200,
      networkCapture: true,
      ...config,
    };
  }

  // ============================================
  // NAVIGATION
  // ============================================

  async goto(url: string): Promise<SurfActionResult> {
    const result = await this.run("go", [url]);
    return this.attachScreenshotIfEnabled(result);
  }

  async back(): Promise<SurfActionResult> {
    return this.run("back", []);
  }

  async forward(): Promise<SurfActionResult> {
    return this.run("forward", []);
  }

  async reload(hard: boolean = false): Promise<SurfActionResult> {
    const args = hard ? ["--hard"] : [];
    return this.run("tab.reload", args);
  }

  // ============================================
  // READING
  // ============================================

  async read(options: { depth?: number; compact?: boolean } = {}): Promise<SurfSnapshot> {
    const args: string[] = [];
    if (options.depth) args.push("--depth", String(options.depth));
    if (options.compact) args.push("--compact");

    const result = await this.run("read", args);

    return this.parseSnapshot(result.message || "");
  }

  async snapshot(): Promise<SurfSnapshot> {
    return this.read();
  }

  async pageState(): Promise<{
    modals: string[];
    loading: boolean;
    scrollPosition: { x: number; y: number };
  }> {
    const result = await this.run("page.state", []);
    return JSON.parse(result.message || "{}");
  }

  async pageText(): Promise<string> {
    const result = await this.run("page.text", []);
    return result.message || "";
  }

  private parseSnapshot(raw: string): SurfSnapshot {
    const lines = raw.split("\n");
    const elements: SurfElement[] = [];
    let url = "";
    let title = "";

    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();

      if (trimmed.startsWith("✓")) {
        title = trimmed.replace(/^✓\s*/, "").trim();
        const nextLine = lines[index + 1]?.trim();
        if (nextLine?.startsWith("http://") || nextLine?.startsWith("https://")) {
          url = nextLine;
        }
        continue;
      }

      if (!url && (trimmed.startsWith("http://") || trimmed.startsWith("https://"))) {
        url = trimmed;
        continue;
      }

      const refMatch = trimmed.match(/\[ref=(e\d+)\]/);
      if (refMatch) {
        const ref = refMatch[1];
        const roleMatch = trimmed.match(/(\w+)\s+\[/);
        const nameMatch = trimmed.match(/name="([^"]+)"/);
        const textMatch = trimmed.match(/:\s*(.+)$/);

        elements.push({
          ref,
          role: roleMatch?.[1],
          name: nameMatch?.[1],
          text: textMatch?.[1]?.trim(),
        });
      }
    }

    return { url, title, elements, raw };
  }

  // ============================================
  // INTERACTION
  // ============================================

  async click(ref: string): Promise<SurfActionResult>;
  async click(selector: string): Promise<SurfActionResult>;
  async click(x: number, y: number): Promise<SurfActionResult>;
  async click(refOrSelectorOrX: string | number, y?: number): Promise<SurfActionResult> {
    let args: string[];

    if (typeof refOrSelectorOrX === "string") {
      if (refOrSelectorOrX.startsWith("e")) {
        args = [refOrSelectorOrX];
      } else if (
        refOrSelectorOrX.startsWith(".") ||
        refOrSelectorOrX.startsWith("#") ||
        refOrSelectorOrX.startsWith("[")
      ) {
        args = ["--selector", refOrSelectorOrX];
      } else {
        args = [refOrSelectorOrX];
      }
    } else {
      args = [String(refOrSelectorOrX), String(y)];
    }

    const result = await this.run("click", args);
    return this.attachScreenshotIfEnabled(result);
  }

  async type(
    text: string,
    options: { ref?: string; selector?: string; submit?: boolean } = {},
  ): Promise<SurfActionResult> {
    const args: string[] = [text];
    if (options.ref) args.push("--ref", options.ref);
    if (options.selector) args.push("--selector", options.selector);
    if (options.submit) args.push("--submit");

    const result = await this.run("type", args);
    return this.attachScreenshotIfEnabled(result);
  }

  async press(key: string): Promise<SurfActionResult> {
    const result = await this.run("key", [key]);
    return this.attachScreenshotIfEnabled(result);
  }

  async scroll(
    direction: "up" | "down" | "left" | "right",
    pixels?: number,
  ): Promise<SurfActionResult> {
    const args: string[] = [direction];
    if (pixels) args.push(String(pixels));

    const result = await this.run(`scroll.${direction}`, args);
    return this.attachScreenshotIfEnabled(result);
  }

  async select(
    ref: string,
    value: string,
    options: { byLabel?: boolean; byIndex?: boolean } = {},
  ): Promise<SurfActionResult> {
    const args: string[] = [ref, value];
    if (options.byLabel) args.push("--by", "label");
    if (options.byIndex) args.push("--by", "index");

    return this.run("select", args);
  }

  // ============================================
  // SEMANTIC LOCATORS
  // ============================================

  async locateByRole(
    role: string,
    options: { name?: string; action?: "click" | "fill"; value?: string } = {},
  ): Promise<SurfActionResult> {
    const args: string[] = [role];
    if (options.name) args.push("--name", options.name);
    if (options.action) args.push("--action", options.action);
    if (options.value) args.push("--value", options.value);

    return this.run("locate.role", args);
  }

  async locateByText(
    text: string,
    options: { exact?: boolean; action?: "click" } = {},
  ): Promise<SurfActionResult> {
    const args: string[] = [text];
    if (options.exact) args.push("--exact");
    if (options.action) args.push("--action", options.action);

    return this.run("locate.text", args);
  }

  async locateByLabel(
    label: string,
    options: { action?: "fill"; value?: string } = {},
  ): Promise<SurfActionResult> {
    const args: string[] = [label];
    if (options.action) args.push("--action", options.action);
    if (options.value) args.push("--value", options.value);

    return this.run("locate.label", args);
  }

  // ============================================
  // SCREENSHOTS
  // ============================================

  async screenshot(
    options: { output?: string; full?: boolean; annotate?: boolean; fullpage?: boolean } = {},
  ): Promise<SurfActionResult> {
    const args: string[] = [];
    if (options.output) args.push("--output", options.output);
    if (options.full) args.push("--full");
    if (options.annotate) args.push("--annotate");
    if (options.fullpage) args.push("--fullpage");

    return this.run("screenshot", args);
  }

  async snap(): Promise<SurfActionResult> {
    return this.screenshot();
  }

  // ============================================
  // TABS & WINDOWS
  // ============================================

  async listTabs(): Promise<Array<{ id: number; title: string; url: string }>> {
    const result = await this.run("tab.list", [], true);
    return this.parseTabList(result);
  }

  async newTab(url: string): Promise<{ tabId: number; windowId: number }> {
    const result = await this.run("tab.new", [url], true);
    return JSON.parse(result.message || "{}");
  }

  async switchTab(id: number | string): Promise<SurfActionResult> {
    return this.run("tab.switch", [String(id)]);
  }

  async closeTab(id: number): Promise<SurfActionResult> {
    return this.run("tab.close", [String(id)]);
  }

  async newWindow(url: string): Promise<{ windowId: number; tabId: number }> {
    const result = await this.run("window.new", [url], true);
    return JSON.parse(result.message || "{}");
  }

  async listWindows(): Promise<Array<{ id: number; tabs: number[] }>> {
    const result = await this.run("window.list", [], true);
    return JSON.parse(result.message || "[]");
  }

  async closeWindow(id: number): Promise<SurfActionResult> {
    return this.run("window.close", [String(id)]);
  }

  // ============================================
  // NETWORK
  // ============================================

  async getNetwork(
    options: {
      origin?: string;
      method?: string;
      type?: string;
      status?: string;
      since?: string;
    } = {},
  ): Promise<NetworkRequest[]> {
    const args: string[] = [];
    if (options.origin) args.push("--origin", options.origin);
    if (options.method) args.push("--method", options.method);
    if (options.type) args.push("--type", options.type);
    if (options.status) args.push("--status", options.status);
    if (options.since) args.push("--since", options.since);

    const result = await this.run("network", args, true);
    return this.parseNetworkLog(result.message || "");
  }

  async getNetworkRequest(id: string): Promise<NetworkRequest | null> {
    const result = await this.run("network.get", [id], true);
    return JSON.parse(result.message || "null");
  }

  async getNetworkBody(id: string): Promise<string> {
    const result = await this.run("network.body", [id]);
    return result.message || "";
  }

  async clearNetwork(): Promise<void> {
    await this.run("network.clear", []);
  }

  async getNetworkStats(): Promise<{ requests: number; size: string }> {
    const result = await this.run("network.stats", [], true);
    return JSON.parse(result.message || '{"requests":0,"size":"0"}');
  }

  // ============================================
  // AI QUERIES (NO API KEYS)
  // ============================================

  async queryChatGPT(
    prompt: string,
    options: { withPage?: boolean; model?: string } = {},
  ): Promise<string> {
    const args: string[] = [prompt];
    if (options.withPage) args.push("--with-page");
    if (options.model) args.push("--model", options.model);

    const result = await this.run("chatgpt", args);
    return result.message || "";
  }

  async queryGemini(
    prompt: string,
    options: { withPage?: boolean; model?: string; generateImage?: string } = {},
  ): Promise<string> {
    const args: string[] = [prompt];
    if (options.withPage) args.push("--with-page");
    if (options.model) args.push("--model", options.model);
    if (options.generateImage) args.push("--generate-image", options.generateImage);

    const result = await this.run("gemini", args);
    return result.message || "";
  }

  async queryPerplexity(
    prompt: string,
    options: { withPage?: boolean; mode?: "search" | "research" } = {},
  ): Promise<string> {
    const args: string[] = [prompt];
    if (options.withPage) args.push("--with-page");
    if (options.mode) args.push("--mode", options.mode);

    const result = await this.run("perplexity", args);
    return result.message || "";
  }

  async queryGrok(
    prompt: string,
    options: { withPage?: boolean; deepSearch?: boolean; model?: string } = {},
  ): Promise<string> {
    const args: string[] = [prompt];
    if (options.withPage) args.push("--with-page");
    if (options.deepSearch) args.push("--deep-search");
    if (options.model) args.push("--model", options.model);

    const result = await this.run("grok", args);
    return result.message || "";
  }

  // ============================================
  // WORKFLOWS
  // ============================================

  async workflow(steps: string[]): Promise<SurfActionResult> {
    const workflow = steps.join(" | ");
    return this.run("do", [workflow]);
  }

  async workflowFromFile(
    file: string,
    args: Record<string, string> = {},
  ): Promise<SurfActionResult> {
    const cmdArgs = ["--file", file];
    for (const [key, value] of Object.entries(args)) {
      cmdArgs.push(`--${key}`, value);
    }
    return this.run("do", cmdArgs);
  }

  // ============================================
  // DEVICE EMULATION
  // ============================================

  async emulateDevice(device: string): Promise<SurfActionResult> {
    return this.run("emulate.device", [device]);
  }

  async emulateViewport(width: number, height: number, scale?: number): Promise<SurfActionResult> {
    const args = ["--width", String(width), "--height", String(height)];
    if (scale) args.push("--scale", String(scale));
    return this.run("emulate.viewport", args);
  }

  async resetDevice(): Promise<SurfActionResult> {
    return this.run("emulate.device", ["reset"]);
  }

  // ============================================
  // WAITING
  // ============================================

  async wait(duration: number): Promise<void>;
  async wait(options: { element?: string; network?: boolean; url?: string }): Promise<void>;
  async wait(
    durationOrOptions: number | { element?: string; network?: boolean; url?: string },
  ): Promise<void> {
    if (typeof durationOrOptions === "number") {
      await this.run("wait", [String(durationOrOptions)]);
    } else {
      const args: string[] = [];
      if (durationOrOptions.element) args.push("--element", durationOrOptions.element);
      if (durationOrOptions.network) args.push("--network");
      if (durationOrOptions.url) args.push("--url", durationOrOptions.url);
      await this.run("wait", args);
    }
  }

  // ============================================
  // JAVASCRIPT EXECUTION
  // ============================================

  async evaluate<T>(code: string): Promise<T> {
    const result = await this.run("js", [code], true);
    return JSON.parse(result.message || "null");
  }

  // ============================================
  // CONSOLE
  // ============================================

  async getConsole(): Promise<Array<{ type: string; message: string }>> {
    const result = await this.run("console", [], true);
    return JSON.parse(result.message || "[]");
  }

  // ============================================
  // COOKIES
  // ============================================

  async getCookies(): Promise<Array<{ name: string; value: string; domain: string }>> {
    const result = await this.run("cookie.list", [], true);
    return JSON.parse(result.message || "[]");
  }

  // ============================================
  // IFrames
  // ============================================

  async listFrames(): Promise<Array<{ index: number; name?: string; selector?: string }>> {
    const result = await this.run("frame.list", [], true);
    return JSON.parse(result.message || "[]");
  }

  async switchFrame(options: {
    index?: number;
    name?: string;
    selector?: string;
  }): Promise<SurfActionResult> {
    const args: string[] = [];
    if (options.index !== undefined) args.push("--index", String(options.index));
    if (options.name) args.push("--name", options.name);
    if (options.selector) args.push("--selector", options.selector);
    return this.run("frame.switch", args);
  }

  async switchToMain(): Promise<SurfActionResult> {
    return this.run("frame.main", []);
  }

  // ============================================
  // LOW-LEVEL EXECUTION
  // ============================================

  private async attachScreenshotIfEnabled(result: SurfActionResult): Promise<SurfActionResult> {
    if (!this.config.autoScreenshot) {
      return result;
    }

    try {
      const screenshot = await this.screenshot();
      return {
        ...result,
        screenshot: screenshot.screenshot ?? result.screenshot,
      };
    } catch (error) {
      return {
        ...result,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async run(
    command: string,
    args: string[] = [],
    _json: boolean = false,
  ): Promise<SurfActionResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn("surf", [command, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data;
      });
      proc.stderr.on("data", (data) => {
        stderr += data;
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve({
            success: true,
            message: stdout.trim(),
            screenshot: this.extractScreenshotPath(stdout),
          });
          return;
        }

        reject(new Error((stderr || stdout).trim() || `surf ${command} exited with code ${code}`));
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to run surf ${command}: ${err.message}`));
      });
    });
  }

  private extractScreenshotPath(output: string): string | undefined {
    const match = output.match(/screenshot saved to:\s*(\/\S+)/i);
    return match?.[1];
  }

  private parseTabList(
    result: SurfActionResult,
  ): Array<{ id: number; title: string; url: string }> {
    if (!result.message) return [];

    return result.message.split("\n").flatMap((line) => {
      const match = line.match(/^\s*│?\s*(\d+)\s*│\s*(.*?)\s*│\s*(.*?)\s*│?\s*$/);
      if (!match) {
        return [];
      }

      return [
        {
          id: parseInt(match[1], 10),
          title: match[2],
          url: match[3],
        },
      ];
    });
  }

  private parseNetworkLog(output: string): NetworkRequest[] {
    if (!output) return [];
    try {
      return JSON.parse(output);
    } catch {
      return [];
    }
  }
}

// ============================================
// FLOW BUILDER
// ============================================

export class SurfFlowBuilder {
  private client: SurfClient;
  private steps: FlowStep[] = [];
  private assertions: FlowAssertion[] = [];

  constructor(client: SurfClient) {
    this.client = client;
  }

  goto(url: string): this {
    this.steps.push({ type: "goto", url });
    return this;
  }

  click(ref: string, description?: string): this {
    this.steps.push({ type: "click", ref, description });
    return this;
  }

  type(ref: string, text: string): this {
    this.steps.push({ type: "type", ref, text });
    return this;
  }

  wait(duration: number): this {
    this.steps.push({ type: "wait", duration });
    return this;
  }

  waitForElement(selector: string): this {
    this.steps.push({ type: "waitForElement", selector });
    return this;
  }

  screenshot(): this {
    this.steps.push({ type: "screenshot" });
    return this;
  }

  assert(assertion: string, check: () => Promise<boolean>): this {
    this.assertions.push({ description: assertion, check });
    return this;
  }

  async execute(): Promise<FlowResult> {
    const results: StepResult[] = [];
    const startTime = Date.now();

    try {
      for (const step of this.steps) {
        const stepStart = Date.now();
        let success = true;
        let error: string | undefined;

        try {
          switch (step.type) {
            case "goto":
              if (!step.url) throw new Error("goto step requires url");
              await this.client.goto(step.url);
              break;
            case "click":
              if (!step.ref) throw new Error("click step requires ref");
              await this.client.click(step.ref);
              break;
            case "type":
              if (!step.text) throw new Error("type step requires text");
              await this.client.type(step.text, { ref: step.ref });
              break;
            case "wait":
              if (!step.duration) throw new Error("wait step requires duration");
              await this.client.wait(step.duration);
              break;
            case "waitForElement":
              await this.client.wait({ element: step.selector });
              break;
            case "screenshot":
              await this.client.screenshot();
              break;
          }
        } catch (e) {
          success = false;
          error = String(e);
        }

        results.push({
          step,
          success,
          duration: Date.now() - stepStart,
          error,
        });

        if (!success) {
          return {
            success: false,
            steps: results,
            assertions: [],
            duration: Date.now() - startTime,
            error,
          };
        }
      }

      const assertionResults = await Promise.all(
        this.assertions.map(async (a) => ({
          description: a.description,
          passed: await a.check(),
        })),
      );

      return {
        success: assertionResults.every((a) => a.passed),
        steps: results,
        assertions: assertionResults,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        steps: results,
        assertions: [],
        duration: Date.now() - startTime,
        error: String(error),
      };
    }
  }
}

interface FlowStep {
  type: "goto" | "click" | "type" | "wait" | "waitForElement" | "screenshot";
  url?: string;
  ref?: string;
  text?: string;
  duration?: number;
  selector?: string;
  description?: string;
}

interface FlowAssertion {
  description: string;
  check: () => Promise<boolean>;
}

interface StepResult {
  step: FlowStep;
  success: boolean;
  duration: number;
  error?: string;
}

interface FlowResult {
  success: boolean;
  steps: StepResult[];
  assertions: Array<{ description: string; passed: boolean }>;
  duration: number;
  error?: string;
}

// ============================================
// EXPORTS
// ============================================

export default SurfClient;
