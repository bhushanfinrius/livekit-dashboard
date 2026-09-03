import { createHash, createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { composeProjectDir } from "@/lib/docker/compose";

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

/** Resolve GCS JSON path — host paths in .env do not exist inside the deck container. */
export function resolveGcsCredentialsPath(configured: string) {
  const normalized = configured.replace(/\\/g, "/");
  if (existsSync(configured)) return configured;

  const basename = path.basename(normalized);
  const mount = process.env.AGENT_STARTER_MOUNT?.trim();
  if (mount) {
    const mounted = path.join(mount, basename);
    if (existsSync(mounted)) return mounted;
  }

  const inCompose = path.join(composeProjectDir(), "agent-starter-python", basename);
  if (existsSync(inCompose)) return inCompose;

  return configured;
}

export function loadGcsCredentials(): GcsCredentials | null {
  const inline = env("GCS_CREDENTIALS_JSON");
  const configured = env("GCS_CREDENTIALS_PATH") ?? env("GOOGLE_APPLICATION_CREDENTIALS");
  let raw = inline;
  if (!raw && configured) {
    const resolved = resolveGcsCredentialsPath(configured);
    try {
      if (!existsSync(resolved)) return null;
      raw = readFileSync(resolved, "utf8");
    } catch {
      return null;
    }
  }
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

export type GcsCorsRule = {
  origin?: string[];
  method?: string[];
  responseHeader?: string[];
  maxAgeSeconds?: number;
};

/** The JSON API needs a real OAuth2 token, so exchange a signed JWT assertion for one. */
async function gcsAccessToken(credentials: GcsCredentials, scope: string) {
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value: string) => Buffer.from(value).toString("base64url");
  const unsigned = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(
    JSON.stringify({
      iss: credentials.client_email,
      scope,
      aud: tokenUrl,
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(credentials.private_key, "base64url")}`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Google token exchange returned no access token");
  return body.access_token;
}

export async function fetchBucketCors(bucket: string, credentials: GcsCredentials) {
  const token = await gcsAccessToken(
    credentials,
    "https://www.googleapis.com/auth/devstorage.read_only",
  );
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}?fields=cors`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const body = (await response.json().catch(() => ({}))) as {
    cors?: GcsCorsRule[];
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `${response.status} ${response.statusText}`);
  }
  return body.cors ?? [];
}

export function corsAllowsOrigin(rules: GcsCorsRule[], origin: string) {
  return rules.some(
    (rule) =>
      (rule.origin ?? []).some((allowed) => allowed === origin || allowed === "*") &&
      (rule.method ?? []).some((method) => method.toUpperCase() === "GET"),
  );
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
