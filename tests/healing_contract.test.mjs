import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

test("TestFileHealer with rootDir rejects files outside the healing root", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-root-"));
  const outsideDir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-root-outside-"));
  const outsideFile = path.join(outsideDir, "outside.test.ts");
  const original = "test('outside', async () => { await page.locator('#old-login').click(); });\n";
  writeFileSync(outsideFile, original, "utf8");

  try {
    const healer = new TestFileHealer({ rootDir: dir });
    await assert.rejects(
      async () =>
        healer.applyProposal({
          file: outsideFile,
          line: 1,
          oldSelector: "#old-login",
          newSelector: "#new-login",
          confidence: 0.95,
          strategy: "manual",
          requiresReview: false,
        }),
      /Healing file resolved outside root:/,
    );
    assert.equal(readFileSync(outsideFile, "utf8"), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test("TestFileHealer.applyProposal does not delete a preexisting temp-name collision", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-temp-collision-"));
  const file = path.join(dir, "sample.test.ts");
  const originalNow = Date.now;
  const fixedNow = 123456789;
  const tempPath = path.join(dir, `.sample.test.ts.${process.pid}.${fixedNow}.tmp`);
  writeFileSync(
    file,
    "test('one', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );
  writeFileSync(tempPath, "do-not-delete\n", "utf8");

  try {
    Date.now = () => fixedNow;
    const healer = new TestFileHealer();
    await assert.rejects(
      async () =>
        healer.applyProposal({
          file,
          line: 1,
          oldSelector: "#old-login",
          newSelector: "#new-login",
          confidence: 0.95,
          strategy: "manual",
          requiresReview: false,
        }),
      /EEXIST|file already exists/i,
    );
    assert.equal(readFileSync(tempPath, "utf8"), "do-not-delete\n");
  } finally {
    Date.now = originalNow;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.applyProposal preserves target file mode", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-mode-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('one', async () => { await page.locator('#old-login').click(); });\n",
    "utf8",
  );
  chmodSync(file, 0o755);

  try {
    const healer = new TestFileHealer();
    await healer.applyProposal({
      file,
      line: 1,
      oldSelector: "#old-login",
      newSelector: "#new-login",
      confidence: 0.95,
      strategy: "manual",
      requiresReview: false,
    });

    assert.equal(statSync(file).mode & 0o777, 0o755);
    assert.match(readFileSync(file, "utf8"), /#new-login/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.applyProposal rejects symlink files before mutation", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-symlink-"));
  const realFile = path.join(dir, "real.test.ts");
  const linkFile = path.join(dir, "linked.test.ts");
  const original = "test('one', async () => { await page.locator('#old-login').click(); });\n";
  writeFileSync(realFile, original, "utf8");

  try {
    symlinkSync(realFile, linkFile);
    const healer = new TestFileHealer();
    await assert.rejects(
      async () =>
        healer.applyProposal({
          file: linkFile,
          line: 1,
          oldSelector: "#old-login",
          newSelector: "#new-login",
          confidence: 0.95,
          strategy: "manual",
          requiresReview: false,
        }),
      /Healing file must not be a symlink:/,
    );
    assert.equal(readFileSync(realFile, "utf8"), original);
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

test("TestFileHealer.analyzeFile matches single-quoted data-testid evidence", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('login', async () => { await page.getByTestId('old-login-btn').click(); });\n",
    "utf8",
  );

  const findings = [
    {
      id: "surfA-single-quote-data-testid-drift",
      component: "web",
      description: "Selector drift detected on login button",
      evidence: ["selector [data-testid='old-login-btn'] failed"],
    },
  ];

  try {
    const healer = new TestFileHealer();
    const proposals = await healer.analyzeFile(file, findings);

    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].oldSelector, "old-login-btn");
    assert.equal(proposals[0].triggeringFindingId, "surfA-single-quote-data-testid-drift");
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

// Re-apply guard: a healed selector must not be matched again as a prefix of the new one.
test("TestFileHealer.applyProposals refuses to re-apply a proposal whose old selector is a prefix of the healed one", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-reapply-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('one', async () => { await page.locator('#btn').click(); });\n",
    "utf8",
  );
  const proposal = {
    file,
    line: 1,
    oldSelector: "#btn",
    newSelector: "#btn-new",
    confidence: 0.95,
    strategy: "manual",
    requiresReview: false,
  };

  try {
    const healer = new TestFileHealer();
    const first = await healer.applyProposals([proposal]);
    assert.deepEqual(first, { written: [file] });
    assert.match(readFileSync(file, "utf8"), /locator\('#btn-new'\)/);

    await assert.rejects(
      async () => healer.applyProposals([proposal]),
      /Healing proposal selector mismatch at .*sample\.test\.ts:1\. Expected '#btn' as a whole token but found '#btn-new'/,
    );
    await assert.rejects(
      async () => healer.applyProposals([{ ...proposal, column: 47 }]),
      /Healing proposal selector mismatch at .*sample\.test\.ts:1:47\. Expected '#btn' as a whole token but found '#btn-new'/,
    );
    assert.equal(
      readFileSync(file, "utf8"),
      "test('one', async () => { await page.locator('#btn-new').click(); });\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.applyProposals skips a longer-token occurrence and rewrites the whole-token one", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-token-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('one', async () => { await page.locator('#btn-new'); await page.locator('#btn'); await page.locator('[data-testid=my-btn]'); });\n",
    "utf8",
  );

  try {
    const healer = new TestFileHealer();
    const result = await healer.applyProposals([
      {
        file,
        line: 1,
        oldSelector: "#btn",
        newSelector: "#button",
        confidence: 0.95,
        strategy: "manual",
        requiresReview: false,
      },
    ]);
    assert.deepEqual(result, { written: [file] });
    assert.equal(
      readFileSync(file, "utf8"),
      "test('one', async () => { await page.locator('#btn-new'); await page.locator('#button'); await page.locator('[data-testid=my-btn]'); });\n",
    );

    await assert.rejects(
      async () =>
        healer.applyProposals([
          {
            file,
            line: 1,
            oldSelector: "btn",
            newSelector: "button",
            confidence: 0.95,
            strategy: "manual",
            requiresReview: false,
          },
        ]),
      /Expected 'btn' as a whole token but found 'btn-new'/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TestFileHealer.applyProposals reports the written count and restores on a partial write failure", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-healing-partial-"));
  const okFile = path.join(dir, "a.test.ts");
  const lockedDir = path.join(dir, "locked");
  const lockedFile = path.join(lockedDir, "b.test.ts");
  const original = "test('one', async () => { await page.locator('#old-login').click(); });\n";
  writeFileSync(okFile, original, "utf8");
  mkdirSync(lockedDir);
  writeFileSync(lockedFile, original, "utf8");
  const proposalFor = (file) => ({
    file,
    line: 1,
    oldSelector: "#old-login",
    newSelector: "#new-login",
    confidence: 0.95,
    strategy: "manual",
    requiresReview: false,
  });

  try {
    if (process.getuid?.() === 0) {
      return; // root ignores directory modes; the write cannot be made to fail this way
    }
    // The second file's directory refuses new entries, so its temp file cannot be created.
    chmodSync(lockedDir, 0o500);
    const healer = new TestFileHealer();
    await assert.rejects(
      async () => healer.applyProposals([proposalFor(okFile), proposalFor(lockedFile)]),
      (error) => {
        assert.match(
          error.message,
          /Healing apply wrote 1 of 2 file\(s\) before failing: .*EACCES|EPERM/,
        );
        assert.match(
          error.message,
          /Restored 1 file\(s\) to their original content: .*a\.test\.ts/,
        );
        return true;
      },
    );
    assert.equal(readFileSync(okFile, "utf8"), original);
    assert.equal(readFileSync(lockedFile, "utf8"), original);
  } finally {
    chmodSync(lockedDir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

// Only a fault is a statement about the target, so only a fault may drive a selector rewrite.
// A no_evidence, contradiction or indeterminate finding describes the run, not the code
// (result-classification packet, refinement; plan S4).
test("the healer proposes from a fault finding only, and still accepts unclassified legacy input", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-capabilities-heal-basis-"));
  const file = path.join(dir, "sample.test.ts");
  writeFileSync(
    file,
    "test('login', async () => { await page.getByTestId('old-login').click(); });\n",
    "utf8",
  );

  const finding = (basis) => ({
    id: `finding-${basis ?? "legacy"}`,
    component: "web",
    description: "login step failed",
    evidence: ["selector: old-login"],
    ...(basis === undefined ? {} : { outcome: { basis } }),
  });

  try {
    const healer = new TestFileHealer();

    for (const basis of ["no_evidence", "contradiction", "indeterminate"]) {
      const proposals = await healer.analyzeFile(file, [finding(basis)]);
      assert.deepEqual(proposals, [], `expected no proposal from a ${basis} finding`);
    }

    const fromFault = await healer.analyzeFile(file, [finding("fault")]);
    assert.equal(fromFault.length, 1);
    assert.equal(fromFault[0]?.triggeringFindingId, "finding-fault");

    // A receipt written before S4 carries no outcome and keeps its meaning.
    const fromLegacy = await healer.analyzeFile(file, [finding(undefined)]);
    assert.equal(fromLegacy.length, 1);
    assert.equal(fromLegacy[0]?.triggeringFindingId, "finding-legacy");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
