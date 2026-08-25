import { z } from "zod";

export const startRecordingSchema = z.object({
  roomName: z.string().trim().min(1),
  audioOnly: z.boolean().default(true),
});

export const createIngressSchema = z.object({
  inputType: z.enum(["RTMP", "WHIP"]).default("RTMP"),
  name: z.string().trim().max(80).optional(),
  roomName: z.string().trim().min(1).max(128),
  participantIdentity: z.string().trim().min(1).max(128).optional(),
});
