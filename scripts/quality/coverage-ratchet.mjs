#!/usr/bin/env node
/**
 * Coverage ratchet for test-capabilities (quality ratchet, part 1).
 *
 * Builds `dist/` with source maps, runs the test corpus once under `c8`
 * (which merges the V8 coverage of every child and grandchild process, so the
 * CLI spawns and the child-only `test-operation.ts` count; Node's built-in
 * `--experimental-test-coverage` on Node 26 does not merge grandchildren, see
 * docs/project/2026-09-07-slice-s1-s1b-notes.md), remaps hits onto `src/**`
 * through the maps, then enforces `coverage-baseline.json`:
 *   1. lines, branches and functions >= floor - tolerance for the running
 *      Node major (floors are keyed by major; a missing major fails closed);
 *   2. changed executable src lines (against COVERAGE_BASE, else HEAD when the
 *      tree is dirty, else HEAD^) covered at >= floors.lines; a changed file
 *      with no coverage record counts as 0 %; the uncovered `file:line` list
 *      is printed on every run, green or red;
 *   3. a floor lowered relative to the comparison base needs a `reductions`
 *      entry with the exact from/to, a reason and a ref (missing ref fails,
 *      unresolvable ref warns);
 *   4. `--raise` rewrites the running major's floors upward to the measured
 *      values (rounded down to two decimals) and records the measurement.
 *
 * The lcov and diff parsers are derived from pic `scripts/check-coverage.ts`
 * (cv/pic v0.2.37, Apache-2.0, archived at ~/ai-society/softwareco/contrib/pic);
 * unlike pic, a changed file without a record fails closed.
 *
 * Pure functions are exported for `tests/quality_ratchet_contract.test.mjs`;
 * the CLI entry point runs only when this file is the main module.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  classifyRef,
  makeRefResolver,
  readFileAtRef,
  resolveComparisonBase,
} from "./check-structure.mjs";

export const DEFAULT_BASELINE_FILE = "coverage-baseline.json";
export const METRICS = ["lines", "branches", "functions"];
export const DEFAULT_TOLERANCE = 0.005;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function roundDown2(value) {
  return Math.floor(value * 100 + 1e-9) / 100;
}

export function nodeMajorOf(version = process.versions.node) {
  return String(version).split(".")[0];
}

/** Minimal glob matcher for the include/exclude patterns (`**`, `*`). */
export function globToRegExp(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

export function isExcludedSourcePath(file, excludes) {
  return excludes.some((pattern) => globToRegExp(pattern).test(file));
}

/** lcov `SF:`/`DA:` records -> Map<file, Map<line, hits>> (paths made repo-relative). */
export function parseLcovLines(source, root = process.cwd()) {
  const coverage = new Map();
  const marker = `${root.replace(/\/$/, "")}/`;
  let file;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const entry = line.slice(3);
      file = (entry.startsWith(marker) ? entry.slice(marker.length) : entry).replaceAll("\\", "/");
      if (!coverage.has(file)) {
        coverage.set(file, new Map());
      }
      continue;
    }
    if (line === "end_of_record") {
      file = undefined;
      continue;
    }
    if (!(file && line.startsWith("DA:"))) {
      continue;
    }
    const [lineNumber, hits] = line.slice(3).split(",").map(Number);
    if (Number.isFinite(lineNumber) && Number.isFinite(hits)) {
      const lines = coverage.get(file);
      lines.set(lineNumber, (lines.get(lineNumber) ?? 0) + hits);
    }
  }
  return coverage;
}

/** `git diff --unified=0` text -> Map<file, Set<added line number>>. */
export function parseUnifiedDiffAddedLines(diffText) {
  const changed = new Map();
  let file;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      file = target.startsWith("b/")
        ? target.slice(2)
        : target === "/dev/null"
          ? undefined
          : target;
      continue;
    }
    if (line.startsWith("--- ")) {
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!(file && hunk)) {
      continue;
    }
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    const lines = changed.get(file) ?? new Set();
    for (let offset = 0; offset < count; offset += 1) {
      lines.add(start + offset);
    }
    changed.set(file, lines);
  }
  return changed;
}

/**
 * Changed-lines evaluation. `changed`: Map<file, Set<line>> (src paths);
 * `coverage`: Map<file, Map<line, hits>>; `untrackedLineCounts`: Map<file, n>
 * for new untracked files (every line counts as changed). Returns the
 * covered/coverable counts, the uncovered list and the per-file notes.
 */
export function evaluateChangedLines({
  changed,
  coverage,
  floor,
  excludes = [],
  untrackedLineCounts = new Map(),
}) {
  const uncovered = [];
  const notes = [];
  let coverable = 0;
  let covered = 0;
  const all = new Map(changed);
  for (const [file, count] of untrackedLineCounts) {
    const lines = new Set();
    for (let line = 1; line <= count; line += 1) {
      lines.add(line);
    }
    all.set(file, lines);
  }
  for (const [file, lines] of [...all].sort(([a], [b]) => a.localeCompare(b))) {
    if (!file.startsWith("src/") || !file.endsWith(".ts") || file.endsWith(".d.ts")) {
      continue;
    }
    if (isExcludedSourcePath(file, excludes)) {
      notes.push(`${file}: excluded from the floor (parked, D1)`);
      continue;
    }
    const record = coverage.get(file);
    if (!record) {
      // Fail closed: no record means the module never reached the report.
      notes.push(`${file}: no coverage record; every changed line counts as uncovered`);
      for (const line of [...lines].sort((a, b) => a - b)) {
        coverable += 1;
        uncovered.push(`${file}:${line}`);
      }
      continue;
    }
    for (const line of [...lines].sort((a, b) => a - b)) {
      const hits = record.get(line);
      if (hits === undefined) {
        continue; // not executable per the report
      }
      coverable += 1;
      if (hits > 0) {
        covered += 1;
      } else {
        uncovered.push(`${file}:${line}`);
      }
    }
  }
  const pct = coverable === 0 ? undefined : (covered / coverable) * 100;
  const ok = coverable === 0 || pct + 1e-9 >= floor;
  return { coverable, covered, pct, uncovered, notes, ok };
}

export function evaluateFloors({ measured, floors, tolerance = DEFAULT_TOLERANCE }) {
  const failures = [];
  const rows = [];
  for (const metric of METRICS) {
    const floor = floors?.[metric];
    const value = measured[metric];
    const tol =
      typeof tolerance === "number" ? tolerance : (tolerance?.[metric] ?? DEFAULT_TOLERANCE);
    if (typeof floor !== "number") {
      failures.push(`no ${metric} floor in the baseline`);
      rows.push({ metric, value, floor: undefined, ok: false });
      continue;
    }
    const ok = value.pct + tol + 1e-9 >= floor;
    rows.push({ metric, value, floor, tolerance: tol, ok });
    if (!ok) {
      failures.push(
        `${metric} fell below floor: measured ${value.pct.toFixed(2)} % (${value.covered}/${value.total}), floor ${floor.toFixed(2)} %, gap ${(floor - value.pct).toFixed(2)} (either coverage fell or the floor was hand-edited upward; add tests, or lower the floor with a reductions entry in the same commit)`,
      );
    }
  }
  return { failures, rows };
}

/**
 * Ledger evaluation: `base` is the baseline at the comparison ref (undefined
 * when absent), `current` the working-tree baseline.
 */
export function evaluateReductionsLedger({ base, current, resolveRef = () => "unresolvable" }) {
  const failures = [];
  const warnings = [];
  const reductions = Array.isArray(current.reductions) ? current.reductions : [];
  for (const entry of reductions) {
    if (!entry || typeof entry !== "object") {
      failures.push("reductions entry is not an object");
      continue;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      failures.push(`reductions entry ${describeReduction(entry)} has no reason`);
    }
    const ref = classifyRef(entry.ref);
    if (ref.kind === "missing") {
      failures.push(
        `reductions entry ${describeReduction(entry)} has no ref (name the AK task or commit)`,
      );
    } else {
      const resolution = resolveRef(ref);
      if (resolution !== "resolved") {
        warnings.push(
          `reductions entry ${describeReduction(entry)}: ref '${entry.ref}' ${resolution}`,
        );
      }
    }
  }
  for (const [major, floors] of Object.entries(current.floors ?? {})) {
    const baseFloors = base?.floors?.[major];
    if (!baseFloors) {
      continue;
    }
    for (const metric of METRICS) {
      const from = baseFloors[metric];
      const to = floors?.[metric];
      if (typeof from !== "number" || typeof to !== "number" || to >= from) {
        continue;
      }
      const entry = reductions.find(
        (candidate) =>
          candidate?.metric === metric &&
          String(candidate.node_major) === major &&
          candidate.from === from &&
          candidate.to === to,
      );
      if (!entry) {
        failures.push(
          `floor lowered without a reductions entry: node ${major} ${metric} ${from} -> ${to}; append {"node_major":"${major}","metric":"${metric}","from":${from},"to":${to},"reason":"...","ref":"AK #..."} to coverage-baseline.json reductions in the same commit`,
        );
      }
    }
  }
  return { failures, warnings };
}

function describeReduction(entry) {
  return entry?.metric
    ? `for node ${entry.node_major ?? "?"} ${entry.metric}`
    : JSON.stringify(entry);
}

/** Returns a new baseline with the running major's floors raised to the measurement. */
export function raiseFloors({ baseline, measured, nodeMajor, measurement }) {
  const next = structuredClone(baseline);
  next.floors ??= {};
  next.measured ??= {};
  const current = next.floors[nodeMajor] ?? {};
  const raised = {};
  const held = [];
  for (const metric of METRICS) {
    const candidate = roundDown2(measured[metric].pct);
    if (typeof current[metric] === "number" && candidate < current[metric]) {
      raised[metric] = current[metric];
      held.push(metric);
    } else {
      raised[metric] = candidate;
    }
  }
  next.floors[nodeMajor] = raised;
  next.measured[nodeMajor] = measurement;
  return { baseline: next, held };
}

export function parseTestSummary(output) {
  const pick = (label) => {
    const match = new RegExp(`(?:^|\\n)(?:# |ℹ )${label} (\\d+)`).exec(output);
    return match ? Number(match[1]) : undefined;
  };
  return { tests: pick("tests"), pass: pick("pass"), fail: pick("fail"), skipped: pick("skipped") };
}

// ---------------------------------------------------------------------------
// Adapters (used only by the CLI entry point)
// ---------------------------------------------------------------------------

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
}

export function collectCoverage({ root, baseline, reportDir }) {
  const build = run("npm", ["run", "build", "--silent"], {
    cwd: root,
    env: { ...process.env, TEST_CAPABILITIES_BUILD_SOURCEMAP: "1" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (build.status !== 0) {
    throw new Error("coverage: build failed (TEST_CAPABILITIES_BUILD_SOURCEMAP=1 npm run build)");
  }
  const c8 = path.join(root, "node_modules", "c8", "bin", "c8.js");
  if (!existsSync(c8)) {
    throw new Error("coverage: c8 is not installed; run npm install");
  }
  const testFiles = readdirSync(path.join(root, "tests"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join("tests", name));
  if (testFiles.length === 0) {
    throw new Error("coverage: no tests/*.test.mjs files");
  }
  rmSync(reportDir, { recursive: true, force: true });
  mkdirSync(reportDir, { recursive: true });
  const args = [
    c8,
    "--all",
    ...(baseline.include ?? ["dist/**/*.js"]).flatMap((pattern) => ["--include", pattern]),
    ...(baseline.exclude?.dist ?? []).flatMap((pattern) => ["--exclude", pattern]),
    "--reporter=lcov",
    "--reporter=json-summary",
    "--report-dir",
    reportDir,
    "--temp-directory",
    path.join(reportDir, "tmp"),
    process.execPath,
    "--test",
    ...testFiles,
  ];
  const result = run(process.execPath, args, { cwd: root, env: { ...process.env } });
  const output = `${result.stdout}\n${result.stderr}`;
  const summary = parseTestSummary(output);
  if (result.status !== 0 || summary.fail !== 0) {
    process.stderr.write(output);
    throw new Error(
      `coverage: the test run failed (exit ${result.status}, fail ${summary.fail ?? "?"}); the ratchet needs a green corpus`,
    );
  }
  const summaryPath = path.join(reportDir, "coverage-summary.json");
  const lcovPath = path.join(reportDir, "lcov.info");
  if (!existsSync(summaryPath) || !existsSync(lcovPath)) {
    throw new Error(`coverage: c8 wrote no report under ${reportDir}`);
  }
  const total = JSON.parse(readFileSync(summaryPath, "utf8")).total;
  const measured = {};
  for (const metric of METRICS) {
    const row = total[metric];
    if (!row || typeof row.pct !== "number") {
      throw new Error(
        `coverage: the c8 summary has no numeric ${metric} total (nothing matched the include patterns?)`,
      );
    }
    measured[metric] = { pct: row.pct, covered: row.covered, total: row.total };
  }
  const lcov = readFileSync(lcovPath, "utf8");
  const coverage = parseLcovLines(lcov, root);
  const unmapped = [...coverage.keys()].filter((file) => !file.startsWith("src/"));
  if (coverage.size === 0 || unmapped.length > 0) {
    throw new Error(
      `coverage: the report is not mapped onto src/** (${unmapped.slice(0, 3).join(", ") || "empty"}); the coverage build must emit source maps`,
    );
  }
  const c8Version = JSON.parse(
    readFileSync(path.join(root, "node_modules", "c8", "package.json"), "utf8"),
  ).version;
  return { measured, coverage, summary, c8Version };
}

export function changedSourceLines(root, baseRef) {
  const diff = run("git", ["diff", "--unified=0", "--no-color", baseRef, "--", "src"], {
    cwd: root,
  });
  if (diff.status !== 0) {
    throw new Error(`coverage: git diff against ${baseRef} failed: ${diff.stderr.trim()}`);
  }
  const changed = parseUnifiedDiffAddedLines(diff.stdout);
  const untracked = new Map();
  if (baseRef === "HEAD") {
    const others = run("git", ["ls-files", "--others", "--exclude-standard", "--", "src"], {
      cwd: root,
    });
    for (const file of others.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)) {
      const source = readFileSync(path.join(root, file), "utf8");
      untracked.set(
        file,
        source === "" ? 0 : source.split("\n").length - (source.endsWith("\n") ? 1 : 0),
      );
    }
  }
  return { changed, untracked };
}

function formatBaseline(baseline) {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

export function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    raise: false,
    base: process.env.COVERAGE_BASE || undefined,
    reportDir: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--raise") {
      options.raise = true;
    } else if (arg === "--root") {
      options.root = path.resolve(argv[++index]);
    } else if (arg === "--base") {
      options.base = argv[++index];
    } else if (arg === "--report-dir") {
      options.reportDir = path.resolve(argv[++index]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  options.reportDir ??= path.join(options.root, "coverage");
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const started = Date.now();
  const options = parseArgs(argv);
  const root = options.root;
  const baselinePath = path.join(root, DEFAULT_BASELINE_FILE);
  if (!existsSync(baselinePath)) {
    console.error(`coverage: ${DEFAULT_BASELINE_FILE} is missing at ${root}`);
    return 1;
  }
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (error) {
    console.error(`coverage: ${DEFAULT_BASELINE_FILE} is not valid JSON: ${error.message}`);
    return 1;
  }
  if (baseline.schema_version !== 1) {
    console.error(`coverage: unsupported schema_version ${baseline.schema_version} (expected 1)`);
    return 1;
  }
  const nodeMajor = nodeMajorOf();
  const failures = [];
  const warnings = [];

  let collected;
  try {
    collected = collectCoverage({ root, baseline, reportDir: options.reportDir });
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const { measured, coverage, summary, c8Version } = collected;
  console.log(
    `coverage: node ${process.versions.node} (c8 ${c8Version}), ${summary.tests} tests, ${summary.pass} pass, ${summary.fail} fail, ${summary.skipped} skipped, ${coverage.size} src modules reported`,
  );

  let base;
  try {
    base = resolveComparisonBase(root, options.base);
  } catch (error) {
    failures.push(error.message);
    base = { ref: undefined, reason: "unresolvable" };
  }

  if (options.raise) {
    const head = run("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).stdout.trim();
    const raised = raiseFloors({
      baseline,
      measured,
      nodeMajor,
      measurement: {
        commit: head,
        tests: summary.tests,
        node: process.versions.node,
        c8: c8Version,
        measured_at: new Date().toISOString().slice(0, 10),
      },
    });
    writeFileSync(baselinePath, formatBaseline(raised.baseline), "utf8");
    baseline = raised.baseline;
    console.log(
      `coverage: --raise wrote node ${nodeMajor} floors ${METRICS.map((metric) => `${metric} ${baseline.floors[nodeMajor][metric].toFixed(2)}`).join(", ")}${raised.held.length > 0 ? ` (held, measured below floor: ${raised.held.join(", ")})` : ""}`,
    );
  }

  const floors = baseline.floors?.[nodeMajor];
  if (!floors) {
    failures.push(
      `no floors for Node ${nodeMajor} in ${DEFAULT_BASELINE_FILE} (known: ${Object.keys(baseline.floors ?? {}).join(", ") || "none"}); measured ${METRICS.map((metric) => `${metric} ${measured[metric].pct.toFixed(2)} %`).join(", ")}; run node scripts/quality/coverage-ratchet.mjs --raise on Node ${nodeMajor} and commit the entry`,
    );
  } else {
    const floorResult = evaluateFloors({
      measured,
      floors,
      tolerance: baseline.tolerance ?? DEFAULT_TOLERANCE,
    });
    for (const row of floorResult.rows) {
      console.log(
        `${row.metric.padEnd(10)} ${row.value.pct.toFixed(2).padStart(6)} % (${row.value.covered}/${row.value.total})  floor ${row.floor === undefined ? "none" : `${row.floor.toFixed(2)} %`}${row.tolerance ? ` (tolerance ${row.tolerance})` : ""}  ${row.ok ? "ok" : "FAIL"}`,
      );
    }
    failures.push(...floorResult.failures);
  }

  if (base.ref) {
    let changedResult;
    try {
      const { changed, untracked } = changedSourceLines(root, base.ref);
      changedResult = evaluateChangedLines({
        changed,
        coverage,
        floor: floors?.lines ?? 100,
        excludes: baseline.exclude?.src ?? [],
        untrackedLineCounts: untracked,
      });
    } catch (error) {
      failures.push(error.message);
    }
    if (changedResult) {
      for (const note of changedResult.notes) {
        console.log(`changed-lines: ${note}`);
      }
      if (changedResult.coverable === 0) {
        console.log(
          `changed-lines: no executable src changes against ${base.ref} (${base.reason})`,
        );
      } else {
        console.log(
          `changed-lines: ${changedResult.covered}/${changedResult.coverable} (${changedResult.pct.toFixed(2)} %), floor ${(floors?.lines ?? 100).toFixed(2)} %, base ${base.ref} (${base.reason})  ${changedResult.ok ? "ok" : "FAIL"}`,
        );
        console.log(
          changedResult.uncovered.length === 0
            ? "changed-lines: uncovered: (none)"
            : `changed-lines: uncovered:\n${changedResult.uncovered.map((entry) => `  ${entry}`).join("\n")}`,
        );
        if (!changedResult.ok) {
          failures.push(
            `changed lines covered at ${changedResult.pct.toFixed(2)} %, below the lines floor ${(floors?.lines ?? 100).toFixed(2)} % (cover the listed lines, or raise the whole tree)`,
          );
        }
      }
    }
  } else {
    console.log(`changed-lines: skipped (${base.reason})`);
  }

  const baseBaselineText = readFileAtRef(root, base.ref, DEFAULT_BASELINE_FILE);
  let baseBaseline;
  if (baseBaselineText !== undefined) {
    try {
      baseBaseline = JSON.parse(baseBaselineText);
    } catch {
      warnings.push(
        `${DEFAULT_BASELINE_FILE} at ${base.ref} is not valid JSON; floor history not compared`,
      );
    }
  }
  const ledger = evaluateReductionsLedger({
    base: baseBaseline,
    current: baseline,
    resolveRef: makeRefResolver(root),
  });
  failures.push(...ledger.failures);
  warnings.push(...ledger.warnings);
  console.log(
    `ledger: compared to ${base.ref ?? "(nothing)"}; ${(baseline.reductions ?? []).length} reductions entries`,
  );

  for (const warning of warnings) {
    console.warn(`coverage: warning: ${warning}`);
  }
  for (const failure of failures) {
    console.error(`coverage: FAIL: ${failure}`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (failures.length > 0) {
    console.error(`coverage: ${failures.length} failure(s) in ${seconds}s`);
    return 1;
  }
  console.log(`coverage: ok in ${seconds}s`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
