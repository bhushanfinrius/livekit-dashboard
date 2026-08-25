/** Browser- and Node-safe LiveKit API key/secret generator. Secrets must be ≥ 32 chars. */

function randomBytes(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateLiveKitKeyPair() {
  return {
    apiKey: `deck_${toHex(randomBytes(8))}`,
    apiSecret: toHex(randomBytes(32)),
  };
}
