#!/usr/bin/env node
/**
 * Deploy the Python agent to a remote LumiVoice VPS (self-hosted "lk agent deploy").
 *
 * Config: copy .deploy.env.example → .deploy.env in this folder.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(DASHBOARD_ROOT, "..");

function loadDeployEnv() {
  const file = path.join(DASHBOARD_ROOT, ".deploy.env");
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(command, options = {}) {
  execSync(command, { stdio: "inherit", shell: true, ...options });
}

function runCapture(command) {
  return execSync(command, { encoding: "utf8", shell: true }).trim();
}

function parseArgs(argv) {
  const flags = new Set();
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg);
    else positional.push(arg);
  }
  return { flags, command: positional[0] ?? "deploy" };
}

function requireConfig(env, key) {
  const value = env[key]?.trim();
  if (!value) {
    console.error(`Missing ${key} in .deploy.env (see .deploy.env.example)`);
    process.exit(1);
  }
  return value;
}

function composeFilesFlag(env) {
  const extra = env.LV_COMPOSE_EXTRA?.trim();
  return extra ? `${extra} ` : "";
}

function remoteScript(env, mode) {
  const root = requireConfig(env, "LV_DEPLOY_ROOT");
  const branch = env.LV_DEPLOY_BRANCH?.trim() || "main";
  const dashboard = `${root}/livekit-dashboard`;
  const composeFiles = composeFilesFlag(env);
  const agentName = env.LV_AGENT_NAME?.trim() || "my-agent";
  const entrypoint = env.LV_AGENT_ENTRYPOINT?.trim() || "src/agent.py";

  if (mode === "status") {
    return `
set -e
cd ${shellQuote(dashboard)}
docker compose ${composeFiles}--profile agent ps agent
docker compose ${composeFiles}--profile agent logs agent --tail 25 2>/dev/null | tail -25 || true
`;
  }

  if (mode === "logs") {
    return `
set -e
cd ${shellQuote(dashboard)}
docker compose ${composeFiles}--profile agent logs agent --tail 120 -f
`;
  }

  const buildFlag = env._NO_BUILD ? "--no-build" : "--build";
  return `
set -e
cd ${shellQuote(root)}
if [ -d .git ]; then
  git fetch origin ${shellQuote(branch)} 2>/dev/null || git fetch origin
  git checkout ${shellQuote(branch)} 2>/dev/null || true
  git pull origin ${shellQuote(branch)}
fi
cd ${shellQuote(dashboard)}
echo "==> Building and starting agent (${shellQuote(agentName)}, ${shellQuote(entrypoint)})"
docker compose ${composeFiles}--profile agent up -d ${buildFlag} --force-recreate --no-deps agent
echo "==> Agent container"
docker compose ${composeFiles}--profile agent ps agent
echo "==> Recent logs"
docker compose ${composeFiles}--profile agent logs agent --tail 40
echo ""
echo "Watch for: registered worker ... agent_name: ${agentName}"
`;
}

function sshTarget(env) {
  return requireConfig(env, "LV_DEPLOY_HOST");
}

function runRemote(env, mode) {
  const host = sshTarget(env);
  const script = remoteScript(env, mode).trim();
  const command = `ssh ${host} "bash -lc ${shellQuote(script)}"`;
  if (mode === "logs") {
    run(command);
    return;
  }
  run(command);
}

async function waitForRegistered(env, timeoutMs = 180_000) {
  const host = sshTarget(env);
  const root = requireConfig(env, "LV_DEPLOY_ROOT");
  const dashboard = `${root}/livekit-dashboard`;
  const composeFiles = composeFilesFlag(env);
  const agentName = env.LV_AGENT_NAME?.trim() || "";
  const started = Date.now();
  console.log("\nWaiting for registered worker…");

  while (Date.now() - started < timeoutMs) {
    let logs = "";
    try {
      logs = runCapture(
        `ssh ${host} "bash -lc ${shellQuote(`cd ${shellQuote(dashboard)} && docker compose ${composeFiles}--profile agent logs agent --tail 80 2>/dev/null`)}"`,
      );
    } catch {
      // container may still be starting
    }
    if (/registered worker/i.test(logs)) {
      if (!agentName || logs.includes(agentName)) {
        console.log("\n✓ Agent registered with LiveKit.");
        const id = logs.match(/"id": "(AW_[^"]+)"/)?.[1];
        if (id) console.log(`  Worker ID: ${id}`);
        return true;
      }
    }
    if (/IndentationError|ModuleNotFoundError|SyntaxError/i.test(logs)) {
      console.error("\n✗ Agent crashed during startup. Fix errors in agent code and redeploy.");
      return false;
    }
    await sleep(4000);
  }
  console.warn("\n⚠ Timed out waiting for registration. Check logs: npm run agent:logs:remote");
  return false;
}

function maybeGitPush(env, flags) {
  const wantPush =
    flags.has("--push") ||
    env.LV_GIT_PUSH === "1" ||
    env.LV_GIT_PUSH?.toLowerCase() === "true";
  if (flags.has("--no-push") || !wantPush) return;

  if (!existsSync(path.join(REPO_ROOT, ".git"))) {
    console.warn("Skipping git push: no .git at repo root.");
    return;
  }

  const branch = env.LV_DEPLOY_BRANCH?.trim() || runCapture("git rev-parse --abbrev-ref HEAD");
  console.log(`\n==> git push origin ${branch}`);
  run(`git -C ${JSON.stringify(REPO_ROOT)} push origin ${branch}`);
}

function printHelp() {
  console.log(`
LumiVoice remote agent deploy (self-hosted alternative to "lk agent deploy")

Setup (once):
  cp .deploy.env.example .deploy.env
  # Edit LV_DEPLOY_HOST, LV_DEPLOY_ROOT, secrets on the VPS (.env.local)

Commands:
  npm run agent:deploy:remote     Build + deploy agent on VPS
  npm run agent:status:remote     Container status + recent logs
  npm run agent:logs:remote       Stream agent logs

Flags:
  --push        git push before deploy (also when LV_GIT_PUSH=1 in .deploy.env)
  --no-push     skip git push
  --no-build    recreate container without rebuild
  --wait        wait until logs show "registered worker"
  --help

Local (same machine):
  npm run agent:deploy
`);
}

async function main() {
  const { flags, command } = parseArgs(process.argv.slice(2));
  if (flags.has("--help") || command === "help") {
    printHelp();
    return;
  }

  const file = path.join(DASHBOARD_ROOT, ".deploy.env");
  if (!existsSync(file) && command !== "help") {
    console.error(`Create ${file} from .deploy.env.example first.`);
    process.exit(1);
  }

  const env = loadDeployEnv();
  if (flags.has("--no-build")) env._NO_BUILD = "1";

  if (command === "deploy") {
    maybeGitPush(env, flags);
    runRemote(env, "deploy");
    if (flags.has("--wait") || env.LV_WAIT === "1" || env.LV_WAIT?.toLowerCase() === "true") {
      await waitForRegistered(env);
    }
    return;
  }

  if (command === "status") {
    runRemote(env, "status");
    return;
  }

  if (command === "logs") {
    runRemote(env, "logs");
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
