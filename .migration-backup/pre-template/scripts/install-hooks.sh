#!/usr/bin/env sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: missing dependency: $1" >&2; exit 2; }
}

need_cmd git

chmod +x \
  "$repo_root/.githooks/pre-commit" \
  "$repo_root/.githooks/pre-push" \
  "$repo_root/scripts/install-hooks.sh" \
  "$repo_root/scripts/docs-list.sh" \
  "$repo_root/scripts/code-list.sh" \
  "$repo_root/scripts/tech-stack.sh" \
  "$repo_root/scripts/ci/smoke.sh" \
  "$repo_root/scripts/ci/full.sh"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git config core.hooksPath .githooks
  echo "Configured git hooks path: .githooks"
else
  echo "warning: not inside a git repository; hook path not configured" >&2
  echo "hint: run 'git init -b main' and then './scripts/install-hooks.sh'" >&2
fi
