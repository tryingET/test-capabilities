#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactFilename,
  fileIdentity,
  inspectTarball,
  runCommand,
  sourceIdentity,
  verifyReleaseArtifact,
} from "./verify-release-artifact.mjs";

export function preflight({
  root = process.cwd(),
  env = process.env,
  nodeVersion = process.versions.node,
  npmVersion = runCommand("npm", ["--version"], { cwd: root, env }),
} = {}) {
  const declared = readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
  assert.equal(declared, "22", "publisher must use declared Node 22 lane");
  const [major, minor, patch] = nodeVersion.split(".").map(Number);
  assert.ok(
    major === 22 && Number.isInteger(patch) && (minor > 22 || (minor === 22 && patch >= 2)),
    "Node 22 >=22.22.2 required by qualified npm12.0.2 and measured lane",
  );
  assert.equal(npmVersion, "12.0.2", "npm must use qualified 12.0.2 pin, not latest");
  for (const key of [
    "TEST_CAPABILITIES_DIST_ROOT",
    "TEST_CAPABILITIES_BUILD_DIST_DIR",
    "TEST_CAPABILITIES_BUILD_SOURCEMAP",
  ]) {
    assert.ok(!env[key], `release artifact selection override forbidden: ${key}`);
  }
  if (env.TEST_CAPABILITIES_PACKAGE_ROOT) {
    assert.equal(
      path.resolve(env.TEST_CAPABILITIES_PACKAGE_ROOT),
      path.resolve(root),
      "package root must name the release source checkout",
    );
  }
  const baseline = JSON.parse(readFileSync(path.join(root, "coverage-baseline.json"), "utf8"));
  assert.ok(baseline.measured?.[declared], "declared Node must have measured coverage floors");
  for (const metric of ["lines", "branches", "functions"]) {
    assert.ok(
      Number.isFinite(baseline.floors?.[declared]?.[metric]),
      `Node coverage floor missing: ${metric}`,
    );
  }
  return { ...sourceIdentity(root, env), node: nodeVersion, npm: npmVersion };
}

function packEntry(output) {
  const parsed = typeof output === "string" ? JSON.parse(output) : output;
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
  assert.equal(entries.length, 1, "npm pack must return exactly one artifact");
  assert.equal(typeof entries[0]?.filename, "string", "npm pack did not return a tarball filename");
  return entries[0];
}

// The default consumer path retains npm pack/prepack. External input never packs or owns cleanup.
export function consumerArtifactInput({ root = process.cwd(), args = [], pack }) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const expected = artifactFilename(pkg);
  if (args.length) {
    assert.ok(
      args.length === 2 && args[0] === "--tarball" && args[1],
      "usage: consumer_contract_smoke.mjs [--tarball FILE]",
    );
    const tarballPath = path.resolve(args[1]);
    return { tarballPath, packedFiles: inspectTarball(tarballPath, pkg), owned: false };
  }
  const entry = packEntry(pack());
  assert.equal(entry.filename, expected, "npm pack artifact filename mismatch");
  const tarballPath = path.join(root, entry.filename);
  assert.ok(existsSync(tarballPath), `tarball missing: ${tarballPath}`);
  return {
    tarballPath,
    packedFiles: Array.isArray(entry.files)
      ? entry.files.map((file) => file?.path).filter((file) => typeof file === "string")
      : [],
    owned: true,
  };
}

export function cleanupConsumerArtifact(input) {
  if (input?.owned && existsSync(input.tarballPath)) unlinkSync(input.tarballPath);
}

export function prepareReleaseArtifact({
  root = process.cwd(),
  outputDir,
  env = process.env,
  run = runCommand,
  ...toolchain
}) {
  const before = preflight({ root, env, ...toolchain });
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(env.RELEASE_TAG, `v${pkg.version}`, "release tag/version required for preparation");
  assert.ok(outputDir, "output directory required");
  outputDir = path.resolve(outputDir);
  assert.ok(
    !outputDir.startsWith(`${path.resolve(root)}${path.sep}`) && outputDir !== path.resolve(root),
    "release output must be outside the source checkout",
  );
  mkdirSync(outputDir, { recursive: true });
  assert.ok(
    !readdirSync(outputDir).some((file) => /\.(tgz|manifest\.json)$/.test(file)),
    "stale release output refused; use a fresh output directory, never overwrite evidence",
  );
  const manifestPath = path.join(
    outputDir,
    artifactFilename(pkg).replace(/\.tgz$/, ".manifest.json"),
  );
  const options = {
    cwd: root,
    env: { ...env, COVERAGE_BASE: before.coverageBase, STRUCTURE_BASE: before.structureBase },
    capture: false,
  };
  run("npm", ["run", "check"], options);
  run("npm", ["run", "truth:gate"], options);
  const entry = packEntry(
    run("npm", ["pack", "--json", "--pack-destination", outputDir], { ...options, capture: true }),
  );
  assert.equal(entry.filename, artifactFilename(pkg), "npm pack filename/version mismatch");
  const artifactPath = path.join(outputDir, entry.filename);
  inspectTarball(artifactPath, pkg);
  const identity = fileIdentity(artifactPath);
  run(
    process.execPath,
    [path.join(root, "scripts", "consumer_contract_smoke.mjs"), "--tarball", artifactPath],
    options,
  );
  assert.deepEqual(
    fileIdentity(artifactPath),
    identity,
    "consumer verification must not alter artifact bytes",
  );
  assert.deepEqual(
    sourceIdentity(root, env),
    {
      head: before.head,
      clean: before.clean,
      coverageBase: before.coverageBase,
      structureBase: before.structureBase,
      tag: before.tag,
    },
    "source changed during release validation",
  );
  const manifest = {
    schemaVersion: 1,
    package: { name: pkg.name, version: pkg.version },
    source: {
      head: before.head,
      clean: true,
      coverageBase: before.coverageBase,
      structureBase: before.structureBase,
      tag: before.tag,
    },
    artifact: { filename: entry.filename, ...identity },
    validation: {
      status: "passed",
      node: before.node,
      npm: before.npm,
      commands: [
        "npm run check",
        "npm run truth:gate",
        "npm pack (prepack enabled)",
        "consumer_contract_smoke.mjs --tarball",
      ],
    },
  };
  const written = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, written, { flag: "wx" });
  try {
    const verified = verifyReleaseArtifact({ root, manifestPath, env });
    if (env.GITHUB_OUTPUT) {
      const outputs = {
        artifact_path: artifactPath,
        manifest_path: manifestPath,
        artifact_sha256: verified.artifactSha256,
        manifest_sha256: verified.manifestSha256,
      };
      for (const [key, value] of Object.entries(outputs)) {
        assert.ok(!/[\r\n]/.test(value), "unsafe workflow output");
        appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
      }
    }
    return { ...verified, manifest };
  } catch (error) {
    // Preserve failed evidence, but never leave our unchanged producer record advertising pass.
    try {
      if (readFileSync(manifestPath, "utf8") === written) {
        manifest.validation.status = "failed";
        manifest.validation.failure = error instanceof Error ? error.message : String(error);
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      }
    } catch (recordError) {
      console.error(`Failed recording preparation failure: ${String(recordError)}`);
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "preflight" && args.length === 0) {
    console.log(JSON.stringify(preflight()));
  } else {
    assert.ok(
      command === "prepare" && args.length === 2 && args[0] === "--output-dir",
      "usage: prepare-release-artifact.mjs preflight | prepare --output-dir DIRECTORY",
    );
    const result = prepareReleaseArtifact({ outputDir: args[1] });
    console.log(
      JSON.stringify({
        artifact: result.artifactPath,
        artifactSha256: result.artifactSha256,
        manifest: result.manifestPath,
        manifestSha256: result.manifestSha256,
      }),
    );
  }
}
