/**
 * Dialogs an action opens on the owned tab (CDP program S1; AK #6161): every session that hosts a
 * frame reports them, and each is answered by the policy - `dismiss` (default), `accept`, or `fail`,
 * which dismisses too and marks the dialog for the action that opened it to refuse. An answer the
 * browser rejects is marked the same way: a dialog left open is never a success.
 */

import type { CdpConnection } from "./a11y-cdp.js";

export interface CdpDialogRecord {
  type: string;
  message: string;
  url: string;
  answer: "accepted" | "dismissed" | "unanswered";
}

/** What an action consults: the records, the answers still in flight, and the one to refuse. */
export interface DialogWatch {
  readonly records: CdpDialogRecord[];
  /** resolves once every answer sent so far has been acknowledged or refused */
  settled(): Promise<unknown>;
  /** the dialog the `fail` policy (or a refused answer) marked, if any */
  failing(): CdpDialogRecord | undefined;
  /** take the marked dialog: the action raising it clears it */
  takeFailing(): CdpDialogRecord | undefined;
  off(): void;
}

export function watchDialogs(
  connection: CdpConnection,
  policy: "dismiss" | "accept" | "fail",
  promptText: string | undefined,
): DialogWatch {
  const records: CdpDialogRecord[] = [];
  const pending = new Set<Promise<void>>();
  let failing: CdpDialogRecord | undefined;
  const off = connection.on("Page.javascriptDialogOpening", (params, sessionId) => {
    const accept = policy === "accept";
    const record: CdpDialogRecord = {
      type: String(params.type ?? ""),
      message: String(params.message ?? ""),
      url: String(params.url ?? ""),
      answer: "unanswered",
    };
    records.push(record);
    if (policy === "fail") failing = record;
    const answering = connection
      .send(
        "Page.handleJavaScriptDialog",
        { accept, ...(accept && promptText !== undefined ? { promptText } : {}) },
        sessionId,
      )
      .then(() => {
        record.answer = accept ? "accepted" : "dismissed";
      })
      .catch(() => {
        failing = record;
      });
    pending.add(answering);
    void answering.then(() => pending.delete(answering));
  });
  return {
    records,
    settled: () => Promise.all(pending),
    failing: () => failing,
    takeFailing() {
      const taken = failing;
      failing = undefined;
      return taken;
    },
    off,
  };
}
