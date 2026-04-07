#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# build.sh — Full clean rebuild of Copy as Markdown
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🧹 Cleaning previous build..."
rm -rf dist

echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "🔍 Type-checking..."
pnpm typecheck

echo "🔨 Building all targets..."
pnpm build

echo ""
echo "📋 Output files:"
echo "─────────────────────────────────────────"
find dist -type f | sort | while read -r f; do
  size=$(wc -c < "$f" | tr -d ' ')
  printf "  %-55s %s\n" "$f" "$(numfmt --to=iec "$size" 2>/dev/null || echo "${size}B")"
done
echo "─────────────────────────────────────────"
echo ""
echo "✨ Done!"
