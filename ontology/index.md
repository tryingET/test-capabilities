---
summary: "Entry index for repo-local ontology layers and generated ontology artifacts."
read_when:
  - "You are navigating ontology files manually"
  - "You need quick pointers to manifest, bridge, and concept locations"
type: "reference"
---

# Ontology Index (repo)

Start here when browsing manually.

- `ontology/manifest.yaml` — which layers apply
- `ontology/src/system4d.yaml` — repo-local System4D (implementation)
- `ontology/src/reference/concepts/` — repo-local concepts (only when needed)
- `ontology/src/bridge/mapping.yaml` — map concepts to code symbols
- `ontology/dist/` — generated artifacts (tool-first)

Tip: Use `./scripts/rocs.sh pack <concept_id>` instead of opening many files.
