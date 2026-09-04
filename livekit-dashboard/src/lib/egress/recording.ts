import {
  AutoTrackEgress,
  EncodedFileOutput,
  EncodedFileType,
  GCPUpload,
  RoomCompositeEgressRequest,
  RoomEgress,
} from "livekit-server-sdk";
import { registerProjectRoom } from "@/lib/events/attribution";
import { gcsBucketName, loadGcsCredentials } from "@/lib/gcs";
import type { ProjectLiveKit } from "@/lib/livekit";
import { MIXED_RECORDING_SUFFIX } from "@/lib/sessions/recording-role";

const DEFAULT_AGENT_FOLDER = "deck";

export function recordingOutputError() {
  if (!gcsBucketName()) return "Set GCS_BUCKET_NAME to store recordings.";
  if (!loadGcsCredentials()) {
    return "Set GCS_CREDENTIALS_PATH or GCS_CREDENTIALS_JSON (service account JSON) to store recordings.";
  }
  return null;
}

function recordingPrefix(agentName?: string) {
  return `recordings/${agentName?.trim() || DEFAULT_AGENT_FOLDER}`;
}

export function mixedRecordingFilepath(agentName?: string) {
  return `${recordingPrefix(agentName)}/{room_name}/{room_name}${MIXED_RECORDING_SUFFIX}.ogg`;
}

export function autoTrackEgressFilepath(agentName?: string) {
  return `${recordingPrefix(agentName)}/{room_name}/{publisher_identity}-{time}.ogg`;
}

function gcpUpload() {
  const bucket = gcsBucketName();
  const credentials = loadGcsCredentials();
  if (!bucket || !credentials) {
    throw new Error(recordingOutputError() ?? "GCS recording is not configured");
  }
  return new GCPUpload({ bucket, credentials: credentials.rawJson });
}

export function mixedFileOutput(agentName?: string) {
  return new EncodedFileOutput({
    fileType: EncodedFileType.OGG,
    filepath: mixedRecordingFilepath(agentName),
    output: { case: "gcp", value: gcpUpload() },
  });
}

/**
 * Room composite, audio only. Never set layout or customBaseUrl — those force the job
 * through the Chrome video pipeline, which fails on audio-only SIP rooms.
 */
export function mixedEgressRequest(agentName?: string) {
  return new RoomCompositeEgressRequest({
    audioOnly: true,
    fileOutputs: [mixedFileOutput(agentName)],
  });
}

export function autoTrackEgressOutput(agentName?: string) {
  return new AutoTrackEgress({
    filepath: autoTrackEgressFilepath(agentName),
    output: { case: "gcp", value: gcpUpload() },
  });
}

/** Campaign / test dials: Solvox names rooms camp-… / test-…. */
export function isBurstDialRoom(roomName: string) {
  return /^(camp|test)-/i.test(roomName.trim());
}

export function campaignMaxConcurrent() {
  const raw = Number(process.env.CAMPAIGN_MAX_CONCURRENT ?? "3");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}

type CampaignRoomLike = {
  name: string;
  creationTime?: bigint | number;
  creationTimeMs?: bigint | number;
};

function campaignCreatedAt(room: CampaignRoomLike) {
  if (room.creationTimeMs != null && Number(room.creationTimeMs) > 0) {
    return Number(room.creationTimeMs);
  }
  if (room.creationTime != null && Number(room.creationTime) > 0) {
    return Number(room.creationTime) * 1000;
  }
  return 0;
}

/** Keep the oldest campaign rooms up to the cap; extra camp-/test- rooms are rejected. */
export function campaignRoomAllowed(roomName: string, rooms: CampaignRoomLike[]) {
  const name = roomName.trim();
  if (!isBurstDialRoom(name)) return true;
  const cap = campaignMaxConcurrent();
  const camp = rooms.filter((room) => isBurstDialRoom(room.name));
  if (!camp.some((room) => room.name === name)) {
    return camp.length < cap;
  }
  const keep = [...camp]
    .sort((a, b) => {
      const created = campaignCreatedAt(a) - campaignCreatedAt(b);
      return created !== 0 ? created : a.name.localeCompare(b.name);
    })
    .slice(0, cap)
    .map((room) => room.name);
  return keep.includes(name);
}

/**
 * Chrome room-composite plus per-track jobs will 503 a single egress worker when
 * a campaign opens several rooms at once. Burst dials get tracks only.
 */
export function roomEgressConfig(agentName?: string, roomName?: string) {
  if (roomName && isBurstDialRoom(roomName)) {
    return new RoomEgress({
      tracks: autoTrackEgressOutput(agentName),
    });
  }
  return new RoomEgress({
    room: mixedEgressRequest(agentName),
    tracks: autoTrackEgressOutput(agentName),
  });
}

export async function campaignConcurrencyError(
  livekit: ProjectLiveKit,
  roomName: string,
): Promise<string | null> {
  const name = roomName.trim();
  if (!isBurstDialRoom(name)) return null;
  const rooms = await livekit.rooms.list();
  if (campaignRoomAllowed(name, rooms)) return null;
  const liveCamp = rooms.filter((room) => isBurstDialRoom(room.name)).length;
  const cap = campaignMaxConcurrent();
  return `Campaign already has ${liveCamp} live rooms (cap ${cap}). Stop extra dials in Solvox or wait for a room to end.`;
}

export type RecordingStartResult =
  | { started: true; reason: "started" }
  | { started: false; reason: "empty-room" | "unconfigured" | "already-active" | "error"; error?: string };

function isAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|already started|duplicate|egress already/i.test(message);
}

/**
 * LiveKit Cloud pattern: create the room with its egress config before any participant
 * joins. CreateRoom on an existing room silently ignores new egress config, so this must
 * run before dial/dispatch/token.
 */
export async function ensureRoomWithAutoTrackEgress(
  livekit: ProjectLiveKit,
  roomName: string,
  agentName?: string,
): Promise<RecordingStartResult> {
  const name = roomName.trim();
  if (!name) return { started: false, reason: "empty-room" };

  // Claim the room before anything joins it: webhooks are signed with the shared infra
  // key, so this registration is what attributes the resulting events to this project.
  await registerProjectRoom(livekit.projectId, name);

  const configError = recordingOutputError();
  if (configError) return { started: false, reason: "unconfigured", error: configError };
  try {
    await livekit.rooms.create({ name, egress: roomEgressConfig(agentName, name) });
    return { started: true, reason: "started" };
  } catch (error) {
    if (isAlreadyExistsError(error)) return { started: false, reason: "already-active" };
    const message = error instanceof Error ? error.message : "Could not configure room egress";
    console.error("[recording:egress]", name, message);
    return { started: false, reason: "error", error: message };
  }
}

export function ensureRoomWithAutoTrackEgressInBackground(
  livekit: ProjectLiveKit,
  roomName: string,
  agentName?: string,
) {
  void ensureRoomWithAutoTrackEgress(livekit, roomName, agentName).then((result) => {
    if (result.reason === "error" || result.reason === "unconfigured") {
      console.error("[recording:egress]", roomName, result.error ?? result.reason);
    }
  });
}

