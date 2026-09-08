---
summary: "Slice S7: the submit gate. `surf plan` writes a reviewable 0600 form plan with an RFC 8785 approval token over its content, and `surf apply` carries it out on a runner whose addressable set is the plan's own fields plus, in submit mode only, one self-consuming click. Four commits, 475 -> 517 tests, coverage 96.16 -> 96.24 % lines. Records the live run (npmjs fill-only; one submit against a local node:http form that saw exactly one POST), the deviation where the kernel's origin allowlist also gates a fill (against the packet's Q1, with a peer consultation), the receipt model that tags the phase rather than the run mode, and what S8 must know."
read_when:
  - "You pick up slice S8 or S9 and need the shape of the plan artifact, the apply runner, the new BrowserStep.settle seam or the fake's DOM."
  - "A run refuses with plan_field_*, value_via_button_refused, plan_stale, field_readback_mismatch, fill_side_effect_observed, submit_* and you want to know which rule produced it."
  - "You need the S7 gate outputs, the live submit transcript, or the deviations from the packet with their reasons."
type: "diary"
---

# Slice S7 notes (2026-09-08)

Plan: `docs/project/2026-09-07-surf-learnings-implementation-plan.md` §3 S7. Packets:
`2026-09-07-submit-gate-design.md` (primary; its `## Refinement (many-of-the-greats)` and every
`revised by …` line override the earlier text), `2026-09-07-mutation-safety-design.md` for the
receipt and ledger contract S7 consumes, `2026-09-07-architecture-adjudication.md` Part 4 and
claims 26, 36, 48, and the S6 slice note for the seams this slice fills.

Tree before the slice: `9360a82` (end of S6), 475 tests / 474 pass / 1 skipped, coverage
96.16 % lines / 86.71 % branches / 98.03 % functions on floors 90.36 / 79.58 / 92.90 (Node
26.8.1, c8 12.0.0). The other session's uncommitted changes (`AGENTS.md`,
`docs/dev/EXTENSION_SOP.md`, `scripts/install-hooks.sh`, the deleted `scripts/docs-list.sh`, the
`docs:list` hunks in `package.json`) were never staged; `package.json` was not touched by this
slice at all, so the index-blob method of plan §5 was not needed. `git status --short` after the
last commit lists only those five foreign paths.

## Commits

| commit | subject | tests after | lines/branches/functions | changed lines |
|---|---|---|---|---|
| `5132dcc` | feat(surf): surf plan writes a reviewable form plan with a JCS approval token | 490 (+15) | 95.92 / 86.30 / 96.75 | 93.92 % |
| `a9dce1d` | feat(surf): surf apply on a capability-restricted runner over Session | 517 (+27) | 96.24 / 86.52 / 97.99 | 95.43 % |
| `a2cb9c1` | fix(surf): no auto-screenshot on the gate's own calls; a non-JSON type reply is not a failure | 517 | 96.24 / 86.50 / 98.00 | 97.94 % |
| `10f6473` | docs(surf): plan/apply CLI and config reference, the form section, the live run | 517 | 96.24 / 86.50 / 98.00 | n/a (docs) |
| (this note) | docs(diary): slice S7 notes | 517 | 96.24 / 86.50 / 98.00 | n/a |

Gates after every commit: `npm run check` (lint, typecheck, node tests, cucumber, structure,
coverage ratchet, changed lines) green; `npm run loop-impact-plan` printed `impact=wide` /
`next=npm run loop-impact-wide`, and `LOOP_WIDE_REASON="slice S7 commit <n> …" npm run
loop-impact-wide` (= `release:check`: check, `truth:gate ok`, `consumer:smoke ok` on the packed
tarball) passed. Floors were not raised (S10 owns `coverage:raise`). The pre-existing biome
warning (`tests/fixtures/fake-surf.mjs`, unused `tab` parameter in `readinessGate`) is still the
only one and is untouched.

Structure after the slice: 57 modules, 162 runtime edges, 0 cycles, 4 exceptions. New modules:
`canonical-json.ts` 105, `surf-plan.ts` 453, `surf-plan-probe.ts` 602, `surf-apply-runner.ts`
513, `surf-plan-operation.ts` 201, `surf-apply-operation.ts` 482; `surf-session.ts` grew 677 ->
684 and stayed under the budget because both seams are one-line delegations to step lists that
live elsewhere. Two ledgered growths, both in oversized files:
`surf-explore-operation.ts` 872 -> 882 (the raw-input option check, see deviation 3) and
`surf-runtime.ts` 813 -> 821 -> 845 (`--tab-id` and `--no-screenshot` on the value-setting
verbs).

## What changed in behaviour

**A mutation is now a prepared act, and the preparation is a file.** `surf plan` reads a form
and writes `test-capabilities.surf.plan` v1 at mode 0600 through the kernel artifact writer:
every field with its resolved selector, its control, its current and intended value and
`set_via: field_input`; the one control that may be clicked or an explicit `ambiguous`/`none`
with the candidate list; the form-level buttons that may never be clicked; a fingerprint of the
page; and an `approval_token`. Nothing is typed and nothing is clicked - the verbs that could
are not reachable from the operation.

**The approval binds to content, not to a name.** The token is sha256 over the RFC 8785 (JCS)
canonical form of `{origin, fields[{resolved_selector, intended_value}], submit_selector}`. A
committed fixture plan and its expected token pin the canonicalisation (review A11), and the
same content in a different key order yields the same token while one changed character does
not. It is deliberately not a secret: it makes an edited plan refuse, it confers no authority.

**The code that could click the wrong button does not exist in the apply path.** The runner's
whole surface is `fingerprint`, `setValue(fieldId)`, `readBack(fieldId)`, `observe`,
`surfCalls`, `notes`, `close`, plus `clickSubmit` only when it was built in submit mode from a
plan whose control is `identified`. A fill-mode runner does not carry the property at all - at
the type level and at runtime, because the runner is a frozen object literal built by a factory
- and `clickSubmit` consumes itself. `setValue` takes a field id, so a selector the plan never
resolved is not expressible as an argument. The operation holds no session after handing it to
`session.apply(...)`, which a contract test pins by reading the operation's own source.

**The refusals are ordered by hazard, and all four happen before a tab is opened**: the world
(`mutation.allowOrigins` through `--config`), the intent (`--submit` plus `--confirm-plan`
equal to the token recomputed from the plan's content), at-most-once
(`listReceipts({planId, mode: "submit"})`) and identification. After the fill the control gets a
bounded wait on `disabled` and must still be unique, enabled and inside the fields' owning form.

**The post-condition is the receipt's verification.** The click step settles `unknown` by
construction - the click reached the page, and whether it took effect is what the post-condition
is for - and its `verify()` polls until `surf.submit.postconditionTimeoutMs`. A satisfied
post-condition promotes the receipt to `applied` with `verified_by: post_read`; an unsatisfied
one leaves `unknown`, and the operation renders that as `submit_postcondition_unmet` with
`submitted: "unknown"` and exit 1. Rule (3) then refuses that plan for good.

## Live run (2026-09-08, Chromium (Agent), owned tabs)

Full transcript in `docs/project/2026-09-07-submit-gate-live-run.md`. The short version:

- **Fill only, public origin.** `surf plan --url https://www.npmjs.com/ --field 'name:q=surf-cli'`
  resolved `input[name="q"]`, recorded `submit.status: none` with the reason
  (`no_unique_selector` - npmjs's search button has no id or name to derive one from), and
  printed its token as the only stdout line. `surf apply` set the value, read back `surf-cli`
  (`matched: true`), issued no `click` and no `--submit`, closed the tab, and left one `applied`
  fill receipt. `tab.list` was identical before and after.
- **The one submit, against a world this run owns.** `tests/fixtures/form-fixture-server.mjs` on
  `http://127.0.0.1:41487/`, that origin and only that origin allowlisted. The plan resolved the
  `label:Search packages` locator through `<label for=q>` to `#q`, identified `#search-submit`
  and put `#set-bid` into `forbidden_controls`. `surf apply --submit --confirm-plan <token>
  --until-url-prefix …/done` clicked exactly one control; the server recorded **exactly one
  POST** (`q=surf-cli`); the submit receipt is `applied` with `verified_by: post_read` and the
  observed `/done` URL as evidence; the second attempt refused with `submit_already_attempted`
  and the server still shows one POST.
- **Refusals live**, each with nothing sent to the browser: `submit_gate_closed` (no
  `--confirm-plan`), `submit_plan_mismatch` (wrong token), `mutation_origin_not_allowed` (fill,
  empty allowlist), `submit_origin_not_allowed` (submit, empty allowlist) and
  `value_via_button_refused` for `--field 'selector:#set-bid=150'` - the incident's own rule,
  live.

Two live findings changed the code (commit `a2cb9c1`): the surf build screenshots the page to
`/tmp` after every value-setting verb *and* every `js` call, which copies the typed value out of
the 0600 artifacts (four per fill run; zero after the gate started passing the undocumented
`--no-screenshot`), and `surf type` answers `OK` rather than JSON, which had turned a successful
fill into `Invalid JSON output from surf type`.

## Deviations from the packet and the plan, with reasons

1. **A fill needs the origin declared too.** The packet's Q1 says fill mode does not require the
   allowlist. The mutation-safety packet as amended (A13, upheld by the adjudication) says every
   `mutating/target` step whose subject is a web origin consults `mutation.allowOrigins`, and S5
   implemented exactly that in the ledger. Exempting a fill would mean either lying about its
   scope (`browser_session` for something that types into the target) or special-casing "fill"
   inside a kernel file this slice does not own. The stricter rule stands: a fill on an
   undeclared origin refuses with `mutation_origin_not_allowed` before a tab is opened, and the
   packet's `submit_origin_not_allowed` is kept for submit mode. The two specs are not both
   satisfied, and the docs say so; reconciling P2 Q1 is a follow-up for whoever owns the packet.
2. **`details.mode` is the phase, not the run's mode.** The packet's §4.2 receipt is "one per
   apply attempt"; the implementation plan says "apply receipts are `runStep` receipts", which is
   also what S6's session mechanism produces (one receipt per mutating step). So a run writes one
   receipt per field plus, in submit mode, one for the click, and `details.mode` is `fill` for
   the value-setting acts even inside a submit run, with `details.apply_mode` recording the run's
   mode. That is what makes rule (3) key on the irreversible act alone: a submit run that failed
   at the read-back does not burn the plan, while a click that happened - or may have happened -
   does.
3. **The option check runs over the raw input.** The three surf actions share one commander
   command, so `--field` reaches explore and `--depth` reaches plan. A check inside the schema's
   `transform` sees only declared keys, because zod strips the rest first, so the check moved
   into a `preprocess` over the raw input. That is the ten-line growth of
   `surf-explore-operation.ts`.
4. **`BrowserStep` gained an optional `settle`.** The submit step has to settle `unknown` on a
   *successful* click so that its post-condition can run as the receipt's `verify`. The ledger's
   rules still apply (a resolved value may settle `applied` or `unknown`, never `failed`), so the
   seam cannot be used to claim an act succeeded.
5. **`settleSurfAttempt` moved to `surf-adapter.ts`** (re-exported from `surf-session.ts`, so
   every existing import still works). The runner needs it and the session needs the runner;
   without the move the two modules would import each other and the structure check's
   `allowed_cycles: []` would fail.
6. **`--no-screenshot` on every call the gate makes**, including its read-only `js` reads. The
   packet asks for auto-screenshot to be disabled; the flag exists but is undocumented in
   `surf --help-full`. `surf explore`'s probes still take screenshots - that is S6's path, and a
   follow-up.
7. **Plan-time submit identification does not require an enabled control.** The packet's `none`
   clause mentions "one visible enabled button" for the `--submit-selector` case; the refinement
   then gives `disabled` a bounded wait at apply time (D4). Identifying a disabled control and
   waiting for it is the behaviour the refinement asks for, so `disabled` is recorded in the plan
   rather than being a plan-time refusal.
8. **`plan_field_unreachable` is inferred from frame count, not from a frame probe.** When a
   locator matches nothing and the page carries iframes, the refusal is `plan_field_unreachable`
   naming the count; otherwise it is `plan_field_not_found`. Shadow roots are not detected in
   v1. S8's `frame.diagnose` is what turns this into a determination.
9. **The envelope redacts the field values out of its own input echo.** `--field
   'name:q=surf-cli'` carries the value on the command line, and every envelope echoes its input;
   the echo now reads `name:q=[redacted]`, because the 0600 artifact is where values live
   (review A10).
10. **An unreadable page before the click is `submit_control_changed`.** The first version
    proceeded when the pre-click observation could not be taken, which is fail-open on the one
    irreversible act. A contract test caught it.
11. **Five refusals are fixture-proved, not live**: `submit_control_disabled`,
    `submit_control_changed`, `fill_side_effect_observed`, `plan_stale` and
    `submit_postcondition_unmet`. Each needs a page that misbehaves in a specific way; the fake's
    page model (`controlsAfterType`, `typeNavigatesTo`, `enabled: false`) produces them
    deterministically.

## Peer consultation

Question to `openai-codex/gpt-6-astra` (`pi -ne -nc -nt`): deviation 1 above - does the kernel's
origin allowlist win over the submit-gate packet's Q1 for a *fill*, or should the leaf slice
build an exemption, and if so what shape of exemption would not create a classification-bypass
hole?

Answer, condensed: the implementation is right, "not because stricter always wins, but because
Spec B's later architecture amendment and adjudication explicitly cover this classification".
Typing can trigger autosave, requests or application actions without a click or a navigation, so
an owned tab does not make those effects browser-session-only and reclassifying a fill as
`browser_session` "would therefore be a classification bypass"; a leaf-specific exception inside
the ledger "would also weaken the adjudicated contract". If fill-without-allowlist is a product
requirement it needs an explicit, centrally enforced policy amendment with narrow authorisation
and auditability - "neither a caller-supplied 'fill' label nor 'no click' is sufficient
authorization". One sharpening was adopted verbatim: **do not describe both specs as satisfied**.
The docs and deviation 1 now name the conflict and ask for P2 Q1 to be reconciled rather than
implying the packet was honoured.

## What S8 and S9 must know

- **`Session.plan` and `Session.apply` are implemented; `explainUnreachable` is still the seam.**
  It refuses with `unsupported_surf_action` and `Promise<never>` says so at the type level. The
  pattern to copy is `surf-plan-probe.ts`: a step list in its own module that takes the session,
  so `surf-session.ts` stays a one-line delegation and under the 700-line budget.
- **`BrowserStep` now carries `details` (onto the receipt) and `settle`.** A step that needs a
  post-read to decide what happened settles `unknown` and does the read in `verify()`; the ledger
  runs `verify` only for `unknown`, and only a promotion is possible.
- **`type`, `select` and `click` are reachable through `step()`** since this slice: their argv
  mapping carries the global `--tab-id`, and `SESSION_TAB_SCOPED_COMMANDS` lists them. Adding
  another verb is still the three-edit rule from S6 (class in `surfEffect`, mapping in
  `translateSurfArgs`, tab list in `surf-session.ts`).
- **Pass `--no-screenshot`** on any browser call that reads or writes page content, or the surf
  build leaves a picture of the page in `/tmp`. `js`, `type`, `select` and `click` accept it.
- **The fake's document is a small DOM now**, not a selector lookup: comma lists, tag names,
  `#id`, `[attr="value"]`, `<label>` with `control`, `el.form`, layout boxes, plus the page-model
  keys `fields[].{name,id,label,form,hidden}`, `controls[].{text,form,visible,enabled}`,
  `controlsAfterType`, `typeNavigatesTo` and `submitPostsTo`. S8's frame work can extend
  `frames` the same way; keep the rule that the fake never learns a verb from prose.
- **`tests/fixtures/form-fixture-server.mjs`** is a reusable `node:http` world: one form, records
  POST bodies, `GET /__posts` reads them back, and it runs standalone for a live lane. The fake
  posts to it on a submit click when the page model says `submitPostsTo`, which is how the
  contract suite can assert "exactly one POST" without a browser.
- **A suite that runs an apply** writes its config with `receipts.dir`, `receipts.ephemeral:
  true` and `mutation.allow_origins`, and passes it with `--config`; that is also how
  `surf.submit.*` timeouts are shortened in tests.
- Test count after S7: 517 (516 pass, 1 skipped); `npm run check` ~25 s, of which the coverage
  ratchet is ~8 s.
