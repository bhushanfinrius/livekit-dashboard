export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${rest}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${rest}s`;
  }
  return `${rest}s`;
}

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

/** Cloud Sessions column: "2 hours ago". */
export function formatRelativeTime(iso: string, now = Date.now()) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return formatWhen(iso);
  const seconds = Math.round((now - at) / 1000);
  const abs = Math.abs(seconds);
  const suffix = seconds >= 0 ? "ago" : "from now";
  if (abs < 60) return `${abs} sec ${suffix}`;
  const minutes = Math.round(abs / 60);
  if (minutes < 60) return `${minutes} min ${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? `an hour ${suffix}` : `${hours} hours ${suffix}`;
  const days = Math.round(hours / 24);
  return days === 1 ? `a day ${suffix}` : `${days} days ${suffix}`;
}

export function formatParticipantMinutes(minutes: number) {
  if (minutes <= 0) return "0 min";
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
  }
  return `${Math.round(minutes)} min`;
}

/** Cloud-style session clock, e.g. 00:19.08 */
export function formatSessionClock(ms: number) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}`;
}
