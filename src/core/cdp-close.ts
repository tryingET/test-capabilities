import type { CdpConnection } from "./a11y-cdp.js";

export const CDP_CLOSE_TIMEOUT_MS = 1000;
const validTimeout = (ms: number) => Number.isFinite(ms) && ms > 0 && ms <= 2_147_483_647;

/** Wait for the native client's close event, not the peer's TCP teardown. No forced close API. */
export function waitForCdpClose(
  socket: WebSocket,
  timeoutMs = CDP_CLOSE_TIMEOUT_MS,
): Promise<void> {
  if (!validTimeout(timeoutMs)) {
    socket.close();
    return Promise.reject(
      new Error("DevTools close timeout must be finite, positive and timer-safe"),
    );
  }
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("close", completed);
    };
    const completed = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`the DevTools socket did not close within ${timeoutMs} ms`));
    }, timeoutMs);
    socket.addEventListener("close", completed, { once: true });
    try {
      socket.close();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Preparation is bounded too; a late rejection remains observed by the race. */
async function prepareWithin(prepare: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(prepare),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`DevTools close preparation did not finish within ${timeoutMs} ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Cache the entire outcome. Always initiate socket close, including after preparation failure. */
export function cdpCloseOnce(
  connection: CdpConnection,
  prepare: () => Promise<void>,
  timeoutMs = CDP_CLOSE_TIMEOUT_MS,
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    closing ??= (async () => {
      if (!validTimeout(timeoutMs)) {
        connection.close();
        throw new Error("DevTools close timeout must be finite, positive and timer-safe");
      }
      let prepFailed = false;
      let prepError: unknown;
      try {
        await prepareWithin(prepare, timeoutMs);
      } catch (error) {
        prepFailed = true;
        prepError = error;
      }
      try {
        await connection.closeAndWait(timeoutMs);
      } catch (error) {
        if (!prepFailed) throw error;
      }
      if (prepFailed) throw prepError;
    })();
    return closing;
  };
}

/** Both cleanups run. A primary operation error wins; otherwise the first cleanup error wins. */
export async function closeCdpAndOwnedTab(
  release: () => Promise<void>,
  closeTab: () => Promise<void>,
  operationFailed: boolean,
): Promise<void> {
  let cleanupFailed = false;
  let cleanupError: unknown;
  for (const cleanup of [release, closeTab]) {
    try {
      await cleanup();
    } catch (error) {
      if (!cleanupFailed) cleanupError = error;
      cleanupFailed = true;
    }
  }
  if (cleanupFailed && !operationFailed) throw cleanupError;
}
