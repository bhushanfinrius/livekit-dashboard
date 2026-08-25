import { z } from "zod";

export const roomNameSchema = z.string().trim().min(1).max(256);
export const identitySchema = z.string().trim().min(1).max(256);
export const trackSidSchema = z.string().trim().min(1).max(256);

export const updateRoomMetadataSchema = z.object({
  metadata: z.string().max(4096),
});

export const muteTrackSchema = z.object({
  muted: z.boolean(),
});
