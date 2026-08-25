import { toHttpLivekitUrl, toWsLivekitUrl } from "@/lib/livekit/url";

export const DEFAULT_AGENT_NAME = "my-agent";

export type AgentDeployGuide = {
  httpUrl: string;
  wsUrl: string;
  dockerWsUrl: string;
  apiKey: string;
  apiSecret: string | null;
  agentName: string;
  starterDir: string;
  envFile: string;
  installCli: string;
  startWorker: string;
  dockerDeploy: string;
  dispatch: string;
};

function quotePath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/");
  return /\s/.test(normalized) ? `"${normalized}"` : normalized;
}

export function buildAgentDeployGuide(input: {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string | null;
  agentName?: string;
  starterDir?: string;
  roomName?: string;
}): AgentDeployGuide {
  const httpUrl = toHttpLivekitUrl(input.livekitUrl);
  const wsUrl = toWsLivekitUrl(input.livekitUrl);
  const agentName = input.agentName?.trim() || DEFAULT_AGENT_NAME;
  const starterDir = (input.starterDir ?? "").trim().replace(/\\/g, "/");
  const roomName = input.roomName?.trim() || "my-room";
  const secret = input.apiSecret?.trim() || "<LIVEKIT_API_SECRET>";
  const key = input.apiKey.trim() || "<LIVEKIT_API_KEY>";

  const envFile = [
    `LIVEKIT_URL=${wsUrl}`,
    `LIVEKIT_API_KEY=${key}`,
    `LIVEKIT_API_SECRET=${secret}`,
    `AGENT_NAME=${agentName}`,
    "# Keep STT / TTS / LLM / realtime keys in this file.",
    "# Deck Deploy copies the whole .env.local, then overlays LiveKit URL/key/secret.",
    "AGENT_ENTRYPOINT=src/agent.py",
  ].join("\n");

  const startWorker = starterDir
    ? `cd ${quotePath(starterDir)}\nuv run src/agent.py start`
    : "uv run src/agent.py start";

  return {
    httpUrl,
    wsUrl,
    dockerWsUrl: "ws://livekit:7880",
    apiKey: key,
    apiSecret: input.apiSecret,
    agentName,
    starterDir,
    envFile,
    installCli: "winget install LiveKit.LiveKitCLI",
    startWorker,
    dockerDeploy: "docker compose up -d --build agent",
    dispatch: `lk dispatch create --room ${roomName} --agent-name ${agentName}`,
  };
}
