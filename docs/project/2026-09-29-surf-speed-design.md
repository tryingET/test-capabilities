---
summary: "Design (AK #6221, #6222): make surf plan/apply/flow runs at least 30% faster by removing per-command surf process starts (a persistent `surf --stdio` mode in our surf-cli fork), one runtime probe instead of two, one held DevTools connection for the plan probe, and cheaper CLI start-up - without changing what any surf command does, prints or exits with, or any ledger, ownership or submit boundary."
read_when:
  - "You change how test-capabilities starts or talks to surf, or the plan probe's DevTools binding."
  - "You change surf-cli's session mode on the fork (feat/persistent-session)."
  - "A run is slower than the numbers below, or surf answers differently in a session than from the CLI."
type: "design"
status: "design before implementation; results appended per slice"
---

# Faster surf runs: one surf process per run, one probe, one connection (AK #6221, #6222)

## 1. Measured first

Chromium (Agent) 153 at 127.0.0.1:9222, window unseen and unfocused, surf-cli 2.20.0 (`70fd595`,
`adopted`). Medians of 7 fresh CLI runs (`$TMPDIR/cdp-6221-<session>/bench.sh`):

| scenario | median |
|---|---|
| `surf plan` of two fields, DevTools channel | 532 ms |
| the same plan, surf channel (no endpoint) | 508 ms |
| `surf apply` fill of that plan | 669 ms |
| `surf flow` 14-step journey | 1450 ms |

Where a plan's time goes: our CLI starts in ~90 ms (Node ~26 ms, `index.js` ~53 ms, the CLI's own
dependencies ~22 ms). Every surf command is a new process: `surf --version` takes 46-55 ms, and
one request over surf's socket, kept open, takes 0.6-2 ms - so ~45 ms of every surf call is
surf's Node start. A run makes six: `--version` and `--help-full` (the runtime probe, every run),
`tab.new` 74, `wait.ready` 54, the tab proof or the probe `js` 50-58, `tab.close` 72-83 ms.
The plan probe itself is 7-13 ms over the DevTools connection.

## 2. What must not change

- surf's own semantics per command: how the CLI turns argv into a request (targeting, session and
  admission options), what the host does with it (its scheduler queues each request per tab, the
  `queued=` in surf's output), the output a command prints and its exit code. The CLI's file lock
  is taken only by `record`; ordinary commands are coordinated by the host. A client of our own
  would have to copy the CLI's request building and output formatting and follow every change to
  them. So the persistent mode lives in surf and runs each command through surf's unchanged code
  path; the host still sees one ordinary request per command.
- Everything after the reply: our parsing, classification, ledger steps, receipts, the tab
  ownership proof, the submit gate. A session reply is the same `{exit code, stdout, stderr}` a
  spawned `surf` produces and goes through the same classification.
- The fallback: without the session mode (an older surf, a session that fails to start or
  dies), commands run on the `surf` CLI as today.

## 3. surf side: `surf --stdio` (AK #6222, fork branch `feat/persistent-session`)

One long-lived `surf` process reads requests as JSON lines on stdin, `{"id", "argv"}`, and writes
one JSON line per request on stdout, `{"id", "code", "stdout", "stderr"}`. For each request it
runs `cli.cjs` again with that argv - the same module, the same top-level code a `surf <argv>`
process runs - with `process.argv` set, and with the process's exits, writes and exit/signal
handlers scoped to the request through `AsyncLocalStorage`:

- `process.exit(code)` inside the request ends the request with `code`, runs the exit handlers
  the request registered (`record`'s lock release among them) and unwinds, so nothing after it
  runs; an exit from a callback of an earlier, finished request changes nothing.
- `process.stdout/stderr.write` inside the request are captured into its reply; a finished
  request's late output is dropped, as a process that exited prints nothing more; the session's
  own output goes to stderr, never into the protocol stream.
- Requests run one at a time, in order. stdin belongs to the protocol: a command that would read
  stdin is refused in a session.
- The environment is the session's, fixed at start. SIGINT/SIGTERM run the current request's
  exit handlers and end the session; so does the end of stdin. A request that outlives its
  `timeoutMs` is answered `timedOut` after its exit handlers ran, and the session ends.

`surf --help-full` lists `surf --stdio` (a `Stdio Mode` section), which is how a client knows a
surf build has it. (It was first named `surf session --stdio`, which took over the spaced form
of surf's existing `session ensure|cleanup|...` commands; the fork's own tests caught it.)

## 4. test-capabilities side (AK #6221)

1. **One runtime probe.** `--help-full` alone: its first line carries the version
   (`surf v2.20.0 - ...`); `--version` runs only when it does not. ~48 ms per run.
2. **Start-up.** Node's compile cache (`module.enableCompileCache()`, off with
   `NODE_DISABLE_COMPILE_CACHE`) and the banner and spinner loaded only when shown.
3. **One held connection for the plan probe.** The bind proves the tab and holds the
   connection; the probe runs on it; it is released before the tab closes.
4. **Session transport.** When the probe's help lists `surf --stdio`, a SurfSession starts one
   `surf --stdio` child at its first surf command (`tab.new`, sent once the child says it is
   ready) and sends every command through it. The reply becomes the same raw result a spawn
   returns. A command's timeout ends the child (its handlers run first) and is reported as a
   spawn's timeout; the rest of that session runs on the CLI, with a note. A child that fails to
   start or dies does the same.
   `surf doctor` and the runtime probe stay on the CLI.
5. **Overlap.** With surf calls asynchronous, the tab proof's surf read and the DevTools
   connection's open run concurrently.

## 5. Gate

The same `bench.sh` before and after, 7 runs per scenario: the plan on the DevTools channel must
be at least 30% faster by median; apply and flow are reported as measured (a flow's acts each
write a durable receipt, ~45 ms, which stays). Live proofs: #6163, #6164 F1/F2 and #6165 results
unchanged; a session and a CLI surf answer the same commands identically, and the host sees
one ordinary request per command. Each repo's own checks, mutation checks,
independent inspection. Then, and only then, draft (not send) the upstream asks for surf-cli:
the persistent session mode, the DevTools target id of a tab `tab.new` opens, and selectors that
enter open shadow roots.

## 6. Results

### Slice 1 (test-capabilities: one probe, start-up, one held connection)

The runtime probe runs `surf --help-full` alone and reads the version from its first line
(anchored: a version elsewhere in the help is not it); `--version` runs only when that line has
none. The CLI enables Node's compile cache before it loads chalk, commander and the dist tree
(`NODE_DISABLE_COMPILE_CACHE` turns it off; the cache lives in the temp dir), and loads figlet
and ora only when a person sees them. The plan's bind holds the connection it proved the tab on
and the probe runs on it; the plan releases it in its `finally`, before `session.close()`.
Inspection round 1 found that holding changed what a dialog answered during the proof did: the
connection the bind used to close forgot it, the held one reported it to the probe. The bind now
records how many dialogs its connection saw when it hands it over, and steps count only later
ones; releasing clears that, so a later hold (a flow's) counts every dialog of its own
connection. Round 2: no defects. The release's order against surf's `tab.close` cannot be
observed by the in-process fakes while surf calls are synchronous spawns (the fake DevTools
server sees the socket close only after the blocked event loop resumes); it is tested once surf
calls are asynchronous (slice 3).

Tests red first; `npm run check` 839 passed, changed lines 40/40; mutation checks killed all 13
mutants (the anchored header, the `--version` fallback either way, the hold, the plan's release,
the dialog baseline set, used and cleared, the compile cache, figlet and ora loaded eagerly).
Live (7 runs each, medians): plan on the DevTools channel 532 → 457 ms (-14%), on surf
508 → 431 ms (-15%), apply fill 669 → 576 ms (-14%), flow journey 1450 → 1360 ms (-6%); the
first run after a build pays for filling the compile cache once (~1.1 s). #6163, #6164 F1/F2 and
#6165 live results unchanged.

### Slice 2 (surf-cli fork: `surf --stdio`, AK #6222)

Local branch `feat/persistent-session` on our fork (not pushed): `native/session.cjs` and a
three-line hand-off at the top of `native/cli.cjs`, as section 3 describes. Every inspection
finding was fixed red first in the fork's own tests (`test/unit/session.test.ts`,
and an end-to-end equivalence test over nine commands against the fake extension: the same
reply as the CLI's, `queued=` aside, and no session stderr):

- `install`/`uninstall` (a child on the inherited terminal), `server` and `--inputs-stdin` and
  `semantic*` (stdin readers), and `record` (a lock wait no timeout can interrupt) are refused,
  anywhere in argv - the CLI finds its command after leading options;
- a command that ends without `process.exit` ends when nothing it created keeps the loop alive
  (an async hook tracks its resources; promises and Node's DNS channel never count);
- the CLI's own modules load afresh per command and are dropped from the runner's children;
- every exit waits for the replies written so far (bounded to 5 s); once an exit begins, nothing
  queued starts - it is answered refused;
- the running command answers SIGINT, SIGTERM and SIGHUP with the handlers it set (a stream
  stops and exits 0; oracle prints how to recover), then its exit handlers run;
- a file argument that is the session's own stdin (`--script /dev/stdin`, `--file=/dev/fd/0`, a
  link to one; compared by device and inode) is refused: it would read the protocol
  synchronously, where no timeout reaches;
- a request may carry `maxBuffer`: past it (stdout and stderr together) the command ends at that
  write, as `spawnSync` kills its child there, and the session ends as after a timeout.

Fork: lint, `tsc` and 1205 tests pass. Mutation checks killed every mutant but two, which are
kept on purpose: the guard that never swallows the session's own exit sentinel is redundant
with the sentinel's unwinding, and the session's own output cannot reach the protocol stream on
any path the tests can drive (it goes to stderr by construction).

### Slice 3 (test-capabilities: the session transport)

`src/core/surf-stdio.ts` is the client; `spawnLongLived` in `spawn-step.ts` starts the child
(the spawn boundary holds); `surf-session-command.ts` holds the transport a SurfSession uses;
the command mapping moved unchanged from `surf-runtime.ts` to `surf-args.ts` (budget). A
command is sent once the session said it is ready and the one before was answered, timed from
then, so at most one command can have run unanswered: when a session ends, that one is in doubt
(a mutating step settles `unknown`), and every command not yet sent runs as its own process.
A session not ready within the first command's budget + 2 s was sent nothing and is killed;
`close()` escalates to SIGKILL. A reply becomes what `spawnStepSync` would have returned for the
same output (`asSpawnSyncResult`): the same 64,000-character cut, and past `spawnSync`'s buffer
(1 MiB, stdout and stderr together, strictly more - measured) the same `ENOBUFS` failure; every
request carries that buffer as its `maxBuffer`, so the session ends the command where a spawn
would have been killed. A session's end is settled once its pipes are drained (Node may report
the exit first), bounded to 2 s. The session's first end is one note on the run.

The gate's `wait.ready` now polls at 50 ms, surf's minimum. Measured with the session: surf's
default 400 ms poll, no longer hidden behind a surf process start between `tab.new` and the
gate, made the first poll miss and the flow journey ~400 ms slower than without the session.

Inspection, every finding fixed red first: round 1 four (close hang, pre-ready watchdog, queued
commands treated as running, uncapped output); round 2 two (output past spawnSync's buffer
succeeded in a session; the teardown-order test passed with no close); round 3 one (output
written after that point stayed in the result - the fork's `maxBuffer`); the exit-before-drained
race was found while fixing it. Mutation checks: 16 mutants before inspection and 24 for its
fixes, all killed (two only after their tests were tightened - a second command asked while the first runs, and a session that never
started leaving its start timer alive; one first "killed" by a syntax error was rewritten and
then killed by its test). `npm run check` 867 passed, changed lines 98.52 %.

Live (7 runs each, medians; same page, same bench):

| scenario | baseline | slice 1 | slices 1-3, session | slices 1-3, surf without `--stdio` |
|---|---|---|---|---|
| plan, DevTools channel | 532 | 457 | 299 (-44 %) | 453 |
| plan, surf channel | 508 | 431 | 285 (-44 %) | 433 |
| apply fill | 669 | 576 | 419 (-37 %) | 572 |
| flow journey | 1450 | 1360 | 1250 (-14 %) | 1325 |

The flow's remaining time is its own work: 14 steps over the DevTools connection, each act with
its durable receipt. Not done: section 4.5 (overlapping the proof's surf read with the DevTools
connection's open) - with the session a surf read costs ~5 ms, so there is little left to
overlap; loading our CLI's command registry lazily (~15 ms).

Found on the way: the flow tests' leak check looked for `4242` anywhere in receipts, and random
UUIDs contain it now and then - the intermittent F1/F2 test failure seen earlier. The check now
ignores hex runs (`LEAKED_CARD` in `tests/helpers/flow-harness.mjs`).

### Bounded teardown repair (AK #6221)

`CdpConnection.close()` remains synchronous and void; it starts closing and creates no
rejecting completion promise for existing consumers. Opt-in `closeAndWait()` waits for the
native WebSocket client's `close` event with a finite deadline. `CdpActions.close()` caches
its entire cleanup promise, including rejection, so concurrent and later callers see the
same outcome. Preparation (dialog settlement and frame release) and socket completion each
have a separate 1000 ms budget (`closeTimeoutMs` overrides both); socket close is initiated
even when preparation fails or times out. A preparation failure wins over a socket failure.
The native WebSocket has no `terminate()`: timeout rejects, removes the completion listener
and timer, and does **not** claim the socket or peer was forcibly torn down. Late preparation
rejection is observed; a deadline cannot interrupt synchronous work blocking the event loop.

Plan and flow finally paths attempt owned-tab cleanup after CDP cleanup failure as well as
success. An existing operation/mutation refusal remains primary if cleanup also fails;
otherwise the first cleanup failure is reported. Attempting tab cleanup is not proof that
surf/the browser successfully closed the tab. Binding/open-failure paths in
`cdp-step-transport.ts` and session crash behavior are outside this bounded repair.

The local fake now distinguishes receiving the client's close frame, explicitly releasing
its reply, and the server's later TCP-close callback. Tests hold the reply: concurrent action
closes stay pending until release, withheld replies reject with an 80 ms fixture deadline,
and plan/flow still attempt tab cleanup without masking primary refusals. The plan-order test
checks client completion before the tab-close invocation; removing release or dropping the
socket wait fails it. No arbitrary sleep establishes successful teardown. These are native
client-close/close-frame causality checks, **not** proof of whole peer teardown, browser
resource reclamation, or clean acknowledgement after an abnormal socket disconnect. No live
browser was exercised for this repair.

### Source integration boundary (2026-10-03, AK #6221 / #6545)

The operator explicitly authorized delivery of the identified persistent-transport prerequisite
with bounded teardown and interruption corrections as one audited source integration commit,
separate from generated-state policy and historical archival work. Fresh `npm run check` passes
(915 pass, 1 existing opt-in skip; unchanged coverage floors). Git/AK evidence owns the commit
identity. The timing tables above are historical, not a fresh speed qualification of this revision;
AK6221 remains pending for its complete speed/receiver contract.

AK6545 supersedes earlier fallback wording: sent transport loss terminalizes the owned session;
only genuinely unsent startup/refusal fallback while authority still holds is allowed. CDP
revocation also fences post-await CLI fallback. Acknowledged mutating input plus cleanup failure
is conservatively unknown, not failed. ENOBUFS and timeouts remain sent loss even when a
SIGTERM handler exits 0 or nonzero. See the [source/fixture report](2026-10-03-surf-crash-interruption.md).
No live fault, new timing run, installed runtime update or upstream submission was executed.

### Fresh live qualification (2026-10-06, owner docket `surf-live-tests` = A)

Agent Chromium 153 at 127.0.0.1:9222 (startup readiness passed), the same frozen loopback fixture
pages, 11 runs per scenario interleaved across configurations, each run a fresh CLI process, warm-up
excluded. Sources are isolated `git archive` exports: before = `1ab2304` (the commit before slice 1),
after = `9bb568c`. Medians in ms:

| scenario | before, installed surf `70fd595` | after, installed `70fd595` (no `--stdio`) | after, surf CLI `44a6e83` (`--stdio`) |
|---|---|---|---|
| plan, DevTools channel | 535 | 471 (-12 %) | 326 (**-39 %**) |
| plan, surf channel | 516 | 448 (-13 %) | 301 (**-42 %**) |
| apply fill | 684 | 615 (-10 %) | 457 (**-33 %**) |
| flow journey | 1428 | 1371 (-4 %) | 1262 (-12 %) |

The third column selects the fork's CLI with `TEST_CAPABILITIES_SURF_BIN` against the installed host.
During the workstation's AK6546 promotion test, `44a6e83` was briefly the *installed* runtime;
measured then with no override: plan (DevTools) 553 -> 334 ms (-40 %), plan (surf) 534 -> 309
(-42 %), apply 686 -> 482 (-30 %), flow 1498 -> 1273 (-15 %). The installed runtime is `70fd595`
again. A tap on the session showed `tab.new`, `wait.ready`, `js` and `tab.close` over one
`surf --stdio` child; before and after wrote byte-identical plans. No run failed.

Reading: the gate in section 5 (plan on the DevTools channel at least 30 % faster) holds only with a
surf that has `--stdio`; the installed `70fd595` does not, so a default run today gains 4-13 %.
Apply is at the line (-33 % and -30 %). The flow journey gains 12-15 %: its page holds a fixed
400 ms `setTimeout`, and its 14 steps run over the DevTools connection with a durable receipt per act.
Still not built: section 4.5 (overlap) and lazy loading of the operation registry. Measured
on the after tree, `dist/index.js` loads in 35-47 ms and `surf-plan-operation.js` alone in about
31 ms, so lazy loading would save about 12-16 ms. With the session, the tab proof's surf read takes
about 9 ms, which bounds what the overlap could save. Evidence:
`~/.local/state/pi-quests/tmp/surf-live-1be8c1a7/bench/` (`bench2.sh`, `bench3.sh`, results,
provenance); AK evidence 14033 and 14040.
