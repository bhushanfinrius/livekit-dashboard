import { z } from "zod";

export const consoleTokenSchema = z.object({
  roomName: z.string().trim().min(1).max(128).optional(),
  dispatchAgent: z.boolean().optional(),
  agentName: z.string().trim().min(1).max(80).optional(),
});
