import { afterEach, describe, expect, it } from "vitest";
import {
  applyLocalLiveKitKeys,
  canRotateLocalLiveKitKeys,
  readKeysFromLiveKitYaml,
  withLiveKitServerKeys,
  withSipKeys,
} from "@/lib/livekit/apply-local-keys";
import {
  clientLivekitWsUrl,
  isLoopbackLivekitUrl,
  livekitCliProjectAdd,
  serverLivekitUrl,
  toWsLivekitUrl,
} from "@/lib/livekit/url";

const SAMPLE_YAML = `port: 7880
keys:
  # LiveKit 1.13+ requires API secrets >= 32 characters
  deck_old: "oldsecret_oldsecret_oldsecret_old32"
webhook:
  api_key: deck_old
  urls:
    - http://deck:3000/api/webhooks/livekit
`;

describe("clientLivekitWsUrl", () => {
  it("uses the public URL when set", () => {
    expect(
      clientLivekitWsUrl({
        livekitUrl: "http://127.0.0.1:7880",
        publicLivekitUrl: "https://calls.example.com",
      }),
    ).toBe("wss://calls.example.com");
  });

  it("falls back to the project URL", () => {
    expect(
      clientLivekitWsUrl({
        livekitUrl: "http://127.0.0.1:7880",
        publicLivekitUrl: "  ",
      }),
    ).toBe("ws://127.0.0.1:7880");
  });
});

describe("isLoopbackLivekitUrl", () => {
  it("detects local LiveKit hosts", () => {
    expect(isLoopbackLivekitUrl("ws://127.0.0.1:7880")).toBe(true);
    expect(isLoopbackLivekitUrl("wss://calls.example.com")).toBe(false);
  });
});

describe("serverLivekitUrl", () => {
  afterEach(() => {
    delete process.env.LIVEKIT_INTERNAL_URL;
  });

  it("keeps loopback when no internal URL is set", () => {
    delete process.env.LIVEKIT_INTERNAL_URL;
    expect(serverLivekitUrl("http://127.0.0.1:7880")).toBe("http://127.0.0.1:7880");
  });

  it("rewrites loopback to the Compose service", () => {
    process.env.LIVEKIT_INTERNAL_URL = "http://livekit:7880";
    expect(serverLivekitUrl("http://127.0.0.1:7880")).toBe("http://livekit:7880");
    expect(serverLivekitUrl("ws://localhost:7880")).toBe("http://livekit:7880");
  });

  it("does not rewrite a public LiveKit URL", () => {
    process.env.LIVEKIT_INTERNAL_URL = "http://livekit:7880";
    expect(serverLivekitUrl("https://livekit.example.com")).toBe("https://livekit.example.com");
  });
});

describe("livekitCliProjectAdd", () => {
  it("builds a copyable lk project add command", () => {
    expect(
      livekitCliProjectAdd({
        projectName: "LumiVoice Local",
        wsUrl: toWsLivekitUrl("http://127.0.0.1:7880"),
        apiKey: "deck_key",
      }),
    ).toBe(
      "lk project add lumivoice-local --url ws://127.0.0.1:7880 --api-key deck_key --api-secret <paste from API keys>",
    );
  });
});

describe("livekit YAML key rewrite", () => {
  it("replaces keys in LF files", () => {
    const next = withLiveKitServerKeys(SAMPLE_YAML, "deck_new", "newsecret_newsecret_newsecret_n32");
    expect(readKeysFromLiveKitYaml(next)).toEqual({
      apiKey: "deck_new",
      apiSecret: "newsecret_newsecret_newsecret_n32",
    });
    expect(next).toContain("api_key: deck_new");
  });

  it("replaces keys in Windows CRLF files", () => {
    const crlf = SAMPLE_YAML.replaceAll("\n", "\r\n");
    const parsed = readKeysFromLiveKitYaml(crlf);
    expect(parsed?.apiKey).toBe("deck_old");
    const next = withLiveKitServerKeys(crlf, "deck_new", "newsecret_newsecret_newsecret_n32");
    expect(next).not.toContain("\r");
    expect(readKeysFromLiveKitYaml(next)).toEqual({
      apiKey: "deck_new",
      apiSecret: "newsecret_newsecret_newsecret_n32",
    });
  });

  it("updates sip.yaml api_key and api_secret", () => {
    const sip = 'api_key: old\r\napi_secret: "oldsecret"\r\nws_url: ws://livekit:7880\r\n';
    const next = withSipKeys(sip, "deck_new", "secret32chars________________");
    expect(next).toContain("api_key: deck_new");
    expect(next).toContain('"secret32chars________________"');
  });
});

describe("canRotateLocalLiveKitKeys", () => {
  afterEach(() => {
    delete process.env.DECK_IN_COMPOSE;
    delete process.env.LIVEKIT_INTERNAL_URL;
  });

  it("is true on the host", () => {
    expect(canRotateLocalLiveKitKeys()).toBe(true);
  });

  it("is false inside the LumiVoice Compose service", () => {
    process.env.DECK_IN_COMPOSE = "1";
    expect(canRotateLocalLiveKitKeys()).toBe(false);
  });

  it("does not write new keys from the LumiVoice container", async () => {
    process.env.DECK_IN_COMPOSE = "1";
    await expect(applyLocalLiveKitKeys("generate")).rejects.toThrow(/LumiVoice container/);
  });
});
