---
summary: "Learning: semantic outputs must distinguish unmeasured, candidate, and verified states."
read_when:
  - "You are emitting success, confidence, coverage, or edge-case summaries"
  - "You are deciding whether a heuristic output is trustworthy enough to present as real"
type: "learning"
---

# 2026-03-14 — Semantic outputs must distinguish unmeasured, candidate, and verified states

## Context
A deeper nexus pass found that several runtime surfaces were route-correct but semantically loose. The system could emit green or authoritative-looking output even when the underlying meaning was partial, speculative, or self-fabricated.

## Discovery
A semantic output needs more than a value. It needs a state.

Three distinct states kept collapsing into one:
- **unmeasured** — no trustworthy denominator exists yet
- **candidate** — a heuristic found a plausible answer but it is not verified
- **verified** — the runtime has enough evidence to present the result as real

When those states collapse:
- coverage hides missing denominators behind percentages
- healing labels guesses as success
- simulators report their own fabricated states as discoveries
- confidence scores look calibrated even when input completeness is undefined

## Evidence
- orchestrator coverage now carries `measuredDimensions` and `unmeasuredDimensions` instead of silently averaging absent dimensions into the score
- low-confidence healing results now stay out of the success path and require review instead of returning `success: true`
- quantum navigation targets are derived as valid URLs so the simulator stops inventing non-URL navigation failures for itself
- prediction input now validates the full numeric schema before emitting confidence

## Application
Before exposing a result to users, docs, or downstream automation:
1. identify whether the output is unmeasured, candidate, or verified
2. encode that state in the runtime contract instead of implying it through prose
3. add an adversarial fixture proving the surface cannot silently collapse those states again
4. prefer explicit gaps over inflated confidence

## TIP Candidate
Yes — this generalizes across CLIs, SDKs, simulations, and agent tooling. Any system that emits semantic summaries should represent missing, speculative, and verified states explicitly.