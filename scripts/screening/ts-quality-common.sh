#!/usr/bin/env bash
set -euo pipefail

TEST_CAPABILITIES_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCREENING_RUNTIME_TMPDIR=""

resolve_ts_quality_cli() {
  if [[ -n "${TS_QUALITY_BIN:-}" ]]; then
    printf '%s\n' "$TS_QUALITY_BIN"
    return 0
  fi

  if [[ -x "$TEST_CAPABILITIES_ROOT/node_modules/.bin/ts-quality" ]]; then
    printf '%s\n' "$TEST_CAPABILITIES_ROOT/node_modules/.bin/ts-quality"
    return 0
  fi

  local sibling_cli="$TEST_CAPABILITIES_ROOT/../ts-quality/dist/packages/ts-quality/src/cli.js"
  if [[ -f "$sibling_cli" ]]; then
    printf '%s\n' "$sibling_cli"
    return 0
  fi

  if command -v ts-quality >/dev/null 2>&1; then
    command -v ts-quality
    return 0
  fi

  echo "ts-quality CLI not found. Set TS_QUALITY_BIN, install ts-quality locally, or build the sibling repo at ../ts-quality." >&2
  exit 1
}

run_ts_quality() {
  local cli
  cli="$(resolve_ts_quality_cli)"
  if [[ "$cli" == *.js ]]; then
    node "$cli" "$@"
  else
    "$cli" "$@"
  fi
}

is_tsgo_executable() {
  local candidate="$1"
  "$candidate" --version >/dev/null 2>&1
}

resolve_typescript_compiler() {
  if [[ -x "$TEST_CAPABILITIES_ROOT/node_modules/.bin/tsgo" ]]; then
    if is_tsgo_executable "$TEST_CAPABILITIES_ROOT/node_modules/.bin/tsgo"; then
      printf '%s\n' "$TEST_CAPABILITIES_ROOT/node_modules/.bin/tsgo"
      return 0
    fi
    echo "TypeScript native compiler is unavailable or incomplete." >&2
    echo "Run npm install without '--omit=optional' so @typescript/native-preview can install its platform package." >&2
    exit 1
  fi

  if command -v tsgo >/dev/null 2>&1; then
    local tsgo_path
    tsgo_path="$(command -v tsgo)"
    if is_tsgo_executable "$tsgo_path"; then
      printf '%s\n' "$tsgo_path"
      return 0
    fi
  fi

  echo "TypeScript native compiler not found. Run npm install or ensure 'tsgo' is on PATH." >&2
  exit 1
}

build_isolated_runtime_dist() {
  local dist_root="$1"
  local tsgo
  tsgo="$(resolve_typescript_compiler)"
  mkdir -p "$dist_root"
  "$tsgo" -p "$TEST_CAPABILITIES_ROOT/tsconfig.json" --outDir "$dist_root"
}

join_csv_unique() {
  awk 'NF { if (!seen[$0]++) values[++count]=$0 } END { for (i=1; i<=count; i++) printf "%s%s", values[i], (i < count ? "," : "") }'
}

trim_path_token() {
  local value="$1"
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s\n' "$value"
}

normalize_repo_relative_path() {
  local candidate="$1"
  candidate="$(trim_path_token "$candidate")"
  candidate="${candidate//\\//}"

  if [[ -z "$candidate" ]]; then
    return 0
  fi

  if [[ "$candidate" == "$TEST_CAPABILITIES_ROOT/"* ]]; then
    candidate="${candidate#"$TEST_CAPABILITIES_ROOT/"}"
  fi

  candidate="${candidate#./}"
  printf '%s\n' "$candidate"
}

repo_relative_path_from_absolute() {
  local absolute_path="$1"
  printf '%s\n' "${absolute_path#"$TEST_CAPABILITIES_ROOT/"}"
}

# Normalize explicit or derived changed paths back onto the screened authored src/** surface.
# The current narrow screening slice uses the behavior-bearing fail-closed implementation file,
# while operator-facing facade/runtime inputs normalize onto that screened test-capabilities file.
map_changed_path_to_screening_source() {
  local candidate
  candidate="$(normalize_repo_relative_path "$1")"

  if [[ -z "$candidate" ]]; then
    return 0
  fi

  case "$candidate" in
    src/core/operations.ts|src/core/operations/dispatch.ts|src/core/operations/dispatch-execution.ts|dist/core/operations.js|dist/core/operations/dispatch.js|dist/core/operations/dispatch-execution.js)
      printf '%s\n' "src/core/operations/dispatch-execution.ts"
      return 0
      ;;
    src/core/operations/command-runner.ts|src/core/operations/command-runner-core.ts|dist/core/operations/command-runner.js|dist/core/operations/command-runner-core.js)
      printf '%s\n' "src/core/operations/command-runner-core.ts"
      return 0
      ;;
    src/healing/collect-files.ts|src/healing/collect-files-core.ts|dist/healing/collect-files.js|dist/healing/collect-files-core.js)
      printf '%s\n' "src/healing/collect-files-core.ts"
      return 0
      ;;
    src/core/operations/config-overrides.ts|src/core/operations/config-overrides-core.ts|dist/core/operations/config-overrides.js|dist/core/operations/config-overrides-core.js)
      printf '%s\n' "src/core/operations/config-targets-core.ts"
      printf '%s\n' "src/core/operations/config-quick-mode-core.ts"
      printf '%s\n' "src/core/operations/config-load-core.ts"
      return 0
      ;;
    src/*.ts|src/*.tsx|src/*.mts|src/*.cts)
      printf '%s\n' "$candidate"
      ;;
    dist/*.js)
      local base="src/${candidate#dist/}"
      base="${base%.js}"
      for extension in ts tsx mts cts; do
        if [[ -f "$TEST_CAPABILITIES_ROOT/${base}.${extension}" ]]; then
          printf '%s\n' "${base}.${extension}"
          return 0
        fi
      done
      ;;
    dist/*.mjs)
      local base_mjs="src/${candidate#dist/}"
      base_mjs="${base_mjs%.mjs}"
      if [[ -f "$TEST_CAPABILITIES_ROOT/${base_mjs}.mts" ]]; then
        printf '%s\n' "${base_mjs}.mts"
        return 0
      fi
      ;;
    dist/*.cjs)
      local base_cjs="src/${candidate#dist/}"
      base_cjs="${base_cjs%.cjs}"
      if [[ -f "$TEST_CAPABILITIES_ROOT/${base_cjs}.cts" ]]; then
        printf '%s\n' "${base_cjs}.cts"
        return 0
      fi
      ;;
    *)
      ;;
  esac
}

merge_base_ref() {
  if git -C "$TEST_CAPABILITIES_ROOT" rev-parse --verify origin/main >/dev/null 2>&1; then
    git -C "$TEST_CAPABILITIES_ROOT" merge-base HEAD origin/main 2>/dev/null || true
    return 0
  fi
  git -C "$TEST_CAPABILITIES_ROOT" rev-parse HEAD~1 2>/dev/null || true
}

collect_changed_source_candidates() {
  local base
  base="$(merge_base_ref)"
  {
    if [[ -n "$base" ]]; then
      git -C "$TEST_CAPABILITIES_ROOT" diff --name-only --diff-filter=ACMR "$base"...HEAD -- src || true
    fi
    git -C "$TEST_CAPABILITIES_ROOT" diff --name-only --diff-filter=ACMR HEAD -- src || true
    git -C "$TEST_CAPABILITIES_ROOT" ls-files --others --exclude-standard -- src || true
  } | awk 'NF'
}

derive_changed_source_csv() {
  collect_changed_source_candidates \
    | while IFS= read -r candidate; do
        map_changed_path_to_screening_source "$candidate"
      done \
    | awk 'NF' \
    | join_csv_unique
}

normalize_changed_csv() {
  local raw_csv="$1"
  local normalized
  normalized="$(printf '%s' "$raw_csv" | tr ',' '\n' | while IFS= read -r candidate || [[ -n "$candidate" ]]; do map_changed_path_to_screening_source "$candidate"; done | awk 'NF' | join_csv_unique)"
  if [[ -z "$normalized" ]]; then
    echo "No screening source paths remain after normalizing changed scope '$raw_csv'. Pass src/** or dist/** files that map to the screened source surface." >&2
    exit 1
  fi
  printf '%s\n' "$normalized"
}

cleanup_screening_runtime_tmpdir() {
  if [[ -n "$SCREENING_RUNTIME_TMPDIR" && -d "$SCREENING_RUNTIME_TMPDIR" ]]; then
    rm -rf "$SCREENING_RUNTIME_TMPDIR"
  fi
}

screening_check_lock_dir() {
  printf '%s\n' "$TEST_CAPABILITIES_ROOT/.ts-quality/locks/check.lock"
}

with_screening_check_lock() {
  mkdir -p "$TEST_CAPABILITIES_ROOT/.ts-quality/locks"

  local lock_dir
  lock_dir="$(screening_check_lock_dir)"

  while ! mkdir "$lock_dir" 2>/dev/null; do
    sleep 0.1
  done

  local release_lock=0
  cleanup() {
    if [[ $release_lock -eq 1 ]]; then
      rmdir "$lock_dir" 2>/dev/null || true
    fi
  }

  trap cleanup RETURN
  release_lock=1
  "$@"
}

ensure_screening_runtime_tmpdir() {
  if [[ -n "${TS_QUALITY_SCREENING_TMPDIR:-}" ]]; then
    mkdir -p "$TS_QUALITY_SCREENING_TMPDIR"
    printf '%s\n' "$TS_QUALITY_SCREENING_TMPDIR"
    return 0
  fi

  if [[ -n "$SCREENING_RUNTIME_TMPDIR" && -d "$SCREENING_RUNTIME_TMPDIR" ]]; then
    printf '%s\n' "$SCREENING_RUNTIME_TMPDIR"
    return 0
  fi

  mkdir -p "$TEST_CAPABILITIES_ROOT/.ts-quality/materialized"
  SCREENING_RUNTIME_TMPDIR="$(mktemp -d "$TEST_CAPABILITIES_ROOT/.ts-quality/materialized/screening.XXXXXX")"
  printf '%s\n' "$SCREENING_RUNTIME_TMPDIR"
}

line_count_or_zero() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    printf '0\n'
    return 0
  fi
  awk 'END { print NR }' "$file_path"
}

append_untracked_file_hunk() {
  local output_path="$1"
  local repo_path="$2"
  local absolute_path="$TEST_CAPABILITIES_ROOT/$repo_path"
  local line_count
  line_count="$(line_count_or_zero "$absolute_path")"
  {
    printf 'diff --git a/%s b/%s\n' "$repo_path" "$repo_path"
    printf 'new file mode 100644\n'
    printf -- '--- /dev/null\n'
    printf '+++ b/%s\n' "$repo_path"
    printf '@@ -0,0 +1,%s @@\n' "$line_count"
  } >>"$output_path"
}

write_changed_scope_diff() {
  local changed_csv="$1"
  local output_path="$2"
  local base
  local -a changed_paths=()
  local changed_path

  : >"$output_path"
  mapfile -t changed_paths < <(printf '%s' "$changed_csv" | tr ',' '\n' | awk 'NF')
  if [[ ${#changed_paths[@]} -eq 0 ]]; then
    return 0
  fi

  base="$(merge_base_ref)"
  if [[ -n "$base" ]]; then
    git -C "$TEST_CAPABILITIES_ROOT" diff --no-ext-diff --unified=0 "$base"...HEAD -- "${changed_paths[@]}" >>"$output_path" || true
  fi
  git -C "$TEST_CAPABILITIES_ROOT" diff --no-ext-diff --unified=0 HEAD -- "${changed_paths[@]}" >>"$output_path" || true

  for changed_path in "${changed_paths[@]}"; do
    if git -C "$TEST_CAPABILITIES_ROOT" ls-files --error-unmatch -- "$changed_path" >/dev/null 2>&1; then
      continue
    fi
    if [[ -f "$TEST_CAPABILITIES_ROOT/$changed_path" ]]; then
      append_untracked_file_hunk "$output_path" "$changed_path"
    fi
  done
}

write_screening_overlay_config() {
  local base_config_path="$1"
  local changed_csv="$2"
  local coverage_repo_path="${3:-}"
  local runtime_mirror_root="${4:-}"
  local runtime_tmpdir
  local diff_absolute_path
  local diff_repo_path
  local overlay_absolute_path

  runtime_tmpdir="$(ensure_screening_runtime_tmpdir)"
  diff_absolute_path="$runtime_tmpdir/changed.diff"
  overlay_absolute_path="$runtime_tmpdir/ts-quality.config.json"
  diff_repo_path="$(repo_relative_path_from_absolute "$diff_absolute_path")"

  write_changed_scope_diff "$changed_csv" "$diff_absolute_path"

  node - "$TEST_CAPABILITIES_ROOT" "$base_config_path" "$overlay_absolute_path" "$diff_repo_path" "$changed_csv" "$coverage_repo_path" "$runtime_mirror_root" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [rootDir, baseConfigArg, overlayConfigPath, diffRepoPath, changedCsv, coverageRepoPath, runtimeMirrorRoot] = process.argv.slice(2);
const baseConfigPath = path.resolve(rootDir, baseConfigArg);
const config = JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'));
const changedFiles = changedCsv.split(',').map((item) => item.trim()).filter(Boolean);
const existingChangeSet = config.changeSet && typeof config.changeSet === 'object' ? config.changeSet : {};
config.changeSet = {
  ...existingChangeSet,
  files: changedFiles,
  diffFile: diffRepoPath
};
if (typeof coverageRepoPath === 'string' && coverageRepoPath.length > 0) {
  const existingCoverage = config.coverage && typeof config.coverage === 'object' ? config.coverage : {};
  config.coverage = {
    ...existingCoverage,
    lcovPath: coverageRepoPath
  };
}
if (typeof runtimeMirrorRoot === 'string' && runtimeMirrorRoot.length > 0) {
  const existingMutations = config.mutations && typeof config.mutations === 'object' ? config.mutations : {};
  config.mutations = {
    ...existingMutations,
    runtimeMirrorRoots: [runtimeMirrorRoot]
  };
}
fs.writeFileSync(overlayConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
NODE

  repo_relative_path_from_absolute "$overlay_absolute_path"
}

append_diff_aware_screening_args() {
  local -a passthrough_args=()
  local explicit_changed=""
  local explicit_config="ts-quality.config.json"
  local explicit_coverage_path="${TS_QUALITY_SCREENING_COVERAGE_LCOV_PATH:-}"
  local explicit_runtime_mirror_root="${TS_QUALITY_SCREENING_RUNTIME_MIRROR_ROOT:-}"
  local expecting_value=""
  local arg

  for arg in "$@"; do
    if [[ -n "$expecting_value" ]]; then
      case "$expecting_value" in
        changed)
          explicit_changed="$arg"
          ;;
        config)
          explicit_config="$arg"
          ;;
      esac
      expecting_value=""
      continue
    fi

    case "$arg" in
      --changed)
        expecting_value="changed"
        ;;
      --changed=*)
        explicit_changed="${arg#--changed=}"
        ;;
      --config)
        expecting_value="config"
        ;;
      --config=*)
        explicit_config="${arg#--config=}"
        ;;
      *)
        passthrough_args+=("$arg")
        ;;
    esac
  done

  if [[ -n "$expecting_value" ]]; then
    echo "--${expecting_value} requires a value" >&2
    exit 1
  fi

  local effective_changed
  if [[ -n "$explicit_changed" ]]; then
    effective_changed="$(normalize_changed_csv "$explicit_changed")"
  else
    effective_changed="$(derive_changed_source_csv)"
    if [[ -z "$effective_changed" ]]; then
      echo "No changed screening source files could be derived from src/**. Pass --changed <src-or-dist-paths> explicitly." >&2
      exit 1
    fi
  fi

  local normalized_config_path
  local normalized_coverage_path=""
  local normalized_runtime_mirror_root=""
  local overlay_config_path
  normalized_config_path="$(normalize_repo_relative_path "$explicit_config")"
  if [[ -n "$explicit_coverage_path" ]]; then
    normalized_coverage_path="$(normalize_repo_relative_path "$explicit_coverage_path")"
  fi
  if [[ -n "$explicit_runtime_mirror_root" ]]; then
    normalized_runtime_mirror_root="$(normalize_repo_relative_path "$explicit_runtime_mirror_root")"
  fi
  overlay_config_path="$(write_screening_overlay_config "$normalized_config_path" "$effective_changed" "$normalized_coverage_path" "$normalized_runtime_mirror_root")"

  printf '%s\0' "${passthrough_args[@]}" --config "$overlay_config_path" --changed "$effective_changed"
}
