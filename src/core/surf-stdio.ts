/**
 * `surf --stdio` as a SurfSession's transport (AK #6221; design
 * `docs/project/2026-09-29-surf-speed-design.md` section 4): one long-lived surf process runs every
 * surf command of the session, so each saves the ~45 ms a new surf process spends starting.
 *
 * surf runs each request through its own CLI code, unchanged, and answers what `surf <argv>`
 * would have printed; this module turns the answer into the same raw result a spawned surf
 * returns, so classification, the ledger and receipts are the same either way. What the session
 * refuses runs as its own process.
 *
 * A command is sent once the session said it is ready and the command before it was answered, and
 * its time starts then: so at any moment at most one command can have run in the session without
 * an answer. When the session ends, that one is in doubt, as a surf process killed mid-command
 * is; every other was never sent, and runs as its own process.
 */

import type { Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import type { RawResult } from "./result-classification.js";

/** The child a session talks to; it is started by the surf adapter's spawn transport. */
export interface SurfStdioChild {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown;
  once(event: "close", listener: () => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
  ref(): void;
  unref(): void;
}

/** how long past a command's own budget a silent session is waited for */
const GRACE_MS = 2_000;
/** how long a closing session is given to end on its own, and then to end on SIGTERM */
const CLOSE_MS = 2_000;

interface Reply {
  id?: number | null;
  ready?: boolean;
  code?: number | null;
  stdout?: string;
  stderr?: string;
  refused?: boolean;
  timedOut?: boolean;
  overflowed?: boolean;
  signal?: string;
}

/** A command's answer: what it printed and how it ended, or that it must run as its own process. */
export type StdioAnswer = { raw: RawResult } | { refused: true };

interface Waiting {
  argv: readonly string[];
  timeoutMs: number;
  settle: (answer: StdioAnswer) => void;
}

interface Sent extends Waiting {
  id: number;
  started: number;
  timer: NodeJS.Timeout;
}

export class SurfStdio {
  private readonly child: SurfStdioChild;
  private readonly maxBuffer: number | undefined;
  private readonly waiting: Waiting[] = [];
  private sent: Sent | undefined;
  private startTimer: NodeJS.Timeout | undefined;
  private readonly exited: Promise<void>;
  private nextId = 1;
  private buffer = "";
  private stderr = "";
  private ready = false;
  private ended: string | undefined;

  private constructor(child: SurfStdioChild, maxBuffer: number | undefined) {
    this.child = child;
    this.maxBuffer = maxBuffer;
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.read(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4096);
    });
    this.child.stdin.on("error", () => {});
    this.exited = new Promise((resolve) => {
      this.child.once("error", (error) => {
        this.stop(`it did not start (${error.message})`, "SESSION_EXIT");
        resolve();
      });
      this.child.once("exit", (code, signal) => {
        // what it wrote before it exited is read first: its pipes close once drained (bounded,
        // for a pipe something else still holds open)
        const ended = () => {
          clearTimeout(bound);
          this.stop(`it exited (${signal ?? `code ${code}`})`, signal ?? "SESSION_EXIT");
          resolve();
        };
        const bound = setTimeout(ended, CLOSE_MS);
        this.child.once("close", ended);
      });
    });
    this.idle();
  }

  /**
   * `maxBuffer`: the bytes of stdout and stderr together past which the session ends a command,
   * as the spawn path's `spawnSync` kills it there.
   */
  static attach(child: SurfStdioChild, options: { maxBuffer?: number } = {}): SurfStdio {
    return new SurfStdio(child, options.maxBuffer);
  }

  /** Why this session ended before it was closed, if it did: the rest ran as separate processes. */
  endedEarly(): string | undefined {
    return this.ended === undefined || this.ended === "closed" ? undefined : this.ended;
  }

  run(argv: readonly string[], timeoutMs: number): Promise<StdioAnswer> {
    if (this.ended !== undefined) return Promise.resolve({ refused: true });
    this.busy();
    if (!this.ready && this.startTimer === undefined) {
      // a session that is not ready within the first command's budget was sent nothing
      this.startTimer = setTimeout(
        () => this.giveUp(`it was not ready within ${timeoutMs + GRACE_MS} ms`),
        timeoutMs + GRACE_MS,
      );
    }
    return new Promise((settle) => {
      this.waiting.push({ argv, timeoutMs, settle });
      this.send();
    });
  }

  /** End the session: it finishes the command it runs, if any, and exits; or it is ended. */
  async close(): Promise<void> {
    if (this.ended === undefined) this.ended = "closed";
    this.busy();
    this.child.stdin.end();
    const term = setTimeout(() => this.child.kill("SIGTERM"), CLOSE_MS);
    const kill = setTimeout(() => this.child.kill("SIGKILL"), 2 * CLOSE_MS);
    await this.exited;
    clearTimeout(term);
    clearTimeout(kill);
  }

  /** The next waiting command goes out once the session is ready and has answered the last. */
  private send(): void {
    if (!this.ready || this.sent !== undefined || this.ended !== undefined) return;
    const next = this.waiting.shift();
    if (next === undefined) return;
    const id = this.nextId++;
    const budget = next.timeoutMs + GRACE_MS;
    // no answer past the command's budget: the session is given up, the command in doubt
    const timer = setTimeout(
      () => this.giveUp(`it did not answer within ${budget} ms`, true),
      budget,
    );
    this.sent = { ...next, id, started: Date.now(), timer };
    const { argv, timeoutMs } = next;
    const request = {
      id,
      argv,
      timeoutMs,
      ...(this.maxBuffer ? { maxBuffer: this.maxBuffer } : {}),
    };
    this.child.stdin.write(`${JSON.stringify(request)}\n`);
  }

  private giveUp(why: string, timedOut = false): void {
    this.stop(why, "SESSION_EXIT", timedOut);
    this.child.kill("SIGKILL");
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      let reply: Reply;
      try {
        reply = JSON.parse(line) as Reply;
      } catch {
        continue;
      }
      if (reply.ready === true) {
        this.ready = true;
        clearTimeout(this.startTimer);
        continue;
      }
      const sent = this.sent;
      if (sent === undefined || reply.id !== sent.id) continue;
      this.sent = undefined;
      clearTimeout(sent.timer);
      if (reply.refused === true) {
        sent.settle({ refused: true });
      } else {
        sent.settle({
          raw: {
            source: "surf",
            exitCode: reply.timedOut === true || reply.signal ? null : (reply.code ?? null),
            ...(reply.signal ? { signal: reply.signal } : {}),
            stdout: reply.stdout ?? "",
            stderr: reply.stderr ?? "",
            durationMs: Date.now() - sent.started,
            ...(reply.timedOut === true ? { timedOut: true } : {}),
          },
        });
      }
      // a session that answered a timeout or an overflow ends itself: what waits was never sent
      if (reply.timedOut === true) this.stop("a command timed out", "SESSION_EXIT");
      if (reply.overflowed === true)
        this.stop("a command's output passed its buffer", "SESSION_EXIT");
    }
    this.send();
    if (this.sent === undefined && this.waiting.length === 0) this.idle();
  }

  /**
   * The session ended: the command it was sent and did not answer is in doubt; the ones never
   * sent go to their own processes.
   */
  private stop(why: string, signal: string, timedOut = false): void {
    if (this.ended === undefined) this.ended = why;
    clearTimeout(this.startTimer);
    const sent = this.sent;
    this.sent = undefined;
    if (sent !== undefined) {
      clearTimeout(sent.timer);
      sent.settle({
        raw: {
          source: "surf",
          exitCode: null,
          ...(timedOut ? { timedOut: true } : { signal }),
          stdout: "",
          stderr: `surf --stdio ended while this command ran: ${why}${this.stderr ? `\n${this.stderr}` : ""}`,
          durationMs: Date.now() - sent.started,
        },
      });
    }
    for (const waiting of this.waiting.splice(0)) waiting.settle({ refused: true });
    this.idle();
  }

  /** A pending answer keeps this process waiting for it; an idle session keeps nothing alive. */
  private busy(): void {
    this.child.ref();
    for (const pipe of this.pipes()) pipe.ref();
  }

  private idle(): void {
    this.child.unref();
    for (const pipe of this.pipes()) pipe.unref();
  }

  private pipes(): Socket[] {
    const { stdin, stdout, stderr } = this.child;
    return [stdin, stdout, stderr] as unknown as Socket[];
  }
}
