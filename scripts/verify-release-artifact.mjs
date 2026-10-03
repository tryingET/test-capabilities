#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function runCommand(
  command,
  args,
  { cwd = process.cwd(), env = process.env, capture = true } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed: ${result.error?.message || ""}\n${result.stdout || ""}\n${result.stderr || ""}`,
  );
  return result.stdout?.trim() || "";
}

export function fileIdentity(filename) {
  const stat = lstatSync(filename);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink(),
    "artifact/manifest must be a regular file, not a symlink",
  );
  return {
    sha256: createHash("sha256").update(readFileSync(filename)).digest("hex"),
    size: stat.size,
  };
}

export function artifactFilename(pkg) {
  assert.equal(pkg.name, "test-capabilities", "unexpected package name");
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "unsafe package version");
  return `${pkg.name}-${pkg.version}.tgz`;
}

export function inspectTarball(filename, expected) {
  assert.equal(
    path.basename(filename),
    artifactFilename(expected),
    "artifact filename must match package/version",
  );
  fileIdentity(filename);
  const entries = runCommand("tar", ["-tzf", filename]).split("\n").filter(Boolean);
  assert.ok(entries.includes("package/package.json"), "artifact missing package.json");
  for (const entry of entries) {
    assert.ok(
      entry.startsWith("package/") && !entry.split("/").includes(".."),
      "unsafe artifact inventory",
    );
  }
  const pkg = JSON.parse(runCommand("tar", ["-xOzf", filename, "package/package.json"]));
  assert.equal(pkg.name, expected.name, "artifact package name mismatch");
  assert.equal(pkg.version, expected.version, "artifact package version mismatch");
  return entries
    .filter((entry) => !entry.endsWith("/"))
    .map((entry) => entry.slice("package/".length));
}

export function sourceIdentity(root, env = process.env) {
  const git = (args) => runCommand("git", args, { cwd: root });
  assert.equal(
    git(["rev-parse", "--is-shallow-repository"]),
    "false",
    "complete Git history required; shallow checkout refused",
  );
  assert.equal(
    git(["status", "--porcelain", "--untracked-files=all"]),
    "",
    "release source must be clean",
  );
  const head = git(["rev-parse", "HEAD"]);
  const comparison = env.COVERAGE_BASE;
  assert.ok(
    comparison && !comparison.startsWith("-"),
    "explicit COVERAGE_BASE comparison required",
  );
  let coverageBase;
  try {
    coverageBase = git(["rev-parse", "--verify", `${comparison}^{commit}`]);
  } catch (error) {
    throw new Error(`COVERAGE_BASE comparison is not resolvable: ${comparison}`, { cause: error });
  }
  assert.notEqual(coverageBase, head, "comparison must be a distinct ancestor, not HEAD");
  git(["merge-base", "--is-ancestor", coverageBase, head]);
  const structure = env.STRUCTURE_BASE;
  assert.ok(structure && !structure.startsWith("-"), "explicit STRUCTURE_BASE required");
  const structureBase = git(["rev-parse", "--verify", `${structure}^{commit}`]);
  assert.notEqual(structureBase, head, "structure comparison must be a distinct ancestor");
  git(["merge-base", "--is-ancestor", structureBase, head]);
  const adopted = JSON.parse(git(["show", `${structureBase}:structure-budget.json`]));
  assert.ok(
    Number.isFinite(adopted.default_max_lines),
    "STRUCTURE_BASE must carry the adopted budget",
  );
  if (env.RELEASE_TAG) {
    assert.match(env.RELEASE_TAG, /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "unsafe release tag");
    assert.equal(
      git(["rev-parse", "--verify", `refs/tags/${env.RELEASE_TAG}^{commit}`]),
      head,
      "release tag must resolve to checkout HEAD",
    );
  }
  if (env.GITHUB_SHA) assert.equal(env.GITHUB_SHA, head, "GitHub source SHA must match HEAD");
  return { head, clean: true, coverageBase, structureBase, tag: env.RELEASE_TAG || null };
}

export function verifyReleaseArtifact({
  root = process.cwd(),
  manifestPath,
  env = process.env,
  requirePins = false,
}) {
  assert.ok(manifestPath, "manifest path required");
  manifestPath = path.resolve(manifestPath);
  const manifestIdentity = fileIdentity(manifestPath);
  if (requirePins) {
    assert.match(
      env.RELEASE_MANIFEST_SHA256 || "",
      /^[a-f0-9]{64}$/,
      "trusted manifest digest required before mutation",
    );
    assert.match(
      env.RELEASE_ARTIFACT_SHA256 || "",
      /^[a-f0-9]{64}$/,
      "trusted artifact digest required before mutation",
    );
  }
  if (env.RELEASE_MANIFEST_SHA256)
    assert.equal(manifestIdentity.sha256, env.RELEASE_MANIFEST_SHA256, "manifest digest mismatch");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const filename = artifactFilename(pkg);
  assert.equal(
    path.basename(manifestPath),
    filename.replace(/\.tgz$/, ".manifest.json"),
    "manifest filename mismatch",
  );
  assert.equal(manifest.schemaVersion, 1, "unsupported manifest schema");
  assert.deepEqual(manifest.package, { name: pkg.name, version: pkg.version });
  assert.deepEqual(
    manifest.source,
    sourceIdentity(root, env),
    "manifest source/head/clean-state mismatch",
  );
  assert.equal(manifest.source.tag, `v${pkg.version}`, "manifest release tag/version mismatch");
  assert.equal(manifest.artifact.filename, filename, "manifest artifact filename mismatch");
  assert.equal(manifest.validation.status, "passed", "release validation must have passed");
  assert.deepEqual(
    manifest.validation.commands,
    [
      "npm run check",
      "npm run truth:gate",
      "npm pack (prepack enabled)",
      "consumer_contract_smoke.mjs --tarball",
    ],
    "incomplete release validation record",
  );
  assert.match(manifest.validation.node, /^22\./, "validation Node must use measured Node 22 lane");
  assert.equal(manifest.validation.npm, "12.0.2", "validation npm must use qualified pin");
  const artifactPath = path.join(path.dirname(manifestPath), filename);
  assert.equal(
    realpathSync(path.dirname(artifactPath)),
    path.dirname(artifactPath),
    "artifact directory must not be a symlink",
  );
  const identity = fileIdentity(artifactPath);
  assert.equal(identity.size, manifest.artifact.size, "artifact size mismatch");
  assert.equal(identity.sha256, manifest.artifact.sha256, "artifact digest mismatch");
  if (env.RELEASE_ARTIFACT_SHA256)
    assert.equal(identity.sha256, env.RELEASE_ARTIFACT_SHA256, "trusted artifact digest mismatch");
  inspectTarball(artifactPath, pkg);
  assert.deepEqual(
    fileIdentity(manifestPath),
    manifestIdentity,
    "manifest digest changed during verification",
  );
  assert.deepEqual(
    fileIdentity(artifactPath),
    identity,
    "artifact digest/size changed during verification",
  );
  return {
    manifest,
    manifestPath,
    artifactPath,
    artifactSha256: identity.sha256,
    manifestSha256: manifestIdentity.sha256,
  };
}

export function assertReleaseHost(release, { tag, version, filenames }) {
  assert.equal(release.tag_name, tag, "GitHub Release tag mismatch");
  assert.equal(release.draft, false, "GitHub Release must be published, not draft");
  assert.equal(
    release.immutable,
    false,
    "immutable or unknown GitHub Release cannot accept post-publication assets; stop before npm mutation",
  );
  assert.equal(
    release.prerelease,
    version.includes("-"),
    "GitHub prerelease flag must match package version",
  );
  assert.ok(Array.isArray(release.assets), "GitHub Release assets inventory required");
  assert.ok(
    !release.assets.some((asset) => filenames.includes(asset.name)),
    "GitHub Release asset already exists; never overwrite it",
  );
}

export function guardReleaseHost({ root = process.cwd(), env = process.env, run = runCommand }) {
  assert.match(env.GITHUB_RELEASE_ID || "", /^[1-9]\d*$/, "GitHub Release id required");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(env.RELEASE_TAG, `v${pkg.version}`, "Release intent tag/version mismatch");
  const filename = artifactFilename(pkg);
  const release = JSON.parse(
    run("gh", ["api", `repos/tryingET/test-capabilities/releases/${env.GITHUB_RELEASE_ID}`], {
      cwd: root,
      env,
    }),
  );
  assert.equal(String(release.id), env.GITHUB_RELEASE_ID, "GitHub Release id mismatch");
  assertReleaseHost(release, {
    tag: env.RELEASE_TAG,
    version: pkg.version,
    filenames: [filename, filename.replace(/\.tgz$/, ".manifest.json")],
  });
}

export function publishArtifact(options) {
  const { root = process.cwd(), env = process.env, run = runCommand } = options;
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(
    options.distTag,
    pkg.version.includes("-") ? "next" : "latest",
    "npm dist-tag must match prerelease policy",
  );
  guardReleaseHost({ root, env, run });
  // No network checks, packing, prepack or mutation retry between this byte check and publish.
  const verified = verifyReleaseArtifact({ ...options, requirePins: true });
  run(
    "npm",
    [
      "publish",
      verified.artifactPath,
      "--ignore-scripts",
      "--provenance",
      "--access",
      "public",
      "--tag",
      options.distTag,
    ],
    { cwd: root, env, capture: false },
  );
  return verified;
}

export function attachArtifact(options) {
  const { root = process.cwd(), env = process.env, run = runCommand } = options;
  guardReleaseHost({ root, env, run });
  const verified = verifyReleaseArtifact({ ...options, requirePins: true });
  run(
    "gh",
    [
      "release",
      "upload",
      env.RELEASE_TAG,
      verified.artifactPath,
      verified.manifestPath,
      "--repo",
      "tryingET/test-capabilities",
    ],
    { cwd: root, env, capture: false },
  );
  return verified;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "host-check" && args.length === 0) {
    guardReleaseHost({});
  } else {
    assert.ok(
      ["verify", "publish", "attach"].includes(command) &&
        args.length === 2 &&
        args[0] === "--manifest",
      "usage: verify-release-artifact.mjs host-check | verify|publish|attach --manifest FILE",
    );
    const options = { manifestPath: args[1], distTag: process.env.NPM_DIST_TAG };
    const verified =
      command === "publish"
        ? publishArtifact(options)
        : command === "attach"
          ? attachArtifact(options)
          : verifyReleaseArtifact(options);
    console.log(
      JSON.stringify({
        artifact: verified.artifactPath,
        artifactSha256: verified.artifactSha256,
        manifest: verified.manifestPath,
        manifestSha256: verified.manifestSha256,
      }),
    );
  }
}
