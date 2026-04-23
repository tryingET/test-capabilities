import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [, , inputPath = "coverage/lcov.raw.info", outputPath = "coverage/lcov.info"] = process.argv;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE64_VLQ_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VLQ_VALUES = new Map(
  [...BASE64_VLQ_ALPHABET].map((character, index) => [character, index]),
);

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

function repoRelativePath(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
  return normalizePath(path.relative(rootDir, resolved));
}

function distSuffixPath(filePath) {
  const normalized = repoRelativePath(filePath);
  const distIndex = normalized.lastIndexOf("/dist/");
  if (distIndex >= 0) {
    return normalized.slice(distIndex + 1);
  }
  return normalized.startsWith("dist/") ? normalized : undefined;
}

function candidateSourcePaths(filePath) {
  const distPath = distSuffixPath(filePath);
  if (!distPath) {
    return [];
  }
  const withoutDist = distPath.replace(/^dist\//, "src/");
  const base = withoutDist.replace(/\.(c|m)?js$/u, "");
  return [`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`];
}

function fallbackSourceFile(filePath) {
  const normalized = repoRelativePath(filePath);
  const distPath = distSuffixPath(filePath);
  if (!distPath) {
    return normalized;
  }

  for (const candidate of candidateSourcePaths(filePath)) {
    if (fs.existsSync(path.join(rootDir, candidate))) {
      return candidate;
    }
  }

  return normalized;
}

function decodeBase64Vlq(segment) {
  const values = [];
  let value = 0;
  let shift = 0;

  for (const character of segment) {
    const digit = BASE64_VLQ_VALUES.get(character);
    if (digit === undefined) {
      throw new Error(`Unsupported source-map character: ${character}`);
    }

    const continuation = (digit & 32) !== 0;
    const chunk = digit & 31;
    value += chunk << shift;
    shift += 5;

    if (!continuation) {
      const negative = (value & 1) === 1;
      const decoded = value >> 1;
      values.push(negative ? -decoded : decoded);
      value = 0;
      shift = 0;
    }
  }

  if (shift !== 0) {
    throw new Error(`Incomplete base64 VLQ segment: ${segment}`);
  }

  return values;
}

function parseGeneratedLineMappings(rawMap, mapPath) {
  const sourceEntries = Array.isArray(rawMap.sources) ? rawMap.sources : [];
  const sourceRoot = typeof rawMap.sourceRoot === "string" ? rawMap.sourceRoot : "";
  const resolvedSources = sourceEntries.map((entry) =>
    repoRelativePath(path.resolve(path.dirname(mapPath), sourceRoot, entry)),
  );
  const lineMappings = new Map();
  const generatedLines = typeof rawMap.mappings === "string" ? rawMap.mappings.split(";") : [];

  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;

  for (const [generatedLineIndex, generatedLine] of generatedLines.entries()) {
    let generatedColumn = 0;

    if (!generatedLine) {
      continue;
    }

    for (const segment of generatedLine.split(",")) {
      if (!segment) {
        continue;
      }

      const fields = decodeBase64Vlq(segment);
      generatedColumn += fields[0] ?? 0;

      if (fields.length < 4) {
        continue;
      }

      sourceIndex += fields[1];
      originalLine += fields[2];
      originalColumn += fields[3];
      if (fields.length === 5) {
        nameIndex += fields[4];
      }

      void generatedColumn;
      void originalColumn;
      void nameIndex;

      const sourceFile = resolvedSources[sourceIndex];
      if (!sourceFile) {
        continue;
      }

      const generatedLineNumber = generatedLineIndex + 1;
      let sourceMap = lineMappings.get(generatedLineNumber);
      if (!sourceMap) {
        sourceMap = new Map();
        lineMappings.set(generatedLineNumber, sourceMap);
      }

      let sourceLines = sourceMap.get(sourceFile);
      if (!sourceLines) {
        sourceLines = new Set();
        sourceMap.set(sourceFile, sourceLines);
      }

      sourceLines.add(originalLine + 1);
    }
  }

  return lineMappings;
}

const generatedLineMappingCache = new Map();

function generatedLineMappingsFor(filePath) {
  const normalized = repoRelativePath(filePath);
  if (generatedLineMappingCache.has(normalized)) {
    return generatedLineMappingCache.get(normalized);
  }

  const distPath = distSuffixPath(filePath);
  if (!distPath) {
    generatedLineMappingCache.set(normalized, undefined);
    return undefined;
  }

  const mapPath = path.resolve(rootDir, `${normalized}.map`);
  if (!fs.existsSync(mapPath)) {
    generatedLineMappingCache.set(normalized, undefined);
    return undefined;
  }

  try {
    const rawMap = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    const mappings = parseGeneratedLineMappings(rawMap, mapPath);
    generatedLineMappingCache.set(normalized, mappings);
    return mappings;
  } catch {
    generatedLineMappingCache.set(normalized, undefined);
    return undefined;
  }
}

function parseLcovRecords(lcovText) {
  const records = [];
  let currentSource = "";
  let currentFile;
  let currentLines = [];

  function flush() {
    if (!currentFile) {
      return;
    }

    records.push({
      source: currentSource,
      filePath: currentFile,
      lineHits: currentLines,
    });
    currentFile = undefined;
    currentLines = [];
  }

  for (const rawLine of lcovText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith("TN:")) {
      currentSource = line.slice(3);
      continue;
    }

    if (line.startsWith("SF:")) {
      flush();
      currentFile = line.slice(3).trim();
      continue;
    }

    if (line.startsWith("DA:")) {
      const [lineNumberText, hitsText] = line.slice(3).split(",");
      const lineNumber = Number(lineNumberText);
      const hits = Number(hitsText ?? "0");
      if (Number.isFinite(lineNumber) && lineNumber > 0 && Number.isFinite(hits)) {
        currentLines.push({ lineNumber, hits });
      }
      continue;
    }

    if (line === "end_of_record") {
      flush();
    }
  }

  flush();
  return records;
}

function addLineHits(fileCoverage, filePath, lineNumber, hits) {
  let lineMap = fileCoverage.get(filePath);
  if (!lineMap) {
    lineMap = new Map();
    fileCoverage.set(filePath, lineMap);
  }

  lineMap.set(lineNumber, (lineMap.get(lineNumber) ?? 0) + hits);
}

function remapRecord(record, fileCoverage) {
  const normalizedFilePath = repoRelativePath(record.filePath);
  const lineMappings = generatedLineMappingsFor(normalizedFilePath);

  if (lineMappings) {
    for (const { lineNumber, hits } of record.lineHits) {
      const sourceMap = lineMappings.get(lineNumber);
      if (!sourceMap || sourceMap.size === 0) {
        continue;
      }

      for (const [sourceFile, sourceLines] of sourceMap.entries()) {
        for (const sourceLine of sourceLines) {
          addLineHits(fileCoverage, sourceFile, sourceLine, hits);
        }
      }
    }
    return;
  }

  const fallbackFile = fallbackSourceFile(normalizedFilePath);
  for (const { lineNumber, hits } of record.lineHits) {
    addLineHits(fileCoverage, fallbackFile, lineNumber, hits);
  }
}

function renderLcov(fileCoverage) {
  const sections = [];
  const filePaths = [...fileCoverage.keys()].sort((left, right) => left.localeCompare(right));

  for (const filePath of filePaths) {
    const lineMap = fileCoverage.get(filePath);
    if (!lineMap || lineMap.size === 0) {
      continue;
    }

    sections.push(`SF:${filePath}`);
    const lineNumbers = [...lineMap.keys()].sort((left, right) => left - right);
    for (const lineNumber of lineNumbers) {
      sections.push(`DA:${lineNumber},${lineMap.get(lineNumber) ?? 0}`);
    }
    sections.push("end_of_record");
  }

  return `${sections.join("\n")}\n`;
}

const raw = fs.readFileSync(path.resolve(rootDir, inputPath), "utf8");
const records = parseLcovRecords(raw);
const remappedCoverage = new Map();
for (const record of records) {
  remapRecord(record, remappedCoverage);
}
fs.writeFileSync(path.resolve(rootDir, outputPath), renderLcov(remappedCoverage), "utf8");
