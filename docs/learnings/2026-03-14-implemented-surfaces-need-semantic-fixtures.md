---
summary: "Learning: implemented surfaces need adversarial semantic fixtures, not just route-level checks."
read_when:
  - "You are deciding whether a surface is truly implemented or only reachable"
  - "You are extending the operation kernel, surf client, healer, or summary metrics"
type: "learning"
---

# 2026-03-14 — Implemented surfaces need adversarial semantic fixtures

## Context
The fail-closed operation-kernel work made unsupported commands and flags reject clearly, but a deeper adversarial review still found misleading behavior inside surfaces already marked as implemented.

## Discovery
A surface is not genuinely implemented just because it has:
- a routed command
- a typed input schema
- a passing happy-path smoke test

It also needs at least one adversarial semantic fixture proving that the behavior means what the docs claim.

## Evidence
- `test --target https://... --quick` looked supported, but the URL override was meaningless once quick mode disabled the only shipped web consumer.
- coverage could report `overall=100` while `userFlows=0` and `apiEndpoints=0`, which inflated confidence without measuring the missing dimensions.
- `SurfClient.listTabs()` parsed bordered table output incorrectly even though the wrapper path itself succeeded.
- `SurfFlowBuilder` still ran assertions after a failed step until the flow contract was tightened.
- `TestFileHealer` reported no proposals for `getByTestId('old-login')` until the legacy-prefix heuristic was made executable.

## Application
Before marking a surface as implemented:
1. add at least one adversarial semantic fixture for the output shape or control-flow rule that matters
2. verify docs describe the same contract the fixture proves
3. treat missing denominators or skipped consumers as failures of meaning, not acceptable approximations
4. prefer explicit rejection over "technically routed but operationally inert"

## TIP Candidate
Yes — this generalizes beyond this repo to any CLI, SDK, or agent surface that can appear implemented before it is semantically trustworthy.
