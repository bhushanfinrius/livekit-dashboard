import { z } from "zod";

const csv = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(/[\s,]+/))
      .map((item) => item.trim())
      .filter(Boolean),
  );

export const inboundTrunkSchema = z.object({
  name: z.string().trim().min(1).max(80),
  numbers: csv.pipe(z.array(z.string()).min(1, "At least one number is required")),
  allowedAddresses: csv.optional(),
  allowedNumbers: csv.optional(),
  authUsername: z.string().trim().optional(),
  authPassword: z.string().optional(),
  mediaEncryption: z.enum(["disable", "allow", "require"]).default("disable"),
  krispEnabled: z.boolean().optional(),
  metadata: z.string().max(4096).optional(),
});

export const outboundTrunkSchema = z.object({
  name: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1, "SIP address is required"),
  numbers: csv.pipe(z.array(z.string()).min(1, "At least one from-number is required")),
  transport: z.enum(["auto", "udp", "tcp", "tls"]).default("auto"),
  authUsername: z.string().trim().optional(),
  authPassword: z.string().optional(),
  mediaEncryption: z.enum(["disable", "allow", "require"]).default("disable"),
  metadata: z.string().max(4096).optional(),
});

export const dispatchRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(["direct", "individual", "callee"]),
  roomName: z.string().trim().optional(),
  roomPrefix: z.string().trim().optional(),
  pin: z.string().trim().optional(),
  trunkIds: csv.optional(),
  metadata: z.string().max(4096).optional(),
});

export const sipDialSchema = z.object({
  sipTrunkId: z.string().trim().min(1),
  number: z.string().trim().min(1),
  roomName: z.string().trim().min(1),
  participantIdentity: z.string().trim().optional(),
});

export const agentDispatchSchema = z.object({
  roomName: z.string().trim().min(1),
  agentName: z.string().trim().min(1),
  metadata: z.string().max(4096).optional(),
});

export const deleteDispatchSchema = z.object({
  roomName: z.string().trim().min(1),
  dispatchId: z.string().trim().min(1),
});

export const deployAgentWorkerSchema = z.object({
  agentName: z.string().trim().min(1).max(80),
  rebuild: z.boolean().optional(),
  entrypoint: z.string().trim().min(1).max(120).optional(),
  backendBaseUrl: z.string().trim().max(500).optional(),
  backendWebhookUrl: z.string().trim().max(500).optional(),
  skipCreditCheck: z.boolean().optional(),
});
