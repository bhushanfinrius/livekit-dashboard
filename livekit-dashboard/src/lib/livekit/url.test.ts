import { describe, expect, it } from "vitest";
import {
  clientLivekitWsUrl,
  isLoopbackLivekitUrl,
  livekitCliProjectAdd,
  toWsLivekitUrl,
} from "@/lib/livekit/url";

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

describe("livekitCliProjectAdd", () => {
  it("builds a copyable lk project add command", () => {
    expect(
      livekitCliProjectAdd({
        projectName: "Deck Local",
        wsUrl: toWsLivekitUrl("http://127.0.0.1:7880"),
        apiKey: "deck_key",
      }),
    ).toBe(
      "lk project add deck-local --url ws://127.0.0.1:7880 --api-key deck_key --api-secret <paste from API keys>",
    );
  });
});
