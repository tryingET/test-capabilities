#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dist_root="${TEST_CAPABILITIES_DIST_ROOT:-$repo_root/dist}"
surf_mode="auto"
skip_build=0
keep_temp=0
json_mode=0
pass_count=0
last_output=""
server_pid=""
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/test-capabilities-drill-XXXXXX")"
results_file="$tmpdir/results.ndjson"

append_result() {
  local status="$1"
  local label="$2"
  local details="${3-}"

  node -e '
const fs = require("node:fs");
const [file, status, label, details] = process.argv.slice(1);
fs.appendFileSync(file, JSON.stringify({ status, label, details }) + "\n");
' "$results_file" "$status" "$label" "$details"
}

emit_json() {
  local ok="$1"

  node -e '
const fs = require("node:fs");
const [file, ok, surfMode, keepTemp, tempDir, repoRoot] = process.argv.slice(1);
const checks = fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];
const summary = {
  total: checks.length,
  passed: checks.filter((check) => check.status === "passed").length,
  failed: checks.filter((check) => check.status === "failed").length,
};
const payload = {
  ok: ok === "true",
  surfMode,
  repoRoot,
  summary,
  checks,
};
if (keepTemp === "1") {
  payload.tempDir = tempDir;
}
if (!payload.ok) {
  payload.failedCheck = checks.find((check) => check.status === "failed") ?? null;
}
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
' "$results_file" "$ok" "$surf_mode" "$keep_temp" "$tmpdir" "$repo_root"
}

die() {
  local label="$1"
  local details="${2-}"
  append_result "failed" "$label" "$details"

  if [[ "$json_mode" -eq 1 ]]; then
    emit_json false
  else
    printf '[fail] %s\n' "$label" >&2
    if [[ -n "$details" ]]; then
      printf '%s\n' "$details" >&2
    fi
  fi
  exit 1
}

record_pass() {
  pass_count=$((pass_count + 1))
  append_result "passed" "$1"
  if [[ "$json_mode" -eq 0 ]]; then
    printf '[pass] %s\n' "$1"
  fi
}

run_success() {
  local label="$1"
  shift
  local output
  if ! output="$("$@" 2>&1)"; then
    die "$label" "$output"
  fi
  last_output="$output"
  record_pass "$label"
}

run_failure_contains() {
  local label="$1"
  local expected="$2"
  shift 2
  local output
  if output="$("$@" 2>&1)"; then
    die "$label" "expected failure containing: $expected\n$output"
  fi
  if [[ "$output" != *"$expected"* ]]; then
    die "$label" "expected failure containing: $expected\n$output"
  fi
  last_output="$output"
  record_pass "$label"
}

assert_last_output_contains() {
  local label="$1"
  local expected="$2"
  if [[ "$last_output" != *"$expected"* ]]; then
    die "$label" "expected output containing: $expected\n$last_output"
  fi
}

assert_last_output_not_contains() {
  local label="$1"
  local unexpected="$2"
  if [[ "$last_output" == *"$unexpected"* ]]; then
    die "$label" "unexpected output fragment: $unexpected\n$last_output"
  fi
}

usage() {
  cat <<'EOF'
Usage: bash ./scripts/capability-drill.sh [options]

Options:
  --surf-mode <auto|shim|real>  How to run the surf drill (default: auto)
  --skip-build                  Assume dist/ is already current
  --keep-temp                   Keep generated temp fixtures for inspection
  --json                        Emit machine-readable JSON instead of human logs
  -h, --help                    Show this help
EOF
}

cleanup() {
  local status=$?
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ "$keep_temp" -eq 0 ]]; then
    rm -rf "$tmpdir"
  elif [[ "$json_mode" -eq 0 ]]; then
    printf '[info] kept temp fixtures: %s\n' "$tmpdir"
  fi
  return "$status"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --surf-mode)
      surf_mode="${2-}"
      shift 2
      ;;
    --skip-build)
      skip_build=1
      shift
      ;;
    --keep-temp)
      keep_temp=1
      shift
      ;;
    --json)
      json_mode=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "argument parsing" "unknown option: $1"
      ;;
  esac
done

case "$surf_mode" in
  auto|shim|real) ;;
  *) die "argument parsing" "--surf-mode must be one of: auto, shim, real" ;;
esac

trap cleanup EXIT

if [[ "$skip_build" -eq 0 ]]; then
  run_success "build dist artifacts" npm --prefix "$repo_root" run build --silent
fi

mkdir -p "$tmpdir/site" "$tmpdir/heal"
cp -R "$repo_root/examples/capability-drill/site/." "$tmpdir/site/"
cp "$repo_root/examples/capability-drill/heal/sample.test.ts" "$tmpdir/heal/sample.test.ts"

cat >"$tmpdir/cli-smoke.yaml" <<'YAML'
version: '2.0'
name: 'Capability Drill CLI Smoke'

targets:
  cli: 'node'

agents:
  cli:
    enabled: true
    type: cli-tester
    intensity: normal

intelligence:
  self_healing: false
  prediction: false
  correlation: true
  collective: false

quantum:
  enabled: false

chaos:
  enabled: false
YAML

node "$repo_root/scripts/capability-fixture-server.mjs" "$tmpdir/site" "$tmpdir/server-port" &
server_pid=$!

for _ in $(seq 1 50); do
  if [[ -f "$tmpdir/server-port" ]]; then
    break
  fi
  sleep 0.1
done

[[ -f "$tmpdir/server-port" ]] || die "fixture server startup" "server did not write its port file"
server_port="$(tr -d '[:space:]' <"$tmpdir/server-port")"
base_url="http://127.0.0.1:${server_port}"

case "$surf_mode" in
  auto)
    if command -v surf >/dev/null 2>&1; then
      surf_mode="real"
    else
      surf_mode="shim"
    fi
    ;;
  real)
    command -v surf >/dev/null 2>&1 || die "surf setup" "surf_mode=real requested but 'surf' is not on PATH"
    ;;
  shim)
    ;;
esac

if [[ "$surf_mode" == "shim" ]]; then
  mkdir -p "$tmpdir/shim-bin"
  cat >"$tmpdir/shim-bin/surf" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cmd="${1-}"
shift || true
case "$cmd" in
  go)
    printf 'surf-shim go %s\n' "${1-}"
    ;;
  *)
    printf 'surf-shim %s %s\n' "$cmd" "$*"
    ;;
esac
SH
  chmod +x "$tmpdir/shim-bin/surf"
  export PATH="$tmpdir/shim-bin:$PATH"
fi

run_success \
  "test command succeeds on a real CLI smoke target" \
  node "$repo_root/bin/test-capabilities" test --config "$tmpdir/cli-smoke.yaml" --quick
assert_last_output_contains "test command succeeds on a real CLI smoke target" "Health:  pass"
assert_last_output_contains "test command succeeds on a real CLI smoke target" "overall=partial(100%)"

run_failure_contains \
  "test command rejects inert URL overrides in quick mode" \
  "URL targets for 'test' require a real web-consuming runtime path" \
  node "$repo_root/bin/test-capabilities" test --config "$tmpdir/cli-smoke.yaml" --target "$base_url" --quick

run_success \
  "quantum command simulates an explicit target" \
  node "$repo_root/bin/test-capabilities" quantum --target "$base_url" --branches 5 --collapse
assert_last_output_contains "quantum command simulates an explicit target" "Universes Simulated:"
assert_last_output_contains "quantum command simulates an explicit target" "Unique Paths:"

run_failure_contains \
  "quantum command fails closed when target is missing" \
  "Quantum simulation requires --target with a valid URL." \
  node "$repo_root/bin/test-capabilities" quantum --branches 1

run_success \
  "heal dry-run proposes selector fixes without mutating payload literals" \
  node "$repo_root/bin/test-capabilities" heal --dir "$tmpdir/heal" --dry-run
assert_last_output_contains "heal dry-run proposes selector fixes without mutating payload literals" "old-login"
assert_last_output_contains "heal dry-run proposes selector fixes without mutating payload literals" "#deprecated-submit"
assert_last_output_contains "heal dry-run proposes selector fixes without mutating payload literals" "#old-confirm"
assert_last_output_not_contains "heal dry-run proposes selector fixes without mutating payload literals" "old-submit-label"
assert_last_output_not_contains "heal dry-run proposes selector fixes without mutating payload literals" "  - old-password"

run_success \
  "surf explore exercises the shipped wrapper path (${surf_mode})" \
  node "$repo_root/bin/test-capabilities" surf explore --url "$base_url"
if [[ "$surf_mode" == "shim" ]]; then
  assert_last_output_contains "surf explore exercises the shipped wrapper path (${surf_mode})" "$base_url"
fi

run_failure_contains \
  "surf explore rejects invalid URLs" \
  "Surf explore target must be a valid URL." \
  node "$repo_root/bin/test-capabilities" surf explore --url not-a-url

cat >"$tmpdir/correlation-check.mjs" <<EOF
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const runtimeModuleUrl = pathToFileURL("${runtime_dist_root}/index.js").href;
const { TestCapabilitiesOrchestrator } = await import(runtimeModuleUrl);

const result = await new TestCapabilitiesOrchestrator({
  version: "2.0",
  name: "Capability Drill Correlation",
  targets: { cli: "/definitely/not/a/real/binary" },
  agents: {
    cliA: { enabled: true, type: "cli-tester", intensity: "normal" },
    cliB: { enabled: true, type: "cli-tester", intensity: "normal" },
  },
  intelligence: {
    selfHealing: false,
    prediction: false,
    correlation: true,
    collective: false,
  },
  quantum: { enabled: false },
  chaos: { enabled: false },
}).run();

assert.equal(
  result.findings.some((finding) => /systemic issue in cli/.test(finding.description)),
  true,
);
console.log("correlation drill ok");
EOF

run_success "correlation library path synthesizes systemic findings" node "$tmpdir/correlation-check.mjs"
assert_last_output_contains "correlation library path synthesizes systemic findings" "correlation drill ok"

cat >"$tmpdir/prediction-check.mjs" <<EOF
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const runtimeModuleUrl = pathToFileURL("${runtime_dist_root}/index.js").href;
const { PredictionEngine } = await import(runtimeModuleUrl);

const engine = new PredictionEngine();
const predictions = await engine.analyze({
  errorRate: 0.02,
  responseTimeP95: 900,
  cpuUsage: 0.4,
  memoryUsage: 0.5,
  diskUsage: 0.2,
  timeSinceDeployment: 2,
  hourOfDay: 10,
  dayOfWeek: 2,
  sessionDepthAvg: 3,
  rageClickRate: 0.03,
  abandonmentRate: 0.04,
  bounceRate: 0.05,
  filesChanged: 4,
  linesAdded: 120,
  linesDeleted: 20,
  testCoverageDelta: 0.01,
  recentFailures: 1,
  avgTimeBetweenFailures: 24,
});

assert.equal(predictions.length > 0, true);
await assert.rejects(
  async () => engine.analyze({ errorRate: 0.9, responseTimeP95: 3000 }),
  /Prediction input is incomplete or invalid/,
);
console.log("prediction drill ok");
EOF

run_success "prediction engine accepts complete metrics and rejects partial payloads" node "$tmpdir/prediction-check.mjs"
assert_last_output_contains "prediction engine accepts complete metrics and rejects partial payloads" "prediction drill ok"

if [[ "$json_mode" -eq 1 ]]; then
  emit_json true
else
  printf '[pass] capability drill complete (%d checks, surf_mode=%s)\n' "$pass_count" "$surf_mode"
fi
