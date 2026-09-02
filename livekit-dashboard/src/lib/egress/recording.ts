import {
  AutoTrackEgress,
  EncodedFileOutput,
  EncodedFileType,
  GCPUpload,
  RoomEgress,
} from "livekit-server-sdk";
import { gcsBucketName, loadGcsCredentials } from "@/lib/gcs";
import type { ProjectLiveKit } from "@/lib/livekit";

export function recordingOutputError() {
  if (!gcsBucketName()) return "Set GCS_BUCKET_NAME to store recordings.";
  if (!loadGcsCredentials()) {
    return "Set GCS_CREDENTIALS_PATH or GCS_CREDENTIALS_JSON (service account JSON) to store recordings.";
  }
  return null;
}

export function autoTrackEgressFilepath(agentName = "deck") {
  return `recordings/${agentName}/{room_name}/{publisher_identity}-{time}.ogg`;
}

export function autoTrackEgressOutput(agentName?: string) {
  const bucket = gcsBucketName();
  const credentials = loadGcsCredentials();
  if (!bucket || !credentials) {
    throw new Error(recordingOutputError() ?? "GCS recording is not configured");
  }
  return new AutoTrackEgress({
    filepath: autoTrackEgressFilepath(agentName),
    output: {
      case: "gcp",
      value: new GCPUpload({
        bucket,
        credentials: credentials.rawJson,
      }),
    },
  });
}

/** @deprecated Use autoTrackEgressOutput for new calls — kept for manual room composite API. */
export function roomCompositeFileOutput() {
  const bucket = gcsBucketName();
  const credentials = loadGcsCredentials();
  if (!bucket || !credentials) {
    throw new Error(recordingOutputError() ?? "GCS recording is not configured");
  }
  return new EncodedFileOutput({
    fileType: EncodedFileType.OGG,
    filepath: "deck/{room_name}/{time}",
    output: {
      case: "gcp",
      value: new GCPUpload({
        bucket,
        credentials: credentials.rawJson,
      }),
    },
  });
}

export type RecordingStartResult =
  | { started: true; reason: "started" }
  | { started: false; reason: "empty-room" | "unconfigured" | "already-active" | "error"; error?: string };

function isAlreadyExistsError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|already started|duplicate|egress already/i.test(message);
}

/** LiveKit Cloud style: CreateRoom with auto track egress before participants join. */
export async function ensureRoomWithAutoTrackEgress(
  livekit: ProjectLiveKit,
  roomName: string,
  agentName?: string,
): Promise<RecordingStartResult> {
  const name = roomName.trim();
  if (!name) return { started: false, reason: "empty-room" };
  const configError = recordingOutputError();
  if (configError) return { started: false, reason: "unconfigured", error: configError };
  try {
    await livekit.rooms.create({
      name,
      egress: new RoomEgress({
        tracks: autoTrackEgressOutput(agentName),
      }),
    });
    return { started: true, reason: "started" };
  } catch (error) {
    if (isAlreadyExistsError(error)) return { started: false, reason: "already-active" };
    const message = error instanceof Error ? error.message : "Could not configure auto track egress";
    console.error("[recording:auto-track]", name, message);
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
      console.error("[recording:auto-track]", roomName, result.error ?? result.reason);
    }
  });
}

/** @deprecated Prefer ensureRoomWithAutoTrackEgress — room composite records one mixed file. */
export async function ensureRoomRecording(
  livekit: ProjectLiveKit,
  roomName: string,
): Promise<RecordingStartResult> {
  return ensureRoomWithAutoTrackEgress(livekit, roomName);
}

/** @deprecated Prefer ensureRoomWithAutoTrackEgressInBackground. */
export function startRoomRecordingInBackground(livekit: ProjectLiveKit, roomName: string) {
  ensureRoomWithAutoTrackEgressInBackground(livekit, roomName);
}
