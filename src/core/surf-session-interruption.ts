/** Terminal transport loss is not a new browser binding or permission to replay (AK #6545). */
import { FrameworkError } from "./runtime-contract.js";
import type { SurfCommandResult } from "./surf-runtime.js";

/** A spawn/startup refusal sent nothing; timeout/signal results from sent commands did. */
export function surfTransportLost(result: SurfCommandResult): boolean {
  const code = result.failure?.code;
  return (
    code === "no_tab" ||
    (result.code === null && (code === "timeout" || code?.startsWith("signal_") === true))
  );
}

export class SessionInterruption {
  private reason: string | undefined;

  get interrupted(): boolean {
    return this.reason !== undefined;
  }

  interrupt(reason: string): void {
    this.reason ??= reason;
  }

  assertActive(): void {
    if (this.reason !== undefined) {
      throw new FrameworkError(
        "surf_session_interrupted",
        `Browser transport lost (${this.reason}); this session cannot be reused. Initialize a NEW owned-page/session explicitly. Pending mutations remain unknown and must not be replayed.`,
      );
    }
  }

  /** An internal read retry must keep the first pending error, without reaching any transport. */
  guardAttempt<T>(body: (attempt: number) => Promise<T>): (attempt: number) => Promise<T> {
    let original: { error: unknown } | undefined;
    return async (attempt) => {
      if (this.interrupted && original) throw original.error;
      this.assertActive();
      try {
        return await body(attempt);
      } catch (error) {
        if (this.interrupted) original ??= { error };
        throw error;
      }
    };
  }
}
