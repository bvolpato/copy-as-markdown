#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${BASH_SOURCE[0]}"
while [[ -L "$SCRIPT" ]]; do
  LINK_DIR="$(cd "$(dirname "$SCRIPT")" && pwd -P)"
  SCRIPT="$(readlink "$SCRIPT")"
  [[ "$SCRIPT" == /* ]] || SCRIPT="$LINK_DIR/$SCRIPT"
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT")" && pwd)"

# Without import.meta.main, the installer would exit without output. Node.js 23.x, 24.0, and 24.1 do not have it.
if ! node --input-type=module -e '
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const supported = major > 22 || (major === 22 && (minor > 22 || (minor === 22 && patch >= 2)));
  process.exit(supported && import.meta.main ? 0 : 1);
' >/dev/null 2>&1; then
  echo "Node.js 22.22.2 or newer is required, and versions 23.x, 24.0, and 24.1 do not work. Install it from https://nodejs.org/." >&2
  exit 1
fi

exec node "$SCRIPT_DIR/build/install.mjs" "$@"
