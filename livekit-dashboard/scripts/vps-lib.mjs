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
  // Already rewritten to a container path by a previous deploy.
  if (trimmed.startsWith("/secrets/")) return false;
  return /\.(json|pem|p12)$/i.test(trimmed);
}

export function encodeEnvFile(values) {
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
      .join("\n") + "\n"
  );
}

export const AGENT_ROOM_PREFIXES = ["test-", "camp-", "deck-call-", "deck-console-"];

/**
 * Point the agent at LumiVoice over the Compose network and register campaign
 * room prefixes so LiveKit webhooks attribute to the project that owns the API key.
 */
export async function applyDeckTranscriptEnv(dashboardRoot, env) {
  const next = { ...env };
  const dash = loadDotEnv(dashboardRoot);
  const secret = dash.DECK_TRANSCRIPT_SECRET?.trim();
  if (secret) next.DECK_TRANSCRIPT_SECRET = secret;

  const forcedId = dash.DECK_PROJECT_ID?.trim();
  const apiKey = next.LIVEKIT_API_KEY?.trim();
  if (!apiKey && !forcedId) {
    console.warn("No LIVEKIT_API_KEY or DECK_PROJECT_ID — cannot set DECK_TRANSCRIPT_URL");
    return next;
  }

  applyHostDatabaseUrl(dashboardRoot);
  const PrismaClient = await loadPrismaClient(dashboardRoot);
  const prisma = new PrismaClient();
  try {
    let project = forcedId
      ? await prisma.project.findUnique({ where: { id: forcedId }, select: { id: true } })
      : null;
    if (forcedId && !project) {
      console.warn(`DECK_PROJECT_ID=${forcedId} was not found in the database`);
    }
    if (!project && apiKey) {
      project = await prisma.project.findFirst({
        where: {
          OR: [{ livekitApiKey: apiKey }, { apiKeys: { some: { apiKey } } }],
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
    }
    if (!project) {
      console.warn(
        "No LumiVoice project owns this LIVEKIT_API_KEY — transcripts will not ingest.",
      );
      return next;
    }

    next.DECK_TRANSCRIPT_URL = `http://deck:3000/api/projects/${project.id}/sessions/transcripts`;
    for (const prefix of AGENT_ROOM_PREFIXES) {
      await prisma.projectRoomPrefix.upsert({
        where: { projectId_prefix: { projectId: project.id, prefix } },
        update: {},
        create: { projectId: project.id, prefix },
      });
    }
    console.log(`  LumiVoice transcripts → ${next.DECK_TRANSCRIPT_URL}`);
    return next;
  } finally {
    await prisma.$disconnect();
  }
}

export async function rewriteAgentTranscriptEnv(dashboardRoot) {
  const runtimePath = path.join(dashboardRoot, ".agent.runtime.env");
  if (!existsSync(runtimePath)) return null;
  const env = parseEnvFile(readFileSync(runtimePath, "utf8"));
  const next = await applyDeckTranscriptEnv(dashboardRoot, env);
  writeFileSync(runtimePath, encodeEnvFile(next), "utf8");
  return next;
}

export function agentStarterDir(dashboardRoot) {
  const fromEnv =
    process.env.AGENT_BUILD_CONTEXT?.trim() ||
    loadDotEnv(dashboardRoot).AGENT_BUILD_CONTEXT?.trim();
  const raw = fromEnv || "../agent-starter-python";
  return path.isAbsolute(raw) ? raw : path.resolve(dashboardRoot, raw);
}

export function vpsComposeFiles(dashboardRoot) {
  const files = [...VPS_COMPOSE_FILES];
  if (existsSync(path.join(dashboardRoot, "docker-compose.agent.yml"))) {
    files.push("-f", "docker-compose.agent.yml");
  }
  return files;
}

/**
 * Remap Vertex/GCS JSON files from the starter checkout onto /secrets/N-name.json
 * and write docker-compose.agent.yml so `vps:install:agent` does not drop mounts.
 * Host paths come from agent-starter-python/.env.local, not from already-rewritten
 * .agent.runtime.env container paths.
 */
export function syncAgentCredentialMounts(dashboardRoot) {
  const starter = agentStarterDir(dashboardRoot);
  const envLocal = path.join(starter, ".env.local");
  const runtimePath = path.join(dashboardRoot, ".agent.runtime.env");
  const overridePath = path.join(dashboardRoot, "docker-compose.agent.yml");

  if (!existsSync(envLocal)) {
    console.warn(
      `Missing ${envLocal} — Vertex/GCS JSON files will not be mounted.\n` +
        "  Put livekit-storage.json in agent-starter-python/ and set\n" +
        "  GCS_SERVICE_ACCOUNT_JSON=livekit-storage.json (Vertex + GCS share this file).",
    );
    return { mounts: [], starter };
  }

  const starterEnv = parseEnvFile(readFileSync(envLocal, "utf8"));
  if (!starterEnv.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    starterEnv.GOOGLE_APPLICATION_CREDENTIALS = "livekit-storage.json";
  }
  if (!starterEnv.GCS_SERVICE_ACCOUNT_JSON?.trim()) {
    starterEnv.GCS_SERVICE_ACCOUNT_JSON = "livekit-storage.json";
  }

  const { env: credEnv, mounts } = resolveCredentialMounts(
    dashboardRoot,
    starter,
    starterEnv,
  );

  if (existsSync(runtimePath)) {
    const runtime = parseEnvFile(readFileSync(runtimePath, "utf8"));
    for (const key of CREDENTIAL_KEYS) {
      if (credEnv[key]) runtime[key] = credEnv[key];
    }
    writeFileSync(runtimePath, encodeEnvFile(runtime), "utf8");
  }

  const entrypoint =
    (existsSync(runtimePath)
      ? parseEnvFile(readFileSync(runtimePath, "utf8")).AGENT_ENTRYPOINT
      : starterEnv.AGENT_ENTRYPOINT)?.trim() || "src/agent.py";
  writeFileSync(overridePath, buildAgentComposeOverride(entrypoint, mounts), "utf8");

  if (mounts.length === 0) {
    console.warn(
      "No Vertex/GCS credential file found to mount. Expected on the VPS:\n" +
        `  ${path.join(starter, "livekit-storage.json")}`,
    );
  } else {
    console.log(
      `  Credential mounts: ${mounts.map((m) => `${m.host} → ${m.container}`).join(", ")}`,
    );
  }

  return { mounts, starter };
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
