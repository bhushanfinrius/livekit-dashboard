# LumiVoice — self-hosted LiveKit console

**LumiVoice** is the voice AI operations console for your own LiveKit server: rooms, agents, Talk, sessions, recordings, SIP, egress, and webhooks. It is not LiveKit Cloud.

## Quick start (Docker only)

From **this folder** (`livekit-dashboard/livekit-dashboard`, not the repo root):

```bash
cp .env.example .env
npm run livekit:keys   # generates the LiveKit key pool, AUTH_SECRET, ENCRYPTION_KEY
docker compose up -d --build postgres redis livekit sip egress deck
```

Windows PowerShell: `Copy-Item .env.example .env` then the same commands. `npm run docker:up` runs both steps.

Open [http://localhost:3000](http://localhost:3000), create an account, create a project. No keys to paste: each project is assigned its own LiveKit API key from the generated pool, LiveKit Cloud style. Its Project ID, Project URL and SIP URI are on the project's **Settings** page.

## LiveKit API keys

Nothing sensitive is committed. `npm run livekit:keys` writes `config/livekit.keys.json` (gitignored) and renders `livekit.yaml`, `sip.yaml`, `egress.yaml` and `config/sip.vps.yaml` from their `.template` siblings.

The pool exists because LiveKit reads `keys:` only at startup, so pairs must be created before a project needs one.

| Command | Purpose |
|---------|---------|
| `npm run livekit:keys` | Generate on first run, then re-render configs (idempotent) |
| `npm run livekit:keys -- --pool 40` | Choose the pool size on first generation (default 20) |
| `npm run livekit:keys -- --pool-add 10` | Add pairs when the pool runs out |
| `npm run livekit:keys -- --show` | List the pool and which pairs are assigned |
| `npm run livekit:keys -- --reassign` | Move projects off retired keys onto free pairs |

Recreate the affected containers after any change, since keys are read at startup:

```bash
docker compose up -d --force-recreate livekit sip egress
```

Upgrading an install that used the old committed key pair: run `npm run livekit:keys`, recreate `livekit`, `sip` and `egress`, then `npm run livekit:keys -- --reassign` to move existing projects onto pool pairs and re-sync the deployed agent worker.

| Guide | Purpose |
|-------|---------|
| **[docs/DEPLOY.md](docs/DEPLOY.md)** | Local / laptop setup |
| **[docs/VPS-DEPLOY.md](docs/VPS-DEPLOY.md)** | Production VPS (HTTPS, TURN, public IP) |
| **[docs/PERFORMANCE.md](docs/PERFORMANCE.md)** | India latency — nearest to / surpass Cloud |
| **[docs/AGENT_STARTER.md](docs/AGENT_STARTER.md)** | Python voice agents |

## What you get

| Area | What it does |
|---|---|
| Overview | Live rooms/participants, webhook charts (24h / 7d / 30d) |
| Rooms | Live `listRooms()`, mute/remove, Join in the browser |
| Agents | Deploy the starter clone, health, **Talk**, test SIP call |
| Sessions | Past rooms from webhooks; **Recordings** + transcripts |
| Egresses / Ingresses | Recording jobs and RTMP/WHIP ingest |
| Telephony | Trunks, dispatch rules, outbound dial |
| Events / API keys / Settings | Webhook log, keys, public `wss://` for phones |

Talk always uses the project LiveKit URL (`ws://127.0.0.1:7880` locally). A public `wss://` tunnel is for **phones**, not the browser console.

## Local development (hot reload)

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run dev
```

`npm run dev` starts Postgres, Redis, LiveKit, SIP, and egress first (`docker:up`). It does **not** start the `deck` container (port 3000 would clash).

## Stack

- Next.js 15 (App Router) + Auth.js v5
- PostgreSQL + Prisma (host port **5433**)
- Docker Compose: LiveKit, Redis, SIP, egress, optional agent, LumiVoice UI (`deck` service)
- Recordings: `livekit-egress` → GCS (`GCS_BUCKET_NAME` + credentials)

## Scripts

| Script | Purpose |
|---|---|
| `npm run docker:stack` | Build/start LumiVoice + LiveKit stack (no agent) |
| `npm run docker:up` | Infra only, for `npm run dev` |
| `npm run dev` | Next.js on the host (Turbopack) |
| `npm run build` / `npm start` | Production build on the host |
| `npm test` | Vitest |

## Auth

- Email/password (bcrypt). Optional GitHub/Google when `AUTH_*` env vars are set.
- Replace `AUTH_SECRET` and `ENCRYPTION_KEY` before a real deployment (commands in `.env.example`).
- LiveKit API secrets are stored encrypted (`lk1:`) and never sent to the browser.

## Webhooks

Compose posts to both:

- `http://host.docker.internal:3000/api/webhooks/livekit`
- `http://deck:3000/api/webhooks/livekit`

**Events → Last received** staying on `never` means LiveKit is not reaching LumiVoice. Recreate LiveKit after editing `livekit.yaml`.
