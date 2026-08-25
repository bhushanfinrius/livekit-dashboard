# Deck — self-hosted LiveKit console

Operations console for **your** LiveKit server: rooms, agents, Talk, sessions, recordings, SIP, egress, and webhooks. It is not LiveKit Cloud.

## Quick start (one command)

Docker Compose starts the UI **and** LiveKit (Postgres, Redis, SIP, egress):

```bash
cp .env.example .env
docker compose up -d --build postgres redis livekit sip egress deck
# or: npm run docker:stack
```

Open [http://localhost:3000](http://localhost:3000), create an account, create a project, click **Generate key pair**.

Full steps, ports, GCS, and production notes: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

Connect a Python worker: **[docs/AGENT_STARTER.md](docs/AGENT_STARTER.md)**.

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

`npm run dev` starts Postgres, Redis, LiveKit, SIP, and egress first (`docker:up`). It does **not** start the `deck` container (port 3000 would clash). If something else already owns **7880**, this repo skips LiveKit so the UI can still start.

## Stack

- Next.js 15 (App Router) + Auth.js v5
- PostgreSQL + Prisma (host port **5433**)
- Docker Compose: LiveKit, Redis, SIP, egress, optional agent, optional Deck UI
- Recordings: `livekit-egress` → GCS (`GCS_BUCKET_NAME` + credentials)

## Scripts

| Script | Purpose |
|---|---|
| `npm run docker:stack` | Build/start UI + LiveKit stack (no agent) |
| `npm run docker:up` | Infra only, for `npm run dev` |
| `npm run dev` | Next.js on the host (Turbopack) |
| `npm run build` / `npm start` | Production build on the host |
| `npm test` | Vitest |
| `npm run db:migrate` | `prisma migrate dev` |

## Auth

- Email/password (bcrypt). Optional GitHub/Google when `AUTH_*` env vars are set.
- Replace `AUTH_SECRET` and `ENCRYPTION_KEY` before a real deployment.
- LiveKit API secrets are stored encrypted (`lk1:`) and never sent to the browser.

## Webhooks

Compose posts to both:

- `http://host.docker.internal:3000/api/webhooks/livekit`
- `http://deck:3000/api/webhooks/livekit`

**Events → Last received** staying on `never` means LiveKit is not reaching Deck. Recreate LiveKit after editing `livekit.yaml`.
