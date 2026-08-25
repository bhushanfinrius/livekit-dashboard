# LiveKit dashboard (Deck) + agent starter

Self-hosted LiveKit **console** and a **Python agent** worker that talks to it.

| Folder | What it is |
|---|---|
| [livekit-dashboard](livekit-dashboard/) | **Deck** — Next.js ops UI + Docker Compose for LiveKit, Redis, Postgres, SIP, egress |
| [agent-starter-python](agent-starter-python/) | Voice agent worker (official LiveKit starter layout; this clone also has `src/agant.py`) |

## Start Deck (UI + LiveKit)

```bash
cd livekit-dashboard
cp .env.example .env
docker compose up -d --build postgres redis livekit sip egress deck
```

Open [http://localhost:3000](http://localhost:3000). Guide: [livekit-dashboard/docs/DEPLOY.md](livekit-dashboard/docs/DEPLOY.md).

## Connect an agent

Same LiveKit URL and API keys as the Deck project. Guide: [livekit-dashboard/docs/AGENT_STARTER.md](livekit-dashboard/docs/AGENT_STARTER.md).

```bash
cd agent-starter-python
# .env.local: LIVEKIT_URL=ws://127.0.0.1:7880 plus key, secret, AGENT_NAME, model keys
uv sync
uv run src/agent.py start
```

Or from Deck on the host (`npm run dev`): **Agents → Deploy**.
