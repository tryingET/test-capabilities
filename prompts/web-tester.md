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
