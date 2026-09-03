#!/usr/bin/env node
/**
 * One-command VPS upgrade/start: keys, stack, project reassignment, agent credentials.
 *
 *   npm run docker:vps:up
 *   npm run docker:vps:up:agent
 *
 * Host scripts rewrite DATABASE_URL `postgres` → 127.0.0.1:5433 so --reassign works
 * outside the container. ENCRYPTION_KEY is never rotated when projects exist.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  applyHostDatabaseUrl,
  ensureVpsEnvExample,
  generatePrismaClient,
  loadDotEnv,
  loadPrismaClient,
  renderLivekitRuntimeConfig,
  rewriteAgentTranscriptEnv,
  syncAgentCredentialMounts,
  vpsComposeFiles,
} from "./vps-lib.mjs";
import { upsertEnvLine } from "./keys-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const withAgent = process.argv.includes("--agent");

function composeCmd() {
  return `docker compose ${vpsComposeFiles(ROOT).join(" ")}`;
}

function run(cmd, opts = {}) {
  execSync(cmd, {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...opts.env },
  });
}

function runKeys(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/livekit-keys.mjs", ...args], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`livekit:keys failed (${code})`));
    });
  });
}

function upsertEnv(updates) {
  const envFile = path.join(ROOT, ".env");
  if (!existsSync(envFile) || Object.keys(updates).length === 0) return;
  let content = readFileSync(envFile, "utf8");
  for (const [key, value] of Object.entries(updates)) {
    content = upsertEnvLine(content, key, value);
  }
  writeFileSync(envFile, content, "utf8");
}

async function waitForPostgres() {
  applyHostDatabaseUrl(ROOT);
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      execSync(`${composeCmd()} exec -T postgres pg_isready -U deck`, {
        cwd: ROOT,
        stdio: "ignore",
        shell: true,
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const PrismaClient = await loadPrismaClient(ROOT);
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } finally {
    await prisma.$disconnect();
  }
}

function agentRunning() {
  try {
    const names = execSync(`${composeCmd()} ps --format "{{.Name}}"`, {
      cwd: ROOT,
      encoding: "utf8",
      shell: true,
    });
    return /agent/i.test(names);
  } catch {
    return false;
  }
}

async function main() {
  ensureVpsEnvExample(ROOT);
  const env = loadDotEnv(ROOT);
  const publicIp = env.LIVEKIT_PUBLIC_IP?.trim();
  if (!publicIp || /REPLACE_WITH|YOUR_/.test(publicIp)) {
    throw new Error("Set LIVEKIT_PUBLIC_IP in .env to this VPS public IP or hostname.");
  }
  if (!env.AUTH_URL?.trim() || /REPLACE_WITH/.test(env.AUTH_URL)) {
    throw new Error("Set AUTH_URL in .env to the URL this dashboard is served from.");
  }

  const sipUpdates = {};
  if (!env.SIP_PUBLIC_HOST?.trim()) sipUpdates.SIP_PUBLIC_HOST = publicIp;
  if (!env.SIP_PUBLIC_PORT?.trim()) sipUpdates.SIP_PUBLIC_PORT = "5060";
  upsertEnv(sipUpdates);

  console.log("\n→ 1/6  Prisma client + LiveKit key pool");
  generatePrismaClient(ROOT);
  await runKeys();

  const sipConfig = path.join(ROOT, "config", "sip.vps.yaml");
  if (!existsSync(sipConfig)) {
    throw new Error(`Missing ${sipConfig} — npm run livekit:keys should have rendered it.`);
  }
  const livekitRuntime = renderLivekitRuntimeConfig(ROOT, publicIp);
  console.log(`  LiveKit VPS config → ${livekitRuntime}`);

  console.log("\n→ 2/6  Postgres (so host scripts can reassign keys)");
  run(`${composeCmd()} up -d postgres redis`);
  await waitForPostgres();
  console.log(`  database ${process.env.DATABASE_URL}`);

  if (withAgent || agentRunning()) {
    console.log("\n→ 2b/6  Vertex/GCS credential mounts");
    syncAgentCredentialMounts(ROOT);
    await rewriteAgentTranscriptEnv(ROOT);
  }

  console.log("\n→ 3/6  Rebuild stack");
  const services = withAgent
    ? "postgres redis livekit sip egress deck agent"
    : "postgres redis livekit sip egress deck";
  const profile = withAgent ? " --profile agent" : "";
  run(`${composeCmd()}${profile} up -d --build --force-recreate ${services}`);

  console.log("\n→ 4/6  Move existing projects onto the key pool");
  await runKeys(["--reassign"]);
  await runKeys(["--show"]);

  if (withAgent || agentRunning()) {
    console.log("\n→ 5/6  Remount credentials and recreate agent");
    syncAgentCredentialMounts(ROOT);
    await rewriteAgentTranscriptEnv(ROOT);
    run(`${composeCmd()} --profile agent up -d --force-recreate --no-deps agent`);
  } else {
    console.log("\n→ 5/6  No agent container — skip. Later: npm run vps:install:agent");
  }

  console.log(`
VPS is up.

  UI:      ${env.AUTH_URL}
  LiveKit: ws://${publicIp}:7880
  SIP:     sip:${sipUpdates.SIP_PUBLIC_HOST || env.SIP_PUBLIC_HOST || publicIp}

Talk a project, then check Settings for Project ID / URL / SIP URI.
`);
}

main().catch((error) => {
  console.error(`\nx ${error.message}\n`);
  process.exit(1);
});
