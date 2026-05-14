import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { resolveBombadilBinaryResolution } from "../bombadil-runtime.js";
import { resolveSurfRuntimeResolution } from "../surf-runtime.js";
import { loadConfig } from "./config-overrides.js";
import type {
  DoctorCheck,
  DoctorOperationInput,
  DoctorOperationResultEnvelope,
  OperationDefinition,
} from "./types.js";

export const DoctorOperationInputSchema = z.object({
  json: z.boolean().optional().default(false),
  config: z.string().optional(),
  target: z.string().optional(),
});

type NormalizedDoctorOperationInput = z.output<typeof DoctorOperationInputSchema>;

function resolvePackageRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TEST_CAPABILITIES_PACKAGE_ROOT) {
    return path.resolve(env.TEST_CAPABILITIES_PACKAGE_ROOT);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function readPackageJson(packageRoot: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

function hasExecutableOnPath(binaryName: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const pathValue = env.PATH ?? "";
  const pathExts =
    process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];

  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) {
      continue;
    }

    for (const ext of pathExts) {
      if (existsSync(path.join(entry, `${binaryName}${ext}`))) {
        return true;
      }
    }
  }

  return false;
}

function parseCommandExecutable(commandLine: string): string | undefined {
  const trimmed = commandLine.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function isUrlTarget(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveTargetExecutable(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (path.isAbsolute(executable) || executable.startsWith(".") || executable.includes(path.sep)) {
    return existsSync(path.resolve(executable));
  }

  return hasExecutableOnPath(executable, env);
}

function pass(id: string, label: string, detail: string, required = true): DoctorCheck {
  return { id, label, status: "pass", required, detail };
}

function warn(id: string, label: string, detail: string): DoctorCheck {
  return { id, label, status: "warn", required: false, detail };
}

function fail(id: string, label: string, detail: string, required = true): DoctorCheck {
  return { id, label, status: "fail", required, detail };
}

function checkNodeVersion(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return major >= 22
    ? pass("node.version", "Node.js runtime", `Node ${process.version}`)
    : fail("node.version", "Node.js runtime", `Node >=22 required; got ${process.version}`);
}

function checkPackageMetadata(packageRoot: string): DoctorCheck[] {
  const packageJson = readPackageJson(packageRoot);
  if (!packageJson) {
    return [fail("package.metadata", "Package metadata", `Missing package.json at ${packageRoot}`)];
  }

  const checks: DoctorCheck[] = [];
  checks.push(
    packageJson.name === "test-capabilities"
      ? pass("package.name", "Package name", "package.json name is test-capabilities")
      : fail("package.name", "Package name", `Expected test-capabilities; got ${packageJson.name}`),
  );
  checks.push(
    typeof packageJson.version === "string" &&
      /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageJson.version)
      ? pass("package.version", "Package version", `package version is ${packageJson.version}`)
      : fail(
          "package.version",
          "Package version",
          `Expected semver-like version; got ${String(packageJson.version)}`,
        ),
  );
  checks.push(
    packageJson.private === true
      ? fail("package.public", "Public package flag", "package.json must not set private: true")
      : pass("package.public", "Public package flag", "package is publishable"),
  );
  checks.push(
    existsSync(path.join(packageRoot, "LICENSE"))
      ? pass("package.license", "License file", "LICENSE is present")
      : fail("package.license", "License file", "LICENSE is required"),
  );
  checks.push(
    existsSync(path.join(packageRoot, "README.md"))
      ? pass("package.readme", "README", "README.md is present")
      : fail("package.readme", "README", "README.md is required"),
  );

  return checks;
}

function checkRuntimeFiles(packageRoot: string): DoctorCheck[] {
  return [
    existsSync(path.join(packageRoot, "dist", "index.js"))
      ? pass("runtime.dist", "Runtime entrypoint", "dist/index.js is present")
      : fail("runtime.dist", "Runtime entrypoint", "Run npm run build before using the CLI"),
    existsSync(path.join(packageRoot, "bin", "test-capabilities"))
      ? pass("runtime.cli", "CLI entrypoint", "bin/test-capabilities is present")
      : fail("runtime.cli", "CLI entrypoint", "bin/test-capabilities is required"),
    existsSync(path.join(packageRoot, "test-capabilities.yaml"))
      ? pass("runtime.sample_config", "Sample config", "test-capabilities.yaml is present")
      : fail("runtime.sample_config", "Sample config", "test-capabilities.yaml is required"),
  ];
}

function checkConfigShape(input: NormalizedDoctorOperationInput, packageRoot: string): DoctorCheck {
  const configPath = path.resolve(input.config ?? path.join(packageRoot, "test-capabilities.yaml"));
  const label = input.config ? "User config" : "Packaged sample config";

  try {
    const config = loadConfig(configPath);
    const enabledAgents = Object.values(config.agents ?? {}).filter(
      (agent) => agent.enabled,
    ).length;
    return pass(
      "config.shape",
      label,
      `${configPath} parses as test-capabilities config with ${enabledAgents} enabled agent(s)`,
    );
  } catch (error) {
    return fail("config.shape", label, error instanceof Error ? error.message : String(error));
  }
}

function checkTargetExecutable(input: NormalizedDoctorOperationInput): DoctorCheck | undefined {
  if (!input.target) {
    return undefined;
  }

  if (isUrlTarget(input.target)) {
    return pass("target.web", "Target URL", `${input.target} is a valid web target`);
  }

  const executable = parseCommandExecutable(input.target);
  if (!executable) {
    return fail("target.cli", "CLI target", "Target command is empty");
  }

  return resolveTargetExecutable(executable)
    ? pass("target.cli", "CLI target", `resolved executable '${executable}' without running it`)
    : fail(
        "target.cli",
        "CLI target",
        `could not resolve executable '${executable}' on PATH or as a file path`,
      );
}

function checkOptionalSurf(env: NodeJS.ProcessEnv = process.env): DoctorCheck {
  try {
    const resolution = resolveSurfRuntimeResolution(env);
    const commandAvailable = path.isAbsolute(resolution.command)
      ? existsSync(resolution.command)
      : resolution.command === "go"
        ? hasExecutableOnPath("go", env)
        : hasExecutableOnPath(resolution.command, env);

    if (commandAvailable) {
      return pass(
        "external.surf_go",
        "Optional Surf Go runtime",
        `resolved via ${resolution.provider}: ${[resolution.command, ...resolution.baseArgs].join(" ")}`,
        false,
      );
    }
  } catch (error) {
    return warn(
      "external.surf_go",
      "Optional Surf Go runtime",
      error instanceof Error ? error.message : String(error),
    );
  }

  return warn(
    "external.surf_go",
    "Optional Surf Go runtime",
    "not found; surf-backed browser exploration will require TEST_CAPABILITIES_SURF_GO_BIN, TEST_CAPABILITIES_SURF_GO_REPO, or surf-go on PATH",
  );
}

function checkOptionalBombadil(env: NodeJS.ProcessEnv = process.env): DoctorCheck {
  const resolution = resolveBombadilBinaryResolution(env);
  const available = path.isAbsolute(resolution.binaryPath)
    ? existsSync(resolution.binaryPath)
    : hasExecutableOnPath(resolution.binaryPath, env);

  if (available) {
    return pass(
      "external.bombadil",
      "Optional Bombadil runtime",
      `resolved via ${resolution.provider}: ${resolution.binaryPath}`,
      false,
    );
  }

  return warn(
    "external.bombadil",
    "Optional Bombadil runtime",
    "not found; Bombadil-backed web exploration will require TEST_CAPABILITIES_BOMBADIL_BIN, TEST_CAPABILITIES_BOMBADIL_REPO, or bombadil on PATH",
  );
}

async function runDoctorOperation(
  normalized: NormalizedDoctorOperationInput,
): Promise<DoctorOperationResultEnvelope> {
  const packageRoot = resolvePackageRoot();
  const targetCheck = checkTargetExecutable(normalized);
  const checks = [
    checkNodeVersion(),
    ...checkPackageMetadata(packageRoot),
    ...checkRuntimeFiles(packageRoot),
    checkConfigShape(normalized, packageRoot),
    ...(targetCheck ? [targetCheck] : []),
    checkOptionalSurf(),
    checkOptionalBombadil(),
  ];
  const requiredFailed = checks.filter((check) => check.required && check.status === "fail");
  const optionalWarnings = checks.filter((check) => !check.required && check.status === "warn");

  return {
    operationId: "doctor",
    input: normalized,
    packageRoot,
    status: requiredFailed.length === 0 ? "pass" : "fail",
    summary: {
      requiredPassed: checks.filter((check) => check.required && check.status === "pass").length,
      requiredFailed: requiredFailed.length,
      optionalWarnings: optionalWarnings.length,
    },
    checks,
  };
}

export const DOCTOR_OPERATION = {
  id: "doctor",
  route: { command: "doctor" },
  description: "Run zero-external-dependency package and environment diagnostics",
  inputSchema: DoctorOperationInputSchema,
  execute: runDoctorOperation,
} satisfies OperationDefinition<NormalizedDoctorOperationInput, DoctorOperationResultEnvelope>;

export async function executeDoctorOperation(
  input: DoctorOperationInput,
): Promise<DoctorOperationResultEnvelope> {
  return runDoctorOperation(DoctorOperationInputSchema.parse(input));
}
