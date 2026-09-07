---
summary: "Design packet 2 of the surf-learnings series: a prepare/apply split for every mutating browser action in a test run, with a reviewable plan artifact, a content-bound approval token, an operator-owned origin allowlist, an apply runner that can address only the plan's own controls, dry-run as the default posture, and the rule that a value is set only through the field's own input, never through a form-level button. Refined with the many-of-the-greats adjudication (last section)."
read_when:
  - "You implement `surf plan` / `surf apply` or touch SurfClient.click/type/select or SurfFlowBuilder"
  - "You wonder why a test run refused to submit a form, why --submit needs an approval token and an origin allowlist, and why neither can stand in for the other"
  - "You draft the surf-cli upstream `form.plan` / `form.apply` proposal"
type: "design"
---

# Submit gate: prepare/apply for mutating browser actions (2026-09-07)

Row 2 of `docs/project/2026-09-07-surf-learnings-assessment.md`. Companion to packet 1,
`docs/project/2026-09-07-mutation-safety-design.md` (written in parallel; referenced by name only). Scope of
implementation is this repo; the surf-cli side is described as a later upstream proposal.

## 1. Problem (evidence)

- **The "Set bid" incident.** While setting a boost amount on a draft-only Upwork proposal, a probe clicked the
  boost section's "Set bid" button and the page submitted a real proposal (~150 Connects spent). The derived rule:
  setting a value must never click a form-level button; only a guarded `--submit` path may click, and only the one
  intended control (`~/ai-society/softwareco/contrib/docs/learnings/2026-09-06-surf-cli-go-restricted-verbs-research.md:220-227`,
  §3 row 5 at `:332`). The prepare/apply split there (`bid-prepare` writes an editable template, `bid-apply`
  defaults to fill-only, `--submit`/`--confirm`/`--save-draft` default off, refuse on empty required fields, click
  only the button whose text matches, wait for a post-condition; `:197-219`, `:255-273`) is the pattern this packet adopts.
- **Our own primitives have no gate.** `SurfClient.type` forwards `--submit` unconditionally
  (`src/integrations/surf-client.ts:290-301`); `SurfClient.click` clicks any ref, selector or coordinate
  (`:272-288`); `locateByLabel` fills by label with no record of what was intended (`:358-367`);
  `SurfFlowBuilder.execute` runs `click`/`type` steps straight from a step list with no classification, no
  plan and no receipt (`:903-959`). `translateSurfArgs` maps `click`, `type`, `key`, `select` and `do`
  (`src/core/surf-runtime.ts:940-953`, `:981`) but these mappings are not live-verified
  (`docs/project/product-posture.md:43`).
- **The CLI's primitives are value-setters and clickers with nothing in between.** `surf form.fill --data
  '[{ref,value}]'`, `surf type <text> --into|--ref [--submit]`, `surf smart_type --submit`, `surf click
  --ref|--selector|--x/--y`, `surf select`, `surf locate.label --action fill`, `surf key Enter` (from
  `surf --help-full`, `surf type --help`, `surf click --help`, v2.18.0 branch build). `surf do --dry-run` only
  parses the workflow; it is not a browser dry-run. `--submit` presses Enter, whose target is the form's default
  button in tree order, which on a boost-style form is exactly the wrong button.
- **Retry loops double-submit.** Healing and orchestrator retries are implicit and untyped (assessment row 1);
  a mutating step that is retried after a timeout re-sends the form. Packet 1 owns the never-retry rule; this
  packet has to make a second submit for the same plan impossible on its own side as well.
- **What a testing framework must guarantee.** A test run may fill a form to prove that the UI accepts the
  values; it must not create accounts, post content or spend money unless the operator said so for that exact
  form on that exact origin. Today nothing in the repo can express that difference.

## 2. Placement

- **test-capabilities first.** Two new operations in the operation kernel, `surf.plan` and `surf.apply`, routed
  as `test-capabilities surf plan` / `surf apply` (`SurfAction` at `src/core/operations/types.ts:19`, manifest
  at `src/core/operations/dispatch-manifest.ts:60-93`). They compose existing surf primitives the way
  `surf explore` does (owned tab, `wait.ready`, pure-expression `js`, `tab.close`;
  `src/core/operations/surf-explore-operation.ts:187-208`, `:266-309`, `:315-335`). `SurfClient.type` loses its
  `submit` option and `SurfFlowBuilder` loses its `click`/`type` steps (removed, not gated: D8); the only code path
  that can click a form control is the apply runner of §4.3, and packet 1's classification hook sees `surf.apply` as
  the one mutating surf operation.
- **surf-cli later (upstream proposal, not in scope).** After PRs A-H
  (`~/ai-society/softwareco/contrib/docs/learnings/2026-09-07-surf-cli-upstream-prs.md`) land, propose
  `surf form.plan --url <u> --fields '[{"label"|"selector":..., "value":...}]' [--submit-text <t> | --submit-selector <s>]
  --out plan.json --json` and `surf form.apply --plan plan.json [--submit] [--until-url-prefix <p> | --until-text <t>] --json`.
  `form.plan` is read-only (owned tab, readiness gate, resolves labels to selectors, lists submit candidates,
  refuses button targets); `form.apply` sets values through the native value setter (PR D #254), reads them
  back, and clicks only the plan's identified control, only with `--submit`. Error codes in the branch's
  `[code]` / `{"error":{code,message,details}}` shape (PR H #258): `form_field_ambiguous`,
  `form_field_is_control`, `form_submit_ambiguous`, `form_submit_missing`, `form_submit_gate_closed`,
  `form_readback_mismatch`. If accepted, this repo's `surf.apply` becomes a thin caller that keeps the
  approval, allowlist and receipt logic (those are test-run policy, not CLI mechanics).

## 3. Current state (code refs)

| Surface | Today | Ref |
|---|---|---|
| `surf explore` | read-only; owned tab, typed readiness, pure-expression probes, evidence-gated coverage | `src/core/operations/surf-explore-operation.ts:632-694`, `:409-430` |
| `SurfClient.click/type/select/press` | direct, ungated, `--submit` passthrough, auto-screenshot after each action | `src/integrations/surf-client.ts:272-329`, `:772-789` |
| `SurfFlowBuilder` | step list executed in order, first failure stops, no plan/receipt | `src/integrations/surf-client.ts:859-984` |
| `heal` | precedent: dry-run default, artifact-out only with `--dry-run`, apply needs `--checkpoint-ref`, mutation posture record | `src/core/operations/heal-operation.ts:335-342`, `:439-446`, `:490-496` |
| surf actions `flow/assert/compare/replay` | registered, unsupported, fail clearly | `src/core/operations/dispatch-manifest.ts:71-93`, `src/core/operations/support.ts:21-29` |
| surf error codes | `SurfCommandError.code`, readiness codes `page_*` | `src/core/surf-runtime.ts:67-103` |
| fake surf | `tab.*`, `navigate`, `page.readiness`, `wait.ready`, `js`, `extract`, `frame.diagnose`; no `click`/`type`/`select`/`form.fill` | `tests/fixtures/fake-surf.mjs:450-515`, `:626` |
| config | `agents.<name>.type: surf`, `targets.web`; no submit/allowlist keys | `src/core/orchestrator.ts:94`, `:2084-2087` |

## 4. Contract

### 4.1 `surf plan` (read-only, always allowed)

`test-capabilities surf plan --url <url> --field <locator>=<value> [--field ...] [--submit-text <t> | --submit-selector <s>] --out <plan.json> [--json]`.
`<locator>` is `label:<text>`, `selector:<css>` or `name:<input name>`. The operation opens an owned tab, gates
it with `wait.ready` (any `page_*` refusal is passed through unchanged), resolves every field with a pure
`js` expression, identifies the submit control, fingerprints the page, writes the plan with mode 0600 and closes
the tab. Nothing is typed or clicked. Plan artifact `test-capabilities.surf.plan` v1:

```json
{ "schema_version": 1, "artifact_kind": "test-capabilities.surf.plan", "plan_id": "<uuid>", "generated_at": "...",
  "runtime": { "flavor": "surf", "provider": "path_surf", "version": "2.18.0" },
  "target": { "url": "...", "origin": "...", "landed_href": "...", "title": "...", "readiness": { "state": "ready", "evidence": [] } },
  "fields": [ { "id": "f1", "locator": { "kind": "label", "value": "Search packages" }, "resolved_selector": "input[name=q]",
               "control": { "tag": "input", "type": "search", "name": "q", "form": "form#search" },
               "current_value": "", "intended_value": "surf-cli", "set_via": "field_input" } ],
  "submit": { "status": "identified" | "ambiguous" | "none", "gate": "closed",
              "control": { "selector": "form#search button[type=submit]", "tag": "button", "type": "submit", "text": "Search", "disabled": false },
              "candidates": [ { "selector": "...", "text": "...", "reason": "implicit_submit" } ] },
  "forbidden_controls": [ { "selector": "...", "text": "Set bid", "reason": "form_level_button_not_submit" } ],
  "fingerprint": { "url": "...", "form_count": 1, "field_signature": "sha256:...", "control_signature": "sha256:..." },
  "approval_token": "sha256:...",
  "policy": { "dry_run_default": true, "value_via_field_input_only": true, "never_retry_submit": true,
              "approval_binds_to": "content_hash", "authority": ["config.surf.submit.allowOrigins", "apply_runner"] } }
```

`approval_token` is `sha256` over the canonical JSON of `{ target.origin, fields[].resolved_selector,
fields[].intended_value, submit.control.selector }`; `surf plan` prints it in its summary line. It is deliberately
not a secret: whoever can read the plan can present it. It binds an approval to reviewed content, so that an edited
plan (a changed value, a swapped submit selector) no longer matches; it confers no authority (Refinement, hazard 3).
Authority sits in two places the test-running agent does not own: the operator's allowlist and the construction of
the apply runner (§4.3).

Refused at plan time (no artifact written): a field locator resolving to zero or more than one element
(`plan_field_not_found`, `plan_field_ambiguous`); a field whose resolved element is a `button`,
`[role=button]`, `input[type=submit|button|image|reset]` or a link (`value_via_button_refused`, the "Set bid"
rule); a field inside a cross-origin iframe or a shadow root (`plan_field_unreachable`, points at packet 3's
`frame.diagnose`). An ambiguous or missing submit control does not refuse the plan; it is recorded as
`submit.status` so that fill-only dry-runs stay possible.

### 4.2 `surf apply` (mutating; dry-run fill by default)

`test-capabilities surf apply --plan <plan.json> [--submit --confirm-plan <approval_token>] [--until-url-prefix <p> | --until-text <t>] [--receipt-out <path>] [--json]`.

- **Fill mode (default).** Re-opens an owned tab on `target.url`, re-gates readiness, recomputes the fingerprint
  and refuses on mismatch (`plan_stale`). For each field: set the value through the field's own input
  (`surf type <value> --into <resolved_selector>` for text-like inputs and textareas, which uses the native
  value setter; `surf select <selector> <value>` for selects; `surf click --selector` on the input itself for
  checkbox/radio), then read it back with a pure `js` expression and refuse on mismatch
  (`field_readback_mismatch`). Never `--submit`, never `key Enter`, never a click on anything that is not the
  field control. After every field and once more after the last, the runner observes `location.href` and, when
  `submit.status` is `identified`, the presence of the submit control; a navigation away from `target.landed_href`
  or a vanished form ends the run with `fill_side_effect_observed`, `outcome: "failed"`, exit non-zero: a page
  whose `change` handlers act on their own is a finding, not a passed dry-run. Fill mode is a bounded mutation, not
  a safe one (Refinement, clash 3). Closes the tab even on failure; the draft is discarded. Exit 0 with
  `submitted: false` only when every read-back matched and nothing navigated.
- **Submit mode.** Requires all of, checked in this order before any tab is opened, each refusal owning one
  hazard (Refinement, Mode 3): (1) config `surf.submit.allowOrigins` contains `target.origin`
  (`submit_origin_not_allowed`; the world); (2) `--submit` is present and `--confirm-plan <approval_token>` equals
  the token recomputed from the plan file's content (`submit_gate_closed` without `--submit`,
  `submit_plan_mismatch` when the token differs or the file no longer hashes to its own `approval_token`; the
  intent); (3) no receipt for `plan_id` exists in `surf.receipts.dir`, whatever its outcome, `attempting` and
  `unknown` included (`submit_already_attempted`; at-most-once); (4) `submit.status === "identified"`
  (`plan_submit_ambiguous`, `plan_submit_missing`). After a successful fill (navigation check included) the runner
  re-resolves the submit control by its plan selector, waits up to `surf.submit.controlEnableTimeoutMs` for
  `disabled` to clear, and refuses if it is still disabled, no longer unique, or no longer inside the fields'
  owning form (`submit_control_disabled`, `submit_control_changed`). It then writes the receipt with
  `outcome: "attempting"` durably (temp file, fsync, rename), clicks the control exactly once through
  `clickSubmit()` (§4.3), waits for the post-condition (`--until-*`, default: URL leaves `target.url`), and
  finalises the receipt. Post-condition timeout is `submit_postcondition_unmet` with `submitted: "unknown"`,
  receipt `outcome: "unknown"`, exit non-zero; it is never retried, and the plan can never be submitted again
  because rule (3) now holds for it.
- **Config keys** (`test-capabilities.yaml`): `surf.submit.allowOrigins: []` (default empty, so every submit is
  refused), `surf.submit.postconditionTimeoutMs: 15000`, `surf.submit.controlEnableTimeoutMs: 5000`,
  `surf.receipts.dir: .test-capabilities/receipts`. There is no environment variable that opens the gate and no
  CLI flag that adds an origin (`--allow-origin` does not exist); a CI variable must not be able to turn dry-run
  into submit. The allowlist is a declaration about the world (Refinement, hazard 2) and belongs to whoever owns
  the world, which is the operator editing the config, never the agent running the test.
- **Receipt** `test-capabilities.surf.receipt` v1, one file per apply attempt, written durably before the click in
  submit mode: `{ schema_version, artifact_kind, receipt_id, plan_id, mode: "fill"|"submit", attempt: 1,
  started_at, finished_at, target, fields: [{ id, set: bool, read_back, matched }], submit: { clicked, control,
  post_condition: { kind, expected, observed, satisfied } }, outcome: "ok"|"refused"|"attempting"|"failed"|"unknown",
  error_code?, surf_calls: [command display strings] }`. The `surf_calls` list is the evidence that no click
  other than the submit control happened; the runner of §4.3 is the reason it could not have been otherwise.
- **Result envelope** `SurfApplyOperationResultEnvelope`: `{ operationId: "surf.apply", input, plan: { path,
  plan_id }, receipt: { path, outcome }, result: { submitted: boolean | "unknown", fields, submit } }`.

### 4.3 The apply runner (capability restriction; the load-bearing layer)

`surf.apply` never holds a general `SurfClient`. It constructs a `SurfApplyRunner` from the plan and the mode, and
the runner is the only object in the operation with a surf runtime handle. Its whole surface is:

| method | emits | addressable set |
|---|---|---|
| `setValue(fieldId)` | `type <v> --into <sel>`, `select <sel> <v>`, or `click --selector <sel>` for checkbox/radio | `fields[].resolved_selector` only |
| `readBack(fieldId)` | pure-expression `js` | same |
| `observe()` | pure-expression `js` (`location.href`, submit control present/disabled/unique) | none (read-only) |
| `clickSubmit()` | `click --selector <submit.control.selector>` | exists only when constructed in submit mode with `submit.status: identified`; consumes itself, a second call throws before emitting anything |
| `close()` | `tab.close` | the owned tab |

There is no `click(selector)`, no `type(..., { submit })`, no `press`, no `key`, no `do`, no `batch`, no coordinate
click. A `forbidden_controls[].selector` value is not representable as an argument to any method. A plan with
`submit.status !== "identified"` yields a runner without `clickSubmit`. This is the invariant that holds when the
operator approves the wrong plan, when the allowlist is wrong and when the page drifts (Refinement, hazard 1): the
code that could click "Set bid" does not exist in the apply path. Consequently `SurfClient.type` loses its `submit`
option, `SurfClient.press` is not reachable from any surf operation, and `SurfFlowBuilder`'s `click`/`type` steps
are removed rather than gated (Q5 closed, D8). The contract test asserts the runner's surface at the type level (a
compile-time `never` check on the excluded members) and through `calls.log`.

## 5. Behaviour and failure modes

- Fail closed everywhere: an unknown control type, a non-JSON `js` answer, a missing read-back value, a
  fingerprint drift, an edited plan file (`submit_plan_mismatch`), a navigation during fill
  (`fill_side_effect_observed`), a second submit candidate appearing after the fill: each refuses with a code, and
  in submit mode the refusal happens before the click. The only step that cannot be undone is the single click, and
  it is preceded by a durable receipt.
- Submit mode is operator-invoked only. `surf apply --submit` is not reachable from `agents.<name>` config, the
  orchestrator, `heal`, `SurfFlowBuilder` or any retry hook; the dispatch manifest marks `surf.apply` as
  `mutation: external` with `operator_only: true` for submit mode, and packet 1's scheduling hook refuses it. There
  is no confirmation prompt and no two-person rule: a ritual repeated by automation stops being deliberate
  (Refinement, clash 4), so reachability replaces it.
- Submit control identification: candidates are the owning form's `button[type=submit]`, `input[type=submit]`
  and `button` elements without a `type` (implicit submit), in tree order; `--submit-text` narrows by
  normalised visible text, `--submit-selector` by CSS. Exactly one visible candidate is `identified`; zero is
  `none` (also when the fields have no owning form, as in many SPAs, unless `--submit-selector` resolves to
  exactly one visible enabled `button`/`[role=button]`); two or more is `ambiguous`, with the full candidate list
  in the plan so the operator can rerun `surf plan` with a narrower hint. Every other button inside the form
  goes into `forbidden_controls`; apply never targets those selectors.
- The Enter key is never used as a submit mechanism, because its target depends on focus and default-button
  order; `type --submit`, `smart_type --submit` and `key Enter` are not emitted by `surf apply`.
- Fill mode is a bounded page mutation, not a safe one (autosave, `change` handlers that navigate); it runs only in an owned tab
  of the agent browser, never on the operator's personal browser; the tab is closed at the end even on failure
  (same `finally` discipline as `surf-explore-operation.ts:686-691`).
- Readiness states `login`, `challenge`, `not-found`, `error`, `timeout` refuse plan and apply alike with the
  surf `page_*` code; no `--accept` is offered for mutating operations.
- The value never appears in an error message; refusals cite the field id and selector only. Plan and receipt
  files are written 0600 because they contain the intended values.

## 6. Interaction with packet 1 (mutation safety)

`docs/project/2026-09-07-mutation-safety-design.md` defines the read-only/mutating classification, the
never-retry rule and the receipt-per-mutating-attempt contract. This packet is an instance of it:
`surf.plan` is classified read-only; `surf.apply` fill mode is mutating (page state); submit mode is mutating
with external side effects. The receipt in §4.2 is the surf-specific payload of packet 1's receipt; until both
packets merge, the field names above are the proposal and packet 1's schema wins on conflict (decision D6).
Packet 1's retry hook must treat any `surf.apply` failure as terminal; this packet's `submit_already_attempted`
check is the belt to that brace.

## 7. Non-goals

No orchestrator integration (`agents.<name>.type: surf` keeps running `explore` only); no multi-page wizards or
conditional steps; no file upload fields in v1; no login, CAPTCHA or challenge handling; no natural-language
field matching; no shadow-DOM or cross-origin iframe fields (refused, see packet 3); no surf-cli code change in
this scope; no automatic heal of a stale plan; no use of `surf do`/`batch`/playbooks for the apply step (their
auto-wait and step-delay semantics hide which call clicked).

## 8. Risks

- Label-to-selector drift between plan and apply on dynamic pages: mitigated by the fingerprint and read-back;
  residual risk is a stale plan that still passes the fingerprint, accepted for v1.
- Native value setter does not satisfy sites that react only to keystrokes: read-back passes while the app's
  state does not; mitigation is an optional `--verify-js <expr>` per field (open question Q2).
- `change` handlers that submit or navigate on their own (auto-submitting selects): cannot be detected
  statically; the owned tab and the absence of any click bound the damage, the runner's `observe()` turns a
  navigation into `fill_side_effect_observed`, and the receipt records it. This is the one hazard the capability
  layer cannot own; only the allowlist prices it, and fill does not require the allowlist (Q1 closed), so a fill
  against a public origin carries this residual by explicit acceptance.
- Auto-screenshots (`SurfClient` default, `surf type` host behaviour) can persist typed values under `SURF_TMP`;
  `surf.apply` disables auto-screenshot and documents the host-side capture.
- Disabled-until-valid submit buttons cause `submit_control_disabled` after a correct fill when validation is
  asynchronous; bounded by `surf.submit.controlEnableTimeoutMs` (§4.2), then refused.
- An operator who allowlists an origin has declared every effect on it acceptable; the allowlist is per origin,
  not per path, by decision (Q3 closed, D9): the origin is the browser's isolation unit and a path prefix is not (a
  form on `/a` posts to `/b`). A shared staging origin is "acceptable", not "free"; the content-bound approval is
  the control over what is submitted there, and the receipts are the audit trail.
- The approval token is readable by any principal that can read the plan, including the agent that runs
  `surf apply`. Accepted by design: it binds intent, it does not confer authority (Refinement, clash 1). If the
  framework ever needs authority in the approval itself, the approval has to move out of the process (an
  operator-written approval file the agent cannot create); that is not v1.
- A receipt written but the process killed before the click leaves `attempting` on disk and blocks that plan for
  good; that is the intended wrong-side failure (Refinement, hazard 4): the operator re-plans, and the new plan
  has a new id and, if anything changed, a new token.

## 9. Verification and dogfood plan

- **fake-surf** (`tests/fixtures/fake-surf.mjs`): add page fixtures with `fields` and `controls`, and commands
  `type --into`, `click --selector`, `select`, plus `js` support for `value` read-back; every call lands in
  `calls.log` (`tests/helpers/fake-surf.mjs:35-80`). Contract test `tests/surf_submit_gate_contract.test.mjs`:
  (a) plan written, submit identified, mode 0600; (b) two submit candidates → `submit.status: ambiguous`, plan
  still written; (c) field target is a button → `value_via_button_refused`, no artifact; (d) apply without
  `--submit` → values set and read back, `calls.log` contains no `click` and no `--submit`; (e) apply `--submit`
  without `--confirm-plan` → `submit_gate_closed`, no tab opened; (f) `--submit --confirm-plan <id>` with the
  origin not allowlisted → `submit_origin_not_allowed`; (g) allowlisted and confirmed → exactly one `click
  --selector <identified>` in `calls.log`, receipt `outcome: ok`, `submitted: true`; (h) same plan again →
  `submit_already_attempted`; (i) fingerprint drift → `plan_stale`; (j) `page_login` on apply → passthrough code;
  (k) plan file edited after `surf plan` (one `intended_value` changed, `plan_id` kept) → `submit_plan_mismatch`,
  no tab opened; (l) fixture page whose `change` handler navigates → `fill_side_effect_observed`, exit non-zero,
  receipt `outcome: failed`; (m) a receipt with `outcome: attempting` already present → `submit_already_attempted`;
  (n) across every case, no `forbidden_controls` selector ever appears in `calls.log`, and a type-level test proves
  `SurfApplyRunner` has no member that accepts a free selector, no `press`, and no `clickSubmit` in fill mode.
- **Local live submit proof**: a throwaway `node:http` fixture server serving one form and recording POST bodies,
  origin `http://127.0.0.1:<port>` allowlisted in a temp config; proves the click reaches the server exactly once.
- **Live dry-run against a public form** in Chromium (Agent), never submitting: `surf plan --url
  https://www.npmjs.com/ --field 'name:q=surf-cli' --out /tmp/plan.json` then `surf apply --plan /tmp/plan.json`
  (fill mode). Expected: plan lists `input[name=q]` and the search form's submit candidate, read-back
  `surf-cli`, tab closed, no navigation (the same box the branch dogfood used for the native setter,
  `~/ai-society/softwareco/contrib/docs/learnings/2026-09-07-surf-cli-branch-dogfood.md:140-146`). Nothing
  with `--submit` runs against a public origin in the dogfood. Record the run in a `docs/project/*-live-run.md`.
- Repo gates: `npm run check`, `npm test`, `loop-impact-plan` → `loop-impact-wide` (src/tests change);
  regenerate the capability passport; README "implemented" rows for `surf plan` and `surf apply`.

## 10. Open questions

- Q1 (closed by refinement): fill mode does not require the allowlist. It is bounded by the owned tab, the absence
  of any click, and the navigation check (`fill_side_effect_observed`); the autosave residual is accepted and named
  in §8. Revisit only if a live run records a `fill_side_effect_observed` on a non-allowlisted origin.
- Q2: Per-field `--verify-js` expression for framework state, or leave read-back as the only check in v1?
- Q3 (closed by refinement): origin only (D9); a path prefix is not an isolation boundary.
- Q4: Receipt location and format are packet 1's call; do receipts also feed the root-cause corpus as evidence?
- Q5 (closed by refinement): removed, not gated (D8); a gated capability is still a held capability.
- Q6: Upstream naming (`form.plan`/`form.apply` vs `form.prepare`/`form.submit`) and whether upstream wants the
  approval token at all, or only the `--submit` flag.

## 11. Decision log

- D1 (2026-09-07): prepare/apply are two operations with a file artifact between them, not one command with a
  `--dry-run` flag; the artifact is what the operator reviews and what `--confirm-plan` refers to.
- D2 (revised by refinement: a uuid names a file, a hash names content, and an edited plan must not keep its
  approval; the token is intent binding, not authority): dry-run (fill-only) is the default; submit needs
  `--submit`, `--confirm-plan <approval_token>` equal to the content hash recomputed from the plan file, and an
  origin allowlist in operator-owned config; no environment variable and no CLI flag can open the gate or add an
  origin.
- D3: a value is set only through the field's own input (native setter via `type --into`, `select`, a click on
  the input control itself); any field whose target is a button-like element is refused at plan time.
- D4 (revised by refinement: the click is a runner method that exists only in submit mode and consumes itself,
  and `disabled` gets a bounded wait instead of an immediate refusal): the submit step clicks exactly one
  pre-identified control by selector through `clickSubmit()`; Enter is never used; ambiguity or absence of the
  control refuses submit but not the fill dry-run.
- D5 (revised by refinement: durability and the `unknown` outcome, because the after-state is the real hazard):
  a receipt is written durably (temp file, fsync, rename) before the click; a plan id with any receipt in the
  receipts dir, `attempting` and `unknown` included, is never submitted again; `unknown` is a terminal, non-zero
  outcome.
- D6: packet 1 owns classification, retry policy and the receipt schema; this packet's receipt fields are a
  proposal and yield on conflict.
- D7: surf-cli gets a proposal for `form.plan`/`form.apply` only after PRs A-H land; this repo does not wait
  for it.
- D8 (2026-09-07, by refinement): capability restriction is the load-bearing layer. `surf.apply` runs on a
  `SurfApplyRunner` constructed from the plan whose addressable set is the plan's field controls plus, in submit
  mode only, the identified submit control; `SurfClient.type` loses `submit`; `SurfFlowBuilder` `click`/`type`
  steps are removed, not gated (closes Q5).
- D9 (2026-09-07, by refinement): the origin allowlist is an isolation declaration, origin-only, operator config
  only; it cannot be substituted by approval and approval cannot be substituted by it (closes Q1 for fill, Q3 for
  granularity).
- D10 (2026-09-07, by refinement): submit mode is operator-invoked only and unreachable from the orchestrator,
  `heal`, `SurfFlowBuilder` and every retry hook; there is no confirmation prompt and no two-person rule.
- D11 (2026-09-07, by refinement): a navigation or form loss during fill is `fill_side_effect_observed`, a failed
  dry-run, never a passed one; fill is documented as bounded, not safe.

## Refinement (many-of-the-greats)

Adjudication of this packet's central design question (2026-09-07). Its consequences are folded into §2, §4, §5,
§8, §9, §10 and §11; decision-log entries that changed carry `revised by refinement`.

### QUESTION

When a test run performs a mutating browser action whose effect leaves the page (a form submit), which mechanism is
load-bearing for the guarantee that the run cannot cause an effect the operator did not intend: (a) a reviewable
plan artifact plus an explicit per-plan approval, (b) isolation of the world acted on (owned tab, origin allowlist,
throwaway origins and accounts), (c) restriction of the executing code's capabilities so that the unintended action
is inexpressible, or (d) an ordering of these in which each is load-bearing for one thing and none substitutes for
another? The packet already ANDs all three; the question is which one still holds when the others fail, which one
bounds the cost when the first is wrong, and what the remaining ones are then actually for.

### MODE 1 — MANY OF THE GREATS

#### School 1: Capability security (object-capability, least authority)
- Core claim: a system is safe against an action exactly when no component holds the authority to perform it.
  Checks that stand between held authority and its use are policy, and policy fails.
- Premises: authority is held, passed and attenuated, not evaluated at use time; the confused deputy is the normal
  failure of ambient authority; whoever can read a token can present it.
- Strongest case: the "Set bid" click happened because the probe could click anything on the page. No review, no
  allowlist and no flag were in the path, and none was needed, because the probe held the click. The only actions
  that never happen are the ones the code cannot express.
- What it sees that others miss: `--confirm-plan <plan_id>` compared with a value read from the same file the
  process opens is not a boundary; it is a string equality that any caller of `surf apply` satisfies with
  `jq .plan_id`. `SurfClient.type({ submit: true })` and a `click(selector)` that accepts any selector are the
  authority, and gating them leaves the authority in place.

#### School 2: Safety-engineering interlocks (Perrow, Leveson; arm-then-fire; two-person rule)
- Core claim: hazards live in sequences and states, not in components. An irreversible act is made safe by a
  physical separation between preparing and releasing, an independent deliberate act, and a recorder that captures
  intent before the act.
- Premises: humans and automations err in predictable ways; the accident is the coupling of a benign step (fill)
  to an irreversible one (submit); rarity is what keeps a deliberate act deliberate.
- Strongest case: prepare/apply with a file between them is an interlock; the receipt before the click is the
  flight recorder; the incident is the textbook coupling, a value-setting step wired to a release.
- What it sees that others miss: a confirmation performed hundreds of times a day by a pipeline is not a deliberate
  act. The two-person rule decays into a rubber stamp the moment it stops being rare; a gate convenient enough to
  sit in CI is no longer an interlock.

#### School 3: Test hermeticity
- Core claim: a test is a computation over a controlled world. Anything that can produce an effect in an
  uncontrolled world is an operation, not a test, whatever it is called.
- Premises: correctness is judged against a fixture the run owns; reproducibility requires owning the world;
  production origins and real accounts are never test targets.
- Strongest case: 150 Connects were lost on production Upwork with a real account. The failure is "a probe was
  pointed at the world", and the fix is the world, not the probe. A submit against a fixture server that records
  POST bodies is the only submit a testing framework should ever be proud of.
- What it sees that others miss: the interesting assertion, "the click reached the server exactly once", is
  unreachable under a gate that refuses submit by default. The origin allowlist is not a gate; it is a declaration
  of which worlds are disposable. Fill mode on a live SPA is already a non-hermetic effect (autosave), so "dry-run"
  against a public origin is a euphemism.

#### School 4: Plan/apply approval workflows (Terraform `plan -out`, GitOps review, change management)
- Core claim: the unit of trust is a legible artifact that is a faithful preimage of the effect. A human approves
  that artifact; apply executes that artifact and nothing else; drift invalidates.
- Premises: humans judge intent from a compact diff far better than from live behaviour; approval binds to content,
  not to a name; automation and review compose when the artifact is the boundary.
- Strongest case: plan/apply is the most successful mutation-safety pattern in infrastructure. The packet's plan,
  fingerprint and `--confirm-plan` are `terraform plan -out` and `apply plan.tfplan`. `forbidden_controls` listing
  "Set bid" before anything is clicked is the whole value: the operator sees the trap in the artifact.
- What it sees that others miss: legibility is a safety property. And approval must bind to the artifact's content
  hash, because an approved name with edited content is the classic plan/apply hole.

#### School 5: Effect typing (effect systems, "make illegal states unrepresentable")
- Core claim: classify every operation by the effects it may have and let the kernel refuse composition across
  effect kinds. A read-only operation is one that cannot invoke a mutating primitive, by type, not by discipline.
- Premises: effects are enumerable at the kernel/CLI boundary, and the boundary is where the check is decidable.
- Strongest case: packet 1's read-only/mutating classification is an effect system. `surf.plan` typed read-only
  cannot call `click`; `surf.apply` fill typed "page mutation" cannot call `key`; submit typed "external effect" is
  the only place a click can exist.
- What it sees that others miss: fill's real effect is not enumerable, because a `change` handler may navigate or
  POST. The type is honest only if it says "page mutation, external effect unknown", and the framework must then
  either bound that unknown or refuse it.

#### School 6: Fail-closed at-most-once (wrong-side failure, exactly-once impossibility, write-ahead intent)
- Core claim: the dangerous state is the one after the click, when the channel has not answered. Exactly-once over
  an unreliable channel does not exist; the achievable guarantee is at-most-once with a durable intent record
  written before the send, and "unknown" is a terminal, honest outcome that must never be retried into "twice".
- Premises: a click is a network send; a timeout is not evidence of non-delivery; anything checked before the click
  can be stale at the click.
- Strongest case: the only parts of the packet that hold under partial failure are receipt-before-click and
  never-retry. Everything else is pre-click ceremony that a race can invalidate.
- What it sees that others miss: the receipt must be durably on disk before the click, `submit_already_attempted`
  must key on the existence of any receipt including `attempting`, and a post-condition timeout yields `unknown`,
  not `failed`, with a non-zero exit.

#### School 7: Browser-automation practitioners (Playwright/Cypress authors; the surf-cli-go `bid-apply` author)
- Core claim: the DOM is ground truth only at the moment of action. Labels drift, submit buttons render lazily and
  flip `disabled` asynchronously, SPAs have no owning `<form>`, and Enter goes to whichever default button the
  browser picks. Practical safety is "resolve late, name what you click, wait for a post-condition, never press
  Enter to submit".
- Premises: static analysis of forms is best-effort; the framework sees the page, the site's JavaScript sees the
  world.
- Strongest case: the incident was a button clicked by text without knowing what the form's submit semantics were.
  `bid-apply` got it right: refuse on empty required fields, match one button's text, check `disabled`, click once,
  wait for the URL to leave `/apply` (research `:196-223`).
- What it sees that others miss: plan-time submit identification will be wrong often enough (lazy render, no owning
  form, `submit.status: none` on most SPAs) that apply-time re-resolution is the real check, and a gate that refuses
  `none` is a daily nuisance unless `--submit-selector` is first-class.

### MODE 2 — CONFRONTATION

#### Clash 1: Capability security vs Plan/apply approval
- Fundamental contradiction: is `--confirm-plan` a boundary or a ritual?
- Incompatible assumptions: the executing agent is a principal to be constrained (capability) versus a subordinate
  whose mistakes are bounded by review (approval). Capability says the token is derivable by the same principal that
  runs apply and confers nothing; approval says it was never a secret and never meant to be, it is a signature of
  intent by a principal who is not the agent, and the threat is mistake, not adversary.
- What capability explains better: the incident. The probe held authority it never needed, and no review would have
  been in its path.
- What approval explains better: why Terraform works with no secret token at all, and why `forbidden_controls` in
  a file the operator reads is worth more than any runtime check the operator never sees.
- Residual tension: in an agentic framework the "operator" who confirms may itself be an agent; then the ritual is
  theatre unless authority sits elsewhere. Resolvable, by denying the token any authority and placing authority in
  two places the agent does not own: the operator's config and the construction of the runner. The token survives
  as content binding, which is the only thing it was ever good for.

#### Clash 2: Test hermeticity vs everyone
- Fundamental contradiction: whether a testing framework may act on a non-owned origin at all.
- Incompatible assumptions: "test target implies owned world" versus "test target implies owned tab". `surf explore`
  already navigates public origins; dry-run fill against real UI is this packet's stated value; staging origins are
  shared and neither throwaway nor production.
- What hermeticity explains better: the incident's cost, and why the allowlist is the only mechanism that bounds
  cost when the code is wrong.
- What the others explain better: the existence of fill mode and the npmjs dogfood.
- Residual tension: whether fill on a public origin is a test at all is irreducible. The allowlist part is
  resolvable: it is reclassified from "one condition of the gate" to "a declaration that effects on this origin are
  acceptable", origin-only because the origin is the browser's own isolation unit and a path prefix is not, and
  operator-owned because a declaration about the world must come from whoever owns the world.

#### Clash 3: Effect typing vs Practitioners
- Fundamental contradiction: can fill's effect be typed?
- Incompatible assumptions: "unknown implies refuse" (effect typing under fail-closed) versus "unknown implies bound
  and observe" (practitioners, who know a `change` handler can POST and ship fill anyway).
- What effect typing explains better: why "dry-run" is a false word for fill.
- What practitioners explain better: why every real form tool ships fill, and why plan-time analysis cannot see the
  handler.
- Residual tension: irreducible. The honest position is the practitioners' with the effect typist's name for it:
  fill is a bounded, observed mutation, and a navigation or form loss during fill is a failed dry-run, never a
  passed one.

#### Clash 4: Interlocks vs Fail-closed at-most-once
- Fundamental contradiction: where the guarantee lives, before the click (separation, review, arming) or after it
  (durable intent, no retry, `unknown` terminal).
- Incompatible assumptions: interlocks assume the deliberate act is rare; the framework's purpose is automation.
- What interlocks explain better: why prepare and apply are two operations with an artifact between them.
- What at-most-once explains better: why the receipt is written with fsync before the click and not after, and why
  `unknown` must never be retried.
- Residual tension: the rarity premise contradicts the framework. Resolved by removing the two-person ritual and
  replacing it with reachability: submit mode is not reachable from any automated loop, so the act is deliberate
  because only an operator invocation can perform it.

#### Clash 5: Capability security vs Practitioners
- Fundamental contradiction: capability wants the addressable set fixed at construction; practitioners want late
  resolution because the DOM moves.
- Incompatible assumptions: none, once the two are separated in time. The runner is constructed with the plan's
  selectors as its only addressable set and resolves them late; drift is refused, never healed.
- What capability explains better: why a gated `click(selector)` is still a loaded weapon.
- What practitioners explain better: why `plan_stale` and `submit_control_changed` will fire on dynamic pages.
- Residual tension: the price of the union is `plan_stale` on dynamic pages, accepted.

### MODE 3 — INTEGRATION OR DECISION

- Chosen path: Contextual Dominance.
- Result: the packet's "gate" is not one gate with ANDed conditions and it is not defence in depth. It is four
  distinct hazards, each owned by exactly one school, and ownership is not transferable.
  - Hazard 1, wrong control (the "Set bid" click): owned by capability restriction. The apply path is constructed
    so that it cannot address any selector outside the plan's field controls and the one identified submit
    control, cannot press Enter, cannot pass `--submit`. This is the load-bearing invariant: it holds when the
    operator approves the wrong thing, when the allowlist is wrong, and when the page drifts. Review cannot own
    this hazard (review sees the plan, not the click); isolation cannot (it only prices the mistake).
  - Hazard 2, wrong world (an origin where effects cost something): owned by isolation. The allowlist is the
    operator's declaration that effects on this origin are acceptable. Nothing per-plan substitutes for it: no
    token opens a non-allowlisted origin, no flag adds one. It is the only layer that bounds cost when hazard 1's
    invariant is wrong, as with a `change` handler that submits.
  - Hazard 3, wrong intent (values or a submit the operator did not mean): owned by the reviewable plan plus a
    content-bound approval. Its guarantee is legibility and binding, not authority: the token is a hash of what
    was reviewed, it is readable by the agent, and that is acceptable.
  - Hazard 4, unknown after-state: owned by at-most-once. Durable receipt before the click, never retry, `unknown`
    terminal and non-zero.
  Interlocks survive as the reason prepare and apply are two operations with an artifact between them (the
  artifact is both the review object and the runner's grant list), and are otherwise rejected: no two-person rule,
  no confirmation prompt; submit mode is unreachable from the orchestrator, `heal` and every retry hook.
  Practitioners dominate the how at apply time: late resolution, a bounded wait on `disabled`, navigation detection
  during fill, no Enter, `--submit-selector` first-class.
- Why this path is justified: each school's strongest truth is exactly its ownership of one hazard, and each
  school's error is its claim on another's. Capability is right that the token is worthless as authority and wrong
  that it is therefore worthless. Approval is right that legibility is safety and wrong that approval is a
  boundary. Hermeticity is right about cost and wrong that fill is not a test. Interlocks are right about
  separation and wrong that the ritual makes it safe. A true synthesis would need something new to say about the
  after-state or about fill's effect, and there is nothing new to say; a single preference would have to throw away
  a hazard.
- What remains unresolved: whether fill on a non-owned origin should exist at all (hermeticity is overruled for v1
  with a named residual, not answered); whether an agent-operated approval is anything more than content binding
  (it is not, and if the framework ever needs authority in the approval it has to leave the process); and fill's
  effect stays untyped.

### PRACTICAL CONSEQUENCE

- `surf.apply` is built on a runner constructed from the plan whose addressable set is the plan's own controls;
  `SurfClient.type` loses `submit`; `SurfFlowBuilder` `click`/`type` are removed rather than gated (§4.3, D8).
- `--confirm-plan` takes a content hash, not a uuid; an edited plan is a stale plan (§4.1, §4.2, D2).
- The allowlist is origin-only, operator config only, with no flag or variable that adds to it; it is not one
  condition among three but the sole owner of the world hazard (§4.2, D9).
- A navigation during fill is `fill_side_effect_observed` and a failed dry-run; fill is documented as bounded, not
  safe (§4.2, D11).
- The receipt is fsynced before the click; any receipt, `attempting` or `unknown` included, blocks the plan for
  good; `unknown` exits non-zero (§4.2, D5).
- Submit mode is reachable only by operator invocation; no confirmation prompt replaces that (§5, D10).
- Refusals in submit mode are ordered by hazard: world, intent, at-most-once, then submit identification (§4.2).
