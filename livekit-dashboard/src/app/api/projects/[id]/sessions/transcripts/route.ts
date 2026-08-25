import { timingSafeEqual } from "node:crypto";
import { jsonError, jsonOk } from "@/lib/http";
import { readJsonBody } from "@/lib/api/project";
import { prisma } from "@/lib/db";
import { storeTranscriptEvent } from "@/lib/events/store";
import { transcriptIngestSchema } from "@/lib/validators/transcript";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function secretsMatch(provided: string | null, expected: string) {
  const left = Buffer.from(provided ?? "");
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const expected = process.env.DECK_TRANSCRIPT_SECRET?.trim();
  if (!expected) {
    return jsonError("Set DECK_TRANSCRIPT_SECRET to accept agent transcripts.", 503, "VALIDATION");
  }

  const provided =
    request.headers.get("x-deck-transcript-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  if (!secretsMatch(provided, expected)) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!project) return jsonError("Project not found", 404, "NOT_FOUND");

  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = transcriptIngestSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid transcript", 400, "VALIDATION");
  }

  const event = await storeTranscriptEvent(project.id, {
    roomName: parsed.data.roomName,
    speaker: parsed.data.speaker,
    identity: parsed.data.identity,
    text: parsed.data.text,
    at: parsed.data.at,
    offsetMs: parsed.data.offsetMs,
  });
  return jsonOk({ id: event.id }, 201);
}
