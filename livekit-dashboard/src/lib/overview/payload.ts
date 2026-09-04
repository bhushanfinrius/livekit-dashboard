export type KindBucket = "webrtc" | "sip" | "agent";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function kindToken(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim().toLowerCase().replace(/^participant_kind_/, "");
  return "";
}

/** Recorders / bridges join the room but are not people on the call. */
export function isInfraKind(value: unknown): boolean {
  const raw = kindToken(value);
  return (
    raw === "1" ||
    raw === "2" ||
    raw === "7" ||
    raw === "8" ||
    raw === "ingress" ||
    raw === "egress" ||
    raw === "connector" ||
    raw === "bridge"
  );
}

export function looksLikePhoneIdentity(identity: string): boolean {
  const digits = identity.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export function kindFromIdentity(identity: string | null | undefined): KindBucket | "infra" | null {
  if (!identity?.trim()) return null;
  const id = identity.trim();
  const lower = id.toLowerCase();
  if (
    /^eg_/i.test(id) ||
    /^ing_/i.test(id) ||
    lower.startsWith("egress") ||
    lower.startsWith("ingress")
  ) {
    return "infra";
  }
  if (lower.startsWith("sip") || lower.startsWith("caller") || looksLikePhoneIdentity(id)) {
    return "sip";
  }
  if (lower.startsWith("agent") || lower.includes("agent-") || /^ctf-agent\b/i.test(id)) {
    return "agent";
  }
  return null;
}

export function canonicalParticipantKey(identity: string): string {
  const classified = kindFromIdentity(identity);
  if (classified === "sip") {
    const digits = identity.replace(/\D/g, "");
    if (digits.length >= 10) return `sip:${digits.slice(-10)}`;
  }
  return identity.trim().toLowerCase();
}

export function classifyParticipant(input: {
  kindRaw?: unknown;
  identity?: string | null;
  sip?: { phone?: string | null; callId?: string | null; trunkId?: string | null };
}): { kind: KindBucket; infra: boolean } {
  const identity = input.identity?.trim() || null;
  if (isInfraKind(input.kindRaw) || kindFromIdentity(identity) === "infra") {
    return { kind: "webrtc", infra: true };
  }

  const fromId = kindFromIdentity(identity);
  const fromKind = kindToken(input.kindRaw);
  if (fromKind === "3" || fromKind === "sip" || fromId === "sip" || input.sip?.phone || input.sip?.callId) {
    return { kind: "sip", infra: false };
  }
  if (fromKind === "4" || fromKind === "agent" || fromId === "agent") {
    return { kind: "agent", infra: false };
  }
  return { kind: "webrtc", infra: false };
}

export function normalizeKind(value: unknown): KindBucket {
  return classifyParticipant({ kindRaw: value }).kind;
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
  const identity =
    typeof participant?.identity === "string" && participant.identity.trim()
      ? participant.identity.trim()
      : null;
  const sip = parseSipAttributes(participant);
  const classified = classifyParticipant({
    kindRaw: participant?.kind,
    identity,
    sip,
  });

  return {
    kind: classified.kind,
    infra: classified.infra,
    region,
    identity,
    sip,
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
