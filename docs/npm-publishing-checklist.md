---
summary: "Checklist for releasing test-capabilities through GitHub Release and npm Trusted Publishing/OIDC."
read_when:
  - "When preparing the first public npm release for test-capabilities"
  - "When deciding whether the current package layout is publish-ready"
type: "how-to"
---

# npm release checklist

GitHub Release is the single release intent for `test-capabilities`. Local sessions prepare proof and release notes; npm publication happens automatically in `.github/workflows/publish.yml` through npm Trusted Publishing/OIDC after a GitHub Release is published. Prerelease GitHub Releases publish with npm dist-tag `next`; other releases publish with `latest`.

## 1) Confirm package metadata

Before publish, verify:

- `package.json` has no `private: true`
- `license` is `MIT` (matching the release-intent checker)
- root `LICENSE` exists
- `repository`, `homepage`, `bugs`, and `publishConfig.access: public` point at `tryingET/test-capabilities`
- `main`, `types`, `exports`, `bin`, and `files` match the shipped package surface

Use:

```bash
npm run release:intent:check
```

## 2) Confirm packed file boundaries

The package intentionally ships a narrow surface:

- `bin/`
- `dist/`
- `examples/demo/` and `schemas/`
- `README.md`
- `LICENSE` (included automatically by npm)
- `test-capabilities.yaml`
- publish-ready `package.json`

The package must not ship repo-only runtime fixtures, internal docs, prompts, tests, generated source maps, or vendored external binaries unless a future release decision changes the package boundary.

Use:

```bash
npm run consumer:smoke
# Reuse an already packed intended artifact, without repacking/rebuilding/deleting it:
node scripts/consumer_contract_smoke.mjs --tarball /absolute/path/test-capabilities-<version>.tgz
```

The publisher prepares one tarball, runs these same consumer assertions against that file,
and records SHA-256/size and clean source identity in a versioned digest manifest. It
publishes that file with `--ignore-scripts`, not the repository root. Default consumer smoke
still owns its own pack/prepack and cleanup. See [release workflow](releases/release-workflow.md)
for preparation, filename/digest pins and supported host policy.

## 3) Verify repo truth before release

Run:

```bash
COVERAGE_BASE=v0.3.0 STRUCTURE_BASE=30f1a868b6e56e6475fc399e691e9f0d5cdb760f npm run release:check
npm run docs:list -- --docs . --strict
```

For public-only environments without the workspace docs helper, `npm run release:check` remains the required deterministic package gate.

The publisher's equivalent proof preserves `check` and `truth:gate`, then packs once and
runs the full consumer script against that exact tarball. It requires `.nvmrc` Node 22
(at least 22.22.2, matching npm's engine), pinned npm 12.0.2, unchanged measured coverage floors, a clean checkout,
complete Git history and an explicit strict-ancestor comparison. This release uses
`COVERAGE_BASE=refs/tags/v0.3.0` for all release changed lines, and
`STRUCTURE_BASE=30f1a868b6e56e6475fc399e691e9f0d5cdb760f` for the already adopted structure ledger.
v0.3.0 has neither ratchet file; no invented adoption entry or weakened floor is used to
force that historical comparison. Both references/SHAs are validated and recorded; the
full current structure limits still apply. Missing/invalid/self-comparisons stop without fallback. Local fixture passes alone do not qualify clean Node 22.
Artifact-selection/source-map overrides are refused; a supplied package-root selector must
name the checkout. Hosted consumer fixtures explicitly declare scratch receipt acceptance;
production CI-store durability and origin checks remain unchanged.

Hosted deep strict-docs proof uses the complete private `agent-scripts` provider at its pinned
commit, not a workstation path or consumer copy. Provision the least-privilege GitHub App
access described in [release workflow](releases/release-workflow.md), repository variable
`DOCS_PROVIDER_CLIENT_ID` and secret `DOCS_PROVIDER_PRIVATE_KEY`. Missing access fails;
source wiring alone does not establish a passing hosted docs check.

## 4) Confirm public docs posture

Before publishing, re-check:

- README leads with shipped fail-closed behavior, not future autonomy claims
- `docs/api/` describes implemented runtime surfaces and fail-closed unsupported modes
- `docs/project/vision.md` is clearly north-star/roadmap, not current support
- local maintainer or workspace-specific paths are not required for public users
- release notes disclose external runtime requirements for Bombadil-compatible browser/terminal-fuzzer and surf CLI (nicobailon/surf-cli) integrations

## 5) Configure npm Trusted Publishing

On npmjs.com, configure Trusted Publishing for:

- package: `test-capabilities`
- GitHub owner / organization: `tryingET`
- repository: `test-capabilities`
- workflow filename: `publish.yml`
- environment name: `npm-publish`

Do not add an npm token to the repository for normal releases. Runtime/OIDC prerequisites
do not prove the external tuple is configured. If publication returns `ENEEDAUTH`, investigate
the tuple (`tryingET` / `test-capabilities` / `publish.yml` / `npm-publish`) and bootstrap needs.
Reconcile registry state before any separately authorized retry; never automatically retry
npm publication or asset upload.

Before creating public intent, confirm the published Release can accept later assets:
its API must explicitly report `immutable: false`. Immutable or unknown host policy stops
the prepared publisher before npm mutation. Package prerelease versions require the GitHub
prerelease flag (`next`); stable versions require a non-prerelease Release (`latest`).

## 6) Create release intent

After local proof passes:

```bash
git tag -a v<next-version> -m "test-capabilities v<next-version>"
git push origin main
git push origin v<next-version>
gh release create v<next-version> --title "test-capabilities v<next-version>" --notes-file docs/releases/<release-notes-file>.md
```

Publishing the GitHub Release triggers npm publication.

## 7) Verify public publication

After the workflow succeeds:

```bash
npm run release:verify-public -- --version <released-version>
```

The verifier waits for exact-version npm visibility and checks public `npx` installability for `test-capabilities --help`, `test-capabilities doctor --json`, and the `tc` CLI alias.

The workflow rechecks pinned bytes immediately before publication and asset upload, then
attaches that same `.tgz` and `.manifest.json` without overwrite. This source preparation
has not published anything or proven downloaded npm/GitHub artifact identity. Read-only
registry propagation retries are not permission to repeat mutations. If npm succeeds but
verification/attachment fails, preserve the workflow artifact and logs and reconcile both
channels before owner-directed recovery.
