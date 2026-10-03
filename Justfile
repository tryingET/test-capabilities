# Owned-lane command surface; proof ownership: docs/engineering.local.md.

# List supported repo commands (also the default invocation).
help:
    @just --list

# Canonical default Node test suite, including its prerequisite build.
test:
    npm test

# Existing local quality gate; lighter than ci, but includes coverage.
check:
    npm run check

# Build JS and declaration artifacts with the native TypeScript compiler.
build:
    npm run build

# Syntax and non-formatting lint only; npm lint also checks formatting.
lint:
    node ./scripts/ci_lint.mjs
    ./node_modules/.bin/biome lint --no-errors-on-unmatched .

# Format only explicit files: just fmt src/index.ts tests/example.test.mjs
[positional-arguments]
fmt *files:
    #!/bin/sh
    set -eu
    if [ "$#" -eq 0 ]; then
        echo 'Usage: just fmt <file> [file ...]; explicit files required (no directories).' >&2
        exit 1
    fi
    for file in "$@"; do
        case "$file" in -*) echo "fmt: expected a file, not an option: $file" >&2; exit 1 ;; esac
        if [ ! -f "$file" ] || [ -L "$file" ]; then
            echo "fmt: expected a regular, non-symlink file: $file" >&2
            exit 1
        fi
        resolved="$(realpath -e -- "$file")"
        case "$resolved" in
            "$PWD/docs/_core/"*|"$PWD/.git/"*) echo "fmt: protected path: $file" >&2; exit 1 ;;
            "$PWD/"*) ;;
            *) echo "fmt: file must be inside this repo: $file" >&2; exit 1 ;;
        esac
    done
    exec ./node_modules/.bin/biome format --write -- "$@"

# Product CI/release proofs, sequentially, without truth:gate's redundant build.
ci:
    npm run check
    node ./scripts/capability-truth-gate.mjs
    npm run release:check:quick

# Toolchain diagnostics only: no build or product runtime execution.
doctor:
    node --version
    npm --version
    just --version
    ./node_modules/.bin/tsgo --version
    ./node_modules/.bin/biome --version

# One-shot primary CLI, defaulting to help; accepts normal CLI arguments.
[positional-arguments]
run *args:
    #!/bin/sh
    set -eu
    if [ "$#" -eq 0 ]; then set -- --help; fi
    exec npm run test-capabilities -- "$@"
