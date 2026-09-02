import {
  AccessToken,
  AgentDispatchClient,
  EgressClient,
  IngressClient,
  IngressInput,
  RoomServiceClient,
  SipClient,
  WebhookReceiver,
  type AgentDispatch,
  type CreateOptions,
  type CreateSipDispatchRuleOptions,
  type CreateSipInboundTrunkOptions,
  type CreateSipOutboundTrunkOptions,
  type CreateSipParticipantOptions,
  type EncodedFileOutput,
  type EgressInfo,
  type IngressInfo,
  type ParticipantInfo,
  type Room,
  type SIPDispatchRuleInfo,
  type SIPInboundTrunkInfo,
  type SIPOutboundTrunkInfo,
  type SIPParticipantInfo,
  type SipDispatchRuleCallee,
  type SipDispatchRuleDirect,
  type SipDispatchRuleIndividual,
  type TrackInfo,
} from "livekit-server-sdk";
import { prisma } from "@/lib/db";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "@/lib/crypto/secret";
import { ProjectAccessError } from "@/lib/livekit/errors";
import { readLocalLiveKitKeys } from "@/lib/livekit/apply-local-keys";
import { isLocalLiveKitUrl } from "@/lib/livekit/local-defaults";
import { syncAgentWorkerKeys } from "@/lib/livekit/agent-worker";
import { clientLivekitWsUrl, serverLivekitUrl, toHttpLivekitUrl, toWsLivekitUrl } from "@/lib/livekit/url";

const VERIFY_ATTEMPTS = 4;
const VERIFY_RETRY_MS = 750;

export type LiveKitCredentials = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
};

export type ProjectLiveKit = {
  projectId: string;
  name: string;
  livekitUrl: string;
  publicLivekitUrl: string | null;
  clientWsUrl: string;
  browserWsUrl: string;
  livekitApiKey: string;
  rooms: {
    create: (options: CreateOptions) => Promise<Room>;
    list: () => Promise<Room[]>;
    listParticipants: (room: string) => Promise<ParticipantInfo[]>;
    removeParticipant: (room: string, identity: string) => Promise<void>;
    muteTrack: (
      room: string,
      identity: string,
      trackSid: string,
      muted?: boolean,
    ) => Promise<TrackInfo>;
    updateMetadata: (room: string, metadata: string) => Promise<Room>;
    end: (room: string) => Promise<void>;
  };
  egress: {
    list: (options?: { active?: boolean; roomName?: string }) => Promise<EgressInfo[]>;
    stop: (egressId: string) => Promise<EgressInfo>;
    startRoomComposite: (
      roomName: string,
      output: EncodedFileOutput,
      opts?: { audioOnly?: boolean },
    ) => Promise<EgressInfo>;
  };
  ingress: {
    list: (options?: { roomName?: string }) => Promise<IngressInfo[]>;
    create: (input: {
      inputType: "RTMP" | "WHIP";
      name?: string;
      roomName: string;
      participantIdentity: string;
    }) => Promise<IngressInfo>;
  };
  sip: {
    listInbound: () => Promise<SIPInboundTrunkInfo[]>;
    listOutbound: () => Promise<SIPOutboundTrunkInfo[]>;
    createInbound: (
      name: string,
      numbers: string[],
      opts?: CreateSipInboundTrunkOptions,
    ) => Promise<SIPInboundTrunkInfo>;
    createOutbound: (
      name: string,
      address: string,
      numbers: string[],
      opts?: CreateSipOutboundTrunkOptions,
    ) => Promise<SIPOutboundTrunkInfo>;
    deleteTrunk: (sipTrunkId: string) => Promise<void>;
    updateInbound: (
      sipTrunkId: string,
      fields: {
        name: string;
        numbers: string[];
        allowedAddresses?: string[];
        allowedNumbers?: string[];
        authUsername?: string;
        authPassword?: string;
        mediaEncryption?: number;
      },
    ) => Promise<SIPInboundTrunkInfo>;
    updateOutbound: (
      sipTrunkId: string,
      fields: {
        name: string;
        address: string;
        numbers: string[];
        transport: number;
        authUsername?: string;
        authPassword?: string;
        mediaEncryption?: number;
      },
    ) => Promise<SIPOutboundTrunkInfo>;
    listDispatch: () => Promise<SIPDispatchRuleInfo[]>;
    createDispatch: (
      rule: SipDispatchRuleDirect | SipDispatchRuleIndividual | SipDispatchRuleCallee,
      opts?: CreateSipDispatchRuleOptions,
    ) => Promise<SIPDispatchRuleInfo>;
    deleteDispatch: (sipDispatchRuleId: string) => Promise<void>;
    dial: (
      sipTrunkId: string,
      number: string,
      roomName: string,
      opts?: CreateSipParticipantOptions,
    ) => Promise<SIPParticipantInfo>;
  };
  agents: {
    listDispatch: (room: string) => Promise<AgentDispatch[]>;
    createDispatch: (
      room: string,
      agentName: string,
      metadata?: string,
    ) => Promise<AgentDispatch>;
    deleteDispatch: (dispatchId: string, room: string) => Promise<void>;
  };
  tokens: {
    mintParticipant: (input: {
      identity: string;
      name?: string;
      roomName: string;
    }) => Promise<string>;
  };
  webhook: {
    receive: (body: string, authHeader?: string) => ReturnType<WebhookReceiver["receive"]>;
  };
};

function createSdkClients(credentials: LiveKitCredentials) {
  const host = serverLivekitUrl(credentials.livekitUrl);
  const { livekitApiKey, livekitApiSecret } = credentials;
  return {
    host,
    rooms: new RoomServiceClient(host, livekitApiKey, livekitApiSecret),
    egress: new EgressClient(host, livekitApiKey, livekitApiSecret),
    ingress: new IngressClient(host, livekitApiKey, livekitApiSecret),
    sip: new SipClient(host, livekitApiKey, livekitApiSecret),
    agents: new AgentDispatchClient(host, livekitApiKey, livekitApiSecret),
    webhook: new WebhookReceiver(livekitApiKey, livekitApiSecret),
  };
}

function wrapClients(
  projectId: string,
  name: string,
  credentials: LiveKitCredentials,
  publicLivekitUrl: string | null,
): ProjectLiveKit {
  const sdk = createSdkClients(credentials);
  return {
    projectId,
    name,
    livekitUrl: toHttpLivekitUrl(credentials.livekitUrl),
    publicLivekitUrl,
    clientWsUrl: clientLivekitWsUrl({
      livekitUrl: credentials.livekitUrl,
      publicLivekitUrl,
    }),
    browserWsUrl: toWsLivekitUrl(credentials.livekitUrl),
    livekitApiKey: credentials.livekitApiKey,
    rooms: {
      create: (options) => sdk.rooms.createRoom(options),
      list: () => sdk.rooms.listRooms(),
      listParticipants: (room) => sdk.rooms.listParticipants(room),
      removeParticipant: (room, identity) =>
        sdk.rooms.removeParticipant(room, identity),
      muteTrack: (room, identity, trackSid, muted = true) =>
        sdk.rooms.mutePublishedTrack(room, identity, trackSid, muted),
      updateMetadata: (room, metadata) =>
        sdk.rooms.updateRoomMetadata(room, metadata),
      end: (room) => sdk.rooms.deleteRoom(room),
    },
    egress: {
      list: (options) => sdk.egress.listEgress(options),
      stop: (egressId) => sdk.egress.stopEgress(egressId),
      startRoomComposite: (roomName, output, opts) =>
        sdk.egress.startRoomCompositeEgress(roomName, output, {
          audioOnly: opts?.audioOnly ?? true,
        }),
    },
    ingress: {
      list: (options) => sdk.ingress.listIngress(options),
      create: (input) =>
        sdk.ingress.createIngress(
          input.inputType === "WHIP" ? IngressInput.WHIP_INPUT : IngressInput.RTMP_INPUT,
          {
            name: input.name,
            roomName: input.roomName,
            participantIdentity: input.participantIdentity,
          },
        ),
    },
    sip: {
      listInbound: () => sdk.sip.listSipInboundTrunk(),
      listOutbound: () => sdk.sip.listSipOutboundTrunk(),
      createInbound: (name, numbers, opts) =>
        sdk.sip.createSipInboundTrunk(name, numbers, opts),
      createOutbound: (name, address, numbers, opts) =>
        sdk.sip.createSipOutboundTrunk(name, address, numbers, opts),
      deleteTrunk: async (sipTrunkId) => {
        await sdk.sip.deleteSipTrunk(sipTrunkId);
      },
      updateInbound: (sipTrunkId, fields) =>
        sdk.sip.updateSipInboundTrunkFields(sipTrunkId, {
          name: fields.name,
          numbers: { set: fields.numbers } as never,
          allowedAddresses: fields.allowedAddresses
            ? ({ set: fields.allowedAddresses } as never)
            : undefined,
          allowedNumbers: fields.allowedNumbers
            ? ({ set: fields.allowedNumbers } as never)
            : undefined,
          authUsername: fields.authUsername,
          authPassword: fields.authPassword,
          mediaEncryption: fields.mediaEncryption,
        }),
      updateOutbound: async (sipTrunkId, fields) => {
        const current = (await sdk.sip.listSipOutboundTrunk()).find(
          (trunk) => trunk.sipTrunkId === sipTrunkId,
        );
        if (!current) {
          throw new Error("Outbound trunk not found");
        }
        current.name = fields.name;
        current.address = fields.address;
        current.numbers = fields.numbers;
        current.transport = fields.transport;
        if (fields.authUsername !== undefined) current.authUsername = fields.authUsername;
        if (fields.authPassword !== undefined) current.authPassword = fields.authPassword;
        if (fields.mediaEncryption !== undefined) current.mediaEncryption = fields.mediaEncryption;
        return sdk.sip.updateSipOutboundTrunk(sipTrunkId, current);
      },
      listDispatch: () => sdk.sip.listSipDispatchRule(),
      createDispatch: (rule, opts) => sdk.sip.createSipDispatchRule(rule, opts),
      deleteDispatch: async (sipDispatchRuleId) => {
        await sdk.sip.deleteSipDispatchRule(sipDispatchRuleId);
      },
      dial: (sipTrunkId, number, roomName, opts) =>
        sdk.sip.createSipParticipant(sipTrunkId, number, roomName, opts),
    },
    agents: {
      listDispatch: (room) => sdk.agents.listDispatch(room),
      createDispatch: (room, agentName, metadata) =>
        sdk.agents.createDispatch(room, agentName, metadata ? { metadata } : undefined),
      deleteDispatch: (dispatchId, room) => sdk.agents.deleteDispatch(dispatchId, room),
    },
    tokens: {
      mintParticipant: async ({ identity, name, roomName }) => {
        const token = new AccessToken(credentials.livekitApiKey, credentials.livekitApiSecret, {
          identity,
          name: name || identity,
          ttl: "1h",
        });
        token.addGrant({
          roomJoin: true,
          room: roomName,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        });
        return token.toJwt();
      },
    },
    webhook: {
      receive: (body, authHeader) =>
        sdk.webhook.receive(body, authHeader ? authHeader.replace(/^Bearer\s+/i, "").trim() : authHeader),
    },
  };
}

export async function verifyLiveKitCredentials(credentials: LiveKitCredentials) {
  const { rooms } = createSdkClients(credentials);
  let lastError: unknown;

  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    try {
      await rooms.listRooms();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < VERIFY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, VERIFY_RETRY_MS));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not reach LiveKit server");
}

async function loadDecryptedProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      livekitUrl: true,
      publicLivekitUrl: true,
      livekitApiKey: true,
      livekitApiSecret: true,
    },
  });

  if (!project) return null;

  const plaintext = decryptSecret(project.livekitApiSecret);
  if (!isEncryptedSecret(project.livekitApiSecret)) {
    await prisma.project.update({
      where: { id: project.id },
      data: { livekitApiSecret: encryptSecret(plaintext) },
    });
  }

  return {
    id: project.id,
    name: project.name,
    livekitUrl: project.livekitUrl,
    publicLivekitUrl: project.publicLivekitUrl,
    livekitApiKey: project.livekitApiKey,
    livekitApiSecret: plaintext,
  };
}

export async function getProjectLiveKit(
  userId: string,
  projectId: string,
): Promise<ProjectLiveKit> {
  const membership = await prisma.membership.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { id: true },
  });

  if (!membership) {
    throw new ProjectAccessError(404, "Project not found");
  }

  const livekit = await getProjectLiveKitForWebhook(projectId);
  if (!livekit) {
    throw new ProjectAccessError(404, "Project not found");
  }

  return livekit;
}

export async function getProjectLiveKitForWebhook(projectId: string) {
  let project = await loadDecryptedProject(projectId);
  if (!project) return null;

  if (isLocalLiveKitUrl(project.livekitUrl)) {
    const yamlKeys = readLocalLiveKitKeys();
    if (
      project.livekitApiKey !== yamlKeys.apiKey ||
      project.livekitApiSecret !== yamlKeys.apiSecret
    ) {
      await prisma.project.update({
        where: { id: projectId },
        data: {
          livekitApiKey: yamlKeys.apiKey,
          livekitApiSecret: encryptLiveKitSecret(yamlKeys.apiSecret),
        },
      });
      try {
        syncAgentWorkerKeys(yamlKeys.apiKey, yamlKeys.apiSecret);
      } catch {
        // Agent worker may not be deployed yet.
      }
      project = await loadDecryptedProject(projectId);
      if (!project) return null;
    }
  }

  return wrapClients(project.id, project.name, project, project.publicLivekitUrl);
}

export async function findProjectIdsByApiKey(apiKey: string) {
  const rows = await prisma.project.findMany({
    where: { livekitApiKey: apiKey },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export function encryptLiveKitSecret(plaintext: string) {
  return encryptSecret(plaintext);
}
