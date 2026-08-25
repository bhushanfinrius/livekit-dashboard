export type KindBucket = "webrtc" | "sip" | "agent";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeKind(value: unknown): KindBucket {
  const raw =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim().toLowerCase()
        : "";

  if (raw === "3" || raw === "sip") return "sip";
  if (raw === "4" || raw === "agent") return "agent";
  return "webrtc";
}

export function kindLabel(kind: KindBucket) {
  if (kind === "sip") return "SIP participant minutes";
  if (kind === "agent") return "Agent session minutes";
  return "WebRTC participant minutes";
}

export function kindShort(kind: KindBucket) {
  if (kind === "sip") return "SIP";
  if (kind === "agent") return "Agent";
  return "WebRTC";
}

export function parseRoomMeta(rawPayload: unknown) {
  const root = asRecord(rawPayload);
  const room = asRecord(root?.room);
  const egress = asRecord(root?.egressInfo) ?? asRecord(root?.egress_info);
  const sid =
    (typeof room?.sid === "string" && room.sid.trim()) ||
    (typeof egress?.roomId === "string" && egress.roomId.trim()) ||
    (typeof egress?.room_id === "string" && egress.room_id.trim()) ||
    null;
  const name =
    (typeof room?.name === "string" && room.name.trim()) ||
    (typeof egress?.roomName === "string" && egress.roomName.trim()) ||
    (typeof egress?.room_name === "string" && egress.room_name.trim()) ||
    null;
  return { sid, name };
}

export function parseParticipantMeta(rawPayload: unknown) {
  const root = asRecord(rawPayload);
  const participant = asRecord(root?.participant);
  const regionRaw = participant?.region;
  const region =
    typeof regionRaw === "string" && regionRaw.trim() ? regionRaw.trim() : null;

  return {
    kind: normalizeKind(participant?.kind),
    region,
    identity:
      typeof participant?.identity === "string" && participant.identity.trim()
        ? participant.identity.trim()
        : null,
    sip: parseSipAttributes(participant),
  };
}

function attrString(attrs: Record<string, unknown>, key: string) {
  const value = attrs[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseSipAttributes(participant: Record<string, unknown> | null) {
  const attrs = asRecord(participant?.attributes) ?? {};
  const phone =
    attrString(attrs, "sip.phoneNumber") ?? attrString(attrs, "sip.phone_number");
  const trunkNumber =
    attrString(attrs, "sip.trunkPhoneNumber") ?? attrString(attrs, "sip.trunk_phone_number");
  const hostname = attrString(attrs, "sip.hostname") ?? attrString(attrs, "sip.host");
  const callId = attrString(attrs, "sip.callID") ?? attrString(attrs, "sip.callId");
  const trunkId = attrString(attrs, "sip.trunkID") ?? attrString(attrs, "sip.trunkId");
  const direction: "inbound" | "outbound" | null = hostname
    ? "outbound"
    : trunkNumber || trunkId
      ? "inbound"
      : null;

  return {
    phone,
    trunkNumber,
    hostname,
    callId,
    trunkId,
    direction,
  };
}
