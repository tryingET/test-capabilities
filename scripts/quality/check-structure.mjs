#!/usr/bin/env node
/**
 * Structure budget for test-capabilities (quality ratchet, part 1).
 *
 * Checks, in this order, and fails closed on the first group that reports:
 *   1. size budget: every src module stays under `default_max_lines` unless
 *      `structure-budget.json` carries an exception equal to its measured size;
 *   2. runtime import cycles: none, unless listed in `allowed_cycles`;
 *   3. never-imported: every runtime module is reachable in the import graph
 *      from `src/index.ts` or the modules `bin/test-capabilities` loads
 *      (type-only modules are exempt, there is no exception list);
 *   4. ring rule: the modules named in `pure_ring` reach neither `node:fs`
 *      nor `node:child_process` through any runtime import;
 *   5. ledger: an exception that is added or grown, or a cycle that is added,
 *      needs a `ledger` entry with the exact `from`/`to`, a reason and a ref
 *      in the same change (missing ref fails, unresolvable ref warns);
 *   6. passport byte identity: `generate-capability-passport.mjs --stdout`
 *      equals the committed `governance/capability-passport.json`.
 *
 * Portions (the cycle DFS, the size-budget and relative-specifier resolution
 * shape) are derived from pic `scripts/check-structure.ts` (cv/pic v0.2.37,
 * Apache-2.0, archived at ~/ai-society/softwareco/contrib/pic). Import edges
 * are extracted with a regex instead of the TypeScript AST because this repo
 * ships only `tsgo`, which exposes no compiler API.
 *
 * Pure functions are exported for `tests/quality_ratchet_contract.test.mjs`;
 * the CLI entry point runs only when this file is the main module.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const DEFAULT_BUDGET_FILE = "structure-budget.json";
export const WORLD_MODULES = new Set([
  "node:fs",
  "fs",
  "node:fs/promises",
  "fs/promises",
  "node:child_process",
  "child_process",
]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function countLines(source) {
  if (source === "") {
    return 0;
  }
  const lines = source.split("\n");
  return source.endsWith("\n") ? lines.length - 1 : lines.length;
}

function stripCommentsAndStrings(source) {
  // Good enough for import extraction: removes block comments, line comments
  // and the bodies of template literals so a specifier inside prose is not an
  // edge. String literals are kept because specifiers are string literals.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (_match, lead) => lead)
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * Returns `{ runtime, typeOnly }` specifier lists for one module source.
 * Skipped as type-only: `import type … from`, `export type … from`, named
 * imports whose every specifier carries `type`, and `import("x").T` in a
 * type position (followed by a property access).
 */
export function extractImportSpecifiers(source) {
  const text = stripCommentsAndStrings(source);
  const runtime = new Set();
  const typeOnly = new Set();

  const staticImport =
    /(?:^|[\n;])\s*(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(staticImport)) {
    const [, , typeKeyword, clause, specifier] = match;
    if (typeKeyword) {
      typeOnly.add(specifier);
      continue;
    }
    const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (named) {
      const names = named[1]
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (names.length > 0 && names.every((entry) => /^type\s/.test(entry))) {
        typeOnly.add(specifier);
        continue;
      }
    }
    runtime.add(specifier);
  }

  const sideEffectImport = /(?:^|[\n;])\s*import\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(sideEffectImport)) {
    runtime.add(match[1]);
  }

  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)(\s*\.\s*[A-Za-z_$])?/g;
  for (const match of text.matchAll(dynamicImport)) {
    if (match[2]) {
      typeOnly.add(match[1]);
    } else {
      runtime.add(match[1]);
    }
  }

  return { runtime: [...runtime], typeOnly: [...typeOnly] };
}

/** True when a module declares only types (zero executable lines once built). */
export function isTypeOnlyModule(source) {
  const text = stripCommentsAndStrings(source);
  const { runtime } = extractImportSpecifiers(text);
  if (runtime.length > 0) {
    return false;
  }
  const runtimeDeclaration =
    /(?:^|[\n;])\s*(?:export\s+)?(?:default\s+|const\s|let\s|var\s|function\s|async\s+function\s|class\s|enum\s)/;
  if (runtimeDeclaration.test(text)) {
    return false;
  }
  if (/(?:^|[\n;])\s*export\s*(?:\{|\*)/.test(text)) {
    // `export { A }` re-exports a runtime binding; `export type { A }` was
    // stripped above by the type keyword.
    return !/(?:^|[\n;])\s*export\s*\{[^}]*\}\s*(?:;|\n|$)/.test(
      text.replace(/export\s+type\s*\{[^}]*\}/g, ""),
    );
  }
  return true;
}

export function resolveRelativeImport(fromFile, specifier, fileSet) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const candidate = path.normalize(path.join(path.dirname(fromFile), specifier));
  const alternatives = [
    candidate,
    candidate.replace(/\.js$/, ".ts"),
    candidate.replace(/\.mjs$/, ".mts"),
    `${candidate}.ts`,
    `${candidate}.js`,
    path.join(candidate, "index.ts"),
    path.join(candidate, "index.js"),
  ];
  return alternatives
    .map((entry) => entry.replaceAll(path.sep, "/"))
    .find((entry) => fileSet.has(entry));
}

/**
 * Builds the import graph over `files` (Map<relative path, source>).
 * Returns `{ runtime, all, external }`: runtime and all edges between the
 * given modules, and the bare (non-relative) runtime specifiers per module.
 */
export function buildImportGraph(files) {
  const fileSet = new Set(files.keys());
  const runtime = new Map();
  const all = new Map();
  const external = new Map();
  for (const [file, source] of files) {
    const specifiers = extractImportSpecifiers(source);
    const runtimeEdges = [];
    const allEdges = [];
    const bare = [];
    for (const specifier of specifiers.runtime) {
      const target = resolveRelativeImport(file, specifier, fileSet);
      if (target) {
        runtimeEdges.push(target);
        allEdges.push(target);
      } else if (!specifier.startsWith(".")) {
        bare.push(specifier);
      }
    }
    for (const specifier of specifiers.typeOnly) {
      const target = resolveRelativeImport(file, specifier, fileSet);
      if (target) {
        allEdges.push(target);
      }
    }
    runtime.set(file, [...new Set(runtimeEdges)]);
    all.set(file, [...new Set(allEdges)]);
    external.set(file, [...new Set(bare)]);
  }
  return { runtime, all, external };
}

/** pic's DFS: every distinct elementary cycle first reached on the stack. */
export function findCycles(graph) {
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const cycles = new Map();
  const visit = (file) => {
    if (active.has(file)) {
      const start = stack.indexOf(file);
      const cycle = [...stack.slice(start), file];
      cycles.set(cycle.join(" -> "), cycle);
      return;
    }
    if (visited.has(file)) {
      return;
    }
    visited.add(file);
    active.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) {
      visit(dependency);
    }
    stack.pop();
    active.delete(file);
  };
  for (const file of [...graph.keys()].sort()) {
    visit(file);
  }
  return [...cycles.values()];
}

export function reachableFrom(graph, roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const next of graph.get(current) ?? []) {
      queue.push(next);
    }
  }
  return seen;
}

/** The world modules a module reaches through runtime imports, with the path. */
export function worldReach(module, graph, external) {
  const seen = new Set();
  const stack = [[module, [module]]];
  const hits = [];
  while (stack.length > 0) {
    const [current, trail] = stack.pop();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    for (const bare of external.get(current) ?? []) {
      if (WORLD_MODULES.has(bare)) {
        hits.push({ module: bare, via: trail });
      }
    }
    for (const next of graph.get(current) ?? []) {
      stack.push([next, [...trail, next]]);
    }
  }
  return hits;
}

export function classifyRef(ref) {
  if (typeof ref !== "string" || ref.trim() === "") {
    return { kind: "missing" };
  }
  const trimmed = ref.trim();
  if (/^[0-9a-f]{7,40}$/i.test(trimmed)) {
    return { kind: "commit", value: trimmed };
  }
  const ak = /^AK[\s#-]*(?:TASK-)?0*(\d+)$/i.exec(trimmed);
  if (ak) {
    return { kind: "ak", value: ak[1] };
  }
  return { kind: "other", value: trimmed };
}

/**
 * Ledger evaluation for the structure budget: `base` is the budget at the
 * comparison ref (undefined when it did not exist), `current` the working
 * tree budget. Returns `{ failures, warnings }`.
 */
export function evaluateBudgetLedger({ base, current, resolveRef = () => "unresolvable" }) {
  const failures = [];
  const warnings = [];
  const ledger = Array.isArray(current.ledger) ? current.ledger : [];
  const baseExceptions = base?.exceptions ?? {};
  const baseCycles = new Set(base?.allowed_cycles ?? []);

  for (const entry of ledger) {
    if (!entry || typeof entry !== "object") {
      failures.push("structure ledger entry is not an object");
      continue;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      failures.push(`structure ledger entry ${describeEntry(entry)} has no reason`);
    }
    const ref = classifyRef(entry.ref);
    if (ref.kind === "missing") {
      failures.push(
        `structure ledger entry ${describeEntry(entry)} has no ref (name the AK task or commit)`,
      );
    } else {
      const resolution = resolveRef(ref);
      if (resolution !== "resolved") {
        warnings.push(
          `structure ledger entry ${describeEntry(entry)}: ref '${entry.ref}' ${resolution}`,
        );
      }
    }
  }

  for (const [file, to] of Object.entries(current.exceptions ?? {})) {
    const from = Object.hasOwn(baseExceptions, file) ? baseExceptions[file] : null;
    if (from !== null && to <= from) {
      continue;
    }
    const entry = ledger.find(
      (candidate) =>
        candidate?.file === file && candidate.to === to && (candidate.from ?? null) === from,
    );
    if (!entry) {
      const verb = from === null ? "added" : "grown";
      failures.push(
        `exception ${verb} without a ledger entry: ${file} ${from === null ? "(new)" : from} -> ${to}; append {"file":"${file}","from":${from},"to":${to},"reason":"...","ref":"AK #..."} to structure-budget.json ledger in the same commit`,
      );
    }
  }

  for (const cycle of current.allowed_cycles ?? []) {
    if (baseCycles.has(cycle)) {
      continue;
    }
    const entry = ledger.find((candidate) => candidate?.cycle === cycle);
    if (!entry) {
      failures.push(
        `allowed cycle added without a ledger entry: ${cycle}; append {"cycle":"${cycle}","reason":"...","ref":"AK #..."} to structure-budget.json ledger in the same commit`,
      );
    }
  }

  return { failures, warnings };
}

function describeEntry(entry) {
  if (entry?.file) {
    return `for ${entry.file}`;
  }
  if (entry?.cycle) {
    return `for cycle ${entry.cycle}`;
  }
  return JSON.stringify(entry);
}

/**
 * Evaluates size, cycles, never-imported and the ring rule over `files`
 * (Map<relative path, source>) against `budget`. `roots` are the reachability
 * roots. Returns `{ failures, warnings, facts }`; every failure names its fix.
 */
export function evaluateStructure({ files, budget, roots }) {
  const failures = [];
  const warnings = [];
  const maxLines = budget.default_max_lines ?? 700;
  const exceptions = budget.exceptions ?? {};

  for (const [file, source] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const lines = countLines(source);
    const exception = Object.hasOwn(exceptions, file) ? exceptions[file] : undefined;
    const limit = exception ?? maxLines;
    if (lines > limit) {
      failures.push(
        exception === undefined
          ? `${file} has ${lines} lines; budget is ${maxLines} (split the file, or add an exception with a ledger entry)`
          : `${file} has ${lines} lines; exception is ${exception} (raise the exception to ${lines} with a ledger entry, or shrink the file)`,
      );
    } else if (exception !== undefined && lines < exception) {
      failures.push(
        `${file} has ${lines} lines but its exception is ${exception}; lower the exception to ${lines} (no ledger entry needed)`,
      );
    }
  }
  for (const file of Object.keys(exceptions)) {
    if (!files.has(file)) {
      failures.push(`exception for ${file} but the file does not exist; remove the exception`);
    }
  }

  const graph = buildImportGraph(files);
  const allowedCycles = new Set(budget.allowed_cycles ?? []);
  const cycles = findCycles(graph.runtime).map((cycle) => cycle.join(" -> "));
  for (const cycle of cycles) {
    if (!allowedCycles.has(cycle)) {
      failures.push(
        `runtime import cycle: ${cycle} (break it, or list it in allowed_cycles with a ledger entry)`,
      );
    }
  }
  for (const cycle of allowedCycles) {
    if (!cycles.includes(cycle)) {
      failures.push(`allowed cycle no longer exists: ${cycle}; remove it from allowed_cycles`);
    }
  }

  const missingRoots = roots.filter((root) => !files.has(root));
  if (missingRoots.length > 0) {
    failures.push(`reachability root missing: ${missingRoots.join(", ")}`);
  }
  const reachable = reachableFrom(
    graph.all,
    roots.filter((root) => files.has(root)),
  );
  const typeOnly = new Set();
  for (const [file, source] of files) {
    if (reachable.has(file)) {
      continue;
    }
    if (isTypeOnlyModule(source)) {
      typeOnly.add(file);
      continue;
    }
    failures.push(
      `module never imported: ${file} is not reachable from ${roots.join(" or ")} (import it from a live path or delete it; there is no exception list)`,
    );
  }

  for (const module of budget.pure_ring ?? []) {
    if (!files.has(module)) {
      failures.push(`pure_ring names ${module} but the file does not exist; fix the list`);
      continue;
    }
    for (const hit of worldReach(module, graph.runtime, graph.external)) {
      failures.push(
        `ring rule: ${module} reaches ${hit.module} via ${hit.via.join(" -> ")} (the pure ring imports neither node:fs nor node:child_process)`,
      );
    }
  }

  return {
    failures,
    warnings,
    facts: {
      modules: files.size,
      runtimeEdges: [...graph.runtime.values()].reduce((sum, edges) => sum + edges.length, 0),
      cycles,
      unreachableTypeOnly: [...typeOnly].sort(),
      oversized: [...files]
        .filter(([, source]) => countLines(source) > maxLines)
        .map(([file, source]) => `${file}:${countLines(source)}`)
        .sort(),
    },
  };
}

export function evaluatePassport({ generated, committed }) {
  if (generated === committed) {
    return undefined;
  }
  const generatedLines = generated.split("\n");
  const committedLines = committed.split("\n");
  let first = 0;
  while (
    first < generatedLines.length &&
    first < committedLines.length &&
    generatedLines[first] === committedLines[first]
  ) {
    first += 1;
  }
  return `capability passport is not byte-identical to the generator output (first difference at line ${first + 1}); run npm run capability:passport and commit governance/capability-passport.json`;
}

// ---------------------------------------------------------------------------
// Filesystem and git adapters (thin, used only by the CLI entry point)
// ---------------------------------------------------------------------------

export function listSourceModules(root, dir = "src") {
  const absoluteDir = path.join(root, dir);
  if (!existsSync(absoluteDir)) {
    return new Map();
  }
  const files = new Map();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        files.set(path.relative(root, full).replaceAll(path.sep, "/"), readFileSync(full, "utf8"));
      }
    }
  };
  walk(absoluteDir);
  return files;
}

/** The src modules `bin/test-capabilities` loads through `runtimeModuleUrl("x.js")`. */
export function binRoots(root, binFile = "bin/test-capabilities") {
  const binPath = path.join(root, binFile);
  if (!existsSync(binPath)) {
    return [];
  }
  const source = readFileSync(binPath, "utf8");
  const roots = new Set();
  for (const match of source.matchAll(/runtimeModuleUrl\(\s*["']([^"']+\.js)["']\s*\)/g)) {
    roots.add(`src/${match[1].replace(/\.js$/, ".ts")}`);
  }
  return [...roots].sort();
}

function git(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

export function resolveComparisonBase(root, explicit) {
  if (explicit && !/^0+$/.test(explicit)) {
    const check = git(root, ["rev-parse", "--verify", "--quiet", `${explicit}^{commit}`]);
    if (check.status !== 0) {
      throw new Error(
        `comparison base '${explicit}' does not resolve in this checkout (fetch it, or unset it)`,
      );
    }
    return { ref: explicit, reason: "explicit" };
  }
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.status !== 0) {
    throw new Error(`git status failed: ${status.stderr.trim()}`);
  }
  if (status.stdout.trim() !== "") {
    return { ref: "HEAD", reason: "working tree is dirty" };
  }
  const parent = git(root, ["rev-parse", "--verify", "--quiet", "HEAD^"]);
  if (parent.status !== 0) {
    return { ref: undefined, reason: "HEAD has no parent" };
  }
  return { ref: "HEAD^", reason: "working tree is clean" };
}

export function readFileAtRef(root, ref, file) {
  if (!ref) {
    return undefined;
  }
  const result = git(root, ["show", `${ref}:${file}`]);
  return result.status === 0 ? result.stdout : undefined;
}

export function makeRefResolver(root) {
  return (ref) => {
    if (ref.kind === "commit") {
      const result = git(root, ["cat-file", "-e", `${ref.value}^{commit}`]);
      return result.status === 0 ? "resolved" : "is not a commit in this checkout";
    }
    if (ref.kind === "ak") {
      const probe = spawnSync("ak", ["task", "show", ref.value], { cwd: root, encoding: "utf8" });
      if (probe.error) {
        return "cannot be resolved here (ak unavailable)";
      }
      return probe.status === 0 ? "resolved" : "is not a known AK task";
    }
    return "is neither a commit nor an AK task reference";
  };
}

export function runPassportCheck(root) {
  const generator = path.join(root, "scripts", "generate-capability-passport.mjs");
  const committedPath = path.join(root, "governance", "capability-passport.json");
  if (!existsSync(committedPath) && !existsSync(generator)) {
    return { skipped: "no passport in this tree" };
  }
  if (!existsSync(generator)) {
    return {
      failure:
        "governance/capability-passport.json exists but scripts/generate-capability-passport.mjs is missing",
    };
  }
  if (!existsSync(committedPath)) {
    return {
      failure:
        "scripts/generate-capability-passport.mjs exists but governance/capability-passport.json is missing; run npm run capability:passport",
    };
  }
  if (!existsSync(path.join(root, "dist", "core", "capabilities.js"))) {
    return {
      failure:
        "passport check needs the built runtime (dist/core/capabilities.js); run npm run build first",
    };
  }
  const generated = spawnSync(process.execPath, [generator, "--stdout"], {
    cwd: root,
    encoding: "utf8",
  });
  if (generated.status !== 0) {
    return {
      failure: `passport generator failed: ${(generated.stderr || generated.stdout).trim()}`,
    };
  }
  const failure = evaluatePassport({
    generated: generated.stdout,
    committed: readFileSync(committedPath, "utf8"),
  });
  return failure ? { failure } : {};
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    base: process.env.STRUCTURE_BASE || process.env.COVERAGE_BASE || undefined,
    passport: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = path.resolve(argv[++index]);
    } else if (arg === "--base") {
      options.base = argv[++index];
    } else if (arg === "--no-passport") {
      options.passport = false;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const started = Date.now();
  const options = parseArgs(argv);
  const root = options.root;
  const budgetPath = path.join(root, DEFAULT_BUDGET_FILE);
  if (!existsSync(budgetPath)) {
    console.error(`structure: ${DEFAULT_BUDGET_FILE} is missing at ${root}`);
    return 1;
  }
  let budget;
  try {
    budget = JSON.parse(readFileSync(budgetPath, "utf8"));
  } catch (error) {
    console.error(`structure: ${DEFAULT_BUDGET_FILE} is not valid JSON: ${error.message}`);
    return 1;
  }
  if (budget.schema_version !== 1) {
    console.error(`structure: unsupported schema_version ${budget.schema_version} (expected 1)`);
    return 1;
  }

  const files = listSourceModules(root);
  if (files.size === 0) {
    console.error("structure: no src/**/*.ts modules found");
    return 1;
  }
  const roots = [...new Set(["src/index.ts", ...binRoots(root)])];
  const result = evaluateStructure({ files, budget, roots });
  const failures = [...result.failures];
  const warnings = [...result.warnings];

  let base;
  try {
    base = resolveComparisonBase(root, options.base);
  } catch (error) {
    failures.push(error.message);
    base = { ref: undefined, reason: "unresolvable" };
  }
  const baseBudgetText = readFileAtRef(root, base.ref, DEFAULT_BUDGET_FILE);
  let baseBudget;
  if (baseBudgetText !== undefined) {
    try {
      baseBudget = JSON.parse(baseBudgetText);
    } catch {
      warnings.push(
        `${DEFAULT_BUDGET_FILE} at ${base.ref} is not valid JSON; treating every exception as new`,
      );
    }
  }
  const ledger = evaluateBudgetLedger({
    base: baseBudget,
    current: budget,
    resolveRef: makeRefResolver(root),
  });
  failures.push(...ledger.failures);
  warnings.push(...ledger.warnings);

  let passportLine = "passport: skipped (--no-passport)";
  if (options.passport) {
    const passport = runPassportCheck(root);
    if (passport.failure) {
      failures.push(passport.failure);
      passportLine = "passport: FAIL";
    } else if (passport.skipped) {
      passportLine = `passport: skipped (${passport.skipped})`;
    } else {
      passportLine = "passport: byte-identical to the generator output";
    }
  }

  console.log(
    `structure: ${result.facts.modules} modules, ${result.facts.runtimeEdges} runtime edges, ${result.facts.cycles.length} cycle(s), roots ${roots.join(", ")}`,
  );
  console.log(
    `structure: budget ${budget.default_max_lines ?? 700} lines, exceptions ${Object.keys(budget.exceptions ?? {}).length}, allowed cycles ${(budget.allowed_cycles ?? []).length}, pure ring ${(budget.pure_ring ?? []).length}`,
  );
  if (result.facts.unreachableTypeOnly.length > 0) {
    console.log(
      `structure: type-only modules exempt from never-imported: ${result.facts.unreachableTypeOnly.join(", ")}`,
    );
  }
  console.log(`structure: ledger compared to ${base.ref ?? "(nothing)"} (${base.reason})`);
  console.log(`structure: ${passportLine}`);
  for (const warning of warnings) {
    console.warn(`structure: warning: ${warning}`);
  }
  for (const failure of failures) {
    console.error(`structure: FAIL: ${failure}`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(2);
  if (failures.length > 0) {
    console.error(`structure: ${failures.length} failure(s) in ${seconds}s`);
    return 1;
  }
  console.log(`structure: ok in ${seconds}s`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
