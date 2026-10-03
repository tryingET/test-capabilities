/**
 * One surf command of a SurfSession: what it carries and what it answers (AK #6221 moved these
 * out of `surf-session.ts`). A command goes through the session's `surf --stdio` process when it
 * has one and as its own surf process otherwise; the answer is the same reply either way.
 */

import type { SessionReply } from "./browser-session.js";
import { runSurfCommandVia, startSurfStdio } from "./surf-adapter.js";
import type { SurfCommandResult, SurfRuntimeProbe, SurfRuntimeResolution } from "./surf-runtime.js";
import { translateSurfArgs } from "./surf-runtime.js";
import { surfTransportLost } from "./surf-session-interruption.js";
import type { SurfStdio } from "./surf-stdio.js";

/** The page-side script of a step, when the command carries one. */
export function scriptOf(command: string, args: readonly string[]): string | undefined {
  if (command === "js") {
    return args.find((arg) => !arg.startsWith("--"));
  }
  const index = args.indexOf("--code");
  return index >= 0 ? args[index + 1] : undefined;
}

export function replyFrom(
  command: string,
  args: readonly string[],
  result: SurfCommandResult,
): SessionReply {
  return {
    command,
    args,
    display: result.commandDisplay,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code,
    outcome: result.outcome,
    ok: result.ok,
    ...(result.failure ? { failure: result.failure } : {}),
  } as SessionReply;
}

/** A reply as the command result a `SurfCommandError` carries. */
export function resultOf(reply: SessionReply): SurfCommandResult {
  return {
    ok: reply.ok,
    code: reply.exitCode,
    stdout: reply.stdout,
    stderr: reply.stderr,
    commandDisplay: [...reply.display],
    outcome: reply.outcome,
    ...(reply.failure ? { failure: reply.failure } : {}),
  };
}

/** Run a session's command and shape its reply. */
export async function runSessionCommand(
  stdio: SurfStdio | undefined,
  resolution: SurfRuntimeResolution,
  command: string,
  args: readonly string[],
  options: Parameters<typeof runSurfCommandVia>[3],
): Promise<{ result: SurfCommandResult; reply: SessionReply }> {
  const result = await runSurfCommandVia(
    stdio,
    resolution,
    translateSurfArgs(command, [...args]),
    options,
  );
  return { result, reply: replyFrom(command, args, result) };
}

/**
 * A session's way to surf: its `surf --stdio` process, started at its first command when surf
 * has one, else one surf process per command. When the process ends early the session says so,
 * once, as soon as it is known; closing ends it.
 */
export class SessionTransport {
  private stdio: SurfStdio | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly runtime: { resolution: SurfRuntimeResolution; probe: SurfRuntimeProbe },
    private readonly notes: string[],
    private readonly assertActive: () => void = () => {},
    private readonly interrupt: (reason: string) => void = () => {},
  ) {}

  run(command: string, args: readonly string[], options: Parameters<typeof runSurfCommandVia>[3]) {
    // Serialize through classification/invalidation too: a queued unsent command must not
    // escape to CLI fallback while the preceding sent command is being declared lost.
    const pending = this.tail.then(async () => {
      this.assertActive();
      if (this.stdio === undefined && this.runtime.probe.mechanisms.stdio) {
        this.stdio = startSurfStdio(this.runtime.resolution);
      }
      const answer = await runSessionCommand(this.stdio, this.runtime.resolution, command, args, {
        ...options,
        assertActive: this.assertActive,
      });
      if (surfTransportLost(answer.result))
        this.interrupt(answer.result.failure?.code ?? "surf transport lost");
      this.noteEnd();
      return answer;
    });
    this.tail = pending.catch(() => undefined);
    return pending;
  }

  async close(): Promise<void> {
    await this.stdio?.close();
    this.noteEnd();
  }

  private noteEnd(): void {
    const early = this.stdio?.endedEarly();
    const note = `surf --stdio ended early (${early}); CLI fallback is available only for unsent commands on an uninterrupted session.`;
    if (early && !this.notes.includes(note)) this.notes.push(note);
  }
}
