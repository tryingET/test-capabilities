---
summary: "Live run of the submit gate (slice S7) on 2026-09-08: surf plan and surf apply driven by the real surf 2.18.0 against Chromium (Agent) - a fill-only dry run on the npmjs search box, and the one live submit of this programme against a throwaway node:http form on 127.0.0.1, which recorded exactly one POST and then refused the plan for good."
read_when:
  - "You need evidence that surf plan / surf apply work against a real browser, not only against the fake."
  - "You are about to run a live submit and want the exact commands, the config that opened the gate, and what the receipts said."
  - "You wonder what the live run changed in the code (auto-screenshots, the non-JSON type reply) or what it could not prove."
type: "reference"
---

# Submit gate live run (2026-09-08)

Slice S7 of `docs/project/2026-09-07-surf-learnings-implementation-plan.md`, packet
`docs/project/2026-09-07-submit-gate-design.md` §9. Two live lanes, in the order the packet
allows them: a fill-only dry run against a public form, and one submit against a world this run
owns. Nothing with `--submit` touched a public origin.

Environment: `surf` 2.18.0 (`~/.local/bin/surf` → `~/.local/opt/surf-cli/current`, branch
`feat/site-independent-mechanisms`), Chromium (Agent) started as
`systemd-run --user --unit chromium-agent --collect ~/.local/bin/chromium-agent.sh` and stopped
afterwards; `surf doctor --browser chromium --json` reported `ok: true`, 10 pass / 0 warn /
0 fail (7 pass / 2 fail before the unit was started). `surf tab.list` showed the same single
`New Tab` (id 1075142377) before and after every lane: every owned tab was closed. The tree was
at `a9dce1d` for the first lane and `a2cb9c1` (the fixes this run produced) for the rest.

## Lane 1 - fill only, public origin (npmjs search box)

```bash
cat <scratch>/tc.yaml
# receipts: {dir: receipts, ephemeral: true}
# mutation: {allow_origins: ["https://www.npmjs.com"]}

test-capabilities surf plan --url https://www.npmjs.com/ \
  --field 'name:q=surf-cli' --out <scratch>/plan.json --config <scratch>/tc.yaml
# stdout: sha256:4a4eb09708a30693db0270022f7204d52d25dfb69caf6b962ac125bd02a6d550
# stderr: Plan ce5bfc64-… written to <scratch>/plan.json (1 field(s), submit none).

test-capabilities surf apply --plan <scratch>/plan.json --config <scratch>/tc.yaml --json
```

| what | result |
|---|---|
| plan | `readiness: ready`, title `npm | Home`, field `name:q` → `input[name="q"]` (`input`/`search`), mode 0600 |
| submit identification | `status: none`, one candidate with `reason: no_unique_selector` (the search button carries no id or name from which a unique selector can be derived) - so the plan is fill-only and says why |
| apply | `mode: fill`, `submitted: false`, field `set: true, read_back: true, matched: true` |
| surf calls | `js fingerprint`, `type input[name="q"]`, `js read-back input[name="q"]`, `js observe`, `js observe` - no `click`, no `--submit` |
| receipt | one, `outcome: applied`, `details.mode: fill`, `subject https://www.npmjs.com/ tab=1075142431`, `ephemeral_store: true` |
| tabs | unchanged; `/tmp/pi-auto-*.png` count 0 after the `--no-screenshot` fix (4 before it) |

The plan's `submit.status: none` on npmjs is the packet's expected shape for a page whose submit
control is not addressable, and it is why the fill lane needs no gate at all.

## Lane 2 - the one live submit, against a world this run owns

`tests/fixtures/form-fixture-server.mjs` served one form on `http://127.0.0.1:41487/` and
recorded every POST. The config allowlisted exactly that origin.

```bash
node tests/fixtures/form-fixture-server.mjs --port 0
# {"url":"http://127.0.0.1:41487/","origin":"http://127.0.0.1:41487","port":41487}

test-capabilities surf plan --url http://127.0.0.1:41487/ \
  --field 'label:Search packages=surf-cli' --submit-text 'Search' \
  --out <scratch>/plan.json --config <scratch>/tc.yaml
# stdout: sha256:67187d0c3208252b765e23587953d0043cedaccb9fd6da9767c4d3b237e5a844
# stderr: Plan 34b36377-… written (1 field(s), submit identified).
```

The plan resolved the `label:` locator through `<label for=q>` to `#q`, identified
`#search-submit` (text `Search`, `disabled: false`) and put `#set-bid` - the trap the incident
is named after - into `forbidden_controls` with `reason: form_level_button_not_submit`.

Refusals first, each with nothing sent to the browser and no POST recorded:

| command | code |
|---|---|
| `surf apply --plan … --submit` (no `--confirm-plan`) | `submit_gate_closed` |
| `surf apply --plan … --submit --confirm-plan sha256:000…0` | `submit_plan_mismatch` |
| `surf apply --plan … --config closed.yaml` (empty allowlist, fill) | `mutation_origin_not_allowed` |
| `surf apply --plan … --submit --confirm-plan <token> --config closed.yaml` | `submit_origin_not_allowed` |
| `surf plan --field 'selector:#set-bid=150'` | `value_via_button_refused` ("…it resolves to a `<button>` type=button, which is a control that acts rather than a field that holds a value…") |

Then the submit:

```bash
test-capabilities surf apply --plan <scratch>/plan.json --submit \
  --confirm-plan sha256:67187d0c…a844 \
  --until-url-prefix http://127.0.0.1:41487/done \
  --receipt-out <scratch>/receipts.json --config <scratch>/tc.yaml --json
# exit 0
```

- `result.mode: submit`, `submitted: true`, `submit: {status: identified, control: "#search-submit", clicked: true, postCondition: {kind: url_prefix, expected: http://127.0.0.1:41487/done}}`.
- `surfCalls`: `js fingerprint`, `type #q`, `js read-back #q`, `js observe`, `js observe`, `js observe`, `click #search-submit`, `js observe`. One click, on the identified control; `#set-bid` never appears.
- The server recorded **exactly one POST**: `{"url": "/submit", "body": "q=surf-cli"}`.
- Two receipts on disk: `applied fill surf.apply.field:34b36377-…:f1` and `applied submit surf.apply.submit:34b36377-…` with `verified_by: post_read` and evidence `click sent; post-condition not observed yet`, `verify: applied`, `post-condition url_prefix satisfied`, `observed http://127.0.0.1:41487/done`.
- `--receipt-out` wrote `test-capabilities.surf.apply.receipts` with both receipts, mode 0600.
- The same plan again: `submit_already_attempted` naming the receipt id and its outcome; the server still shows one POST.

## What the live run changed

1. **Auto-screenshots.** The surf build saves a screenshot to `/tmp` after every value-setting
   verb *and* after every `js` call: a fill left four pictures of the page, with the typed value
   in them, outside the 0600 artifacts (packet §8). The CLI has an undocumented
   `--no-screenshot`; the gate now passes it on every call it makes (commit `a2cb9c1`). Measured
   four before, zero after. `surf explore`'s probes still take them - that is S6's path and a
   follow-up for a later slice.
2. **`surf type` does not answer JSON.** Under `--json` it prints `OK` plus a screenshot line,
   which turned a successful fill into `Invalid JSON output from surf type`. The runner's
   in-reply navigation check is best-effort by construction (the observation step after each
   field is the real one), so an unparsable reply is ignored there now.

## What this run did not prove

- No public-origin submit, by decision: the only `--submit` ran against `127.0.0.1`.
- `submit_control_disabled`, `submit_control_changed`, `fill_side_effect_observed`,
  `plan_stale` and `submit_postcondition_unmet` were proved against the fake, not live; each
  needs a page that misbehaves in a specific way, and building one live adds no evidence the
  fixture does not already give.
- The `label:` locator was proved live on the fixture form; on npmjs the `name:` locator was
  used, because that is what the packet's dogfood names.
