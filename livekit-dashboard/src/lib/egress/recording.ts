import { EncodedFileOutput, EncodedFileType, GCPUpload } from "livekit-server-sdk";
import { gcsBucketName, loadGcsCredentials } from "@/lib/gcs";
import type { ProjectLiveKit } from "@/lib/livekit";

export function recordingOutputError() {
  if (!gcsBucketName()) return "Set GCS_BUCKET_NAME to store recordings.";
  if (!loadGcsCredentials()) {
    return "Set GCS_CREDENTIALS_PATH or GCS_CREDENTIALS_JSON (service account JSON) to store recordings.";
  }
  return null;
}

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

function isAlreadyActiveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|already started|duplicate|egress already/i.test(message);
}

export async function ensureRoomRecording(
  livekit: ProjectLiveKit,
  roomName: string,
): Promise<RecordingStartResult> {
  const name = roomName.trim();
  if (!name) return { started: false, reason: "empty-room" };
  const configError = recordingOutputError();
  if (configError) return { started: false, reason: "unconfigured", error: configError };
  try {
    const active = await livekit.egress.list({ roomName: name, active: true });
    if (active.length > 0) return { started: false, reason: "already-active" };
    await livekit.egress.startRoomComposite(name, roomCompositeFileOutput(), { audioOnly: true });
    return { started: true, reason: "started" };
  } catch (error) {
    if (isAlreadyActiveError(error)) return { started: false, reason: "already-active" };
    const message = error instanceof Error ? error.message : "Could not start recording";
    console.error("[recording]", name, message);
    return { started: false, reason: "error", error: message };
  }
}

export function startRoomRecordingInBackground(livekit: ProjectLiveKit, roomName: string) {
  void ensureRoomRecording(livekit, roomName).then((result) => {
    if (result.reason === "error" || result.reason === "unconfigured") {
      console.error("[recording]", roomName, result.error ?? result.reason);
    }
  });
}
