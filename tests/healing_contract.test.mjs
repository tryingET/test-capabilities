import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SelfHealingEngine, TestFileHealer } from "../src/healing/self-healing.ts";

test("SelfHealingEngine keeps low-confidence AI candidates out of the success path", async () => {
  const healer = new SelfHealingEngine();
  const result = await healer.heal({
    originalSelector: "mystery-selector",
    action: "click",
    description: "submit button",
    screenshot: Buffer.from("fake"),
  });

  assert.equal(result.success, false);
  assert.equal(result.newSelector, undefined);
  assert.equal(result.metadata?.requiresReview, true);
  assert.match(result.metadata?.reason ?? "", /requires an external model/);
});

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

test("TestFileHealer.analyzeFile ignores legacy-looking payloads on non-selector click helpers", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('custom', async () => { await actor.click('old-submit-label'); });\n",
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file);

    assert.deepEqual(proposals, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.analyzeFile still recognizes selector-bearing page.click calls", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('page click', async () => { await page.click('#old-submit'); });\n",
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file);

    assert.deepEqual(
      proposals.map((proposal) => ({
        oldSelector: proposal.oldSelector,
        newSelector: proposal.newSelector,
      })),
      [{ oldSelector: "#old-submit", newSelector: "#submit" }],
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

test("TestFileHealer.verifyProposals reports in-memory apply failures without mutating files", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  const original = "test('one', async () => { await page.locator('#old-login').click(); });\n";
  writeFileSync(file, original, "utf8");

  try {
    const healer = new TestFileHealer();
    const verification = await healer.verifyProposals([
      {
        file,
        line: 1,
        oldSelector: "#missing-selector",
        newSelector: "#new-login",
        confidence: 0.95,
        strategy: "manual",
        requiresReview: false,
      },
    ]);

    assert.equal(verification.status, "fail");
    assert.equal(verification.proposalCount, 1);
    assert.equal(verification.checkedFileCount, 1);
    assert.match(verification.failures[0]?.message ?? "", /selector mismatch/);
    assert.equal(readFileSync(file, "utf8"), original);
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

// Evidence-backed healing: proposals cite triggeringFindingId when findings are provided
test("TestFileHealer.analyzeFile with findings cites triggeringFindingId", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('login', async () => { await page.getByTestId('old-login-btn').click(); });\n",
    "utf8",
  );

  const findings = [
    {
      id: "surfA-selector-drift",
      component: "web",
      description: "Selector drift detected on login button",
      evidence: [
        "selector: #old-login-btn not found in DOM",
        "getByTestId('old-login-btn') failed",
      ],
    },
  ];

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file, findings);

    // The heuristic scan still finds old-login-btn because it has 'old-' prefix.
    assert.ok(proposals.length >= 1, "should produce at least one proposal");
    const matchedProposal = proposals.find((p) => p.oldSelector === "old-login-btn");
    if (matchedProposal) {
      assert.equal(
        matchedProposal.triggeringFindingId,
        "surfA-selector-drift",
        "proposal should cite the finding that references its selector",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.analyzeFile matches data-testid evidence to getByTestId source selectors", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('login', async () => { await page.getByTestId('old-login-btn').click(); });\n",
    "utf8",
  );

  const findings = [
    {
      id: "surfA-data-testid-drift",
      component: "web",
      description: "Selector drift detected on login button",
      evidence: ['selector [data-testid="old-login-btn"] failed'],
    },
  ];

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file, findings);

    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].oldSelector, "old-login-btn");
    assert.equal(proposals[0].triggeringFindingId, "surfA-data-testid-drift");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.analyzeFile with findings only heals selectors cited by evidence", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    [
      "test('login', async () => {",
      "  await page.getByTestId('old-login-btn').click();",
      "  await page.getByTestId('old-unrelated-btn').click();",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const findings = [
    {
      id: "surfA-selector-drift",
      component: "web",
      description: "Selector drift detected on login button",
      evidence: ["getByTestId('old-login-btn') failed"],
    },
  ];

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file, findings);

    assert.ok(proposals.length >= 1, "should produce a proposal for the cited selector");
    assert.equal(
      proposals.some((proposal) => proposal.oldSelector === "old-login-btn"),
      true,
    );
    assert.equal(
      proposals.some((proposal) => proposal.oldSelector === "old-unrelated-btn"),
      false,
      "evidence-backed mode must not heal selectors that were not cited by findings",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.analyzeFile without findings does not set triggeringFindingId", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('login', async () => { await page.getByTestId('old-submit').click(); });\n",
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file);

    assert.ok(proposals.length >= 1, "should produce proposals from heuristic scan");
    for (const proposal of proposals) {
      assert.equal(
        proposal.triggeringFindingId,
        undefined,
        "heuristic-only proposals must not have triggeringFindingId",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.analyzeFile with empty findings array produces no evidence-backed proposals", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('login', async () => { await page.getByTestId('old-checkout').click(); });\n",
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file, []);

    assert.deepEqual(
      proposals,
      [],
      "empty findings should not trigger evidence-backed healing proposals",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
