import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadKeyStore, substituteKeys } from "./keys-lib.mjs";

export const VPS_COMPOSE_FILES = [
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.vps.yml",
];

export const LIVEKIT_RUNTIME_CONFIG = "config/livekit.runtime.yaml";
export const LIVEKIT_CONFIG_TEMPLATE = "config/livekit.vps.yaml.template";
export const SIP_VPS_CONFIG = "config/sip.vps.yaml";

const CREDENTIAL_KEYS = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GCS_SERVICE_ACCOUNT_JSON",
  "GCS_CREDENTIALS_PATH",
];

export function parseEnvFile(content) {
  const out = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadDotEnv(dashboardRoot) {
  const file = path.join(dashboardRoot, ".env");
  if (!existsSync(file)) return {};
  return parseEnvFile(readFileSync(file, "utf8"));
}

/**
 * `.env` on the VPS uses hostname `postgres`, which only resolves inside Compose.
 * Host-side scripts (livekit:keys --reassign) must hit the published port instead.
 */
export function hostDatabaseUrl(databaseUrl) {
  const raw = (databaseUrl ?? "").trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname === "postgres" || url.hostname.endsWith("-postgres-1")) {
      url.hostname = "127.0.0.1";
      url.port = "5433";
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export function applyHostDatabaseUrl(dashboardRoot) {
  const fromEnv = process.env.DATABASE_URL || loadDotEnv(dashboardRoot).DATABASE_URL;
  const next = hostDatabaseUrl(fromEnv);
  if (next) process.env.DATABASE_URL = next;
  return next;
}

/** This app generates Prisma into src/generated/prisma, not node_modules/@prisma/client. */
export function generatePrismaClient(dashboardRoot) {
  execSync("npx prisma generate", { cwd: dashboardRoot, stdio: "inherit", shell: true });
}

export async function loadPrismaClient(dashboardRoot) {
  const clientPath = path.join(dashboardRoot, "src/generated/prisma/index.js");
  if (!existsSync(clientPath)) generatePrismaClient(dashboardRoot);
  const mod = await import(pathToFileURL(clientPath).href);
  if (!mod.PrismaClient) {
    throw new Error("Prisma client is missing PrismaClient. Run: npx prisma generate");
  }
  return mod.PrismaClient;
}

function looksLikeFilePath(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return false;
  return /\.(json|pem|p12)$/i.test(trimmed);
}

export function resolveCredentialMounts(dashboardRoot, starterDir, env) {
  const mounts = [];
  const next = { ...env };
  const seen = new Map();

  for (const key of CREDENTIAL_KEYS) {
    const raw = next[key]?.trim();
    if (!raw || !looksLikeFilePath(raw)) continue;
    const resolved = path.isAbsolute(raw) ? raw : path.resolve(starterDir, raw);
    if (!existsSync(resolved)) {
      console.warn(`Credential file missing (skip mount): ${resolved}`);
      continue;
    }
    const relHost = path.relative(dashboardRoot, resolved).replace(/\\/g, "/");
    const host = relHost.startsWith("..") ? relHost : `./${relHost}`;
    let container = seen.get(host);
    if (!container) {
      const safe = path.basename(resolved).replace(/[^A-Za-z0-9._-]/g, "_");
      container = `/secrets/${mounts.length}-${safe}`;
      seen.set(host, container);
      mounts.push({ host, container });
    }
    next[key] = container;
  }

  return { env: next, mounts };
}

export function buildAgentComposeOverride(entrypoint, mounts = []) {
  const defaultEntry = "src/agent.py";
  if (entrypoint === defaultEntry && mounts.length === 0) {
    return "services:\n  agent: {}\n";
  }
  const lines = ["services:", "  agent:"];
  if (entrypoint !== defaultEntry) {
    lines.push(`    command: ["uv", "run", ${JSON.stringify(entrypoint)}, "start"]`);
  }
  if (mounts.length > 0) {
    lines.push("    volumes:");
    for (const mount of mounts) {
      lines.push(`      - ${JSON.stringify(`${mount.host}:${mount.container}:ro`)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderLivekitRuntimeConfig(dashboardRoot, publicIp) {
  const templatePath = path.join(dashboardRoot, LIVEKIT_CONFIG_TEMPLATE);
  const outPath = path.join(dashboardRoot, LIVEKIT_RUNTIME_CONFIG);
  if (!existsSync(templatePath)) {
    throw new Error(`Missing ${LIVEKIT_CONFIG_TEMPLATE}`);
  }
  const ip = publicIp.trim();
  if (!ip || ip.includes("REPLACE") || ip.includes("YOUR_")) {
    throw new Error("Set LIVEKIT_PUBLIC_IP in .env (your VPS public IP or hostname).");
  }
  const store = loadKeyStore(dashboardRoot);
  if (!store) {
    throw new Error("No LiveKit keys yet. Run: npm run livekit:keys");
  }
  const rendered = substituteKeys(
    readFileSync(templatePath, "utf8").replaceAll("__LIVEKIT_PUBLIC_IP__", ip),
    store,
  );
  writeFileSync(outPath, rendered, "utf8");
  return outPath;
}

export function ensureVpsEnvExample(dashboardRoot) {
  const envFile = path.join(dashboardRoot, ".env");
  const example = path.join(dashboardRoot, ".env.vps.example");
  if (!existsSync(envFile) && existsSync(example)) {
    writeFileSync(envFile, readFileSync(example, "utf8"), "utf8");
    console.log("Created .env from .env.vps.example — edit LIVEKIT_PUBLIC_IP and secrets.");
  }
}
