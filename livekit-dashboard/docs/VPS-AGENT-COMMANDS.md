# Agent on VPS (direct upload)

Run these **on the VPS** after uploading `livekit-dashboard/` and `agent-starter-python/` as **sibling folders**.

## Folder layout

```
/home/you/lumivoice/          (any path)
├── livekit-dashboard/
└── agent-starter-python/
    └── .env.local            ← secrets (on VPS only)
```

---

## One-time setup

```bash
cd /path/to/livekit-dashboard

cp .env.vps.example .env
nano .env
# LIVEKIT_PUBLIC_IP=YOUR_PUBLIC_IP
# AUTH_SECRET, ENCRYPTION_KEY, AUTH_URL=http://YOUR_IP:3000

cp ../agent-starter-python/.env.example ../agent-starter-python/.env.local
nano ../agent-starter-python/.env.local
# LIVEKIT_API_KEY + LIVEKIT_API_SECRET from config/livekit.vps.yaml.template
# AGENT_NAME=mahindra_scraping, SKIP_CREDIT_CHECK=1
# Vertex/Gemini keys, GOOGLE_CLOUD_LOCATION=us-central1
# GOOGLE_APPLICATION_CREDENTIALS=livekit-storage.json
# GCS_SERVICE_ACCOUNT_JSON=livekit-storage.json

# Upload livekit-storage.json to ../agent-starter-python/

# Start stack (generates config/livekit.runtime.yaml, mounts VPS LiveKit/SIP configs)
npm run docker:vps:up
```

---

## Deploy agent (pick one)

### With npm (Node on VPS)

```bash
cd /path/to/livekit-dashboard

# Flags
npm run agent:deploy:vps -- --name mahindra_scraping --entrypoint src/agent.py --wait

# Shorthand
npm run agent:deploy:vps -- mahindra_scraping src/agent.py

# Another agent file
npm run agent:deploy:vps -- sales_bot src/agent3.py
```

### With bash only (no Node)

```bash
cd /path/to/livekit-dashboard
chmod +x scripts/deploy-agent-vps.sh

bash scripts/deploy-agent-vps.sh deploy mahindra_scraping src/agent.py --wait
bash scripts/deploy-agent-vps.sh logs
bash scripts/deploy-agent-vps.sh status
bash scripts/deploy-agent-vps.sh stop
```

---

## After uploading new code

```bash
cd /path/to/livekit-dashboard
npm run agent:deploy:vps -- mahindra_scraping src/agent.py
# or
bash scripts/deploy-agent-vps.sh deploy mahindra_scraping src/agent.py
```

---

## Useful commands

```bash
npm run agent:logs:vps
npm run agent:status:vps
npm run agent:stop:vps
```

Look for in logs: `registered worker` and `"agent_name": "mahindra_scraping"`.

---

## UI alternative

Open `http://YOUR_VPS_IP:3000` → **Agents → Deploy** (same Docker agent container).

See also [VPS-DOCKER.md](./VPS-DOCKER.md) · [VPS-DEPLOY.md](./VPS-DEPLOY.md).
