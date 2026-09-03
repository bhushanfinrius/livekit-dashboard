import { describe, expect, it } from "vitest";
import { mergeEgressIntoSessions, reconstructSessions } from "@/lib/sessions/reconstruct";
import { sessionDisplayId, type SessionSnapshot } from "@/lib/sessions/types";

function session(partial: Partial<SessionSnapshot> & Pick<SessionSnapshot, "id" | "roomName">): SessionSnapshot {
  return {
    roomSid: null,
    startedAt: "2026-08-25T10:00:00.000Z",
    endedAt: "2026-08-25T10:05:00.000Z",
    durationSeconds: 300,
    status: "ended",
    peakParticipants: 1,
    participantCount: 1,
    implicit: false,
    features: [],
    participants: [],
    ...partial,
  };
}

describe("mergeEgressIntoSessions", () => {
  it("adds the egress feature to matching rooms", () => {
    const merged = mergeEgressIntoSessions(
      [session({ id: "room-1", roomName: "support" })],
      [
        {
          id: "EG_1",
          roomName: "support",
          startedAt: "2026-08-25T10:00:30.000Z",
          endedAt: "2026-08-25T10:05:00.000Z",
          active: false,
        },
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].features).toContain("egress");
  });

  it("creates a session from egress when webhooks are missing", () => {
    const merged = mergeEgressIntoSessions(
      [],
      [
        {
          id: "EG_2",
          roomName: "deck-console-abc",
          startedAt: "2026-08-25T12:00:00.000Z",
          endedAt: "2026-08-25T12:02:00.000Z",
          active: false,
        },
      ],
      Date.parse("2026-08-25T12:03:00.000Z"),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].roomName).toBe("deck-console-abc");
    expect(merged[0].features).toEqual(["egress"]);
    expect(merged[0].implicit).toBe(false);
    expect(merged[0].status).toBe("ended");
  });

  it("fills identities from track egress files and marks campaign rooms closed", () => {
    const merged = mergeEgressIntoSessions(
      [],
      [
        {
          id: "EG_3",
          roomName: "test-2e551bbd-20260903",
          startedAt: "2026-09-03T06:00:00.000Z",
          endedAt: "2026-09-03T06:00:32.000Z",
          active: false,
          identities: [
            { identity: "agent-AJ_abc", kind: "agent" },
            { identity: "sip_918177938974", kind: "sip" },
          ],
        },
      ],
      Date.parse("2026-09-03T06:01:00.000Z"),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].participantCount).toBe(2);
    expect(merged[0].features).toEqual(expect.arrayContaining(["egress", "agent", "sip"]));
    expect(merged[0].implicit).toBe(false);
    expect(merged[0].status).toBe("ended");
  });

  it("falls back to agent + sip on campaign rooms when files have no identity", () => {
    const merged = mergeEgressIntoSessions(
      [],
      [
        {
          id: "EG_4",
          roomName: "test-abcd1234-20260903",
          startedAt: "2026-09-03T06:00:00.000Z",
          endedAt: "2026-09-03T06:00:20.000Z",
          active: false,
        },
      ],
      Date.parse("2026-09-03T06:01:00.000Z"),
    );
    expect(merged[0].participantCount).toBe(2);
    expect(merged[0].features).toEqual(expect.arrayContaining(["agent", "sip", "egress"]));
  });
});

describe("sessionDisplayId", () => {
  it("prefers RM_ roomSid over egress ids", () => {
    expect(
      sessionDisplayId(
        session({
          id: "egress:test-2e551bbd:1",
          roomName: "test-2e551bbd-20260903",
          roomSid: "RM_abc123",
        }),
      ),
    ).toBe("RM_abc123");
  });

  it("falls back to room name for egress-only sessions", () => {
    expect(
      sessionDisplayId(
        session({
          id: "egress:test-2e551bbd:1",
          roomName: "test-2e551bbd-20260903",
        }),
      ),
    ).toBe("test-2e551bbd-20260903");
  });
});

describe("reconstructSessions", () => {
  it("marks room_finished sessions closed, not inferred", () => {
    const sessions = reconstructSessions(
      [
        {
          id: "join-1",
          eventType: "participant_joined",
          roomName: "camp-1",
          roomSid: "RM_camp1",
          participantIdentity: "sip_1",
          kind: "sip",
          at: Date.parse("2026-09-03T06:00:00.000Z"),
        },
        {
          id: "fin-1",
          eventType: "room_finished",
          roomName: "camp-1",
          roomSid: "RM_camp1",
          participantIdentity: null,
          kind: "webrtc",
          at: Date.parse("2026-09-03T06:01:00.000Z"),
        },
      ],
      Date.parse("2026-09-03T06:02:00.000Z"),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].roomSid).toBe("RM_camp1");
    expect(sessions[0].implicit).toBe(false);
    expect(sessions[0].status).toBe("ended");
    expect(sessionDisplayId(sessions[0])).toBe("RM_camp1");
  });
});
