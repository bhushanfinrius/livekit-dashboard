#!/usr/bin/env bash
# VPS cleanup + credential alignment. Run from livekit-dashboard/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if command -v node >/dev/null 2>&1; then
  exec node scripts/vps-reset.mjs "$@"
fi
echo "Node.js required." >&2
exit 1
