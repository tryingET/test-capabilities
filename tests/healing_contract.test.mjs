import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TestFileHealer } from "../src/healing/self-healing.ts";

test("TestFileHealer.analyzeFile proposes normalized replacements for legacy getByTestId values", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('login', async () => { await page.getByTestId('old-login').click(); });\n",
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file);

    assert.equal(proposals.length, 1);
    assert.equal(proposals[0]?.oldSelector, "old-login");
    assert.equal(proposals[0]?.newSelector, "login");
    assert.equal(proposals[0]?.strategy, "legacy-prefix-trim");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.analyzeFile handles locator selectors with nested quotes", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    [
      "test('one', async () => { await page.locator('[data-testid=\"old-login\"]').click(); });",
      "test('two', async () => { await page.locator(\"[data-testid='deprecated-login']\").click(); });",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file);

    assert.deepEqual(
      proposals.map((proposal) => ({
        oldSelector: proposal.oldSelector,
        newSelector: proposal.newSelector,
        strategy: proposal.strategy,
      })),
      [
        {
          oldSelector: '[data-testid="old-login"]',
          newSelector: '[data-testid="login"]',
          strategy: "legacy-prefix-trim",
        },
        {
          oldSelector: "[data-testid='deprecated-login']",
          newSelector: "[data-testid='login']",
          strategy: "legacy-prefix-trim",
        },
      ],
    );
    assert.equal(proposals[0]?.column === proposals[1]?.column, true);
    assert.equal((proposals[0]?.column ?? 0) > 0, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.analyzeFile ignores ordinary fill payload literals", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('pw', async () => { await page.locator('#old-password').fill('old-password'); });\n",
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file);

    assert.deepEqual(
      proposals.map((proposal) => proposal.oldSelector),
      ["#old-password"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.applyProposal uses recorded column to rewrite the intended selector", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('dup', async () => { await page.locator('#old-login'); await page.locator('#old-login'); });\n",
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    await healer.applyProposal({
      file,
      line: 1,
      column: 81,
      oldSelector: "#old-login",
      newSelector: "#new-login",
      confidence: 0.95,
      strategy: "manual",
      requiresReview: false,
    });

    const updated = readFileSync(file, "utf8");
    assert.match(updated, /locator\('#old-login'\); await page\.locator\('#new-login'\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
