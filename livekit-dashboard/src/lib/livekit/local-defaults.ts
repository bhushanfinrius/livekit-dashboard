import { toHttpLivekitUrl } from "@/lib/livekit/url";

/** Credentials from livekit.yaml for the local docker-compose server. */
export const LOCAL_LIVEKIT = {
  url: "http://127.0.0.1:7880",
  apiKey: "devkey",
  apiSecret: "devsecret_livekit_local_32chars!",
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

  // Common mix-up: the 32-char secret pasted into the API key field.
  if (livekitApiKey === LOCAL_LIVEKIT.apiSecret) {
    livekitApiSecret = LOCAL_LIVEKIT.apiSecret;
    livekitApiKey = LOCAL_LIVEKIT.apiKey;
  }

  return { livekitUrl, livekitApiKey, livekitApiSecret };
}
