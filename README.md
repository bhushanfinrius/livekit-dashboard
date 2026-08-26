# LiveKit dashboard (Deck) + agent starter

Self-hosted LiveKit **console** and a **Python agent** worker that talks to it.

| Folder | What it is |
|---|---|
| [livekit-dashboard](livekit-dashboard/) | **Deck** — Next.js ops UI + Docker Compose for LiveKit, Redis, Postgres, SIP, egress |
| [agent-starter-python](agent-starter-python/) | Voice agent worker (official LiveKit starter layout; this clone also has `src/agant.py`) |

## Start Deck (UI + LiveKit)

You only need Docker Desktop. Run these from the **inner** `livekit-dashboard` folder:

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

Open [http://localhost:3000](http://localhost:3000). Create an account, then create a project with the **pre-filled** keys from `livekit.yaml`. Do not Generate a new LiveKit key pair while Deck runs in Docker.

Guide: [livekit-dashboard/docs/DEPLOY.md](livekit-dashboard/docs/DEPLOY.md).

## Connect an agent

Same LiveKit URL and API keys as the Deck project. Guide: [livekit-dashboard/docs/AGENT_STARTER.md](livekit-dashboard/docs/AGENT_STARTER.md).

```bash
cd agent-starter-python
# .env.local: LIVEKIT_URL=ws://127.0.0.1:7880 plus key, secret, AGENT_NAME, model keys
uv sync
uv run src/agent.py start
```

Or from Deck on the host (`npm run dev`): **Agents → Deploy**.
