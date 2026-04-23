import { spawnSync } from "node:child_process";

export function renderSpawnFailure(command: string, error: Error): Error {
  return new Error(`Failed to run ${command}: ${error.message}`);
}

export function renderCommandExitFailure(
  command: string,
  code: number | null,
  stdout: string,
  stderr: string,
): Error {
  return new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`);
}

export async function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw renderSpawnFailure(command, result.error as Error);
  }

  const stdout = result.stdout as string;
  const stderr = result.stderr as string;
  const code = result.status as number | null;

  if (code !== 0) {
    throw renderCommandExitFailure(command, code, stdout, stderr);
  }

  return {
    code,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}
