---
summary: "Low-level CdpActions evaluation recovery intent: arbitrary scripts do not replay; explicitly pure reads may recover within the context-error budget."
read_when:
  - "Migrating a low-level CDP caller that relied on automatic context recovery."
  - "Choosing frame/world addressing independently of script effect intent."
type: reference
---

# CDP evaluation recovery intent

`CdpActions` is returned by `openCdpActions`. Its evaluation method preserves existing
frame/world addressing and adds an optional third recovery-intent argument. The method's
function type is:

```typescript
type CdpEvaluation = <T = unknown>(
  expression: string,
  frame?: string | { frame?: string; world?: 'page' | 'isolated' },
  effect?: 'read_only' | 'mutating',
) => Promise<T>;
```

Omitted intent defaults to no body replay, as does `mutating`. A lost context after script
dispatch cannot prove the script had no effects. Acquisition precedes execution; recognized
stale-context errors may consume one bounded recovery. Only an explicitly pure `read_only`
body may be invoked again. An isolated world is not a purity declaration.

For example, `actions.evaluate('document.title', { world: 'isolated' }, 'read_only')` opts in
for that pure read. Low-level intent does not grant mutation authorization or automatically
create a receipt. The owning `Session`/kernel declaration and ledger govern mutating work;
sent context-loss mutations remain unknown and receipt interlocks prevent replay.

A successful probe showing a missing/mismatched ownership stamp requires fresh world
acquisition. That is separate from the stale-context-error budget, not permission to repeat
a mutating body. Original errors are preserved rather than replaced with a later refusal.

This is source/fixture-qualified behavior, not live-browser acceptance, purity enforcement,
atomic navigation proof or a promise to restore an interrupted page/session.
