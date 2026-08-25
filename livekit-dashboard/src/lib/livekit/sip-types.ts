export type MediaEncryption = "disable" | "allow" | "require";

export type InboundTrunkSnapshot = {
  id: string;
  name: string;
  numbers: string[];
  allowedAddresses: string[];
  allowedNumbers: string[];
  authUsername: string;
  hasAuth: boolean;
  mediaEncryption: MediaEncryption;
  krispEnabled: boolean;
  metadata: string;
};

export type OutboundTrunkSnapshot = {
  id: string;
  name: string;
  address: string;
  numbers: string[];
  transport: string;
  authUsername: string;
  hasAuth: boolean;
  mediaEncryption: MediaEncryption;
  metadata: string;
};

export type DispatchRuleSnapshot = {
  id: string;
  name: string;
  type: "direct" | "individual" | "callee" | "unknown";
  roomName: string | null;
  roomPrefix: string | null;
  pin: string | null;
  trunkIds: string[];
  metadata: string;
};

export type AgentDispatchSnapshot = {
  id: string;
  agentName: string;
  room: string;
  metadata: string;
  createdAt: string | null;
};
