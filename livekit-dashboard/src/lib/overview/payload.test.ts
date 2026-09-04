import { describe, expect, it } from "vitest";
import {
  classifyParticipant,
  kindFromIdentity,
  normalizeKind,
  parseParticipantMeta,
} from "@/lib/overview/payload";

describe("classifyParticipant", () => {
  it("treats LiveKit EGRESS/INGRESS kinds as infrastructure", () => {
    expect(classifyParticipant({ kindRaw: 2, identity: "EG_abc" }).infra).toBe(true);
    expect(classifyParticipant({ kindRaw: "EGRESS", identity: "recorder" }).infra).toBe(true);
    expect(classifyParticipant({ kindRaw: "ingress", identity: "ING_1" }).infra).toBe(true);
    expect(normalizeKind("EGRESS")).toBe("webrtc");
  });

  it("classifies SIP from identity even when webhook kind is STANDARD", () => {
    expect(classifyParticipant({ kindRaw: 0, identity: "sip_918177938974" })).toEqual({
      kind: "sip",
      infra: false,
    });
    expect(kindFromIdentity("sip_+91-8177938974")).toBe("sip");
  });

  it("classifies the CTF agent identity as agent", () => {
    expect(classifyParticipant({ kindRaw: 0, identity: "agent-AJ_78W37M73aQvw" }).kind).toBe("agent");
    expect(classifyParticipant({ kindRaw: "AGENT", identity: "CTF-Agent" }).kind).toBe("agent");
  });
});

describe("parseParticipantMeta", () => {
  it("does not count an egress recorder as a person", () => {
    const meta = parseParticipantMeta({
      participant: { identity: "EG_roomComposite", kind: "EGRESS" },
    });
    expect(meta.infra).toBe(true);
    expect(meta.identity).toBe("EG_roomComposite");
  });

  it("reads SIP attributes on a STANDARD participant", () => {
    const meta = parseParticipantMeta({
      participant: {
        identity: "sip_918177938974",
        kind: "STANDARD",
        attributes: { "sip.phoneNumber": "+918177938974", "sip.hostname": "sip.example" },
      },
    });
    expect(meta.kind).toBe("sip");
    expect(meta.infra).toBe(false);
    expect(meta.sip.direction).toBe("outbound");
  });
});
