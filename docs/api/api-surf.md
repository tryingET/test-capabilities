---
summary: "Browser surface reference at 0.4.0: the kernel Session interface and its surf implementation (owned tab, readiness gate, declared steps, read-only observers), the static surf command effect map, the js denylist, the seams the submit gate and the frame diagnosis fill, and the supported `surf explore` CLI path."
read_when:
  - "You are driving a browser from this framework and need the Session contract, the effect map or the js denylist"
  - "You are looking for SurfClient and need to know what replaced it and why"
  - "You need to know which surf commands a session may run, and which it refuses"
type: "reference"
---

# Browser surface (surf-cli)

> Browser automation via surf-cli, behind one owned scope.

**Status at 0.4.0.** `SurfClient` and `SurfFlowBuilder` are no longer exported from the package root and the internal `src/integrations/surf-client.ts` is deleted (operator decision D2; architecture adjudication claim 36). The class carried ambient browser authority into every consumer - anything holding it could click anything on any page - and its `parseSnapshot`/flow helpers were never live-verified. The public browser surface is now the kernel `Session` interface (`src/core/browser-session.ts`) with the surf implementation `SurfSession` (`src/core/surf-session.ts`), both exported from the package root. The last version of the deleted class is commit `30b0cbb`; nothing in this document describes it.

The runtime is the upstream nicobailon/surf-cli CLI (`surf`, v2.18.0 plus the `feat/site-independent-mechanisms` branch). Resolution uses `TEST_CAPABILITIES_SURF_BIN`, `surf` on `PATH`, or `~/.local/bin/surf`, and the retired `surf-go` fork env vars fail closed. Only commands with explicit adapter mappings (checked against `surf <command> --help`) are routed with verified flags; unmapped verbs and unverified flags fail closed. A non-zero exit raises a `SurfCommandError` carrying the surf error `code` (from the `--json` error object or the `[code]` suffix), `message` and `details`; a JSON-bearing command whose output is warning-prefixed is parsed by extracting the JSON payload, and non-JSON where structured data is required fails clearly instead of being accepted and silently ignored.

The supported CLI path is `test-capabilities surf explore`, including bounded `--depth 1..3` same-origin exploration with graded probe coverage. Explore is itself a step list over a `Session`, so the CLI and a library consumer are governed by the same rules.

---

## The scope

```typescript
import { SurfSession, createRunContext, SESSION_LIFECYCLE_EFFECT } from 'test-capabilities';

const context = createRunContext({
  operationId: 'surf.explore',
  effect: SESSION_LIFECYCLE_EFFECT,
});

const session = new SurfSession({ context, url: 'https://example.com/' });
try {
  const { tab } = await session.open();          // tab.new; the run now owns tab.id
  const { readiness } = await session.gate();    // wait.ready; a page that never settles is refused
  const title = await session.evaluate(
    'document.title',
    { effect: 'read_only', reason: 'reads the page title' },
  );
  await session.runObservers();
} finally {
  await session.close();                         // observer teardown, then tab.close
}
```

A session is an owned scope over unowned state: one tab this run created, gated once, read through declared steps, observed by registered read-only observers, and closed whatever happened. It holds no authority the caller can borrow - the caller names a command and reads the reply, and the session decides the class, the tab and the budget.

| member | what it does |
|---|---|
| `open()` | `tab.new <url>`; the run owns the tab it returns. A second `open` is refused. |
| `gate({ timeoutMs? })` | one `wait.ready`; a state other than `ready` raises `SessionReadinessRefusal` carrying surf's own `page_*` code |
| `step(browserStep)` | one declared step against the owned tab, through the run's mutation ledger |
| `evaluate(code, declaration, options?)` | page-side script; the declaration is required and a `read_only` claim is denylist-checked |
| `observe(name, observer)` | register a read-only observation to run after the steps |
| `runObservers()` | run them in registration order; an optional failure is `unavailable`, a required one fails the run |
| `observations()` / `notes()` | what the observers reported, and lifecycle notes (a tab that would not close) |
| `close()` | observer teardown in reverse order, then `tab.close`; idempotent, and never throws |
| `plan()` / `apply()` / `explainUnreachable()` | declared seams; they refuse with `unsupported_surf_action` in this release line |

### Owned tabs only

A run reads and acts only in a tab it created. The session points every step at that tab itself, so a caller cannot address another one: a step that names a different `--tab-id`, a step that runs before `open()`, and a command whose argv mapping carries no `--tab-id` at all are refused with `owned_tab_required` rather than run against whichever tab the browser has in front. `tab.list` is exempt because it addresses no tab. The browser lifecycle verbs (`tab.new`, `tab.close`, `tab.switch`, `window.*`, `frame.switch`, `frame.main`) belong to the session, so `step()` refuses them too: `open()` and `close()` are the only ways in.

---

## The effect map

Every surf command carries a static class (`Adapter.effects`, `surfEffect(command)`), and the map decides - not the caller. A declaration that contradicts a classified command is refused with `effect_declaration_invalid`.

| class | commands |
|---|---|
| `read_only` | `read`, `page.*`, `wait`, `wait.ready`, `wait.element`, `screenshot`, `tab.list`, `network*`, `console`, `cookie.list`, `frame.list`, `frame.diagnose`, `extract`, `scroll.*`, `emulate.*` |
| `mutating` / `browser_session` | `tab.new`, `tab.close`, `tab.switch`, `window.new`, `window.close`, `window.switch`, `frame.switch`, `frame.main` |
| `mutating` / `target` | `click`, `type`, `key`, `select`, `do`, `go`, `navigate`, `back`, `forward`, `reload`, `tab.reload` |
| `unclassified` | `js`, and any verb the map does not know |

The run's own tab lifecycle is `browser_session` scope and the session declares it `read_only` (`SESSION_LIFECYCLE_EFFECT`): it changes the browser the run brought with it, never the target, and the session reverses it in `finally`. That is why a read-only explore writes no mutation receipt for opening its tab. A `mutating`/`target` step is a different matter: its origin must be in `mutation.allowOrigins`, it is attempted exactly once, and a receipt is on disk and fsynced before the attempt.

---

## `js` has no class

Only the composer of a script knows whether `document.title` is read or assigned, so `js` carries no class and `evaluate` refuses an undeclared script with `effect_unclassified`. A `read_only` claim is additionally checked against a static denylist before any process exists; a hit refuses with `read_only_violation` and names what it saw.

| signal | what it means |
|---|---|
| `location_assignment` | assigns to `location` or one of its properties: the page navigates |
| `cookie_assignment` | assigns to `document.cookie` |
| `document_assignment` | assigns to any other `document` property (`document.title`, `document.body`, ...) |
| `field_assignment` | assigns to a field's `.value` or `.checked` |
| `form_submit` | `.submit(` |
| `element_click` | `.click(` |
| `dispatch_event` | `dispatchEvent(` |
| `fetch` | `fetch(` |
| `xhr` | `XMLHttpRequest` |
| `storage` | `localStorage`, `sessionStorage`, `indexedDB` |
| `history` | the history API |

The list is a fence, not a proof: it does not parse JavaScript and it will refuse an honest read-only script that merely mentions a listed name. **The remedy for a false positive is to declare the step `mutating` - which costs one attempt and one receipt - never to weaken the list.** `findJsMutationSignals(code)` is exported so a consumer can check a script before declaring it. The same check applies to the `--code` script of an `extract`, which is why upstream `--retry` is only ever forwarded for a script that passed it.

---

## Budgets, revocation and unknown outcomes

- A read-only step may be attempted up to three times; the default is one. `surf explore`'s links probe declares two and passes `--retry 1` upstream, so the retry budget is the framework's, appears in the ledger's attempt log and is revocable. An upstream `attempts` the run did not ask for leaves the probe unverified.
- **Revocation.** A read-only attempt whose own evidence shows the target moved forfeits the rest of its budget and fails with `read_only_violation_observed`. In explore, the signal is a probe answering from a URL outside the set the page was gated on. Observation cannot prevent the first attempt; it prevents the repeat, and the repeat is the failure this rule exists for.
- A mutating step is attempted exactly once. `maxAttempts`/`retryOn` on one is `mutation_retry_refused`.
- A step whose process reported nothing - a budget kill, a signal, a tab that navigated away mid-command - is `unknown`, never `failed`. The receipt records it and refuses the next run for that key until an operator passes `--supersede-receipt <id>`. The key is derived from the page, not from the tab id, so the interlock survives a rerun that gets a different tab.

---

## Readiness, extraction and frame diagnosis

These need the surf-cli branch mechanisms; `test-capabilities doctor` reports whether the resolved build has them, and a session refuses to open without them.

```typescript
const { readiness } = await session.gate({ timeoutMs: 20000 });
// { state: 'ready', evidence: [...], href, title, readyState, polls, waited }
```

`gate()` accepts only `ready`. surf reports `empty` when a page rendered its own "no results" state, which it can only know from an `--empty-text` marker the caller passed; the explore step list passes none, so an `empty` here is an undeclared emptiness and the page is refused rather than probed. Every other state raises `SessionReadinessRefusal`, which carries surf's own code (`page_login`, `page_challenge`, `page_not_found`, `page_error`, `page_timeout`), the typed `readiness` and the classified outcome, so a page that refused the framework and a runtime that never ran never render identically.

```typescript
const rows = await session.step({
  id: 'links',
  command: 'extract',
  args: ['--code', 'return { rows: [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href })) }', '--allow-empty'],
  intent: 'read the same-origin links',
  expect: { output: 'empty', declaredBy: 'author:example' },
  maxAttempts: 2,
  read: (reply) => JSON.parse(reply.stdout).rows,
});
```

`extract` stays read-only. Zero rows are a refusal (`empty_result`) unless the caller declares the emptiness - either through surf's `--allow-empty`/`--empty-text` or through the framework's `expect.output: "empty"`, which also records *who* declared it. Frame diagnosis (`frame.diagnose`) is a read-only command today; `Session.explainUnreachable` will turn it into a typed determination in a later slice and refuses until it does.

---

## What is not here

- `plan`, `apply` and `explainUnreachable` are declared on the interface and refuse with `unsupported_surf_action`: form preparation, gated submission and the frame root cause arrive later in this release line. Nothing guesses in the meantime.
- Screenshots, semantic locators, device emulation, network reads, console and cookie reads are mapped in the adapter (`translateSurfArgs`) and reachable through `step()` only where the mapping carries `--tab-id`; the rest are refused under the owned-tab rule rather than run untargeted.
- surf's file-driven workflows and the AI query passthroughs (`chatgpt` and friends) are a library-level passthrough to surf's own commands, not a core-owned, schema-validated contract in this repo. They use the operator's browser logins, no test path drives them, and no session verb exposes them.
