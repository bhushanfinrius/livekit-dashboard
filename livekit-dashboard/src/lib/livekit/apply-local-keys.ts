import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertNoForeignLiveKitPort,
  dockerCompose,
  repoRoot,
} from "@/lib/docker/compose";
import { syncAgentWorkerKeys } from "@/lib/livekit/agent-worker";
import { generateLiveKitKeyPair } from "@/lib/livekit/keys";
import { deckRunsInCompose, LOCAL_LIVEKIT } from "@/lib/livekit/local-defaults";
import { verifyLiveKitCredentials } from "@/lib/livekit/service";

const LIVEKIT_YAML = "livekit.yaml";
const SIP_YAML = "sip.yaml";
const KEY_STORE_FILE = "config/livekit.keys.json";
const READY_ATTEMPTS = 20;
const READY_RETRY_MS = 750;

export type LiveKitKeyPair = { apiKey: string; apiSecret: string };

export type LocalLiveKitKeys = {
  url: string;
  apiKey: string;
  apiSecret: string;
  canRotate: boolean;
};

/** Both tolerate comment lines between `webhook:` and `api_key:`. */
const WEBHOOK_PREFIX = "webhook:\\n(?:[ \\t]*#[^\\n]*\\n|[ \\t]*\\n)*[ \\t]+api_key:[ \\t]*";
const WEBHOOK_API_KEY_RE = new RegExp(`(${WEBHOOK_PREFIX})\\S+`);
const WEBHOOK_API_KEY_CAPTURE_RE = new RegExp(`${WEBHOOK_PREFIX}(\\S+)`);

function quoteYaml(value: string) {
  return JSON.stringify(value);
}

export function normalizeYamlNewlines(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Rewrite the whole `keys:` map. LiveKit reads keys only at startup, so the map holds
 * one infra pair (which also signs webhooks) plus a pool assigned one pair per project.
 */
export function withLiveKitServerKeys(
  content: string,
  pairs: LiveKitKeyPair[],
  webhookApiKey?: string,
) {
  if (pairs.length === 0) {
    throw new Error("withLiveKitServerKeys needs at least one key pair");
  }
  let next = normalizeYamlNewlines(content);
  const entries = pairs
    .map((pair) => `  ${pair.apiKey}: ${quoteYaml(pair.apiSecret)}`)
    .join("\n");
  const block = `keys:\n  # LiveKit 1.13+ requires API secrets >= 32 characters\n${entries}\n`;
  if (/^keys:/m.test(next)) {
    next = next.replace(/keys:\n(?:[ \t].*\n)*/, block);
  } else {
    next += `\n${block}`;
  }
  const infraKey = webhookApiKey ?? pairs[0].apiKey;
  next = next.replace(WEBHOOK_API_KEY_RE, `$1${infraKey}`);
  return next;
}

export function withSipKeys(content: string, apiKey: string, apiSecret: string) {
  return normalizeYamlNewlines(content)
    .replace(/^api_key:\s*.+$/m, `api_key: ${apiKey}`)
    .replace(/^api_secret:\s*.+$/m, `api_secret: ${quoteYaml(apiSecret)}`);
}

export function withEgressKeys(content: string, apiKey: string, apiSecret: string) {
  return withSipKeys(content, apiKey, apiSecret);
}

function unquoteYaml(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export type LiveKitKeyPool = {
  /** Signs webhooks and backs the sip/egress services. Never handed to a project. */
  infra: LiveKitKeyPair | null;
  /** Assignable pairs, one per project. */
  pool: LiveKitKeyPair[];
};

/**
 * Parse the full `keys:` map. The infra pair carries no marker: it is simply the entry
 * whose key equals `webhook.api_key`. Everything else is assignable.
 */
export function readLiveKitKeyPool(content: string): LiveKitKeyPool {
  const normalized = normalizeYamlNewlines(content);
  const block = normalized.match(/^keys:\n((?:[ \t].*\n?)*)/m);
  const entries: LiveKitKeyPair[] = [];
  for (const line of block?.[1].split("\n") ?? []) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^:\s#]+):\s*(.+)$/);
    if (match) entries.push({ apiKey: match[1], apiSecret: unquoteYaml(match[2]) });
  }

  const webhookKey = normalized.match(WEBHOOK_API_KEY_CAPTURE_RE)?.[1];
  const infra = entries.find((entry) => entry.apiKey === webhookKey) ?? entries[0] ?? null;
  return { infra, pool: entries.filter((entry) => entry.apiKey !== infra?.apiKey) };
}

/** The infra pair: what webhooks are signed with and what sip/egress authenticate as. */
export function readKeysFromLiveKitYaml(content: string): LiveKitKeyPair | null {
  return readLiveKitKeyPool(content).infra;
}

export function canRotateLocalLiveKitKeys() {
  return !deckRunsInCompose();
}

export const NO_LOCAL_KEYS_ERROR =
  "No LiveKit keys found in livekit.yaml. Generate the key pool with `npm run livekit:keys`.";

/** The deck container mounts the live config at /app/livekit.yaml; the VPS overlay remounts it there too. */
function readLocalLiveKitYaml(): string | null {
  const candidates = [
    path.join(repoRoot(), LIVEKIT_YAML),
    path.join(process.cwd(), LIVEKIT_YAML),
  ];
  for (const file of candidates) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      // try next location
    }
  }
  return null;
}

export function readLocalLiveKitKeyPool(): LiveKitKeyPool {
  const content = readLocalLiveKitYaml();
  return content ? readLiveKitKeyPool(content) : { infra: null, pool: [] };
}

export function readLocalLiveKitKeys(): LocalLiveKitKeys {
  const infra = readLocalLiveKitKeyPool().infra;
  if (!infra) throw new Error(NO_LOCAL_KEYS_ERROR);
  return {
    url: LOCAL_LIVEKIT.url,
    apiKey: infra.apiKey,
    apiSecret: infra.apiSecret,
    canRotate: canRotateLocalLiveKitKeys(),
  };
}

/** Rewrites the whole key map, so it must be given every pair LiveKit should accept. */
function writeLocalKeyFiles(pairs: LiveKitKeyPair[], infra: LiveKitKeyPair) {
  const root = repoRoot();
  const livekitPath = path.join(root, LIVEKIT_YAML);
  const sipPath = path.join(root, SIP_YAML);
  const egressPath = path.join(root, "egress.yaml");
  writeFileSync(
    livekitPath,
    withLiveKitServerKeys(readFileSync(livekitPath, "utf8"), pairs, infra.apiKey),
    "utf8",
  );
  // sip and egress authenticate as the infra pair only.
  writeFileSync(
    sipPath,
    withSipKeys(readFileSync(sipPath, "utf8"), infra.apiKey, infra.apiSecret),
    "utf8",
  );
  writeFileSync(
    egressPath,
    withEgressKeys(readFileSync(egressPath, "utf8"), infra.apiKey, infra.apiSecret),
    "utf8",
  );
}

/**
 * `npm run livekit:keys` re-renders livekit.yaml from this store on every `docker:up`,
 * so a rotated pair has to land here too or the next start would drop it.
 */
function updateKeyStorePool(pool: LiveKitKeyPair[]) {
  const file = path.join(repoRoot(), KEY_STORE_FILE);
  try {
    const store = JSON.parse(readFileSync(file, "utf8")) as { pool: LiveKitKeyPair[] };
    store.pool = pool;
    writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  } catch {
    // No store (remote or hand-managed config): livekit.yaml stays the source of truth.
  }
}

async function waitUntilReady(keys: LocalLiveKitKeys) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt += 1) {
    try {
      await verifyLiveKitCredentials({
        livekitUrl: keys.url,
        livekitApiKey: keys.apiKey,
        livekitApiSecret: keys.apiSecret,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < READY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, READY_RETRY_MS));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("LiveKit did not accept the new keys after restart");
}

const COMPOSE_ROTATE_ERROR =
  "Key rotation is not available inside the LumiVoice container. Use the API key already assigned to this project, or run LumiVoice on the host with npm run dev to rotate.";

/**
 * Rotate one project onto a freshly generated pair, keeping the infra pair and the rest
 * of the pool intact. Recreates LiveKit because it only reads keys at startup.
 */
export async function applyLocalLiveKitKeys(
  replacesApiKey?: string,
): Promise<LocalLiveKitKeys> {
  if (!canRotateLocalLiveKitKeys()) {
    throw new Error(COMPOSE_ROTATE_ERROR);
  }

  const { infra, pool } = readLocalLiveKitKeyPool();
  if (!infra) throw new Error(NO_LOCAL_KEYS_ERROR);

  const pair = generateLiveKitKeyPair();
  const keys: LocalLiveKitKeys = {
    url: LOCAL_LIVEKIT.url,
    apiKey: pair.apiKey,
    apiSecret: pair.apiSecret,
    canRotate: true,
  };

  const retained = pool.filter((entry) => entry.apiKey !== replacesApiKey);
  assertNoForeignLiveKitPort();
  writeLocalKeyFiles([infra, ...retained, pair], infra);
  updateKeyStorePool(retained.concat(pair));
  dockerCompose("up -d --force-recreate livekit sip egress");
  await waitUntilReady(keys);
  syncAgentWorkerKeys(keys.apiKey, keys.apiSecret);
  return keys;
}

const COMPOSE_REVOKE_ERROR =
  "Revoking a key needs to rewrite livekit.yaml and restart LiveKit, which is not available inside the LumiVoice container. Delete the key here and run `docker compose up -d --force-recreate livekit sip egress` on the host, or run LumiVoice with npm run dev.";

/**
 * Stop LiveKit accepting a key pair. Deleting the database row alone is not enough: the
 * inline `keys:` map is only read at startup, so the pair keeps authenticating until the
 * server is recreated. A replacement pair is minted so the pool keeps its configured size
 * instead of losing a slot on every revoke.
 *
 * Deliberately does not touch the agent worker: that is only correct when rotating a
 * project's primary pair, and the agent never holds a secondary key.
 */
export async function revokeLocalLiveKitKey(apiKey: string) {
  if (!canRotateLocalLiveKitKeys()) {
    throw new Error(COMPOSE_REVOKE_ERROR);
  }

  const { infra, pool } = readLocalLiveKitKeyPool();
  if (!infra) throw new Error(NO_LOCAL_KEYS_ERROR);
  if (apiKey === infra.apiKey) {
    throw new Error("The infra key signs webhooks and backs sip/egress. It cannot be revoked.");
  }
  if (!pool.some((entry) => entry.apiKey === apiKey)) {
    return { revoked: false as const, reason: "not-in-pool" as const };
  }

  const retained = pool.filter((entry) => entry.apiKey !== apiKey);
  const replacement = generateLiveKitKeyPair();

  assertNoForeignLiveKitPort();
  writeLocalKeyFiles([infra, ...retained, replacement], infra);
  updateKeyStorePool(retained.concat(replacement));
  dockerCompose("up -d --force-recreate livekit sip egress");
  await waitUntilReady({
    url: LOCAL_LIVEKIT.url,
    apiKey: infra.apiKey,
    apiSecret: infra.apiSecret,
    canRotate: true,
  });
  return { revoked: true as const };
}
