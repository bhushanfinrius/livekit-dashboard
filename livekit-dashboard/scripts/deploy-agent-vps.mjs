#!/usr/bin/env node
/**
 * Deploy agent on the VPS itself (no SSH from laptop).
 * Run from livekit-dashboard/ after uploading livekit-dashboard + agent-starter-python.
 *
 *   node scripts/deploy-agent-vps.mjs deploy --name mahindra_scraping --entrypoint src/agent.py
 *   node scripts/deploy-agent-vps.mjs deploy mahindra_scraping src/agent.py
 *   node scripts/deploy-agent-vps.mjs logs
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(__dirname, "..");
const DEFAULT_ENTRYPOINT = "src/agent.py";
const RUNTIME_ENV = ".agent.runtime.env";
const COMPOSE_OVERRIDE = "docker-compose.agent.yml";
const COMPOSE_FILES = [
  "-f",
  "docker-compose.yml",
  "-f",
  "docker-compose.vps.yml",
  "-f",
  COMPOSE_OVERRIDE,
];

function starterDir() {
  const fromEnv = process.env.AGENT_BUILD_CONTEXT?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(DASHBOARD_ROOT, fromEnv);
  }
  return path.resolve(DASHBOARD_ROOT, "../agent-starter-python");
}

function parseEnvFile(content) {
  const out = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    }
    out[key] = value;
  }
  return out;
}

function encodeEnvFile(values) {
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
      .join("\n") + "\n"
  );
}

function normalizeEntrypoint(value) {
  const raw = (value?.trim() || DEFAULT_ENTRYPOINT).replace(/\\/g, "/");
  if (!raw || path.isAbsolute(raw) || raw.split("/").includes("..")) {
    console.error("Entrypoint must be a relative path like src/agent.py");
    process.exit(1);
  }
  return raw;
}

function parseArgs(argv) {
  const flags = new Set();
  const positional = [];
  const options = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name" || arg === "-n") {
      options.name = argv[++i];
      continue;
    }
    if (arg === "--entrypoint" || arg === "-e" || arg === "--file") {
      options.entrypoint = argv[++i];
      continue;
    }
    if (arg.startsWith("--")) {
      flags.add(arg);
      continue;
    }
    positional.push(arg);
  }

  const command = positional[0] ?? "deploy";
  if (!options.name && positional[1]) options.name = positional[1];
  if (!options.entrypoint && positional[2]) options.entrypoint = positional[2];
  return { flags, command, options };
}

function agentBuildContextForCompose(starter) {
  const rel = path.relative(DASHBOARD_ROOT, starter).replace(/\\/g, "/");
  return rel.startsWith("..") ? rel : `./${rel}`;
}

function buildAgentComposeOverride(entrypoint) {
  if (entrypoint === DEFAULT_ENTRYPOINT) {
    return "services:\n  agent: {}\n";
  }
  return `services:
  agent:
    command: ["uv", "run", "${entrypoint.replace(/"/g, '\\"')}", "start"]
`;
}

function resolveBuildContext() {
  const starter = starterDir();
  return { starter, buildContext: agentBuildContextForCompose(starter) };
}

function readExistingRuntime() {
  const file = path.join(DASHBOARD_ROOT, RUNTIME_ENV);
  if (!existsSync(file)) return null;
  return parseEnvFile(readFileSync(file, "utf8"));
}

function ensureComposeOverride(entrypoint) {
  const overridePath = path.join(DASHBOARD_ROOT, COMPOSE_OVERRIDE);
  if (!existsSync(overridePath)) {
    writeFileSync(overridePath, buildAgentComposeOverride(entrypoint), "utf8");
  }
}

function prepareRuntimeEnv(agentName, entrypoint) {
  const starter = starterDir();
  const envLocal = path.join(starter, ".env.local");
  if (!existsSync(envLocal)) {
    console.error(
      `Missing ${envLocal}\n` +
        "Create it on the VPS with LIVEKIT keys, Vertex/Gemini keys, and AGENT_NAME.",
    );
    process.exit(1);
  }

  const merged = {
    ...parseEnvFile(readFileSync(envLocal, "utf8")),
    LIVEKIT_URL: "ws://livekit:7880",
    AGENT_NAME: agentName,
    AGENT_ENTRYPOINT: entrypoint,
  };

  writeFileSync(path.join(DASHBOARD_ROOT, RUNTIME_ENV), encodeEnvFile(merged), "utf8");
  writeFileSync(
    path.join(DASHBOARD_ROOT, COMPOSE_OVERRIDE),
    buildAgentComposeOverride(entrypoint),
    "utf8",
  );

  return { starter, buildContext: agentBuildContextForCompose(starter) };
}

function dockerCompose(args, buildContext) {
  const cmd = `docker compose ${COMPOSE_FILES.join(" ")} --profile agent ${args}`;
  execSync(cmd, {
    cwd: DASHBOARD_ROOT,
    stdio: "inherit",
    env: { ...process.env, AGENT_BUILD_CONTEXT: buildContext },
    shell: true,
  });
}

function dockerComposeCapture(args, buildContext) {
  const cmd = `docker compose ${COMPOSE_FILES.join(" ")} --profile agent ${args}`;
  return execSync(cmd, {
    cwd: DASHBOARD_ROOT,
    encoding: "utf8",
    env: { ...process.env, AGENT_BUILD_CONTEXT: buildContext },
    shell: true,
  }).trim();
}

async function waitForRegistered(agentName, buildContext) {
  console.log(`\nWaiting for registered worker "${agentName}"…`);
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    let logs = "";
    try {
      logs = dockerComposeCapture("logs agent --tail 80", buildContext);
    } catch {
      // container may still be starting
    }
    if (/registered worker/i.test(logs) && logs.includes(agentName)) {
      console.log("\n✓ Agent registered with LiveKit.");
      const id = logs.match(/"id": "(AW_[^"]+)"/)?.[1];
      if (id) console.log(`  Worker ID: ${id}`);
      return;
    }
    if (/IndentationError|ModuleNotFoundError|SyntaxError/i.test(logs)) {
      console.error("\n✗ Agent crashed during startup. Check logs.");
      process.exit(1);
    }
    await sleep(4000);
  }
  console.warn("\n⚠ Timed out. Check: npm run agent:logs:vps");
}

function printHelp() {
  console.log(`
Deploy agent ON this VPS (upload livekit-dashboard + agent-starter-python as siblings).

Layout:
  /your/path/livekit-dashboard/
  /your/path/agent-starter-python/.env.local

Commands (from livekit-dashboard/):
  npm run agent:deploy:vps -- --name mahindra_scraping --entrypoint src/agent.py
  npm run agent:deploy:vps -- mahindra_scraping src/agent.py
  npm run agent:logs:vps
  npm run agent:status:vps
  npm run agent:stop:vps

Or without npm:
  bash scripts/deploy-agent-vps.sh deploy mahindra_scraping src/agent.py

Flags:
  --name, -n          AGENT_NAME (required for deploy)
  --entrypoint, -e    e.g. src/agent.py or src/agent3.py
  --no-build          restart without image rebuild
  --wait              wait for "registered worker"
  --help

Stack (once):
  npm run docker:vps
`);
}

async function main() {
  const { flags, command, options } = parseArgs(process.argv.slice(2));
  if (flags.has("--help") || command === "help") {
    printHelp();
    return;
  }

  const agentName = options.name?.trim();
  const entrypoint = normalizeEntrypoint(options.entrypoint);

  if (command === "deploy") {
    if (!agentName) {
      console.error("Agent name required: --name mahindra_scraping");
      process.exit(1);
    }
    const { starter, buildContext } = prepareRuntimeEnv(agentName, entrypoint);
    console.log(`Starter: ${starter}`);
    console.log(`Deploying "${agentName}" (${entrypoint})…`);
    const buildFlag = flags.has("--no-build") ? "--no-build" : "--build";
    dockerCompose(`up -d ${buildFlag} --force-recreate --no-deps agent`, buildContext);
    dockerCompose("ps agent", buildContext);
    if (flags.has("--wait")) await waitForRegistered(agentName, buildContext);
    return;
  }

  const existing = readExistingRuntime();
  const { buildContext } = resolveBuildContext();
  ensureComposeOverride(
    normalizeEntrypoint(options.entrypoint || existing?.AGENT_ENTRYPOINT),
  );

  if (command === "logs") {
    dockerCompose("logs agent --tail 120 -f", buildContext);
    return;
  }

  if (command === "status") {
    dockerCompose("ps agent", buildContext);
    try {
      console.log(dockerComposeCapture("logs agent --tail 30", buildContext));
    } catch {
      // no logs yet
    }
    return;
  }

  if (command === "stop") {
    dockerCompose("stop agent", buildContext);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
