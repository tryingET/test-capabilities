import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function parseLcovLineNumbers(lcovText) {
  return lcovText
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("DA:"))
    .map((line) => Number(line.slice(3).split(",")[0]));
}

test("remap-lcov-to-src remaps generated line hits through source maps instead of only rewriting paths", () => {
  mkdirSync(path.join(repoRoot, "tmp"), { recursive: true });
  const fixtureRoot = mkdtempSync(path.join(repoRoot, "tmp", "ts-quality-remap-"));
  const srcDir = path.join(fixtureRoot, "src");
  const distDir = path.join(fixtureRoot, "dist");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(distDir, { recursive: true });

  const sourceText = [
    "export async function decide(flag: boolean): Promise<string> {",
    "  if (flag) {",
    '    return "yes";',
    "  }",
    '  return "no";',
    "}",
    "",
  ].join("\n");
  const sourcePath = path.join(srcDir, "sample.ts");
  const generatedPath = path.join(distDir, "sample.js");
  const mapPath = `${generatedPath}.map`;
  const rawLcovPath = path.join(fixtureRoot, "lcov.raw.info");
  const remappedLcovPath = path.join(fixtureRoot, "lcov.info");

  writeFileSync(sourcePath, sourceText, "utf8");
  const transpiled = ts.transpileModule(sourceText, {
    fileName: sourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.ES2020,
      sourceMap: true,
      inlineSourceMap: false,
      inlineSources: false,
    },
  });
  const rawSourceMap = JSON.parse(transpiled.sourceMapText);
  rawSourceMap.sources = ["../src/sample.ts"];
  writeFileSync(generatedPath, transpiled.outputText, "utf8");
  writeFileSync(mapPath, `${JSON.stringify(rawSourceMap)}\n`, "utf8");

  const generatedLineCount = transpiled.outputText.split(/\r?\n/u).length - 1;
  const sourceLineCount = sourceText.split(/\r?\n/u).length - 1;
  const rawLcov = [
    `SF:${path.relative(repoRoot, generatedPath).replace(/\\/g, "/")}`,
    ...Array.from({ length: generatedLineCount }, (_, index) => `DA:${index + 1},1`),
    "end_of_record",
    "",
  ].join("\n");
  writeFileSync(rawLcovPath, rawLcov, "utf8");

  const result = spawnSync(
    process.execPath,
    ["./scripts/screening/remap-lcov-to-src.mjs", rawLcovPath, remappedLcovPath],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const remappedLcov = readFileSync(remappedLcovPath, "utf8");
    const remappedSourcePath = path.relative(repoRoot, sourcePath).replace(/\\/g, "/");
    const remappedLineNumbers = parseLcovLineNumbers(remappedLcov);

    assert.match(remappedLcov, new RegExp(`^SF:${remappedSourcePath}$`, "mu"));
    assert.ok(remappedLineNumbers.length > 0);
    assert.equal(
      remappedLineNumbers.some((lineNumber) => lineNumber > sourceLineCount),
      false,
      `expected source-mapped line numbers to stay within ${sourceLineCount} source lines, got ${remappedLineNumbers.join(", ")}`,
    );
    assert.ok(
      generatedLineCount > sourceLineCount,
      `fixture must generate more JS lines (${generatedLineCount}) than TS lines (${sourceLineCount}) to catch path-only remaps`,
    );
    assert.ok(
      remappedLineNumbers.includes(3),
      `expected remapped coverage to include the success return line: ${remappedLineNumbers.join(", ")}`,
    );
    assert.ok(
      remappedLineNumbers.includes(5),
      `expected remapped coverage to include the failure return line: ${remappedLineNumbers.join(", ")}`,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
