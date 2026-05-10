import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { SurfClient, SurfFlowBuilder } = await importRuntimeModule("index.js");

function withFakeSurfGo(script) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "surf-client-test-"));
  const surfGoPath = path.join(dir, "surf-go");
  writeFileSync(surfGoPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });

  const previous = {
    path: process.env.PATH,
    bin: process.env.TEST_CAPABILITIES_SURF_GO_BIN,
    repo: process.env.TEST_CAPABILITIES_SURF_GO_REPO,
  };

  return {
    dir,
    path: surfGoPath,
    apply() {
      process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
      process.env.TEST_CAPABILITIES_SURF_GO_BIN = surfGoPath;
      delete process.env.TEST_CAPABILITIES_SURF_GO_REPO;
    },
    cleanup() {
      if (previous.path === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previous.path;
      }
      if (previous.bin === undefined) {
        delete process.env.TEST_CAPABILITIES_SURF_GO_BIN;
      } else {
        process.env.TEST_CAPABILITIES_SURF_GO_BIN = previous.bin;
      }
      if (previous.repo === undefined) {
        delete process.env.TEST_CAPABILITIES_SURF_GO_REPO;
      } else {
        process.env.TEST_CAPABILITIES_SURF_GO_REPO = previous.repo;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test(
  "SurfClient passes raw arguments without shell-style quotes",
  { concurrency: false },
  async () => {
    const fake = withFakeSurfGo('printf "%s\\n" "$@"');
    fake.apply();

    try {
      const client = new SurfClient({ autoScreenshot: false });
      const gotoResult = await client.goto("https://example.com");
      const clickResult = await client.click("button.login");
      const typeResult = await client.type("hello world", { ref: "e1", submit: true });

      assert.equal(gotoResult.success, true);
      assert.equal(gotoResult.message, "navigate\n--url\nhttps://example.com");
      assert.equal(clickResult.success, true);
      assert.equal(
        clickResult.message,
        `click\n--args-json\n${JSON.stringify({ selector: "button.login" })}`,
      );
      assert.equal(typeResult.success, true);
      assert.equal(
        typeResult.message,
        `tool-raw\n--tool\nclick_type_submit\n--args-json\n${JSON.stringify({ text: "hello world", ref: "e1" })}`,
      );
    } finally {
      fake.cleanup();
    }
  },
);

test(
  "SurfClient routes XPath selectors through the explicit selector channel",
  { concurrency: false },
  async () => {
    const fake = withFakeSurfGo('printf "%s\\n" "$@"');
    fake.apply();

    try {
      const client = new SurfClient({ autoScreenshot: false });
      const result = await client.click("//button[@type='submit']");

      assert.equal(result.success, true);
      assert.equal(
        result.message,
        `click\n--args-json\n${JSON.stringify({ selector: "//button[@type='submit']" })}`,
      );
    } finally {
      fake.cleanup();
    }
  },
);

test(
  "SurfClient does not turn a successful action into a failure when the follow-up screenshot fails",
  { concurrency: false },
  async () => {
    const fake = withFakeSurfGo(`
cmd="$1"
shift
if [ "$cmd" = "navigate" ]; then
  shift
  printf 'ok navigate %s\\n' "$1"
  exit 0
fi
if [ "$cmd" = "screenshot" ]; then
  echo 'screenshot failed' >&2
  exit 2
fi
printf '%s\\n' "$cmd" "$@"
`);
    fake.apply();

    try {
      const client = new SurfClient({ autoScreenshot: true });
      const result = await client.goto("https://example.com");

      assert.equal(result.success, true);
      assert.equal(result.message, "ok navigate https://example.com");
      assert.match(result.error ?? "", /screenshot failed/);
    } finally {
      fake.cleanup();
    }
  },
);

test(
  "SurfClient parses multiline snapshots with title and URL",
  { concurrency: false },
  async () => {
    const fake = withFakeSurfGo(`
cmd="$1"
shift
if [ "$cmd" = "page" ] && [ "\${1-}" = "read" ]; then
  printf '✓ Example Title\\nhttps://example.com\\nbutton [ref=e1] name="Login": Login\\n'
  exit 0
fi
printf '%s\\n' "$cmd" "$@"
`);
    fake.apply();

    try {
      const client = new SurfClient({ autoScreenshot: false });
      const snapshot = await client.read();

      assert.equal(snapshot.title, "Example Title");
      assert.equal(snapshot.url, "https://example.com");
      assert.equal(snapshot.elements[0]?.role, "button");
    } finally {
      fake.cleanup();
    }
  },
);

test("SurfClient parses tab lists with bordered table output", { concurrency: false }, async () => {
  const fake = withFakeSurfGo(`
cmd="$1"
shift
if [ "$cmd" = "tab" ] && [ "\${1-}" = "list" ]; then
  printf '│ 3 │ Dashboard │ https://example.com/dashboard │\n'
  exit 0
fi
printf '%s\n' "$cmd" "$@"
`);
  fake.apply();

  try {
    const client = new SurfClient({ autoScreenshot: false });
    const tabs = await client.listTabs();

    assert.deepEqual(tabs, [
      {
        id: 3,
        title: "Dashboard",
        url: "https://example.com/dashboard",
      },
    ]);
  } finally {
    fake.cleanup();
  }
});

test(
  "SurfClient tolerates warning-prefixed JSON output for pageState",
  { concurrency: false },
  async () => {
    const fake = withFakeSurfGo(`
cmd="$1"
shift
if [ "$cmd" = "page" ] && [ "\${1-}" = "state" ]; then
  printf 'warning: devtools reconnecting\n{"modals":[],"loading":false,"scrollPosition":{"x":0,"y":1}}\n'
  exit 0
fi
printf '%s\n' "$cmd" "$@"
`);
    fake.apply();

    try {
      const client = new SurfClient({ autoScreenshot: false });
      const state = await client.pageState();

      assert.deepEqual(state, {
        modals: [],
        loading: false,
        scrollPosition: { x: 0, y: 1 },
      });
    } finally {
      fake.cleanup();
    }
  },
);

test(
  "SurfClient fails clearly when JSON-bearing commands emit non-JSON output",
  { concurrency: false },
  async () => {
    const fake = withFakeSurfGo(`
cmd="$1"
shift
if [ "$cmd" = "network" ] && [ "\${1-}" = "list" ]; then
  printf 'warning: capture disabled\n'
  exit 0
fi
printf '%s\n' "$cmd" "$@"
`);
    fake.apply();

    try {
      const client = new SurfClient({ autoScreenshot: false });
      await assert.rejects(() => client.getNetwork(), /Invalid JSON output from surf network/);
    } finally {
      fake.cleanup();
    }
  },
);

test(
  "SurfClient applies screenshotResize to screenshot commands",
  { concurrency: false },
  async () => {
    const fake = withFakeSurfGo('printf "%s\\n" "$@"');
    fake.apply();

    try {
      const client = new SurfClient({ autoScreenshot: false, screenshotResize: 777 });
      const result = await client.screenshot();

      assert.equal(result.success, true);
      assert.equal(
        result.message,
        `screenshot\n--args-json\n${JSON.stringify({ "max-size": 777 })}`,
      );
    } finally {
      fake.cleanup();
    }
  },
);

test("SurfClient rejects unsupported config knobs instead of silently ignoring them", () => {
  assert.throws(
    () => new SurfClient({ socketPath: "/tmp/custom.sock" }),
    /Unsupported SurfClient config option\(s\): socketPath/,
  );
});

test("SurfFlowBuilder fails when surf command exits non-zero", { concurrency: false }, async () => {
  const fake = withFakeSurfGo('echo "simulated failure" >&2\nexit 1');
  fake.apply();
  let assertionRuns = 0;

  try {
    const client = new SurfClient({ autoScreenshot: false });
    await assert.rejects(() => client.goto("https://example.com"), /simulated failure/);

    const flow = new SurfFlowBuilder(client)
      .goto("https://example.com")
      .assert("should never reach assertion success", async () => {
        assertionRuns += 1;
        return true;
      });

    const result = await flow.execute();
    assert.equal(result.success, false);
    assert.equal(result.steps[0]?.success, false);
    assert.equal(assertionRuns, 0);
    assert.deepEqual(result.assertions, []);
    assert.match(result.steps[0]?.error ?? "", /simulated failure/);
  } finally {
    fake.cleanup();
  }
});

test("SurfFlowBuilder accepts zero-duration waits", { concurrency: false }, async () => {
  const fake = withFakeSurfGo('printf "%s\\n" "$@"');
  fake.apply();

  try {
    const client = new SurfClient({ autoScreenshot: false });
    const result = await new SurfFlowBuilder(client).wait(0).execute();

    assert.equal(result.success, true);
    assert.equal(result.steps[0]?.success, true);
    assert.equal(result.steps[0]?.step.duration, 0);
  } finally {
    fake.cleanup();
  }
});
