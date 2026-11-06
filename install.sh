#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.22.2 or newer is required. Install it from https://nodejs.org/." >&2
  exit 1
fi

exec node "$SCRIPT_DIR/build/install.mjs" "$@"
