import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decryptSecret } from "@/lib/crypto/secret";
import { prisma } from "@/lib/db";
import {
  AGENT_COMPOSE_OVERRIDE,
  assertThisRepoLiveKitIsUp,
  dockerCompose,
  repoRoot,
} from "@/lib/docker/compose";
import { isLocalLiveKitUrl } from "@/lib/livekit/local-defaults";

const RUNTIME_ENV = ".agent.runtime.env";
const DEPLOY_TIMEOUT_MS = 280_000;
const DOCKER_LIVEKIT_URL = "ws://livekit:7880";
const CREDENTIAL_KEYS = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GCS_SERVICE_ACCOUNT_JSON",
  "GCS_CREDENTIALS_PATH",
] as const;

export type AgentWorkerStatus = "stopped" | "running" | "restarting";
export type AgentHealth = "stopped" | "starting" | "registered" | "crash_loop" | "unhealthy";

export type AgentWorkerSnapshot = {
  status: AgentWorkerStatus;
  health: AgentHealth;
  agentName: string | null;
  container: string | null;
  entrypoint: string | null;
  workerId: string | null;
  lastError: string | null;
  backendBaseUrl: string | null;
  backendWebhookUrl: string | null;
  skipCreditCheck: boolean;
};

export type RuntimeEnv = Record<string, string>;

export type CredentialMount = {
  host: string;
  container: string;
};

type ComposePsRow = {
  Name?: string;
  State?: string;
  Service?: string;
};

function runtimePath() {
  return path.join(repoRoot(), RUNTIME_ENV);
}

function starterDir() {
  return (process.env.AGENT_BUILD_CONTEXT ?? "").trim();
}

function starterEnvPath() {
  return path.join(starterDir(), ".env.local");
}

export function encodeEnvFile(values: RuntimeEnv) {
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n"
  );
}

export function parseEnvFile(content: string): RuntimeEnv {
  const out: RuntimeEnv = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    }
    out[key] = value;
  }
  return out;
}

function readRuntimeEnv(): RuntimeEnv {
  if (!existsSync(runtimePath())) return {};
  return parseEnvFile(readFileSync(runtimePath(), "utf8"));
}

function writeRuntimeEnv(values: RuntimeEnv) {
  writeFileSync(runtimePath(), encodeEnvFile(values), "utf8");
}

function patchRuntimeEnv(patch: RuntimeEnv) {
  writeRuntimeEnv({ ...readRuntimeEnv(), ...patch });
}

export function readStarterEnv(dir = starterDir()): RuntimeEnv {
  if (!dir) return {};
  const file = path.join(dir, ".env.local");
  if (!existsSync(file)) return {};
  return parseEnvFile(readFileSync(file, "utf8"));
}

export function mergeAgentRuntimeEnv(input: {
  starterEnv: RuntimeEnv;
  livekitApiKey: string;
  livekitApiSecret: string;
  agentName: string;
  dockerLivekitUrl?: string;
  entrypoint?: string;
  backendBaseUrl?: string;
  backendWebhookUrl?: string;
  skipCreditCheck?: boolean;
  deckTranscriptUrl?: string;
  deckTranscriptSecret?: string;
}): RuntimeEnv {
  const next: RuntimeEnv = {
    ...input.starterEnv,
    LIVEKIT_URL: input.dockerLivekitUrl ?? DOCKER_LIVEKIT_URL,
    LIVEKIT_API_KEY: input.livekitApiKey,
    LIVEKIT_API_SECRET: input.livekitApiSecret,
    AGENT_NAME: input.agentName,
  };
  if (input.entrypoint?.trim()) {
    next.AGENT_ENTRYPOINT = normalizeEntrypoint(input.entrypoint);
  }
  if (input.backendBaseUrl?.trim()) {
    next.BACKEND_BASE_URL = input.backendBaseUrl.trim();
  }
  if (input.backendWebhookUrl?.trim()) {
    next.BACKEND_WEBHOOK_URL = input.backendWebhookUrl.trim();
  }
  if (input.skipCreditCheck !== undefined) {
    next.SKIP_CREDIT_CHECK = input.skipCreditCheck ? "1" : "0";
  }
  if (input.deckTranscriptUrl?.trim()) {
    next.DECK_TRANSCRIPT_URL = input.deckTranscriptUrl.trim();
  }
  if (input.deckTranscriptSecret?.trim()) {
    next.DECK_TRANSCRIPT_SECRET = input.deckTranscriptSecret.trim();
  }
  return next;
}

export function normalizeEntrypoint(value?: string) {
  const raw = (value?.trim() || "src/agent.py").replace(/\\/g, "/");
  if (!raw || path.isAbsolute(raw) || raw.split("/").includes("..")) {
    throw new Error("AGENT_ENTRYPOINT must be a relative path like src/agent.py");
  }
  return raw;
}

function looksLikeFilePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return false;
  if (trimmed.includes("BEGIN ") || trimmed.includes("\\n")) return false;
  return /\.(json|pem|p12)$/i.test(trimmed);
}

export function rewriteCredentialPaths(
  env: RuntimeEnv,
  agentRoot: string,
  exists: (filePath: string) => boolean = existsSync,
): { env: RuntimeEnv; mounts: CredentialMount[] } {
  const next = { ...env };
  const mounts: CredentialMount[] = [];
  const seen = new Map<string, string>();

  for (const key of CREDENTIAL_KEYS) {
    const raw = next[key]?.trim();
    if (!raw || !looksLikeFilePath(raw)) continue;
    const host = path.isAbsolute(raw) ? raw : path.resolve(agentRoot, raw);
    if (!exists(host)) continue;
    let container = seen.get(host);
    if (!container) {
      const safe = path.basename(host).replace(/[^A-Za-z0-9._-]/g, "_");
      container = `/secrets/${mounts.length}-${safe}`;
      seen.set(host, container);
      mounts.push({ host, container });
    }
    next[key] = container;
  }

  return { env: next, mounts };
}

function yamlQuote(value: string) {
  return `"${value.replace(/\\/g, "/").replace(/"/g, '\\"')}"`;
}

export function buildAgentComposeOverride(input: {
  entrypoint: string;
  mounts: CredentialMount[];
}) {
  if (input.entrypoint === "src/agent.py" && input.mounts.length === 0) {
    return "services:\n  agent: {}\n";
  }
  const lines = ["services:", "  agent:"];
  if (input.entrypoint !== "src/agent.py") {
    lines.push(`    command: ["uv", "run", ${yamlQuote(input.entrypoint)}, "start"]`);
  }
  if (input.mounts.length > 0) {
    lines.push("    volumes:");
    for (const mount of input.mounts) {
      lines.push(`      - ${yamlQuote(`${mount.host}:${mount.container}:ro`)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function writeAgentComposeOverride(entrypoint: string, mounts: CredentialMount[]) {
  writeFileSync(
    path.join(repoRoot(), AGENT_COMPOSE_OVERRIDE),
    buildAgentComposeOverride({ entrypoint, mounts }),
    "utf8",
  );
}

function parseComposePs(output: string): ComposePsRow | null {
  const line = output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1);
  if (!line) return null;
  try {
    return JSON.parse(line) as ComposePsRow;
  } catch {
    return null;
  }
}

function mapState(state: string | undefined): AgentWorkerStatus {
  if (state === "running") return "running";
  if (state === "restarting") return "restarting";
  return "stopped";
}

export function parseWorkerId(logs: string) {
  const matches = [...logs.matchAll(/"id": "(AW_[A-Za-z0-9]+)"/g)];
  return matches.at(-1)?.[1] ?? null;
}

const LOG_NOISE =
  /failed to send session event|gemini live does not support|afc is enabled|direct use of automatic function calling|deleting room on agent session close/i;

function stripComposePrefix(line: string) {
  return line.replace(/^[A-Za-z0-9._-]+\s+\|\s+/, "").trim();
}

export function parseLastError(logs: string) {
  const lines = logs
    .split(/\r?\n/)
    .map((line) => stripComposePrefix(line))
    .filter(Boolean);
  const match = [...lines].reverse().find((line) => {
    if (LOG_NOISE.test(line)) return false;
    return /modulenotfounderror|importerror|exception|webhook attempt|http 404|crash|error:/i.test(
      line,
    );
  });
  return match ? match.slice(0, 280) : null;
}

export function parseAgentHealth(input: {
  status: AgentWorkerStatus;
  logs: string;
  workerId?: string | null;
}): { health: AgentHealth; lastError: string | null; workerId: string | null } {
  const workerId = input.workerId ?? parseWorkerId(input.logs);
  const lastError = parseLastError(input.logs);
  if (input.status === "stopped") {
    return { health: "stopped", lastError, workerId };
  }
  if (input.status === "restarting") {
    return {
      health: "crash_loop",
      lastError: lastError ?? "Container is restarting",
      workerId,
    };
  }
  if (workerId || /registered worker/i.test(input.logs)) {
    return { health: "registered", lastError: null, workerId };
  }
  if (lastError) {
    return { health: "unhealthy", lastError, workerId };
  }
  return { health: "starting", lastError, workerId };
}

function truthyEnv(value: string | undefined) {
  return ["1", "true", "yes"].includes((value ?? "").trim().toLowerCase());
}

export function inspectAgentWorker(): AgentWorkerSnapshot {
  let row: ComposePsRow | null = null;
  try {
    row = parseComposePs(dockerCompose("ps --format json agent", { timeoutMs: 20_000 }));
  } catch {
    row = null;
  }
  const env = readRuntimeEnv();
  const deployed = Boolean(env.AGENT_NAME?.trim());
  let logs = "";
  try {
    logs = dockerCompose("logs --no-color --tail 250 agent", { timeoutMs: 20_000 });
  } catch {
    logs = "";
  }
  const status = mapState(row?.State);
  const parsed = parseAgentHealth({ status, logs });
  return {
    status: deployed ? status : "stopped",
    health: deployed ? parsed.health : "stopped",
    agentName: deployed ? env.AGENT_NAME?.trim() || null : null,
    container: deployed ? (row?.Name ?? null) : null,
    entrypoint: env.AGENT_ENTRYPOINT?.trim() || (deployed ? "src/agant.py" : null),
    workerId: deployed ? parsed.workerId : null,
    lastError: deployed ? parsed.lastError : null,
    backendBaseUrl: env.BACKEND_BASE_URL?.trim() || null,
    backendWebhookUrl: env.BACKEND_WEBHOOK_URL?.trim() || null,
    skipCreditCheck: truthyEnv(env.SKIP_CREDIT_CHECK),
  };
}

export function agentWorkerLogs(tail = 250) {
  try {
    return dockerCompose(`logs --no-color --tail ${tail} agent`, { timeoutMs: 20_000 });
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }
}

async function loadProjectCredentials(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      livekitUrl: true,
      livekitApiKey: true,
      livekitApiSecret: true,
    },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  return {
    livekitUrl: project.livekitUrl,
    livekitApiKey: project.livekitApiKey,
    livekitApiSecret: decryptSecret(project.livekitApiSecret),
  };
}

export async function deployAgentWorker(options: {
  projectId: string;
  agentName: string;
  rebuild?: boolean;
  entrypoint?: string;
  backendBaseUrl?: string;
  backendWebhookUrl?: string;
  skipCreditCheck?: boolean;
}) {
  const agentRoot = starterDir();
  if (!agentRoot) {
    throw new Error("Set AGENT_BUILD_CONTEXT in .env to your agent-starter-python directory.");
  }
  if (!existsSync(starterEnvPath())) {
    throw new Error(
      `Create ${starterEnvPath()} with this agent's keys (STT/TTS/LLM or realtime). Deploy copies that whole file.`,
    );
  }

  const credentials = await loadProjectCredentials(options.projectId);
  if (!isLocalLiveKitUrl(credentials.livekitUrl)) {
    throw new Error(
      "Agent deploy only works for this repo's Docker LiveKit (http://127.0.0.1:7880).",
    );
  }
  assertThisRepoLiveKitIsUp();

  const starterEnv = readStarterEnv(agentRoot);
  const merged = mergeAgentRuntimeEnv({
    starterEnv,
    livekitApiKey: credentials.livekitApiKey,
    livekitApiSecret: credentials.livekitApiSecret,
    agentName: options.agentName,
    entrypoint: options.entrypoint,
    backendBaseUrl: options.backendBaseUrl,
    backendWebhookUrl: options.backendWebhookUrl,
    skipCreditCheck: options.skipCreditCheck,
    deckTranscriptUrl: `http://host.docker.internal:3000/api/projects/${options.projectId}/sessions/transcripts`,
    deckTranscriptSecret: process.env.DECK_TRANSCRIPT_SECRET?.trim(),
  });
  const { env, mounts } = rewriteCredentialPaths(merged, agentRoot);
  const entrypoint = normalizeEntrypoint(env.AGENT_ENTRYPOINT);
  env.AGENT_ENTRYPOINT = entrypoint;

  writeRuntimeEnv(env);
  writeAgentComposeOverride(entrypoint, mounts);

  const args =
    options.rebuild === false
      ? "up -d --force-recreate --no-build --no-deps agent"
      : "up -d --build --force-recreate --no-deps agent";

  dockerCompose(args, { timeoutMs: DEPLOY_TIMEOUT_MS });
  return inspectAgentWorker();
}

export function stopAgentWorker() {
  dockerCompose("stop agent", { timeoutMs: 60_000 });
  return inspectAgentWorker();
}

export function purgeAgentWorker() {
  try {
    dockerCompose("rm -sf agent", { timeoutMs: 60_000 });
  } catch {
    try {
      dockerCompose("stop agent", { timeoutMs: 60_000 });
    } catch {
      // Container may already be gone.
    }
  }
  const envFile = runtimePath();
  if (existsSync(envFile)) unlinkSync(envFile);
  writeAgentComposeOverride("src/agent.py", []);
  return inspectAgentWorker();
}

export function syncAgentWorkerKeys(apiKey: string, apiSecret: string) {
  if (!existsSync(runtimePath())) return;
  patchRuntimeEnv({
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
  });
  const { status } = inspectAgentWorker();
  if (status === "running" || status === "restarting") {
    dockerCompose("up -d --force-recreate --no-build --no-deps agent", {
      timeoutMs: 120_000,
    });
  }
}
