---
summary: "API reference for quantum simulation types and execution surfaces."
read_when:
  - "You are using or extending quantum simulation"
  - "You need method-level details for quantum APIs"
type: "reference"
---

# Quantum API

> Parallel universe test simulation.

---

## Concept

Quantum simulation runs thousands of parallel test paths simultaneously, then "collapses" the results to find significant edge cases and rare bugs.

```
         ┌─────────────────────────────────────┐
         │         QUANTUM SIMULATION          │
         └─────────────────┬───────────────────┘
                           │
     ┌─────────┬─────────┬─┴─────────┬─────────┬─────────┐
     │         │         │           │         │         │
     ▼         ▼         ▼           ▼         ▼         ▼
  Branch 1  Branch 2  Branch 3   Branch 4  Branch 5  Branch N
  (seed 1)  (seed 2)  (seed 3)   (seed 4)  (seed 5)  (seed N)
     │         │         │           │         │         │
     └─────────┴─────────┴─────┬─────┴─────────┴─────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  COLLAPSE WAVEFORM  │
                    │  (Find significant  │
                    │   discoveries)      │
                    └─────────────────────┘
```

---

## QuantumTestRunner

### Constructor

```typescript
import { QuantumTestRunner } from 'test-capabilities';

const runner = new QuantumTestRunner({
  branches: 1000,              // Number of parallel universes
  collapseStrategy: 'significance', // How to collapse results
  maxDepth: 20,                // Max actions per branch
  timeout: 60000,              // Overall timeout (ms)
  seed?: 12345,                // Optional: reproducible runs
});
```

### `run(url)`

```typescript
const result = await runner.run('https://myapp.com');
```

---

## Result

```typescript
interface QuantumResult {
  branchesSimulated: number;      // Universes run
  uniquePaths: number;            // Unique paths discovered
  collapsedFindings: Discovery[]; // Significant findings
  edgeCases: Discovery[];         // Backed edge-case findings
  rareBugs: Discovery[];          // Deduplicated bug findings in <1% of paths
  coverage: QuantumCoverage;      // Coverage metrics
  duration: number;               // Total time (ms)
}

interface Discovery {
  type: 'bug' | 'edge_case' | 'rare_path' | 'performance_issue' | 'ux_issue';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  reproduction: QuantumAction[];  // Steps to reproduce
  probability: number;            // How rare (lower = rarer)
  evidence: string[];
}

interface QuantumCoverage {
  elements: number;       // Unique elements touched
  paths: number;          // Unique paths
  states: number;         // Unique page states
  transitions: number;    // Unique state transitions
}
```

---

## Example

```typescript
const runner = new QuantumTestRunner({
  branches: 1000,
  collapseStrategy: 'significance',
});

const result = await runner.run('https://myapp.com');

console.log(`Simulated ${result.branchesSimulated} universes`);
console.log(`Found ${result.uniquePaths} unique paths`);
console.log(`Discovered ${result.rareBugs.length} rare bugs`);

for (const bug of result.rareBugs) {
  console.log(`\n🐛 ${bug.description}`);
  console.log(`   Probability: ${bug.probability}`);
  console.log(`   Severity: ${bug.severity}`);
}

// Simulated 1000 universes
// Found 847 unique paths
// Discovered 2 rare bugs
//
// 🐛 Race condition in cart update
//    Probability: 0.003
//    Severity: high
```

`edgeCases` is backed by concrete heuristics (for example non-form input targets or non-URL navigation targets) rather than a permanently empty placeholder array.
`rareBugs` is deduplicated by semantic finding description so repeat observations do not inflate the count.

---

## Collapse Strategies

| Strategy | Description | Use When |
|----------|-------------|----------|
| `significance` | Only high/critical severity | Production testing |
| `diversity` | One finding per type | Broad exploration |
| `coverage` | Maximize path coverage | Coverage analysis |

---

## QuantumSimulator (Low-Level)

For more control, use the simulator directly.

### Constructor

```typescript
import { QuantumSimulator } from 'test-capabilities';

const simulator = new QuantumSimulator({
  branches: 1000,
  collapseStrategy: 'significance',
  maxDepth: 20,
  timeout: 60000,
});
```

### `simulate(initialState)`

```typescript
const result = await simulator.simulate({
  url: 'https://myapp.com',
  elements: ['button.login', 'input.email', 'a.about'],
  forms: ['login-form'],
  errors: [],
  network: { requestCount: 0, errorCount: 0, avgLatency: 100, slowRequests: [] },
  performance: { tti: 1500, fcp: 800, lcp: 1200, cls: 0.05 },
});
```

---

## CLI Usage

```bash
# Run with 100 branches (default)
test-capabilities quantum --target https://myapp.com

# Run with 1000 branches
test-capabilities quantum --target https://myapp.com --branches 1000

# Fail closed on invalid branch counts
# test-capabilities quantum --target https://myapp.com --branches 0

# Fail closed on invalid targets
# test-capabilities quantum --target not-a-url --branches 10
```

`--target` must be a valid URL.
`--branches` must be a positive integer branch count.

---

## Performance Tips

| Branches | Time | Use Case |
|----------|------|----------|
| 100 | ~1 min | Quick exploration |
| 500 | ~5 min | Standard testing |
| 1000 | ~10 min | Deep exploration |
| 5000 | ~30 min | Comprehensive (rare bugs) |
