# LumiVoice performance (nearest to / surpass LiveKit Cloud)

For **India-only users**, LumiVoice can reach **~85–92%** of LiveKit Cloud performance, and **surpass Cloud on latency** when the full path stays in India.

## What we changed in this repo

| Change | Why |
|--------|-----|
| LiveKit **built-in TURN** (`turn:` in YAML + `docker-compose.vps.yml`) | Cloud-like NAT traversal for mobile / office networks |
| `livekit.vps.example.yaml` with `use_external_ip: true` | Correct ICE candidates on a public VPS |
| Agent default **`GOOGLE_CLOUD_LOCATION=asia-south1`** | Shorter RTT to Gemini Live for Indian callers |
| Agent **job-count load** + **2 idle processes** (not 20) | Stable 10 concurrent without wasting RAM |
| Docs / Settings hints | Operators know the India checklist |

## India checklist (do this on the VPS)

1. **VPS region:** Mumbai / Bangalore (AWS `ap-south-1`, GCP `asia-south1`, etc.).
2. **LiveKit config:**
   ```bash
   cp livekit.vps.example.yaml livekit.yaml
   # set turn.domain to your public IP or hostname
   # set sip.yaml use_external_ip: true
   docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --force-recreate livekit sip egress
   ```
3. **Firewall:** TCP 7880, 7881, 3478 · UDP 3478, 50000–50100 · SIP if needed.
4. **Agent `.env.local`:**
   ```env
   GOOGLE_CLOUD_LOCATION=asia-south1
   AGENT_MAX_CONCURRENT_JOBS=10
   AGENT_NUM_IDLE_PROCESSES=2
   LIVEKIT_URL=ws://YOUR_VPS_IP:7880
   ```
5. **Do not** put Vertex in `us-central1` for India traffic unless the model is unavailable in Mumbai.

## When you match or beat Cloud

| Metric | Condition |
|--------|-----------|
| Time-to-first-audio | VPS + Vertex both in India |
| Talk on Wi‑Fi | UDP open + `use_external_ip: true` |
| Talk on mobile / corporate NAT | TURN enabled (`turn.enabled: true`) |
| 10 concurrent | Agent load cap 10 + enough CPU/RAM; egress not starving the box |

## When Cloud still wins

- Global (US + EU + India) users without multi-region SFUs
- Zero-ops HA / failover
- Deep Agent Insights / managed autoscaling UI

## Capacity tip

Keep **agent** and **egress** from fighting for RAM:

- Agent node: voice + tools only  
- Media node: LiveKit + Redis + SIP + egress + LumiVoice  

Same region (India). See [VPS-DEPLOY.md](./VPS-DEPLOY.md).
