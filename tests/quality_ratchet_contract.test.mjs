import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as structure from "../scripts/quality/check-structure.mjs";
import * as ratchet from "../scripts/quality/coverage-ratchet.mjs";

// Quality ratchet, part 1 (P4 as amended; adjudication claims 13, 42). The
// pure evaluators are exercised directly; the structure CLI is driven against
// a temp git repo fixture; the real tree is checked once as a smoke test.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const structureCli = path.join(repoRoot, "scripts", "quality", "check-structure.mjs");

function fixtureFiles(entries) {
  return new Map(Object.entries(entries));
}

function baseBudget(overrides = {}) {
  return {
    schema_version: 1,
    default_max_lines: 700,
    exceptions: {},
    allowed_cycles: [],
    pure_ring: [],
    ledger: [],
    ...overrides,
  };
}

const healthy = {
  "src/index.ts": 'import "./a.js";\nimport { b } from "./b.js";\nexport { b };\n',
  "src/a.ts": "export const a = 1;\n",
  "src/b.ts": "export const b = 2;\n",
};

// ---------------------------------------------------------------------------
// check-structure: pure parts
// ---------------------------------------------------------------------------

test("import extraction separates runtime edges from type-only ones and ignores prose", () => {
  const source = [
    'import { a } from "./a.js";',
    'import type { T } from "./types.js";',
    'import { type U, type V } from "./only-types.js";',
    'import { type W, w } from "./mixed.js";',
    'export type { X } from "./x-types.js";',
    'export { y } from "./y.js";',
    'import "./side-effect.js";',
    'const fs = await import("node:fs/promises");',
    'type R = import("./r-types.js").R;',
    '// import { ghost } from "./ghost.js";',
    '/* import { ghost2 } from "./ghost2.js"; */',
    'const doc = `import { ghost3 } from "./ghost3.js"`;',
  ].join("\n");
  const { runtime, typeOnly } = structure.extractImportSpecifiers(source);
  assert.deepEqual(runtime.sort(), [
    "./a.js",
    "./mixed.js",
    "./side-effect.js",
    "./y.js",
    "node:fs/promises",
  ]);
  assert.deepEqual(typeOnly.sort(), [
    "./only-types.js",
    "./r-types.js",
    "./types.js",
    "./x-types.js",
  ]);
});

test("type-only detection exempts the real operations/types.ts and nothing with a runtime binding", () => {
  const typesSource = readFileSync(path.join(repoRoot, "src/core/operations/types.ts"), "utf8");
  assert.equal(structure.isTypeOnlyModule(typesSource), true);
  const supportSource = readFileSync(path.join(repoRoot, "src/core/operations/support.ts"), "utf8");
  assert.equal(structure.isTypeOnlyModule(supportSource), false);
  assert.equal(
    structure.isTypeOnlyModule("export interface A { x: number }\nexport type B = A;\n"),
    true,
  );
  assert.equal(structure.isTypeOnlyModule("export const x = 1;\n"), false);
  assert.equal(structure.isTypeOnlyModule('export type { A } from "./a.js";\n'), true);
  assert.equal(structure.isTypeOnlyModule('export { a } from "./a.js";\n'), false);
});

test("cycle detection reports the elementary cycle and nothing on a DAG", () => {
  const cyclic = new Map([
    ["src/a.ts", ["src/b.ts"]],
    ["src/b.ts", ["src/a.ts"]],
  ]);
  assert.deepEqual(structure.findCycles(cyclic), [["src/a.ts", "src/b.ts", "src/a.ts"]]);
  const dag = new Map([
    ["src/a.ts", ["src/b.ts"]],
    ["src/b.ts", ["src/c.ts"]],
    ["src/c.ts", []],
  ]);
  assert.deepEqual(structure.findCycles(dag), []);
});

test("a healthy fixture passes every structure rule", () => {
  const result = structure.evaluateStructure({
    files: fixtureFiles(healthy),
    budget: baseBudget(),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.facts.cycles.length, 0);
});

test("a new runtime cycle fails with the cycle named", () => {
  const files = fixtureFiles({
    ...healthy,
    "src/a.ts": 'import { b } from "./b.js";\nexport const a = b;\n',
    "src/b.ts": 'import { a } from "./a.js";\nexport const b = 2;\nexport const c = () => a;\n',
  });
  const result = structure.evaluateStructure({
    files,
    budget: baseBudget(),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(result.failures, [
    "runtime import cycle: src/a.ts -> src/b.ts -> src/a.ts (break it, or list it in allowed_cycles with a ledger entry)",
  ]);
  const allowed = structure.evaluateStructure({
    files,
    budget: baseBudget({ allowed_cycles: ["src/a.ts -> src/b.ts -> src/a.ts"] }),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(allowed.failures, []);
});

test("a type-only import never forms a runtime cycle", () => {
  const files = fixtureFiles({
    ...healthy,
    "src/a.ts": 'import type { B } from "./b.js";\nexport const a: B | undefined = undefined;\n',
    "src/b.ts": 'import { a } from "./a.js";\nexport type B = number;\nexport const b = a;\n',
  });
  const result = structure.evaluateStructure({
    files,
    budget: baseBudget(),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(result.failures, []);
});

test("a never-imported runtime module fails; a type-only orphan is exempt", () => {
  const files = fixtureFiles({
    ...healthy,
    "src/orphan.ts": "export const o = 1;\n",
    "src/shapes.ts": "export interface Shape { id: string }\n",
  });
  const result = structure.evaluateStructure({
    files,
    budget: baseBudget(),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(result.failures, [
    "module never imported: src/orphan.ts is not reachable from src/index.ts (import it from a live path or delete it; there is no exception list)",
  ]);
  assert.deepEqual(result.facts.unreachableTypeOnly, ["src/shapes.ts"]);
});

test("a module reachable only through a type-only import is still imported", () => {
  const files = fixtureFiles({
    "src/index.ts":
      'import type { Shape } from "./shapes.js";\nexport const x: Shape | undefined = undefined;\n',
    "src/shapes.ts":
      'export interface Shape { id: string }\nexport const DEFAULT_SHAPE = { id: "a" };\n',
  });
  const result = structure.evaluateStructure({
    files,
    budget: baseBudget(),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(result.failures, []);
});

test("the ring rule fails a pure module that reaches node:fs directly or through an import", () => {
  const direct = fixtureFiles({
    ...healthy,
    "src/a.ts": 'import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n',
  });
  const directResult = structure.evaluateStructure({
    files: direct,
    budget: baseBudget({ pure_ring: ["src/a.ts"] }),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(directResult.failures, [
    "ring rule: src/a.ts reaches node:fs via src/a.ts (the pure ring imports neither node:fs nor node:child_process)",
  ]);

  const transitive = fixtureFiles({
    ...healthy,
    "src/a.ts": 'import { b } from "./b.js";\nexport const a = b;\n',
    "src/b.ts": 'const cp = await import("node:child_process");\nexport const b = cp;\n',
  });
  const transitiveResult = structure.evaluateStructure({
    files: transitive,
    budget: baseBudget({ pure_ring: ["src/a.ts"] }),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(transitiveResult.failures, [
    "ring rule: src/a.ts reaches node:child_process via src/a.ts -> src/b.ts (the pure ring imports neither node:fs nor node:child_process)",
  ]);

  const missing = structure.evaluateStructure({
    files: fixtureFiles(healthy),
    budget: baseBudget({ pure_ring: ["src/nope.ts"] }),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(missing.failures, [
    "pure_ring names src/nope.ts but the file does not exist; fix the list",
  ]);
});

test("size budget: over budget fails, an exact exception passes, a slack exception fails", () => {
  const sixLines = "export const a = 1;\n// 2\n// 3\n// 4\n// 5\n// 6\n";
  const files = fixtureFiles({ ...healthy, "src/a.ts": sixLines });
  const over = structure.evaluateStructure({
    files,
    budget: baseBudget({ default_max_lines: 5 }),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(over.failures, [
    "src/a.ts has 6 lines; budget is 5 (split the file, or add an exception with a ledger entry)",
  ]);
  const exact = structure.evaluateStructure({
    files,
    budget: baseBudget({ default_max_lines: 5, exceptions: { "src/a.ts": 6 } }),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(exact.failures, []);
  const slack = structure.evaluateStructure({
    files,
    budget: baseBudget({ default_max_lines: 5, exceptions: { "src/a.ts": 9 } }),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(slack.failures, [
    "src/a.ts has 6 lines but its exception is 9; lower the exception to 6 (no ledger entry needed)",
  ]);
  const grown = structure.evaluateStructure({
    files,
    budget: baseBudget({ default_max_lines: 5, exceptions: { "src/a.ts": 5 } }),
    roots: ["src/index.ts"],
  });
  assert.deepEqual(grown.failures, [
    "src/a.ts has 6 lines; exception is 5 (raise the exception to 6 with a ledger entry, or shrink the file)",
  ]);
});

test("structure ledger: grown or added exceptions and new allowed cycles need an entry with reason and ref", () => {
  const resolved = () => "resolved";
  const grown = structure.evaluateBudgetLedger({
    base: baseBudget({ exceptions: { "src/a.ts": 10 } }),
    current: baseBudget({ exceptions: { "src/a.ts": 12 } }),
    resolveRef: resolved,
  });
  assert.match(grown.failures[0], /^exception grown without a ledger entry: src\/a\.ts 10 -> 12/);

  const shrunk = structure.evaluateBudgetLedger({
    base: baseBudget({ exceptions: { "src/a.ts": 10 } }),
    current: baseBudget({ exceptions: { "src/a.ts": 8 } }),
    resolveRef: resolved,
  });
  assert.deepEqual(shrunk.failures, []);

  const added = structure.evaluateBudgetLedger({
    base: baseBudget(),
    current: baseBudget({ exceptions: { "src/a.ts": 12 } }),
    resolveRef: resolved,
  });
  assert.match(
    added.failures[0],
    /^exception added without a ledger entry: src\/a\.ts \(new\) -> 12/,
  );

  const ledgered = structure.evaluateBudgetLedger({
    base: baseBudget({ exceptions: { "src/a.ts": 10 } }),
    current: baseBudget({
      exceptions: { "src/a.ts": 12 },
      ledger: [{ file: "src/a.ts", from: 10, to: 12, reason: "S3 step list", ref: "abc1234" }],
    }),
    resolveRef: resolved,
  });
  assert.deepEqual(ledgered.failures, []);
  assert.deepEqual(ledgered.warnings, []);

  const wrongTo = structure.evaluateBudgetLedger({
    base: baseBudget({ exceptions: { "src/a.ts": 10 } }),
    current: baseBudget({
      exceptions: { "src/a.ts": 12 },
      ledger: [{ file: "src/a.ts", from: 10, to: 20, reason: "pre-approval", ref: "abc1234" }],
    }),
    resolveRef: resolved,
  });
  assert.equal(wrongTo.failures.length, 1, "an entry cannot pre-approve a different size");

  const noRef = structure.evaluateBudgetLedger({
    base: baseBudget({ exceptions: { "src/a.ts": 10 } }),
    current: baseBudget({
      exceptions: { "src/a.ts": 12 },
      ledger: [{ file: "src/a.ts", from: 10, to: 12, reason: "S3 step list" }],
    }),
    resolveRef: resolved,
  });
  assert.deepEqual(noRef.failures, [
    "structure ledger entry for src/a.ts has no ref (name the AK task or commit)",
  ]);

  const unresolvable = structure.evaluateBudgetLedger({
    base: baseBudget({ exceptions: { "src/a.ts": 10 } }),
    current: baseBudget({
      exceptions: { "src/a.ts": 12 },
      ledger: [{ file: "src/a.ts", from: 10, to: 12, reason: "S3 step list", ref: "AK #9999" }],
    }),
    resolveRef: () => "cannot be resolved here (ak unavailable)",
  });
  assert.deepEqual(unresolvable.failures, []);
  assert.equal(unresolvable.warnings.length, 1);

  const cycle = structure.evaluateBudgetLedger({
    base: baseBudget(),
    current: baseBudget({ allowed_cycles: ["src/a.ts -> src/b.ts -> src/a.ts"] }),
    resolveRef: resolved,
  });
  assert.match(
    cycle.failures[0],
    /^allowed cycle added without a ledger entry: src\/a\.ts -> src\/b\.ts -> src\/a\.ts/,
  );
});

test("a hand-edited passport fails the byte-identity check with the first differing line", () => {
  const generated = '{\n  "a": 1,\n  "b": 2\n}\n';
  assert.equal(structure.evaluatePassport({ generated, committed: generated }), undefined);
  const failure = structure.evaluatePassport({
    generated,
    committed: '{\n  "a": 1,\n  "b": 3\n}\n',
  });
  assert.match(
    failure,
    /^capability passport is not byte-identical to the generator output \(first difference at line 3\)/,
  );
});

test("classifyRef recognises commits and AK task forms and reports a missing ref", () => {
  assert.deepEqual(structure.classifyRef("30b0cbb"), { kind: "commit", value: "30b0cbb" });
  assert.deepEqual(structure.classifyRef("AK #5422"), { kind: "ak", value: "5422" });
  assert.deepEqual(structure.classifyRef("AK-TASK-0057"), { kind: "ak", value: "57" });
  assert.deepEqual(structure.classifyRef(""), { kind: "missing" });
  assert.deepEqual(structure.classifyRef(undefined), { kind: "missing" });
  assert.equal(structure.classifyRef("see the plan").kind, "other");
});

// ---------------------------------------------------------------------------
// check-structure: CLI against a temp git repo fixture and the real tree
// ---------------------------------------------------------------------------

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

function runStructure(root, extra = []) {
  return spawnSync(process.execPath, [structureCli, "--root", root, ...extra], {
    encoding: "utf8",
    env: { ...process.env, COVERAGE_BASE: "", STRUCTURE_BASE: "" },
  });
}

test("check-structure CLI over a temp git repo: green baseline, then each rule blocks with its message", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tc-structure-fixture-"));
  try {
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "fixture@example.com"]);
    git(root, ["config", "user.name", "fixture"]);
    const budget = baseBudget({ default_max_lines: 4, pure_ring: ["src/a.ts"] });
    writeFixture(root, {
      ...healthy,
      "structure-budget.json": `${JSON.stringify(budget, null, 2)}\n`,
    });
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "baseline"]);

    const green = runStructure(root);
    assert.equal(green.status, 0, `${green.stdout}\n${green.stderr}`);
    assert.match(green.stdout, /structure: 3 modules/);
    assert.match(green.stdout, /passport: skipped \(no passport in this tree\)/);
    assert.match(green.stdout, /structure: ok in/);

    // 1. size growth without a ledger entry
    writeFixture(root, { "src/a.ts": "export const a = 1;\n// 2\n// 3\n// 4\n// 5\n" });
    const grown = runStructure(root);
    assert.equal(grown.status, 1);
    assert.match(grown.stderr, /src\/a\.ts has 5 lines; budget is 4/);

    const withException = { ...budget, exceptions: { "src/a.ts": 5 } };
    writeFixture(root, { "structure-budget.json": `${JSON.stringify(withException, null, 2)}\n` });
    const noLedger = runStructure(root);
    assert.equal(noLedger.status, 1);
    assert.match(
      noLedger.stderr,
      /exception added without a ledger entry: src\/a\.ts \(new\) -> 5/,
    );

    const ledgered = {
      ...withException,
      ledger: [{ file: "src/a.ts", from: null, to: 5, reason: "fixture growth", ref: "AK #1" }],
    };
    writeFixture(root, { "structure-budget.json": `${JSON.stringify(ledgered, null, 2)}\n` });
    const okLedger = runStructure(root);
    assert.equal(okLedger.status, 0, `${okLedger.stdout}\n${okLedger.stderr}`);

    const noRef = {
      ...withException,
      ledger: [{ file: "src/a.ts", from: null, to: 5, reason: "fixture growth" }],
    };
    writeFixture(root, { "structure-budget.json": `${JSON.stringify(noRef, null, 2)}\n` });
    const missingRef = runStructure(root);
    assert.equal(missingRef.status, 1);
    assert.match(missingRef.stderr, /structure ledger entry for src\/a\.ts has no ref/);

    // restore the baseline size and budget
    writeFixture(root, {
      "src/a.ts": healthy["src/a.ts"],
      "structure-budget.json": `${JSON.stringify(budget, null, 2)}\n`,
    });

    // 2. a new cycle
    writeFixture(root, {
      "src/a.ts": 'import { b } from "./b.js";\nexport const a = b;\n',
      "src/b.ts": 'import { a } from "./a.js";\nexport const b = 2;\nexport const c = () => a;\n',
    });
    const cycle = runStructure(root);
    assert.equal(cycle.status, 1);
    assert.match(cycle.stderr, /runtime import cycle: src\/a\.ts -> src\/b\.ts -> src\/a\.ts/);
    writeFixture(root, { "src/a.ts": healthy["src/a.ts"], "src/b.ts": healthy["src/b.ts"] });

    // 3. a never-imported module (untracked, as a fresh file would be)
    writeFixture(root, { "src/orphan.ts": "export const o = 1;\n" });
    const orphan = runStructure(root);
    assert.equal(orphan.status, 1);
    assert.match(orphan.stderr, /module never imported: src\/orphan\.ts/);
    rmSync(path.join(root, "src/orphan.ts"));

    // 4. a pure module importing node:fs
    writeFixture(root, {
      "src/a.ts": 'import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n',
    });
    const ring = runStructure(root);
    assert.equal(ring.status, 1);
    assert.match(ring.stderr, /ring rule: src\/a\.ts reaches node:fs/);
    writeFixture(root, { "src/a.ts": healthy["src/a.ts"] });

    const restored = runStructure(root);
    assert.equal(restored.status, 0, `${restored.stdout}\n${restored.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check-structure passes on this tree and derives the CLI root from bin/test-capabilities", () => {
  assert.deepEqual(structure.binRoots(repoRoot), ["src/index.ts"]);
  const result = spawnSync(process.execPath, [structureCli, "--no-passport"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /0 cycle\(s\)/);
});

// ---------------------------------------------------------------------------
// coverage-ratchet: pure parts
// ---------------------------------------------------------------------------

test("lcov parsing keys records by repo-relative src path and merges repeated records", () => {
  const lcov = [
    "TN:",
    `SF:${repoRoot}src/core/a.ts`,
    "DA:1,1",
    "DA:2,0",
    "end_of_record",
    "SF:src/core/a.ts",
    "DA:2,3",
    "end_of_record",
  ].join("\n");
  const coverage = ratchet.parseLcovLines(lcov, repoRoot.replace(/\/$/, ""));
  assert.deepEqual([...coverage.keys()], ["src/core/a.ts"]);
  assert.deepEqual(
    [...coverage.get("src/core/a.ts")],
    [
      [1, 1],
      [2, 3],
    ],
  );
});

test("unified diff parsing collects added lines per file and skips deletions", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -10,0 +11,3 @@",
    "+x",
    "+y",
    "+z",
    "@@ -20 +24 @@",
    "+w",
    "diff --git a/src/gone.ts b/src/gone.ts",
    "--- a/src/gone.ts",
    "+++ /dev/null",
    "@@ -1,5 +0,0 @@",
  ].join("\n");
  const changed = ratchet.parseUnifiedDiffAddedLines(diff);
  assert.deepEqual([...changed.keys()], ["src/a.ts"]);
  assert.deepEqual(
    [...changed.get("src/a.ts")].sort((a, b) => a - b),
    [11, 12, 13, 24],
  );
});

test("changed-lines gate: uncovered list, ignored non-executable lines, 0 % for a file without a record", () => {
  const coverage = new Map([
    [
      "src/a.ts",
      new Map([
        [1, 4],
        [2, 0],
        [4, 1],
      ]),
    ],
  ]);
  const changed = new Map([["src/a.ts", new Set([1, 2, 3, 4])]]);
  const green = ratchet.evaluateChangedLines({ changed, coverage, floor: 50 });
  assert.equal(green.coverable, 3, "line 3 is not executable and is ignored");
  assert.equal(green.covered, 2);
  assert.deepEqual(green.uncovered, ["src/a.ts:2"]);
  assert.equal(green.ok, true);

  const red = ratchet.evaluateChangedLines({ changed, coverage, floor: 88.7 });
  assert.equal(red.ok, false);

  const noRecord = ratchet.evaluateChangedLines({
    changed: new Map([["src/new-module.ts", new Set([1, 2])]]),
    coverage,
    floor: 88.7,
  });
  assert.equal(noRecord.pct, 0);
  assert.deepEqual(noRecord.uncovered, ["src/new-module.ts:1", "src/new-module.ts:2"]);
  assert.match(noRecord.notes[0], /no coverage record; every changed line counts as uncovered/);

  const untracked = ratchet.evaluateChangedLines({
    changed: new Map(),
    coverage,
    floor: 88.7,
    untrackedLineCounts: new Map([["src/fresh.ts", 3]]),
  });
  assert.deepEqual(untracked.uncovered, ["src/fresh.ts:1", "src/fresh.ts:2", "src/fresh.ts:3"]);

  const parked = ratchet.evaluateChangedLines({
    changed: new Map([["src/quantum/simulator.ts", new Set([1])]]),
    coverage,
    floor: 88.7,
    excludes: ["src/quantum/**", "src/prediction/**"],
  });
  assert.equal(parked.coverable, 0);
  assert.equal(parked.ok, true);
  assert.match(parked.notes[0], /excluded from the floor/);

  const nonSource = ratchet.evaluateChangedLines({
    changed: new Map([
      ["src/types/js-yaml.d.ts", new Set([1])],
      ["tests/x.test.mjs", new Set([1])],
    ]),
    coverage,
    floor: 88.7,
  });
  assert.equal(nonSource.coverable, 0);
});

test("floors: a synthetic drop fails with the gap, a value within tolerance passes", () => {
  const floors = { lines: 88.7, branches: 77.87, functions: 84.55 };
  const drop = ratchet.evaluateFloors({
    measured: {
      lines: { pct: 87.9, covered: 8000, total: 9101 },
      branches: { pct: 77.9, covered: 1, total: 1 },
      functions: { pct: 84.55, covered: 1, total: 1 },
    },
    floors,
  });
  assert.equal(drop.failures.length, 1);
  assert.match(
    drop.failures[0],
    /^lines fell below floor: measured 87\.90 % \(8000\/9101\), floor 88\.70 %, gap 0\.80/,
  );

  const withinTolerance = ratchet.evaluateFloors({
    measured: {
      lines: { pct: 88.696, covered: 1, total: 1 },
      branches: { pct: 77.84, covered: 1, total: 1 },
      functions: { pct: 84.55, covered: 1, total: 1 },
    },
    floors,
    tolerance: { lines: 0.005, branches: 0.05, functions: 0.005 },
  });
  assert.deepEqual(withinTolerance.failures, []);

  const branchNoiseExceeded = ratchet.evaluateFloors({
    measured: {
      lines: { pct: 88.7, covered: 1, total: 1 },
      branches: { pct: 77.8, covered: 1, total: 1 },
      functions: { pct: 84.55, covered: 1, total: 1 },
    },
    floors,
    tolerance: { lines: 0.005, branches: 0.05, functions: 0.005 },
  });
  assert.equal(branchNoiseExceeded.failures.length, 1);
  assert.match(branchNoiseExceeded.failures[0], /^branches fell below floor/);

  const missing = ratchet.evaluateFloors({
    measured: { lines: { pct: 1 }, branches: { pct: 1 }, functions: { pct: 1 } },
    floors: { lines: 1 },
  });
  assert.deepEqual(missing.failures, [
    "no branches floor in the baseline",
    "no functions floor in the baseline",
  ]);
});

test("reductions ledger: a lowered floor needs an entry with exact from/to, reason and ref", () => {
  const base = {
    schema_version: 1,
    floors: { 26: { lines: 88.7, branches: 77.87, functions: 84.55 } },
  };
  const lowered = {
    ...base,
    floors: { 26: { lines: 88.5, branches: 77.87, functions: 84.55 } },
    reductions: [],
  };
  const noEntry = ratchet.evaluateReductionsLedger({
    base,
    current: lowered,
    resolveRef: () => "resolved",
  });
  assert.deepEqual(noEntry.failures, [
    'floor lowered without a reductions entry: node 26 lines 88.7 -> 88.5; append {"node_major":"26","metric":"lines","from":88.7,"to":88.5,"reason":"...","ref":"AK #..."} to coverage-baseline.json reductions in the same commit',
  ]);

  const entry = {
    node_major: "26",
    metric: "lines",
    from: 88.7,
    to: 88.5,
    reason: "delete x",
    ref: "abc1234",
  };
  const withEntry = ratchet.evaluateReductionsLedger({
    base,
    current: { ...lowered, reductions: [entry] },
    resolveRef: () => "resolved",
  });
  assert.deepEqual(withEntry.failures, []);

  const preApproval = ratchet.evaluateReductionsLedger({
    base,
    current: { ...lowered, reductions: [{ ...entry, to: 80 }] },
    resolveRef: () => "resolved",
  });
  assert.equal(preApproval.failures.length, 1, "an entry cannot pre-approve a deeper drop");

  const noRef = ratchet.evaluateReductionsLedger({
    base,
    current: { ...lowered, reductions: [{ ...entry, ref: "" }] },
    resolveRef: () => "resolved",
  });
  assert.deepEqual(noRef.failures, [
    "reductions entry for node 26 lines has no ref (name the AK task or commit)",
  ]);

  const unresolvable = ratchet.evaluateReductionsLedger({
    base,
    current: { ...lowered, reductions: [{ ...entry, ref: "AK #9999" }] },
    resolveRef: () => "cannot be resolved here (ak unavailable)",
  });
  assert.deepEqual(unresolvable.failures, []);
  assert.equal(unresolvable.warnings.length, 1);

  const raised = ratchet.evaluateReductionsLedger({
    base,
    current: {
      ...base,
      floors: { 26: { lines: 90, branches: 77.87, functions: 84.55 } },
      reductions: [],
    },
    resolveRef: () => "resolved",
  });
  assert.deepEqual(raised.failures, []);

  const newMajor = ratchet.evaluateReductionsLedger({
    base,
    current: {
      ...base,
      floors: { ...base.floors, 22: { lines: 1, branches: 1, functions: 1 } },
      reductions: [],
    },
    resolveRef: () => "resolved",
  });
  assert.deepEqual(newMajor.failures, []);
});

test("--raise rounds down, never lowers, keys by Node major and records the measurement", () => {
  const baseline = {
    schema_version: 1,
    floors: { 26: { lines: 88.7, branches: 77.87, functions: 84.55 } },
    reductions: [],
  };
  const measured = {
    lines: { pct: 89.129, covered: 1, total: 1 },
    branches: { pct: 77.5, covered: 1, total: 1 },
    functions: { pct: 84.55, covered: 1, total: 1 },
  };
  const raised = ratchet.raiseFloors({
    baseline,
    measured,
    nodeMajor: "26",
    measurement: { commit: "abc" },
  });
  assert.deepEqual(raised.baseline.floors["26"], {
    lines: 89.12,
    branches: 77.87,
    functions: 84.55,
  });
  assert.deepEqual(raised.held, ["branches"]);
  assert.deepEqual(raised.baseline.measured["26"], { commit: "abc" });
  assert.deepEqual(
    baseline.floors["26"],
    { lines: 88.7, branches: 77.87, functions: 84.55 },
    "input untouched",
  );

  const fresh = ratchet.raiseFloors({
    baseline,
    measured,
    nodeMajor: "22",
    measurement: { commit: "abc" },
  });
  assert.deepEqual(fresh.baseline.floors["22"], { lines: 89.12, branches: 77.5, functions: 84.55 });
  assert.equal(ratchet.roundDown2(88.999), 88.99);
  assert.equal(ratchet.roundDown2(88.7), 88.7);
});

test("test-summary parsing reads both the spec and the tap footer", () => {
  assert.deepEqual(ratchet.parseTestSummary("ℹ tests 251\nℹ pass 250\nℹ fail 0\nℹ skipped 1\n"), {
    tests: 251,
    pass: 250,
    fail: 0,
    skipped: 1,
  });
  assert.deepEqual(ratchet.parseTestSummary("# tests 3\n# pass 2\n# fail 1\n# skipped 0\n"), {
    tests: 3,
    pass: 2,
    fail: 1,
    skipped: 0,
  });
  assert.equal(ratchet.parseTestSummary("").tests, undefined);
});

test("exclude globs match the parked directories and nothing else", () => {
  assert.equal(ratchet.isExcludedSourcePath("src/quantum/simulator.ts", ["src/quantum/**"]), true);
  assert.equal(
    ratchet.isExcludedSourcePath("src/prediction/engine.ts", ["src/prediction/**"]),
    true,
  );
  assert.equal(
    ratchet.isExcludedSourcePath("src/core/config.ts", ["src/quantum/**", "src/prediction/**"]),
    false,
  );
  assert.equal(ratchet.nodeMajorOf("26.8.1"), "26");
});

test("the committed baselines are well-formed and carry this tree's facts", () => {
  const baseline = JSON.parse(readFileSync(path.join(repoRoot, "coverage-baseline.json"), "utf8"));
  assert.equal(baseline.schema_version, 1);
  for (const [major, floors] of Object.entries(baseline.floors)) {
    assert.match(major, /^\d+$/);
    for (const metric of ratchet.METRICS) {
      assert.equal(typeof floors[metric], "number", `${major}.${metric}`);
      assert.equal(
        floors[metric],
        ratchet.roundDown2(floors[metric]),
        "floors are two-decimal values",
      );
    }
  }
  assert.ok(Array.isArray(baseline.reductions));
  assert.deepEqual(
    baseline.exclude.dist,
    ["dist/quantum/**", "dist/prediction/**"],
    "D1 exclusion",
  );
  assert.deepEqual(baseline.exclude.src, ["src/quantum/**", "src/prediction/**"]);

  const budget = JSON.parse(readFileSync(path.join(repoRoot, "structure-budget.json"), "utf8"));
  assert.equal(budget.schema_version, 1);
  assert.deepEqual(budget.allowed_cycles, []);
  assert.ok(budget.pure_ring.includes("src/core/config.ts"));
  assert.ok(budget.pure_ring.includes("src/core/capability-matrix.ts"));
  for (const [file, lines] of Object.entries(budget.exceptions)) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    assert.equal(structure.countLines(source), lines, `${file} exception equals its measured size`);
  }
});
