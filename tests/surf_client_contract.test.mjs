import assert from "node:assert/strict";
import test from "node:test";
import { createFakeSurf, readyPages, withFakeSurfEnv } from "./helpers/fake-surf.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

// SurfClient is internal since 0.4.0 (D2): it is exercised through its module, not the package root.
const { SurfClient } = await importRuntimeModule("integrations/surf-client.js");
const { SurfCommandError } = await importRuntimeModule("core/surf-runtime.js");

const PAGES = readyPages({
  "https://example.com/": {
    title: "Example Domain",
    links: ["https://example.com/docs", "https://other.example/away"],
    counts: { iframes: 2 },
  },
  "https://example.com/empty": { title: "Nothing here", links: [] },
  "https://example.com/login": {
    title: "Sign in",
    readiness: "login",
    evidence: ["1 visible password field(s)", "URL path /login looks like a login route"],
  },
});

function lastArgv(fake) {
  const calls = fake.calls();
  return calls[calls.length - 1];
}

async function withClient(options, callback) {
  const fake = createFakeSurf({ pages: PAGES, ...options.fake });
  try {
    await withFakeSurfEnv(fake.path, async () => {
      await callback(new SurfClient({ autoScreenshot: false, ...options.client }), fake);
    });
  } finally {
    fake.cleanup();
  }
}

test(
  "SurfClient maps navigation and interaction methods onto verified surf argv",
  { concurrency: false },
  async () => {
    await withClient({ fake: { echo: true } }, async (client, fake) => {
      const gotoResult = await client.goto("https://example.com");
      assert.equal(gotoResult.success, true);
      assert.equal(gotoResult.message, "navigate\nhttps://example.com");
      assert.deepEqual(lastArgv(fake), ["navigate", "https://example.com"]);

      await client.click("button.login");
      assert.deepEqual(lastArgv(fake), ["click", "--selector", "button.login"]);

      await client.click("e5");
      assert.deepEqual(lastArgv(fake), ["click", "e5"]);

      await client.click("//button[@type='submit']");
      assert.deepEqual(lastArgv(fake), ["click", "--selector", "//button[@type='submit']"]);

      await client.click(100, 200);
      assert.deepEqual(lastArgv(fake), ["click", "--x", "100", "--y", "200"]);

      await client.type("hello world", { ref: "e1", submit: true });
      assert.deepEqual(lastArgv(fake), ["type", "hello world", "--ref", "e1", "--submit"]);

      await client.type("query", { selector: "input[name=q]" });
      assert.deepEqual(lastArgv(fake), ["type", "query", "--into", "input[name=q]"]);

      await client.wait(1500);
      assert.deepEqual(lastArgv(fake), ["wait", "1.5"]);

      await client.wait({ element: ".loaded" });
      assert.deepEqual(lastArgv(fake), ["wait.element", ".loaded"]);

      await client.press("Enter");
      assert.deepEqual(lastArgv(fake), ["key", "Enter"]);

      await client.scroll("down", 500);
      assert.deepEqual(lastArgv(fake), ["scroll", "down", "500"]);

      await client.reload(true);
      assert.deepEqual(lastArgv(fake), ["tab.reload", "--hard"]);
    });
  },
);

test(
  "SurfClient applies screenshotResize to screenshot commands",
  { concurrency: false },
  async () => {
    await withClient(
      { fake: { echo: true }, client: { screenshotResize: 777 } },
      async (client, fake) => {
        const result = await client.screenshot();
        assert.equal(result.success, true);
        assert.deepEqual(lastArgv(fake), ["screenshot", "--max-size", "777"]);
      },
    );
  },
);

test(
  "SurfClient does not turn a successful action into a failure when the follow-up screenshot fails",
  { concurrency: false },
  async () => {
    await withClient(
      { fake: { echo: true, failOn: ["screenshot"] }, client: { autoScreenshot: true } },
      async (client) => {
        const result = await client.goto("https://example.com");

        assert.equal(result.success, true);
        assert.equal(result.message, "navigate\nhttps://example.com");
        assert.match(result.error ?? "", /surf exploded/);
      },
    );
  },
);

test(
  "SurfClient surfaces typed readiness failures as SurfCommandError codes",
  { concurrency: false },
  async () => {
    await withClient({}, async (client) => {
      const { tabId } = await client.newTab("https://example.com/login");

      await assert.rejects(
        () => client.waitReady({ tabId }),
        (error) => {
          assert.ok(error instanceof SurfCommandError);
          assert.equal(error.code, "page_login");
          assert.match(
            error.message,
            /Page is not ready: login at https:\/\/example\.com\/login \[page_login\]/,
          );
          assert.equal(error.details?.state, "login");
          assert.deepEqual(error.details?.evidence, [
            "1 visible password field(s)",
            "URL path /login looks like a login route",
          ]);
          return true;
        },
      );

      const accepted = await client.waitReady({ tabId, accept: ["login"] });
      assert.equal(accepted.state, "login");
      assert.equal(accepted.accepted, true);

      const classified = await client.pageReadiness({ tabId });
      assert.equal(classified.state, "login");

      await client.closeTab(tabId);
    });
  },
);

test(
  "SurfClient opens tabs, lists them as JSON, and extracts rows in place with the zero-rows invariant",
  { concurrency: false },
  async () => {
    await withClient({}, async (client) => {
      const opened = await client.newTab("https://example.com/");
      assert.deepEqual(opened, { tabId: 100, url: "https://example.com/" });

      const tabs = await client.listTabs();
      assert.deepEqual(tabs, [{ id: 100, title: "Example Domain", url: "https://example.com/" }]);

      const ready = await client.waitReady({ tabId: 100 });
      assert.equal(ready.state, "ready");
      assert.equal(ready.href, "https://example.com/");

      // extract prefixes a SURF_OPTIONS prelude, so extraction scripts must `return` explicitly.
      const rowsScript =
        "return { rows: Array.from(document.querySelectorAll('a[href]')).map((anchor) => ({ href: anchor.getAttribute('href') })) };";
      const extracted = await client.extract({ tabId: 100, code: rowsScript });
      assert.equal(extracted.mode, "target");
      assert.equal(extracted.rowCount, 2);
      assert.deepEqual(extracted.rows, [
        { href: "https://example.com/docs" },
        { href: "https://other.example/away" },
      ]);
      assert.equal(extracted.readiness?.state, "ready");

      const emptyTab = await client.newTab("https://example.com/empty");
      await assert.rejects(
        () => client.extract({ tabId: emptyTab.tabId, code: rowsScript }),
        (error) => error instanceof SurfCommandError && error.code === "empty_result",
      );
      const allowed = await client.extract({
        tabId: emptyTab.tabId,
        code: rowsScript,
        allowEmpty: true,
      });
      await assert.rejects(
        () =>
          client.extract({
            tabId: emptyTab.tabId,
            code: "({ rows: [] })",
          }),
        (error) => error instanceof SurfCommandError && error.code === "no_output",
      );
      assert.equal(allowed.rowCount, 0);
      assert.deepEqual(allowed.rows, []);

      await client.closeTab(emptyTab.tabId);
      await client.closeTab(100);
      assert.deepEqual(await client.listTabs(), []);
    });
  },
);

test(
  "SurfClient evaluate returns the JSON value and diagnoseFrames returns the typed diagnosis",
  { concurrency: false },
  async () => {
    await withClient({}, async (client) => {
      const { tabId } = await client.newTab("https://example.com/");

      assert.equal(await client.evaluate("document.title"), "Example Domain");
      assert.deepEqual(await client.evaluate("({ href: location.href })"), {
        href: "https://example.com/",
      });

      const diagnosis = await client.diagnoseFrames({ tabId });
      assert.equal(diagnosis.domIframes.length, 2);
      assert.equal(diagnosis.cdpFrames.length, 1);
      assert.match(diagnosis.warnings.join("\n"), /out-of-process/);

      await client.closeTab(tabId);
    });
  },
);

test(
  "SurfClient fails clearly when JSON-bearing commands emit non-JSON output",
  { concurrency: false },
  async () => {
    await withClient({ fake: { echo: true } }, async (client) => {
      await assert.rejects(() => client.getNetwork(), /Invalid JSON output from surf network/);
    });
  },
);

test("SurfClient rejects unsupported config knobs instead of silently ignoring them", () => {
  assert.throws(
    () => new SurfClient({ socketPath: "/tmp/custom.sock" }),
    /Unsupported SurfClient config option\(s\): socketPath/,
  );
});
