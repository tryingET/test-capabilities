---
summary: "Checklist for releasing test-capabilities through GitHub Release and npm Trusted Publishing/OIDC."
read_when:
  - "When preparing the first public npm release for test-capabilities"
  - "When deciding whether the current package layout is publish-ready"
type: "how-to"
---

# npm release checklist

GitHub Release is the single release intent for `test-capabilities`. Local sessions prepare proof and release notes; npm publication happens automatically in `.github/workflows/publish.yml` through npm Trusted Publishing/OIDC after a GitHub Release is published.

## 1) Confirm package metadata

Before publish, verify:

- `package.json` has no `private: true`
- `license` is `SEE LICENSE IN LICENSE`
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
- `README.md`
- `LICENSE` (included automatically by npm)
- `test-capabilities.yaml`
- publish-ready `package.json`

The package must not ship repo-only runtime fixtures, internal docs, prompts, tests, generated source maps, or vendored external binaries unless a future release decision changes the package boundary.

Use:

```bash
npm run consumer:smoke
```

## 3) Verify repo truth before release

Run:

```bash
npm run release:check
npm run docs:list -- --docs . --strict
```

For public-only environments without the workspace docs helper, `npm run release:check` remains the required deterministic package gate.

## 4) Confirm public docs posture

Before publishing, re-check:

- README leads with shipped fail-closed behavior, not future autonomy claims
- `docs/api/` describes implemented runtime surfaces and fail-closed unsupported modes
- `docs/project/vision.md` is clearly north-star/roadmap, not current support
- local maintainer or workspace-specific paths are not required for public users
- release notes disclose external runtime requirements for Bombadil-compatible and Surf Go-compatible integrations

## 5) Configure npm Trusted Publishing

On npmjs.com, configure Trusted Publishing for:

- package: `test-capabilities`
- GitHub owner / organization: `tryingET`
- repository: `test-capabilities`
- workflow filename: `publish.yml`
- environment name: `npm-publish`

Do not add an npm token to the repository for normal releases.

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
