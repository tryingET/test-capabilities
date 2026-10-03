/**
 * `surf --stdio` as a SurfSession's transport (AK #6221; design
 * `docs/project/2026-09-29-surf-speed-design.md` section 4): one long-lived surf process runs every
 * surf command of the session, so each saves the ~45 ms a new surf process spends starting.
 *
 * surf runs each request through its own CLI code, unchanged, and answers what `surf <argv>`
 * would have printed; this module turns the answer into the same raw result a spawned surf
 * returns, so classification, the ledger and receipts are the same either way. An unsent refusal
 * may use the CLI only while the owning SurfSession still has authority.
 *
 * A command is sent once the session said it is ready and the command before it was answered, and
 * its time starts then: so at any moment at most one command can have run in the session without
 * an answer. When the session ends, that one is in doubt, as a surf process killed mid-command
 * is; every other was never sent. Sent loss terminalizes the owning session, so its queued work
 * cannot escape to CLI fallback. Malformed JSON/shape is lost transport truth, not a reply.
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

/** Decode untrusted JSON before it can acknowledge/refuse a possibly mutating command. */
function isReply(value: unknown): value is Reply {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const reply = value as Record<string, unknown>;
  for (const key of ["ready", "refused", "timedOut", "overflowed"]) {
    if (reply[key] !== undefined && typeof reply[key] !== "boolean") return false;
  }
  for (const key of ["stdout", "stderr", "signal"]) {
    if (reply[key] !== undefined && typeof reply[key] !== "string") return false;
  }
  if (reply.signal === "") return false;
  if (reply.ready !== undefined) {
    return (
      reply.ready === true &&
      (reply.id === undefined || reply.id === null) &&
      ["code", "stdout", "stderr", "refused", "timedOut", "overflowed", "signal"].every(
        (key) => reply[key] === undefined,
      )
    );
  }
  if (typeof reply.id !== "number" || !Number.isSafeInteger(reply.id) || reply.id < 1) return false;
  const loss = reply.timedOut === true || reply.overflowed === true || reply.signal !== undefined;
  const code = reply.code;
  // A refusal grants CLI fallback only when it unambiguously says the command was unsent.
  if (reply.refused === true) {
    return (
      !loss &&
      (code === undefined || (typeof code === "number" && Number.isInteger(code) && code > 0))
    );
  }
  if (code === null) return loss;
  return typeof code === "number" && Number.isInteger(code) && code >= 0 && !loss;
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

  /** Why this transport ended early; sent loss is terminal for the owning SurfSession. */
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
    // Drain on intentional close, but never revive a stream whose replies already lost trust.
    if (this.ended !== undefined && this.ended !== "closed") return;
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      let reply: unknown;
      try {
        reply = JSON.parse(line);
      } catch {
        this.giveUp("malformed JSON reply");
        return;
      }
      if (!isReply(reply)) {
        this.giveUp("malformed reply shape");
        return;
      }
      if (reply.ready === true) {
        if (this.ready) {
          this.giveUp("malformed repeated ready reply");
          return;
        }
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
            // A buffer-loss reply without an OS signal still lost the result, not a target fault.
            ...(reply.signal
              ? { signal: reply.signal }
              : reply.overflowed === true
                ? { signal: "SESSION_EXIT" }
                : {}),
            stdout: reply.stdout ?? "",
            stderr: reply.stderr ?? "",
            durationMs: Date.now() - sent.started,
            ...(reply.timedOut === true ? { timedOut: true } : {}),
          },
        });
      }
      // Every answered loss terminalizes the transport before queued work can be sent.
      if (reply.timedOut === true) this.stop("a command timed out", "SESSION_EXIT");
      if (reply.overflowed === true)
        this.stop("a command's output passed its buffer", "SESSION_EXIT");
      if (reply.signal) this.stop(`a command ended by ${reply.signal}`, reply.signal);
      if (this.ended !== undefined) return;
    }
    this.send();
    if (this.sent === undefined && this.waiting.length === 0) this.idle();
  }

  /**
   * The session ended: the command it was sent and did not answer is in doubt; the ones never
   * sent are refused. The owner decides whether unsent fallback still has authority.
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
