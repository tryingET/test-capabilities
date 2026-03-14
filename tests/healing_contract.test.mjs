import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TestFileHealer } from "../src/healing/self-healing.ts";

test("TestFileHealer.applyProposal rewrites only the targeted line", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    [
      "test('one', async () => { await page.locator('#old-login').click(); });",
      "",
      "test('two', async () => { await page.locator('#old-login').click(); });",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    await healer.applyProposal({
      file,
      line: 3,
      oldSelector: "#old-login",
      newSelector: "#new-login",
      confidence: 0.95,
      strategy: "manual",
      requiresReview: false,
    });

    const updated = readFileSync(file, "utf8");
    const lines = updated.split(/\r?\n/);
    assert.match(lines[0] ?? "", /#old-login/);
    assert.match(lines[2] ?? "", /#new-login/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.applyProposal fails when the selector is not present on the targeted line", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('one', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    await assert.rejects(
      async () =>
        healer.applyProposal({
          file,
          line: 1,
          oldSelector: "#missing-selector",
          newSelector: "#new-login",
          confidence: 0.95,
          strategy: "manual",
          requiresReview: false,
        }),
      /Healing proposal selector mismatch/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
