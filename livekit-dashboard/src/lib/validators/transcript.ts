import { z } from "zod";

export const transcriptIngestSchema = z.object({
  roomName: z.string().trim().min(1).max(256),
  speaker: z.enum(["user", "agent", "system"]).default("user"),
  identity: z.string().trim().max(256).optional(),
  text: z.string().trim().min(1).max(16_000),
  at: z.string().optional(),
  offsetMs: z.number().nonnegative().optional(),
});
