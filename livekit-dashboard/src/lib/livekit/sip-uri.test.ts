import { afterEach, describe, expect, it } from "vitest";
import { sipUriForProject } from "@/lib/livekit/sip-uri";

const LOCAL = { livekitUrl: "http://127.0.0.1:7880", publicLivekitUrl: null };

afterEach(() => {
  delete process.env.SIP_PUBLIC_HOST;
  delete process.env.SIP_PUBLIC_PORT;
  delete process.env.LIVEKIT_PUBLIC_IP;
});

describe("sipUriForProject", () => {
  it("prefers SIP_PUBLIC_HOST", () => {
    process.env.SIP_PUBLIC_HOST = "sip.example.com";
    process.env.LIVEKIT_PUBLIC_IP = "10.0.0.1";
    expect(sipUriForProject(LOCAL)).toBe("sip:sip.example.com");
  });

  it("falls back to the VPS public IP", () => {
    process.env.LIVEKIT_PUBLIC_IP = "10.0.0.1";
    expect(sipUriForProject(LOCAL)).toBe("sip:10.0.0.1");
  });

  it("falls back to the public LiveKit hostname before the internal one", () => {
    expect(
      sipUriForProject({
        livekitUrl: "http://127.0.0.1:7880",
        publicLivekitUrl: "wss://calls.example.com",
      }),
    ).toBe("sip:calls.example.com");
  });

  it("uses the LiveKit hostname as a last resort", () => {
    expect(sipUriForProject(LOCAL)).toBe("sip:127.0.0.1");
  });

  it("only shows a port when it is not the SIP default", () => {
    process.env.SIP_PUBLIC_HOST = "sip.example.com";
    process.env.SIP_PUBLIC_PORT = "5080";
    expect(sipUriForProject(LOCAL)).toBe("sip:sip.example.com:5080");
  });
});
