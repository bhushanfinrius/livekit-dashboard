#!/usr/bin/env node
/**
 * One-command VPS stack: generates LiveKit config from LIVEKIT_PUBLIC_IP, then starts Compose.
 *
 *   cp .env.vps.example .env
 *   # edit LIVEKIT_PUBLIC_IP, AUTH_SECRET, ENCRYPTION_KEY, AUTH_URL
 * Prefer `npm run docker:vps:up` (scripts/vps-setup.mjs): keys, reassign, agent.
 * This file only starts Compose after keys already exist.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureVpsEnvExample,
  loadDotEnv,
  renderLivekitRuntimeConfig,
  VPS_COMPOSE_FILES,
} from "./vps-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(__dirname, "..");

function run(cmd) {
  execSync(cmd, { cwd: DASHBOARD_ROOT, stdio: "inherit", shell: true });
}

function main() {
  ensureVpsEnvExample(DASHBOARD_ROOT);
  const env = loadDotEnv(DASHBOARD_ROOT);
  const publicIp = env.LIVEKIT_PUBLIC_IP?.trim();
  if (!publicIp) {
    console.error("Set LIVEKIT_PUBLIC_IP in .env (e.g. 103.191.209.120 or lumivoice.solvox.ai)");
    process.exit(1);
  }

  const sipConfig = path.join(DASHBOARD_ROOT, "config", "sip.vps.yaml");
  if (!existsSync(sipConfig)) {
    console.error(`Missing ${sipConfig}`);
    process.exit(1);
  }

  const livekitRuntime = renderLivekitRuntimeConfig(DASHBOARD_ROOT, publicIp);
  console.log(`LiveKit VPS config → ${livekitRuntime} (turn.domain=${publicIp})`);
  console.log(`SIP VPS config   → ${sipConfig} (use_external_ip=true)`);

  const services =
    process.argv.includes("--agent")
      ? "postgres redis livekit sip egress deck agent"
      : "postgres redis livekit sip egress deck";

  const profile = process.argv.includes("--agent") ? " --profile agent" : "";
  run(
    `docker compose ${VPS_COMPOSE_FILES.join(" ")}${profile} up -d --build ${services}`,
  );

  console.log("\nVPS stack is up.");
  console.log(`  UI:      ${env.AUTH_URL || `http://${publicIp}:3000`}`);
  console.log(`  LiveKit: wss://${publicIp}:7880  (UAT / phones)`);
  console.log(`  Agent:   npm run agent:deploy:vps -- --name CTF-Agent --entrypoint src/agent.py`);
}

main();
