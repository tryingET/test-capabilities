# Examples

> Common NEXUS usage patterns.

---

## Example 1: Quick Smoke Test

```bash
nexus test --quick --target https://myapp.com
```

Use for: Pre-commit hooks, quick validation.

---

## Example 2: Full Autonomous Suite

```bash
nexus test --target https://myapp.com \
  --autonomous \
  --self-heal \
  --predict \
  --report ./reports
```

Use for: Nightly runs, release validation.

---

## Example 3: Browser Flow Testing

```typescript
import { SurfClient, SurfFlowBuilder } from '@nexus/testing-framework';

const surf = new SurfClient();

const flow = new SurfFlowBuilder(surf)
  .goto('https://myapp.com/login')
  .type('e5', 'test@example.com')
  .type('e6', 'password')
  .click('e7', 'Submit')
  .waitForElement('[data-testid="dashboard"]')
  .screenshot();

const result = await flow.execute();
console.log('Passed:', result.success);
```

---

## Example 4: Self-Healing

```typescript
import { SelfHealingEngine } from '@nexus/testing-framework';

const healer = new SelfHealingEngine();

const result = await healer.heal({
  originalSelector: '#old-login-btn',
  action: 'click',
  description: 'Login button',
  lastKnownGood: { role: 'button', text: 'Sign In' },
});

// result.newSelector = 'role=button[name="Sign In"]'
// result.confidence = 0.85
```

---

## Example 5: Failure Prediction

```typescript
import { PredictionEngine } from '@nexus/testing-framework';

const engine = new PredictionEngine();

const predictions = await engine.analyze({
  errorRate: 0.05,
  responseTimeP95: 1200,
  rageClickRate: 0.08,
  // ... more metrics
});

// predictions[0] = {
//   component: 'checkout',
//   probability: 0.34,
//   trigger: 'high traffic',
//   preventiveAction: 'Add rate limiting'
// }
```

---

## Example 6: Quantum Edge Case Discovery

```typescript
import { QuantumTestRunner } from '@nexus/testing-framework';

const runner = new QuantumTestRunner({
  branches: 1000,
  collapseStrategy: 'significance',
});

const result = await runner.run('https://myapp.com');

console.log('Rare bugs:', result.rareBugs);
// [{ description: 'Race condition in cart', probability: '0.3%' }]
```

---

## Example 7: AI-Powered Analysis (No API Keys)

```typescript
import { SurfClient } from '@nexus/testing-framework';

const surf = new SurfClient();
await surf.goto('https://myapp.com');

// Uses your browser login - no API keys needed!
const analysis = await surf.queryChatGPT('Analyze UX issues', { 
  withPage: true 
});

const summary = await surf.queryGemini('Summarize this page');
```

---

## Example 8: CI/CD Integration

```yaml
# .github/workflows/nexus.yml
name: NEXUS Testing

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install NEXUS
        run: npm install -g @nexus/testing-framework
      
      - name: Run Tests
        run: nexus test --target ${{ secrets.APP_URL }} --fail-threshold high
```

---

## More Resources

- [API Reference](api-reference.md)
- [Patterns](patterns.md)
- [Configuration](config.md)
