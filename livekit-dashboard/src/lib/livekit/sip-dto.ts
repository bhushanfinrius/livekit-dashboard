import type {
  AgentDispatch,
  SIPDispatchRuleInfo,
  SIPInboundTrunkInfo,
  SIPOutboundTrunkInfo,
} from "livekit-server-sdk";
import type {
  AgentDispatchSnapshot,
  DispatchRuleSnapshot,
  InboundTrunkSnapshot,
  MediaEncryption,
  OutboundTrunkSnapshot,
} from "@/lib/livekit/sip-types";

const TRANSPORT: Record<number, string> = {
  0: "auto",
  1: "udp",
  2: "tcp",
  3: "tls",
};

export function sipTransportCode(value: "auto" | "udp" | "tcp" | "tls") {
  return { auto: 0, udp: 1, tcp: 2, tls: 3 }[value];
}

export function sipMediaEncryptionCode(value: MediaEncryption) {
  return { disable: 0, allow: 1, require: 2 }[value];
}

function mediaEncryptionOf(value: number | undefined): MediaEncryption {
  if (value === 2) return "require";
  if (value === 1) return "allow";
  return "disable";
}

export function toInboundTrunkSnapshot(trunk: SIPInboundTrunkInfo): InboundTrunkSnapshot {
  return {
    id: trunk.sipTrunkId,
    name: trunk.name,
    numbers: [...(trunk.numbers ?? [])],
    allowedAddresses: [...(trunk.allowedAddresses ?? [])],
    allowedNumbers: [...(trunk.allowedNumbers ?? [])],
    authUsername: trunk.authUsername ?? "",
    hasAuth: Boolean(trunk.authPassword || trunk.authUsername),
    mediaEncryption: mediaEncryptionOf(trunk.media?.encryption ?? trunk.mediaEncryption),
    krispEnabled: Boolean(trunk.krispEnabled),
    metadata: trunk.metadata ?? "",
  };
}

export function toOutboundTrunkSnapshot(trunk: SIPOutboundTrunkInfo): OutboundTrunkSnapshot {
  return {
    id: trunk.sipTrunkId,
    name: trunk.name,
    address: trunk.address,
    numbers: [...(trunk.numbers ?? [])],
    transport: TRANSPORT[trunk.transport] ?? "auto",
    authUsername: trunk.authUsername ?? "",
    hasAuth: Boolean(trunk.authPassword || trunk.authUsername),
    mediaEncryption: mediaEncryptionOf(trunk.media?.encryption ?? trunk.mediaEncryption),
    metadata: trunk.metadata ?? "",
  };
}

export function toDispatchRuleSnapshot(rule: SIPDispatchRuleInfo): DispatchRuleSnapshot {
  const variant = rule.rule?.rule;
  let type: DispatchRuleSnapshot["type"] = "unknown";
  let roomName: string | null = null;
  let roomPrefix: string | null = null;
  let pin: string | null = null;

  if (variant?.case === "dispatchRuleDirect") {
    type = "direct";
    roomName = variant.value.roomName || null;
    pin = variant.value.pin || null;
  } else if (variant?.case === "dispatchRuleIndividual") {
    type = "individual";
    roomPrefix = variant.value.roomPrefix || null;
    pin = variant.value.pin || null;
  } else if (variant?.case === "dispatchRuleCallee") {
    type = "callee";
    roomPrefix = variant.value.roomPrefix || null;
    pin = variant.value.pin || null;
  }

  return {
    id: rule.sipDispatchRuleId,
    name: rule.name,
    type,
    roomName,
    roomPrefix,
    pin,
    trunkIds: [...(rule.trunkIds ?? [])],
    metadata: rule.metadata ?? "",
  };
}

export function toAgentDispatchSnapshot(dispatch: AgentDispatch): AgentDispatchSnapshot {
  const created = dispatch.state?.createdAt;
  const millis = created ? Number(created) * 1000 : 0;
  return {
    id: dispatch.id,
    agentName: dispatch.agentName,
    room: dispatch.room,
    metadata: dispatch.metadata ?? "",
    createdAt: millis > 0 ? new Date(millis).toISOString() : null,
  };
}
