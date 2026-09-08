#!/usr/bin/env node
/**
 * Contract sync for test-capabilities (quality ratchet, part 2).
 *
 * The ratchet's coverage floors and the structure budget forbid regression in
 * what the code *does*. This stage forbids drift between what the code does and
 * what the repo *claims* it does, where the claim is a hand-maintained copy of a
 * generated truth (quality-ratchet packet, School 5; architecture review A20).
 *
 * Checks, all reported together so one run names every drift:
 *   1. commands: the commander command set of `bin/test-capabilities --help`
 *      equals the command set of `CLI_ROUTE_MANIFEST`;
 *   2. statuses: the surface/status table under "Runtime capability summary" in
 *      `docs/api/cli.md` equals the manifest's surfaces and their statuses;
 *   3. help capture: `docs/api/cli-help.generated.md` is byte-equal to the help
 *      text every command prints today;
 *   4. exports: `docs/api/exports.generated.md` is byte-equal to the public
 *      surface `src/index.ts` re-exports (values and types);
 *   5. unions: the `CliRoute` and `CliOperationResult` unions rendered in
 *      `docs/api/types.md` have the same members as
 *      `src/core/operations/types.ts` (review A20);
 *   6. schemas: every file under `schemas/` names itself consistently and the
 *      request schema's object properties equal the zod schema the runtime
 *      parses with;
 *   7. config mirror: `RuntimeConfigLike` is still derived from the config
 *      schema rather than hand-mirrored (adjudication claim 49).
 *
 * The passport byte check lives in `check-structure.mjs`: it is cheap enough for
 * pre-commit, which this stage is not (it spawns the CLI once per command).
 *
 * `--write` regenerates the two generated files; it is the fix path a red names.
 *
 * Schema equivalence is structural rather than generated: `zod-to-json-schema`
 * would have to reproduce the committed `$defs`/`required` shape byte-for-byte
 * to be usable as the generator, and it does not - the published schema is
 * deliberately stricter about `required` than the accepting zod parser (a
 * producer must send `candidateChangeRef` and `impactScope`; the runtime accepts
 * a request without them). What must never drift is the property set and the
 * closedness, so that is what is compared, and no dependency is added.
 *
 * Pure functions are exported for `tests/quality_ratchet_contract.test.mjs`; the
 * CLI entry point runs only when this file is the main module.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const CLI_HELP_DOC = "docs/api/cli-help.generated.md";
export const EXPORTS_DOC = "docs/api/exports.generated.md";
export const CLI_DOC = "docs/api/cli.md";
export const TYPES_DOC = "docs/api/types.md";
export const STATUS_TABLE_HEADING = "## Runtime capability summary";
export const SYNCED_UNIONS = ["CliRoute", "CliOperationResult"];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** The command names commander prints under `Commands:`, minus its own `help`. */
export function parseCommanderCommands(helpText) {
  const lines = helpText.split("\n");
  const start = lines.findIndex((line) => line.trim() === "Commands:");
  if (start === -1) {
    return [];
  }
  const commands = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      break;
    }
    const match = /^\s{2}(\S+)/.exec(line);
    if (!match) {
      continue;
    }
    if (match[1] === "help") {
      continue;
    }
    commands.push(match[1]);
  }
  return commands;
}

/** The surfaces the route manifest declares, as `command` or `command action`. */
export function manifestSurfaces(manifest) {
  const surfaces = new Map();
  for (const entry of manifest) {
    if (
      entry.action === undefined &&
      manifest.some((other) => other.command === entry.command && other.action !== undefined)
    ) {
      // The parent command of an action family is a container, not a surface.
      continue;
    }
    const name = entry.action === undefined ? entry.command : `${entry.command} ${entry.action}`;
    surfaces.set(name, entry.status);
  }
  return surfaces;
}

/** The `| surface | status |` rows of the named markdown section. */
export function parseStatusTable(markdown, heading = STATUS_TABLE_HEADING) {
  const start = markdown.indexOf(heading);
  if (start === -1) {
    return undefined;
  }
  const section = markdown.slice(start + heading.length).split(/^## /m)[0] ?? "";
  const rows = new Map();
  for (const line of section.split("\n")) {
    const match = /^\|\s*`([^`]+)`\s*\|\s*([A-Za-z_]+)\s*\|/.exec(line.trim());
    if (match) {
      rows.set(match[1], match[2]);
    }
  }
  return rows;
}

/** Set difference reported as one failure line per side, or nothing. */
export function compareSets(label, expected, actual, fix) {
  const missing = [...expected].filter((name) => !actual.has(name));
  const extra = [...actual].filter((name) => !expected.has(name));
  const failures = [];
  if (missing.length > 0) {
    failures.push(`${label}: missing ${missing.join(", ")} (${fix})`);
  }
  if (extra.length > 0) {
    failures.push(`${label}: unknown ${extra.join(", ")} (${fix})`);
  }
  return failures;
}

/** The member lines of a TypeScript union declaration, normalised to one line each. */
export function parseUnionMembers(source, name) {
  const declaration = new RegExp(`(?:export )?type ${name} =([\\s\\S]*?);\\n`, "m").exec(source);
  if (!declaration) {
    return undefined;
  }
  return declaration[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.replace(/^\|\s*/, ""))
    .map((line) => line.replace(/\s+/g, " ").replace(/;\s*}/, " }").replace(/,$/, ""))
    .filter((line) => line !== "");
}

/** The same union as it is rendered in a markdown ```typescript block. */
export function parseDocUnion(markdown, name) {
  const heading = markdown.indexOf(`### \`${name}\``);
  if (heading === -1) {
    return undefined;
  }
  const block = /```typescript\n([\s\S]*?)```/.exec(markdown.slice(heading));
  if (!block) {
    return undefined;
  }
  return parseUnionMembers(`${block[1]}\n`, name);
}

/** Every name `src/index.ts` re-exports, split into value and type exports. */
export function parseBarrelExports(source) {
  const values = new Set();
  const types = new Set();
  const statement = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)";/g;
  let match = statement.exec(source);
  while (match !== null) {
    const typeOnly = match[1] !== undefined;
    for (const raw of match[2].split(",")) {
      const specifier = raw.trim();
      if (specifier === "") {
        continue;
      }
      const [name, , alias] = specifier.split(/\s+/);
      const exported = alias ?? name;
      if (typeOnly || specifier.startsWith("type ")) {
        types.add(alias ?? specifier.replace(/^type\s+/, "").split(/\s+/)[0]);
      } else {
        values.add(exported);
      }
    }
    match = statement.exec(source);
  }
  // Names the barrel declares itself rather than re-exporting (VERSION, the factory).
  const declared = /^export\s+(const|function|class|type|interface)\s+([A-Za-z0-9_$]+)/gm;
  let local = declared.exec(source);
  while (local !== null) {
    if (local[1] === "type" || local[1] === "interface") {
      types.add(local[2]);
    } else {
      values.add(local[2]);
    }
    local = declared.exec(source);
  }
  return { values: [...values].sort(), types: [...types].sort() };
}

const GENERATED_NOTE =
  "Generated by `node scripts/quality/check-contract-sync.mjs --write`; the contract-sync stage of the quality gate fails when it drifts. Do not edit by hand.";

/** The committed rendering of the public export surface. */
export function renderExportsDoc(exports) {
  const lines = [
    "---",
    'summary: "Generated inventory of every name the test-capabilities package exports from src/index.ts, split into runtime values and types."',
    "read_when:",
    '  - "You need the public surface of the package as the build actually exports it."',
    '  - "A contract-sync red says the export list drifted and you want the committed list."',
    'type: "reference"',
    "---",
    "",
    "# Public exports (generated)",
    "",
    GENERATED_NOTE,
    "",
    `## Values (${exports.values.length})`,
    "",
  ];
  for (const name of exports.values) {
    lines.push(`- \`${name}\``);
  }
  lines.push("", `## Types (${exports.types.length})`, "");
  for (const name of exports.types) {
    lines.push(`- \`${name}\``);
  }
  lines.push("");
  return lines.join("\n");
}

/** The committed rendering of every command's `--help`. */
export function renderCliHelpDoc(captures) {
  const lines = [
    "---",
    'summary: "Generated capture of the test-capabilities CLI help text: the root command and every registered subcommand."',
    "read_when:",
    '  - "You need the exact options a command accepts without running it."',
    '  - "A contract-sync red says the help text drifted from the committed capture."',
    'type: "reference"',
    "---",
    "",
    "# CLI help (generated)",
    "",
    GENERATED_NOTE,
    "",
  ];
  for (const capture of captures) {
    lines.push(`## \`${capture.invocation}\``, "", "```text", capture.text.trimEnd(), "```", "");
  }
  return lines.join("\n");
}

/** Unwraps optional/default/effect wrappers to the zod type that carries a shape. */
export function unwrapZod(schema) {
  let current = schema;
  for (let hop = 0; hop < 12 && current; hop += 1) {
    const def = current._def;
    if (!def) {
      return current;
    }
    if (def.innerType) {
      current = def.innerType;
      continue;
    }
    if (def.schema) {
      current = def.schema;
      continue;
    }
    if (def.type && def.typeName === "ZodArray") {
      current = def.type;
      continue;
    }
    return current;
  }
  return current;
}

/** Property names and closedness of one JSON Schema object node. */
export function jsonSchemaObject(node) {
  return {
    properties: new Set(Object.keys(node?.properties ?? {})),
    closed: node?.additionalProperties === false,
    required: new Set(node?.required ?? []),
  };
}

/** Property names and closedness of one zod object. */
export function zodObject(schema) {
  const unwrapped = unwrapZod(schema);
  const shape = typeof unwrapped?._def?.shape === "function" ? unwrapped._def.shape() : undefined;
  return {
    properties: new Set(Object.keys(shape ?? {})),
    closed: unwrapped?._def?.unknownKeys === "strict",
  };
}

/** One binding of a JSON Schema node to the zod object the runtime parses with. */
export function compareSchemaNode(label, node, schema) {
  const json = jsonSchemaObject(node);
  const zod = zodObject(schema);
  const failures = compareSets(
    `schema ${label} properties`,
    zod.properties,
    json.properties,
    "the published schema and the zod schema must declare the same keys; edit whichever is behind",
  );
  if (json.closed !== zod.closed) {
    failures.push(
      `schema ${label}: additionalProperties ${json.closed ? "false" : "open"} but the zod object is ${zod.closed ? "strict" : "open"} (a published schema that accepts more than the runtime does is a false contract)`,
    );
  }
  const phantom = [...json.required].filter((key) => !zod.properties.has(key));
  if (phantom.length > 0) {
    failures.push(
      `schema ${label}: required names ${phantom.join(", ")}, which the runtime does not parse`,
    );
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Repository reads
// ---------------------------------------------------------------------------

function read(root, relative) {
  return readFileSync(path.join(root, relative), "utf8");
}

function captureHelp(root, invocation) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "bin", "test-capabilities"), ...invocation, "--help"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    },
  );
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export function captureCliHelp(root, commands) {
  const captures = [{ invocation: "test-capabilities", text: captureHelp(root, []) }];
  for (const command of commands) {
    captures.push({
      invocation: `test-capabilities ${command}`,
      text: captureHelp(root, [command]),
    });
  }
  return captures;
}

async function loadRuntime(root) {
  const manifestUrl = new URL(
    `file://${path.join(root, "dist", "core", "operations", "dispatch-manifest.js")}`,
  );
  const replacementUrl = new URL(
    `file://${path.join(root, "dist", "core", "replacement-validation.js")}`,
  );
  const [manifest, replacement] = await Promise.all([
    import(manifestUrl.href),
    import(replacementUrl.href),
  ]);
  return { manifest: manifest.CLI_ROUTE_MANIFEST, replacement };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function runContractSync(options = {}) {
  const root = options.root ?? path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const write = options.write === true;
  const failures = [];
  const notes = [];

  if (!existsSync(path.join(root, "dist", "core", "operations", "dispatch-manifest.js"))) {
    return {
      failures: ["dist/ is missing; run npm run build before the contract-sync stage"],
      notes,
    };
  }

  const { manifest, replacement } = await loadRuntime(root);

  // 1. commands
  const rootHelp = captureHelp(root, []);
  const commanderCommands = parseCommanderCommands(rootHelp);
  const manifestCommands = new Set(manifest.map((entry) => entry.command));
  failures.push(
    ...compareSets(
      "commands",
      manifestCommands,
      new Set(commanderCommands),
      "register the command in bin/test-capabilities and in CLI_ROUTE_MANIFEST together",
    ),
  );
  notes.push(
    `commands: ${commanderCommands.length} commander commands, ${manifestCommands.size} manifest commands`,
  );

  // 2. statuses
  const surfaces = manifestSurfaces(manifest);
  const table = parseStatusTable(read(root, CLI_DOC));
  if (table === undefined) {
    failures.push(`${CLI_DOC}: no "${STATUS_TABLE_HEADING}" section with a surface/status table`);
  } else {
    failures.push(
      ...compareSets(
        `${CLI_DOC} status table`,
        new Set(surfaces.keys()),
        new Set(table.keys()),
        "the table mirrors CLI_ROUTE_MANIFEST; add or remove the row in the commit that changes the manifest",
      ),
    );
    for (const [surface, status] of surfaces) {
      const documented = table.get(surface);
      if (documented !== undefined && documented !== status) {
        failures.push(
          `${CLI_DOC} status table: \`${surface}\` says ${documented}, the manifest says ${status} (the manifest is the source of truth)`,
        );
      }
    }
    notes.push(`statuses: ${surfaces.size} surfaces compared`);
  }

  // 3. help capture
  const captures = captureCliHelp(root, [...manifestCommands]);
  const renderedHelp = renderCliHelpDoc(captures);
  const helpPath = path.join(root, CLI_HELP_DOC);
  if (write) {
    writeFileSync(helpPath, renderedHelp, "utf8");
    notes.push(`help: wrote ${CLI_HELP_DOC} (${captures.length} captures)`);
  } else if (!existsSync(helpPath)) {
    failures.push(
      `${CLI_HELP_DOC} is missing; run node scripts/quality/check-contract-sync.mjs --write`,
    );
  } else {
    const committed = readFileSync(helpPath, "utf8");
    if (committed !== renderedHelp) {
      failures.push(
        `${CLI_HELP_DOC} is not what the CLI prints today; run node scripts/quality/check-contract-sync.mjs --write and commit it with the option change`,
      );
    } else {
      notes.push(`help: ${captures.length} captures byte-identical`);
    }
  }

  // 4. exports
  const exports = parseBarrelExports(read(root, "src/index.ts"));
  const renderedExports = renderExportsDoc(exports);
  const exportsPath = path.join(root, EXPORTS_DOC);
  if (write) {
    writeFileSync(exportsPath, renderedExports, "utf8");
    notes.push(
      `exports: wrote ${EXPORTS_DOC} (${exports.values.length} values, ${exports.types.length} types)`,
    );
  } else if (!existsSync(exportsPath)) {
    failures.push(
      `${EXPORTS_DOC} is missing; run node scripts/quality/check-contract-sync.mjs --write`,
    );
  } else {
    const committed = readFileSync(exportsPath, "utf8");
    if (committed !== renderedExports) {
      failures.push(
        `${EXPORTS_DOC} is not the surface src/index.ts exports; run node scripts/quality/check-contract-sync.mjs --write and commit it with the export change`,
      );
    } else {
      notes.push(
        `exports: ${exports.values.length} values and ${exports.types.length} types byte-identical`,
      );
    }
  }

  // 5. unions
  const typesSource = read(root, "src/core/operations/types.ts");
  const typesDoc = read(root, TYPES_DOC);
  for (const union of SYNCED_UNIONS) {
    const source = parseUnionMembers(typesSource, union);
    const documented = parseDocUnion(typesDoc, union);
    if (source === undefined) {
      failures.push(`src/core/operations/types.ts: no ${union} union to compare`);
      continue;
    }
    if (documented === undefined) {
      failures.push(`${TYPES_DOC}: no \`${union}\` section with a typescript block`);
      continue;
    }
    const expected = new Set(source.map(normaliseUnionMember));
    const actual = new Set(documented.map(normaliseUnionMember));
    failures.push(
      ...compareSets(
        `${TYPES_DOC} ${union}`,
        expected,
        actual,
        "the doc renders the union in src/core/operations/types.ts; update it in the same commit",
      ),
    );
  }
  notes.push(`unions: ${SYNCED_UNIONS.join(", ")} compared`);

  // 6. schemas
  failures.push(...checkSchemas(root, replacement));
  notes.push("schemas: names and request properties compared to the zod schema");

  // 7. config mirror (adjudication claim 49)
  const configSource = read(root, "src/core/config.ts");
  if (!/RuntimeConfigLike\s*=\s*z\.infer<typeof TestCapabilitiesConfigSchema>/.test(configSource)) {
    failures.push(
      "src/core/config.ts: RuntimeConfigLike is no longer z.infer<typeof TestCapabilitiesConfigSchema>; a hand-mirrored config type is the drift operator decision D4 removed",
    );
  }
  notes.push("config: RuntimeConfigLike derived from the schema");

  return { failures, notes };
}

/** Members differ only by whitespace and quote style between the doc and the source. */
export function normaliseUnionMember(member) {
  return member.replace(/'/g, '"').replace(/\s+/g, " ").trim();
}

/** Schema files name themselves after their version, and match the zod parser. */
export function checkSchemas(root, replacement) {
  const failures = [];
  const files = [
    "testcapabilities.replacement-validation-request.v1.schema.json",
    "testcapabilities.replacement-validation-result.v1.schema.json",
  ];
  for (const file of files) {
    const schemaPath = path.join(root, "schemas", file);
    if (!existsSync(schemaPath)) {
      failures.push(`schemas/${file} is missing`);
      continue;
    }
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const version = file.replace(/\.schema\.json$/, "");
    if (typeof schema.$id !== "string" || !schema.$id.endsWith(`/${file}`)) {
      failures.push(`schemas/${file}: $id ${String(schema.$id)} does not end in its own file name`);
    }
    const versionProperty = schema.properties?.schemaVersion?.const;
    if (versionProperty !== undefined && versionProperty !== version) {
      failures.push(
        `schemas/${file}: schemaVersion const ${String(versionProperty)} does not match the file name ${version}`,
      );
    }
  }

  const requestSchema = JSON.parse(
    readFileSync(
      path.join(root, "schemas", "testcapabilities.replacement-validation-request.v1.schema.json"),
      "utf8",
    ),
  );
  const zodRoot = replacement.ReplacementValidationRequestSchema;
  const shape = zodRoot?._def?.shape?.();
  if (!shape) {
    failures.push(
      "dist/core/replacement-validation.js: ReplacementValidationRequestSchema is not a zod object",
    );
    return failures;
  }
  const bindings = [
    ["request", requestSchema, zodRoot],
    ["request.target", requestSchema.properties?.target, shape.target],
    ["request.impactScope", requestSchema.properties?.impactScope, shape.impactScope],
    ["request.$defs.artifactRef", requestSchema.$defs?.artifactRef, shape.evidenceRefs],
    [
      "request.$defs.depSurgeonCandidateRef",
      requestSchema.$defs?.depSurgeonCandidateRef,
      shape.candidateChangeRef,
    ],
  ];
  for (const [label, node, schema] of bindings) {
    if (node === undefined) {
      failures.push(`schema ${label}: the published schema has no such object node`);
      continue;
    }
    failures.push(...compareSchemaNode(label, node, schema));
  }
  const versionConstants = [
    replacement.REPLACEMENT_VALIDATION_REQUEST_SCHEMA_VERSION,
    replacement.REPLACEMENT_VALIDATION_RESULT_SCHEMA_VERSION,
  ];
  for (const version of versionConstants) {
    if (!existsSync(path.join(root, "schemas", `${version}.schema.json`))) {
      failures.push(`schemas/: no file for the runtime's schema version ${String(version)}`);
    }
  }
  return failures;
}

export async function main(argv = process.argv.slice(2)) {
  const started = Date.now();
  const options = { write: argv.includes("--write") };
  const rootIndex = argv.indexOf("--root");
  if (rootIndex !== -1 && argv[rootIndex + 1]) {
    options.root = path.resolve(argv[rootIndex + 1]);
  }

  const { failures, notes } = await runContractSync(options);
  for (const note of notes) {
    console.log(`contract-sync: ${note}`);
  }
  for (const failure of failures) {
    console.error(`contract-sync: FAIL: ${failure}`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(2);
  if (failures.length > 0) {
    console.error(`contract-sync: ${failures.length} failure(s) in ${seconds}s`);
    return 1;
  }
  console.log(`contract-sync: ok in ${seconds}s`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
