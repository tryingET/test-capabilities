---
summary: "AK6545 approval packet for a future owned-page browser-loss canary; no live fault execution or AK6536 acceptance."
read_when:
  - "Approving the live browser interruption proof after source/fixture qualification."
  - "Checking which disruptive effects remain prohibited."
type: reference
---

# Surf crash canary — approval packet, NOT an executed proof

## Current disposition

Operator interview on 2026-10-03: prepare an owned-page fault-injection canary for later approval;
**do not execute it now**. Keep AK6536 pending for an independent acceptance ruling. Leave the
installed school-ASR unit unchanged; its separately qualified source repair is AK6571.

AK6545 has source/fixture interruption proof. The teardown slice belongs to AK6221; its complete
speed acceptance has not been remeasured. The qualified source integration includes the explicitly
identified AK6221 persistent-transport prerequisite; Git/AK evidence owns its delivery identity.
No live canary runner was implemented or invoked by this packet. The sequence below specifies
what a future runner/receiver must prove, not completed behavior or permission to perform it.

## Status 2026-10-06

The owner approved one deliberate crash test in the agent Chromium (owner docket 2026-10-06,
`surf-live-tests` = A). A runner implementing the sequence below is prepared and **not executed**:
`~/.local/state/pi-quests/tmp/surf-live-1be8c1a7/canary/canary.sh`, with `canary_server.py`
(server-observed barrier, withheld reply) and an argv-logging surf wrapper. The executing session's
auto-mode classifier refused the SIGKILL step, so it waits for the operator to run it or to grant
that permission. A no-fault rehearsal of the same barrier proved the budget path live (see the
[interruption record](2026-10-03-surf-crash-interruption.md)). The source-freeze aggregate check at
`9bb568c` had one failure unrelated to surf, caused by heavy-job's umask (AK6748).

## Admission before any disruptive command

1. Freeze the exact landed source/build identity and rerun the declared aggregate check for this
   canary. AK6574's root-only generated-state boundary and the fresh source slice passed
   `npm run check` (915 pass, 1 existing opt-in skip); this historical source qualification is
   not proof that a future build or live canary has been admitted.
2. Obtain an explicit operator authorization naming **AK6545, the dedicated Chromium Agent,
   one actual SIGKILL, the owned loopback canary page, and an exclusive browser window**.
   Generic `proceed` is not this authorization. Confirm no other worker/test/tab needs this
   browser; its entire dedicated cgroup/tabs will be affected, not just the canary tab.
3. Prepare an isolated loopback-only fixture server on a checked-free port. Use a unique nonce in
   the page URL and fixture receipts. Serve no personal files and make no external requests.
   The fixture must provide a server-observed entered barrier and withhold its response, so the
   mutation really reached the owned page while its CDP reply remains unanswered.
4. Keep the actual receipt store durable and private (0700 directory/0600 files). A new session
   does not reset ambiguous mutation/submit history. Never remove a receipt to get a green run.
5. Prepare an observer/receiver that records the fault, browser invocation/PID changes, first
   error/receipt, absence of automatic replay/rebind, and later explicit fresh-session proof.
   Failure or effect indeterminacy stops the sequence; it is not permission to rerun the fault.

## Exact read-only preflight commands

From the workstation owner checkout:

```bash
cd /home/tryinget/ai-society/softwareco/infra/workstation
ak task show 6545
systemctl --user show chromium-agent.service chromium-agent-ready.service chromium-agent-bus.service \
  -p Id -p ActiveState -p SubState -p MainPID -p InvocationID -p ControlGroup -p NRestarts
python3 runtime/chromium-agent/check.py health
surf doctor --browser chromium --json
curl --noproxy '*' --max-time 3 http://127.0.0.1:9222/json/version
```

Require exclusive dedicated profile/cgroup/listener/current-build host attribution, not merely a
reachable port. Never target 9223 (Obsidian), personal profiles, unrelated processes or global
`pkill`. Record the code/build, operator authorization and preflight output before proceeding.

## Proposed authorized sequence

- Open and prove ownership of the unique loopback canary page through a new SurfSession. Record
  its tab/target/frame bindings and readiness. An unrelated tab at the same URL is not equivalent.
- Run one explicitly declared mutating script through the ledger. It changes only the fixture
  page and enters the server barrier while its reply is withheld. Receiver confirms entry before
  the fault; an `attempting` receipt alone is not proof that input reached the page.
- Only under the exact fresh authorization and receiver barrier, the workstation owner may use:

  ```bash
  # DISRUPTIVE — NOT EXECUTED; kills the dedicated browser's main process.
  systemctl --user kill --kill-whom=main --signal=SIGKILL chromium-agent.service
  ```

- Require the first sent/unanswered mutation to settle `unknown`, with its original transport
  cause preserved. Later calls on that session must refuse `surf_session_interrupted` before
  further RPC, fallback, rebind or stale `tab.close`. Capture server-side count: exactly one
  entered action. Do not automatically replay a submit or any ambiguous mutation.
- Observe bounded service recovery and fresh startup readiness using the read-only owner checks.
  Connectivity recovery is not tab restoration, test resumption, continuous monitoring or portal
  dependency recovery. Failure to recover must remain a failed/indeterminate canary outcome.
- Explicitly initialize a NEW owned page/session, repeat ownership/readiness proof, and run a
  read-only probe. Old bindings may not be revived or matched by URL. If a submit variant is
  later approved, its original ledger/receipt history must still block replay in the new session.
- Close only freshly proven owned canary pages and stop only the fixture process started for this
  run. Retain all receipts, logs and failed attempts. Never restore/delete singleton locks or
  roll back/reinstall browser/runtime builds as automatic cleanup.

## Required proof and stop conditions

Receipts must distinguish observation, inference and effect disposition. Keep startup-only health,
source/fixture tests, actual fault effect and fresh-session success as separate evidence classes.
No passing transport check can substitute for unknown-effect/no-replay evidence.

Stop before or during execution for: missing exact authorization; other active browser users;
failed exclusive ownership; occupied fixture port; changed source/build; missing entered barrier;
unknown fault-delivery result; missing/contradictory receipt; unexpected replay/rebind; stale-tab
closure; unrelated browser impact; failed service recovery. No mechanical retry.

Actual fresh login/logout (AK6543), dependency/portal recovery (AK6544), different-build promotion
and rollback (AK6546), audio-unit deployment (AK5596), and AK6536 acceptance remain separate.
No reboot/logout, installation/configuration change, personal-profile mutation, GPU-runtime change,
external submission or acceptance is granted by this document.
