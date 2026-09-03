#!/usr/bin/env node
/**
 * Copy DECK_TRANSCRIPT_SECRET from livekit-dashboard/.env and point
 * DECK_TRANSCRIPT_URL at the project that owns the agent's LIVEKIT_API_KEY
 * (or DECK_PROJECT_ID). Writes .agent.runtime.env — recreate the agent after.
 *
 *   npm run vps:sync-transcripts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  applyDeckTranscriptEnv,
  encodeEnvFile,
  parseEnvFile,
  agentStarterDir,
} from "./vps-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const runtimePath = path.join(ROOT, ".agent.runtime.env");
  let env = existsSync(runtimePath) ? parseEnvFile(readFileSync(runtimePath, "utf8")) : {};
  if (!env.LIVEKIT_API_KEY) {
    const starterEnv = path.join(agentStarterDir(ROOT), ".env.local");
    if (existsSync(starterEnv)) {
      env = { ...parseEnvFile(readFileSync(starterEnv, "utf8")), ...env };
    }
  }

  const next = await applyDeckTranscriptEnv(ROOT, env);
  writeFileSync(runtimePath, encodeEnvFile(next), "utf8");

  console.log(`Wrote ${runtimePath}`);
  console.log(`DECK_TRANSCRIPT_URL=${next.DECK_TRANSCRIPT_URL || "(empty)"}`);
  console.log(`DECK_TRANSCRIPT_SECRET=${next.DECK_TRANSCRIPT_SECRET ? "set" : "MISSING"}`);
  console.log("Recreate the worker so it picks up the env:");
  console.log("  npm run agent:deploy:vps -- --name CTF-Agent --entrypoint src/agent.py");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
