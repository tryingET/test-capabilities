---
summary: "Adoption guide index for test-capabilities in greenfield and brownfield repos."
read_when:
  - "You want to add test-capabilities to a repo and need the right adoption path"
  - "You are choosing between greenfield, brownfield, and minimal first-run docs"
type: "guide"
---

# Adoption guides

Use these guides when you are adding `test-capabilities` to another repository or a new project.

| Guide | Use when |
|---|---|
| [Greenfield bootstrap how-to](greenfield-bootstrap-how-to.md) | You are starting a new repo and can shape config, scripts, CI, and target conventions up front. |
| [Brownfield integration how-to](brownfield-integration-how-to.md) | The target repo already has CLIs, tests, web apps, CI, or external runtime constraints. |
| [Minimal CLI smoke walkthrough](minimal-cli-smoke-walkthrough.md) | You want the smallest concrete path from install to a green zero-external-dependency run. |
| [Bombadil 0.5 adoption guide](bombadil-0.5-how-to.md) | You want bounded browser property exploration or experimental terminal-fuzzer evidence through an external Bombadil binary. |

Canonical command semantics remain in:

- [`../api/cli.md`](../api/cli.md)
- [`../api/config.md`](../api/config.md)
- [`../api/getting-started.md`](../api/getting-started.md)
- [`../api/examples.md`](../api/examples.md)

Adoption docs should not overclaim unsupported autonomy, prediction, or self-healing intelligence. Start with the polished public use case: **CLI smoke + observation diagnostics**.
