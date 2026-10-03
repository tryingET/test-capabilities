import assert from "node:assert/strict";
import test from "node:test";
import { startFakeCdp } from "./helpers/fake-cdp.mjs";
import { importRuntimeModule } from "./helpers/runtime-dist.mjs";

const { CdpConnection } = await importRuntimeModule("core/a11y-cdp.js");
const { openCdpActions } = await importRuntimeModule("core/cdp-actions.js");
const { cdpCloseOnce } = await importRuntimeModule("core/cdp-close.js");
const URL = "https://close.test/";
const pages = () => ({ P1: { url: URL, tree: { url: URL, nodes: [] } } });
const env = (cdp) => ({ TEST_CAPABILITIES_CDP_ENDPOINT: cdp.url });

// No sleep establishes success: the peer's close frame gate is the witness.
test(
  "concurrent action closes share the whole cleanup and wait for the peer reply",
  { timeout: 5000 },
  async (t) => {
    const cdp = await startFakeCdp({ pages: pages(), holdCloseReply: true });
    t.after(() => cdp.close());
    const actions = await openCdpActions(URL, env(cdp));
    let completions = 0;
    const first = actions.close();
    const second = actions.close();
    first.then(
      () => completions++,
      () => completions++,
    );
    second.then(
      () => completions++,
      () => completions++,
    );
    await cdp.closeResponse.received;
    assert.equal(completions, 0, "neither close completes before the peer answers");
    assert.strictEqual(first, second, "the full cleanup promise is cached");
    assert.equal(cdp.closeResponse.replies, 0);
    cdp.closeResponse.release();
    await Promise.all([first, second]);
    assert.equal(completions, 2);
    assert.equal(cdp.closeResponse.frames, 1);
    assert.equal(cdp.closeResponse.replies, 1);
    assert.strictEqual(actions.close(), first);
  },
);

test(
  "withheld reply rejects concurrent closes within the dedicated short deadline",
  { timeout: 5000 },
  async (t) => {
    const cdp = await startFakeCdp({ pages: pages(), holdCloseReply: true });
    t.after(() => cdp.close());
    const actions = await openCdpActions(URL, env(cdp), { closeTimeoutMs: 80 });
    const start = performance.now();
    const first = actions.close();
    const second = actions.close();
    const results = Promise.allSettled([first, second]);
    await cdp.closeResponse.received;
    for (const outcome of await results) {
      assert.equal(outcome.status, "rejected");
      assert.match(outcome.reason.message, /DevTools socket.*close.*80 ms/);
    }
    assert.ok(
      performance.now() - start < 1500,
      "the fixture deadline, not the native socket timeout",
    );
    assert.strictEqual(
      actions.close(),
      first,
      "a failed cleanup is not retried or reported successful",
    );
    assert.equal(cdp.closeResponse.replies, 0);
    assert.equal(cdp.openSockets(), 1, "timeout did not claim forced peer teardown");
  },
);

test(
  "legacy close stays void and creates no unhandled rejecting close waiter",
  { timeout: 5000 },
  async (t) => {
    const cdp = await startFakeCdp({ pages: pages(), holdCloseReply: true });
    t.after(() => cdp.close());
    const connection = await CdpConnection.open(
      `${cdp.url.replace("http", "ws")}/devtools/page/P1`,
    );
    assert.equal(connection.close(), undefined);
    await cdp.closeResponse.received;
    cdp.closeResponse.release();
    // This is a success/legacy-API check, not a short-deadline timing check.
    // Use the production completion budget under parallel coverage instrumentation;
    // the withheld-reply and preparation tests independently enforce the 80 ms bound.
    await connection.closeAndWait(1000);
    await connection.closeAndWait(1000);
  },
);

test(
  "failed action preparation still initiates socket close and caches its original error",
  { timeout: 5000 },
  async (t) => {
    const cdp = await startFakeCdp({ pages: pages(), holdCloseReply: true });
    t.after(() => cdp.close());
    const failure = new Error("preparation failed");
    const on = CdpConnection.prototype.on;
    t.mock.method(CdpConnection.prototype, "on", function (...args) {
      const off = on.apply(this, args);
      return args[0] === "Page.javascriptDialogOpening"
        ? () => {
            off();
            throw failure;
          }
        : off;
    });
    const actions = await openCdpActions(URL, env(cdp));
    const first = actions.close();
    const second = actions.close();
    const rejected = Promise.all([
      assert.rejects(first, (error) => error === failure),
      assert.rejects(second, (error) => error === failure),
    ]);
    await cdp.closeResponse.received;
    cdp.closeResponse.release();
    await rejected;
    assert.strictEqual(first, second);
    assert.strictEqual(actions.close(), first);
  },
);

test(
  "stalled preparation is bounded, closes the socket, and observes its late rejection",
  { timeout: 5000 },
  async (t) => {
    const cdp = await startFakeCdp({ pages: pages() });
    t.after(() => cdp.close());
    const connection = await CdpConnection.open(
      `${cdp.url.replace("http", "ws")}/devtools/page/P1`,
    );
    let rejectPreparation;
    const preparation = new Promise((_, reject) => {
      rejectPreparation = reject;
    });
    const close = cdpCloseOnce(connection, () => preparation, 80);
    const rejected = assert.rejects(close(), /close preparation.*80 ms/);
    await cdp.closeResponse.received;
    await rejected;
    assert.equal(cdp.closeResponse.replies, 1);
    rejectPreparation(new Error("late preparation failure"));
  },
);
