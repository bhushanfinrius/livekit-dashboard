import { jsonError, jsonOk } from "@/lib/http";
import { ingestLiveKitWebhook, isBrowserForgedWebhook } from "@/lib/events/ingest";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (isBrowserForgedWebhook(request)) {
    return jsonError("Forbidden", 403, "FORBIDDEN");
  }

  if (!rateLimit(`webhook:${clientIp(request)}`)) {
    return jsonError("Too many webhook requests", 429, "RATE_LIMITED");
  }

  const body = await request.text();
  const authHeader = request.headers.get("Authorization") ?? request.headers.get("Authorize");

  try {
    const result = await ingestLiveKitWebhook({ body, authHeader });
    return jsonOk({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid webhook";
    let room = "";
    try {
      const parsed = JSON.parse(body) as { room?: { name?: string }; egressInfo?: { roomName?: string } };
      room = parsed.room?.name || parsed.egressInfo?.roomName || "";
    } catch {
      room = "";
    }
    console.error("[webhook]", message, room ? `room=${room}` : "");
    return jsonError("invalid webhook", 400, "INVALID_WEBHOOK");
  }
}
