import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertNoForeignLiveKitPort,
  dockerCompose,
  repoRoot,
} from "@/lib/docker/compose";
import { syncAgentWorkerKeys } from "@/lib/livekit/agent-worker";
import { generateLiveKitKeyPair } from "@/lib/livekit/keys";
import { LOCAL_LIVEKIT } from "@/lib/livekit/local-defaults";
import { verifyLiveKitCredentials } from "@/lib/livekit/service";

const LIVEKIT_YAML = "livekit.yaml";
const SIP_YAML = "sip.yaml";
const READY_ATTEMPTS = 20;
const READY_RETRY_MS = 750;

export type LocalLiveKitKeys = {
  url: string;
  apiKey: string;
  apiSecret: string;
};

function quoteYaml(value: string) {
  return JSON.stringify(value);
}

export function withLiveKitServerKeys(content: string, apiKey: string, apiSecret: string) {
  let next = content.replace(
    /keys:\n(?:[ \t].*\n)*/,
    `keys:\n  # LiveKit 1.13+ requires API secrets >= 32 characters\n  ${apiKey}: ${quoteYaml(apiSecret)}\n`,
  );
  if (!/^keys:/m.test(next)) {
    next += `\nkeys:\n  ${apiKey}: ${quoteYaml(apiSecret)}\n`;
  }
  next = next.replace(/(webhook:\n[ \t]+api_key:\s*)\S+/, `$1${apiKey}`);
  return next;
}

export function withSipKeys(content: string, apiKey: string, apiSecret: string) {
  return content
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

export function readKeysFromLiveKitYaml(content: string): { apiKey: string; apiSecret: string } | null {
  const match = content.match(/^keys:\n(?:[ \t]+#[^\n]*\n)*[ \t]+([^:\s#][^:]*):\s*(.+)$/m);
  if (!match) return null;
  return { apiKey: match[1].trim(), apiSecret: unquoteYaml(match[2]) };
}

export function readLocalLiveKitKeys(): LocalLiveKitKeys {
  const file = path.join(repoRoot(), LIVEKIT_YAML);
  const parsed = readKeysFromLiveKitYaml(readFileSync(file, "utf8"));
  return {
    url: LOCAL_LIVEKIT.url,
    apiKey: parsed?.apiKey ?? LOCAL_LIVEKIT.apiKey,
    apiSecret: parsed?.apiSecret ?? LOCAL_LIVEKIT.apiSecret,
  };
}

function writeLocalKeyFiles(apiKey: string, apiSecret: string) {
  const root = repoRoot();
  const livekitPath = path.join(root, LIVEKIT_YAML);
  const sipPath = path.join(root, SIP_YAML);
  const egressPath = path.join(root, "egress.yaml");
  writeFileSync(
    livekitPath,
    withLiveKitServerKeys(readFileSync(livekitPath, "utf8"), apiKey, apiSecret),
    "utf8",
  );
  writeFileSync(sipPath, withSipKeys(readFileSync(sipPath, "utf8"), apiKey, apiSecret), "utf8");
  writeFileSync(
    egressPath,
    withEgressKeys(readFileSync(egressPath, "utf8"), apiKey, apiSecret),
    "utf8",
  );
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

export async function applyLocalLiveKitKeys(mode: "generate" | "defaults"): Promise<LocalLiveKitKeys> {
  const pair =
    mode === "defaults"
      ? { apiKey: LOCAL_LIVEKIT.apiKey, apiSecret: LOCAL_LIVEKIT.apiSecret }
      : generateLiveKitKeyPair();
  const keys: LocalLiveKitKeys = {
    url: LOCAL_LIVEKIT.url,
    apiKey: pair.apiKey,
    apiSecret: pair.apiSecret,
  };

  assertNoForeignLiveKitPort();
  writeLocalKeyFiles(keys.apiKey, keys.apiSecret);
  dockerCompose("up -d --force-recreate livekit sip egress");
  await waitUntilReady(keys);
  syncAgentWorkerKeys(keys.apiKey, keys.apiSecret);
  return keys;
}
