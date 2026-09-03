import { toHttpLivekitUrl } from "@/lib/livekit/url";

/**
 * The local Compose LiveKit. Credentials are not here: they are generated per install by
 * `npm run livekit:keys` and assigned one pair per project. The browser always uses this
 * HTTP URL; the Deck container talks to LiveKit via LIVEKIT_INTERNAL_URL (http://livekit:7880).
 */
export const LOCAL_LIVEKIT = {
  url: "http://127.0.0.1:7880",
} as const;

export function isLocalLiveKitUrl(url: string) {
  return toHttpLivekitUrl(url).toLowerCase() === LOCAL_LIVEKIT.url;
}

/** True when this process is the Compose `deck` service (no Docker CLI, no YAML writes). */
export function deckRunsInCompose() {
  return (
    process.env.DECK_IN_COMPOSE === "1" || Boolean(process.env.LIVEKIT_INTERNAL_URL?.trim())
  );
}
