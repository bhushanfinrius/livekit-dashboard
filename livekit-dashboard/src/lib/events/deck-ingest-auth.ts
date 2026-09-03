import type { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/db";
import { timingSafeEqual } from "node:crypto";

function secretsMatch(provided: string | null, expected: string) {
  const left = Buffer.from(provided ?? "");
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

type DeckAuth =
  | { error: NextResponse; projectId?: undefined }
  | { error: null; projectId: string };

/** Shared secret check for agent → LumiVoice ingest (transcripts and room claim). */
export async function authorizeDeckAgent(request: Request, projectId: string): Promise<DeckAuth> {
  const expected = process.env.DECK_TRANSCRIPT_SECRET?.trim();
  if (!expected) {
    return {
      error: jsonError("Set DECK_TRANSCRIPT_SECRET to accept agent transcripts.", 503, "VALIDATION"),
    };
  }

  const provided =
    request.headers.get("x-deck-transcript-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;
  if (!secretsMatch(provided, expected)) {
    return { error: jsonError("Unauthorized", 401, "UNAUTHORIZED") };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return { error: jsonError("Project not found", 404, "NOT_FOUND") };

  return { error: null, projectId: project.id };
}
