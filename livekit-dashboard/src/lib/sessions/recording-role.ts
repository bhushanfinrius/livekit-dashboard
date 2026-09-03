import type { RecordingRole } from "@/lib/sessions/types";

/** Suffix the room-composite (mixed) egress writes. Mirrors MIXED_RECORDING_SUFFIX in agent.py. */
export const MIXED_RECORDING_SUFFIX = "-mixed";

const ROLE_LABELS: Record<RecordingRole, string> = {
  mixed: "Mixed",
  prospect: "Prospect",
  agent: "Agent",
};

export const RECORDING_ROLE_ORDER: Record<RecordingRole, number> = {
  mixed: 0,
  prospect: 1,
  agent: 2,
};

export function recordingRoleLabel(role: RecordingRole) {
  return ROLE_LABELS[role];
}

function fileStem(output: string) {
  const withoutQuery = output.split("?")[0] ?? output;
  const basename = withoutQuery.split(/[/\\]/).pop() ?? "";
  return basename.replace(/\.[^.]+$/, "");
}

const TRACK_SID_TOKEN = /^TR_[A-Za-z0-9]+$/;
const TIME_TOKEN = /^\d+$|^\d{2}T\d{6}$/;

/**
 * Auto track egress writes `{publisher_identity}-{time}-{track_id}.ogg`, and {time} itself
 * expands to a dashed ISO stamp. Mirrors _publisher_identity_from_object_path in agent.py.
 */
function publisherIdentity(stem: string) {
  const tokens = stem.split("-");
  while (tokens.length > 1 && (TRACK_SID_TOKEN.test(tokens.at(-1)!) || TIME_TOKEN.test(tokens.at(-1)!))) {
    tokens.pop();
  }
  return tokens.join("-");
}

/** Mirrors _recording_role_for_object_path in agent.py. */
export function recordingRoleFromOutput(
  output: string | null | undefined,
  type?: string | null,
): RecordingRole {
  if (type && /roomcomposite|room_composite/i.test(type)) return "mixed";
  if (!output) return "agent";

  const stem = fileStem(output);
  if (stem.endsWith(MIXED_RECORDING_SUFFIX)) return "mixed";

  const identity = publisherIdentity(stem).toLowerCase();
  // LumiVoice Talk console: the browser participant stands in for the prospect.
  if (identity.startsWith("deck-")) return "prospect";
  if (identity.startsWith("sip")) return "prospect";
  if (identity.replace(/\D/g, "").length >= 10) return "prospect";
  return "agent";
}
