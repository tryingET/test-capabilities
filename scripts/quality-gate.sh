#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STAGE="${1:-}"

usage() {
  echo "Usage: bash ./scripts/quality-gate.sh <lint|fix|typecheck|structure|contract-sync|coverage|pre-commit|pre-push|ci>" >&2
}

has_biome_config() {
  [[ -f "biome.json" ]] || [[ -f "biome.jsonc" ]]
}

run_biome() {
  local -a args=("$@")

  if [[ -x "$ROOT_DIR/node_modules/.bin/biome" ]]; then
    "$ROOT_DIR/node_modules/.bin/biome" "${args[@]}"
    return 0
  fi

  echo "biome: configuration detected but local biome binary is unavailable." >&2
  echo "Run 'npm install' (or add @biomejs/biome to devDependencies)." >&2
  exit 1
}

run_lint() {
  # Run custom Node.js syntax check (existing ci_lint.mjs)
  if [[ -f "$ROOT_DIR/scripts/ci_lint.mjs" ]]; then
    node "$ROOT_DIR/scripts/ci_lint.mjs"
  fi

  # Run Biome if configured
  if has_biome_config; then
    run_biome check --no-errors-on-unmatched .
  fi
}

run_fix() {
  if has_biome_config; then
    run_biome check --write --no-errors-on-unmatched .
  else
    echo "fix: skipped (no biome config found)"
  fi
}

run_typecheck() {
  if [[ ! -f "$ROOT_DIR/tsconfig.json" ]]; then
    echo "typecheck: skipped (no tsconfig.json found)"
    return 0
  fi

  if [[ -x "$ROOT_DIR/node_modules/.bin/tsgo" ]]; then
    if ! "$ROOT_DIR/node_modules/.bin/tsgo" --version >/dev/null 2>&1; then
      echo "typecheck: tsgo native compiler is unavailable or incomplete." >&2
      echo "Run 'npm install' without '--omit=optional' so @typescript/native-preview can install its platform package." >&2
      exit 1
    fi
    "$ROOT_DIR/node_modules/.bin/tsgo" --noEmit
    return 0
  fi

  echo "typecheck: tsconfig.json found but local tsgo binary is unavailable." >&2
  echo "Run 'npm install' (or add @typescript/native-preview to devDependencies)." >&2
  exit 1
}

run_tests() {
  if [[ ! -d "$ROOT_DIR/tests" ]]; then
    echo "tests: skipped (no tests directory found)"
    return 0
  fi

  mapfile -t test_files < <(find "$ROOT_DIR/tests" -maxdepth 1 -type f -name "*.test.*" | sort)
  mapfile -t behavior_features < <(find "$ROOT_DIR/tests/behavior" -type f -name "*.feature" 2>/dev/null | sort)
  if [[ "${#test_files[@]}" -eq 0 && "${#behavior_features[@]}" -eq 0 ]]; then
    echo "tests: skipped (no node tests or behavior features found)"
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "tests: node is required to run tests." >&2
    exit 1
  fi

  if [[ -f "$ROOT_DIR/package.json" ]] && command -v npm >/dev/null 2>&1; then
    npm run build --silent
  fi

  if [[ "${#test_files[@]}" -gt 0 ]]; then
    node --test "${test_files[@]}"
  else
    echo "node tests: skipped (no test files matching tests/*.test.*)"
  fi

  if [[ "${#behavior_features[@]}" -gt 0 ]]; then
    if [[ -f "$ROOT_DIR/package.json" ]] && command -v npm >/dev/null 2>&1; then
      npm run test:behavior:raw --silent
    else
      echo "behavior tests: skipped (package.json or npm unavailable)"
    fi
  fi
}

# Structure budget (scripts/quality/check-structure.mjs): size budget with
# ledgered exceptions, runtime import cycles, never-imported modules, the pure
# ring rule and the passport byte check. No build; the passport check reads the
# existing dist/ and fails closed when it is missing.
run_structure() {
  node "$ROOT_DIR/scripts/quality/check-structure.mjs"
}

# Contract sync (scripts/quality/check-contract-sync.mjs): the commander command
# set, the cli.md status table, the generated help and export captures, the
# types.md unions, the published schemas and the config mirror, all against the
# runtime. Needs a build (it imports the route manifest and spawns the CLI).
run_contract_sync() {
  node "$ROOT_DIR/scripts/quality/check-contract-sync.mjs"
}

# Coverage ratchet (scripts/quality/coverage-ratchet.mjs): builds with source
# maps, runs the corpus once more under c8, enforces the floors keyed by Node
# major, the changed-lines gate and the reductions ledger. Needs a base ref
# (COVERAGE_BASE, else HEAD on a dirty tree, else HEAD^).
run_coverage() {
  node "$ROOT_DIR/scripts/quality/coverage-ratchet.mjs"
}

run_pre_commit() {
  echo "== quality gate: pre-commit"
  run_lint
  run_structure
}

run_pre_push() {
  echo "== quality gate: pre-push"
  run_lint
  run_typecheck
  run_tests
  run_contract_sync
  run_coverage
}

run_ci() {
  echo "== quality gate: ci"
  run_lint
  run_typecheck
  run_tests
  run_contract_sync
  run_coverage
}

case "$STAGE" in
  lint)
    run_lint
    ;;
  fix)
    run_fix
    ;;
  typecheck)
    run_typecheck
    ;;
  structure)
    run_structure
    ;;
  contract-sync)
    run_contract_sync
    ;;
  coverage)
    run_coverage
    ;;
  pre-commit)
    run_pre_commit
    ;;
  pre-push)
    run_pre_push
    ;;
  ci)
    run_ci
    ;;
  *)
    usage
    exit 1
    ;;
esac
