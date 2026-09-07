---
summary: "Slice S4: every sensor classifies through the pure classifier, the run reports a Determination with a basis, an undeclared empty result is unverified rather than passed, and the healer proposes only from a fault."
read_when:
  - "You pick up slice S5 (run context, effects, ledger, receipts) and need what S4 left in place."
  - "A run reports 'unverified' and you want to know which rule produced it."
  - "You wonder why a CLI target that exits 0 no longer passes."
type: "diary"
---

# Slice S4: classification consumers and the run determination

Three commits on `main`, gates green after each. The slice was interrupted three times by
transport errors in the implementing session; the first commit was assembled from that session's
finished working tree and the rest was carried through directly.

| commit | scope |
|---|---|
| `6b67b9a` | consumers read the typed outcome; `TestResult.determination` next to `passed`; the surf catch site carries the basis; cli `effect.reason`; Bombadil `traceBytes` |
| `fdd35d1` | the cli tester classifies its payload; `agents.<name>.expect` declarations with provenance; the init template hint |
| `5be9eee` | explore's declared link emptiness and the refusal of undeclared `empty` readiness; healing only from a fault; both ledger entries |

## What changed in behaviour

An exit code is no longer a verdict. Every sensor step now carries a `ResultOutcome` with a
basis, and the run composes them into a `Determination` whose value is one of `verified`,
`failed`, `unverified`, `indeterminate`. `TestResult.passed` stays as
`determination.value === "verified"` and exit codes stay 0/1 (operator decision D3).

The rule that changes the most runs: a step that exits 0 and produces no payload is `empty` with
basis `no_evidence`, and the run is `unverified`. That is not a claim that the target is broken,
so such a finding does not count as blocking and the determination never renders it as `failed`.
Declaring the shape with `agents.<name>.expect.output: empty` turns it into `declared_empty`,
which passes and records who declared it.

The healer proposes selector rewrites only from findings whose basis is `fault`. A finding
without an outcome is legacy input and still heals, so receipts written before this slice work
unchanged.

## Gates

| | before S4 | after S4 |
|---|---|---|
| tests | 370 | 385 (384 pass, 1 skipped) |
| lines | 93.58 % | 93.69 % (floor 90.36) |
| branches | 83.47 % | 83.85 % (floor 79.58) |
| functions | 94.33 % | 94.68 % (floor 92.90) |

`npm run check` (lint, typecheck, structure, coverage ratchet, changed-lines) green before each
commit; changed-lines 93.77 %, 91.03 % and 94.37 % against a 90.36 % floor.

## Dogfood (Chromium (Agent), owned tabs, no logins)

The agent browser had stopped and was restarted as `chromium-agent.service` before the run;
`surf doctor --browser chromium` reported OK.

| case | result |
|---|---|
| `surf explore --url https://docs.python.org/3/ --json` | 1 page, both probes `success` / `evidence`, coverage `verified` |
| `surf explore --url https://github.com/login --json` | refused with `page_login` and its evidence, exit 1, distinct from a runtime failure |
| silent CLI target through `bin/test-capabilities test --json` | `cli-empty-result`, `empty` / `no_evidence`, determination `unverified`, exit 1 |
| CLI target writing only to stderr, exit 0 | same verdict, with the stderr channel preserved as diagnostics and never read as payload |
| the same silent target with `expect.output: empty` | `declared_empty` from `config:agents.cli.expect`, determination `verified`, exit 0 |

## Deviations

1. **The plan's `true` example is wrong on this machine.** It named `targets.cli: "true"` as the
   smallest silent target. GNU coreutils' `true --help` prints 944 bytes of usage, which is real
   evidence and correctly classifies as `success`. The contract test and the dogfood use a
   one-line script instead. The packet's rule is unaffected; only the example was.
2. **Evidence order changed.** `outcome:<class>:<code>` and `basis:<basis>` now lead a finding's
   evidence, with the raw channel last. Three existing tests asserted on `evidence[0]` and were
   updated to assert the typed lines first and the channel at `evidence.at(-1)`.
3. **Two ledger entries were needed.** `surf-explore-operation.ts` (901 to 932 lines) and
   `self-healing.ts` (821 to 841) are both already over the 700-line budget, so the ratchet
   required a reasoned entry for each. Both name the S6 restructuring as the scheduled shrink.
   The explore figure includes five lines the formatter added.
4. **`HealingFinding` carries `outcome.basis`, not the rendered marker.** The healer reads the
   typed field (adjudication axiom A7); the `basis:` evidence line stays a rendering. The heal
   input schema passes the field through, so `test --json` receipts feed the healer directly.
5. **The author declaration.** An agent with no config still declares what it knows about the
   step it ran (`author:cli-tester`, payload opaque). This is the provenance the plan asked for
   in a smaller form than a separate registry.

## What S5 must know

- `RawResult.effect` is still the only source of `indeterminate`, and nothing sets it yet. S5's
  mutation ledger is what makes that basis reachable in a real run.
- The receipt work in S5 owns `receipts.dir` and the ephemeral refusal; nothing in S4 writes a
  receipt, and `heal`'s `appliedCount` still derives from proven writes as S1 left it.
- `agents.<name>.expect` is in the kernel config schema, so S5's `receipts` and `mutation` keys
  land beside it in the same file.
- Both oversized files that S5 touches (`self-healing.ts`, and `orchestrator.ts` if the run
  context reaches it) will need their own ledger entries; the budget is enforced in `pre-commit`.
- The agent browser is not always running. Start it with
  `systemd-run --user --unit chromium-agent --collect ~/.local/bin/chromium-agent.sh` before any
  live dogfood, and check `surf doctor --browser chromium` first.
