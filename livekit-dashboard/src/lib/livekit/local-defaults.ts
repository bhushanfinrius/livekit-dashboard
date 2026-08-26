import { toHttpLivekitUrl } from "@/lib/livekit/url";

/**
 * Credentials shipped in livekit.yaml / sip.yaml / egress.yaml for local Compose.
 * The browser always uses this HTTP URL; the Deck container talks to LiveKit via
 * LIVEKIT_INTERNAL_URL (http://livekit:7880).
 */
export const LOCAL_LIVEKIT = {
  url: "http://127.0.0.1:7880",
  apiKey: "deck_bcce7fdea121fc22",
  apiSecret: "787b881a7f66e8f22ccee99d20b3b38a39921b9de66e901f00c2d25af5c8fafb",
} as const;

export function isLocalLiveKitUrl(url: string) {
  return toHttpLivekitUrl(url).toLowerCase() === LOCAL_LIVEKIT.url;
}

export function coerceLocalLiveKitCredentials(input: {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
}) {
  const { livekitUrl } = input;
  let { livekitApiKey, livekitApiSecret } = input;

  // Common mix-up: the secret pasted into the API key field.
  if (livekitApiKey === LOCAL_LIVEKIT.apiSecret) {
    livekitApiSecret = LOCAL_LIVEKIT.apiSecret;
    livekitApiKey = LOCAL_LIVEKIT.apiKey;
  }

  return { livekitUrl, livekitApiKey, livekitApiSecret };
}

/** True when this process is the Compose `deck` service (no Docker CLI, no YAML writes). */
export function deckRunsInCompose() {
  return (
    process.env.DECK_IN_COMPOSE === "1" || Boolean(process.env.LIVEKIT_INTERNAL_URL?.trim())
  );
}
