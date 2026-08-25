const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;

const hits = new Map<string, number[]>();

export function rateLimit(key: string, max = MAX_REQUESTS, windowMs = WINDOW_MS) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length <= max;
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
