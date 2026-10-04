import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = process.env.TMPDIR || path.join(root, ".tmp");
mkdirSync(scratch, { recursive: true });
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}
function fixture() {
  const dir = mkdtempSync(path.join(scratch, "release-contract-"));
  const pkg = { name: "test-capabilities", version: "0.4.0" };
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  writeFileSync(path.join(dir, ".nvmrc"), "22\n");
  copyFileSync(path.join(root, "coverage-baseline.json"), path.join(dir, "coverage-baseline.json"));
  copyFileSync(path.join(root, "structure-budget.json"), path.join(dir, "structure-budget.json"));
  run("git", ["init", "-q"], dir);
  run("git", ["add", "."], dir);
  run(
    "git",
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "base",
    ],
    dir,
  );
  const base = run("git", ["rev-parse", "HEAD"], dir);
  writeFileSync(path.join(dir, "source.txt"), "release source\n");
  run("git", ["add", "."], dir);
  run(
    "git",
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "release",
    ],
    dir,
  );
  run("git", ["tag", "v0.4.0"], dir);
  const out = mkdtempSync(path.join(scratch, "release-artifact-"));
  const packageDir = path.join(out, "input", "package");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, "package.json"), JSON.stringify(pkg));
  writeFileSync(path.join(packageDir, "README.md"), `${out}\n`);
  const artifact = path.join(out, "test-capabilities-0.4.0.tgz");
  run("tar", ["-czf", artifact, "-C", path.join(out, "input"), "package"], dir);
  const env = {
    ...process.env,
    COVERAGE_BASE: base,
    STRUCTURE_BASE: base,
    RELEASE_TAG: "v0.4.0",
    GITHUB_RELEASE_ID: "123",
    GITHUB_SHA: run("git", ["rev-parse", "HEAD"], dir),
    GITHUB_OUTPUT: undefined,
    TEST_CAPABILITIES_DIST_ROOT: undefined,
    TEST_CAPABILITIES_BUILD_DIST_DIR: undefined,
    TEST_CAPABILITIES_BUILD_SOURCEMAP: undefined,
    TEST_CAPABILITIES_PACKAGE_ROOT: undefined,
  };
  return { dir, out, artifact, env, base };
}
function preservePackSeed(f) {
  const seed = path.join(f.out, "input", "seed.tgz");
  renameSync(f.artifact, seed);
  return seed;
}
async function modules() {
  return {
    prepare: await import("../scripts/prepare-release-artifact.mjs"),
    verify: await import("../scripts/verify-release-artifact.mjs"),
  };
}
function toolchain(overrides = {}) {
  return { nodeVersion: "22.22.2", npmVersion: "12.0.2", ...overrides };
}

test("Given proven bytes, When a late workflow-output write fails, Then retained manifest cannot advertise a passing preparation", async () => {
  const { prepare, verify } = await modules();
  const f = fixture();
  const seed = preservePackSeed(f);
  assert.throws(
    () =>
      prepare.prepareReleaseArtifact({
        root: f.dir,
        outputDir: f.out,
        env: { ...f.env, GITHUB_OUTPUT: f.out },
        ...toolchain(),
        run: (command, args) => {
          if (command === "npm" && args[0] === "pack") {
            copyFileSync(seed, f.artifact);
            return JSON.stringify([{ filename: path.basename(f.artifact) }]);
          }
          return "";
        },
      }),
    /EISDIR|directory/i,
  );
  const manifestPath = path.join(f.out, "test-capabilities-0.4.0.manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.validation.status, "failed");
  assert.equal(manifest.artifact.sha256, digest(f.artifact), "failed evidence bytes retained");
  assert.throws(
    () => verify.verifyReleaseArtifact({ root: f.dir, manifestPath, env: f.env }),
    /validation|passed/,
  );
});

test("Given pinned npm12 engine requirements, When Node22 is below22.22.2, Then release preflight refuses before proof", async () => {
  const { prepare } = await modules();
  const f = fixture();
  for (const nodeVersion of ["22.14.0", "22.21.99", "22.22.0", "22.22.1"]) {
    assert.throws(
      () => prepare.preflight({ root: f.dir, env: f.env, ...toolchain({ nodeVersion }) }),
      /Node|npm/,
    );
  }
  assert.doesNotThrow(() => prepare.preflight({ root: f.dir, env: f.env, ...toolchain() }));
});

test("Given hosted deep CI without the workstation, When strict docs runs, Then the complete pinned canonical provider uses least-privilege access", () => {
  const ci = yaml.load(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
  const steps = ci.jobs.deep.steps;
  const app = steps.find((step) => step.uses?.startsWith("actions/create-github-app-token@"));
  assert.ok(app, "private canonical provider requires explicitly authorized scoped access");
  assert.equal(app.with.owner, "tryingET");
  assert.equal(app.with.repositories, "agent-scripts");
  assert.equal(app.with["permission-contents"], "read");
  assert.equal(app.with["skip-token-revoke"], false);
  assert.match(app.with["client-id"], /vars\.DOCS_PROVIDER_CLIENT_ID/);
  assert.match(app.with["private-key"], /secrets\.DOCS_PROVIDER_PRIVATE_KEY/);
  const provider = steps.find((step) => step.with?.repository === "tryingET/agent-scripts");
  assert.equal(provider.with.ref, "d30dabe63500e8f0e2acc4c62f9458e22245fece");
  assert.equal(provider.with.path, ".tmp/strict-docs-provider");
  assert.equal(provider.with["persist-credentials"], false);
  assert.match(provider.with.token, /steps\.docs_provider_token\.outputs\.token/);
  const strict = steps.find((step) => step.name === "Run canonical strict docs provider");
  assert.match(
    strict.run,
    /node \.tmp\/strict-docs-provider\/scripts\/docs-list\.mjs --docs \. --strict/,
  );
  assert.doesNotMatch(strict.run, /npm run docs:list|\|\| true|\/home\/|\$HOME/);
  assert.equal(
    steps.filter((step) => step.name === "Run canonical strict docs provider").length,
    1,
  );
});

// Native Given/When/Then contracts: each negative changes the causal input only.
test("Given an authorized artifact-only dispatch, When clean hosted qualification runs, Then exact source and verified bytes are retained without public release effects", () => {
  const ci = yaml.load(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
  assert.ok(ci.on.workflow_dispatch.inputs.lane.options.includes("artifact"));
  const job = ci.jobs.artifact;
  assert.ok(job, "independent exact-artifact qualification must exist");
  assert.equal(
    job.env.COVERAGE_BASE,
    "refs/tags/v0.3.0",
    "full release scope cannot be narrowed by dispatch input",
  );
  assert.match(job.if, /workflow_dispatch.*inputs\.lane\s+={2}\s+'artifact'/);
  assert.deepEqual(ci.permissions, { contents: "read" });
  assert.equal(job.environment, undefined, "not the protected publisher environment");
  assert.equal(job.permissions, undefined, "no elevated publication/OIDC permissions");
  const script = job.steps.map((step) => step.run || "").join("\n");
  assert.doesNotMatch(
    script,
    /git push|npm publish|gh release|verify-release-artifact\.mjs (publish|attach)|continue-on-error/,
  );
  const prepare = job.steps.find((step) => step.id === "prepare");
  assert.match(prepare.run, /prepare-release-artifact\.mjs prepare --output-dir "\$RUNNER_TEMP\//);
  assert.equal(
    job.steps.filter((step) => /prepare-release-artifact\.mjs prepare/.test(step.run || "")).length,
    1,
  );
  const verify = job.steps.find((step) => step.name === "Recheck pinned qualification bytes");
  assert.match(verify.env.RELEASE_MANIFEST_SHA256, /steps\.prepare\.outputs\.manifest_sha256/);
  assert.match(verify.env.RELEASE_ARTIFACT_SHA256, /steps\.prepare\.outputs\.artifact_sha256/);
  assert.match(verify.run, /verify-release-artifact\.mjs verify --manifest/);
  const upload = job.steps.find((step) => step.name === "Retain exact qualification artifact");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.match(upload.with.path, /artifact_path/);
  assert.match(upload.with.path, /manifest_path/);
  assert.doesNotMatch(upload.with.path, /\*/);
  for (const step of job.steps) assert.equal(step["continue-on-error"], undefined);
});

test("Given a qualification-only local version reference, When source or an existing version conflicts, Then no tag is changed and qualification stops", () => {
  const ci = yaml.load(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
  const step = ci.jobs.artifact?.steps.find(
    (item) => item.name === "Bind exact source and qualification-only local version reference",
  );
  assert.ok(step);
  const f = fixture();
  const head = f.env.GITHUB_SHA;
  const output = path.join(f.out, "github-env");
  const invoke = (sha, githubSha = head) =>
    spawnSync("bash", ["-euo", "pipefail", "-c", step.run], {
      cwd: f.dir,
      encoding: "utf8",
      env: { ...f.env, QUALIFICATION_SHA: sha, GITHUB_SHA: githubSha, GITHUB_ENV: output },
    });
  const originalTag = run("git", ["rev-parse", "refs/tags/v0.4.0"], f.dir);
  assert.notEqual(invoke(head).status, 0, "existing version must independently refuse");
  assert.equal(run("git", ["rev-parse", "refs/tags/v0.4.0"], f.dir), originalTag);
  run("git", ["tag", "-d", "v0.4.0"], f.dir); // Newly owned fixture only.
  for (const sha of ["", "not-a-sha", f.base]) {
    assert.notEqual(
      invoke(sha).status,
      0,
      "wrong source must refuse without a masking tag conflict",
    );
    assert.equal(run("git", ["tag", "--list", "v0.4.0"], f.dir), "");
  }
  assert.notEqual(
    invoke(head, f.base).status,
    0,
    "GitHub SHA must independently match checkout HEAD",
  );
  assert.equal(run("git", ["tag", "--list", "v0.4.0"], f.dir), "");
  const ok = invoke(head);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(run("git", ["rev-parse", "refs/tags/v0.4.0"], f.dir), head);
  assert.equal(readFileSync(output, "utf8"), "RELEASE_TAG=v0.4.0\n");
  assert.equal(run("git", ["status", "--porcelain"], f.dir), "");
});

test("Given coverage and adopted-structure histories, When release proof selects bases, Then both are explicit strict ancestors without weakening either ratchet", async () => {
  const { prepare } = await modules();
  const f = fixture();
  const actual = prepare.preflight({ root: f.dir, env: f.env, ...toolchain() });
  assert.equal(actual.structureBase, f.base);
  for (const value of ["", "missing-structure-ref", "HEAD"]) {
    assert.throws(
      () =>
        prepare.preflight({
          root: f.dir,
          env: { ...f.env, STRUCTURE_BASE: value },
          ...toolchain(),
        }),
      /STRUCTURE_BASE|structure|ancestor|comparison/,
    );
  }
  const workflow = yaml.load(
    readFileSync(path.join(root, ".github/workflows/publish.yml"), "utf8"),
  );
  assert.equal(
    workflow.jobs["publish-npm"].env.STRUCTURE_BASE,
    "30f1a868b6e56e6475fc399e691e9f0d5cdb760f",
  );
  assert.equal(workflow.jobs["publish-npm"].env.COVERAGE_BASE, "refs/tags/v0.3.0");
});

test("Given release source, When build/test selection is tainted, Then preflight refuses artifact ambiguity", async () => {
  const { prepare } = await modules();
  const f = fixture();
  for (const key of [
    "TEST_CAPABILITIES_DIST_ROOT",
    "TEST_CAPABILITIES_BUILD_DIST_DIR",
    "TEST_CAPABILITIES_BUILD_SOURCEMAP",
  ]) {
    assert.throws(
      () =>
        prepare.preflight({ root: f.dir, env: { ...f.env, [key]: "alternate" }, ...toolchain() }),
      /override|selection|artifact/i,
    );
  }
  assert.throws(
    () =>
      prepare.preflight({
        root: f.dir,
        env: { ...f.env, TEST_CAPABILITIES_PACKAGE_ROOT: f.out },
        ...toolchain(),
      }),
    /package|checkout/i,
  );
  assert.doesNotThrow(() =>
    prepare.preflight({
      root: f.dir,
      env: { ...f.env, TEST_CAPABILITIES_PACKAGE_ROOT: f.dir },
      ...toolchain(),
    }),
  );
});

test("Given hosted workspace receipts, When fixture intent is explicit, Then durability and origin refusals remain distinct without dispatch", async () => {
  const { importRuntimeModule } = await import("./helpers/runtime-dist.mjs");
  const { createRunContext } = await importRuntimeModule("core/run-context.js");
  const f = fixture();
  const declaration = {
    effect: "mutating",
    scope: "target",
    reason: "bounded consumer fixture only",
  };
  let dispatched = 0;
  for (const ephemeral of [false, true]) {
    const context = createRunContext({
      operationId: "test",
      effect: declaration,
      cwd: f.dir,
      env: {
        ...f.env,
        CI: "true",
        GITHUB_WORKSPACE: f.dir,
        TMPDIR: f.out,
        TMP: undefined,
        TEMP: undefined,
      },
      config: {
        receipts: { dir: path.join(f.dir, "receipts"), ephemeral },
        mutation: { allowOrigins: [] },
      },
    });
    await assert.rejects(
      context.ledger.runStep({
        id: "hosted-consumer.no-dispatch",
        subject: "https://example.com",
        intent: "fixture negative",
        effect: declaration,
        run: async () => {
          dispatched++;
          return "unexpected";
        },
      }),
      { code: ephemeral ? "mutation_origin_not_allowed" : "mutation_receipts_ephemeral" },
    );
  }
  assert.equal(dispatched, 0);
  const consumer = readFileSync(path.join(root, "scripts/consumer_contract_smoke.mjs"), "utf8");
  assert.match(
    consumer,
    /name: "Packed Consumer Bombadil Without An Allowlist",\s+receipts: \{[^}]*ephemeral: true/,
  );
  assert.match(
    consumer,
    /name: "Packed Consumer Bombadil External Requirement",\s+receipts: \{[^}]*ephemeral: true/,
  );
});

test("Given publisher/CI source, When parsed natively, Then measured Node, complete history and explicit comparison are enforced", async () => {
  const publish = yaml.load(readFileSync(path.join(root, ".github/workflows/publish.yml"), "utf8"));
  const ci = yaml.load(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
  assert.deepEqual(publish.on, { release: { types: ["published"] } });
  const job = publish.jobs["publish-npm"];
  assert.equal(job.environment.name, "npm-publish");
  assert.equal(job.permissions["id-token"], "write");
  assert.equal(job.env?.COVERAGE_BASE, "refs/tags/v0.3.0");
  for (const current of [job, ...Object.values(ci.jobs)]) {
    const checkout = current.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    const setup = current.steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
    assert.equal(checkout.with["fetch-depth"], 0);
    assert.equal(setup.with["node-version-file"], ".nvmrc");
    assert.equal(setup.with["registry-url"], undefined);
    const script = current.steps.map((step) => step.run || "").join("\n");
    assert.match(script, /npm@12\.0\.2/);
    assert.match(script, /prepare-release-artifact\.mjs preflight/);
  }
  for (const workflow of [ci, publish]) {
    for (const current of Object.values(workflow.jobs)) {
      for (const step of current.steps.filter((step) => step.uses)) {
        assert.match(
          step.uses,
          /^actions\/(checkout|setup-node|upload-artifact|create-github-app-token)@[a-f0-9]{40}$/,
        );
      }
    }
  }
  const script = job.steps.map((step) => step.run || "").join("\n");
  assert.doesNotMatch(script, /npm@latest|^\s*npm (publish|pack)\b|--clobber/m);
  assert.equal(job.env.NPM_TOKEN, undefined);
  assert.equal(job.env.NODE_AUTH_TOKEN, undefined);
  assert.match(script, /verify-release-artifact\.mjs publish/);
  assert.match(script, /verify-release-artifact\.mjs attach/);
  const upload = job.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.match(upload.with.path, /artifact_path/);
  assert.match(upload.with.path, /manifest_path/);
  assert.doesNotMatch(upload.with.path, /\*/);
  const publishStep = job.steps.find((step) => step.id === "publish_npm");
  assert.match(publishStep.env.RELEASE_MANIFEST_SHA256, /steps\.prepare\.outputs\.manifest_sha256/);
  assert.match(publishStep.env.RELEASE_ARTIFACT_SHA256, /steps\.prepare\.outputs\.artifact_sha256/);
  assert.match(publishStep.env.NPM_DIST_TAG, /prerelease.*next.*latest/);
  const { prepare } = await modules();
  const f = fixture();
  const result = prepare.preflight({ root: f.dir, env: f.env, ...toolchain() });
  assert.equal(result.coverageBase, f.base);
  for (const options of [
    toolchain({ nodeVersion: "24.1.0" }),
    toolchain({ nodeVersion: "22.13.0" }),
    toolchain({ npmVersion: "12.0.3" }),
  ]) {
    assert.throws(() => prepare.preflight({ root: f.dir, env: f.env, ...options }), /Node|npm/);
  }
  for (const ref of ["", "missing-ref", "HEAD"]) {
    assert.throws(
      () =>
        prepare.preflight({ root: f.dir, env: { ...f.env, COVERAGE_BASE: ref }, ...toolchain() }),
      /comparison|COVERAGE_BASE|ancestor/,
    );
  }
  assert.throws(
    () =>
      prepare.preflight({
        root: f.dir,
        env: { ...f.env, GITHUB_SHA: "0".repeat(40) },
        ...toolchain(),
      }),
    /SHA/,
  );
  const baselinePath = path.join(f.dir, "coverage-baseline.json");
  const baseline = JSON.parse(readFileSync(baselinePath));
  delete baseline.measured["22"];
  writeFileSync(baselinePath, JSON.stringify(baseline));
  assert.throws(
    () => prepare.preflight({ root: f.dir, env: f.env, ...toolchain() }),
    /measured|clean/,
  );
  const shallow = mkdtempSync(path.join(scratch, "release-shallow-"));
  run("git", ["clone", "--depth=1", `file://${f.dir}`, shallow], f.dir);
  assert.throws(
    () => prepare.preflight({ root: shallow, env: f.env, ...toolchain() }),
    /history|shallow/,
  );
});

test("Given one packed artifact, When preparing and checking, Then proof binds clean source/version/bytes and rejects tamper, swap and wrong version", async () => {
  const { prepare, verify } = await modules();
  const f = fixture();
  const calls = [];
  const seed = preservePackSeed(f);
  const runner = (command, args) => {
    calls.push([command, args]);
    if (command === "npm" && args[0] === "pack") {
      copyFileSync(seed, f.artifact);
      return JSON.stringify({ "test-capabilities": { filename: path.basename(f.artifact) } });
    }
    return "";
  };
  const result = prepare.prepareReleaseArtifact({
    root: f.dir,
    outputDir: f.out,
    env: f.env,
    run: runner,
    ...toolchain(),
  });
  assert.equal(
    calls.filter(([command, args]) => command === "npm" && args[0] === "pack").length,
    1,
  );
  const consumerCall = calls.find(([, args]) => args[0]?.endsWith("consumer_contract_smoke.mjs"));
  assert.deepEqual(consumerCall[1].slice(1), ["--tarball", f.artifact]);
  assert.equal(result.manifest.source.clean, true);
  assert.equal(result.manifest.package.version, "0.4.0");
  assert.equal(result.manifest.artifact.sha256, digest(f.artifact));
  assert.equal(result.manifest.validation.status, "passed");
  const env = {
    ...f.env,
    RELEASE_MANIFEST_SHA256: digest(result.manifestPath),
    RELEASE_ARTIFACT_SHA256: digest(f.artifact),
  };
  const options = { root: f.dir, manifestPath: result.manifestPath, env };
  assert.equal(verify.verifyReleaseArtifact(options).artifactPath, f.artifact);
  appendFileSync(f.artifact, "tampered");
  assert.throws(() => verify.verifyReleaseArtifact(options), /digest|size/);
  const replacement = fixture();
  copyFileSync(replacement.artifact, f.artifact);
  assert.throws(() => verify.verifyReleaseArtifact(options), /digest|size/);
  copyFileSync(replacement.artifact, path.join(f.out, "wrong-name.tgz"));
  assert.throws(
    () =>
      verify.inspectTarball(path.join(f.out, "wrong-name.tgz"), {
        name: "test-capabilities",
        version: "0.4.0",
      }),
    /filename/,
  );
  assert.throws(
    () =>
      verify.inspectTarball(replacement.artifact, { name: "test-capabilities", version: "0.5.0" }),
    /version|filename/,
  );
  const wrongVersion = fixture();
  writeFileSync(
    path.join(wrongVersion.out, "input", "package", "package.json"),
    JSON.stringify({ name: "test-capabilities", version: "0.5.0" }),
  );
  run(
    "tar",
    ["-czf", wrongVersion.artifact, "-C", path.join(wrongVersion.out, "input"), "package"],
    wrongVersion.dir,
  );
  assert.throws(
    () =>
      verify.inspectTarball(wrongVersion.artifact, { name: "test-capabilities", version: "0.4.0" }),
    /version/,
  );
  assert.throws(
    () =>
      prepare.prepareReleaseArtifact({
        root: replacement.dir,
        outputDir: replacement.out,
        env: replacement.env,
        ...toolchain(),
        run: runner,
      }),
    /stale/,
  );
  const swapped = JSON.parse(readFileSync(result.manifestPath));
  swapped.artifact.sha256 = digest(f.artifact);
  writeFileSync(result.manifestPath, JSON.stringify(swapped));
  assert.throws(() => verify.verifyReleaseArtifact(options), /manifest digest/);
  const failed = fixture();
  preservePackSeed(failed);
  assert.throws(
    () =>
      prepare.prepareReleaseArtifact({
        root: failed.dir,
        outputDir: failed.out,
        env: failed.env,
        ...toolchain(),
        run: () => {
          throw new Error("proof failed");
        },
      }),
    /proof failed/,
  );
  assert.equal(
    spawnSync("test", ["-e", path.join(failed.out, "test-capabilities-0.4.0.manifest.json")])
      .status,
    1,
  );
});

test("Given external tarball input, When the consumer acquires it, Then no pack/rebuild occurs and cleanup preserves caller bytes", async () => {
  const { prepare } = await modules();
  const f = fixture();
  const before = digest(f.artifact);
  let packed = 0;
  const input = prepare.consumerArtifactInput({
    root: f.dir,
    args: ["--tarball", f.artifact],
    pack: () => {
      packed++;
      throw new Error("must not pack");
    },
  });
  assert.equal(packed, 0);
  assert.equal(input.tarballPath, f.artifact);
  assert.ok(input.packedFiles.includes("README.md"));
  prepare.cleanupConsumerArtifact(input);
  assert.equal(digest(f.artifact), before);
  assert.throws(
    () =>
      prepare.consumerArtifactInput({
        root: f.dir,
        args: ["--tarball", f.artifact, "--unexpected"],
        pack: () => {},
      }),
    /usage/i,
  );
  const consumer = readFileSync(path.join(root, "scripts/consumer_contract_smoke.mjs"), "utf8");
  assert.match(consumer, /consumerArtifactInput/);
  assert.match(consumer, /cleanupConsumerArtifact/);
  assert.ok(consumer.split("\n").length <= 757, "brownfield consumer must not grow");
  assert.doesNotMatch(consumer, /unlinkSync/);
});

test("Given verified files and mutable published Release, When publication is delegated, Then exact filenames/digests are reused with scripts disabled and no mutation retry", async () => {
  const { prepare, verify } = await modules();
  const f = fixture();
  const seed = preservePackSeed(f);
  const prepared = prepare.prepareReleaseArtifact({
    root: f.dir,
    outputDir: f.out,
    env: f.env,
    ...toolchain(),
    run: (command, args) => {
      if (command === "npm" && args[0] === "pack") {
        copyFileSync(seed, f.artifact);
        return JSON.stringify([{ filename: path.basename(f.artifact) }]);
      }
      return "";
    },
  });
  const env = {
    ...f.env,
    RELEASE_MANIFEST_SHA256: digest(prepared.manifestPath),
    RELEASE_ARTIFACT_SHA256: digest(f.artifact),
  };
  const release = {
    id: 123,
    tag_name: "v0.4.0",
    draft: false,
    prerelease: false,
    immutable: false,
    assets: [],
  };
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    return command === "gh" && args[0] === "api" ? JSON.stringify(release) : "";
  };
  const options = { root: f.dir, manifestPath: prepared.manifestPath, env, run: runner };
  const published = verify.publishArtifact({ ...options, distTag: "latest" });
  assert.equal(published.artifactSha256, env.RELEASE_ARTIFACT_SHA256);
  assert.deepEqual(calls.at(-1), [
    "npm",
    [
      "publish",
      f.artifact,
      "--ignore-scripts",
      "--provenance",
      "--access",
      "public",
      "--tag",
      "latest",
    ],
  ]);
  const attached = verify.attachArtifact(options);
  assert.equal(attached.artifactSha256, published.artifactSha256);
  assert.equal(attached.manifestSha256, env.RELEASE_MANIFEST_SHA256);
  assert.deepEqual(calls.at(-1), [
    "gh",
    [
      "release",
      "upload",
      "v0.4.0",
      f.artifact,
      prepared.manifestPath,
      "--repo",
      "tryingET/test-capabilities",
    ],
  ]);
  for (const change of [
    { immutable: true },
    { immutable: undefined },
    { prerelease: true },
    { draft: true },
    { tag_name: "v0.3.0" },
    { assets: [{ name: path.basename(f.artifact) }] },
  ]) {
    assert.throws(
      () =>
        verify.assertReleaseHost(
          { ...release, ...change },
          { tag: "v0.4.0", version: "0.4.0", filenames: [path.basename(f.artifact)] },
        ),
      /immutable|prerelease|draft|tag|asset/,
    );
  }
  assert.doesNotThrow(() =>
    verify.assertReleaseHost(
      { ...release, prerelease: true, tag_name: "v0.5.0-rc.1" },
      { tag: "v0.5.0-rc.1", version: "0.5.0-rc.1", filenames: [] },
    ),
  );
  assert.throws(() => verify.publishArtifact({ ...options, distTag: "next" }), /dist-tag/);
  assert.throws(
    () => verify.publishArtifact({ ...options, env: f.env, distTag: "latest" }),
    /digest/,
  );
  let mutations = 0;
  assert.throws(
    () =>
      verify.publishArtifact({
        ...options,
        distTag: "latest",
        run: (command) => {
          if (command === "gh") return JSON.stringify(release);
          mutations++;
          throw new Error("ambiguous publication failure");
        },
      }),
    /ambiguous publication failure/,
  );
  assert.equal(mutations, 1, "a failed npm mutation must never be retried");
  let touched = false;
  assert.throws(
    () =>
      verify.publishArtifact({
        ...options,
        distTag: "latest",
        run: (command, args) => {
          if (command === "gh" && args[0] === "api") {
            appendFileSync(f.artifact, "host-check-time tamper");
            return JSON.stringify(release);
          }
          touched = true;
          return "";
        },
      }),
    /digest|size/,
  );
  assert.equal(
    touched,
    false,
    "bytes must be rechecked after read-only host checks, immediately before mutation",
  );
});
