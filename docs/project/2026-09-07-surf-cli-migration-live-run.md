---
summary: "Live run record for the migration of the surf runtime from the retired surf-go fork to the upstream nicobailon/surf-cli branch build (AK #5474)."
read_when:
  - "You need to know what the surf runtime migration changed and how it was verified live"
  - "You are debugging surf explore against the agent browser"
type: "reference"
---

# surf-cli migration: design decision and live run (2026-09-07)

## Decision

- The `surf-go` fork runtime is removed, not kept behind a flag: its upstream was deleted, the committed binary was removed, and a static rebuild needs cgo, so a retained mapping could never be verified again. `TEST_CAPABILITIES_SURF_GO_BIN` / `TEST_CAPABILITIES_SURF_GO_REPO` now fail closed with a retirement message instead of being ignored.
- The runtime flavor is `surf`: upstream nicobailon/surf-cli v2.18.0 built from branch `feat/site-independent-mechanisms` (typed page readiness, owned-tab `extract`, `frame.diagnose`, `js --options`, error codes as `[code]` suffixes and `{"error": {code, message, details}}` under `--json`).
- Resolution order: `TEST_CAPABILITIES_SURF_BIN` (must be executable) → `surf` on `PATH` → `~/.local/bin/surf`. The build is probed with `surf --version` and `surf --help-full`; `surf explore` refuses a build without `wait.ready` and `extract`.
- `surf explore` never touches the browser's active tab: `tab.new` → `wait.ready --tab-id` (login/challenge/not-found/error/timeout refuse the page with the surf code) → `js --tab-id` state and DOM probes (pure expressions, expression-mode first) → `extract --tab-id --allow-empty` for same-origin link rows (`return` form, because `extract` prefixes the `SURF_OPTIONS` prelude) → `tab.close`.
- `doctor` runs `surf doctor --browser <TEST_CAPABILITIES_SURF_BROWSER|chromium> --json` and reports version, mechanisms, socket and manifest state in the `external.surf` check (`data` carries the structured summary).
- Tests use `tests/fixtures/fake-surf.mjs`, a fake `surf` that speaks the branch CLI/JSON shapes (including the extract prelude and the expression-first `js` evaluation), via `tests/helpers/fake-surf.mjs`.

## Live run against Chromium (Agent), 2026-09-07 ~08:30 CEST

Preconditions: `chromium-agent.service` active, `surf doctor --browser chromium` OK (socket `/tmp/surf.sock`, manifest `~/.config/chromium/NativeMessagingHosts/surf.browser.host.json`), one `New Tab` open.

| Step | Result |
|---|---|
| `node bin/test-capabilities doctor --json` | `status: pass`, 10 required checks, 0 warnings; `external.surf`: `surf 2.18.0 via path_surf (~/.local/bin/surf); mechanisms: wait.ready, page.readiness, extract, frame.diagnose; surf doctor --browser chromium: ok` |
| `node bin/test-capabilities surf explore --url https://github.com/nicobailon/surf-cli/releases` | `Surf explore complete.` `Surf coverage: userFlows=100% probes=2/2 status=verified`; owned tab `1075141798` created and closed; 3.4 s |
| `executeSurfExploreOperation({ url: same, depth: "2" })` | 5 pages visited in owned tabs, 9/11 probes verified, `userFlows=82% status=partial`; seed page `ready` after 4 polls / 1224 ms, `extract` returned 5 same-origin link rows; `https://github.com/login?return_to=...` refused with `page readiness is 'login' [page_login]` and evidence `1 visible password field(s); URL path /login looks like a login route; title "Sign in to GitHub · GitHub" mentions signing in`; the other three pages verified; every tab closed (`tab.list` back to the single `New Tab`); 13.4 s |

Finding fixed during the run: a bare IIFE works for `js` (expression mode) but `extract` reported `[no_output]`, because `extract` always prefixes `const SURF_OPTIONS = Object.freeze({});`, which turns the script into statement mode. The links script now uses `return (...)`, and the fake `surf` applies the same prelude so the contract tests cover it.

## Open

- `frame.diagnose` is exposed on `SurfClient` but not yet wired into the root-cause workflow (see product posture next steps).
- `SurfClient` mappings other than the explore/doctor path (`read`, `screenshot`, `network`, `type`, `click`, ...) follow `surf <command> --help` and are not live-verified.
- Tests under `npm test` run the real `surf doctor` when a surf CLI is on the machine (doctor is optional, so results stay green either way); child CLI tests isolate `HOME` to keep `~/.local/bin/surf` out.
