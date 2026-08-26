# Deploy Deck (step by step)

Deck is the self-hosted LiveKit operations console. **One Docker Compose command** starts the UI plus LiveKit (Postgres, Redis, SIP, egress). That is a Compose *stack*, not a single container — LiveKit needs UDP media, egress needs Chrome, and SIP needs UDP 5060.

You only need **Docker Desktop**. You do not install Node, Prisma, or LiveKit on the host for this path.

## 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / macOS) or Docker Engine + Compose v2 (Linux)
- Start Docker and wait until it is running
- Free ports:
  - `3000` — Deck UI
  - `5433` — Postgres (mapped from container `5432`)
  - `7880` / `7881` — LiveKit HTTP / RTC TCP
  - UDP `50000–50100` — WebRTC media
  - `5060` + UDP `10000–10050` — SIP (optional, for PSTN)

If `3000` or `7880` is already in use, stop the other app or change the host ports in `docker-compose.yml`.

## 2. Clone and open the app folder

The Compose file is **not** at the repo root.

```bash
git clone https://github.com/bhushanfinrius/livekit-dashboard.git
cd livekit-dashboard/livekit-dashboard
```

Windows PowerShell: same commands.

## 3. Create `.env`

`.env` is not in git. Copy the example:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Generate `AUTH_SECRET` and `ENCRYPTION_KEY` (each at least 32 characters). Run the command **twice** and paste a different value into each variable.

**Windows PowerShell**

```powershell
[Convert]::ToBase64String([byte[]](1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

**macOS / Linux**

```bash
openssl rand -base64 32
```

**Any PC with Node**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Demo laptops may keep the example values (they are already 32+ characters). For a shared or production machine, always generate new ones.

Leave GitHub/Google and GCS blank unless you need them. `AGENT_BUILD_CONTEXT=../agent-starter-python` is only for Agents → Deploy from a host UI.

## 4. Start everything

From `livekit-dashboard/livekit-dashboard`:

```bash
docker compose up -d --build postgres redis livekit sip egress deck
```

Same as `npm run docker:stack` if you have Node.

First build downloads Postgres, Redis, LiveKit, SIP, egress, and compiles the Deck image (Prisma generate + Next.js). That can take several minutes.

Wait until Deck is healthy:

```bash
docker compose ps
docker compose logs deck --tail 40
```

You should see `Running database migrations...` then `Starting Deck...`. Then:

```bash
curl http://localhost:3000/api/health
```

Expect `{"ok":true,"db":"connected"}`.

Windows without curl: open http://localhost:3000/api/health in a browser.

Do **not** also run `npm run dev` while the `deck` container owns port 3000.

## 5. First-time UI setup

1. Open [http://localhost:3000](http://localhost:3000).
2. Create an account (there is no default admin). Password must be at least 8 characters.
3. On **First project**, the LiveKit URL, API key, and secret are filled from `livekit.yaml`. **Leave them as they are.**
4. Click **Create and connect**. Do **not** click Generate key pair when Deck is running in Docker — LiveKit already loaded the YAML keys, and a new key will return `invalid API key`.

Confirm **Events** eventually shows `room_started` after you open a room (Talk or Rooms → Join).

Webhook URLs in `livekit.yaml`:

- `http://host.docker.internal:3000/api/webhooks/livekit` — host Deck (`npm run dev`)
- `http://deck:3000/api/webhooks/livekit` — Compose Deck

After changing `livekit.yaml` by hand, run `docker compose up -d --force-recreate livekit sip egress`.

## 6. If something fails

| Symptom | What to do |
|---|---|
| `deck` exits / Prisma error | `docker compose logs deck`. Rebuild: `docker compose up -d --build deck` |
| `/api/health` is `{"ok":false}` | `.env` `AUTH_SECRET` / `ENCRYPTION_KEY` shorter than 32 characters, or Postgres not healthy |
| Signup “not JSON” | Deck crashed; `docker compose logs deck` |
| `invalid API key: deck_…` | You generated a new key. Paste the key/secret from `livekit.yaml` and Create |
| Port already allocated | Stop the other container/process on `3000` or `7880` |
| UI loads, Talk is silent | Talk uses `ws://127.0.0.1:7880` on **this** PC. Other machines need a real UDP-capable LiveKit URL |

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

Use this when you want hot reload, **Generate key pair**, or Agents → Deploy (those shell out to Docker on the host):

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run dev
```

`npm run dev` runs `docker:up` first: Postgres, Redis, LiveKit, SIP, egress. It does **not** start the `deck` container.

Generate key pair on the host rewrites `livekit.yaml` / `sip.yaml` / `egress.yaml` and recreates those containers. That is optional; the committed YAML keys already work.

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
- Rotate LiveKit keys from a **host** Deck (`npm run dev`) rather than the `deck` container.
