# LumiVoice + agent starter

Self-hosted **LumiVoice** voice AI console and a **Python agent** worker.

| Folder | What it is |
|---|---|
| [livekit-dashboard](livekit-dashboard/) | **LumiVoice** — Next.js ops UI + Docker Compose for LiveKit, Redis, Postgres, SIP, egress |
| [agent-starter-python](agent-starter-python/) | Voice agent worker (`src/agant.py` for Mahindra / vCISO) |

## Start LumiVoice (UI + LiveKit)

You only need Docker Desktop. Run from the **inner** `livekit-dashboard` folder:

```bash
cd livekit-dashboard
cp .env.example .env
docker compose up -d --build postgres redis livekit sip egress deck
```

Windows PowerShell:

```powershell
cd livekit-dashboard
Copy-Item .env.example .env
docker compose up -d --build postgres redis livekit sip egress deck
```

Generate `AUTH_SECRET` / `ENCRYPTION_KEY` with the commands in `livekit-dashboard/.env.example` (optional for a laptop demo).

Open [http://localhost:3000](http://localhost:3000). Create an account, then create a project with the **pre-filled** keys from `livekit.yaml`.

| Guide | Purpose |
|-------|---------|
| [livekit-dashboard/docs/DEPLOY.md](livekit-dashboard/docs/DEPLOY.md) | Local setup |
| [livekit-dashboard/docs/VPS-DEPLOY.md](livekit-dashboard/docs/VPS-DEPLOY.md) | **Production VPS** |
| [livekit-dashboard/docs/PERFORMANCE.md](livekit-dashboard/docs/PERFORMANCE.md) | **India performance vs Cloud** |
| [livekit-dashboard/docs/AGENT_STARTER.md](livekit-dashboard/docs/AGENT_STARTER.md) | Connect agents |

## Connect an agent

Same LiveKit URL and API keys as the LumiVoice project:

```bash
cd agent-starter-python
# .env.local: LIVEKIT_URL=ws://127.0.0.1:7880 plus key, secret, AGENT_NAME, model keys
uv sync
uv run src/agant.py start
```

Or from LumiVoice on the host (`npm run dev`): **Agents → Deploy**.
