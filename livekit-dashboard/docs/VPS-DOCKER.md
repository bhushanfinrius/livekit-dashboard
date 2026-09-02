# VPS Docker (one-command stack)

Turnkey Docker setup for running **LumiVoice + LiveKit + SIP + egress** on a public VPS with correct ports, TURN, and `use_external_ip`.

## Folder layout

```
/your/path/
├── livekit-dashboard/
│   ├── .env                    ← from .env.vps.example
│   └── config/                 ← VPS LiveKit/SIP configs (committed)
└── agent-starter-python/
    ├── .env.local              ← secrets (never commit)
    ├── solvoxai.json           ← Vertex/Gemini (never commit)
    └── livekit-storage.json    ← GCS recordings (never commit)
```

## Firewall (open on cloud + `ufw`)

| Port | Protocol | Service |
|------|----------|---------|
| 22 | TCP | SSH |
| 3000 | TCP | LumiVoice UI (or 80/443 behind Caddy) |
| 7880 | TCP | LiveKit API / WebSocket |
| 7881 | TCP | LiveKit RTC TCP |
| 3478 | UDP + TCP | LiveKit built-in TURN |
| 50000–50100 | UDP | WebRTC media |
| 5060 | UDP + TCP | SIP |
| 10000–10050 | UDP | SIP RTP |

Do **not** expose Postgres (`5433`) publicly.

## One-time setup on VPS

```bash
cd /path/to/livekit-dashboard

cp .env.vps.example .env
nano .env
# Set LIVEKIT_PUBLIC_IP=your.public.ip.or.hostname
# Set AUTH_SECRET, ENCRYPTION_KEY, AUTH_URL

cp ../agent-starter-python/.env.example ../agent-starter-python/.env.local
nano ../agent-starter-python/.env.local
# LIVEKIT_API_KEY + LIVEKIT_API_SECRET (from config/livekit.vps.yaml.template keys section)
# AGENT_NAME=mahindra_scraping
# SKIP_CREDIT_CHECK=1
# GOOGLE_APPLICATION_CREDENTIALS=solvoxai.json
# GCS_SERVICE_ACCOUNT_JSON=livekit-storage.json
# Vertex/Gemini keys, GOOGLE_CLOUD_LOCATION=asia-south1

# Upload credential JSON files into agent-starter-python/
```

## Start the stack

```bash
npm run docker:vps:up
# or: node scripts/vps-up.mjs
# or: bash scripts/vps-up.sh
```

This will:

1. Read `LIVEKIT_PUBLIC_IP` from `.env`
2. Generate `config/livekit.runtime.yaml` (TURN domain + external IP)
3. Mount `config/livekit.runtime.yaml` and `config/sip.vps.yaml` via `docker-compose.vps.yml`
4. Start `postgres`, `redis`, `livekit`, `sip`, `egress`, `deck`

Optional — stack **and** agent profile:

```bash
npm run docker:vps:up:agent
```

Verify:

```bash
curl -s http://127.0.0.1:3000/api/health
docker compose -f docker-compose.yml -f docker-compose.vps.yml ps
```

## Deploy the Python agent

```bash
npm run agent:deploy:vps -- mahindra_scraping src/agent.py
```

Agent container uses `LIVEKIT_URL=ws://livekit:7880`, mounts GCP JSON from `agent-starter-python/`, and sets `SKIP_CREDIT_CHECK=1` by default.

See [VPS-AGENT-COMMANDS.md](./VPS-AGENT-COMMANDS.md) for logs, status, and bash-only deploy.

## Public URLs

| Use | URL |
|-----|-----|
| UI | `http://YOUR_IP:3000` or HTTPS via Caddy |
| LiveKit (phones / UAT) | `wss://YOUR_IP:7880` |
| Agent name | `mahindra_scraping` (or your `AGENT_NAME`) |

## How config generation works

| File | Role |
|------|------|
| `config/livekit.vps.yaml.template` | Template with `__LIVEKIT_PUBLIC_IP__` placeholder |
| `config/livekit.runtime.yaml` | Generated at deploy time (gitignored) |
| `config/sip.vps.yaml` | SIP with `use_external_ip: true` |
| `docker-compose.vps.yml` | Port overrides + config volume mounts |

Legacy manual copy (`cp livekit.vps.example.yaml livekit.yaml`) still works but is **not** needed when using `npm run docker:vps:up`.

## Reset / cleanup (duplicate projects, wrong URLs)

If you created multiple `demo` projects or the dashboard shows **inferred** sessions with 0 participants, run:

```bash
npm run vps:reset
# or: bash scripts/vps-reset.sh --fix --yes
# keep a specific project: node scripts/vps-reset.mjs --fix --keep-project YOUR_PROJECT_ID --yes
```

This keeps **one** project (most webhook history by default), deletes duplicate projects, sets `livekitUrl` to `http://127.0.0.1:7880`, patches agent `.env.local` (`DECK_TRANSCRIPT_URL`, LiveKit keys, `SKIP_CREDIT_CHECK=1`), regenerates `livekit.runtime.yaml`, and restarts stack + agent.

**Nuclear option** (wipes DB — sign up again):

```bash
npm run vps:reset:hard
```

Never rotate `ENCRYPTION_KEY` on soft reset. Only set `AUTH_SECRET` / `ENCRYPTION_KEY` once in `.env`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Duplicate demo projects / empty Sessions | `npm run vps:reset` |
| Calls drop after ~10–20s | Confirm `LIVEKIT_PUBLIC_IP` matches VPS public IP; UDP 50000–50100 + 3478 open |
| `solvoxai.json` not found | Place JSON in `agent-starter-python/`; redeploy agent |
| Credit check rejection | `SKIP_CREDIT_CHECK=1` in `.env.local` (auto-set on deploy) |
| Port 7880 conflict | Stop stray `lumivoice-sfu` or other LiveKit containers |
| Wrong LiveKit URL in agent | Must be `ws://livekit:7880` inside Docker |
| Egress aborted: Start signal not received | Redeploy agent — uses **track composite** on SIP audio (not room composite) |

Full guide: [VPS-DEPLOY.md](./VPS-DEPLOY.md) · Performance: [PERFORMANCE.md](./PERFORMANCE.md)
