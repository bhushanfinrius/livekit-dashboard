import { describe, expect, it } from "vitest";
import { buildAgentDeployGuide, DEFAULT_AGENT_NAME } from "@/lib/livekit/deploy-commands";
import { toWsLivekitUrl } from "@/lib/livekit/url";

describe("toWsLivekitUrl", () => {
  it("converts local HTTP LiveKit URLs to ws", () => {
    expect(toWsLivekitUrl("http://127.0.0.1:7880")).toBe("ws://127.0.0.1:7880");
    expect(toWsLivekitUrl("http://localhost:7880/")).toBe("ws://127.0.0.1:7880");
  });
});

describe("buildAgentDeployGuide", () => {
  it("fills starter env and dispatch from project creds", () => {
    const guide = buildAgentDeployGuide({
      livekitUrl: "http://127.0.0.1:7880",
      apiKey: "devkey",
      apiSecret: "devsecret_livekit_local_32chars!",
      agentName: "sales-bot",
      starterDir: "C:/Bhushan/livekit-dashboard/agent-starter-python",
    });

    expect(guide.wsUrl).toBe("ws://127.0.0.1:7880");
    expect(guide.agentName).toBe("sales-bot");
    expect(guide.envFile).toContain("LIVEKIT_URL=ws://127.0.0.1:7880");
    expect(guide.envFile).toContain("AGENT_NAME=sales-bot");
    expect(guide.startWorker).toContain("uv run src/agent.py start");
    expect(guide.startWorker).toContain("agent-starter-python");
    expect(guide.dispatch).toBe("lk dispatch create --room my-room --agent-name sales-bot");
    expect(guide.installCli).toContain("LiveKitCLI");
  });

  it("defaults agent name and hides missing secret", () => {
    const guide = buildAgentDeployGuide({
      livekitUrl: "ws://127.0.0.1:7880",
      apiKey: "devkey",
      apiSecret: null,
    });
    expect(guide.agentName).toBe(DEFAULT_AGENT_NAME);
    expect(guide.envFile).toContain("<LIVEKIT_API_SECRET>");
  });
});
