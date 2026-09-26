/**
 * The a11y snapshot observer: a read-only `Session.observe` step over the tab a surf run
 * already owns (a11y-snapshot packet, "Session and tab binding" and "Snapshot artifact";
 * slice S9; producer switched to surf under AK #5915).
 *
 * One step: `page.read --structure --full-page --no-text --nodes` in the owned tab, through the
 * session like every other surf read, so it is tab-scoped, ledgered and classified by the same
 * rules. The tree is structure (controls, headings, landmarks) across the whole page and does not
 * depend on the window size; `--nodes` makes it a full snapshot with no diff footer, so the text
 * is the page's and nothing else's, and its digest is content identity.
 *
 * What the agent-browser producer needed and this one does not: a second binary, a CDP endpoint
 * and its loopback rule, binding the tab by target id, a pinned session with a teardown order,
 * and the accounting of the page that session stranded (AK #5567). Reading through the tool that
 * owns the tab removes all of it.
 */

import path from "node:path";
import {
  A11Y_CHANNEL,
  A11Y_PAGE_READ_ARGS,
  A11Y_SNAPSHOT_KIND,
  A11Y_SNAPSHOT_SCHEMA_VERSION,
  type A11yDomProbeCounts,
  type A11ySnapshotArtifact,
  type A11ySnapshotObservation,
  parseA11ySnapshotPayload,
  roleCountsFrom,
  semanticCoverageFrom,
  snapshotDigest,
} from "./a11y-snapshot.js";
import { writeJsonArtifactSync } from "./artifacts.js";
import type { Session, SessionObserver, SessionReply } from "./browser-session.js";
import type { EffectDeclaration } from "./effects.js";
import type { RunContext } from "./run-context.js";
import { FrameworkError, isFrameworkError } from "./runtime-contract.js";
import { parseSurfJsonOutput } from "./surf-runtime.js";

/** The artifact kind the snapshot file is written under (listable next to receipts). */
export const A11Y_SNAPSHOT_ARTIFACT_KIND = "test-capabilities.a11y.snapshot";
export const A11Y_SNAPSHOT_OBSERVER_NAME = "a11y-snapshot";

/**
 * Read-only on the target and on the browser: one `page.read` in the tab this run already owns.
 * It opens, navigates and clicks nothing, and it starts no second tool.
 */
export const A11Y_SNAPSHOT_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason:
    "reads the accessibility tree of the tab this run owns through surf page.read; it opens, navigates and clicks nothing",
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
  /** the surf version the run resolved, recorded as the producer version */
  toolVersion?: string;
}

export interface A11ySnapshotObserverHandle {
  observer: SessionObserver;
  /** what this observer saw, in the shape the page result carries; set on every path */
  observation(): A11ySnapshotObservation | undefined;
}

const PAGE_READ_COMMAND = `surf page.read ${A11Y_PAGE_READ_ARGS.join(" ")}`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeHref(href: string): string {
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    return href;
  }
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
  const href = session.readiness?.href ?? session.url;
  const startedAt = Date.now();
  const reply = await session.step<SessionReply>({
    id: "a11y.snapshot",
    command: "page.read",
    args: [...A11Y_PAGE_READ_ARGS],
    intent: `read the accessibility tree of ${href} without acting on it`,
    read: (value) => value,
  });

  let payload: unknown;
  try {
    payload = parseSurfJsonOutput(reply.stdout, "page.read").data;
  } catch (error) {
    return unavailable("snapshot_failed", errorMessage(error));
  }
  const parsed = parseA11ySnapshotPayload(payload);
  if ("error" in parsed) {
    return unavailable(
      parsed.error,
      parsed.error === "empty_snapshot"
        ? `The accessibility tree of ${href} is empty (${parsed.detail}). An empty tree is a failure, never a zero-element success: either the page carries no named controls at all, or the read did not reach it.`
        : parsed.error === "surf_page_read_unsupported"
          ? `The resolved surf cannot give the structured tree (${parsed.detail}). The a11y channel needs page.read --nodes (surf-cli branch feat/page-read-nodes, adopted by the workstation build).`
          : `The a11y snapshot of ${href} answered a shape this channel cannot read: ${parsed.detail}.`,
    );
  }

  const reading = parsed.reading;
  if (normalizeHref(reading.origin) !== normalizeHref(href)) {
    return unavailable(
      "origin_mismatch",
      `The a11y snapshot reports ${reading.origin || "(no URL)"} while the gated page is ${href}. The page moved between the readiness gate and the snapshot, so the tree describes something this run never gated.`,
    );
  }

  const roleCounts = roleCountsFrom(reading.refs);
  const coverage = semanticCoverageFrom(roleCounts, options.domCounts?.());
  const tab = {
    ...(session.tab ? { surfTabId: session.tab.id } : {}),
    url: reading.origin,
    title: reading.title,
  };
  const tool = { command: PAGE_READ_COMMAND, version: options.toolVersion ?? "" };
  const artifact: A11ySnapshotArtifact = {
    schemaVersion: A11Y_SNAPSHOT_SCHEMA_VERSION,
    kind: A11Y_SNAPSHOT_KIND,
    channel: A11Y_CHANNEL,
    tool,
    tab,
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
