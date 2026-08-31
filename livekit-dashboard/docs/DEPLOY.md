# Deploy LumiVoice locally (step by step)

**LumiVoice** is the self-hosted LiveKit operations console. **One Docker Compose command** starts the UI plus LiveKit (Postgres, Redis, SIP, egress). That is a Compose *stack*, not a single container — LiveKit needs UDP media, egress needs Chrome, and SIP needs UDP 5060.

For **production on a VPS** (HTTPS, public IP, firewall), see **[VPS-DEPLOY.md](./VPS-DEPLOY.md)**.

You only need **Docker Desktop**. You do not install Node, Prisma, or LiveKit on the host for this path.

## 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / macOS) or Docker Engine + Compose v2 (Linux)
- Start Docker and wait until it is running
- Free ports:
  - `3000` — LumiVoice UI
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
git checkout bhushan
```

Windows PowerShell: same commands.

## 3. Create `.env`

`.env` is not in git. Copy the example:

```bash
cp .env.example .env
```

Generate `AUTH_SECRET` and `ENCRYPTION_KEY` (each at least 32 characters). Run the command **twice**:

**Windows PowerShell**

```powershell
[Convert]::ToBase64String([byte[]](1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

**macOS / Linux**

```bash
openssl rand -base64 32
```

Demo laptops may keep the example values. For production, always generate new ones.

## 4. Start everything

```bash
docker compose up -d --build postgres redis livekit sip egress deck
```

Wait until LumiVoice is healthy:

```bash
docker compose ps
docker compose logs deck --tail 40
curl http://localhost:3000/api/health
```

Expect `{"ok":true,"db":"connected"}`.

Do **not** also run `npm run dev` while the `deck` container owns port 3000.

## 5. First-time UI setup

1. Open [http://localhost:3000](http://localhost:3000).
2. Create an account (no default admin). Password ≥ 8 characters.
3. On **First project**, keep the **pre-filled** keys from `livekit.yaml`.
4. Click **Create and connect**. Do **not** Generate key pair in Docker.

## 6. If something fails

| Symptom | What to do |
|---|---|
| `deck` exits / Prisma error | `docker compose logs deck`. Rebuild: `docker compose up -d --build deck` |
| `/api/health` is `{"ok":false}` | `AUTH_SECRET` / `ENCRYPTION_KEY` shorter than 32 chars |
| Signup “not JSON” | `docker compose logs deck` |
| `invalid API key: deck_…` | Use keys from `livekit.yaml`; don't Generate in Docker |
| Talk silent on another PC | Talk needs `ws://127.0.0.1:7880` on the same machine locally |

## Recordings (optional)

Set `GCS_BUCKET_NAME` and `GCS_CREDENTIALS_JSON` (or path) in `.env`. LumiVoice starts audio recording when a room starts.

## Local development (host UI)

For hot reload, **Generate key pair**, or **Agents → Deploy**:

```bash
npm install
npx prisma migrate deploy
npx prisma generate
npm run dev
```

## Agents

See [AGENT_STARTER.md](./AGENT_STARTER.md). The Python worker is optional and not started by `docker:stack`.

## Production

Use **[VPS-DEPLOY.md](./VPS-DEPLOY.md)** for HTTPS, `use_external_ip: true`, and firewall rules.
