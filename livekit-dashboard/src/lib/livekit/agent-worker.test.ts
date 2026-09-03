import { describe, expect, it } from "vitest";
import {
  buildAgentComposeOverride,
  encodeEnvFile,
  mergeAgentRuntimeEnv,
  parseAgentHealth,
  parseEnvFile,
  rewriteCredentialPaths,
} from "@/lib/livekit/agent-worker";
import { isLocalLiveKitUrl, LOCAL_LIVEKIT } from "@/lib/livekit/local-defaults";

describe("isLocalLiveKitUrl", () => {
  it("accepts local Docker LiveKit URLs", () => {
    expect(isLocalLiveKitUrl("http://127.0.0.1:7880")).toBe(true);
    expect(isLocalLiveKitUrl("http://localhost:7880/")).toBe(true);
    expect(isLocalLiveKitUrl("ws://127.0.0.1:7880")).toBe(true);
    expect(isLocalLiveKitUrl(LOCAL_LIVEKIT.url)).toBe(true);
  });

  it("rejects remote or other ports", () => {
    expect(isLocalLiveKitUrl("http://127.0.0.1:7881")).toBe(false);
    expect(isLocalLiveKitUrl("https://cloud.livekit.io")).toBe(false);
  });
});

describe("agent runtime env file", () => {
  it("round-trips quoted values", () => {
    const encoded = encodeEnvFile({
      AGENT_NAME: "my-agent",
      LIVEKIT_API_SECRET: "a b",
    });
    expect(parseEnvFile(encoded)).toEqual({
      AGENT_NAME: "my-agent",
      LIVEKIT_API_SECRET: "a b",
    });
  });

  it("keeps later duplicate keys from .env.local", () => {
    expect(
      parseEnvFile("GOOGLE_API_KEY=\nGOOGLE_API_KEY=real-key\nOPENAI_API_KEY=sk-test\n"),
    ).toEqual({
      GOOGLE_API_KEY: "real-key",
      OPENAI_API_KEY: "sk-test",
    });
  });
});

describe("mergeAgentRuntimeEnv", () => {
  it("copies starter keys and overlays LiveKit connection", () => {
    const merged = mergeAgentRuntimeEnv({
      starterEnv: {
        AGENT_NAME: "pipeline-bot",
        OPENAI_API_KEY: "sk-test",
        DEEPGRAM_API_KEY: "dg-test",
        LIVEKIT_URL: "ws://127.0.0.1:7880",
      },
      livekitApiKey: "deckkey",
      livekitApiSecret: "decksecret",
      agentName: "pipeline-bot",
    });
    expect(merged.OPENAI_API_KEY).toBe("sk-test");
    expect(merged.DEEPGRAM_API_KEY).toBe("dg-test");
    expect(merged.LIVEKIT_URL).toBe("ws://livekit:7880");
    expect(merged.LIVEKIT_API_KEY).toBe("deckkey");
    expect(merged.AGENT_NAME).toBe("pipeline-bot");
  });

  it("overlays entrypoint, webhooks, skip credit, and transcript ingest", () => {
    const merged = mergeAgentRuntimeEnv({
      starterEnv: { AGENT_NAME: "old", LIVEKIT_URL: "ws://ignored" },
      livekitApiKey: "deckkey",
      livekitApiSecret: "decksecret",
      agentName: "CTF-Agent",
      entrypoint: "src/agant.py",
      backendBaseUrl: "https://uat-api.solvox.ai",
      backendWebhookUrl: "https://uat-api.solvox.ai/api/webhook/call-event",
      skipCreditCheck: true,
      deckTranscriptUrl: "http://host.docker.internal:3000/api/projects/p1/sessions/transcripts",
      deckTranscriptSecret: "secret",
    });
    expect(merged.AGENT_NAME).toBe("CTF-Agent");
    expect(merged.AGENT_ENTRYPOINT).toBe("src/agant.py");
    expect(merged.BACKEND_BASE_URL).toBe("https://uat-api.solvox.ai");
    expect(merged.SKIP_CREDIT_CHECK).toBe("1");
    expect(merged.DECK_TRANSCRIPT_URL).toContain("/sessions/transcripts");
  });
});

describe("rewriteCredentialPaths", () => {
  it("rewrites relative credential files to container mounts", () => {
    const { env, mounts } = rewriteCredentialPaths(
      { GOOGLE_APPLICATION_CREDENTIALS: "solvoxai.json", OPENAI_API_KEY: "sk" },
      "C:/agents/starter",
      () => true,
    );
    expect(env.OPENAI_API_KEY).toBe("sk");
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toMatch(/^\/secrets\/0-/);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.container).toBe(env.GOOGLE_APPLICATION_CREDENTIALS);
  });

  it("leaves missing credential files unchanged", () => {
    const { env, mounts } = rewriteCredentialPaths(
      { GCS_SERVICE_ACCOUNT_JSON: "missing.json" },
      "C:/agents/starter",
      () => false,
    );
    expect(env.GCS_SERVICE_ACCOUNT_JSON).toBe("missing.json");
    expect(mounts).toHaveLength(0);
  });

  it("does not treat inline JSON blobs as file paths", () => {
    const blob = '{"type":"service_account","token_uri":"https://oauth2.googleapis.com/token"}';
    const { env, mounts } = rewriteCredentialPaths(
      { GOOGLE_APPLICATION_CREDENTIALS: blob },
      "C:/agents/starter",
      () => true,
    );
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe(blob);
    expect(mounts).toHaveLength(0);
  });
});

describe("buildAgentComposeOverride", () => {
  it("sets command when the starter uses another entrypoint", () => {
    const yaml = buildAgentComposeOverride({
      entrypoint: "src/agant2.py",
      mounts: [],
    });
    expect(yaml).toContain("src/agant2.py");
    expect(yaml).toContain("command:");
  });
});

describe("parseAgentHealth", () => {
  it("marks a registered worker when logs include AW_ id", () => {
    const parsed = parseAgentHealth({
      status: "running",
      logs: '{"level": "INFO", "agent_name": "CTF-Agent", "id": "AW_dqrErQiMPDbu"} registered worker',
    });
    expect(parsed.health).toBe("registered");
    expect(parsed.workerId).toBe("AW_dqrErQiMPDbu");
  });

  it("ignores compose prefixes and LiveKit session-event noise", () => {
    const parsed = parseAgentHealth({
      status: "running",
      logs: [
        'livekit-dashboard-agent-1  | {"message": "registered worker", "agent_name": "CTF-Agent", "id": "AW_abc123"}',
        'agent-1 | {"message": "failed to send session event\\nTraceback (most recent call last)"}',
      ].join("\n"),
    });
    expect(parsed.health).toBe("registered");
    expect(parsed.workerId).toBe("AW_abc123");
    expect(parsed.lastError).toBeNull();
  });

  it("does not mark session-event noise as unhealthy", () => {
    const parsed = parseAgentHealth({
      status: "running",
      logs: 'agent-1 | {"message": "failed to send session event\\nTraceback (most recent call last)"}',
    });
    expect(parsed.health).toBe("starting");
    expect(parsed.lastError).toBeNull();
  });

  it("detects crash loops and last errors", () => {
    const parsed = parseAgentHealth({
      status: "restarting",
      logs: "ModuleNotFoundError: No module named 'chromadb'",
    });
    expect(parsed.health).toBe("crash_loop");
    expect(parsed.lastError).toMatch(/chromadb/);
  });
});
