# Deploy Deck (one command)

Deck is the self-hosted LiveKit operations console. **One command starts the UI plus LiveKit** (Postgres, Redis, SIP, egress). That is a Compose *stack*, not a single container — LiveKit needs UDP media, egress needs Chrome, and SIP needs UDP 5060.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2)
- Free ports:
  - `3000` — Deck UI
  - `5433` — Postgres (mapped from container `5432`)
  - `7880` / `7881` — LiveKit HTTP / RTC TCP
  - UDP `50000–50100` — WebRTC media
  - `5060` + UDP `10000–10050` — SIP (optional, for PSTN)

## Start the stack

From the `livekit-dashboard` directory (this folder, not the repo root):

```bash
cp .env.example .env
# For anything other than a laptop demo, replace AUTH_SECRET and ENCRYPTION_KEY:
#   openssl rand -base64 32
docker compose up -d --build postgres redis livekit sip egress deck
# same as: npm run docker:stack
```

Wait until Deck is healthy, then open [http://localhost:3000](http://localhost:3000).

```bash
docker compose ps
curl http://localhost:3000/api/health
# expect: {"ok":true,"db":"connected"}
```

Do **not** also run `npm run dev` while the `deck` container is bound to port 3000.

## First-time setup

1. Open the UI and **create an account** (there is no baked-in admin user).
2. Create a project. Use **Generate key pair** so Deck writes keys into `livekit.yaml`, `sip.yaml`, and `egress.yaml` and recreates those containers.
3. Confirm **Events** eventually shows `room_started` after you open a room (Talk or Rooms → Join).

Webhook URLs in `livekit.yaml`:

- `http://host.docker.internal:3000/api/webhooks/livekit` — host Deck (`npm run dev`)
- `http://deck:3000/api/webhooks/livekit` — Compose Deck

After changing `livekit.yaml`, run `docker compose up -d --force-recreate livekit`.

## Recordings (optional)

Set in `.env`:

| Variable | Purpose |
|---|---|
| `GCS_BUCKET_NAME` | Bucket LiveKit egress writes to |
| `GCS_CREDENTIALS_PATH` | Host path to a service-account JSON (works with `npm run dev`) |
| `GCS_CREDENTIALS_JSON` | Inline JSON (better inside the `deck` container) |

Deck starts an audio room-composite when a room starts. Jobs appear on **Egresses**. After the room ends, playable files appear on **Sessions → Recordings**.

To pass a credentials *file* into the `deck` container, add a volume in Compose (host path → `/secrets/gcs.json`) and set `GCS_CREDENTIALS_PATH=/secrets/gcs.json`.

## Public LiveKit URL (phones only)

Settings → **Public LiveKit URL** (`wss://…`, for example a Cloudflare tunnel to port 7880) is for **SIP phones and the LiveKit CLI**. Browser **Talk / Join** always uses the project LiveKit URL (`ws://127.0.0.1:7880` locally). HTTP tunnels cannot carry WebRTC UDP.

## Local development (UI on the host)

Use this when you want hot reload **or** Agents → Deploy (that button shells out to Docker on the host):

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run dev
```

`npm run dev` runs `docker:up` first: Postgres, Redis, LiveKit, SIP, egress. It does **not** start the `deck` container.

## Agents

The Python worker is **optional**. It is not started by `docker:stack` (slow build, needs LLM/STT keys).

- From host Deck: [AGENT_STARTER.md](./AGENT_STARTER.md) → **Deck Deploy**
- From Compose-only Deck: run the starter yourself against `ws://127.0.0.1:7880` (same guide)

```bash
docker compose --profile agent up -d --build agent   # only if .agent.runtime.env exists
```

## Production notes

- Replace `AUTH_SECRET` and `ENCRYPTION_KEY` (32+ characters). Never commit `.env`.
- Do not publish Postgres `5433` on a public NIC.
- Put Deck behind HTTPS (reverse proxy). Set `AUTH_URL` to that public origin.
- On a real server NIC, set `rtc.use_external_ip: true` in `livekit.yaml` (local compose keeps it `false`).
- SSE live events are in-process: one Deck replica, not a multi-instance farm.
- Rotate LiveKit keys from onboarding/Settings rather than editing YAML by hand unless you know you must.
