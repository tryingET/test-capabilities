import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { probeCdpBrowser, resolveCdpEndpoint } from "../a11y-cdp.js";
import { resolveBombadilBinaryResolution } from "../bombadil-runtime.js";
import type { EffectDeclaration } from "../effects.js";
import type { MutationReceipt } from "../receipt-store.js";
import type { RunContext } from "../run-context.js";
import { finalizeEnvelope, mintOperationContext } from "../run-context.js";
import { probeSurfRuntime, runSurfCommand } from "../surf-adapter.js";
import {
  describeSurfRuntime,
  resolveSurfRuntimeResolution,
  SURF_MECHANISM_COMMANDS,
  type SurfCommandResult,
} from "../surf-runtime.js";
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

type SurfDoctorSummary = {
  browser: string;
  ok: boolean;
  socketPath?: string;
  manifests: string[];
  failures: string[];
  warnings: string[];
  recommendations: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function summarizeSurfDoctor(browser: string, run: SurfCommandResult): SurfDoctorSummary {
  let payload: unknown;
  try {
    payload = JSON.parse(run.stdout);
  } catch {
    payload = undefined;
  }

  if (!isRecord(payload)) {
    return {
      browser,
      ok: false,
      manifests: [],
      failures: [
        run.failure
          ? `${run.failure.message} [${run.failure.code}]`
          : "surf doctor did not print machine-readable JSON",
      ],
      warnings: [],
      recommendations: [],
    };
  }

  const checks = Array.isArray(payload.checks) ? payload.checks.filter(isRecord) : [];
  const messagesWithStatus = (status: string) =>
    checks
      .filter((check) => check.status === status && typeof check.message === "string")
      .map((check) => check.message as string);
  const environment = isRecord(payload.environment) ? payload.environment : {};
  const manifests = Array.isArray(payload.manifests)
    ? payload.manifests
        .filter(isRecord)
        .map((manifest) => manifest.path)
        .filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    browser,
    ok: payload.ok === true,
    socketPath: typeof environment.socketPath === "string" ? environment.socketPath : undefined,
    manifests,
    failures: messagesWithStatus("fail"),
    warnings: messagesWithStatus("warn"),
    recommendations: stringsOf(payload.recommendations),
  };
}

function checkOptionalSurf(env: NodeJS.ProcessEnv = process.env): DoctorCheck {
  const id = "external.surf";
  const label = "Optional surf CLI runtime";

  let resolution: ReturnType<typeof resolveSurfRuntimeResolution>;
  try {
    resolution = resolveSurfRuntimeResolution(env);
  } catch (error) {
    return warn(id, label, error instanceof Error ? error.message : String(error));
  }

  let probe: ReturnType<typeof probeSurfRuntime>;
  try {
    probe = probeSurfRuntime(resolution, { env });
  } catch (error) {
    return warn(id, label, error instanceof Error ? error.message : String(error));
  }

  const browser = env.TEST_CAPABILITIES_SURF_BROWSER?.trim() || "chromium";
  const doctorRun = runSurfCommand(resolution, ["doctor", "--browser", browser, "--json"], {
    timeoutMs: 15_000,
    env,
  });
  const doctor = summarizeSurfDoctor(browser, doctorRun);

  const mechanismSummary = Object.entries(SURF_MECHANISM_COMMANDS)
    .map(
      ([key, command]) =>
        `${command}${probe.mechanisms[key as keyof typeof SURF_MECHANISM_COMMANDS] ? "" : " (missing)"}`,
    )
    .join(", ");
  const doctorSummary = doctor.ok
    ? `ok (socket ${doctor.socketPath ?? "unknown"}; manifest ${doctor.manifests.join(", ") || "unknown"})`
    : `${doctor.failures.length} issue(s): ${doctor.failures.join("; ") || "no detail"}`;
  const detail = `${describeSurfRuntime(resolution, probe)}; mechanisms: ${mechanismSummary}; surf doctor --browser ${browser}: ${doctorSummary}`;
  const data = {
    command: resolution.command,
    provider: resolution.provider,
    version: probe.version ?? null,
    mechanisms: probe.mechanisms,
    missingExploreMechanisms: probe.missingExploreMechanisms,
    doctor,
  };

  if (probe.missingExploreMechanisms.length === 0 && doctor.ok) {
    return { ...pass(id, label, detail, false), data };
  }

  const reasons = [
    ...(probe.missingExploreMechanisms.length > 0
      ? [
          `surf explore needs ${probe.missingExploreMechanisms.join(" and ")} (upstream build without the site-independent mechanisms branch)`,
        ]
      : []),
    ...(doctor.ok
      ? []
      : [
          "the surf native host/socket is not reachable; start the browser with the surf extension",
        ]),
  ];
  return { ...warn(id, label, `${detail}; ${reasons.join("; ")}`), data };
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

/**
 * The a11y observation channel as an optional external, next to `external.surf` (a11y-snapshot
 * packet, "Placement"; producer chosen by the measured series of AK #5915).
 *
 * The channel reads Chromium's accessibility tree over the loopback DevTools endpoint, so the
 * question is whether that endpoint answers as Chromium. A warning, never a failure - the channel
 * is off by default - but the detail names the refusal an `--a11y-snapshot=required` run would
 * get, so `doctor` answers before the run asks.
 */
async function checkOptionalA11yChannel(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DoctorCheck> {
  const id = "external.a11y_channel";
  const label = "Optional a11y snapshot channel (Chromium accessibility tree over CDP)";
  let endpoint: string;
  try {
    endpoint = resolveCdpEndpoint(env);
  } catch (error) {
    return warn(id, label, errorMessage(error));
  }
  try {
    const browser = await probeCdpBrowser(endpoint);
    return { ...pass(id, label, `${browser} at ${endpoint}`, false), data: { endpoint, browser } };
  } catch (error) {
    return { ...warn(id, label, errorMessage(error)), data: { endpoint, browser: null } };
  }
}

/**
 * What the interlock looks like from here: where the receipts live, whether that store survives
 * the run, and how many receipts are still in doubt. A receipt in doubt is not an error - it is
 * a mutating attempt nobody has resolved, and it will refuse its key's next run until an
 * operator inspects the subject and supersedes it (mutation-safety packet, risks table).
 */
async function checkReceiptStore(context: RunContext): Promise<DoctorCheck> {
  const id = "runtime.receipts";
  const label = "Mutation receipt store";
  const settings = context.config.receipts;
  const where = `${settings.dir} (${settings.source})`;

  let inDoubt: MutationReceipt[];
  try {
    inDoubt = await context.receiptStore.list({ inDoubt: true });
  } catch (error) {
    return warn(id, label, `${where}: could not be read: ${errorMessage(error)}`);
  }

  const data = {
    dir: settings.dir,
    source: settings.source,
    ephemeralAccepted: settings.ephemeral,
    ephemeralDetected: settings.ephemeralDetected ?? null,
    inDoubt: inDoubt.length,
    receipts: inDoubt.map((receipt) => ({
      receipt_id: receipt.receipt_id,
      outcome: receipt.outcome,
      subject: receipt.subject,
    })),
  };

  if (settings.ephemeralDetected !== undefined && !settings.ephemeral) {
    return {
      ...warn(
        id,
        label,
        `${where}: ${settings.ephemeralDetected}, so a mutating operation refuses with mutation_receipts_ephemeral. Point receipts.dir at a durable directory, or set receipts.ephemeral: true to accept it`,
      ),
      data,
    };
  }

  if (inDoubt.length > 0) {
    const first = inDoubt[0] as MutationReceipt;
    return {
      ...warn(
        id,
        label,
        `${where}: ${inDoubt.length} receipt(s) still in doubt; the first is ${first.receipt_id} (${first.outcome}) on ${first.subject}. Inspect the subject, then re-run with --supersede-receipt ${first.receipt_id}`,
      ),
      data,
    };
  }

  return {
    ...pass(
      id,
      label,
      `${where}: 0 receipts in doubt${settings.ephemeral ? "; declared ephemeral" : ""}`,
      false,
    ),
    data,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runDoctorOperation(
  normalized: NormalizedDoctorOperationInput,
  context: RunContext,
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
    await checkOptionalA11yChannel(),
    await checkReceiptStore(context),
  ];
  const requiredFailed = checks.filter((check) => check.required && check.status === "fail");
  const optionalWarnings = checks.filter((check) => !check.required && check.status === "warn");

  return finalizeEnvelope(
    {
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
    },
    context,
    DOCTOR_OPERATION_EFFECT,
  );
}

/** Doctor resolves binaries, reads package files and asks `surf doctor`; it changes nothing. */
export const DOCTOR_OPERATION_EFFECT: EffectDeclaration = {
  effect: "read_only",
  reason: "resolves binaries and reads package files; the only command it runs is `surf doctor`",
};

export const DOCTOR_OPERATION = {
  id: "doctor",
  effect: DOCTOR_OPERATION_EFFECT,
  route: { command: "doctor" },
  description: "Run zero-external-dependency package and environment diagnostics",
  inputSchema: DoctorOperationInputSchema,
  execute: runDoctorOperation,
} satisfies OperationDefinition<NormalizedDoctorOperationInput, DoctorOperationResultEnvelope>;

export async function executeDoctorOperation(
  input: DoctorOperationInput,
  context?: RunContext,
): Promise<DoctorOperationResultEnvelope> {
  const normalized = DoctorOperationInputSchema.parse(input);
  return runDoctorOperation(
    normalized,
    context ?? mintOperationContext("doctor", DOCTOR_OPERATION_EFFECT, normalized),
  );
}
