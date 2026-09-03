#!/usr/bin/env bash
# Deploy agent on this VPS (no laptop SSH). Run from livekit-dashboard/.
#
#   bash scripts/deploy-agent-vps.sh deploy CTF-Agent src/agent.py
#   bash scripts/deploy-agent-vps.sh logs
#   bash scripts/deploy-agent-vps.sh status
#   bash scripts/deploy-agent-vps.sh stop
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STARTER="${AGENT_BUILD_CONTEXT:-$ROOT/../agent-starter-python}"
if [[ "$STARTER" != /* ]]; then
  STARTER="$(cd "$ROOT" && cd "$STARTER" && pwd)"
fi

CMD="deploy"
AGENT_NAME=""
AGENT_ENTRYPOINT="src/agent.py"
NO_BUILD=""
WAIT=""

usage() {
  cat <<'EOF'
Usage (from livekit-dashboard/ on the VPS):

  bash scripts/deploy-agent-vps.sh deploy --name CTF-Agent --entrypoint src/agent.py
  bash scripts/deploy-agent-vps.sh deploy CTF-Agent src/agent.py
  bash scripts/deploy-agent-vps.sh logs|status|stop

Requires sibling folder: ../agent-starter-python/.env.local
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    deploy|logs|status|stop|help)
      CMD="$1"
      shift
      ;;
    --name|-n)
      AGENT_NAME="${2:?}"
      shift 2
      ;;
    --entrypoint|-e|--file)
      AGENT_ENTRYPOINT="${2:?}"
      shift 2
      ;;
    --no-build)
      NO_BUILD="1"
      shift
      ;;
    --wait)
      WAIT="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ "$CMD" == "deploy" && -z "$AGENT_NAME" ]]; then
        AGENT_NAME="$1"
        shift
        if [[ $# -gt 0 && "$1" != --* ]]; then
          AGENT_ENTRYPOINT="$1"
          shift
        fi
      else
        echo "Unknown argument: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.vps.yml -f docker-compose.agent.yml --profile agent)
BUILD_CTX="$(python3 -c "import os; print(os.path.relpath('$STARTER', '$ROOT'))" 2>/dev/null || echo "../agent-starter-python")"
export AGENT_BUILD_CONTEXT="$BUILD_CTX"

prepare_runtime() {
  local name="${1:?}"
  local entry="${2:?}"
  local env_local="$STARTER/.env.local"
  local runtime="$ROOT/.agent.runtime.env"

  if [[ ! -f "$env_local" ]]; then
    echo "Missing $env_local — create it on the VPS with LIVEKIT + Vertex keys." >&2
    exit 1
  fi

  cp "$env_local" "$runtime"
  update_env() {
    local key="$1" val="$2" file="$3"
    if grep -q "^${key}=" "$file" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$file"
    else
      printf '%s=%s\n' "$key" "$val" >> "$file"
    fi
  }
  update_env LIVEKIT_URL ws://livekit:7880 "$runtime"
  update_env AGENT_NAME "$name" "$runtime"
  update_env AGENT_ENTRYPOINT "$entry" "$runtime"

  if [[ "$entry" != "src/agent.py" ]]; then
    cat > docker-compose.agent.yml <<EOF
services:
  agent:
    command: ["uv", "run", "$entry", "start"]
EOF
  else
    printf '%s\n' 'services:' '  agent: {}' > docker-compose.agent.yml
  fi
}

case "$CMD" in
  deploy)
    [[ -n "$AGENT_NAME" ]] || { echo "Agent name required: --name CTF-Agent" >&2; exit 1; }
    prepare_runtime "$AGENT_NAME" "$AGENT_ENTRYPOINT"
    echo "Deploying $AGENT_NAME ($AGENT_ENTRYPOINT) from $STARTER"
    BUILD_FLAG="--build"
    [[ -n "$NO_BUILD" ]] && BUILD_FLAG="--no-build"
    "${COMPOSE[@]}" up -d "$BUILD_FLAG" --force-recreate --no-deps agent
    "${COMPOSE[@]}" ps agent
    if [[ -n "$WAIT" ]]; then
      echo "Waiting for registered worker…"
      for _ in $(seq 1 45); do
        if "${COMPOSE[@]}" logs agent --tail 80 2>/dev/null | grep -q "registered worker"; then
          if "${COMPOSE[@]}" logs agent --tail 80 2>/dev/null | grep -q "$AGENT_NAME"; then
            echo "✓ Agent registered: $AGENT_NAME"
            exit 0
          fi
        fi
        sleep 4
      done
      echo "⚠ Timed out — check: bash scripts/deploy-agent-vps.sh logs" >&2
    fi
    ;;
  logs)
    prepare_runtime "${AGENT_NAME:-my-agent}" "$AGENT_ENTRYPOINT"
    "${COMPOSE[@]}" logs agent --tail 120 -f
    ;;
  status)
    prepare_runtime "${AGENT_NAME:-my-agent}" "$AGENT_ENTRYPOINT"
    "${COMPOSE[@]}" ps agent
    "${COMPOSE[@]}" logs agent --tail 30 2>/dev/null || true
    ;;
  stop)
    prepare_runtime "${AGENT_NAME:-my-agent}" "$AGENT_ENTRYPOINT"
    "${COMPOSE[@]}" stop agent
    ;;
  help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
