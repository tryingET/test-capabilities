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
  fileSha256?: string; // the content this proposal was made against; the write's precondition
  line: number;
  column?: number;
  oldSelector: string;
  newSelector: string;
  confidence: number;
  strategy: string;
  requiresReview: boolean;
  triggeringFindingId?: string;
  frameCaveat?: {          // a frame boundary may explain the failure (slice S8)
    determination: 'suspected';
    findingId?: string;
    reason: string;
    candidates: Array<{ domIndex: number | null; origin: string | null; primaryTag: string | null }>;
  };
}
```

### Frame determinations: refuse, caveat, heal

A finding from a browser step carries `frameRootCause` when the run diagnosed why an element
could not be reached (`docs/api/api-surf.md`). The healer reads that typed determination - the
`frame-root-cause:` marker line in `evidence` is read only for a finding written before the
field existed - and derives what it may do:

| determination | what the healer does |
|---|---|
| `excluded`, or no determination at all | proposes as before |
| `suspected` | proposes, with `requiresReview: true` forced and a typed `frameCaveat` naming the candidate frames a reviewer must check. `heal --apply` refuses it |
| `confirmed` | no proposal. A `HealingRefusal` records the selector, the reason and the `frame.switch` the repair actually needs (`index`/`frameId`, `urlPrefix`, `hops`) |
| `undetermined`, `unavailable` | no proposal. A `HealingRefusal` records the reason and no suggestion: there is no candidate list a reviewer could check |

The asymmetry is deliberate. A rewrite aimed at a target inside a frame is wrong by
construction - the healer has no live check that would catch a lookalike element in the main
document going green - so a `confirmed` boundary refuses outright. But most real pages carry at
least one third-party frame, and a healer that goes silent on every page with a consent banner
or an ad frame gets turned off; so a `suspected` boundary keeps the proposal and removes it from
the apply path instead. What that costs is real and is not hidden: **a frame-suspected page
never heals without a human review**, and no v1 mechanism lifts that without an in-frame probe.

```typescript
const proposals = await healer.analyzeFile(file, findings);
const refusals = healer.frameRefusals();   // review artifacts; apply never consumes one
```

```typescript
interface HealingRefusal {
  triggeringFindingId?: string;
  selector: string;
  reason: string;
  code: 'heal_frame_refused';
  suggestion?: { kind: 'frame.switch'; index?: number; frameId?: number; urlPrefix: string; hops: number };
}
```

Extension frame ids are per page load, so a suggestion always carries the origin as well and a
consumer must re-diagnose before switching. `heal --json` reports `refusals[]` next to
`proposals[]`, and a dry-run proposal artifact carries both plus `summary.refusal_count`.

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

To apply a reviewed proposal artifact instead of recomputing proposals, pass `proposalInput` with the same intended mutation boundary in `dir` plus `checkpointRef`:

```typescript
await executeHealOperation({
  dir: './tests',
  proposalInput: './artifacts/heal-proposals.json',
  checkpointRef: 'checkpoint/test-capabilities/heal-001',
});
```

`proposalInput` artifacts are caller-controlled instruction packets, so the operation fails closed unless the artifact is schema v1, each proposal is non-review-required, and every target is an absolute, regular, non-symlink file inside `dir`.

### `applyProposals(proposals, context?)`

Apply a batch of proposals as one conditional write per file, and return the files whose rewrite
was proven together with the receipts of the run.

Each file is an `EffectStep` on the kernel mutation ledger (`src/core/effects.ts`):

- **Keyed** by `sha256(file | the content it was planned against | the change)`. A legitimate
  second heal of a further-drifted file gets a new key; replaying the same plan against the same
  content does not.
- **Conditional**: `analyzeFile` records the file's `sha256` on every proposal it emits, the
  ledger re-reads and compares it immediately before the rename, and a mismatch refuses with
  `precondition_failed` having written nothing. A proposal artifact written before 0.4.0 carries
  no hash; it still applies, and its receipt records `precondition: absent (legacy proposal
  artifact)`.
- **Receipted**: the receipt reaches `receipts.dir` and is fsynced *before* the write, and is
  rewritten atomically after it. A receipt left `attempting` or `unknown` refuses the next run
  for that key until an operator passes `--supersede-receipt <receipt_id>`.
- **Verified**: the after-hash read-back is the step's `verify`. It can promote an `unknown`
  write to `applied`; it can never turn one into a failure.
- **Compensated, narrowly**: when a write fails after earlier files landed, only siblings whose
  own receipt says `applied` are restored, each through its own receipt carrying
  `compensation_of`. A write whose rename threw is `unknown` and is never compensated, because
  the restore could destroy the very content whose fate is unknown.

The older guards still stand in front of all this: the full per-file batch is validated against
the original content before anything is written, and a selector only matches as a whole token, so
`#btn` -> `#btn-new` re-applied to an already healed line is refused as a selector mismatch
instead of producing `#btn-new-new`.

```typescript
const { written, receipts } = await healer.applyProposals(proposals);
// written:  absolute paths of the files that were rewritten
// receipts: one MutationReceipt per step, in the order they were opened
```

The `heal` envelope's `appliedCount` is the number of proposals whose file has an `applied`
receipt, never the number of planned proposals. `--receipt-output <file>` exports the run's
receipts as one `test-capabilities.heal.receipts` artifact; the per-receipt files under
`receipts.dir` are written either way, and they are what the interlock reads.

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

# Evidence-backed dry run: cite diagnostic findings as triggeringFindingId in proposals
test-capabilities heal --dir ./tests --dry-run \
  --findings-input artifacts/orchestrator-findings.json \
  --proposal-output artifacts/heal-proposals.json

# Apply proposals only after an external checkpoint exists
test-capabilities heal --dir ./tests --checkpoint-ref checkpoint/test-capabilities/heal-001

# Apply and export the run's mutation receipts for review
test-capabilities heal --dir ./tests --checkpoint-ref checkpoint/heal-001 \
  --receipt-output artifacts/heal-receipts.json

# After inspecting the subject of a receipt that is still attempting or unknown
test-capabilities heal --dir ./tests --checkpoint-ref checkpoint/heal-002 \
  --supersede-receipt 6f1c2f4e-0f2a-4a1e-9a2b-6f0a1d3c7e55
```

Receipts live under `receipts.dir`, which for `heal` defaults to `<--dir>/.test-capabilities/receipts`
(`TEST_CAPABILITIES_RECEIPTS_DIR` overrides it). Nothing there is ever deleted by the framework;
deleting it by hand is an interlock reset with the same standing as `--supersede-receipt`. A
store that does not survive the run — `$TMPDIR`, a CI job workspace, a linked git worktree — is
refused with `mutation_receipts_ephemeral` unless `receipts.ephemeral: true` (or
`TEST_CAPABILITIES_RECEIPTS_EPHEMERAL=1`) accepts it, which every receipt then records.

`--findings-input` accepts exactly one of a bare findings array, an object with `findings`, or full `test --json` output with `result.findings`. The findings are caller-supplied diagnostic evidence, not causal authority; malformed or ambiguous inputs fail closed, and equivalent selector spellings such as `getByTestId('old-login')`, `[data-testid="old-login"]`, and `[data-testid='old-login']` are normalized only for deterministic matching.
