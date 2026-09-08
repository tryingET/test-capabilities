import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname;
const srcRoot = path.join(repoRoot, "src");

/** The one module allowed to start a process. */
const TRANSPORT = "src/core/spawn-step.ts";

// A bare call, never a method call (`pattern.exec(...)` is a regexp, not a process).
const PROCESS_CALL = /(?<![.\w$])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/;
const CHILD_PROCESS_IMPORT = /from\s+"node:child_process"|require\(\s*"node:child_process"\s*\)/;

function listSourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...listSourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

test("only the kernel spawn transport imports node:child_process", () => {
  const offenders = listSourceFiles(srcRoot)
    .filter((file) => CHILD_PROCESS_IMPORT.test(readFileSync(file, "utf8")))
    .map(relative);

  assert.deepEqual(
    offenders,
    [TRANSPORT],
    `node:child_process must be imported by ${TRANSPORT} only; every other caller goes through Adapter.invoke`,
  );
});

test("no module outside the spawn transport calls a process-starting function", () => {
  const offenders = [];
  for (const file of listSourceFiles(srcRoot)) {
    const name = relative(file);
    if (name === TRANSPORT) {
      continue;
    }
    // Comments are prose about processes, not processes.
    const lines = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""));
    for (const [index, line] of lines.entries()) {
      if (PROCESS_CALL.test(line)) {
        offenders.push(`${name}:${index + 1}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a process may only be started by src/core/spawn-step.ts; route the call through the adapter's invoke",
  );
});

test("the spawn transport is reachable from the adapters and from nothing else", () => {
  const importers = listSourceFiles(srcRoot)
    .filter((file) => /from\s+"\.[^"]*spawn-step\.js"/.test(readFileSync(file, "utf8")))
    .map(relative)
    .sort();

  assert.deepEqual(importers, [
    "src/core/bombadil-runtime.ts",
    "src/core/cli-adapter.ts",
    "src/core/surf-adapter.ts",
  ]);
});

/** Source with comments and string bodies blanked, so offsets stay but text cannot lie. */
function maskLiterals(source) {
  let masked = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  masked = masked.replace(/\/\/[^\n]*/g, (line) => line.replace(/[^\n]/g, " "));
  return masked.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, (literal) =>
    literal.replace(/[^\n]/g, " "),
  );
}

/** The half-open range of the call whose opening parenthesis is at `open`. */
function callSpan(masked, open) {
  let depth = 0;
  for (let index = open; index < masked.length; index += 1) {
    if (masked[index] === "(") {
      depth += 1;
    } else if (masked[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return [open, index];
      }
    }
  }
  return [open, masked.length];
}

test("a mutating runtime is only ever entered from inside ledger.runStep", () => {
  // The two runtimes whose steps change a target. `Adapter.invoke` is reachable from many
  // read-only callers; what the mutation-safety packet forbids (review A7, adjudication claim 2)
  // is a *mutating* invocation that no ledger step opened a receipt for.
  const mutatingEntries = /\b(runBombadil|runBombadilTerminalTest)\s*\(/g;
  const definitionSite = "src/core/bombadil-runtime.ts";
  const offenders = [];

  for (const file of listSourceFiles(srcRoot)) {
    const name = relative(file);
    if (name === definitionSite) {
      continue;
    }
    const masked = maskLiterals(readFileSync(file, "utf8"));
    const ledgerSpans = [];
    const runStepCalls = /\bledger\.runStep\s*(?:<[^>]*>\s*)?\(/g;
    for (const match of masked.matchAll(runStepCalls)) {
      ledgerSpans.push(callSpan(masked, match.index + match[0].length - 1));
    }
    for (const match of masked.matchAll(mutatingEntries)) {
      const inside = ledgerSpans.some(([open, close]) => match.index > open && match.index < close);
      if (!inside) {
        offenders.push(`${name}:${masked.slice(0, match.index).split("\n").length}: ${match[1]}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a mutating runtime must be entered from inside context.ledger.runStep, so the receipt is on disk before the act",
  );
});

test("the ledger is the only module that opens a mutation receipt", () => {
  const offenders = listSourceFiles(srcRoot)
    .filter((file) => /receiptStore\.append\s*\(/.test(maskLiterals(readFileSync(file, "utf8"))))
    .map(relative);

  assert.deepEqual(offenders, ["src/core/effects.ts"]);
});
