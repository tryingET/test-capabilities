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
   `surf --stdio` child at its first surf command - started as early as the operation
   knows it will open a tab, so surf's Node start overlaps our own work - and sends every command
   through it. The reply becomes the same raw result a spawn returns. A command's timeout ends
   the child (its handlers run first) and is reported as a spawn's timeout; the rest
   of that session runs on the CLI, with a note. A child that fails to start or dies does the same.
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
