/**
 * The a11y snapshot channel as a `Session.observe` step (architecture review A8; adjudication
 * claim 22).
 *
 * A step list in its own module, the way `frame-diagnosis.ts` and `surf-plan-probe.ts` are: the
 * session stays free of the second tool, and the composition - bind the surf-owned tab through
 * `/json/list`, pin one agent-browser session to it, take one `snapshot -i --json`, count what
 * the tree could name against what the `dom` probe counted, write the artifact at 0600, tear the
 * session down before the tab closes - lives here where it is testable against a fake.
 *
 * The rules this module exists to keep, all from the packet:
 *
 *   - **surf owns the tab; agent-browser only reads it.** The observer never opens, navigates or
 *     closes a page. It binds to the target id the browser already has for the tab surf created,
 *     and every invocation carries `--cdp` so nothing is ever launched.
 *   - **Exactly one candidate, or nothing.** A tab that is not in `/json/list`, or is there
 *     twice, is `tab_bind_ambiguous`; the framework does not pick.
 *   - **An empty tree is a failure.** `empty_snapshot` is not a zero-element success, and an
 *     `origin` that is not the bound tab's URL is `origin_mismatch` - the same rule the explore
 *     probes apply to their own evidence.
 *   - **Teardown before the tab goes.** The session that was pinned to the tab is ended first;
 *     `close` on an attached browser was measured on 2026-09-08 to end the session and leave the
 *     browser and its pages alone.
 */

import path from "node:path";
import process from "node:process";
import {
  A11Y_CHANNEL,
  A11Y_SNAPSHOT_KIND,
  A11Y_SNAPSHOT_SCHEMA_VERSION,
  type A11yDomProbeCounts,
  type A11ySnapshotArtifact,
  type A11ySnapshotObservation,
  type A11yTabBinding,
  type A11yTabLeak,
  parseA11ySnapshotPayload,
  roleCountsFrom,
  semanticCoverageFrom,
  snapshotDigest,
} from "./a11y-snapshot.js";
import type { AgentBrowserResolution } from "./a11y-snapshot-runtime.js";
import {
  agentBrowserAdapter,
  type CdpTarget,
  listCdpTargets,
  probeAgentBrowser,
  probeCdpEndpoint,
  sessionNameForRun,
} from "./a11y-snapshot-runtime.js";
import { invokeAdapter } from "./adapter.js";
import { writeJsonArtifactSync } from "./artifacts.js";
import type { Session, SessionObserver } from "./browser-session.js";
import type { EffectDeclaration } from "./effects.js";
import type { RunContext } from "./run-context.js";
import { FrameworkError, isFrameworkError } from "./runtime-contract.js";

export const A11Y_SNAPSHOT_ARTIFACT_KIND = "test-capabilities.a11y.snapshot";
export const A11Y_SNAPSHOT_OBSERVER_NAME = "a11y-snapshot";

/**
 * Read-only on the target and on the browser: this observer reads a tab another tool owns and
 * changes nothing about either. The session it pins is its own and it ends it itself.
 */
export const A11Y_SNAPSHOT_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason:
    "reads the accessibility tree of the tab surf owns over CDP; it opens, navigates and clicks nothing",
};

export interface A11ySnapshotObserverOptions {
  context: RunContext;
  /** `optional` records `unavailable` and continues; `required` fails the page */
  required: boolean;
  /** orders the artifacts of one run; it is not an invalidator */
  sequence?: number;
  /**
   * The `dom` probe's counts for this page visit, read at observation time because the probes
   * run after the observer is registered. `undefined` means the probe did not verify, which is
   * `dom_probe_missing` - never three zeros.
   */
  domCounts?: () => A11yDomProbeCounts | undefined;
  env?: NodeJS.ProcessEnv;
}

export interface A11ySnapshotObserverHandle {
  observer: SessionObserver;
  /** what this observer saw, in the shape the page result carries; set on every path */
  observation(): A11ySnapshotObservation | undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pageTargets(targets: readonly CdpTarget[]): CdpTarget[] {
  return targets.filter((target) => target.type === "page");
}

/**
 * One agent-browser invocation, through the kernel boundary and the run's ledger.
 *
 * Read-only, so it lands in the ledger's attempt log rather than in a receipt; the boundary is
 * still `Adapter.invoke`, so translation, the argv allowlist and the classifier all run.
 */
async function runAgentBrowserStep(
  context: RunContext,
  env: NodeJS.ProcessEnv,
  step: { id: string; command: string; args?: readonly string[]; intent: string; subject: string },
): Promise<{ stdout: string; stderr: string; exitCode: number | null; display: string[] }> {
  return context.ledger.runStep({
    id: step.id,
    effect: A11Y_SNAPSHOT_EFFECT,
    subject: step.subject,
    intent: step.intent,
    run: async () => {
      const invoked = await invokeAdapter(
        agentBrowserAdapter,
        {
          id: step.id,
          command: step.command,
          ...(step.args ? { args: step.args } : {}),
          subject: step.subject,
        },
        { env, runId: context.runId },
      );
      return {
        stdout: invoked.raw.stdout,
        stderr: invoked.raw.stderr,
        exitCode: invoked.raw.exitCode,
        display: invoked.invocation.display,
      };
    },
  });
}

/** agent-browser wraps every `--json` reply as `{success, data, error}`; unwrap or refuse. */
function unwrapAgentBrowserJson(
  stdout: string,
  display: readonly string[],
): { data: unknown } | { code: "snapshot_failed" | "tab_lost"; detail: string } {
  const raw = stdout.trim();
  if (raw.length === 0) {
    return { code: "snapshot_failed", detail: `${display.join(" ")} printed nothing` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      code: "snapshot_failed",
      detail: `${display.join(" ")} printed ${raw.slice(0, 160)}, which is not JSON`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { code: "snapshot_failed", detail: `${display.join(" ")} printed a ${typeof parsed}` };
  }
  const envelope = parsed as { success?: unknown; data?: unknown; error?: unknown };
  if (envelope.success === false) {
    const message = typeof envelope.error === "string" ? envelope.error : "unknown failure";
    return {
      code: /tab[_ ]gone|no such tab|target closed/i.test(message) ? "tab_lost" : "snapshot_failed",
      detail: message,
    };
  }
  return { data: "data" in envelope ? envelope.data : parsed };
}

/** The page target the surf session owns, or the typed refusal that says why there is none. */
export function bindOwnedTab(
  targets: readonly CdpTarget[],
  href: string,
  surfTabId: number | undefined,
): A11yTabBinding {
  const candidates = pageTargets(targets).filter((target) => target.url === href);
  if (candidates.length !== 1) {
    throw new FrameworkError(
      "tab_bind_ambiguous",
      `The browser's target list holds ${candidates.length} page(s) at ${href}; the a11y channel binds to exactly one tab or to none. ${
        candidates.length === 0
          ? "The tab surf opened is not in /json/list, so the endpoint is a different browser from the one surf drives."
          : `Candidates: ${candidates.map((target) => target.id).join(", ")}.`
      }`,
      { url: href, candidates: candidates.map((target) => target.id) },
    );
  }
  const target = candidates[0] as CdpTarget;
  return {
    targetId: target.id,
    ...(surfTabId === undefined ? {} : { surfTabId }),
    url: target.url,
    title: target.title,
  };
}

/** Pages that appeared while the observer held its session; recorded, never refused. */
export function tabLeakOf(
  before: readonly CdpTarget[],
  after: readonly CdpTarget[],
): A11yTabLeak | undefined {
  const beforePages = pageTargets(before);
  const afterPages = pageTargets(after);
  if (afterPages.length <= beforePages.length) {
    return undefined;
  }
  const known = new Set(beforePages.map((target) => target.id));
  return {
    before: beforePages.length,
    after: afterPages.length,
    urls: afterPages.filter((target) => !known.has(target.id)).map((target) => target.url),
  };
}

interface CaptureResult {
  artifact: A11ySnapshotArtifact;
  observation: A11ySnapshotObservation;
}

function unavailable(reason: string, detail: string): CaptureResult {
  return {
    artifact: {
      schemaVersion: A11Y_SNAPSHOT_SCHEMA_VERSION,
      kind: A11Y_SNAPSHOT_KIND,
      channel: A11Y_CHANNEL,
      status: "unavailable",
      reason,
      detail,
    },
    observation: { channel: A11Y_CHANNEL, status: "unavailable", reason, detail },
  };
}

/**
 * Write the artifact next to the run's receipts, at 0600 (architecture review A9/A10).
 *
 * The text and the refs map belong in the file; the observation keeps the digest, the counts and
 * the path. A write that fails is recorded on the observation and does not turn a captured
 * snapshot into a refusal: the evidence was obtained, and losing the record of it because a
 * directory is unwritable would delete information rather than protect anything (the S8 rule).
 */
function writeSnapshotArtifact(
  context: RunContext,
  artifact: A11ySnapshotArtifact,
  sequence: number,
): { artifact: string } | { artifactError: string } {
  const file = path.join(
    context.config.receipts.dir,
    context.runId,
    `a11y-snapshot-${sequence}-${Date.now()}.json`,
  );
  try {
    return {
      artifact: writeJsonArtifactSync(
        file,
        {
          schema_version: 1,
          artifact_kind: A11Y_SNAPSHOT_ARTIFACT_KIND,
          generated_at: new Date().toISOString(),
          run_id: context.runId,
          operation_id: context.operationId,
          ...artifact,
        },
        { label: "A11y snapshot artifact" },
      ),
    };
  } catch (error) {
    return { artifactError: errorMessage(error) };
  }
}

async function capture(
  session: Session,
  options: A11ySnapshotObserverOptions,
  sequence: number,
): Promise<CaptureResult> {
  const baseEnv = options.env ?? process.env;
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    TEST_CAPABILITIES_AGENT_BROWSER_SESSION: sessionNameForRun(session.runId, baseEnv),
  };
  const context = options.context;

  let resolution: AgentBrowserResolution;
  try {
    resolution = agentBrowserAdapter.resolve(env);
  } catch (error) {
    return unavailable(
      isFrameworkError(error) ? error.code : "agent_browser_missing",
      errorMessage(error),
    );
  }

  const probe = await probeAgentBrowser(resolution, { env });
  const version = await probeCdpEndpoint(resolution);

  const before = await listCdpTargets(resolution);
  const href = session.readiness?.href ?? session.url;
  const binding = bindOwnedTab(before, href, session.tab?.id);

  const startedAt = Date.now();
  // Binding first: `tab <targetId>` attaches the pinned session to the tab surf owns without
  // creating one, which is what makes every later command speak about this page and no other.
  await runAgentBrowserStep(context, env, {
    id: "a11y.tab.bind",
    command: "tab",
    args: [binding.targetId],
    intent: `pin this run's agent-browser session to the tab surf owns (${binding.targetId})`,
    subject: `${href} target=${binding.targetId}`,
  });

  const snapshotReply = await runAgentBrowserStep(context, env, {
    id: "a11y.snapshot",
    command: "snapshot",
    args: ["-i", "--json"],
    intent: `read the accessibility tree of ${href} without acting on it`,
    subject: `${href} target=${binding.targetId}`,
  });

  const unwrapped = unwrapAgentBrowserJson(snapshotReply.stdout, snapshotReply.display);
  if ("code" in unwrapped) {
    throw new FrameworkError(
      unwrapped.code,
      `The a11y snapshot of ${href} did not answer: ${unwrapped.detail}.`,
      { url: href, target_id: binding.targetId },
    );
  }

  const parsed = parseA11ySnapshotPayload(unwrapped.data);
  if ("error" in parsed) {
    throw new FrameworkError(
      parsed.error,
      parsed.error === "empty_snapshot"
        ? `The accessibility tree of ${href} is empty (${parsed.detail}). An empty tree is a failure, never a zero-element success: either the page carries no named controls at all, or the snapshot did not reach it.`
        : `The a11y snapshot of ${href} answered a shape this channel cannot read: ${parsed.detail}.`,
      { url: href, target_id: binding.targetId },
    );
  }

  const reading = parsed.reading;
  if (reading.origin !== binding.url) {
    throw new FrameworkError(
      "origin_mismatch",
      `The a11y snapshot reports origin ${reading.origin || "(none)"} while the bound tab is ${binding.url}. The page moved between the readiness gate and the snapshot, so the tree describes something this run never gated.`,
      { url: binding.url, origin: reading.origin, target_id: binding.targetId },
    );
  }

  const after = await listCdpTargets(resolution);
  const leak = tabLeakOf(before, after);
  const roleCounts = roleCountsFrom(reading.refs);
  const coverage = semanticCoverageFrom(roleCounts, options.domCounts?.());

  const artifact: A11ySnapshotArtifact = {
    schemaVersion: A11Y_SNAPSHOT_SCHEMA_VERSION,
    kind: A11Y_SNAPSHOT_KIND,
    channel: A11Y_CHANNEL,
    tool: { command: resolution.command, version: probe.version },
    endpoint: { url: resolution.endpoint.url, browser: version.browser },
    session: resolution.session,
    tab: binding,
    sequence,
    capturedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    bytes: Buffer.byteLength(reading.snapshot, "utf8"),
    refCount: Object.keys(reading.refs).length,
    digest: snapshotDigest(reading.snapshot),
    refs: reading.refs,
    snapshot: reading.snapshot,
    roleCounts,
    ...coverage,
    ...(leak ? { tabLeak: leak } : {}),
    status: "captured",
  };

  const written = writeSnapshotArtifact(context, artifact, sequence);
  return {
    artifact,
    observation: {
      channel: A11Y_CHANNEL,
      status: "captured",
      ...written,
      digest: artifact.digest,
      refCount: artifact.refCount,
      bytes: artifact.bytes,
      sequence,
      refs: artifact.refs,
      roleCounts,
      ...coverage,
      tab: binding,
      session: resolution.session,
      endpoint: resolution.endpoint.url,
      tool: artifact.tool,
      ...(leak ? { tabLeak: leak } : {}),
    },
  };
}

/**
 * Build the observer a browser operation registers on its session.
 *
 * `run` never leaves the caller without an answer: every refusal on the way to a snapshot is
 * turned into an `unavailable` artifact with its registered reason, written to disk like a
 * captured one, and only then re-raised as `a11y_channel_unavailable` when the operator asked
 * for `required`. That is what makes `optional` a recorded gap rather than a silent skip.
 */
export function createA11ySnapshotObserver(
  options: A11ySnapshotObserverOptions,
): A11ySnapshotObserverHandle {
  const sequence = options.sequence ?? 1;
  let observation: A11ySnapshotObservation | undefined;
  let bound = false;

  const observer: SessionObserver = {
    effect: A11Y_SNAPSHOT_EFFECT,
    intent: "read the page's accessibility tree as a second observation channel",
    required: options.required,

    async run(session: Session): Promise<A11ySnapshotObservation> {
      let result: CaptureResult;
      try {
        bound = true;
        result = await capture(session, options, sequence);
      } catch (error) {
        result = unavailable(
          isFrameworkError(error) ? error.code : "snapshot_failed",
          errorMessage(error),
        );
      }

      if (result.artifact.status === "unavailable") {
        const written = writeSnapshotArtifact(options.context, result.artifact, sequence);
        observation = { ...result.observation, ...written };
        if (options.required) {
          throw new FrameworkError(
            "a11y_channel_unavailable",
            `The a11y snapshot channel was required and could not observe ${session.url}: ${result.artifact.reason} - ${result.artifact.detail ?? "no detail"}.`,
            { url: session.url, reason: result.artifact.reason },
          );
        }
        return observation;
      }

      observation = result.observation;
      return observation;
    },

    async teardown(): Promise<void> {
      if (!bound) {
        return;
      }
      bound = false;
      const baseEnv = options.env ?? process.env;
      const env: NodeJS.ProcessEnv = {
        ...baseEnv,
        TEST_CAPABILITIES_AGENT_BROWSER_SESSION: sessionNameForRun(options.context.runId, baseEnv),
      };
      // The session goes before the tab does: an unpinned session outliving its tab was measured
      // creating a stray `about:blank` and then refusing to close "the last tab", while `close`
      // on an attached browser ends only the session (measured 2026-09-08).
      await runAgentBrowserStep(options.context, env, {
        id: "a11y.session.close",
        command: "close",
        intent: "end the agent-browser session this run created, leaving the browser untouched",
        subject: sessionNameForRun(options.context.runId, baseEnv),
      });
    },
  };

  return { observer, observation: () => observation };
}

/**
 * What the a11y observer saw, in the shape a page result carries it.
 *
 * It is read from the observer's own handle rather than from `session.observations()` so that a
 * `required` channel that refused - which throws out of `runObservers` - still reports the
 * artifact it wrote and the reason it refused. A page that failed for another reason keeps its
 * observation too: the refusal and the evidence are different facts.
 */
export function observationsOf(handle: A11ySnapshotObserverHandle | undefined): {
  observations?: A11ySnapshotObservation[];
} {
  const observation = handle?.observation();
  return observation ? { observations: [observation] } : {};
}

/** What one channel summary looks like on a run envelope. */
export interface A11yChannelSummary {
  mode: "optional" | "required";
  channel: string;
  tool?: string;
  version?: string;
  endpoint?: string;
  status: "captured" | "unavailable";
  reason?: string;
}

/**
 * What the envelope says about the second channel, when one was asked for. It names the producer
 * and the tool that answered, so a producer switch is visible in the run's own report and not
 * only in the artifact (packet, "Producer independence").
 */
export function a11yChannelSummary(
  mode: "optional" | "required" | undefined,
  observations: readonly A11ySnapshotObservation[],
): { a11yChannel?: A11yChannelSummary } {
  if (!mode) {
    return {};
  }
  const first = observations[0];
  return {
    a11yChannel: {
      mode,
      channel: first?.channel ?? A11Y_CHANNEL,
      ...(first?.tool ? { tool: first.tool.command, version: first.tool.version } : {}),
      ...(first?.endpoint ? { endpoint: first.endpoint } : {}),
      status: first?.status ?? "unavailable",
      ...(first?.reason ? { reason: first.reason } : {}),
    },
  };
}
