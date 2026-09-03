import { describe, expect, it } from "vitest";
import { mergeRecordings, recordingsFromWebhooks } from "@/lib/sessions/insights";
import {
  identitiesFromRecordingOutputs,
  publisherIdentityFromOutput,
  recordingRoleFromOutput,
  recordingRoleLabel,
} from "@/lib/sessions/recording-role";
import type { SessionRecording } from "@/lib/sessions/types";

const PREFIX = "gs://bucket/recordings/mahindra_scraping/room1";

describe("recordingRoleFromOutput", () => {
  it("treats the -mixed suffix as the mixed file", () => {
    expect(recordingRoleFromOutput(`${PREFIX}/room1-mixed.ogg`)).toBe("mixed");
  });

  it("treats a room composite job as mixed regardless of path", () => {
    expect(recordingRoleFromOutput(`${PREFIX}/whatever.ogg`, "roomComposite")).toBe("mixed");
  });

  it("maps phone-number identities to the prospect", () => {
    expect(recordingRoleFromOutput(`${PREFIX}/test_918177938974-1750000000.ogg`)).toBe("prospect");
    expect(recordingRoleFromOutput(`${PREFIX}/sip_918177938974-1750000000.ogg`)).toBe("prospect");
  });

  it("maps the Talk console browser participant to the prospect", () => {
    expect(recordingRoleFromOutput(`${PREFIX}/deck-console-abc-1750000000.ogg`)).toBe("prospect");
  });

  it("maps our own published track to the agent", () => {
    expect(recordingRoleFromOutput(`${PREFIX}/agent-AJ_abc123-1750000000.ogg`)).toBe("agent");
  });

  it("extracts publisher identities for session reconstruction", () => {
    expect(publisherIdentityFromOutput(`${PREFIX}/sip_918177938974-1750000000.ogg`)).toBe(
      "sip_918177938974",
    );
    expect(
      identitiesFromRecordingOutputs([
        `${PREFIX}/sip_918177938974-1750000000.ogg`,
        `${PREFIX}/agent-AJ_abc123-1750000000.ogg`,
        `${PREFIX}/room1-mixed.ogg`,
      ]),
    ).toEqual([
      { identity: "sip_918177938974", kind: "sip" },
      { identity: "agent-AJ_abc123", kind: "agent" },
    ]);
  });

  it("strips the ISO timestamp and track sid LiveKit appends", () => {
    expect(
      recordingRoleFromOutput(`${PREFIX}/agent-verify-2026-09-02T120631-TR_ADqxsRMGeQsyx.ogg`),
    ).toBe("agent");
    expect(
      recordingRoleFromOutput(`${PREFIX}/sip_918177938974-2026-09-02T120630-TR_AFvEAZ5dqrsuS.ogg`),
    ).toBe("prospect");
  });

  it("keeps a bare phone-number identity intact", () => {
    expect(recordingRoleFromOutput(`${PREFIX}/918177938974-1750000000.ogg`)).toBe("prospect");
  });

  it("ignores signed-URL query strings", () => {
    const signed = "https://storage.googleapis.com/bucket/room1-mixed.ogg?X-Goog-Signature=abc";
    expect(recordingRoleFromOutput(signed)).toBe("mixed");
  });

  it("labels roles for the player dropdown", () => {
    expect(recordingRoleLabel("mixed")).toBe("Mixed");
    expect(recordingRoleLabel("prospect")).toBe("Prospect");
    expect(recordingRoleLabel("agent")).toBe("Agent");
  });
});

describe("recordingsFromWebhooks", () => {
  it("derives role and label from the egress_ended payload", () => {
    const [recording] = recordingsFromWebhooks([
      {
        event: "egress_ended",
        egressInfo: {
          egressId: "EG_1",
          status: "EGRESS_COMPLETE",
          fileResults: [{ location: `${PREFIX}/room1-mixed.ogg` }],
        },
      },
    ]);
    expect(recording.role).toBe("mixed");
    expect(recording.label).toBe("Mixed");
  });
});

describe("mergeRecordings", () => {
  it("orders mixed first so the player opens on both voices", () => {
    const make = (id: string, role: SessionRecording["role"]): SessionRecording => ({
      id,
      type: "egress",
      status: "complete",
      startedAt: "2026-09-02T10:00:00.000Z",
      endedAt: "2026-09-02T10:05:00.000Z",
      output: null,
      playableUrl: null,
      error: null,
      durationSeconds: 300,
      role,
      label: recordingRoleLabel(role),
    });

    const merged = mergeRecordings([make("a", "agent"), make("b", "prospect"), make("c", "mixed")]);
    expect(merged.map((recording) => recording.role)).toEqual(["mixed", "prospect", "agent"]);
  });
});
