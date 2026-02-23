# CLI Tester Prompt

Use this prompt to create an LLM-driven tester for CLI tools.

---

## Prompt

```
Create an LLM-driven CLI tester for [TOOL_NAME] (a [LANGUAGE]-based [DOMAIN] tool).

The agent should:
1. Run `[TOOL] --help` to discover commands
2. Execute realistic user flows:
   - [FLOW_1: e.g., Initialize/setup]
   - [FLOW_2: e.g., Create/edit/search items]
   - [FLOW_3: e.g., Export/report]
   - [FLOW_4: e.g., Quality/validation checks]
3. After each command, evaluate stdout/stderr to determine success
4. Try edge cases:
   - Missing required arguments
   - Invalid input values
   - Non-existent resources
   - Concurrent operations
5. Output JSON report: {flow, steps: [{cmd, output, verdict, reason}]}

Stack:
- Execution: bash subprocess
- LLM: [Claude API / GPT-4 / local model via Ollama]
- Format: JSON report

Constraints:
- Must log every action for reproducibility
- Budget: max [N] flows, max [M] steps per flow
- Timeout: [T] seconds per command

Deliverables:
1. test-runner.sh or test-runner.ts
2. prompts/agent-prompt.md (system prompt for LLM)
3. example-output.json (sample report)
4. README.md with usage instructions
```

---

## Example: prompt-vault

```
Create an LLM-driven CLI tester for prompt-vault (a bash-based prompt management tool).

The agent should:
1. Run `./scripts/pv --help` to discover commands
2. Execute realistic user flows:
   - Initialize vault
   - Create/edit/search templates
   - Run quality checks
   - Export content
3. After each command, evaluate stdout/stderr to determine success
4. Try edge cases (missing args, invalid names, etc.)
5. Output JSON report: {flow, steps: [{cmd, output, verdict, reason}]}

Use Claude API (ANTHROPIC_API_KEY env var).
Max 5 flows, max 10 steps per flow.
```

---

## Expected Output Format

```json
{
  "tool": "pv",
  "timestamp": "2026-02-20T15:00:00Z",
  "flows": [
    {
      "name": "initialize_vault",
      "steps": [
        {
          "cmd": "./scripts/pv init",
          "output": "Vault initialized",
          "exit_code": 0,
          "verdict": "pass",
          "reason": "Command succeeded with expected output"
        }
      ],
      "verdict": "pass"
    },
    {
      "name": "create_template",
      "steps": [
        {
          "cmd": "./scripts/pv new-template test-template",
          "output": "Created template 'test-template' (draft)",
          "exit_code": 0,
          "verdict": "pass",
          "reason": "Template created successfully"
        }
      ],
      "verdict": "pass"
    }
  ],
  "summary": {
    "total_flows": 5,
    "passed": 4,
    "failed": 1,
    "total_steps": 23,
    "duration_ms": 4521
  }
}
```
