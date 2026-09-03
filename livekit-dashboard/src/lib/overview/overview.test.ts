import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseGcsLocation, signedGcsGetUrl } from "@/lib/gcs";
import { kindLabel } from "@/lib/overview/payload";
import { buildOverviewSeries, minutesForKind, minutesFromSessions } from "@/lib/overview/series";
import { parseSessionTranscripts, playableMediaUrl, recordingsFromWebhooks } from "@/lib/sessions/insights";

describe("playableMediaUrl", () => {
  it("accepts http(s) and rejects gs://", () => {
    expect(playableMediaUrl("https://cdn.example/a.ogg")).toBe("https://cdn.example/a.ogg");
    expect(playableMediaUrl("gs://bucket/deck/room/file.ogg")).toBeNull();
    expect(playableMediaUrl(null)).toBeNull();
  });
});

describe("parseGcsLocation + signed URL", () => {
  it("parses gs and storage.googleapis.com paths", () => {
    expect(parseGcsLocation("gs://my_livekit_ecordings/deck/room/a.ogg")).toEqual({
      bucket: "my_livekit_ecordings",
      object: "deck/room/a.ogg",
    });
    expect(parseGcsLocation("https://storage.googleapis.com/my_livekit_ecordings/deck/room/a.ogg")).toEqual({
      bucket: "my_livekit_ecordings",
      object: "deck/room/a.ogg",
    });
    expect(
      parseGcsLocation(
        "https://my_livekit_ecordings.storage.googleapis.com/recordings/mahindra_scraping/room/a.ogg",
      ),
    ).toEqual({
      bucket: "my_livekit_ecordings",
      object: "recordings/mahindra_scraping/room/a.ogg",
    });
  });

  it("signs a GET URL with a throwaway RSA key", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const url = signedGcsGetUrl(
      { bucket: "demo-bucket", object: "deck/room/file.ogg" },
      { client_email: "deck@example.iam.gserviceaccount.com", private_key: pem, rawJson: "{}" },
      3600,
      new Date("2026-08-21T08:30:00Z"),
    );
    expect(url).toContain("https://storage.googleapis.com/demo-bucket/deck/room/file.ogg");
    expect(url).toContain("X-Goog-Algorithm=GOOG4-RSA-SHA256");
    expect(url).toContain("X-Goog-Signature=");
  });
});

describe("minutesForKind", () => {
  it("uses the WebRTC slice and not the total", () => {
    const slices = [
      { name: kindLabel("webrtc"), minutes: 0 },
      { name: kindLabel("sip"), minutes: 1 },
      { name: kindLabel("agent"), minutes: 2 },
    ];
    expect(minutesForKind(slices, "WebRTC")).toBe(0);
    expect(minutesForKind(slices, "SIP")).toBe(1);
    const total = slices.reduce((sum, slice) => sum + slice.minutes, 0);
    expect(total).toBe(3);
  });
});

describe("buildOverviewSeries", () => {
  it("pairs join/leave into kind minutes", () => {
    const start = Date.parse("2026-08-21T10:00:00Z");
    const series = buildOverviewSeries(
      [
        {
          eventType: "participant_joined",
          roomName: "room-1",
          participantIdentity: "agent",
          kind: "agent",
          region: null,
          sipDirection: null,
          at: start,
        },
        {
          eventType: "participant_left",
          roomName: "room-1",
          participantIdentity: "agent",
          kind: "agent",
          region: null,
          sipDirection: null,
          at: start + 120_000,
        },
      ],
      "24h",
      start + 3_600_000,
    );
    expect(minutesForKind(series.minutesByKind, "Agent")).toBe(2);
    expect(minutesForKind(series.minutesByKind, "WebRTC")).toBe(0);
  });
});

describe("minutesFromSessions", () => {
  it("counts unique identities and SIP/agent minutes from reconstructed sessions", () => {
    const start = Date.parse("2026-09-03T06:00:00.000Z");
    const sessions = [
      {
        endedAt: "2026-09-03T06:02:00.000Z",
        participants: [
          {
            kind: "agent" as const,
            joinedAt: "2026-09-03T06:00:00.000Z",
            leftAt: "2026-09-03T06:02:00.000Z",
            identity: "agent-AJ_abc",
          },
          {
            kind: "sip" as const,
            joinedAt: "2026-09-03T06:00:05.000Z",
            leftAt: "2026-09-03T06:02:00.000Z",
            identity: "sip_918177938974",
          },
        ],
      },
    ];
    const unique = new Set(sessions.flatMap((session) => session.participants.map((p) => p.identity)));
    expect(unique.size).toBeGreaterThan(0);
    const minutes = minutesFromSessions(sessions, start, start + 10 * 60_000);
    expect(minutes.byKind.agent).toBe(2);
    expect(minutes.byKind.sip).toBeGreaterThan(0);
    expect(minutes.total).toBeGreaterThan(0);
  });
});

describe("parseSessionTranscripts", () => {
  it("reads Deck ingest payloads", () => {
    const lines = parseSessionTranscripts(
      [
        {
          event: "transcription",
          room: { name: "CAMP_1" },
          participant: { identity: "riya-smart-sales-v43" },
          transcription: {
            text: "Namaste, main Riya bol rahi hoon.",
            role: "agent",
            startTime: 0,
            final: true,
            startedAt: "2026-08-21T10:00:01.000Z",
          },
        },
      ],
      new Set(["riya-smart-sales-v43"]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.speaker).toBe("agent");
    expect(lines[0]?.text).toContain("Riya");
    expect(lines[0]?.at).toBe("2026-08-21T10:00:01.000Z");
  });

  it("reads ingest lines that only have role + offsetMs", () => {
    const lines = parseSessionTranscripts(
      [
        {
          event: "transcription",
          room: { name: "test-2e551bbd-20260903_181429_538849" },
          transcription: {
            text: "Yeah, tell me.",
            role: "user",
            offsetMs: 0,
            final: true,
          },
        },
      ],
      new Set(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.speaker).toBe("user");
    expect(lines[0]?.text).toBe("Yeah, tell me.");
  });

  it("collapses duplicate live + session-report lines", () => {
    const payload = {
      event: "transcription",
      room: { name: "CAMP_1" },
      participant: { identity: "riya-smart-sales-v43" },
      transcription: {
        text: "Namaste, main Riya bol rahi hoon.",
        role: "agent",
        startTime: 0,
        final: true,
        startedAt: "2026-08-21T10:00:01.000Z",
      },
    };
    const lines = parseSessionTranscripts([payload, { ...payload }], new Set(["riya-smart-sales-v43"]));
    expect(lines).toHaveLength(1);
  });
});

describe("recordingsFromWebhooks", () => {
  it("reads GCS file location from egress_ended payloads", () => {
    const recordings = recordingsFromWebhooks([
      {
        event: "egress_ended",
        egressInfo: {
          egressId: "EG_test",
          roomName: "deck-console-1uzkzy",
          status: "EGRESS_COMPLETE",
          fileResults: [
            {
              location:
                "https://my_livekit_ecordings.storage.googleapis.com/recordings/mahindra_scraping/deck-console-1uzkzy/a.ogg",
              filename: "recordings/mahindra_scraping/deck-console-1uzkzy/a.ogg",
            },
          ],
        },
      },
    ]);
    expect(recordings).toHaveLength(1);
    expect(recordings[0]?.id).toBe("EG_test");
    expect(recordings[0]?.status).toBe("complete");
    expect(recordings[0]?.output).toContain("deck-console-1uzkzy");
    expect(recordings[0]?.playableUrl).toContain("storage.googleapis.com");
  });
});
