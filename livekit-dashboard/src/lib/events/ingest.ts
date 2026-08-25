import {
  findProjectIdsByApiKey,
  getProjectLiveKitForWebhook,
} from "@/lib/livekit";
import { startRoomRecordingInBackground } from "@/lib/egress/recording";
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

export async function ingestLiveKitWebhook(options: {
  body: string;
  authHeader: string | null;
  projectId?: string;
}) {
  const token = stripBearer(options.authHeader);
  if (!token) {
    throw new Error("authorization header is empty");
  }

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
      const roomName = event.room?.name?.trim();
      if (roomName && (event.event === "room_started" || event.event === "participant_joined")) {
        startRoomRecordingInBackground(livekit, roomName);
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (stored === 0) {
    throw lastError instanceof Error ? lastError : new Error("invalid webhook");
  }

  return { stored };
}
