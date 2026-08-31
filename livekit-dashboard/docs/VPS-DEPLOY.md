# Deploy LumiVoice on a VPS

Production guide for **LumiVoice** (self-hosted LiveKit console) on a Linux VPS: UI, LiveKit, Postgres, Redis, SIP, egress, and optional Python agents.

## 1. VPS requirements

| Item | Minimum (demo) | Recommended (1 agent × 10 concurrent) |
|------|----------------|----------------------------------------|
| vCPU | 4 | 8–16 |
| RAM | 8 GB | 16–32 GB |
| Disk | 40 GB SSD | 80+ GB |
| OS | Ubuntu 22.04 / 24.04 LTS | Same |

**Open these ports** in your cloud firewall / security group:

| Port | Protocol | Purpose |
|------|----------|---------|
| 22 | TCP | SSH |
| 80, 443 | TCP | HTTPS → LumiVoice (Caddy/Nginx) |
| 7880 | TCP | LiveKit HTTP/API |
| 7881 | TCP | LiveKit RTC TCP fallback |
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

## 3. Clone the repo

The Compose file lives in the **inner** `livekit-dashboard` folder.

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

Generate `AUTH_SECRET` and `ENCRYPTION_KEY` (each ≥ 32 characters). Run **twice**:

```bash
openssl rand -base64 32
```

Example production values:

```env
DATABASE_URL="postgresql://deck:deck@localhost:5433/deck"

AUTH_SECRET="<paste-generated-value>"
ENCRYPTION_KEY="<paste-generated-value>"
AUTH_URL="https://voice.yourdomain.com"

DECK_TRANSCRIPT_SECRET="<paste-generated-value>"

# Recordings (optional)
GCS_BUCKET_NAME="your-bucket"
GCS_CREDENTIALS_JSON='{"type":"service_account",...}'

AGENT_BUILD_CONTEXT="/opt/lumivoice/agent-starter-python"
```

Never commit `.env` to git.

## 5. Configure LiveKit for a public VPS

Edit `livekit.yaml` on the server:

```yaml
rtc:
  use_external_ip: true
```

This tells LiveKit to advertise the VPS public IP for WebRTC. Without it, remote Talk/SIP often fails.

After any change to `livekit.yaml`, `sip.yaml`, or `egress.yaml`:

```bash
docker compose up -d --force-recreate livekit sip egress
```

## 6. Start the stack

From `/opt/lumivoice/livekit-dashboard`:

```bash
docker compose up -d --build postgres redis livekit sip egress deck
docker compose ps
docker compose logs deck --tail 50
curl -s http://127.0.0.1:3000/api/health
```

Expect: `{"ok":true,"db":"connected"}`

First build can take several minutes (Next.js + Prisma).

## 7. HTTPS with Caddy (recommended)

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

Update `.env`:

```env
AUTH_URL="https://voice.yourdomain.com"
```

Recreate the UI container:

```bash
docker compose up -d --force-recreate deck
```

Point your DNS **A record** for `voice.yourdomain.com` at the VPS public IP.

## 8. First-time setup in the UI

1. Open `https://voice.yourdomain.com`
2. **Create account** (no default admin)
3. On **First project**, keep the **pre-filled** keys from `livekit.yaml`
4. Click **Create and connect** — do **not** click **Generate key pair** while LumiVoice runs in Docker

## 9. Connect Python agents

Same LiveKit URL and keys as the LumiVoice project. See [AGENT_STARTER.md](./AGENT_STARTER.md).

On the VPS (or a separate agent machine):

```bash
cd /opt/lumivoice/agent-starter-python
cp .env.example .env.local
```

```env
LIVEKIT_URL=ws://YOUR_VPS_PUBLIC_IP:7880
LIVEKIT_API_KEY=<from livekit.yaml>
LIVEKIT_API_SECRET=<from livekit.yaml>
AGENT_NAME=mahindra_scraping
# Vertex / Gemini and other model keys...
```

```bash
uv sync
uv run src/agant.py start
```

**Agents → Deploy** from the UI only works when LumiVoice runs on the **host** (`npm run dev`), not inside the `deck` Docker container.

## 10. Public LiveKit URL (phones / CLI only)

Settings → **Public LiveKit URL** (`wss://…`) is for **SIP phones and the LiveKit CLI**, not browser Talk.

Browser **Talk / Join** uses the project LiveKit URL. On the same VPS, local WebRTC uses the host network; remote browsers need UDP to ports 50000–50100 (HTTP-only tunnels like trycloudflare are **not** enough for Talk).

## 11. Deploy updates (git pull on VPS)

```bash
cd /opt/lumivoice
git pull origin bhushan
cd livekit-dashboard
docker compose up -d --build deck
```

If `livekit.yaml` changed:

```bash
docker compose up -d --force-recreate livekit sip egress
```

## 12. Troubleshooting

| Symptom | What to do |
|---------|------------|
| Talk silent / no WebRTC | Open UDP 50000–50100; set `use_external_ip: true` |
| `invalid API key: deck_…` | Use keys from `livekit.yaml`; don't Generate in Docker |
| `/api/health` fails | `docker compose logs deck`; check `AUTH_SECRET` length ≥ 32 |
| Events → Last received `never` | Webhook URL in `livekit.yaml` must include `http://deck:3000/api/webhooks/livekit` |
| No recordings | Egress running + `GCS_*` set; check **Egresses** tab |
| Signup JSON error | UI crashed — `docker compose logs deck` |

## 13. Suggested sizing (reference)

| Workload | VPS |
|----------|-----|
| LumiVoice + LiveKit, few calls | 4 vCPU / 8 GB |
| 1 agent × 10 concurrent + recordings | 8 vCPU / 16–32 GB on one box, or split agent onto a second 4–8 vCPU node |
| 10 agents × 10 concurrent | Media VPS (24+ vCPU) + separate agent nodes — see sizing notes in project docs |

## 14. What runs where

| Component | Docker service | Host port |
|-----------|----------------|-----------|
| LumiVoice UI | `deck` | 3000 |
| Postgres | `postgres` | 5433 |
| LiveKit | `livekit` | 7880, 7881, UDP 50000–50100 |
| SIP | `sip` | 5060, UDP 10000–10050 |
| Egress | `egress` | internal |
| Redis | `redis` | internal |

Local dev guide: [DEPLOY.md](./DEPLOY.md).
