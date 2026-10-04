---
summary: "Release workflow contract for local preparation, GitHub Release intent, and npm Trusted Publishing/OIDC."
read_when:
  - "When preparing a test-capabilities release"
  - "When configuring npm Trusted Publishing for test-capabilities"
  - "When reconciling GitHub Release, npm, tag, and package authority"
type: "how-to"
---

# Release workflow

`test-capabilities` uses the same release-authority shape as `ts-quality`: **GitHub Release is the single public release intent**. Local work prepares and proves the release; npm publication is performed by GitHub Actions through npm Trusted Publishing/OIDC.

## Authority chain

```text
local release prep
  -> version/docs/release notes
  -> package proof
  -> commit + tag
  -> GitHub Release published
  -> .github/workflows/publish.yml
  -> npm Trusted Publishing/OIDC
  -> public npm verification
  -> proven tarball attached to GitHub Release
```

Do **not** run local `npm publish` for normal releases. The package root is the publishable package, and GitHub Actions owns the final publish mutation.

## One-time external setup

Before the first workflow-driven npm publish, configure npm Trusted Publishing for:

- package: `test-capabilities`
- GitHub owner / organization: `tryingET`
- repository: `test-capabilities`
- workflow filename: `publish.yml` — enter only the filename in npm, not `.github/workflows/publish.yml`
- environment name: `npm-publish`

The workflow uses GitHub-hosted runners, the GitHub Actions environment `npm-publish`,
`id-token: write`, the declared `.nvmrc` Node `22` lane (at least `22.22.2`, required by pinned npm's engine), and pinned
npm `12.0.2`. Node 22 has measured coverage floors; Node 24 does not. Neither floors nor
source budgets are relaxed. Publication delegates exactly one
`npm publish <verified-file.tgz> --ignore-scripts --provenance --access public --tag <tag>`. It must not require `NPM_TOKEN` or `NODE_AUTH_TOKEN`, and it intentionally does not configure `actions/setup-node` with `registry-url` so npm does not prefer token auth over Trusted Publishing/OIDC.

If the publish step fails with `ENEEDAUTH` after runtime prerequisites pass, investigate
external npm Trusted Publisher configuration: the package setting, exact tuple, and any
bootstrap requirement. Runtime prerequisites do not prove external authorization. Do not
retry a mutation automatically; first reconcile the exact version's registry state.

## Local preparation

Before tagging a release, run:

```bash
npm run release:intent:check
COVERAGE_BASE=v0.3.0 STRUCTURE_BASE=30f1a868b6e56e6475fc399e691e9f0d5cdb760f npm run release:check
npm run docs:list -- --docs . --strict
```

For public-only environments without the workspace docs helper, the required package proof remains:

```bash
npm run release:intent:check
COVERAGE_BASE=v0.3.0 STRUCTURE_BASE=30f1a868b6e56e6475fc399e691e9f0d5cdb760f npm run release:check
```

If package contents, metadata, README, LICENSE, built output, or generated capability surfaces change after this proof, rerun the proof before creating the release.

### Independent hosted qualification without publication

When separately authorized, dispatch the `ci` workflow's `artifact` lane on an exact source
revision. This is a clean Node 22/npm 12.0.2 source-and-package proof, not public release intent:

```bash
SHA=$(git rev-parse HEAD)
# First obtain explicit authorization for the source push and this exact dispatch.
gh workflow run ci.yml --ref main -f lane=artifact -f qualification_sha="$SHA" -f coverage_base=refs/tags/v0.3.0
```

The runner checks both checkout HEAD and GitHub's source SHA against `qualification_sha`.
It refuses any pre-existing version tag and creates a synthetic `v<package-version>` ref
**only in that disposable checkout** to exercise the publisher's source/tag contract. It
never pushes that ref or creates a GitHub Release. The job has only contents-read permission,
no publisher environment, no OIDC write permission and no publish/attachment step.

Fresh dependencies, unchanged full quality/coverage checks and truth checks precede one pack
and full consumer verification of that same tarball. The pinned manifest/artifact digests
are rechecked; current source budgets remain enforced. The workflow retains the exact
`.tgz`/`.manifest.json` and available coverage reports. Downloaded bytes must match the
manifest and runner's digest outputs before treating retention as artifact identity proof.
A synthetic qualification ref is not a public tag or production attestation. Canonical
strict-docs-provider access and external npm Trusted Publisher settings remain separate
pre-publication checks; this lane neither provisions nor claims them.

A hosted proof is an independent runner path, not relief for refused local heavy-job
admission. Preserve local retained state and its owner blocker. Any changed source needs
fresh qualification; a red result is investigated, not blindly retried.

## Tag/version contract

The release tag must exactly match `package.json` as `v<version>`.

```bash
git tag -a v<next-version> -m "test-capabilities v<next-version>"
```

The workflow validates this with:

```bash
RELEASE_TAG=v<next-version> npm run release:intent:check
```

## Create the GitHub Release

After pushing the release commit and tag:

```bash
git push origin main
git push origin v<next-version>
gh release create v<next-version> --title "test-capabilities v<next-version>" --notes-file docs/releases/<release-notes-file>.md
# Add --prerelease when intentionally publishing to npm dist-tag next.
```

Publishing the GitHub Release triggers `.github/workflows/publish.yml`.

## Workflow publication

The prepared release workflow:

1. Checks out the exact release tag with complete history; all workflow actions are pinned
   to official full commit SHAs.
2. Selects `.nvmrc` Node 22 and npm `12.0.2`. Preflight requires measured floors, clean
   source, matching tag/HEAD/GitHub SHA, and an explicit resolvable strict-ancestor
   `COVERAGE_BASE`. Full release changed-line coverage uses `refs/tags/v0.3.0`.
   That tag predates ratchet files: the separate structure-ledger comparison uses
   `STRUCTURE_BASE=30f1a868b6e56e6475fc399e691e9f0d5cdb760f`, the qualified adopted budget state.
   Both references must resolve to strict ancestors; structure's reference must carry its
   budget. Current full-tree limits still apply. No fake adoption entry/floor is added.
   Future releases deliberately update both references, never silently compare to HEAD.
3. Reads the published Release before expensive proof. Draft, unknown/true `immutable`,
   conflicting tag/prerelease flag, or existing target asset filenames fail closed.
4. Checks package intent, then `prepare-release-artifact.mjs prepare --output-dir ...`
   runs `npm run check`, `npm run truth:gate`, and **one** `npm pack --json` into fresh
   external runner scratch. Its unchanged `prepack` produces the map-free distribution.
5. Runs the existing full consumer script with `--tarball <that-file>`: inventory,
   isolated install, declarations, CLI/API and diagnostic assertions are preserved.
   External input is never repacked, rebuilt or deleted. Ordinary `consumer:smoke`
   retains its existing pack/prepack and owned-tarball cleanup behavior.
6. Writes a versioned `.manifest.json` only after proof passes, binding package/version,
   release tag, clean source HEAD, both resolved comparison SHAs, Node/npm, validation commands,
   exact artifact filename, SHA-256 and byte size. Failed preparation preserves scratch.
   Late failure marks its unchanged, writable producer record `failed`, preserving the
   original error. A changed/unwritable record is not overwritten; job failure and pinned
   re-verification remain authoritative, never a leftover `passed` field. Existing input
   tarballs/manifests are refused, not overwritten by a new preparation.
7. Uploads those two explicitly named files as a workflow artifact. Preparation's separate
   workflow outputs pin both artifact and manifest SHA-256; a substituted manifest cannot
   authorize substituted bytes.
8. `verify-release-artifact.mjs publish --manifest ...` rechecks read-only Release state,
   source and pinned bytes immediately before a **single** file-based npm publication.
   `--ignore-scripts` prevents prepack/rebuild; there is no mutation retry loop.
9. Retries only registry **reads** and public install checks while propagation settles.
   These check version visibility and CLI behavior, not registry tarball digest identity.
10. After npm success (even if public verification fails), rechecks the same source/bytes
    and attaches the same tarball and manifest, explicitly named, without `--clobber`.
    Attachment is also one attempt, with no automatic mutation retry.

Package prerelease versions require the GitHub prerelease flag and npm dist-tag `next`;
normal versions require a non-prerelease Release and `latest`. A disagreement stops before
publication. Product CI also uses the pinned toolchain and complete history: PR base SHA,
push before SHA, or an explicit dispatch coverage comparison; scheduled CI uses `v0.3.0`.
Its distinct structure reference remains the adopted budget state above.
Missing, shallow, unresolved, non-ancestor or self-comparisons fail closed.
Build/test distribution and source-map overrides are refused; a supplied package-root selector
must name the same source checkout. Separate ordinary/instrumented/packed proof dimensions
remain intentional, not permission to test a different distribution and publish another.

The coverage collector disables Node compile-cache reuse only in the c8 measurement
launcher environment, inherited by measured descendants. Ordinary CLI caching and explicit
startup cache-on/off contracts remain unchanged. Node documents potentially less precise
V8 coverage for deserialized functions; a tiny probe is not attribution of a full hosted
function-floor failure. A successful collected measurement requires readable summary,
per-function JSON and LCOV reports. CI attempts to archive available reports on all outcomes;
a failure before report generation can leave none, and upload warnings do not change gate
failure. Unchanged floors still determine success. Inspect genuine missing hits if an
isolated measurement remains below its floor; never rerun unchanged failures
until green, manufacture zero-hit coverage, or lower a floor to conceal the difference.

### Canonical strict-docs provider in hosted deep CI

`tryingET/agent-scripts` is the private source owner of `docs-list.mjs`. Hosted deep CI
checks out its complete provider at `d30dabe63500e8f0e2acc4c62f9458e22245fece` under ignored
`.tmp/strict-docs-provider`, then invokes that implementation directly with `--docs . --strict`.
No consumer wrapper or copied provider is introduced, and missing access is a failure, not a skip.

The owner must provision a GitHub App installed on **agent-scripts only**, with repository
contents **read-only**. In test-capabilities configure repository variable
`DOCS_PROVIDER_CLIENT_ID` and Actions secret `DOCS_PROVIDER_PRIVATE_KEY`. The pinned token
action requests only that repository/permission and revokes its short-lived token at job end;
checkout does not persist credentials. No credentials or repository visibility were changed
by source preparation. The wiring is not proof that external setup or hosted deep CI passed.

Packed-consumer negative fuzzer cases explicitly accept their fixture-only scratch receipt
store so hosted workspace durability checks do not mask origin/external-tool refusals.
Production defaults still refuse an unaccepted CI/temporary store. This fixture acceptance is
not deployment authorization or proof of durable production mutation history.

### Immutability and proof limits

A **published** GitHub Release remains the sole public intent. This design attaches assets
later and therefore supports only Releases whose API explicitly reports `immutable: false`.
If release immutability is enabled, stop before npm publication and route a release-process
change to the owner; do not quietly change intent to tag push, workflow dispatch or a draft.
Host policy can change between checks and upload; the preflight is not an atomic guarantee.

These are source-release-readiness preparations, not publication evidence. Fixture tests
prove causal refusal, filenames, digest pins and command delegation, not real npm/OIDC or
GitHub asset identity. No future GitHub asset download/digest proof is claimed. The manifest
is an unsigned CI record, not an independent attestation. Full clean Node 22/package proof,
external Trusted Publisher settings, hosted execution and post-publication channel identity
remain separate evidence dimensions.

If npm succeeds but attachment or public verification fails, npm may already carry the
version. Retain the workflow artifact and logs, reconcile registry/Release state, and obtain
owner direction for recovery; do not rerun the publisher blindly or rebuild a replacement
with the same version. A corrective package release normally needs a new patch version.

## Public verification

After the workflow succeeds, local verification is:

```bash
npm run release:verify-public -- --version <released-version>
# or
npm run release:verify-public -- --package test-capabilities@<released-version> --attempts 8
```

This checks npm package visibility and public CLI installability through `npx -p test-capabilities@<version>`, including the zero-external-dependency `doctor --json` path.
