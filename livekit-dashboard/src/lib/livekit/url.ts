export function toHttpLivekitUrl(url: string) {
  return url
    .trim()
    .replace(/\/$/, "")
    .replace(/^ws:/i, "http:")
    .replace(/^wss:/i, "https:")
    .replace(/^(https?:\/\/)localhost\b/i, "$1127.0.0.1")
    .replace(/^(https?:\/\/)\[::1\]/i, "$1127.0.0.1");
}

/** Agent workers connect over WebSocket. Host processes use this; Docker uses ws://livekit:7880. */
export function toWsLivekitUrl(url: string) {
  return toHttpLivekitUrl(url)
    .replace(/^http:/i, "ws:")
    .replace(/^https:/i, "wss:");
}

/** SIP / CLI clients: public wss:// if set, otherwise the project LiveKit URL. Browser Talk uses browserWsUrl. */
export function clientLivekitWsUrl(input: {
  livekitUrl: string;
  publicLivekitUrl?: string | null;
}) {
  const publicUrl = input.publicLivekitUrl?.trim();
  if (publicUrl) return toWsLivekitUrl(publicUrl);
  return toWsLivekitUrl(input.livekitUrl);
}

export function isLoopbackLivekitUrl(url: string) {
  try {
    const host = new URL(toHttpLivekitUrl(url)).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return /127\.0\.0\.1|localhost|\[::1\]/i.test(url);
  }
}

export function livekitCliProjectAdd(input: {
  projectName: string;
  wsUrl: string;
  apiKey: string;
}) {
  const alias =
    input.projectName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "deck";
  return `lk project add ${alias} --url ${input.wsUrl} --api-key ${input.apiKey} --api-secret <paste from API keys>`;
}
