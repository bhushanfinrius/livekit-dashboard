#!/usr/bin/env node
/**
 * Generate the LiveKit key pool and render every config from its committed template.
 *
 * LiveKit reads API keys only at startup, so a pool of pairs is written up front and
 * each project claims an unused one. Nothing sensitive is committed: the generated
 * pairs live in config/livekit.keys.json and the rendered YAML files are gitignored.
 *
 *   npm run livekit:keys                 ensure keys exist, render configs (idempotent)
 *   npm run livekit:keys -- --pool 40    set pool size on first generation
 *   npm run livekit:keys -- --pool-add 10   add pool entries (recreate livekit after)
 *   npm run livekit:keys -- --reassign   move projects off retired keys onto free pairs
 *   npm run livekit:keys -- --force      regenerate everything (invalidates all keys)
 *   npm run livekit:keys -- --show       print the pool and which pairs are in use
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createKeyStore,
  DEFAULT_POOL_SIZE,
  encryptSecret,
  ENV_SECRET_KEYS,
  generateEnvSecret,
  generateKeyPair,
  isPlaceholderSecret,
  KEY_STORE_FILE,
  loadKeyStore,
  renderAllConfigs,
  saveKeyStore,
  upsertEnvLine,
} from "./keys-lib.mjs";
import { loadDotEnv, parseEnvFile } from "./vps-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function flagValue(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function withPrisma(run) {
  const env = loadDotEnv(ROOT);
  if (!process.env.DATABASE_URL && env.DATABASE_URL) {
    process.env.DATABASE_URL = env.DATABASE_URL;
  }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    return await run(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** null when the database cannot be reached, so callers can stay conservative. */
async function tryWithPrisma(run) {
  try {
    return await withPrisma(run);
  } catch {
    return null;
  }
}

async function ensureEnvSecrets() {
  const envFile = path.join(ROOT, ".env");
  if (!existsSync(envFile)) {
    console.log("  .env not found — skipping secret generation");
    return;
  }
  let content = readFileSync(envFile, "utf8");
  const current = parseEnvFile(content);
  const stale = ENV_SECRET_KEYS.filter((key) => isPlaceholderSecret(current[key]));
  if (stale.length === 0) {
    console.log("  .env secrets already set");
    return;
  }

  // Replacing ENCRYPTION_KEY makes every stored project secret undecryptable.
  const projects = stale.includes("ENCRYPTION_KEY")
    ? await tryWithPrisma((prisma) => prisma.project.count())
    : 0;
  const generated = [];
  for (const key of stale) {
    if (key === "ENCRYPTION_KEY" && projects !== null && projects > 0) {
      console.warn(
        `  ! ENCRYPTION_KEY is still a placeholder but ${projects} project(s) exist.\n` +
          "    Leaving it alone: rotating it would make stored LiveKit secrets undecryptable.",
      );
      continue;
    }
    content = upsertEnvLine(content, key, generateEnvSecret());
    generated.push(key);
  }
  if (generated.length > 0) {
    writeFileSync(envFile, content, "utf8");
    console.log(`  generated .env secrets: ${generated.join(", ")}`);
    if (generated.includes("DECK_TRANSCRIPT_SECRET")) {
      console.log(
        "  copy DECK_TRANSCRIPT_SECRET into the agent's .env.local or transcripts will be rejected",
      );
    }
  }
}

async function assignedApiKeys(prisma) {
  const [primaries, issued] = await Promise.all([
    prisma.project.findMany({ select: { livekitApiKey: true } }),
    prisma.projectApiKey.findMany({ select: { apiKey: true } }).catch(() => []),
  ]);
  return new Set([
    ...primaries.map((row) => row.livekitApiKey),
    ...issued.map((row) => row.apiKey),
  ]);
}

async function show(store) {
  const used = await tryWithPrisma(assignedApiKeys);
  console.log(`\nInfra pair (sip / egress / webhook): ${store.infra.apiKey}`);
  console.log(`Pool of ${store.pool.length} project pair(s):\n`);
  for (const pair of store.pool) {
    const state = used === null ? "?" : used.has(pair.apiKey) ? "in use" : "free";
    console.log(`  ${pair.apiKey}  ${state}`);
  }
  if (used === null) {
    console.log("\n  (database unreachable — cannot tell which pairs are assigned)");
  } else {
    const free = store.pool.filter((pair) => !used.has(pair.apiKey)).length;
    console.log(`\n  ${free} free, ${store.pool.length - free} assigned`);
  }
}

/**
 * The deployed agent worker holds one project's credentials in .agent.runtime.env.
 * Reassigning that project's key leaves the worker unable to connect until it is updated.
 */
function syncAgentWorkerEnv(pair) {
  const runtimeEnv = path.join(ROOT, ".agent.runtime.env");
  if (!existsSync(runtimeEnv)) return false;
  let content = readFileSync(runtimeEnv, "utf8");
  content = upsertEnvLine(content, "LIVEKIT_API_KEY", pair.apiKey);
  content = upsertEnvLine(content, "LIVEKIT_API_SECRET", pair.apiSecret);
  writeFileSync(runtimeEnv, content, "utf8");
  return true;
}

/** Projects created before the pool hold the retired shared key, which no longer exists. */
async function reassign(store) {
  const encryptionKey = loadDotEnv(ROOT).ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY;

  await withPrisma(async (prisma) => {
    const projects = await prisma.project.findMany({
      select: { id: true, name: true, livekitApiKey: true },
    });
    const extras = await prisma.projectApiKey.findMany({
      select: { id: true, projectId: true, apiKey: true, name: true },
    }).catch(() => []);
    const valid = new Set(store.pool.map((pair) => pair.apiKey));
    const staleProjects = projects.filter((project) => !valid.has(project.livekitApiKey));
    const staleExtras = extras.filter((row) => !valid.has(row.apiKey));
    if (staleProjects.length === 0 && staleExtras.length === 0) {
      console.log("  every project already holds a pool key — nothing to reassign");
      return;
    }

    const taken = await assignedApiKeys(prisma);
    const free = store.pool.filter((pair) => !taken.has(pair.apiKey));
    const needed = staleProjects.length + staleExtras.length;
    if (free.length < needed) {
      throw new Error(
        `${needed} key(s) need a pair but only ${free.length} pool pair(s) are free.\n` +
          `Run: npm run livekit:keys -- --pool-add ${needed - free.length}`,
      );
    }

    let next = 0;
    for (const project of staleProjects) {
      const pair = free[next++];
      await prisma.project.update({
        where: { id: project.id },
        data: {
          livekitApiKey: pair.apiKey,
          livekitApiSecret: encryptSecret(pair.apiSecret, encryptionKey),
        },
      });
      console.log(`  ${project.name}: ${project.livekitApiKey} -> ${pair.apiKey}`);
    }
    for (const extra of staleExtras) {
      const pair = free[next++];
      await prisma.projectApiKey.update({
        where: { id: extra.id },
        data: {
          apiKey: pair.apiKey,
          apiSecret: encryptSecret(pair.apiSecret, encryptionKey),
        },
      });
      console.log(`  ${extra.name}: ${extra.apiKey} -> ${pair.apiKey}`);
    }
    console.log(`\n  reassigned ${needed} key(s)`);

    if (staleProjects.length > 0 && syncAgentWorkerEnv(free[0])) {
      console.log(
        `  synced .agent.runtime.env to ${free[0].apiKey}\n` +
          "  apply with: docker compose --profile agent up -d --force-recreate --no-deps agent",
      );
    }
  });
}

async function main() {
  const force = flag("force");
  const poolAdd = flagValue("pool-add");
  let store = force ? null : loadKeyStore(ROOT);
  let mutated = false;

  if (!store) {
    const size = flagValue("pool", DEFAULT_POOL_SIZE);
    store = createKeyStore(size);
    saveKeyStore(ROOT, store);
    mutated = true;
    console.log(`Created ${KEY_STORE_FILE} with 1 infra pair + ${size} project pair(s)`);
  } else {
    console.log(`Using existing ${KEY_STORE_FILE} (pool of ${store.pool.length})`);
  }

  if (poolAdd) {
    for (let i = 0; i < poolAdd; i += 1) store.pool.push(generateKeyPair());
    saveKeyStore(ROOT, store);
    mutated = true;
    console.log(`Added ${poolAdd} pair(s) — pool is now ${store.pool.length}`);
  }

  if (flag("show")) {
    await show(store);
    return;
  }

  const rendered = renderAllConfigs(ROOT, store);
  console.log(`Rendered: ${rendered.join(", ")}`);

  await ensureEnvSecrets();

  if (flag("reassign")) {
    await reassign(store);
    mutated = true;
  }

  if (mutated) {
    console.log(
      "\nLiveKit reads keys only at startup. Apply with:\n" +
        "  docker compose up -d --force-recreate livekit sip egress\n",
    );
  }
}

main().catch((error) => {
  console.error(`\nx ${error.message}\n`);
  process.exit(1);
});
