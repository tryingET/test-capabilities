# API Tester Prompt

Use this prompt to create an LLM-driven tester for REST/GraphQL APIs.

---

## Prompt

```
Create an LLM-driven API tester for [API_NAME] at [API_BASE_URL].

The agent should:
1. Read [OpenAPI spec / GraphQL schema / API docs] to discover endpoints
2. Execute realistic API flows:
   - [FLOW_1: e.g., Authentication (login → get token)]
   - [FLOW_2: e.g., CRUD operations]
   - [FLOW_3: e.g., Search/filter]
   - [FLOW_4: e.g., Error handling]
3. For each request:
   - Validate response status code
   - Validate response schema
   - Check response time is acceptable
4. Try edge cases:
   - Invalid auth
   - Missing required fields
   - Invalid data types
   - Rate limiting
5. Output JSON report: {flow, requests: [{method, url, body, response, verdict}]}

Stack:
- Execution: fetch / axios / node-fetch
- LLM: [Claude API / GPT-4]
- Schema validation: Zod / json-schema
- Format: JSON report

Constraints:
- Auth: [API_KEY / OAuth / None]
- Rate limit: [N] requests per second
- Timeout: [T] seconds per request
- Budget: max [M] requests total

Deliverables:
1. api-tester.ts (main runner)
2. schemas/ (response schemas for validation)
3. flows/ (test flow definitions)
4. example-report.json
```

---

## Example: REST API Tester

```typescript
// api-tester.ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic();

// Response schemas
const UserSchema = z.object({
    id: z.number(),
    name: z.string(),
    email: z.string().email(),
});

// Test flows
const flows = [
    {
        name: "user_crud",
        steps: [
            { method: "POST", path: "/users", body: { name: "Test", email: "test@example.com" } },
            { method: "GET", path: "/users/{id}" },
            { method: "PUT", path: "/users/{id}", body: { name: "Updated" } },
            { method: "DELETE", path: "/users/{id}" },
        ],
    },
];

async function testFlow(flow: typeof flows[0]) {
    const results = [];
    for (const step of flow.steps) {
        const res = await fetch(`https://api.example.com${step.path}`, {
            method: step.method,
            body: JSON.stringify(step.body),
        });
        
        const verdict = res.ok ? "pass" : "fail";
        results.push({ step, status: res.status, verdict });
    }
    return { flow: flow.name, results };
}
```

---

## Expected Output Format

```json
{
  "api": "user-api",
  "base_url": "https://api.example.com",
  "timestamp": "2026-02-20T15:00:00Z",
  "flows": [
    {
      "name": "user_crud",
      "requests": [
        {
          "method": "POST",
          "url": "/users",
          "body": { "name": "Test", "email": "test@example.com" },
          "response": { "id": 123, "name": "Test", "email": "test@example.com" },
          "status": 201,
          "latency_ms": 45,
          "verdict": "pass",
          "reason": "Created successfully with valid schema"
        },
        {
          "method": "GET",
          "url": "/users/123",
          "response": { "id": 123, "name": "Test", "email": "test@example.com" },
          "status": 200,
          "latency_ms": 12,
          "verdict": "pass",
          "reason": "Retrieved successfully"
        }
      ],
      "verdict": "pass"
    }
  ],
  "summary": {
    "total_flows": 3,
    "total_requests": 15,
    "passed": 14,
    "failed": 1,
    "avg_latency_ms": 32
  }
}
```

---

## Snapshot Testing

For contract testing, use snapshot tests:

```typescript
import { test } from "node:test";
import assert from "node:assert";

test("GET /users matches snapshot", async () => {
    const res = await fetch("https://api.example.com/users");
    const data = await res.json();
    
    // Update snapshot: npm test -- --update-snapshot
    assert.snapshot(data);
});
```
