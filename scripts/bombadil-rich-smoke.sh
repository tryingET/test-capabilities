#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dist_root="${TEST_CAPABILITIES_DIST_ROOT:-$repo_root/dist}"
skip_build=0
keep_temp=0
direct_only=0
tc_only=0
direct_timeout_seconds=10
tc_duration="5s"
server_pid=""
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/test-capabilities-bombadil-rich-XXXXXX")"

usage() {
  cat <<'EOF'
Usage: bash ./scripts/bombadil-rich-smoke.sh [options]

Run a richer local Bombadil regression smoke against deterministic fixture pages.
The script:
1. serves examples/bombadil-rich/site on a temporary local port
2. runs Bombadil directly against that site and expects trace artifacts
3. runs test-capabilities with a Bombadil-backed config against the same fixture

Options:
  --skip-build                Assume dist/ is already current
  --keep-temp                 Keep the temporary fixture/config/output directory
  --direct-only               Run only the direct Bombadil phase
  --tc-only                   Run only the test-capabilities phase
  --direct-timeout <seconds>  Timeout budget for the direct Bombadil phase (default: 10)
  --tc-duration <duration>    Bombadil duration passed into test-capabilities config (default: 5s)
  -h, --help                  Show this help
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
  else
    printf '[info] kept temp fixtures: %s\n' "$tmpdir"
  fi
  return "$status"
}

fail() {
  local label="$1"
  local details="${2-}"
  printf '[fail] %s\n' "$label" >&2
  if [[ -n "$details" ]]; then
    printf '%s\n' "$details" >&2
  fi
  exit 1
}

pass() {
  printf '[pass] %s\n' "$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      skip_build=1
      shift
      ;;
    --keep-temp)
      keep_temp=1
      shift
      ;;
    --direct-only)
      direct_only=1
      shift
      ;;
    --tc-only)
      tc_only=1
      shift
      ;;
    --direct-timeout)
      direct_timeout_seconds="${2-}"
      shift 2
      ;;
    --tc-duration)
      tc_duration="${2-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "argument parsing" "unknown option: $1"
      ;;
  esac
done

if [[ "$direct_only" -eq 1 && "$tc_only" -eq 1 ]]; then
  fail "argument parsing" "--direct-only and --tc-only are mutually exclusive"
fi

trap cleanup EXIT

if [[ "$skip_build" -eq 0 ]]; then
  npm --prefix "$repo_root" run build --silent >/dev/null
fi

mkdir -p "$tmpdir/site"
cp -R "$repo_root/examples/bombadil-rich/site/." "$tmpdir/site/"

node "$repo_root/scripts/capability-fixture-server.mjs" "$tmpdir/site" "$tmpdir/server-port" >/tmp/test-capabilities-bombadil-rich-server.log 2>&1 &
server_pid=$!

for _ in $(seq 1 50); do
  [[ -f "$tmpdir/server-port" ]] && break
  sleep 0.1
done
[[ -f "$tmpdir/server-port" ]] || fail "fixture server startup" "server did not write its port file"
base_url="http://127.0.0.1:$(tr -d '[:space:]' < "$tmpdir/server-port")"

resolution_env="$tmpdir/bombadil-resolution.env"
node --input-type=module - "$resolution_env" "$runtime_dist_root" <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outPath = process.argv[2];
const distRoot = process.argv[3];
const moduleUrl = pathToFileURL(path.join(distRoot, 'core', 'bombadil-runtime.js')).href;
const { resolveBombadilBinaryResolution } = await import(moduleUrl);
const resolution = resolveBombadilBinaryResolution(process.env);
const encode = (value) => JSON.stringify(String(value));
fs.writeFileSync(
  outPath,
  [
    `BOMBADIL_BIN=${encode(resolution.binaryPath)}`,
    `BOMBADIL_PROVIDER=${encode(resolution.provider)}`,
    `BOMBADIL_NOTES=${encode(resolution.resolutionNotes.join('\n'))}`,
  ].join('\n') + '\n',
  'utf8',
);
EOF
# shellcheck disable=SC1090
source "$resolution_env"

printf '[info] bombadil provider: %s\n' "$BOMBADIL_PROVIDER"
printf '[info] bombadil binary: %s\n' "$BOMBADIL_BIN"
if [[ -n "$BOMBADIL_NOTES" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && printf '[info] %s\n' "$line"
  done <<< "$BOMBADIL_NOTES"
fi

if [[ "$tc_only" -eq 0 ]]; then
  set +e
  timeout "${direct_timeout_seconds}s" "$BOMBADIL_BIN" test "$base_url" --headless --exit-on-violation --output-path "$tmpdir/direct-run" >"$tmpdir/direct.stdout" 2>"$tmpdir/direct.stderr"
  direct_status=$?
  set -e

  if [[ "$direct_status" -ne 0 && "$direct_status" -ne 124 ]]; then
    fail "direct Bombadil run" "status=$direct_status\n$(cat "$tmpdir/direct.stderr")"
  fi

  [[ -f "$tmpdir/direct-run/trace.jsonl" ]] || fail "direct Bombadil run" "trace.jsonl missing under $tmpdir/direct-run"
  pass "direct Bombadil run produced trace artifacts on the richer fixture"
fi

if [[ "$direct_only" -eq 0 ]]; then
  cat > "$tmpdir/bombadil-rich.yaml" <<YAML
version: '2.0'
name: 'Bombadil Rich Fixture'

targets:
  web: '$base_url'

agents:
  web:
    enabled: true
    type: bombadil
    intensity: normal
    duration: $tc_duration

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

  if ! TEST_CAPABILITIES_BOMBADIL_BIN="$BOMBADIL_BIN" node "$repo_root/bin/test-capabilities" test --quick --config "$tmpdir/bombadil-rich.yaml" --target "$base_url" >"$tmpdir/tc.stdout" 2>"$tmpdir/tc.stderr"; then
    fail "test-capabilities Bombadil run" "$(cat "$tmpdir/tc.stdout")\n$(cat "$tmpdir/tc.stderr")"
  fi

  if ! grep -q 'Health:  pass' "$tmpdir/tc.stdout"; then
    fail "test-capabilities Bombadil run" "expected passing health summary\n$(cat "$tmpdir/tc.stdout")"
  fi

  pass "test-capabilities Bombadil run passes on the richer fixture"
fi

pass "bombadil richer smoke complete"
