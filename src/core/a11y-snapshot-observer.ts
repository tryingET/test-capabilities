/**
 * The a11y snapshot observer: a read-only `Session.observe` step over the tab a surf run
 * already owns (a11y-snapshot packet; slice S9; producer decided by the measured series of
 * AK #5915, `docs/project/2026-09-26-a11y-producer-switch.md`).
 *
 * The tree is Chromium's own accessibility tree, read over the loopback DevTools endpoint from
 * the page target surf owns, and from each out-of-process frame below it through its own
 * flattened session. surf keeps the tab and every action; this step attaches to the existing
 * target (no new target, no new tab), reads, detaches and closes. Measured against surf's
 * content-script tree, Chromium's tree carries the real accessible names, sees into shadow roots
 * (964 buttons on MDN that surf missed) and reaches out-of-process frames.
 */

import path from "node:path";
import { type AxRendering, renderAxForest } from "./a11y-ax-tree.js";
import {
  bindOwnedTarget,
  CdpConnection,
  createCdpCheckReader,
  listCdpTargets,
  probeCdpBrowser,
  readAxForest,
  releaseForest,
  resolveCdpEndpoint,
} from "./a11y-cdp.js";
import {
  A11Y_CHANNEL,
  A11Y_SNAPSHOT_KIND,
  A11Y_SNAPSHOT_SCHEMA_VERSION,
  type A11yCheckReader,
  type A11yDomProbeCounts,
  type A11ySnapshotArtifact,
  type A11ySnapshotObservation,
  type A11ySnapshotView,
  roleCountsFrom,
  semanticCoverageFrom,
  snapshotDigest,
} from "./a11y-snapshot.js";
import { writeJsonArtifactSync } from "./artifacts.js";
import type { Session, SessionObserver } from "./browser-session.js";
import type { EffectDeclaration } from "./effects.js";
import type { RunContext } from "./run-context.js";
import { FrameworkError, isFrameworkError } from "./runtime-contract.js";

/** The artifact kind the snapshot file is written under (listable next to receipts). */
export const A11Y_SNAPSHOT_ARTIFACT_KIND = "test-capabilities.a11y.snapshot";
export const A11Y_SNAPSHOT_OBSERVER_NAME = "a11y-snapshot";

/**
 * Read-only on the target and on the browser: it attaches to the existing page target, reads
 * the accessibility tree and detaches. It opens, navigates and clicks nothing, and starts no
 * process.
 */
export const A11Y_SNAPSHOT_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason:
    "reads Chromium's accessibility tree of the tab this run owns over the loopback DevTools endpoint; it opens, navigates and clicks nothing",
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
  /** the DevTools endpoint comes from here (`TEST_CAPABILITIES_CDP_ENDPOINT`) */
  env?: NodeJS.ProcessEnv;
}

export interface A11ySnapshotObserverHandle {
  observer: SessionObserver;
  /** what this observer saw, in the shape the page result carries; set on every path */
  observation(): A11ySnapshotObservation | undefined;
}

const PRODUCER_COMMAND = "CDP Accessibility.getFullAXTree";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** One read of the owned tab: bind, attach, read the forest, render, detach. */
async function readOwnedTab(
  href: string,
  env: NodeJS.ProcessEnv,
  keepOpen: boolean,
): Promise<{
  rendering: AxRendering;
  browser: string;
  target: { id: string; title: string };
  connection?: CdpConnection;
  sessions: Record<string, string | undefined>;
}> {
  const endpoint = resolveCdpEndpoint(env);
  const browser = await probeCdpBrowser(endpoint);
  const target = bindOwnedTarget(await listCdpTargets(endpoint), href);
  const connection = await CdpConnection.open(target.webSocketDebuggerUrl as string);
  let sessions: Record<string, string | undefined> = {};
  try {
    const read = await readAxForest(connection);
    sessions = read.sessions;
    const rendering = renderAxForest(read.forest);
    if (keepOpen) {
      return { rendering, browser, target, connection, sessions };
    }
    return { rendering, browser, target, sessions };
  } finally {
    if (!keepOpen) {
      await releaseForest(connection, sessions);
      connection.close();
    }
  }
}

async function capture(
  session: Session,
  options: A11ySnapshotObserverOptions,
  sequence: number,
): Promise<CaptureResult> {
  const href = session.readiness?.href ?? session.url;
  const startedAt = Date.now();
  const { rendering, browser, target } = await options.context.ledger.runStep({
    id: "a11y.snapshot",
    effect: A11Y_SNAPSHOT_EFFECT,
    subject: href,
    intent: `read the accessibility tree of ${href} without acting on it`,
    run: () => readOwnedTab(href, options.env ?? process.env, false),
  });

  if (rendering.snapshot.trim().length === 0 || Object.keys(rendering.refs).length === 0) {
    return unavailable(
      "empty_snapshot",
      `The accessibility tree of ${href} is empty (${Object.keys(rendering.refs).length} kept nodes). An empty tree is a failure, never a zero-element success: either the page carries no named controls at all, or the read did not reach it.`,
    );
  }

  const roleCounts = roleCountsFrom(rendering.refs);
  const coverage = semanticCoverageFrom(roleCounts, options.domCounts?.());
  const tab = {
    ...(session.tab ? { surfTabId: session.tab.id } : {}),
    targetId: target.id,
    url: href,
    title: target.title,
  };
  const tool = { command: PRODUCER_COMMAND, version: browser };
  const artifact: A11ySnapshotArtifact = {
    schemaVersion: A11Y_SNAPSHOT_SCHEMA_VERSION,
    kind: A11Y_SNAPSHOT_KIND,
    channel: A11Y_CHANNEL,
    tool,
    tab,
    sequence,
    capturedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    bytes: Buffer.byteLength(rendering.snapshot, "utf8"),
    refCount: Object.keys(rendering.refs).length,
    digest: snapshotDigest(rendering.snapshot),
    refs: rendering.refs,
    snapshot: rendering.snapshot,
    roleCounts,
    ...coverage,
    ...(rendering.frames > 0 ? { frames: rendering.frames } : {}),
    ...(rendering.unreadableFrames.length > 0
      ? { unreadableFrames: rendering.unreadableFrames }
      : {}),
    status: "captured",
  };

  const written = writeSnapshotArtifact(options.context, artifact, sequence);
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
      tab,
      tool,
      ...(rendering.frames > 0 ? { frames: rendering.frames } : {}),
    },
  };
}

/** A fresh snapshot of an open tab and the reader that checks against it, for the evaluator. */
export interface A11yLiveView {
  view: A11ySnapshotView;
  snapshot: string;
  reader: A11yCheckReader;
  close(): Promise<void>;
}

/**
 * Open a fresh read of the page at `href` in the browser at the loopback endpoint and keep the
 * connection for checks: `evaluateA11yAssertion(assertion, live.view, live.reader)`. Call
 * `close()` when done; it detaches every frame session and closes the socket.
 */
export async function openA11yLiveView(
  href: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<A11yLiveView> {
  const read = await readOwnedTab(href, env, true);
  const connection = read.connection as CdpConnection;
  return {
    view: { digest: snapshotDigest(read.rendering.snapshot), refs: read.rendering.refs },
    snapshot: read.rendering.snapshot,
    reader: createCdpCheckReader(connection, read.rendering.handles, read.sessions),
    async close() {
      await releaseForest(connection, read.sessions);
      connection.close();
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

  const observer: SessionObserver = {
    effect: A11Y_SNAPSHOT_EFFECT,
    intent: "read the page's accessibility tree as a second observation channel",
    required: options.required,

    async run(session: Session): Promise<A11ySnapshotObservation> {
      let result: CaptureResult;
      try {
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
      status: first?.status ?? "unavailable",
      ...(first?.reason ? { reason: first.reason } : {}),
    },
  };
}
