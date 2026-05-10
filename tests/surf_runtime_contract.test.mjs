import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { resolveSurfRuntimeCommand, resolveSurfRuntimeResolution, translateSurfArgs } =
  await importRuntimeModule("core/surf-runtime.js");

function withTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-surf-runtime-"));
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function executable(pathname) {
  writeFileSync(pathname, "#!/bin/sh\n", { mode: 0o755 });
}

test("surf runtime translates explore commands for explicit surf-go binaries", () => {
  const tmp = withTempDir();
  try {
    const surfGo = path.join(tmp.dir, "surf-go");
    executable(surfGo);

    const runtime = resolveSurfRuntimeCommand("go", ["https://example.com"], {
      ...process.env,
      TEST_CAPABILITIES_SURF_GO_BIN: surfGo,
    });

    assert.equal(runtime.command, surfGo);
    assert.equal(runtime.flavor, "surf-go");
    assert.equal(runtime.provider, "explicit_go_bin");
    assert.deepEqual(runtime.args, ["navigate", "--url", "https://example.com"]);
  } finally {
    tmp.cleanup();
  }
});

test("surf runtime can target a built softwareco contrib surf-cli-go checkout", () => {
  const tmp = withTempDir();
  try {
    const repo = path.join(tmp.dir, "surf-cli-go");
    const built = path.join(repo, "dist", "go", `${process.platform}-${process.arch}`, "surf-go");
    mkdirSync(path.dirname(built), { recursive: true });
    executable(built);

    const resolution = resolveSurfRuntimeResolution({
      ...process.env,
      TEST_CAPABILITIES_SURF_GO_REPO: repo,
    });

    assert.equal(resolution.command, built);
    assert.equal(resolution.flavor, "surf-go");
    assert.equal(resolution.provider, "explicit_go_repo_build");
    assert.deepEqual(resolution.baseArgs, []);
  } finally {
    tmp.cleanup();
  }
});

test("surf runtime can target a source checkout of softwareco contrib surf-cli-go", () => {
  const tmp = withTempDir();
  try {
    const repo = path.join(tmp.dir, "surf-cli-go");
    mkdirSync(path.join(repo, "go", "cmd", "surf-go"), { recursive: true });
    writeFileSync(path.join(repo, "go", "cmd", "surf-go", "main.go"), "package main\n");

    const runtime = resolveSurfRuntimeCommand("go", ["https://example.com"], {
      ...process.env,
      TEST_CAPABILITIES_SURF_GO_REPO: repo,
    });

    assert.equal(runtime.command, "go");
    assert.equal(runtime.flavor, "surf-go");
    assert.equal(runtime.provider, "explicit_go_repo_source");
    assert.deepEqual(runtime.args, [
      "-C",
      path.join(repo, "go"),
      "run",
      "./cmd/surf-go",
      "navigate",
      "--url",
      "https://example.com",
    ]);
    assert.equal(
      runtime.resolutionNotes.some((note) => /using Surf Go source via 'go -C/.test(note)),
      true,
    );
  } finally {
    tmp.cleanup();
  }
});

test("surf runtime fails closed for invalid explicit Surf Go repo paths", () => {
  const tmp = withTempDir();
  try {
    assert.throws(
      () =>
        resolveSurfRuntimeResolution({
          ...process.env,
          TEST_CAPABILITIES_SURF_GO_REPO: path.join(tmp.dir, "missing"),
        }),
      /TEST_CAPABILITIES_SURF_GO_REPO points to .* but that Surf Go checkout does not exist/,
    );
  } finally {
    tmp.cleanup();
  }
});

test("surf runtime ignores classic surf env vars and binaries", () => {
  const tmp = withTempDir();
  try {
    const classicSurf = path.join(tmp.dir, "surf");
    executable(classicSurf);

    const resolution = resolveSurfRuntimeResolution({
      PATH: tmp.dir,
      TEST_CAPABILITIES_PACKAGE_ROOT: tmp.dir,
      TEST_CAPABILITIES_SURF_BIN: classicSurf,
      TEST_CAPABILITIES_SURF_REPO: path.join(tmp.dir, "classic-repo"),
    });

    assert.equal(resolution.command, "surf-go");
    assert.equal(resolution.flavor, "surf-go");
    assert.equal(resolution.provider, "path_surf_go");
  } finally {
    tmp.cleanup();
  }
});

test("surf-go command translation covers verified SurfClient command shapes", () => {
  assert.deepEqual(translateSurfArgs("go", ["https://example.com"]), [
    "navigate",
    "--url",
    "https://example.com",
  ]);
  assert.deepEqual(translateSurfArgs("read", ["--depth", "3"]), [
    "page",
    "read",
    "--args-json",
    JSON.stringify({ depth: 3 }),
  ]);
  assert.deepEqual(translateSurfArgs("page.text"), ["page", "text"]);
  assert.deepEqual(translateSurfArgs("page.state"), ["page", "state"]);
  assert.deepEqual(translateSurfArgs("network"), ["network", "list", "--args-json", "{}"]);
  assert.deepEqual(translateSurfArgs("console"), ["console", "read", "--args-json", "{}"]);
  assert.deepEqual(translateSurfArgs("tab.reload"), ["reload"]);
  assert.deepEqual(translateSurfArgs("tab.list"), ["tab", "list", "--args-json", "{}"]);
  assert.deepEqual(translateSurfArgs("window.list"), ["window", "list", "--args-json", "{}"]);
  assert.deepEqual(translateSurfArgs("chatgpt", ["say ping"]), ["chatgpt", "say ping"]);
  assert.deepEqual(translateSurfArgs("click", ["--selector", "button.login"]), [
    "click",
    "--args-json",
    JSON.stringify({ selector: "button.login" }),
  ]);
  assert.deepEqual(translateSurfArgs("type", ["hello", "--ref", "e1", "--submit"]), [
    "tool-raw",
    "--tool",
    "click_type_submit",
    "--args-json",
    JSON.stringify({ text: "hello", ref: "e1" }),
  ]);
  assert.deepEqual(translateSurfArgs("scroll.down", ["down", "500"]), [
    "scroll",
    "--args-json",
    JSON.stringify({ scroll_direction: "down", scroll_amount: 5 }),
  ]);
  assert.deepEqual(translateSurfArgs("wait", ["1500"]), [
    "wait",
    "dom",
    "--args-json",
    JSON.stringify({ timeout: 1500 }),
  ]);
  assert.deepEqual(translateSurfArgs("wait", ["--element", "#ready"]), [
    "wait",
    "element",
    "--args-json",
    JSON.stringify({ selector: "#ready" }),
  ]);
});

test("surf-go command translation fails closed for unmapped commands and args", () => {
  assert.throws(
    () => translateSurfArgs("wait", ["--state", "idle"]),
    /Unsupported Surf Go wait argument shape/,
  );
  assert.throws(
    () => translateSurfArgs("workflow.run", ["./flow.json"]),
    /Unsupported Surf Go command mapping for 'workflow.run'/,
  );
});

test("workspace surf-go help exposes the simple-tool args-json contract", (t) => {
  const repo = path.resolve(process.cwd(), "..", "..", "contrib", "surf-cli-go");
  if (!existsSync(path.join(repo, "go", "cmd", "surf-go", "main.go"))) {
    t.skip("workspace surf-cli-go checkout is not present");
    return;
  }

  const result = spawnSync(
    "go",
    ["-C", path.join(repo, "go"), "run", "./cmd/surf-go", "click", "--help"],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /--args-json/);
  assert.doesNotMatch(result.stdout, /--selector/);
});
