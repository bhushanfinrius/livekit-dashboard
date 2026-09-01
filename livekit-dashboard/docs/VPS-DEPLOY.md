# Deploy LumiVoice on a VPS

Production guide for **LumiVoice** (self-hosted LiveKit console) on a Linux VPS: UI, LiveKit, Postgres, Redis, SIP, egress, TURN, and optional Python agents.

**India users:** put the VPS in Mumbai/Bangalore, enable TURN, and set agent `GOOGLE_CLOUD_LOCATION=asia-south1`. See [PERFORMANCE.md](./PERFORMANCE.md).

## 1. VPS requirements

| Item | Minimum (demo) | Recommended (1 agent × 10 concurrent) |
|------|----------------|----------------------------------------|
| vCPU | 4 | 8–16 |
| RAM | 8 GB | 16–32 GB |
| Disk | 40 GB SSD | 80+ GB |
| OS | Ubuntu 22.04 / 24.04 LTS | Same |
| **Region (India)** | — | **Mumbai / Bangalore** |

**Open these ports** in your cloud firewall / security group:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80, 443 | TCP | HTTPS → LumiVoice (Caddy/Nginx) |
| 7880 | TCP | LiveKit HTTP/API |
| 7881 | TCP | LiveKit RTC TCP fallback |
| **3478** | **UDP + TCP** | **LiveKit built-in TURN** (mobile/NAT) |
| 50000–50100 | **UDP** | WebRTC media (**required**) |
| 5060 | UDP/TCP | SIP (phones) |
| 10000–10050 | UDP | SIP RTP (phones) |

Do **not** expose Postgres (`5433`) to the public internet.

## 2. Install Docker

```bash
sudo apt update && sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in, then verify:

```bash
docker compose version
```

## 3. Put the code on the VPS

### Option A — Direct upload (SFTP / rsync / scp)

Upload **both folders as siblings** (no git required):

```
/your/path/
├── livekit-dashboard/
└── agent-starter-python/
```

Then on the VPS:

```bash
cd /your/path/livekit-dashboard
cp .env.vps.example .env
nano .env

cp ../agent-starter-python/.env.example ../agent-starter-python/.env.local
nano ../agent-starter-python/.env.local
```

Agent deploy commands: **[VPS-AGENT-COMMANDS.md](./VPS-AGENT-COMMANDS.md)**

### Option B — Git clone

```bash
sudo mkdir -p /opt/lumivoice
sudo chown $USER:$USER /opt/lumivoice
cd /opt/lumivoice
git clone https://github.com/bhushanfinrius/livekit-dashboard.git .
git checkout bhushan
cd livekit-dashboard
```

## 4. Create `.env`

```bash
cp .env.example .env
nano .env
```

Generate secrets (run twice for `AUTH_SECRET` and `ENCRYPTION_KEY`):

```bash
openssl rand -base64 32
```

```env
DATABASE_URL="postgresql://deck:deck@localhost:5433/deck"
AUTH_SECRET="<paste-generated-value>"
ENCRYPTION_KEY="<paste-generated-value>"
AUTH_URL="https://voice.yourdomain.com"
DECK_TRANSCRIPT_SECRET="<paste-generated-value>"
AGENT_BUILD_CONTEXT="/opt/lumivoice/agent-starter-python"
```

Never commit `.env` to git.

## 5. LiveKit + TURN (Cloud-like NAT)

Use the VPS example config (external IP + TURN):

```bash
cp livekit.vps.example.yaml livekit.yaml
# Edit turn.domain → your public IP or hostname (required)
# Edit sip.yaml → use_external_ip: true
PUBLIC_IP=$(curl -4 -s ifconfig.me)
sed -i "s/YOUR_PUBLIC_IP_OR_HOSTNAME/${PUBLIC_IP}/" livekit.yaml
```

Also set in `sip.yaml`:

```yaml
use_external_ip: true
```

## 6. Start the stack (with TURN ports)

```bash
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build \
  postgres redis livekit sip egress deck
# same as: npm run docker:vps

docker compose ps
docker compose logs deck --tail 50
curl -s http://127.0.0.1:3000/api/health
```

Expect: `{"ok":true,"db":"connected"}`

## 7. HTTPS with Caddy

```bash
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

```caddy
voice.yourdomain.com {
  reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

Set `AUTH_URL="https://voice.yourdomain.com"` in `.env`, then:

```bash
docker compose up -d --force-recreate deck
```

## 8. First-time UI setup

1. Open `https://voice.yourdomain.com`
2. Create account
3. Keep **pre-filled** keys from `livekit.yaml` → **Create and connect**
4. Do **not** Generate key pair inside Docker

## 9. Connect Python agents (India latency)

```bash
cd /opt/lumivoice/agent-starter-python
cp .env.example .env.local
nano .env.local
```

```env
LIVEKIT_URL=ws://YOUR_VPS_PUBLIC_IP:7880
LIVEKIT_API_KEY=<from livekit.yaml>
LIVEKIT_API_SECRET=<from livekit.yaml>
AGENT_NAME=mahindra_scraping
GOOGLE_CLOUD_PROJECT=your-gcp-project
GOOGLE_CLOUD_LOCATION=asia-south1
AGENT_MAX_CONCURRENT_JOBS=10
AGENT_NUM_IDLE_PROCESSES=2
# Vertex / Gemini credentials...
```

```bash
uv sync
uv run src/agent.py start
```

**Prefer Docker on VPS:** see [VPS-AGENT-COMMANDS.md](./VPS-AGENT-COMMANDS.md) — `npm run agent:deploy:vps -- mahindra_scraping src/agent.py`

`asia-south1` (Mumbai) is the default in code now. Avoid `us-central1` for India callers unless the model is missing in India.

## 10. Public LiveKit URL (phones / CLI)

Settings → **Public LiveKit URL** (`wss://…`) for SIP phones / CLI only. Browser Talk needs UDP (and TURN for hard NATs), not an HTTP-only tunnel.

## 11. Deploy updates

```bash
cd /opt/lumivoice
git pull origin bhushan
cd livekit-dashboard
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build deck
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --force-recreate livekit sip egress
```

## 12. Troubleshooting

| Symptom | What to do |
|---------|------------|
| Talk fails off-LAN | UDP 50000–50100 + TURN 3478; `use_external_ip: true`; `turn.enabled: true` |
| High Gemini latency in India | Set `GOOGLE_CLOUD_LOCATION=asia-south1` |
| Worker rejects new calls early | Raise `AGENT_MAX_CONCURRENT_JOBS` or add CPU; check load is job-based |
| `invalid API key` | Use keys from `livekit.yaml` |
| No recordings | Egress + GCS; prefer audio-only |

## 13. Sizing

| Workload | VPS |
|----------|-----|
| LumiVoice + LiveKit, few calls | 4 vCPU / 8 GB (India region) |
| 1 agent × 10 + recordings | 8–16 vCPU / 16–32 GB, or split agent |
| Many concurrent recordings | Separate egress-capable node |

## 14. Services

| Component | Service | Ports |
|-----------|---------|-------|
| LumiVoice UI | `deck` | 3000 |
| LiveKit | `livekit` | 7880, 7881, **3478**, UDP 50000–50100 |
| SIP | `sip` | 5060, UDP 10000–10050 |
| Egress / Redis / Postgres | as in Compose | Postgres host 5433 only |

More: [PERFORMANCE.md](./PERFORMANCE.md) · [DEPLOY.md](./DEPLOY.md) · [AGENT_STARTER.md](./AGENT_STARTER.md).
