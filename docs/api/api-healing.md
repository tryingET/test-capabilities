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

A result is only considered `success: true` when the engine reaches the current verification threshold (`confidence >= 0.7`).
Heuristic strategies that are not backed by a real verification path now fail closed instead of inventing pseudo-selectors, and they surface `metadata.requiresReview: true` so speculative ideas are not mislabeled as verified healing.

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

Analyze, verify, and fix test files.

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
Selector extraction is intentionally narrowed to selector-bearing call positions (for example `locator(...)`, `getByTestId(...)`, `page.click(selector)`, or `page.fill(selector, value)`) so ordinary payload literals such as `fill('old-password')` are not rewritten as if they were selectors.
Legacy-looking strings on custom helpers like `actor.click('old-submit-label')` are likewise ignored unless the call position is one the runtime knows semantically owns a selector.

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

### `verifyProposals(proposals)`

Check whether a proposal set can be applied in memory to the current files without writing changes.

```typescript
const verification = await healer.verifyProposals(proposals);
console.log(verification.status); // 'pass' | 'fail'
```

This is an applicability check for the proposal coordinates and selector text. It does not run the test suite or prove product correctness.

### Dry-run proposal and verification artifacts

The CLI operation can write durable dry-run artifacts with `proposalOutput` / `--proposal-output` and `verificationOutput` / `--verification-output`.
These artifacts are intentionally review-oriented and replay-ledger-friendly: they record the proposal set, scanned file count, in-memory applicability verification, and mutation posture without applying changes.
They also mark that applying the proposal later requires an external checkpoint/restore authority and that Replay Fabric-style use is guidance-only. If `checkpointRef` is supplied, it is copied into the artifact mutation posture as an external reference.

```typescript
const output = await executeHealOperation({
  dir: './tests',
  dryRun: true,
  proposalOutput: './artifacts/heal-proposals.json',
  verificationOutput: './artifacts/heal-verification.json',
});

console.log(output.proposalArtifact?.path);
console.log(output.verificationArtifact?.path);
```

The artifacts are only supported for dry runs. If `proposalOutput` or `verificationOutput` is provided while `dryRun` is false, the operation fails closed.

Mutation mode (`dryRun: false`) requires `checkpointRef` when proposals would be applied. The ref must come from an external checkpoint/restore authority; `test-capabilities` records the identity but does not create checkpoints or perform rollback.

### `applyProposals(proposals)`

Apply a batch of proposals transactionally.
The current runtime validates the full per-file batch against the original file content before it writes anything, which prevents same-line proposal sets from drifting into partial mutations.

```typescript
await healer.applyProposals(proposals);
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

# Dry run with durable proposal + verification artifacts for review / replay-ledger follow-through
test-capabilities heal --dir ./tests --dry-run \
  --proposal-output artifacts/heal-proposals.json \
  --verification-output artifacts/heal-verification.json

# Apply proposals only after an external checkpoint exists
test-capabilities heal --dir ./tests --checkpoint-ref checkpoint/test-capabilities/heal-001
```
