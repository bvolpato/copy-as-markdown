#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${BASH_SOURCE[0]}"
while [[ -L "$SCRIPT" ]]; do
  LINK_DIR="$(cd "$(dirname "$SCRIPT")" && pwd)"
  SCRIPT="$(readlink "$SCRIPT")"
  [[ "$SCRIPT" == /* ]] || SCRIPT="$LINK_DIR/$SCRIPT"
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT")" && pwd)"

# Older Node.js versions do not support import.meta.main, so the installer would exit without output.
if ! node -e '
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  process.exit(major > 22 || (major === 22 && (minor > 22 || (minor === 22 && patch >= 2))) ? 0 : 1);
' >/dev/null 2>&1; then
  echo "Node.js 22.22.2 or newer is required. Install it from https://nodejs.org/." >&2
  exit 1
fi

exec node "$SCRIPT_DIR/build/install.mjs" "$@"
