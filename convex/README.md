---
summary: "Convex runtime placeholder for owned repos that need runtime-backed checks."
read_when:
  - "Adding Convex functions, local runtime scripts, or runtime contract tests"
---

# Convex runtime scaffold

Use this directory when the repo adds Convex runtime behavior.

Conventions:

- Runtime-heavy tests stay opt-in behind `RUN_CONVEX_RUNTIME_TESTS`.
- Runtime tests require explicit endpoint metadata (`CONVEX_URL` or `CONVEX_DEPLOYMENT`).
- Keep generated Convex artifacts out of git (`convex/_generated/`, `.convex/`).
