#!/usr/bin/env sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
workspace_root="${AI_SOCIETY_WORKSPACE:-$HOME/ai-society}"

resolve_source_override() {
  value="$1"
  [ -n "$value" ] || return 1

  case "$value" in
    /*) candidate="$value" ;;
    *) candidate="$repo_root/$value" ;;
  esac

  [ -d "$candidate" ] || {
    echo "error: tech-stack-core source override is not a directory: $candidate" >&2
    exit 2
  }

  printf '%s\n' "$candidate"
  return 0
}

resolve_source_path() {
  if source_path="$(resolve_source_override "${TECH_STACK_CORE_SOURCE:-}" 2>/dev/null)"; then
    printf '%s\n' "$source_path"
    return 0
  fi

  if source_path="$(resolve_source_override "${TECH_STACK_CORE_REPO:-}" 2>/dev/null)"; then
    printf '%s\n' "$source_path"
    return 0
  fi

  for candidate in \
    "$repo_root/tools/tech-stack-core" \
    "$repo_root/vendor/tech-stack-core" \
    "$workspace_root/core/tech-stack-core"
  do
    if [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

source_path="$(resolve_source_path || true)"

if [ -n "$source_path" ]; then
  if command -v uv >/dev/null 2>&1; then
    exec uv tool run --from "$source_path" tech-stack-core "$@"
  fi

  if command -v tech-stack-core >/dev/null 2>&1; then
    exec tech-stack-core "$@"
  fi

  echo "error: missing dependency: uv (or install tech-stack-core as a tool)." >&2
  exit 2
fi

if command -v tech-stack-core >/dev/null 2>&1; then
  exec tech-stack-core "$@"
fi

echo "error: could not resolve tech-stack-core source." >&2
echo "hint: set TECH_STACK_CORE_SOURCE, vendor tools/tech-stack-core, or clone $workspace_root/core/tech-stack-core." >&2
exit 2
