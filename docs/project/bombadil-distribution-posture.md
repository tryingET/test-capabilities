---
summary: "Bombadil distribution posture for test-capabilities: external binary for consumers, no bundled Bombadil binaries in npm artifacts."
read_when:
  - "When changing Bombadil resolution, packaging, or release notes"
  - "When deciding whether to vendor/package Bombadil binaries"
type: "reference"
---

# Bombadil distribution posture

`test-capabilities` keeps Bombadil as an **external binary requirement** for now.

## Decision

- Do not vendor or package Bombadil release binaries in the npm artifact.
- Keep repo-local `external/bombadil` as a parked checkout/developer fallback, not a consumer-facing packed surface.
- Resolve Bombadil in this order:
  1. `TEST_CAPABILITIES_BOMBADIL_BIN`
  2. built `TEST_CAPABILITIES_BOMBADIL_REPO`
  3. built workspace contrib checkout
  4. repo-local parked `external/bombadil`
  5. `bombadil` on `PATH`
- Use upstream Bombadil release binaries for release verification when local source builds need unavailable prerequisites.

## Rationale

Bombadil is moving quickly, has its own release artifacts, and may require local build prerequisites outside this package's Node.js release lane. Shipping Bombadil inside `test-capabilities` would blur ownership, increase package size, and make security/update policy depend on a binary we do not currently build in this release workflow.

## Proof obligations

Before release, keep these checks true:

- packed consumers without a Bombadil binary receive a clear failing Bombadil finding, not a fake pass;
- `npm run bombadil:smoke` can run against an explicit upstream Bombadil binary through `TEST_CAPABILITIES_BOMBADIL_BIN`;
- release notes disclose that Bombadil-backed browser and terminal-fuzzer surfaces require an external Bombadil 0.5+ binary.

## Revisit trigger

Revisit vendoring only through an explicit distribution decision that covers supported platforms, checksums, update cadence, provenance, package size, and fallback behavior.
