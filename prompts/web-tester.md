---
summary: "Prompt template for generating an LLM-driven web-app tester."
read_when:
  - "You need a reusable prompt for browser or property-based testing automation"
  - "You are bootstrapping a web-focused test agent"
type: "prompt"
---

# Web App Tester Prompt

Use this prompt to create an LLM-driven tester for web applications.

---

## Option 1: Bombadil (Property-Based)

```
Create a Bombadil specification for testing [APP_NAME] at [APP_URL].

The spec should include:
1. Default actions (re-export from defaults/actions)
2. Custom invariants:
   - [INVARIANT_1: e.g., "always has visible navigation"]
   - [INVARIANT_2: e.g., "no console errors"]
   - [INVARIANT_3: e.g., "all forms have submit buttons"]
3. Guarantees (temporal properties):
   - [GUARANTEE_1: e.g., "loading states resolve within 5s"]
   - [GUARANTEE_2: e.g., "form submissions show feedback"]

Output:
1. spec.ts (TypeScript specification file)
2. Command to run: bombadil test [APP_URL] spec.ts --headless
3. How to interpret violations

Requirements:
- Use @antithesishq/bombadil types
- Include comments explaining each property
```

---

## Option 2: Stagehand (AI Navigation)

```
Create a Stagehand test suite for [APP_NAME] at [APP_URL].

The test should:
1. Navigate to [APP_URL]
2. Test user flows:
   - [FLOW_1: e.g., Login with test credentials]
   - [FLOW_2: e.g., Create a new item]
   - [FLOW_3: e.g., Search and filter]
3. Extract and verify data at each step
4. Handle errors gracefully

Stack:
- @browserbasehq/stagehand
- Zod for schema validation
- Node.js/TypeScript

Output:
1. tests/[flow-name].ts for each flow
2. tests/helpers.ts for shared utilities
3. package.json with dependencies
4. Run command: npx ts-node tests/login.ts
```

---

## Option 3: pi-agent-browser (LLM in pi)

```
Using pi with pi-agent-browser extension, test [APP_NAME].

Ask the LLM to:
1. Open [APP_URL]
2. Take a snapshot to understand the page structure
3. Execute these flows:
   - [FLOW_1]
   - [FLOW_2]
   - [FLOW_3]
4. Take screenshots at key points
5. Report any issues found

The LLM will use these browser commands:
- browser open <url>
- browser snapshot -i (get interactive elements with @refs)
- browser click @e1
- browser fill @e2 "text"
- browser screenshot
- browser close
```

---

## Example: Bombadil Spec

```typescript
// spec.ts for an e-commerce site
import { always, eventually, extract, now } from "@antithesishq/bombadil";
export { clicks, inputs } from "@antithesishq/bombadil/defaults/actions";

// Extractors
const cart_count = extract((state) =>
    state.document.querySelector(".cart-count")?.textContent ?? "0"
);
const is_loading = extract((state) =>
    !!state.document.querySelector(".spinner")
);

// Invariant: Cart count is always a number
export const valid_cart = always(() => 
    /^\d+$/.test(cart_count.current)
);

// Guarantee: Loading finishes within 10 seconds
export const finishes_loading = 
    now(() => is_loading.current)
        .implies(
            eventually(() => !is_loading.current).within(10, "seconds")
        );
```

## Run

```bash
bombadil test https://shop.example.com spec.ts --headless --exit-on-violation
```

---

## What the framework's own browser surface will and will not do

Whatever you generate, when it runs through `test-capabilities` the browser is reached through
one kernel `Session` (`docs/api/api-surf.md`), and the session refuses rather than guesses. Write
tests that fit these rules and they run; write tests that fight them and they are refused with a
message naming the fix.

- **One tab, and it is the run's own.** The session opens the tab, points every step at it and
  closes it in `finally`. A step that names another tab, or that runs before the tab exists, is
  refused with `owned_tab_required`. Do not write a test that assumes a tab is already open, or
  that switches tabs or windows.
- **Every step declares what it does.** The effect class comes from the surf command's static
  map, not from the test: `extract`, `wait.ready`, `page.*`, `screenshot`, `frame.diagnose` and
  the network/console/cookie reads are read-only; `click`, `type`, `key`, `select`, `go`, `back`,
  `forward` and `reload` change the target and need the origin in `mutation.allowOrigins`.
- **Page-side `js` has no class.** Say what a script does: `{ effect: 'read_only', reason }` for
  a script that reads, `{ effect: 'mutating', scope: 'target', reason }` for one that assigns,
  submits, clicks, fetches or touches storage. A `read_only` claim is checked against a denylist
  before anything runs, and a hit is refused (`read_only_violation`) with the advice to declare
  it mutating instead. Prefer probes that read: `location.href`, `document.title`,
  `document.readyState`, element counts, anchor hrefs.
- **A mutating step runs once.** No retries, one durable receipt, and a step whose process
  reported nothing is `unknown` and locks that key until an operator supersedes it. Write
  assertions that survive being run once.
- **A read-only step may retry, until the page moves.** If a probe answers from a URL the page
  was never gated on, the remaining budget is forfeit (`read_only_violation_observed`). Do not
  build a test whose retry depends on a navigation.
- **A page that never settles is not probed.** `wait.ready` accepts only `ready`; a login wall,
  a challenge, a 404 or an unresolved load is a typed refusal carrying surf's own code, not a
  failed assertion about your app. Never write a test that logs in.
