/**
 * TEST-CAPABILITIES Surf-CLI Integration
 * Advanced browser testing powered by surf-cli
 */

import { spawn } from "node:child_process";
import {
  parseCreatedTabId,
  parseSurfErrorOutput,
  parseSurfJsonOutput,
  resolveSurfRuntimeCommand,
  SurfCommandError,
} from "../core/surf-runtime.js";

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

/** Result of `surf wait.ready` / `surf page.readiness --json`. */
export interface SurfReadiness {
  state: "ready" | "empty" | "loading" | "login" | "challenge" | "not-found" | "error";
  evidence: string[];
  href?: string;
  title?: string;
  readyState?: string;
  tabStatus?: string;
  polls?: number;
  waited?: number;
  accepted?: boolean;
}

export interface SurfReadinessOptions {
  tabId?: number;
  selector?: string;
  text?: string;
  urlPrefix?: string;
  emptyText?: string;
}

export interface SurfWaitReadyOptions extends SurfReadinessOptions {
  accept?: Array<"login" | "challenge" | "not-found" | "error">;
  timeout?: number;
  interval?: number;
}

/** Result of `surf extract --json`. */
export interface SurfExtractResult<TRow = unknown> {
  data: unknown;
  rows: TRow[];
  rowCount: number | null;
  attempts: number;
  readiness?: SurfReadiness;
  mode?: string;
  url?: string | null;
  tabId?: number | null;
}

export interface SurfExtractOptions {
  url?: string;
  tabId?: number;
  code?: string;
  file?: string;
  options?: Record<string, unknown>;
  readySelector?: string;
  readyText?: string;
  readyUrlPrefix?: string;
  emptyText?: string;
  readyTimeout?: number;
  rows?: string;
  retry?: number;
  allowEmpty?: boolean;
  keepTab?: boolean;
}

/** Result of `surf frame.diagnose --json`. */
export interface SurfFrameDiagnosis {
  mainPage?: unknown;
  counts?: Record<string, number>;
  domIframes: unknown[];
  extensionFrames: unknown[];
  cdpFrames: unknown[];
  warnings: string[];
}

function assertSupportedSurfConfig(config: SurfConfig): void {
  const unsupported: string[] = [];

  if (config.socketPath !== undefined) {
    unsupported.push("socketPath");
  }
  if (config.networkCapture !== undefined) {
    unsupported.push("networkCapture");
  }
  if (config.networkPath !== undefined) {
    unsupported.push("networkPath");
  }

  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported SurfClient config option(s): ${unsupported.join(", ")}. Outside the current capability contract. Use only autoScreenshot and screenshotResize until the remaining config is wired to real surf runtime behavior.`,
    );
  }
}

function isSurfElementRef(value: string): boolean {
  return /^e\d+$/.test(value);
}

// ============================================
// SURF CLIENT
// ============================================

export class SurfClient {
  private config: SurfConfig;

  constructor(config: SurfConfig = {}) {
    assertSupportedSurfConfig(config);

    this.config = {
      autoScreenshot: true,
      screenshotResize: 1200,
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
    return this.parseJsonPayload("page.state", result.message);
  }

  async pageText(): Promise<string> {
    const result = await this.run("page.text", []);
    return result.message || "";
  }

  private parseJsonPayload<T>(command: string, message: string | undefined): T {
    return parseSurfJsonOutput(message ?? "", command).data as T;
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
      args = isSurfElementRef(refOrSelectorOrX)
        ? [refOrSelectorOrX]
        : ["--selector", refOrSelectorOrX];
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
    if (!options.full && this.config.screenshotResize) {
      args.push("--max-size", String(this.config.screenshotResize));
    }

    return this.run("screenshot", args);
  }

  async snap(): Promise<SurfActionResult> {
    return this.screenshot();
  }

  // ============================================
  // TABS & WINDOWS
  // ============================================

  async listTabs(): Promise<Array<{ id: number; title: string; url: string }>> {
    const result = await this.run("tab.list", []);
    const payload = this.parseJsonPayload<unknown>("tab.list", result.message);
    const entries = Array.isArray(payload)
      ? payload
      : payload &&
          typeof payload === "object" &&
          Array.isArray((payload as { tabs?: unknown }).tabs)
        ? ((payload as { tabs: unknown[] }).tabs ?? [])
        : undefined;
    if (!entries) {
      throw new Error("surf tab.list --json did not return a tab array");
    }

    return entries.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== "number") {
        return [];
      }
      return [
        {
          id: record.id,
          title: typeof record.title === "string" ? record.title : "",
          url: typeof record.url === "string" ? record.url : "",
        },
      ];
    });
  }

  /**
   * `surf tab.new` answers with the text "Created tab <id>: <url>" (also under `--json`);
   * the id is parsed from that line.
   */
  async newTab(url: string): Promise<{ tabId: number; url: string }> {
    const result = await this.run("tab.new", [url]);
    const tabId = parseCreatedTabId(result.message ?? "");
    if (tabId === undefined) {
      const preview = (result.message ?? "").slice(0, 200);
      throw new Error(`surf tab.new did not report a tab id: ${preview || "(empty output)"}`);
    }
    return { tabId, url };
  }

  async switchTab(id: number | string): Promise<SurfActionResult> {
    return this.run("tab.switch", [String(id)]);
  }

  async closeTab(id: number): Promise<SurfActionResult> {
    return this.run("tab.close", [String(id)]);
  }

  async newWindow(url: string): Promise<{ windowId: number; tabId: number }> {
    const result = await this.run("window.new", [url]);
    return this.parseJsonPayload("window.new", result.message);
  }

  async listWindows(): Promise<Array<{ id: number; tabs: number[] }>> {
    const result = await this.run("window.list", []);
    return this.parseJsonPayload("window.list", result.message);
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

    const result = await this.run("network", args);
    return this.parseJsonPayload("network", result.message);
  }

  async getNetworkRequest(id: string): Promise<NetworkRequest | null> {
    const result = await this.run("network.get", [id]);
    return this.parseJsonPayload("network.get", result.message);
  }

  async getNetworkBody(id: string): Promise<string> {
    const result = await this.run("network.body", [id]);
    return result.message || "";
  }

  async clearNetwork(): Promise<void> {
    await this.run("network.clear", []);
  }

  async getNetworkStats(): Promise<{ requests: number; size: string }> {
    const result = await this.run("network.stats", []);
    return this.parseJsonPayload("network.stats", result.message);
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
    const result = await this.run("js", [code]);
    return this.parseJsonPayload("js", result.message);
  }

  // ============================================
  // CONSOLE
  // ============================================

  async getConsole(): Promise<Array<{ type: string; message: string }>> {
    const result = await this.run("console", []);
    return this.parseJsonPayload("console", result.message);
  }

  // ============================================
  // COOKIES
  // ============================================

  async getCookies(): Promise<Array<{ name: string; value: string; domain: string }>> {
    const result = await this.run("cookie.list", []);
    return this.parseJsonPayload("cookie.list", result.message);
  }

  // ============================================
  // IFrames
  // ============================================

  async listFrames(): Promise<Array<{ index: number; name?: string; selector?: string }>> {
    const result = await this.run("frame.list", []);
    return this.parseJsonPayload("frame.list", result.message);
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
  // TYPED READINESS, EXTRACTION, FRAME DIAGNOSIS
  // (surf-cli branch feat/site-independent-mechanisms)
  // ============================================

  private readinessArgs(options: SurfReadinessOptions): string[] {
    const args: string[] = [];
    if (options.tabId !== undefined) args.push("--tab-id", String(options.tabId));
    if (options.selector) args.push("--selector", options.selector);
    if (options.text) args.push("--text", options.text);
    if (options.urlPrefix) args.push("--url-prefix", options.urlPrefix);
    if (options.emptyText) args.push("--empty-text", options.emptyText);
    return args;
  }

  /** Classify the page once without waiting (`surf page.readiness --json`). */
  async pageReadiness(options: SurfReadinessOptions = {}): Promise<SurfReadiness> {
    const result = await this.run("page.readiness", this.readinessArgs(options));
    return this.parseJsonPayload<SurfReadiness>("page.readiness", result.message);
  }

  /**
   * Wait until the page is ready or fail fast with a typed state. Negative states reject with a
   * `SurfCommandError` whose `code` is `page_login`, `page_challenge`, `page_not_found`,
   * `page_error` or `page_timeout` unless listed in `accept`.
   */
  async waitReady(options: SurfWaitReadyOptions = {}): Promise<SurfReadiness> {
    const args = this.readinessArgs(options);
    if (options.accept && options.accept.length > 0)
      args.push("--accept", options.accept.join(","));
    if (options.timeout !== undefined) args.push("--timeout", String(options.timeout));
    if (options.interval !== undefined) args.push("--interval", String(options.interval));
    const result = await this.run("wait.ready", args);
    return this.parseJsonPayload<SurfReadiness>("wait.ready", result.message);
  }

  /**
   * Read-only extraction (`surf extract --json`): in an owned tab when `url` is given without
   * `tabId`, in place when `tabId` is given. Zero rows reject with `empty_result` unless
   * `allowEmpty` is set or the page reports its own empty state.
   */
  async extract<TRow = unknown>(options: SurfExtractOptions): Promise<SurfExtractResult<TRow>> {
    const args: string[] = [];
    if (options.url) args.push(options.url);
    if (options.tabId !== undefined) args.push("--tab-id", String(options.tabId));
    if (options.code) args.push("--code", options.code);
    if (options.file) args.push("--file", options.file);
    if (options.options) args.push("--options", JSON.stringify(options.options));
    if (options.readySelector) args.push("--ready-selector", options.readySelector);
    if (options.readyText) args.push("--ready-text", options.readyText);
    if (options.readyUrlPrefix) args.push("--ready-url-prefix", options.readyUrlPrefix);
    if (options.emptyText) args.push("--empty-text", options.emptyText);
    if (options.readyTimeout !== undefined)
      args.push("--ready-timeout", String(options.readyTimeout));
    if (options.rows) args.push("--rows", options.rows);
    if (options.retry !== undefined) args.push("--retry", String(options.retry));
    if (options.allowEmpty) args.push("--allow-empty");
    if (options.keepTab) args.push("--keep-tab");

    const result = await this.run("extract", args);
    const payload = this.parseJsonPayload<Record<string, unknown>>("extract", result.message);
    if (!payload || typeof payload !== "object") {
      throw new Error("surf extract --json did not return an object");
    }
    return {
      data: payload.data,
      rows: Array.isArray(payload.rows) ? (payload.rows as TRow[]) : [],
      rowCount: typeof payload.rowCount === "number" ? payload.rowCount : null,
      attempts: typeof payload.attempts === "number" ? payload.attempts : 1,
      readiness: payload.readiness as SurfReadiness | undefined,
      mode: typeof payload.mode === "string" ? payload.mode : undefined,
      url: typeof payload.url === "string" ? payload.url : null,
      tabId: typeof payload.tabId === "number" ? payload.tabId : null,
    };
  }

  /** Explain why a selector does not reach a widget (`surf frame.diagnose --json`). */
  async diagnoseFrames(options: { tabId?: number } = {}): Promise<SurfFrameDiagnosis> {
    const args: string[] = [];
    if (options.tabId !== undefined) args.push("--tab-id", String(options.tabId));
    const result = await this.run("frame.diagnose", args);
    const payload = this.parseJsonPayload<Record<string, unknown>>(
      "frame.diagnose",
      result.message,
    );
    return {
      mainPage: payload.mainPage,
      counts: payload.counts as Record<string, number> | undefined,
      domIframes: Array.isArray(payload.domIframes) ? payload.domIframes : [],
      extensionFrames: Array.isArray(payload.extensionFrames) ? payload.extensionFrames : [],
      cdpFrames: Array.isArray(payload.cdpFrames) ? payload.cdpFrames : [],
      warnings: Array.isArray(payload.warnings)
        ? payload.warnings.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
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

  private async run(command: string, args: string[] = []): Promise<SurfActionResult> {
    const runtime = resolveSurfRuntimeCommand(command, args);

    return new Promise((resolve, reject) => {
      const proc = spawn(runtime.command, runtime.args, {
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

        reject(
          new SurfCommandError({
            ok: false,
            code,
            stdout,
            stderr,
            commandDisplay: runtime.commandDisplay,
            failure: parseSurfErrorOutput(stdout, stderr, code, runtime.commandDisplay),
          }),
        );
      });

      proc.on("error", (err) => {
        reject(
          new SurfCommandError({
            ok: false,
            code: null,
            stdout,
            stderr,
            commandDisplay: runtime.commandDisplay,
            failure: {
              code: "spawn_failed",
              message: `Failed to run ${runtime.commandDisplay.join(" ")}: ${err.message}`,
            },
          }),
        );
      });
    });
  }

  private extractScreenshotPath(output: string): string | undefined {
    const match = output.match(/screenshot saved to:\s*(\/\S+)/i);
    return match?.[1];
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
              if (step.url === undefined) throw new Error("goto step requires url");
              await this.client.goto(step.url);
              break;
            case "click":
              if (step.ref === undefined) throw new Error("click step requires ref");
              await this.client.click(step.ref);
              break;
            case "type":
              if (step.text === undefined) throw new Error("type step requires text");
              await this.client.type(step.text, { ref: step.ref });
              break;
            case "wait":
              if (step.duration === undefined) throw new Error("wait step requires duration");
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
