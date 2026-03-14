---
summary: "Learning: shipped verbs compound when owned by one executable operation kernel."
read_when:
  - "You are deciding where shipped command semantics should live"
  - "You are extending the TEST-CAPABILITIES runtime surface"
type: "learning"
---

# 2026-03-14 — Executable operation kernels should own shipped verbs

## Context
This repo had already converged on a fail-closed runtime contract, but the shipped CLI behavior still lived partly in `bin/test-capabilities` and partly in scattered capability metadata. That left the repo only partially aligned with the stable-core / thin-adapter learning.

## Discovery
A fail-closed contract compounds more when the shipped verbs are owned by one executable operation kernel than when support status, parsing, execution, and docs are spread across wrappers.

## Evidence
- `src/core/operations.ts` now owns the shipped routes, their input schemas, executors, structured outputs, and route manifest.
- `src/core/capabilities.ts` derives CLI route support from the operation kernel instead of duplicating command/action truth.
- `bin/test-capabilities` became a thin adapter that parses flags, dispatches through `executeCliOperation(...)`, and renders result envelopes.
- Contract tests now assert the registry/manifest/dispatch alignment.

## Application
Use this pattern in any repo where a shipped CLI, tool, agent surface, or RPC layer risks diverging from the real core behavior. Make the public verbs executable from one typed kernel first; make adapters thin second.

## TIP Candidate
Yes — this is a reusable sub-pattern of stable-core / thin-adapter systems because it turns support status from prose into executable architecture.
