/**
 * NEXUS Test Example
 * Demonstrates the full power of autonomous testing
 */

import {
  createNexus,
  PredictionEngine,
  QuantumTestRunner,
  SelfHealingEngine,
  SurfClient,
  SurfFlowBuilder,
} from "@nexus/testing-framework";

// ============================================
// Example 1: Full Autonomous Test
// ============================================

async function runAutonomousTest() {
  const nexus = createNexus({
    version: "2.0",
    name: "My App Test",
    targets: {
      web: "https://myapp.com",
    },
    agents: {
      explorer: {
        type: "bombadil",
        enabled: true,
        intensity: "aggressive",
      },
      navigator: {
        type: "surf",
        enabled: true,
      },
    },
    intelligence: {
      selfHealing: true,
      prediction: true,
      correlation: true,
    },
    quantum: {
      enabled: true,
      branches: 100,
    },
  });

  const result = await nexus.run();

  console.log(
    "Health Score:",
    result.findings.length > 0
      ? 100 - result.findings.reduce((sum, f) => sum + severityWeight(f.severity), 0)
      : 100,
  );

  console.log("Findings:", result.findings);
  console.log("Predictions:", result.predictions);
  console.log("Quantum Insights:", result.quantumInsights);
}

function severityWeight(severity: string): number {
  return { critical: 25, high: 15, medium: 5, low: 1 }[severity] || 0;
}

// ============================================
// Example 2: Surf Flow Test
// ============================================

async function runSurfFlowTest() {
  const surf = new SurfClient({
    autoScreenshot: true,
    networkCapture: true,
  });

  const flow = new SurfFlowBuilder(surf)
    .goto("https://myapp.com")
    .click("e5", "Login button")
    .type("e12", "test@example.com")
    .type("e13", "password123")
    .click("e14", "Submit")
    .waitForElement('[data-testid="dashboard"]')
    .screenshot()
    .assert("User is logged in", async () => {
      const text = await surf.pageText();
      return text.includes("Welcome");
    });

  const result = await flow.execute();

  console.log("Flow passed:", result.success);
  console.log("Steps:", result.steps);
  console.log("Assertions:", result.assertions);
}

// ============================================
// Example 3: Quantum Simulation
// ============================================

async function runQuantumSimulation() {
  const runner = new QuantumTestRunner({
    branches: 1000,
    collapseStrategy: "significance",
    maxDepth: 20,
  });

  const result = await runner.run("https://myapp.com");

  console.log("Universes simulated:", result.branchesSimulated);
  console.log("Unique paths found:", result.uniquePaths);
  console.log("Edge cases:", result.edgeCases);
  console.log("Rare bugs:", result.rareBugs);

  // Analyze collapsed findings
  for (const finding of result.collapsedFindings) {
    console.log(`[${finding.severity}] ${finding.description}`);
    console.log(`  Probability: ${(finding.probability * 100).toFixed(2)}%`);
    console.log(`  Reproduction: ${finding.reproduction.map((a) => a.type).join(" → ")}`);
  }
}

// ============================================
// Example 4: Prediction Analysis
// ============================================

async function runPredictionAnalysis() {
  const engine = new PredictionEngine();

  const metrics = {
    errorRate: 0.05,
    responseTimeP95: 1200,
    cpuUsage: 0.6,
    memoryUsage: 0.7,
    diskUsage: 0.4,
    timeSinceDeployment: 24,
    hourOfDay: 14,
    dayOfWeek: 3,
    sessionDepthAvg: 4.5,
    rageClickRate: 0.08,
    abandonmentRate: 0.15,
    bounceRate: 0.3,
    filesChanged: 12,
    linesAdded: 250,
    linesDeleted: 100,
    testCoverageDelta: -0.02,
    recentFailures: 3,
    avgTimeBetweenFailures: 8,
  };

  const predictions = await engine.analyze(metrics);

  console.log("Failure Predictions:");
  for (const p of predictions) {
    console.log(`\n📦 ${p.component}`);
    console.log(`   Probability: ${(p.probability * 100).toFixed(1)}%`);
    console.log(`   Trigger: ${p.trigger}`);
    console.log(`   Horizon: ${p.timeHorizon}`);
    console.log(`   Prevention: ${p.preventiveAction}`);
  }

  // Get top risks
  const topRisks = engine.getTopRisks(3);
  console.log(
    "\n🔥 Top Risks:",
    topRisks.map((r) => r.component),
  );
}

// ============================================
// Example 5: Self-Healing Test
// ============================================

async function runSelfHealingTest() {
  const healer = new SelfHealingEngine();

  // Simulate a broken test scenario
  const result = await healer.heal({
    originalSelector: "#old-login-button",
    action: "click",
    description: "Login button",
    lastKnownGood: {
      selector: "#old-login-button",
      role: "button",
      text: "Sign In",
      attributes: { class: "btn-primary" },
    },
  });

  if (result.success) {
    console.log("✅ Test healed!");
    console.log(`   Old: #old-login-button`);
    console.log(`   New: ${result.newSelector}`);
    console.log(`   Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    console.log(`   Strategy: ${result.strategy}`);
  } else {
    console.log("❌ Could not heal test");
  }
}

// ============================================
// Example 6: AI-Powered Assertions (via Surf)
// ============================================

async function _runAiAssertions() {
  const surf = new SurfClient();

  await surf.goto("https://myapp.com");

  // Use ChatGPT to analyze the page (no API key needed!)
  const analysis = await surf.queryChatGPT(
    "Analyze this page for UX issues. Check for: confusing navigation, unclear CTAs, accessibility concerns.",
    { withPage: true },
  );

  console.log("AI Analysis:", analysis);

  // Use Gemini for visual analysis
  const visualAnalysis = await surf.queryGemini(
    "Describe the visual hierarchy of this page. Is it clear what the user should do first?",
    { withPage: true },
  );

  console.log("Visual Analysis:", visualAnalysis);

  // Use Perplexity for research
  const research = await surf.queryPerplexity(
    "What are the best practices for this type of landing page?",
    { mode: "research" },
  );

  console.log("Research:", research);
}

// ============================================
// Example 7: Network Analysis
// ============================================

async function _runNetworkAnalysis() {
  const surf = new SurfClient({ networkCapture: true });

  await surf.goto("https://myapp.com");

  // Interact with the page
  await surf.click('[data-testid="search"]');
  await surf.type("test query");
  await surf.press("Enter");

  await surf.wait({ network: true });

  // Get network requests
  const requests = await surf.getNetwork({
    excludeStatic: true,
    since: "1m",
  });

  console.log("Network Activity:");
  for (const req of requests) {
    console.log(`  ${req.method} ${req.url} - ${req.status} (${req.duration}ms)`);

    if (req.status >= 400) {
      const body = await surf.getNetworkBody(req.id);
      console.log(`    Error body: ${body.slice(0, 200)}`);
    }
  }

  // Generate curl for replay
  for (const req of requests.filter((r) => r.method === "POST")) {
    const _curl = await surf.getNetworkRequest(req.id);
    console.log(`\nReplay: curl ${req.url} ...`);
  }
}

// ============================================
// Run Examples
// ============================================

async function main() {
  console.log("🚀 NEXUS Testing Framework Examples\n");

  console.log("━".repeat(50));
  console.log("Example 1: Autonomous Test");
  console.log("━".repeat(50));
  await runAutonomousTest();

  console.log(`\n${"━".repeat(50)}`);
  console.log("Example 2: Surf Flow Test");
  console.log("━".repeat(50));
  await runSurfFlowTest();

  console.log(`\n${"━".repeat(50)}`);
  console.log("Example 3: Quantum Simulation");
  console.log("━".repeat(50));
  await runQuantumSimulation();

  console.log(`\n${"━".repeat(50)}`);
  console.log("Example 4: Prediction Analysis");
  console.log("━".repeat(50));
  await runPredictionAnalysis();

  console.log(`\n${"━".repeat(50)}`);
  console.log("Example 5: Self-Healing Test");
  console.log("━".repeat(50));
  await runSelfHealingTest();
}

main().catch(console.error);
