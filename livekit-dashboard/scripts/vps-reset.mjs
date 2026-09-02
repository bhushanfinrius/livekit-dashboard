#!/usr/bin/env node
/**
 * VPS cleanup + credential alignment for LumiVoice.
 *
 *   npm run vps:reset
 *   node scripts/vps-reset.mjs --fix --keep-project cmtietcvd0005pa01xfofznl2 --yes
 *   npm run vps:reset:hard
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import {
  LIVEKIT_CONFIG_TEMPLATE,
  loadDotEnv,
  renderLivekitRuntimeConfig,
  VPS_COMPOSE_FILES,
} from "./vps-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPOSE = `docker compose ${VPS_COMPOSE_FILES.join(" ")}`;
const LOCAL_LIVEKIT_URL = "http://127.0.0.1:7880";
const CUID_RE = /^c[a-z0-9]{20,}$/i;

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: ROOT,
    stdio: opts.inherit ? "inherit" : "pipe",
    shell: true,
    encoding: "utf8",
  });
}

function assertCuid(id, label) {
  if (!CUID_RE.test(id)) {
    throw new Error(`Invalid ${label}: ${id}`);
  }
}

function psql(sql) {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  return sh(
    `${COMPOSE} exec -T postgres psql -U deck -d deck -v ON_ERROR_STOP=1 -t -A -F'|' -c ${JSON.stringify(oneLine)}`,
  );
}

function readYamlKeys() {
  const template = path.join(ROOT, LIVEKIT_CONFIG_TEMPLATE);
  const text = readFileSync(template, "utf8");
  const block = text.match(/^keys:\n(?:\s+.+\n)+/m)?.[0] ?? "";
  const entry = block.match(/^\s{2}(\S+):\s+"([^"]+)"/m);
  if (!entry) {
    throw new Error(`Could not parse LiveKit keys from ${LIVEKIT_CONFIG_TEMPLATE}`);
  }
  return { apiKey: entry[1], apiSecret: entry[2] };
}

function upsertEnvLine(content, key, value) {
  const line = `${key}=${JSON.stringify(String(value))}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(content) ? content.replace(re, line) : `${content.replace(/\s*$/, "")}\n${line}\n`;
}

function patchEnvFile(filePath, updates) {
  let content = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  for (const [key, value] of Object.entries(updates)) {
    content = upsertEnvLine(content, key, value);
  }
  writeFileSync(filePath, content, "utf8");
}

function publicLivekitWsUrl(authUrl, publicIp) {
  const trimmed = authUrl?.trim();
  if (trimmed) {
    try {
      const url = new URL(trimmed);
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        url.protocol = "wss:";
        if (url.port === "3000") url.port = "7880";
        if (url.port === "443") url.port = "";
        return url.toString().replace(/\/$/, "");
      }
    } catch {
      // fall through
    }
  }
  return `wss://${publicIp}:7880`;
}

async function confirm(message, autoYes) {
  if (autoYes) return true;
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`${message} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function starterDir() {
  const env = loadDotEnv(ROOT);
  const raw = env.AGENT_BUILD_CONTEXT?.trim() || "../agent-starter-python";
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
}

function pickKeepProject(explicit) {
  if (explicit) {
    assertCuid(explicit, "project id");
    return explicit;
  }
  const rows = psql(
    'SELECT p.id, COUNT(w.id) AS n FROM "Project" p LEFT JOIN "WebhookEvent" w ON w."projectId" = p.id GROUP BY p.id, p."createdAt" ORDER BY n DESC, p."createdAt" ASC',
  ).trim();
  if (!rows) throw new Error("No projects in database — sign up in the UI first, or run --hard reset.");
  const keepId = rows.split("\n")[0].split("|")[0];
  assertCuid(keepId, "project id");
  return keepId;
}

function fixProjects(keepId, keys, publicLivekitUrl) {
  console.log(`\n→ Keeping project: ${keepId}`);

  const others = psql(`SELECT id FROM "Project" WHERE id <> '${keepId}';`).trim();
  if (others) {
    for (const id of others.split("\n").filter(Boolean)) {
      assertCuid(id, "project id");
      console.log(`  Deleting duplicate project ${id} (webhook rows cascade)`);
      psql(`DELETE FROM "Project" WHERE id = '${id}';`);
    }
  }

  psql(
    `UPDATE "Project" SET "livekitUrl" = '${LOCAL_LIVEKIT_URL}', "livekitApiKey" = '${keys.apiKey}', "publicLivekitUrl" = '${publicLivekitUrl.replace(/'/g, "''")}' WHERE id = '${keepId}'`,
  );

  console.log(`  livekitUrl → ${LOCAL_LIVEKIT_URL}`);
  console.log(`  publicLivekitUrl → ${publicLivekitUrl}`);
  console.log("  API secret auto-syncs from livekit.yaml on the next webhook");
}

function patchAgentEnv(keepId, deckEnv, keys) {
  const starter = starterDir();
  const envLocal = path.join(starter, ".env.local");
  if (!existsSync(envLocal)) {
    console.warn(`\n⚠ Missing ${envLocal} — create it, then run npm run agent:deploy:vps`);
    return;
  }

  const transcriptSecret =
    deckEnv.DECK_TRANSCRIPT_SECRET?.trim() || "deck-dev-transcript-secret-32chars!!";

  patchEnvFile(envLocal, {
    LIVEKIT_URL: "ws://livekit:7880",
    LIVEKIT_API_KEY: keys.apiKey,
    LIVEKIT_API_SECRET: keys.apiSecret,
    DECK_TRANSCRIPT_URL: `http://deck:3000/api/projects/${keepId}/sessions/transcripts`,
    DECK_TRANSCRIPT_SECRET: transcriptSecret,
    SKIP_CREDIT_CHECK: "1",
    GOOGLE_CLOUD_LOCATION: "us-central1",
    AGENT_NAME: deckEnv.AGENT_NAME?.trim() || "mahindra_scraping",
  });

  console.log(`\n→ Patched ${envLocal}`);
  for (const file of ["solvoxai.json", "livekit-storage.json"]) {
    const filePath = path.join(starter, file);
    console.log(existsSync(filePath) ? `  ✓ ${file}` : `  ✗ MISSING ${file} — upload before agent deploy`);
  }
}

function patchDeckEnv() {
  const envFile = path.join(ROOT, ".env");
  if (!existsSync(envFile)) {
    const example = path.join(ROOT, ".env.vps.example");
    if (!existsSync(example)) {
      throw new Error("Missing .env — copy .env.vps.example first");
    }
    writeFileSync(envFile, readFileSync(example, "utf8"), "utf8");
    console.log("Created .env from .env.vps.example");
  }

  const env = loadDotEnv(ROOT);
  const updates = {};
  if (!env.LIVEKIT_PUBLIC_IP?.trim()) updates.LIVEKIT_PUBLIC_IP = "103.191.209.120";
  if (!env.AUTH_URL?.trim()) updates.AUTH_URL = "https://lumivoice.solvox.ai";
  if (!env.DECK_TRANSCRIPT_SECRET?.trim()) {
    updates.DECK_TRANSCRIPT_SECRET = "deck-vps-transcript-secret-32chars!!";
  }

  if (Object.keys(updates).length > 0) {
    let content = readFileSync(envFile, "utf8");
    for (const [key, value] of Object.entries(updates)) {
      content = upsertEnvLine(content, key, value);
    }
    writeFileSync(envFile, content, "utf8");
    console.log("\n→ Updated .env:", Object.keys(updates).join(", "));
  }

  const content = readFileSync(envFile, "utf8");
  if (/REPLACE_WITH/i.test(content)) {
    console.warn("\n⚠ .env still has REPLACE_WITH placeholders for AUTH_SECRET / ENCRYPTION_KEY.");
    console.warn("  Set them once: openssl rand -base64 32");
    console.warn("  Never rotate ENCRYPTION_KEY after projects exist (unless using --hard reset).");
  }

  return loadDotEnv(ROOT);
}

function restartStack() {
  const env = loadDotEnv(ROOT);
  const publicIp = env.LIVEKIT_PUBLIC_IP?.trim();
  if (!publicIp) throw new Error("Set LIVEKIT_PUBLIC_IP in .env");
  renderLivekitRuntimeConfig(ROOT, publicIp);
  console.log("\n→ Restarting stack…");
  sh(`${COMPOSE} up -d --build postgres redis livekit sip egress deck`, { inherit: true });
}

function redeployAgent(agentName, entrypoint) {
  console.log(`\n→ Redeploying agent ${agentName} (${entrypoint})…`);
  sh(
    `node scripts/deploy-agent-vps.mjs deploy --name ${JSON.stringify(agentName)} --entrypoint ${JSON.stringify(entrypoint)} --wait`,
    { inherit: true },
  );
}

function printSummary(keepId, deckEnv) {
  const publicIp = deckEnv.LIVEKIT_PUBLIC_IP?.trim() || "103.191.209.120";
  const base = deckEnv.AUTH_URL?.trim() || `http://${publicIp}:3000`;
  console.log(`
✅ VPS reset complete.

Dashboard project (bookmark this URL):
  ${base.replace(/\/$/, "")}/dashboard/${keepId}

Verify webhook project count:
  docker compose -f docker-compose.yml -f docker-compose.vps.yml exec postgres psql -U deck -d deck -c \\
    'SELECT p.id, p."livekitUrl", COUNT(w.id) FROM "Project" p LEFT JOIN "WebhookEvent" w ON w."projectId"=p.id GROUP BY p.id;'
`);
}

async function runFix(opts) {
  const deckEnv = patchDeckEnv();
  const keys = readYamlKeys();
  const keepId = pickKeepProject(opts.keepProject);
  const publicLivekit = publicLivekitWsUrl(deckEnv.AUTH_URL, deckEnv.LIVEKIT_PUBLIC_IP?.trim() || "103.191.209.120");

  if (!(await confirm(`Delete all projects except ${keepId} and realign creds?`, opts.yes))) {
    console.log("Aborted.");
    return;
  }

  fixProjects(keepId, keys, publicLivekit);
  patchAgentEnv(keepId, deckEnv, keys);
  restartStack();
  redeployAgent(opts.agentName || "mahindra_scraping", opts.entrypoint || "src/agent.py");
  printSummary(keepId, deckEnv);
}

async function runHard(opts) {
  if (!(await confirm("HARD RESET: wipe Postgres volume and ALL users/projects?", opts.yes))) {
    console.log("Aborted.");
    return;
  }

  patchDeckEnv();
  const env = loadDotEnv(ROOT);
  const publicIp = env.LIVEKIT_PUBLIC_IP?.trim() || "103.191.209.120";
  renderLivekitRuntimeConfig(ROOT, publicIp);

  console.log("\n→ Stopping stack and removing volumes…");
  sh(`${COMPOSE} --profile agent down -v`, { inherit: true });

  console.log("\n→ Starting fresh stack (deck runs prisma migrate deploy)…");
  sh(`${COMPOSE} up -d --build postgres redis livekit sip egress deck`, { inherit: true });

  const base = env.AUTH_URL?.trim() || `http://${publicIp}:3000`;
  console.log(`
✅ Hard reset done.

1. Sign up at ${base}
2. Create ONE project only (do not create duplicate demos)
3. Run: npm run vps:reset -- --yes
`);
}

function printHelp() {
  console.log(`
LumiVoice VPS reset (run from livekit-dashboard/)

  npm run vps:reset              Keep best project, delete duplicates, fix creds, restart
  npm run vps:reset:hard         Wipe DB volume — sign up again

Options:
  --fix                 Soft reset (default)
  --hard                Wipe postgres volume
  --yes                 Skip confirmation
  --keep-project ID     Project to keep (default: most webhook events)
  --agent-name NAME     Default: mahindra_scraping
  --entrypoint PATH     Default: src/agent.py
  --help
`);
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  return {
    hard: argv.includes("--hard"),
    yes: argv.includes("--yes"),
    keepProject: argv.find((_, i, a) => a[i - 1] === "--keep-project"),
    agentName: argv.find((_, i, a) => a[i - 1] === "--agent-name"),
    entrypoint: argv.find((_, i, a) => a[i - 1] === "--entrypoint"),
  };
}

async function main() {
  process.chdir(ROOT);
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  console.log("LumiVoice VPS reset —", ROOT);
  if (opts.hard) await runHard(opts);
  else await runFix(opts);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
