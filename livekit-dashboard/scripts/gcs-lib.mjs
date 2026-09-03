import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./vps-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DASHBOARD_ROOT = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(DASHBOARD_ROOT, "..");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/devstorage.full_control";

/** .env wins for values the running dashboard uses, process.env for one-off overrides. */
export function recordingEnv() {
  return { ...loadDotEnv(DASHBOARD_ROOT), ...stripEmpty(process.env) };
}

function stripEmpty(source) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

function resolveCredentialsPath(configured) {
  const basename = path.basename(configured.replace(/\\/g, "/"));
  const candidates = [
    configured,
    path.join(DASHBOARD_ROOT, configured),
    path.join(REPO_ROOT, "agent-starter-python", basename),
    path.join(DASHBOARD_ROOT, basename),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function loadServiceAccount(env = recordingEnv()) {
  const inline = env.GCS_CREDENTIALS_JSON;
  const configured =
    env.GCS_CREDENTIALS_PATH ||
    env.GOOGLE_APPLICATION_CREDENTIALS ||
    env.GCS_SERVICE_ACCOUNT_JSON;

  let raw = inline || null;
  if (!raw && configured) {
    const resolved = resolveCredentialsPath(configured);
    if (!resolved) {
      throw new Error(`Service account JSON not found: ${configured}`);
    }
    raw = readFileSync(resolved, "utf8");
  }
  if (!raw) {
    throw new Error("Set GCS_CREDENTIALS_PATH or GCS_CREDENTIALS_JSON in livekit-dashboard/.env");
  }

  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service account JSON is missing client_email / private_key");
  }
  return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") };
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

/** The JSON API needs a real OAuth2 token, so exchange a signed JWT assertion for one. */
export async function accessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify(claims),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(serviceAccount.private_key, "base64url")}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status}): ${body.error_description ?? ""}`);
  }
  return body.access_token;
}

export function bucketName(env = recordingEnv()) {
  const bucket = env.GCS_BUCKET_NAME;
  if (!bucket) throw new Error("Set GCS_BUCKET_NAME in livekit-dashboard/.env");
  return bucket;
}

export async function gcsJson(token, url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.error?.message ?? `${response.status} ${response.statusText}`);
  }
  return body;
}

export function corsOrigins(env = recordingEnv()) {
  const configured = env.RECORDING_CORS_ORIGINS;
  if (configured) {
    return configured.split(/[\s,]+/).filter(Boolean);
  }
  const origins = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
  for (const key of ["AUTH_URL", "NEXTAUTH_URL", "DECK_PUBLIC_URL"]) {
    const value = env[key];
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      /* ignore malformed URLs in .env */
    }
  }
  return [...origins];
}

export function corsPolicy(origins) {
  return [
    {
      origin: origins,
      method: ["GET", "HEAD"],
      // Range is what lets the browser decode waveform peaks without a full download.
      responseHeader: ["Content-Type", "Content-Length", "Content-Range", "Range", "Accept-Ranges"],
      maxAgeSeconds: 3600,
    },
  ];
}

export function corsCovers(existing, origins) {
  const rules = existing ?? [];
  return origins.every((origin) =>
    rules.some(
      (rule) =>
        (rule.origin ?? []).some((allowed) => allowed === origin || allowed === "*") &&
        (rule.method ?? []).some((method) => method.toUpperCase() === "GET"),
    ),
  );
}

export function bucketUrl(bucket, fields) {
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`;
  return fields ? `${base}?fields=${encodeURIComponent(fields)}` : base;
}
