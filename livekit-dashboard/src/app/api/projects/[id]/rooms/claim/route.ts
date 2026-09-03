import { jsonError, jsonOk } from "@/lib/http";
import { readJsonBody } from "@/lib/api/project";
import { authorizeDeckAgent } from "@/lib/events/deck-ingest-auth";
import { registerProjectRoom } from "@/lib/events/attribution";
import { z } from "zod";

export const dynamic = "force-dynamic";

const claimSchema = z.object({
  roomName: z.string().trim().min(1).max(256),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const auth = await authorizeDeckAgent(request, id);
  if (auth.error) return auth.error;

  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = claimSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid room", 400, "VALIDATION");
  }

  await registerProjectRoom(auth.projectId, parsed.data.roomName);
  return jsonOk({ ok: true, roomName: parsed.data.roomName });
}
