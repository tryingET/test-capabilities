# Configuration

> Full test-capabilities.yaml reference.

---

## Minimal Config

```yaml
version: '2.0'
name: 'My App'

targets:
  web: 'https://myapp.com'
```

---

## Full Config

```yaml
version: '2.0'
name: 'My App Testing Suite'

# ===========================================
# TARGETS
# ===========================================
targets:
  web: 'https://myapp.com'
  api: 'https://api.myapp.com'
  cli: './bin/myapp'

# ===========================================
# AGENTS
# ===========================================
agents:
  # Property-based fuzzing
  explorer:
    enabled: true
    type: bombadil
    intensity: aggressive      # gentle | normal | aggressive
    duration: 10m
    focus:                     # Components to focus on
      - auth
      - checkout

  # Browser navigation
  navigator:
    enabled: true
    type: surf
    flows_dir: ./flows
    ai_validation: true
    visual_regression: true
    baseline_dir: ./baselines

  # API fuzzing
  api:
    enabled: true
    type: api-fuzzer
    schema: ./openapi.yaml
    mutations:
      - missing_fields
      - type_confusion
      - injection
    auth_test: true

  # CLI testing
  cli:
    enabled: false
    type: cli-tester
    commands_dir: ./commands

# ===========================================
# INTELLIGENCE
# ===========================================
intelligence:
  self_healing: true
  healing_strategies:
    - testid_fallback
    - role_fallback
    - text_search
    - vision_ai
  healing_confidence_threshold: 0.7

  prediction: true
  prediction_model: gradient_boost
  prediction_horizon: 24h

  correlation: true
  correlation_sources:
    - web
    - api
    - network

  collective: false           # Opt-in data sharing

# ===========================================
# QUANTUM
# ===========================================
quantum:
  enabled: true
  branches: 1000
  collapse_strategy: significance  # significance | diversity | coverage
  max_depth: 20
  timeout: 300s

# ===========================================
# CHAOS
# ===========================================
chaos:
  enabled: true
  experiments:
    - network.latency: [50, 200, 500, 1000]
    - network.packet_loss: [0, 0.01, 0.05]
    - system.cpu_pressure: [50, 80, 100]
    - application.error_injection: [400, 500, 503]

# ===========================================
# REPORTING
# ===========================================
reporting:
  formats:
    - json
    - html
    - markdown
  output: ./reports
  include_artifacts:
    - screenshots
    - traces
    - network_logs

  upload:
    enabled: false
    destination: s3://bucket/reports
    retention: 30d

# ===========================================
# ALERTS
# ===========================================
alerts:
  enabled: true
  channels:
    - type: slack
      webhook: ${SLACK_WEBHOOK}
      severity: [high, critical]
    - type: email
      recipients: [team@example.com]
      severity: [critical]

# ===========================================
# EXECUTION
# ===========================================
execution:
  parallel: true
  max_workers: 4
  timeout_per_test: 60s
  retry_count: 2
  fail_fast: false

# ===========================================
# ENVIRONMENT
# ===========================================
env:
  TEST_USER: ${TEST_USER}
  TEST_PASS: ${TEST_PASS}
  API_KEY: ${API_KEY}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEST-CAPABILITIES_CONFIG` | `./test-capabilities.yaml` | Config file path |
| `TEST-CAPABILITIES_REPORT_DIR` | `./reports` | Report output |
| `TEST-CAPABILITIES_PARALLEL` | `4` | Max parallel workers |
| `TEST-CAPABILITIES_TIMEOUT` | `60000` | Default timeout (ms) |
| `SURF_SOCKET_PATH` | `/tmp/surf.sock` | Surf socket |
| `SURF_NETWORK_PATH` | `/tmp/surf` | Network logs |
| `CHROME_PATH` | auto | Chrome binary path |

---

## Agent Types

| Type | Description |
|------|-------------|
| `bombadil` | Property-based web fuzzing |
| `surf` | Browser navigation |
| `api-fuzzer` | REST/GraphQL testing |
| `cli-tester` | Command-line testing |

---

## Intensity Levels

| Level | Actions/Min | Description |
|-------|-------------|-------------|
| `gentle` | ~10 | Conservative, fewer actions |
| `normal` | ~30 | Balanced |
| `aggressive` | ~100 | Maximum exploration |

---

## Collapse Strategies

| Strategy | Description |
|----------|-------------|
| `significance` | Only high/critical findings |
| `diversity` | One finding per type |
| `coverage` | Maximize path coverage |

---

## Secrets Management

Use environment variables for sensitive data:

```yaml
env:
  DATABASE_URL: ${DB_URL}           # From env
  API_KEY: ${API_KEY:-default}      # With default
  SECRET: ${SECRET:?required}       # Required, error if missing
```

Run with:

```bash
export DB_URL="postgres://..."
export API_KEY="sk-..."
export SECRET="..."

test-capabilities test --config test-capabilities.yaml
```
