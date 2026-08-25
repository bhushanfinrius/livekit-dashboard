import { createHash, createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export type GcsObject = {
  bucket: string;
  object: string;
};

export type GcsCredentials = {
  client_email: string;
  private_key: string;
  rawJson: string;
};

function env(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

export function gcsBucketName() {
  return env("GCS_BUCKET_NAME");
}

export function loadGcsCredentials(): GcsCredentials | null {
  const inline = env("GCS_CREDENTIALS_JSON");
  const path = env("GCS_CREDENTIALS_PATH") ?? env("GOOGLE_APPLICATION_CREDENTIALS");
  const raw = inline ?? (path ? readFileSync(path, "utf8") : null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GcsCredentials>;
    if (!parsed.client_email?.trim() || !parsed.private_key?.trim()) return null;
    return {
      client_email: parsed.client_email.trim(),
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
      rawJson: raw,
    };
  } catch {
    return null;
  }
}

export function gcsRecordingReady() {
  return Boolean(gcsBucketName() && loadGcsCredentials());
}

export function parseGcsLocation(location: string | null): GcsObject | null {
  if (!location) return null;
  const trimmed = location.trim();
  const gs = trimmed.match(/^gs:\/\/([^/]+)\/(.+)$/i);
  if (gs) return { bucket: gs[1], object: gs[2] };
  try {
    const url = new URL(trimmed.split("?")[0]);
    const virtual = url.hostname.match(/^(.+)\.storage\.googleapis\.com$/i);
    if (virtual && virtual[1] && virtual[1].toLowerCase() !== "storage") {
      const object = url.pathname.replace(/^\/+/, "");
      if (!object) return null;
      return { bucket: virtual[1], object };
    }
    if (!/storage\.googleapis\.com$/i.test(url.hostname) && !/storage\.cloud\.google\.com$/i.test(url.hostname)) {
      return null;
    }
    const parts = url.pathname.replace(/^\/+/, "").split("/");
    if (parts.length < 2) return null;
    return { bucket: parts[0], object: parts.slice(1).join("/") };
  } catch {
    return null;
  }
}

function rfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function utcStamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`,
    datetime: `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`,
  };
}

export function signedGcsGetUrl(
  location: GcsObject,
  credentials: GcsCredentials,
  expiresSeconds = 3600,
  now = new Date(),
) {
  const host = "storage.googleapis.com";
  const canonicalUri = `/${location.bucket}/${location.object
    .split("/")
    .map(rfc3986)
    .join("/")}`;
  const stamp = utcStamp(now);
  const scope = `${stamp.date}/auto/storage/goog4_request`;
  const credential = `${credentials.client_email}/${scope}`;
  const query: Array<[string, string]> = [
    ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
    ["X-Goog-Credential", credential],
    ["X-Goog-Date", stamp.datetime],
    ["X-Goog-Expires", String(Math.min(Math.max(expiresSeconds, 1), 604800))],
    ["X-Goog-SignedHeaders", "host"],
  ].map(([key, value]) => [key, rfc3986(value)]);
  query.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = query.map(([key, value]) => `${key}=${value}`).join("&");
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    "",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const hashedRequest = createHash("sha256").update(canonicalRequest).digest("hex");
  const stringToSign = ["GOOG4-RSA-SHA256", stamp.datetime, scope, hashedRequest].join("\n");
  const signer = createSign("RSA-SHA256");
  signer.update(stringToSign);
  const signature = signer.sign(credentials.private_key, "hex");
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`;
}

export async function resolvePlayableUrl(location: string | null) {
  if (!location) return null;
  const trimmed = location.trim();
  if (/^https?:\/\//i.test(trimmed) && !parseGcsLocation(trimmed)) return trimmed;
  const object = parseGcsLocation(trimmed);
  const credentials = loadGcsCredentials();
  if (!object || !credentials) return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  return signedGcsGetUrl(object, credentials);
}
