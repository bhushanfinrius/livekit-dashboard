import { z } from "zod";
import { EVENT_LOG_RANGES } from "@/lib/events/types";

export const eventLogQuerySchema = z.object({
  type: z.string().trim().max(80).optional(),
  q: z.string().trim().max(120).optional(),
  range: z.enum(EVENT_LOG_RANGES).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
