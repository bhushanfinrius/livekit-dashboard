import {
  findProjectIdsByApiKey,
  getProjectLiveKitForWebhook,
  infraWebhookReceiver,
} from "@/lib/livekit";
import { registerProjectRoom, resolveProjectIdForRoom } from "@/lib/events/attribution";
import { storeWebhookEvent } from "@/lib/events/store";

export function stripBearer(header: string | null) {
  if (!header) return "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

export function readJwtIssuer(token: string) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      iss?: unknown;
    };
    return typeof json.iss === "string" ? json.iss : null;
  } catch {
    return null;
  }
}

export function isBrowserForgedWebhook(request: Request) {
  if (request.headers.get("origin")) return true;
  const site = request.headers.get("sec-fetch-site");
  return Boolean(site && site !== "none");
}

/**
 * The self-hosted server signs every webhook with the infra pair, so the issuer no
 * longer names a project. Verify once, then attribute the event by its room.
 */
async function ingestViaInfraKey(body: string, token: string) {
  const receiver = infraWebhookReceiver();
  if (!receiver) return null;

  let event;
  try {
    event = await receiver.receive(body, token);
  } catch {
    // Signed by a project key instead (a remote or Cloud LiveKit).
    return null;
  }

  const roomName = event.room?.name ?? event.egressInfo?.roomName;
  const projectId = await resolveProjectIdForRoom(roomName);
  if (!projectId) {
    console.error("[webhook] no project owns room", roomName ?? "(unknown)");
    throw new Error(`no project owns room ${roomName ?? "(unknown)"}`);
  }

  if (roomName?.trim()) {
    await registerProjectRoom(projectId, roomName);
  }

  await storeWebhookEvent(projectId, event, body);
  return { stored: 1 };
}

export async function ingestLiveKitWebhook(options: {
  body: string;
  authHeader: string | null;
  projectId?: string;
}) {
  const token = stripBearer(options.authHeader);
  if (!token) {
    throw new Error("authorization header is empty");
  }

  if (!options.projectId) {
    const viaInfra = await ingestViaInfraKey(options.body, token);
    if (viaInfra) return viaInfra;
  }

  // Per-project webhook URL, or a remote LiveKit signing with the project's own key.
  const projectIds = options.projectId
    ? [options.projectId]
    : await findProjectIdsByApiKey(readJwtIssuer(token) ?? "");

  if (projectIds.length === 0) {
    throw new Error("no matching project for webhook");
  }

  let stored = 0;
  let lastError: unknown;

  for (const projectId of projectIds) {
    const livekit = await getProjectLiveKitForWebhook(projectId);
    if (!livekit) {
      lastError = new Error("project not found");
      continue;
    }

    try {
      const event = await livekit.webhook.receive(options.body, token);
      await storeWebhookEvent(projectId, event, options.body);
      stored += 1;
      // Recording is declared at room creation and backstopped by the agent. Starting it
      // from webhooks recursed: each room-composite egress joins as a participant, which
      // fired participant_joined and started yet another composite.
    } catch (error) {
      lastError = error;
      const room =
        (() => {
          try {
            const parsed = JSON.parse(options.body) as {
              room?: { name?: string };
              egressInfo?: { roomName?: string };
            };
            return parsed.room?.name || parsed.egressInfo?.roomName || "";
          } catch {
            return "";
          }
        })();
      console.error(
        "[webhook] ingest failed",
        room ? `room=${room}` : "",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (stored === 0) {
    throw lastError instanceof Error ? lastError : new Error("invalid webhook");
  }

  return { stored };
}
