#!/usr/bin/env bash
set -euo pipefail

# ROCS CI profile wrapper
# Profiles:
#   - local-dev   : offline-first by default (path layers only unless refs are requested)
#   - branch-ci   : strict refs required
#   - main-strict : strict refs required (authoritative gate)

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "$script_dir/../.." && pwd)"

ROCS_CI_PROFILE="${ROCS_CI_PROFILE:-local-dev}"
ROCS_REPO="${ROCS_REPO:-$repo_root}"
ROCS_PROFILE="${ROCS_PROFILE:-}"
ROCS_CMD="${ROCS_CMD:-}"
workspace_root="${ROCS_WORKSPACE_ROOT:-$HOME/ai-society}"
workspace_ref_mode="${ROCS_WORKSPACE_REF_MODE:-loose}"
core_project_default="${ROCS_CORE_PROJECT:-$workspace_root/core/rocs-cli}"
export ROCS_AUTHORITY_AGGREGATE=1
export ROCS_WORKSPACE_ROOT="$workspace_root"
export ROCS_WORKSPACE_REF_MODE="$workspace_ref_mode"

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

common_args=(--repo "$ROCS_REPO")
if [[ -n "$ROCS_PROFILE" ]]; then
  common_args+=(--profile "$ROCS_PROFILE")
fi

run_rocs_default() {
  if [[ -f "$repo_root/scripts/rocs.sh" ]]; then
    bash "$repo_root/scripts/rocs.sh" "$@"
    return
  fi

  if [[ -d "$core_project_default" && -f "$core_project_default/pyproject.toml" ]] && has_cmd uv; then
    uv --project "$core_project_default" run rocs "$@"
    return
  fi

  if has_cmd rocs; then
    rocs "$@"
    return
  fi

  echo "error: unable to locate rocs runner; set ROCS_CMD, add scripts/rocs.sh, install uv for workspace core, or add rocs to PATH" >&2
  exit 1
}

run_rocs() {
  if [[ -n "$ROCS_CMD" ]]; then
    # shellcheck disable=SC2086
    ROCS_WORKSPACE_ROOT="$workspace_root" ROCS_WORKSPACE_REF_MODE="$workspace_ref_mode" $ROCS_CMD "$@"
    return
  fi

  ROCS_WORKSPACE_ROOT="$workspace_root" ROCS_WORKSPACE_REF_MODE="$workspace_ref_mode" run_rocs_default "$@"
}

clean_dist() {
  rm -rf "$ROCS_REPO/ontology/dist"
}

strict_gate() {
  clean_dist
  run_rocs validate "${common_args[@]}" --resolve-refs
  run_rocs build "${common_args[@]}" --resolve-refs
}

case "$ROCS_CI_PROFILE" in
  local-dev)
    clean_dist
    if [[ "${ROCS_LOCAL_RESOLVE_REFS:-0}" == "1" ]]; then
      run_rocs validate "${common_args[@]}" --resolve-refs
      run_rocs build "${common_args[@]}" --resolve-refs
    else
      # Keep local loops fast/offline by validating only repo-local path layers.
      run_rocs validate "${common_args[@]}" --only path
      run_rocs build "${common_args[@]}" --only path
    fi
    ;;

  branch-ci)
    : "${ROCS_GITLAB_TIMEOUT_S:=30}"
    : "${ROCS_GITLAB_RETRIES:=3}"
    export ROCS_GITLAB_TIMEOUT_S ROCS_GITLAB_RETRIES
    strict_gate
    ;;

  main-strict)
    : "${ROCS_GITLAB_TIMEOUT_S:=60}"
    : "${ROCS_GITLAB_RETRIES:=3}"
    export ROCS_GITLAB_TIMEOUT_S ROCS_GITLAB_RETRIES
    strict_gate
    ;;

  *)
    echo "unknown ROCS_CI_PROFILE: $ROCS_CI_PROFILE (expected: local-dev|branch-ci|main-strict)" >&2
    exit 1
    ;;
esac
