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

The workflow uses GitHub-hosted runners, the GitHub Actions environment `npm-publish`, `id-token: write`, Node `24`, npm `>=11.5.1`, and `npm publish --provenance --access public`. It must not require `NPM_TOKEN` or `NODE_AUTH_TOKEN`.

## Local preparation

Before tagging a release, run:

```bash
npm run release:intent:check
npm run release:check
npm run docs:list -- --docs . --strict
```

For public-only environments without the workspace docs helper, the required package proof remains:

```bash
npm run release:intent:check
npm run release:check
```

If package contents, metadata, README, LICENSE, built output, or generated capability surfaces change after this proof, rerun the proof before creating the release.

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
```

Publishing the GitHub Release triggers `.github/workflows/publish.yml`.

## Workflow publication

The release workflow:

1. checks out the exact release tag
2. installs Node `24` and a current npm CLI with Trusted Publishing support
3. verifies local Trusted Publishing runtime prerequisites
4. validates tag/version/package intent with `npm run release:intent:check`
5. runs `npm run verify:ci --silent` (`release:check`)
6. creates the proven npm tarball with `npm pack --json`
7. uploads the tarball as a workflow artifact
8. publishes from the repo root through Trusted Publishing/OIDC
9. waits for npm registry visibility and runs public `npx` checks for `test-capabilities --help`, `test-capabilities doctor --json`, and `tc --help`
10. attaches the proven tarball to the GitHub Release once npm publish succeeds

Prerelease GitHub Releases publish to npm dist-tag `next`; normal releases publish to `latest`.

## Public verification

After the workflow succeeds, local verification is:

```bash
npm run release:verify-public -- --version <released-version>
```

This checks npm package visibility and public CLI installability through `npx -p test-capabilities@<version>`, including the zero-external-dependency `doctor --json` path.
