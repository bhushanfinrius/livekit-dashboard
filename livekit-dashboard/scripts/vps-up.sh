#!/usr/bin/env bash
# Start VPS Docker stack (generates LiveKit config from LIVEKIT_PUBLIC_IP).
# Run from livekit-dashboard/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if command -v node >/dev/null 2>&1; then
  exec node scripts/vps-up.mjs "$@"
fi
echo "Node.js required. Install node or run: docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d" >&2
exit 1
