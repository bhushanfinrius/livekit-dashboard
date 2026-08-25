import type { EgressInfo, IngressInfo } from "livekit-server-sdk";
import type {
  EgressJobType,
  EgressSnapshot,
  EgressStatusLabel,
  IngressInputLabel,
  IngressSnapshot,
  IngressStateLabel,
} from "@/lib/livekit/egress-types";

const STATUS: Record<number, EgressStatusLabel> = {
  0: "starting",
  1: "active",
  2: "ending",
  3: "complete",
  4: "failed",
  5: "aborted",
  6: "limit reached",
};

const ACTIVE_STATUS = new Set<EgressStatusLabel>(["starting", "active", "ending"]);

const INGRESS_INPUT: Record<number, IngressInputLabel> = {
  0: "RTMP",
  1: "WHIP",
  2: "URL",
};

const INGRESS_STATE: Record<number, IngressStateLabel> = {
  0: "inactive",
  1: "buffering",
  2: "publishing",
  3: "error",
  4: "complete",
};

function protoTimeIso(value: bigint | number | undefined): string | null {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e15 ? raw / 1e6 : raw;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jobType(info: EgressInfo): EgressJobType {
  switch (info.request?.case) {
    case "roomComposite":
      return "room composite";
    case "web":
      return "web";
    case "participant":
      return "participant";
    case "trackComposite":
      return "track composite";
    case "track":
      return "track";
    case "replay":
      return "replay";
    default:
      return "unknown";
  }
}

function firstText(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function outputLocation(info: EgressInfo): string | null {
  const file = info.fileResults?.[0];
  const stream = info.streamResults?.[0];
  const segments = info.segmentResults?.[0];
  const deprecatedFile = info.result?.case === "file" ? info.result.value : undefined;
  const deprecatedStream =
    info.result?.case === "stream" ? info.result.value.info[0] : undefined;

  return firstText(
    file?.location,
    file?.filename,
    stream?.url,
    segments?.playlistLocation,
    segments?.playlistName,
    info.manifestLocation,
    deprecatedFile?.location,
    deprecatedFile?.filename,
    deprecatedStream?.url,
  );
}

export function toEgressSnapshot(info: EgressInfo): EgressSnapshot {
  const status = STATUS[info.status] ?? "unknown";
  return {
    id: info.egressId,
    roomName: info.roomName || "",
    type: jobType(info),
    status,
    startedAt: protoTimeIso(info.startedAt),
    endedAt: protoTimeIso(info.endedAt),
    output: outputLocation(info),
    error: info.error?.trim() || null,
    active: ACTIVE_STATUS.has(status),
  };
}

export function toIngressSnapshot(info: IngressInfo): IngressSnapshot {
  return {
    id: info.ingressId,
    name: info.name || "",
    roomName: info.roomName || "",
    inputType: INGRESS_INPUT[info.inputType] ?? "unknown",
    state: INGRESS_STATE[info.state?.status ?? -1] ?? "unknown",
    url: info.url || "",
    streamKey: info.streamKey || "",
    participantIdentity: info.participantIdentity || "",
    error: info.state?.error?.trim() || null,
  };
}

function startMs(job: EgressSnapshot) {
  return job.startedAt ? Date.parse(job.startedAt) : 0;
}

export function splitEgressJobs(jobs: EgressSnapshot[]) {
  const byStart = (a: EgressSnapshot, b: EgressSnapshot) =>
    startMs(b) - startMs(a) || a.id.localeCompare(b.id);

  const active = jobs.filter((job) => job.active).sort(byStart);
  const recent = jobs.filter((job) => !job.active).sort(byStart);
  return { active, recent };
}
