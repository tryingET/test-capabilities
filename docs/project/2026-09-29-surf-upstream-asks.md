---
summary: "Drafts (not sent) of three asks to surf-cli upstream (nicobailon/surf-cli) that came out of AK #6163, #6165, #6221 and #6222: a persistent `surf --stdio` mode (PR from our fork branch), the DevTools target id of a tab `tab.new` opens, and selectors that enter open shadow roots."
read_when:
  - "The operator decides whether to send any of these upstream."
  - "You change how test-capabilities binds its DevTools connection to surf's tab, or how it acts in shadow roots, and want to know what surf could do for it."
type: "reference"
status: "draft - nothing sent; no issue, PR or push without the operator's instruction"
---

# surf-cli upstream asks (drafts, not sent)

Written after the implementation they come from was built, measured and inspected (the operator's
order, 2026-09-29). Each is the text we would post; nothing here has been sent anywhere, and our
fork branch has not been pushed.

Before sending any of them: rebase onto upstream `main` (our branch sits on `70fd595`, our
`adopted`, which upstream `main` contains; `git merge-tree` against `main` at `b84a408` merges
cleanly), rerun the fork's tests, and re-measure on the release it would land in.

## 1. PR: `surf --stdio`, one surf process for many commands

**Title:** feat(cli): `surf --stdio` - run many commands in one process, each exactly as `surf <argv>`

**Body:**

Every `surf <command>` starts Node and loads the CLI before it does any work: ~45 ms here, where
the request itself takes 0.6-2 ms over the host socket. A client that runs tens of commands per
task pays that tens of times. `surf --stdio` starts once and runs each request through `cli.cjs`
again - the same file and top-level code a `surf <argv>` process runs, so the same argument
handling, targeting, admission, host request, output and exit code. The host sees one ordinary
request per command, as before.

Protocol, JSON lines: out first `{"id": null, "ready": true}`; in `{"id", "argv": [...],
"timeoutMs"?}`; out one line per request `{"id", "code", "stdout", "stderr"}`, plus
`"refused": true` for a request the session will not run (the client runs it as its own
process) or `"timedOut": true` (the session then ends). Requests run one at a time.

What a request does to the process is scoped to it through `AsyncLocalStorage`:
`process.exit(code)` ends the request, runs the `exit` handlers it registered and unwinds;
stdout/stderr writes go into its reply, and a finished request's late output is dropped; a
request that never calls exit ends when nothing it created keeps the loop alive (tracked per
request through an async hook), as a process does. The CLI's own modules load afresh for each
request. SIGINT, SIGTERM and SIGHUP are answered by the running request's own handlers (a
`--stream` stops and exits 0; `oracle` prints how to recover), then its exit handlers run, then
the session exits; replies written so far are flushed first.

Refused, anywhere in argv (the CLI finds its command after leading options): `install` and
`uninstall` (they hand the terminal to a child), `server`, `--inputs-stdin` and `semantic*` (they
read stdin, which is the protocol), `record` (a lock wait no request timeout can interrupt), and
a nested `--stdio`. `surf --help-full` lists the mode, which is how a client detects it.

Measured (Chromium 153, local host socket): 10 × `tab.list` 502 ms as processes, 65-78 ms in
one session. A downstream client (form plan / apply / flow runs) went from 532 to 299 ms per
plan, 669 to 419 ms per apply.

Tests: `test/unit/session.test.ts` (a stand-in CLI exercises each way a command can end:
isolation of exits, output, argv and exit codes; exit handlers; natural end incl. sockets and
awaited timers; module freshness; refusals incl. after leading options; reply flushing; nothing
started while ending; signals with and without a command's own handlers; timeouts) and an
end-to-end test in `test/e2e/cli-host-fake-extension.test.ts` that runs nine commands both ways
against the fake extension and requires identical replies (`queued=` aside) and no session
stderr. Lint, `tsc` and the full suite pass.

Files: `native/session.cjs` (new), a three-line hand-off at the top of `native/cli.cjs`, and the
help section.

## 2. Issue: report the DevTools target id of the tab `tab.new` opens

**Title:** tab.new: include the tab's DevTools target id in its output

**Body:**

Clients that also hold a Chrome DevTools connection (for input events, accessibility trees,
dialogs) need the page target of the tab surf opened. Today the only link is the URL, and a URL
does not identify a tab: another tab can sit at the same URL, and the one surf opened may have
been redirected. We bind by listing targets at the landed URL and then proving the match by
reading `performance.timeOrigin` through `surf js --tab-id <id>` and through the DevTools
connection and comparing - an extra surf command and an extra evaluation per run, and a refusal
(`tab_bind_ambiguous`) when two candidates exist.

surf already attaches `chrome.debugger` (`src/cdp/controller.ts`), and
`chrome.debugger.getTargets()` returns `{ id, tabId, type, url }` for every target: the `id` for
the created tab's `tabId` is the DevTools target id (the same id `/json/list` reports). Asking:
after `chrome.tabs.create` in `tab.new`, include it - e.g. `Created tab 123: <url>` gains
` (target <id>)`, and `--json` gains `"targetId"`; `tab.list --json` could carry it too. No new
permission is needed.

## 3. Issue: selectors that enter open shadow roots

**Title:** type/click/select (and wait.element): address elements inside open shadow roots

**Body:**

Selectors passed to `type`, `click`, `select`, `wait.element` resolve with `querySelector` on the
document, so a control inside a web component's open shadow root (design-system inputs, payment
fields) cannot be addressed at all. Page scripts can reach open roots (`element.shadowRoot`);
closed roots stay unreachable, and that is fine.

Proposal: a path syntax of CSS segments joined by ` >>> ` - the first resolved in the document,
each next one inside the open shadow root of the single element the previous segment matched
(zero or several matches at any segment is an error naming the segment). A one-segment path is a
plain selector, so nothing existing changes; ` >>> ` counts only outside quotes, brackets,
parentheses and comments. Playwright's `>>>`-style piercing is the familiar precedent.

We implemented exactly this client-side (page-side resolver plus DevTools input), measured on
Chromium 153: `shadowRoot` is readable in surf's `js` world and in an isolated world for open
roots and `null` for closed ones; a label's `control` resolves inside its root;
`DOM.focus` + `Input.insertText` fills a shadow input and its own `input` listener runs. Happy to
contribute the resolver (it splits paths the same way page-side and in Node, tested for quotes,
brackets and escapes).
