import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SurfClient, SurfFlowBuilder } from "../src/integrations/surf-client.ts";

function withFakeSurf(script) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "surf-client-test-"));
  const surfPath = path.join(dir, "surf");
  writeFileSync(surfPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });

  return {
    dir,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test(
  "SurfClient passes raw arguments without shell-style quotes",
  { concurrency: false },
  async () => {
    const fake = withFakeSurf('printf "%s\\n" "$@"');
    const previousPath = process.env.PATH;
    process.env.PATH = fake.env.PATH;

    try {
      const client = new SurfClient({ autoScreenshot: false });
      const gotoResult = await client.goto("https://example.com");
      const typeResult = await client.type("hello world", { ref: "e1", submit: true });

      assert.equal(gotoResult.success, true);
      assert.equal(gotoResult.message, "go\nhttps://example.com");
      assert.equal(typeResult.success, true);
      assert.equal(typeResult.message, "type\nhello world\n--ref\ne1\n--submit");
    } finally {
      process.env.PATH = previousPath;
      fake.cleanup();
    }
  },
);

test(
  "SurfClient does not turn a successful action into a failure when the follow-up screenshot fails",
  { concurrency: false },
  async () => {
    const fake = withFakeSurf(`
cmd="$1"
shift
if [ "$cmd" = "go" ]; then
  printf 'ok go %s\\n' "$1"
  exit 0
fi
if [ "$cmd" = "screenshot" ]; then
  echo 'screenshot failed' >&2
  exit 2
fi
printf '%s\\n' "$cmd" "$@"
`);
    const previousPath = process.env.PATH;
    process.env.PATH = fake.env.PATH;

    try {
      const client = new SurfClient({ autoScreenshot: true });
      const result = await client.goto("https://example.com");

      assert.equal(result.success, true);
      assert.equal(result.message, "ok go https://example.com");
      assert.match(result.error ?? "", /screenshot failed/);
    } finally {
      process.env.PATH = previousPath;
      fake.cleanup();
    }
  },
);

test(
  "SurfClient parses multiline snapshots with title and URL",
  { concurrency: false },
  async () => {
    const fake = withFakeSurf(`
cmd="$1"
shift
if [ "$cmd" = "read" ]; then
  printf '✓ Example Title\\nhttps://example.com\\nbutton [ref=e1] name="Login": Login\\n'
  exit 0
fi
printf '%s\\n' "$cmd" "$@"
`);
    const previousPath = process.env.PATH;
    process.env.PATH = fake.env.PATH;

    try {
      const client = new SurfClient({ autoScreenshot: false });
      const snapshot = await client.read();

      assert.equal(snapshot.title, "Example Title");
      assert.equal(snapshot.url, "https://example.com");
      assert.equal(snapshot.elements[0]?.role, "button");
    } finally {
      process.env.PATH = previousPath;
      fake.cleanup();
    }
  },
);

test("SurfClient parses tab lists with bordered table output", { concurrency: false }, async () => {
  const fake = withFakeSurf(`
cmd="$1"
shift
if [ "$cmd" = "tab.list" ]; then
  printf '│ 3 │ Dashboard │ https://example.com/dashboard │\n'
  exit 0
fi
printf '%s\n' "$cmd" "$@"
`);
  const previousPath = process.env.PATH;
  process.env.PATH = fake.env.PATH;

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
    process.env.PATH = previousPath;
    fake.cleanup();
  }
});

test("SurfFlowBuilder fails when surf command exits non-zero", { concurrency: false }, async () => {
  const fake = withFakeSurf('echo "simulated failure" >&2\nexit 1');
  const previousPath = process.env.PATH;
  process.env.PATH = fake.env.PATH;
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
    process.env.PATH = previousPath;
    fake.cleanup();
  }
});
