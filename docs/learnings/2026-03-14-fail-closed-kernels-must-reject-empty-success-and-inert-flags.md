---
summary: "Learning: fail-closed operation kernels must reject empty-success outcomes and inert flags."
read_when:
  - "You are extending the operation kernel with new CLI flags or routes"
  - "You are deciding whether to accept a compatibility flag without real behavior"
type: "learning"
---

# 2026-03-14 — Fail-closed kernels must reject empty-success outcomes and inert flags

## Context
The operation-kernel refactor unified shipped verbs, but several negative paths still degraded into green outcomes or accepted-but-unused flags. That violated the repo's fail-closed promise even while the happy-path contract looked clean.

## Discovery
A kernel is not truly fail-closed unless it owns the negative-path contract too:
- invalid scalar inputs must error
- missing filesystem dependencies must error
- accepted flags must either change runtime behavior or be rejected
- file mutations must target the recorded location, not the first matching string in the file

## Evidence
- `quantum --branches 0` now fails instead of reporting `0` simulated universes as success.
- `heal --dir <missing>` now fails instead of reporting an empty proposal set as success.
- `surf explore --record` and similar inert flags now fail instead of silently doing nothing.
- `TestFileHealer.applyProposal(...)` now rewrites the proposal's recorded line instead of blindly replacing the first matching selector in the file.

## Application
When adding a new shipped route or flag:
1. define its supported-option contract explicitly in the kernel
2. add negative tests for invalid values, missing dependencies, and unknown sub-actions
3. reject compatibility no-ops unless they are wired to real behavior
4. treat empty success as suspicious unless the absence of work is itself a validated result

## TIP Candidate
Yes — this is a reusable rule for any fail-closed CLI or RPC surface.
