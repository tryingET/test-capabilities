---
summary: "AK6221/6545 live tests in the agent Chromium (owner docket 2026-10-06): fresh before/after speed benchmark, including the stdio build briefly installed; a no-fault live rehearsal of the interruption contract; the crash canary prepared but refused by the session classifier; one unrelated umask defect found (AK6748)."
read_when:
  - "You continue AK6221 speed acceptance or the AK6545 crash canary."
  - "You need the live numbers behind the surf speed claim."
type: reference
task_id: 6221
---

# Surf live tests — 2026-10-06

**Authority.** Owner docket 2026-10-06, `surf-live-tests` = A: live tests in the dedicated agent
Chromium only. The agent browser had been stopped since 2026-10-04 and was started through its unit.

**AK6221 speed.** `bench2.sh` (11 interleaved runs, fresh CLI per run) on isolated exports of
`1ab2304` (before) and `9bb568c` (after). With the stdio-capable surf CLI `44a6e83`: plan -39 %
(DevTools) and -42 % (surf), apply -33 %, flow -12 %. With the installed `70fd595`, which lacks
`--stdio`: -12 %, -13 %, -10 %, -4 %. While the workstation's AK6546 promotion test had `44a6e83`
installed, `bench3.sh` with no override gave -40 %, -42 %, -30 % and -15 %. Plan clears the design
gate; flow does not reach 30 %. Lazy operation loading and the overlap are not built: by
measurement they are worth at most about 25 ms together. Recorded in the
[speed design](../docs/project/2026-09-29-surf-speed-design.md).

**AK6545 interruption.** A loopback barrier page (a synchronous XHR that never gets an answer) held a
flow click's `Input.dispatchMouseEvent` reply open. After the 15 s budget the click settled
`unknown` in a durable receipt. The server saw one entry, and there was no `tab.close` and no
replay. The SIGKILL canary itself was refused by this session's auto-mode classifier. Its runner is
prepared at `~/.local/state/pi-quests/tmp/surf-live-1be8c1a7/canary/canary.sh`. See the
[interruption record](../docs/project/2026-10-03-surf-crash-interruption.md).

**Found on the way.** The source-freeze `npm run check` under heavy-job had 1044 passes and one
failure: `healing_contract` "preserves target file mode". Heavy-job runs with umask 077, and the
healer's `fs.open(tmp, "wx", mode)` is masked by it. That is AK6748, not this slice.

Evidence: `~/.local/state/pi-quests/tmp/surf-live-1be8c1a7/`; AK evidence 14033, 14040 (6221) and
14042, 14051 (6545).
