---
summary: "API reference for self-healing engine and test file healing surfaces."
read_when:
  - "You are integrating or extending self-healing behavior"
  - "You need method-level details for healing APIs"
type: "reference"
---

# Self-Healing API

> Tests that fix themselves when UI changes.

---

## SelfHealingEngine

### Constructor

```typescript
const healer = new SelfHealingEngine();
```

### `heal(context)`

Attempt to fix a broken selector.

```typescript
const result = await healer.heal({
  originalSelector: '#old-login-btn',
  action: 'click',  // 'click' | 'fill' | 'assert' | 'hover'
  description: 'Login button',
  screenshot?: buffer,       // Optional: for vision AI
  lastKnownGood?: {
    selector: string,
    role?: string,
    text?: string,
    label?: string,
    position?: { x: number; y: number },
    attributes: Record<string, string>,
  },
});
```

### Result

```typescript
interface HealingResult {
  success: boolean;
  newSelector?: string;
  confidence: number;  // 0-1
  strategy: string;    // Strategy name
  metadata?: {
    requiresReview?: boolean;
  };
}
```

### Example

```typescript
const healer = new SelfHealingEngine();

const result = await healer.heal({
  originalSelector: '#old-login-btn',
  action: 'click',
  description: 'Login button',
  lastKnownGood: {
    role: 'button',
    text: 'Sign In',
    attributes: { class: 'btn-primary' },
  },
});

if (result.success && result.confidence >= 0.8) {
  console.log(`Fixed: ${result.newSelector}`);
  console.log(`Strategy: ${result.strategy}`);
}
// Fixed: role=button[name="Sign In"]
// Strategy: role-fallback
```

---

## Healing Strategies

Executed in priority order until success:

| Priority | Strategy | Success Rate | Description |
|----------|----------|--------------|-------------|
| 1 | `legacy-prefix-trim` | heuristic | Normalizes stale prefixes such as `old-` / `deprecated-` while preserving selector style |
| 2 | `testid-fallback` | 95% | Find by `data-testid` |
| 3 | `role-fallback` | 85% | Find by ARIA role |
| 4 | `text-search` | 70% | Find by text content |
| 5 | `vision-ai` | 65% | Use vision AI on screenshot |
| 6 | `xpath-fallback` | 90% | Find by XPath |
| 7 | `nearby-search` | 50% | Find near last known position |

### Register Custom Strategy

```typescript
healer.register({
  name: 'custom-strategy',
  priority: 15,  // Between testid and role
  execute: async (context) => {
    // Your logic here
    return {
      success: true,
      newSelector: '...',
      confidence: 0.8,
      strategy: 'custom-strategy',
    };
  },
});
```

---

## TestFileHealer

Analyze and fix test files.

### Constructor

```typescript
const healer = new TestFileHealer();
```

### `analyzeFile(filePath)`

Find broken selectors in a test file.

```typescript
const proposals = await healer.analyzeFile('./tests/login.spec.ts');
```

When the CLI healing path scans a directory, it skips common generated/dependency directories such as `node_modules`, `dist`, `coverage`, and `.git`.
The current heuristic path can also normalize obviously stale selector prefixes like `old-login` → `login` when the extracted selector shape is preserved.

### Proposal

```typescript
interface HealingProposal {
  file: string;
  line: number;
  column?: number;
  oldSelector: string;
  newSelector: string;
  confidence: number;
  strategy: string;
  requiresReview: boolean;
}
```

### `applyProposal(proposal)`

Apply a fix to the file.
The runtime targets the proposal's recorded line and, when available, column so duplicate selectors elsewhere in the file are not rewritten accidentally.

```typescript
await healer.applyProposal(proposal);
```

### Example

```typescript
const healer = new TestFileHealer();

const proposals = await healer.analyzeFile('./tests/login.spec.ts');

// Group by confidence
const auto = proposals.filter(p => p.confidence >= 0.9);
const review = proposals.filter(p => p.confidence >= 0.7 && p.confidence < 0.9);

// Auto-apply high confidence fixes
for (const p of auto) {
  await healer.applyProposal(p);
  console.log(`Fixed line ${p.line}: ${p.oldSelector} → ${p.newSelector}`);
}

// Show those needing review
for (const p of review) {
  console.log(`Review: ${p.file}:${p.line}`);
  console.log(`  - ${p.oldSelector}`);
  console.log(`  + ${p.newSelector}`);
}
```

---

## CLI Usage

```bash
# Analyze broken tests (directory must exist)
test-capabilities heal --dir ./tests

# Dry run (show fixes without applying)
test-capabilities heal --dir ./tests --dry-run
```
