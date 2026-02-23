#!/usr/bin/env sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
workspace_root="${AI_SOCIETY_WORKSPACE:-$HOME/ai-society}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing dependency: $1" >&2
    exit 2
  }
}

resolve_override() {
  value="$1"
  [ -n "$value" ] || return 1

  case "$value" in
    /*) candidate="$value" ;;
    *) candidate="$repo_root/$value" ;;
  esac

  [ -f "$candidate" ] || {
    echo "error: docs-list override points to missing file: $candidate" >&2
    exit 2
  }

  printf '%s\n' "$candidate"
  return 0
}

resolve_docs_list_script() {
  if path="$(resolve_override "${DOCS_LIST_SCRIPT:-}" 2>/dev/null)"; then
    printf '%s\n' "$path"
    return 0
  fi

  if path="$(resolve_override "${AGENT_SCRIPTS_DOCS_LIST:-}" 2>/dev/null)"; then
    printf '%s\n' "$path"
    return 0
  fi

  for candidate in \
    "$repo_root/tools/agent-scripts/scripts/docs-list.mjs" \
    "$repo_root/vendor/agent-scripts/scripts/docs-list.mjs" \
    "$workspace_root/core/agent-scripts/scripts/docs-list.mjs"
  do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

need_cmd node

docs_list_script="$(resolve_docs_list_script || true)"
[ -n "$docs_list_script" ] || {
  echo "error: could not resolve docs-list script." >&2
  echo "hint: set DOCS_LIST_SCRIPT or AGENT_SCRIPTS_DOCS_LIST, vendor tools/agent-scripts, or clone $workspace_root/core/agent-scripts." >&2
  exit 2
}

exec node "$docs_list_script" "$@"
