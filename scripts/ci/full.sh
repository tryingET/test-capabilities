#!/bin/sh
set -eu

say() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }
die() { err "error: $*"; exit 1; }

is_enabled() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

script_dir="$(cd "$(dirname "$0")" && pwd)"
deep=0

if [ "${1:-}" = "--deep" ]; then
  deep=1
  shift
fi

[ "$#" -eq 0 ] || die "unsupported args: $*"

"$script_dir/smoke.sh"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$repo_root" ] && cd "$repo_root"

if [ -f package.json ]; then
  npm run --silent test

  if [ "$deep" -eq 1 ]; then
    if is_enabled "${RUN_CONVEX_RUNTIME_TESTS:-}"; then
      npm run --silent test:runtime
    else
      say "info: deep lane requested; runtime checks skipped (set RUN_CONVEX_RUNTIME_TESTS=1 and CONVEX_URL or CONVEX_DEPLOYMENT)."
    fi
  fi
fi

say "ok: ci full"
