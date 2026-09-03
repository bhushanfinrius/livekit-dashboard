import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Generated secrets live here, never in git. Single source of truth for every config. */
export const KEY_STORE_FILE = "config/livekit.keys.json";
export const DEFAULT_POOL_SIZE = 20;

/**
 * Configs rendered from committed templates. LiveKit reads keys only at startup, so the
 * key map is written in full up front and a project just claims an unused entry.
 */
export const RENDER_TARGETS = [
  { template: "livekit.yaml.template", out: "livekit.yaml" },
  { template: "sip.yaml.template", out: "sip.yaml" },
  { template: "egress.yaml.template", out: "egress.yaml" },
  { template: "config/sip.vps.yaml.template", out: "config/sip.vps.yaml" },
];

export const ENV_SECRET_KEYS = ["AUTH_SECRET", "ENCRYPTION_KEY", "DECK_TRANSCRIPT_SECRET"];

function hex(bytes) {
  return randomBytes(bytes).toString("hex");
}

export function generateKeyPair(prefix = "deck") {
  return { apiKey: `${prefix}_${hex(8)}`, apiSecret: hex(32) };
}

export function generateEnvSecret() {
  return randomBytes(32).toString("base64");
}

function storePath(root) {
  return path.join(root, KEY_STORE_FILE);
}

export function loadKeyStore(root) {
  const file = storePath(root);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!parsed?.infra?.apiKey || !Array.isArray(parsed.pool)) {
    throw new Error(`${KEY_STORE_FILE} is malformed. Delete it and re-run with --force.`);
  }
  return parsed;
}

export function saveKeyStore(root, store) {
  const file = storePath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return file;
}

export function createKeyStore(poolSize = DEFAULT_POOL_SIZE) {
  return {
    createdAt: new Date().toISOString(),
    infra: generateKeyPair("deck_infra"),
    pool: Array.from({ length: poolSize }, () => generateKeyPair()),
  };
}

/** Indented `key: "secret"` lines for the LiveKit `keys:` map, infra first. */
export function keysBlock(store) {
  return [store.infra, ...store.pool]
    .map((pair) => `  ${pair.apiKey}: ${JSON.stringify(pair.apiSecret)}`)
    .join("\n");
}

export function substituteKeys(content, store) {
  return content
    .replaceAll("__LIVEKIT_KEYS__", keysBlock(store))
    .replaceAll("__LIVEKIT_INFRA_API_KEY__", store.infra.apiKey)
    .replaceAll("__LIVEKIT_INFRA_API_SECRET__", store.infra.apiSecret);
}

export function renderConfig(root, target, store, extra = {}) {
  const templatePath = path.join(root, target.template);
  if (!existsSync(templatePath)) {
    throw new Error(`Missing template ${target.template}`);
  }
  let rendered = substituteKeys(readFileSync(templatePath, "utf8"), store);
  for (const [token, value] of Object.entries(extra)) {
    rendered = rendered.replaceAll(token, value);
  }
  const outPath = path.join(root, target.out);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, rendered, "utf8");
  return target.out;
}

export function renderAllConfigs(root, store) {
  return RENDER_TARGETS.map((target) => renderConfig(root, target, store));
}

export function isPlaceholderSecret(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return true;
  return /REPLACE_WITH|replace-before|deck-dev-|deck-vps-|^changeme$/i.test(trimmed);
}

/** Mirrors encryptSecret in src/lib/crypto/secret.ts so the app can read what we write. */
export function encryptSecret(plaintext, encryptionKey) {
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error("ENCRYPTION_KEY must be set to at least 32 characters");
  }
  const asBase64 = Buffer.from(encryptionKey, "base64");
  const key = asBase64.length === 32 ? asBase64 : createHash("sha256").update(encryptionKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `lk1:${Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64")}`;
}

export function upsertEnvLine(content, key, value) {
  const line = `${key}=${JSON.stringify(String(value))}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(content) ? content.replace(re, line) : `${content.replace(/\s*$/, "")}\n${line}\n`;
}
