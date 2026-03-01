# CLI Reference

> All TEST-CAPABILITIES commands and options.

---

## test-capabilities test

Run the full test suite.

```bash
test-capabilities test [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--target <url>` | Target URL or path | Required |
| `--config <file>` | Configuration file | `test-capabilities.yaml` |
| `--quick` | Fast sanity check | `false` |
| `--autonomous` | Full autonomous mode | `false` |
| `--self-heal` | Enable self-healing | `false` |
| `--predict` | Run failure prediction | `false` |
| `--fail-threshold <level>` | Fail threshold | `high` |
| `--report <dir>` | Report output directory | `./reports` |

---

## test-capabilities surf

Browser testing with surf-cli integration.

```bash
test-capabilities surf <action> [options]
```

| Action | Description |
|--------|-------------|
| `explore` | Explore site structure |
| `flow <name>` | Run a predefined flow |
| `assert <statement>` | AI-powered assertion |
| `compare` | Visual regression comparison |
| `replay <file>` | Replay captured session |

Options:

| Option | Description |
|--------|-------------|
| `--url <url>` | Target URL |
| `--depth <n>` | Exploration depth |
| `--record` | Record the session |
| `--validate` | Run AI validation |
| `--baseline <dir>` | Baseline for comparison |
| `--ai-diff` | Use AI for visual diff |

---

## test-capabilities predict

Run ML-powered failure prediction.

```bash
test-capabilities predict [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--target <url>` | Target URL | Required |
| `--history <dir>` | Historical data directory | `./reports` |
| `--horizon <hours>` | Prediction horizon | `24` |

---

## test-capabilities quantum

Run quantum test simulation.

```bash
test-capabilities quantum [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--target <url>` | Target URL | Required |
| `--branches <n>` | Parallel universes | `100` |
| `--collapse` | Collapse to significant findings | `true` |
| `--strategy <s>` | Collapse strategy | `significance` |

---

## test-capabilities heal

Analyze and fix broken tests.

```bash
test-capabilities heal [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--dir <path>` | Tests directory | `./tests` |
| `--dry-run` | Show fixes without applying | `false` |
| `--confidence <n>` | Minimum confidence threshold | `0.7` |

---

## test-capabilities report

Generate test reports.

```bash
test-capabilities report [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--input <dir>` | Input data directory | `./reports` |
| `--output <dir>` | Output directory | `./reports` |
| `--format <f>` | Formats (comma-separated) | `html,json` |
| `--upload` | Upload to configured destination | `false` |

---

## test-capabilities visualize

Generate interactive visualization.

```bash
test-capabilities visualize [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--output <file>` | Output HTML file | `test-capabilities-viz.html` |
| `--real-time` | Enable real-time updates | `false` |
| `--port <n>` | Dashboard port | `3001` |

---

## Global Options

Available for all commands:

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |
| `--no-color` | Disable colored output |
| `-v, --verbose` | Verbose output |
| `-q, --quiet` | Suppress output |
| `-h, --help` | Show help |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TEST-CAPABILITIES_CONFIG` | Config file path | `./test-capabilities.yaml` |
| `TEST-CAPABILITIES_REPORT_DIR` | Report directory | `./reports` |
| `TEST-CAPABILITIES_PARALLEL` | Max parallel workers | `4` |
| `TEST-CAPABILITIES_TIMEOUT` | Default timeout (ms) | `60000` |
| `SURF_SOCKET_PATH` | Surf socket path | `/tmp/surf.sock` |
