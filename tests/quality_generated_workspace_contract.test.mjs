import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

function writeFixture(root, files) {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content, "utf8");
  }
}

// The repo owns source scanning; SCI snapshots and isolated build/evidence state
// have different owners. Exercise the real policies with malformed generated
// bytes, then prove both tracked and fresh source still produce diagnostics.
test("generated workspace state is VCS-ignored without hiding fresh source", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tc-generated-vcs-"));
  try {
    git(root, ["init", "-q"]);
    writeFixture(root, {
      ".gitignore": readFileSync(path.join(repoRoot, ".gitignore"), "utf8"),
      ".ontology/snapshots/metadata.json": '{"generated":true}',
      ".tmp/build/dist/fresh.ts": "export const broken=;",
      "src/fresh.ts": "export const broken=;",
      "ontology/source.json": '{"source":true}',
      "tests/fresh.test.mjs": "const broken=;",
      "docs/fresh.md": "# Fresh source\n",
      "src/.ontology/fresh.ts": "export const broken=;",
      "tests/.tmp/fresh.test.mjs": "const broken=;",
    });
    const paths = git(root, ["ls-files", "--others", "--exclude-standard"]);
    assert.doesNotMatch(paths, /^\.ontology\/|^\.tmp\//m);
    for (const file of [
      "src/fresh.ts",
      "ontology/source.json",
      "tests/fresh.test.mjs",
      "docs/fresh.md",
      "src/.ontology/fresh.ts",
      "tests/.tmp/fresh.test.mjs",
    ])
      assert.ok(paths.includes(file), `${file} remains visible to git`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated workspace bytes are excluded by Biome but real source still fails", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tc-generated-biome-"));
  const biome = path.join(repoRoot, "node_modules/.bin/biome");
  const generated = {
    ".ontology/snapshots/.base-index.json": '{"generated":true}',
    ".ontology/snapshots/id/metadata.json": '{"snapshot":true}',
    ".tmp/evidence/probe.mjs": "const broken=;",
  };
  const run = (vcsEnabled) =>
    spawnSync(biome, ["check", ".", `--vcs-enabled=${vcsEnabled}`], {
      cwd: root,
      encoding: "utf8",
    });
  try {
    git(root, ["init", "-q"]);
    writeFixture(root, {
      "biome.jsonc": readFileSync(path.join(repoRoot, "biome.jsonc"), "utf8"),
      ".gitignore": readFileSync(path.join(repoRoot, ".gitignore"), "utf8"),
      "src/tracked.ts": "export const tracked = 1;\n",
      ...generated,
    });
    git(root, ["add", "src/tracked.ts"]);
    for (const vcsEnabled of [true, false]) {
      const green = run(vcsEnabled);
      assert.equal(green.status, 0, `${green.stdout}\n${green.stderr}`);
    }
    writeFixture(root, {
      "src/tracked.ts": "export const broken=;",
      "src/fresh.ts": "export const broken=;",
      "tests/fresh.test.mjs": "const broken=;",
      "policy/fresh.json": '{"broken":}',
      "src/.ontology/fresh.ts": "export const broken=;",
      "tests/.tmp/fresh.test.mjs": "const broken=;",
    });
    for (const vcsEnabled of [true, false]) {
      const red = run(vcsEnabled);
      assert.notEqual(red.status, 0);
      const diagnostics = `${red.stdout}\n${red.stderr}`;
      for (const file of [
        "src/tracked.ts",
        "src/fresh.ts",
        "tests/fresh.test.mjs",
        "policy/fresh.json",
        "src/.ontology/fresh.ts",
        "tests/.tmp/fresh.test.mjs",
      ])
        assert.ok(diagnostics.includes(file), `${file} remains checked: ${diagnostics}`);
      assert.doesNotMatch(diagnostics, /\.ontology\/snapshots|\.tmp\/evidence/);
    }
    for (const [file, bytes] of Object.entries(generated)) {
      assert.equal(readFileSync(path.join(root, file), "utf8"), bytes, file);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
