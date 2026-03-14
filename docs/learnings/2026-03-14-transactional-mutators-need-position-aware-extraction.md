---
summary: "Learning: code mutators need position-aware extraction and transactional apply semantics."
read_when:
  - "You are extending heuristic code rewriting or healing behavior"
  - "You are deciding whether regex reachability is enough for a mutating runtime surface"
type: "learning"
---

# 2026-03-14 — Transactional mutators need position-aware extraction

## Context
The fail-closed operation-kernel work hardened routed surfaces, but the healing path could still misclassify ordinary string literals as selectors and could partially mutate a file before failing on a later proposal from the same line.

## Discovery
A mutating runtime surface is not trustworthy unless it does both of these:
- extracts candidates only from positions that semantically own the thing being changed
- validates the whole batch against the original snapshot before writing changes

## Evidence
- `TestFileHealer` now extracts selectors only from selector-bearing call positions such as `locator(...)`, `getByTestId(...)`, `page.click(selector)`, and `page.fill(selector, value)`.
- Ordinary payload literals such as `locator('#password').fill('old-password')` are no longer rewritten as if `'old-password'` were a selector.
- Batched healing now validates and renders per-file updates from the original content before writing, so same-line proposals no longer leave partial mutations behind.

## Application
When adding a new mutating fixer or healing rule:
1. model the semantic position first, not just the string shape
2. keep proposal coordinates from extraction through apply
3. compute the full file patch before writing anything
4. fail before write on mismatch, not after partial mutation

## TIP Candidate
Yes — this generalizes to any auto-fix, codemod, refactor, or repair workflow.
