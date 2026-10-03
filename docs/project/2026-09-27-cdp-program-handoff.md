---
summary: "Archived 2026-09-27 CDP handoff: historical implementation/proof record and superseded operating instructions; maintenance AK6575."
read_when:
  - "You need the dated CDP implementation history, not current execution instructions."
type: "handoff"
status: "archived"
task_id: 6575
---

# Handoff: the CDP channel program, and what comes next (2026-09-27)

> **Archived historical snapshot, not live execution guidance.** The statements below describe
> 2026-09-27. AK readback on 2026-10-03 confirms tasks 6161–6165 are done. Current Git/AK,
> repository `AGENTS.md` and source-owned runtime checks determine current scope and authority.
> Do not replay the historical commands in §2: direct checkout AK gates, another harness's
> session identity, duplicate transient browser units and inline scanner suppressions are not
> current authorization or safe operating recipes. Use the admitted installed `ak` wrapper and
> your actual harness-qualified session identity. Chromium Agent supervision belongs to the
> workstation owner; follow its current
> [deployment/runbook](../../../../infra/workstation/docs/project/2026-10-03-chromium-agent-autostart.md).
> New interruption proof and its separately approved live-canary boundary are recorded in
> [AK6545's source/fixture report](2026-10-03-surf-crash-interruption.md) and
> [canary approval packet](2026-10-03-surf-crash-live-canary-plan.md).
> AK6575 owns this archival correction; it does not retroactively accept the historical proofs.

## 1. Where things stand

`main` at `899a116`, pushed, `npm run check` green (690 tests). AK has no open task for this repo
except the five below. The design record is `docs/project/2026-09-27-cdp-channel-program.md`
(read its section 3 slice results and section 4 before touching the channel), and the go/no-go
gate is `docs/project/2026-09-27-playwright-action-channel-design.md` section 4.

What landed (all live-proven on Chromium (Agent) 153, window on an unseen workspace):

| AK | What | Commit |
|---|---|---|
| #6126 | S1: `openCdpActions` - actionability wait, role/name targets, every frame, input breadth, dialogs | `6d8a61e` |
| #6131 | S2: the frame probe over CDP (nested frames confirmed, no `frame.switch`) | `8ad2344` |
| #6132 | S4: `BrowserStep.frame` - a session step runs in a frame over CDP, same ledger step | `7f9a816` |
| #6145 | S3: `surf plan --frame`, apply in the frame; frame/tab pinning; input on the element's own session | `3187100` |
| #6157 | top-document apply on the CDP channel when it binds; tab ownership proof | `899a116` |

Measured facts the code relies on (each is cited in the design doc; re-measure before changing
code that depends on it):
- Page-level input into an out-of-process frame misroutes in an unpainted window (4 of 10);
  input on the frame's own session lands 10 of 10. surf's own click is not affected (10 of 10).
- A page target's id is its main frame's id; both survive same- and cross-site navigation. An
  OOPIF keeps its frame id across its own navigation.
- `Runtime.enable` reports one default context per frame before it answers.
- `performance.timeOrigin` is equal in surf, the page world and an isolated world, and differs
  between two tabs of the same page: the tab ownership proof.

## 2. Historical operating notes — superseded, do not execute

- AK only via `~/ai-society/softwareco/owned/agent-kernel/scripts/ak-runtime-gate.sh -- <args>`;
  claim and complete with `--agent session-<your Claude session uuid>`; `--result` takes JSON.
- Per slice: design section first, red-first tests, a mutation check on every property that
  matters (mutate `dist/`, run the test, restore with `command cp -f` / `command mv -f` - `cp`
  and `mv` are interactive aliases here), `npm run check` green, live proof, then an independent
  review on `openai-codex-2/gpt-6-astra`, then commit, push through the hook, complete AK.
  Every review round so far found real defects in the submit gate; do not skip it.
- Review command (pi hangs without `</dev/null`):
  `pi -ne -e ~/.pi/agent/git/github.com/hjanuschka/pi-multi-pass/extensions/multi-sub.ts --no-session --mode json --model openai-codex-2/gpt-6-astra --thinking low -p "<prompt naming the diff file>" </dev/null`
- Live rig: the agent browser answers at `http://127.0.0.1:9222` (systemd user unit
  `chromium-agent`; if it is down: `systemd-run --user --unit chromium-agent --collect
  ~/.local/bin/chromium-agent.sh`, then move its window to workspace 5 with focus off - it must
  not steal the operator's focus). Scratch pages live in `$TMPDIR/probe-site` (`shop.html` with a
  payment form in a `localhost` frame, `payform.html`, `paid.html`, `s1.html`, `checkout.html`,
  logging variants `*-log.html`); serve them with
  `systemd-run --user --unit probe-site --collect --working-directory=$TMPDIR/probe-site python3 -m http.server 18766 --bind 127.0.0.1`
  and stop the unit when done. Live scripts from this program are in `$TMPDIR/livetest/`.
- Scratch in `$TMPDIR`, never `/tmp`. No push, release or upstream GitHub write without the
  operator's word; upstream writes go only through infra/issue-tracker `bin/it`.
- UBS pre-commit blocks on "critical" findings; a known false positive is suppressed inline
  with `// ubs:ignore -- <reason>`, never by disguising code.
- Another session may commit to this repo concurrently (one did, `09fcc0e`); check
  `git status` / `git log` before committing and never commit what you did not change.

## 3. Historical next-task list — now completed in AK

1. **AK #6161 (P1) - dialogs during apply.** The CDP route opens actions with the default
   `dialogs: "dismiss"` (`src/core/cdp-step-transport.ts`, `openForSession`). A
   `confirm("Pay?")` on submit is dismissed silently, the submit does not happen, and the run
   ends `unknown` with no word of the dialog. Start: a red test in
   `tests/surf_apply_cdp_contract.test.mjs` with an element `dialog` in the fake
   (`fake-cdp-dom.mjs` models it), then decide the policy (refuse before input where possible;
   otherwise record the dialog in the receipt and fail the step). Live on a page with confirm().
2. **AK #6162 (P1) - tokenized frame URLs.** Frames are matched by exact URL (`frameOf` in
   `src/core/cdp-actions.ts`); real payment/login iframes carry per-session query tokens, so
   the plan's frame URL does not exist at apply time. Measure on a real tokenized embed first;
   then address frames by owner iframe selector or by origin+path, bind that in the token
   (`approvalTokenContent` in `src/core/surf-plan.ts`), and keep the per-run document check
   exact. The schema refinements for `target.frame` must follow.
3. **AK #6163 (P2) - shadow DOM fields.** The plan probe refuses them as unreachable. Needs
   piercing locators in the probe, read-back, observe and the CDP acts, and the fingerprint.
4. **AK #6164 (P2) - `surf flow`.** The reserved action; multi-step LLM-written flows are the
   gate's reopen condition for moving explore/test steps onto the channel. Design package first.
5. **AK #6165 (P3) - plan probe over CDP** for top-document plans (speed; same tab proof).

## 4. Known residuals (accepted, documented)

- Two CDP round trips remain between the document check and the input (check-then-act).
- On the surf fallback path (no DevTools endpoint) top-document acts have no document check;
  the envelope's `result.channel` and a note say so.
- `src/core/cdp-worlds.ts` lines 28-30: a guard for a frame without an id, which the readers
  never produce; uncovered by design.
