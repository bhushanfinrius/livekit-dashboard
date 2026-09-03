import {
  corsAllowsOrigin,
  fetchBucketCors,
  gcsBucketName,
  loadGcsCredentials,
} from "@/lib/gcs";
import { recordingOutputError } from "@/lib/egress/recording";
import type { ProjectLiveKit } from "@/lib/livekit";

export type RecordingCheckStatus = "ok" | "warn" | "fail";

export type RecordingCheck = {
  id: "storage" | "egress" | "cors" | "dispatch";
  label: string;
  status: RecordingCheckStatus;
  detail: string;
  /** Command or action that fixes it, shown verbatim to the user. */
  fix?: string;
};

export type RecordingReadiness = {
  status: RecordingCheckStatus;
  checks: RecordingCheck[];
};

function appOrigin() {
  const configured = process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  if (!configured) return "http://localhost:3000";
  try {
    return new URL(configured).origin;
  } catch {
    return "http://localhost:3000";
  }
}

async function checkStorage(): Promise<RecordingCheck> {
  const configError = recordingOutputError();
  if (configError) {
    return {
      id: "storage",
      label: "Recording storage",
      status: "fail",
      detail: configError,
      fix: "Set GCS_BUCKET_NAME and GCS_CREDENTIALS_PATH in livekit-dashboard/.env",
    };
  }
  return {
    id: "storage",
    label: "Recording storage",
    status: "ok",
    detail: `Uploading to gs://${gcsBucketName()}`,
  };
}

async function checkEgress(livekit: ProjectLiveKit): Promise<RecordingCheck> {
  try {
    await livekit.egress.list();
    return {
      id: "egress",
      label: "Egress service",
      status: "ok",
      detail: "Egress service is reachable",
    };
  } catch (error) {
    return {
      id: "egress",
      label: "Egress service",
      status: "fail",
      detail:
        error instanceof Error ? error.message : "Could not reach the LiveKit egress service",
      fix: "npm run docker:up  (starts redis + egress)",
    };
  }
}

async function checkCors(): Promise<RecordingCheck> {
  const bucket = gcsBucketName();
  const credentials = loadGcsCredentials();
  const origin = appOrigin();
  if (!bucket || !credentials) {
    return {
      id: "cors",
      label: "Waveform CORS",
      status: "warn",
      detail: "Configure recording storage first",
    };
  }
  try {
    const rules = await fetchBucketCors(bucket, credentials);
    if (corsAllowsOrigin(rules, origin)) {
      return {
        id: "cors",
        label: "Waveform CORS",
        status: "ok",
        detail: `Bucket allows GET from ${origin}`,
      };
    }
    return {
      id: "cors",
      label: "Waveform CORS",
      status: "warn",
      // Playback still works; only the client-side peak decoding needs CORS.
      detail: `Bucket does not allow GET from ${origin}, so waveforms cannot decode`,
      fix: "npm run recording:cors",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read bucket CORS";
    return {
      id: "cors",
      label: "Waveform CORS",
      status: "warn",
      detail: message,
      fix: /storage\.buckets\.(get|update)|permission/i.test(message)
        ? "Grant the service account roles/storage.admin on the bucket, then npm run recording:cors"
        : "npm run recording:cors",
    };
  }
}

async function checkDispatchRules(livekit: ProjectLiveKit): Promise<RecordingCheck> {
  try {
    const rules = await livekit.sip.listDispatch();
    if (rules.length === 0) {
      return {
        id: "dispatch",
        label: "Inbound SIP recording",
        status: "ok",
        detail: "No inbound dispatch rules configured",
      };
    }
    const missing = rules.filter((rule) => !rule.roomConfig?.egress);
    if (missing.length === 0) {
      return {
        id: "dispatch",
        label: "Inbound SIP recording",
        status: "ok",
        detail: `${rules.length} dispatch rule(s) carry recording config`,
      };
    }
    return {
      id: "dispatch",
      label: "Inbound SIP recording",
      status: "warn",
      // LiveKit has no update RPC for dispatch rules, so the rule must be recreated.
      detail: `${missing.length} of ${rules.length} dispatch rule(s) were created before recording config: ${missing
        .map((rule) => rule.name || rule.sipDispatchRuleId)
        .join(", ")}`,
      fix: "Delete and re-create these dispatch rules in SIP → Dispatch rules",
    };
  } catch (error) {
    return {
      id: "dispatch",
      label: "Inbound SIP recording",
      status: "warn",
      detail: error instanceof Error ? error.message : "Could not list SIP dispatch rules",
    };
  }
}

export async function recordingReadiness(livekit: ProjectLiveKit): Promise<RecordingReadiness> {
  const checks = await Promise.all([
    checkStorage(),
    checkEgress(livekit),
    checkCors(),
    checkDispatchRules(livekit),
  ]);
  const status: RecordingCheckStatus = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "ok";
  return { status, checks };
}
