#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=./ts-quality-common.sh
source "$ROOT_DIR/scripts/screening/ts-quality-common.sh"

mkdir -p "$ROOT_DIR/.ts-quality/materialized" "$ROOT_DIR/tmp"
unset TS_QUALITY_SCREENING_COVERAGE_LCOV_PATH || true
SCREENING_CONTROL_ROOT="$(mktemp -d "$ROOT_DIR/.ts-quality/materialized/screening.XXXXXX")"
SCREENING_RUNTIME_ROOT="$(mktemp -d "$ROOT_DIR/tmp/ts-quality-screening.XXXXXX")"
export TS_QUALITY_SCREENING_TMPDIR="$SCREENING_CONTROL_ROOT"
export TEST_CAPABILITIES_DIST_ROOT="$(repo_relative_path_from_absolute "$SCREENING_RUNTIME_ROOT/dist")"
export TEST_CAPABILITIES_PACKAGE_ROOT="."
export TS_QUALITY_SCREENING_RUNTIME_MIRROR_ROOT="$(repo_relative_path_from_absolute "$SCREENING_RUNTIME_ROOT/dist")"
trap 'rm -rf "$SCREENING_CONTROL_ROOT" "$SCREENING_RUNTIME_ROOT"' EXIT

build_isolated_runtime_dist "$SCREENING_RUNTIME_ROOT/dist"

mapfile -d '' -t forwarded_args < <(append_diff_aware_screening_args "$@")
run_ts_quality witness refresh "${forwarded_args[@]}"
