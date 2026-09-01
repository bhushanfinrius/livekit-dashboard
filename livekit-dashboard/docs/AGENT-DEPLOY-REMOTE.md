# Deploy agent from any laptop (Cloud-style)

Self-hosted equivalent of LiveKit Cloud [`lk agent deploy`](https://docs.livekit.io/reference/developer-tools/livekit-cli/agent/). Code is pushed to your VPS, then Docker builds and runs the worker there.

## One-time setup

### On the VPS

```bash
sudo mkdir -p /opt/lumivoice && sudo chown $USER:$USER /opt/lumivoice
cd /opt/lumivoice
git clone https://github.com/bhushanfinrius/livekit-dashboard.git .
git checkout bhushan

cd livekit-dashboard
cp .env.example .env
# Set AUTH_SECRET, ENCRYPTION_KEY, AGENT_BUILD_CONTEXT=/opt/lumivoice/agent-starter-python

cd ../agent-starter-python
cp .env.example .env.local
# LIVEKIT keys from livekit.yaml; Vertex/Gemini keys; AGENT_NAME=mahindra_scraping

cd ../livekit-dashboard
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build \
  postgres redis livekit sip egress deck
```

### On your laptop

```bash
cd livekit-dashboard
cp .deploy.env.example .deploy.env
```

Edit `.deploy.env`:

```env
LV_DEPLOY_HOST="ubuntu@YOUR_VPS_IP"
LV_DEPLOY_ROOT="/opt/lumivoice"
LV_DEPLOY_BRANCH="bhushan"
LV_AGENT_NAME="mahindra_scraping"
LV_COMPOSE_EXTRA="-f docker-compose.yml -f docker-compose.vps.yml"
LV_GIT_PUSH="1"
LV_WAIT="1"
```

Add SSH key to the VPS (`ssh-copy-id ubuntu@YOUR_VPS_IP`).

## Deploy commands

| Command | What it does |
|---------|----------------|
| `npm run agent:deploy` | Deploy agent **locally** (Docker on this PC) |
| `npm run agent:deploy:remote` | Push (if enabled) + pull on VPS + build + start agent |
| `npm run agent:status:remote` | Remote container status + last logs |
| `npm run agent:logs:remote` | Stream remote agent logs |

With explicit git push:

```bash
npm run agent:deploy:remote -- --push --wait
```

Skip rebuild (restart only):

```bash
npm run agent:deploy:remote -- --no-build
```

## Typical workflow

```bash
# 1) Edit agent code locally
# 2) Deploy to VPS from any machine:
cd livekit-dashboard
npm run agent:deploy:remote -- --push

# 3) Open LumiVoice on VPS → Agents → should show registered
# 4) Talk / SIP dispatch using agent name mahindra_scraping
```

## What this does NOT use

- **`lk agent deploy`** — LiveKit Cloud only; does not target your VPS.
- Uploading `.env.local` from laptop — secrets live only on the server.

See also [AGENT_STARTER.md](./AGENT_STARTER.md), [VPS-DEPLOY.md](./VPS-DEPLOY.md).
