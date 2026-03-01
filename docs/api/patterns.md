# Integration Patterns

> Common patterns for using TEST-CAPABILITIES.

---

## Pattern: Full Test Suite

Run complete autonomous testing.

```typescript
import { createNexus, PredictionEngine } from '@test-capabilities/testing-framework';

async function runFullTestSuite(target: string) {
  // 1. Configure TEST-CAPABILITIES
  const test-capabilities = createNexus({
    version: '2.0',
    name: 'Full Suite',
    targets: { web: target },
    agents: {
      explorer: { type: 'bombadil', intensity: 'aggressive' },
      navigator: { type: 'surf', ai_validation: true },
    },
    intelligence: {
      selfHealing: true,
      prediction: true,
    },
    quantum: { enabled: true, branches: 100 },
  });

  // 2. Run tests
  const result = await test-capabilities.run();

  // 3. Generate report
  return {
    health: calculateHealth(result.findings),
    bugs: result.findings.filter(f => f.type === 'bug'),
    coverage: result.coverage,
    predictions: result.predictions,
  };
}
```

---

## Pattern: User Flow Testing

Test specific user journeys.

```typescript
import { SurfClient, SurfFlowBuilder } from '@test-capabilities/testing-framework';

async function testCheckoutFlow(baseUrl: string) {
  const surf = new SurfClient({ autoScreenshot: true });

  const flow = new SurfFlowBuilder(surf)
    .goto(`${baseUrl}/products/widget`)
    .click('e5', 'Add to cart')
    .click('e10', 'Cart icon')
    .click('e15', 'Checkout')
    .type('e20', '4242424242424242')
    .type('e21', '12/25')
    .type('e22', '123')
    .click('e25', 'Place order')
    .waitForElement('[data-testid="order-confirmation"]')
    .screenshot()
    .assert('Order confirmed', async () => {
      const text = await surf.pageText();
      return text.includes('Order confirmed');
    });

  return flow.execute();
}
```

---

## Pattern: Self-Healing Maintenance

Maintain tests with self-healing.

```typescript
import { TestFileHealer } from '@test-capabilities/testing-framework';

async function maintainTests(testsDir: string) {
  const healer = new TestFileHealer();
  const files = await glob(`${testsDir}/**/*.spec.ts`);

  const results = { auto: 0, review: 0, skipped: 0 };

  for (const file of files) {
    const proposals = await healer.analyzeFile(file);

    for (const p of proposals) {
      if (p.confidence >= 0.9) {
        await healer.applyProposal(p);
        results.auto++;
      } else if (p.confidence >= 0.7) {
        console.log(`Review needed: ${file}:${p.line}`);
        results.review++;
      } else {
        results.skipped++;
      }
    }
  }

  return results;
}
```

---

## Pattern: Continuous Monitoring

Ongoing prediction and alerting.

```typescript
import { PredictionEngine, PredictionCollector } from '@test-capabilities/testing-framework';

async function startMonitoring() {
  const engine = new PredictionEngine();
  const collector = new PredictionCollector();

  setInterval(async () => {
    const metrics = await collector.collectMetrics('auto');
    const predictions = await engine.analyze(metrics);

    const critical = predictions.filter(
      p => p.probability > 0.7 && p.riskScore > 0.8
    );

    for (const p of critical) {
      await sendAlert({
        component: p.component,
        probability: p.probability,
        action: p.preventiveAction,
      });
    }
  }, 60000); // Every minute
}
```

---

## Pattern: CI/CD Pipeline

GitHub Actions integration.

```yaml
# .github/workflows/test-capabilities.yml
name: TEST-CAPABILITIES Testing

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2am

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install TEST-CAPABILITIES
        run: npm install -g @test-capabilities/testing-framework

      - name: Quick Test (PR)
        if: github.event_name == 'pull_request'
        run: test-capabilities test --quick --target ${{ secrets.APP_URL }}

      - name: Full Test (Main)
        if: github.event_name == 'push'
        run: |
          test-capabilities test \
            --target ${{ secrets.APP_URL }} \
            --config ./test-capabilities.yaml \
            --fail-threshold high \
            --report ./reports

      - name: Nightly Deep Test
        if: github.event_name == 'schedule'
        run: |
          test-capabilities test --target ${{ secrets.APP_URL }} --autonomous
          test-capabilities quantum --target ${{ secrets.APP_URL }} --branches 500

      - name: Upload Report
        uses: actions/upload-artifact@v4
        with:
          name: test-capabilities-report
          path: ./reports
```

---

## Pattern: Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running TEST-CAPABILITIES quick check..."

test-capabilities test --quick --target http://localhost:3000

if [ $? -ne 0 ]; then
  echo "❌ TEST-CAPABILITIES found issues. Fix before committing."
  exit 1
fi

echo "✅ TEST-CAPABILITIES checks passed"
```

---

## Pattern: Parallel Testing

Run multiple targets in parallel.

```typescript
import { createNexus } from '@test-capabilities/testing-framework';

async function testMultipleTargets(targets: string[]) {
  const results = await Promise.all(
    targets.map(async (target) => {
      const test-capabilities = createNexus({
        version: '2.0',
        name: target,
        targets: { web: target },
      });
      return { target, result: await test-capabilities.run() };
    })
  );

  return results.map(({ target, result }) => ({
    target,
    health: calculateHealth(result.findings),
    bugs: result.findings.length,
  }));
}
```

---

## Pattern: Visual Regression

```typescript
import { SurfClient } from '@test-capabilities/testing-framework';
import { compareImages } from './image-diff';

async function visualRegression(
  baseUrl: string,
  baselineDir: string
) {
  const surf = new SurfClient();
  await surf.goto(baseUrl);

  const pages = ['/', '/about', '/contact'];
  const results = [];

  for (const page of pages) {
    await surf.goto(`${baseUrl}${page}`);
    const screenshot = await surf.screenshot({ output: `/tmp/${page}.png` });

    const baseline = `${baselineDir}/${page}.png`;
    const diff = await compareImages(`/tmp/${page}.png`, baseline);

    results.push({
      page,
      changed: diff > 0.01,
      diffPercentage: diff,
    });
  }

  return results;
}
```

---

## Pattern: API Testing

```typescript
import { SurfClient } from '@test-capabilities/testing-framework';

async function testAPI(baseUrl: string) {
  const surf = new SurfClient({ networkCapture: true });

  // Trigger API calls via browser
  await surf.goto(baseUrl);
  await surf.click('[data-testid="load-data"]');

  // Analyze network requests
  const requests = await surf.getNetwork({
    origin: 'api.myapp.com',
    type: 'json',
  });

  const results = [];

  for (const req of requests) {
    const body = await surf.getNetworkBody(req.id);
    results.push({
      endpoint: req.url,
      status: req.status,
      duration: req.duration,
      valid: validateResponse(req.url, body),
    });
  }

  return results;
}
```
