#!/usr/bin/env node
/**
 * Deploy the Python agent to a remote LumiVoice VPS (self-hosted "lk agent deploy").
 *
 * Config: copy .deploy.env.example → .deploy.env in this folder.
 *
 * Examples:
 *   npm run agent:deploy:remote -- --name CTF-Agent --entrypoint src/agent.py --push
 *   npm run agent:deploy:remote -- CTF-Agent src/agent3.py --push
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(DASHBOARD_ROOT, "..");
const DEFAULT_ENTRYPOINT = "src/agent.py";

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
  const options = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name" || arg === "-n") {
      options.name = argv[++i];
      continue;
    }
    if (arg === "--entrypoint" || arg === "-e" || arg === "--file" || arg === "-f") {
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

function requireConfig(env, key) {
  const value = env[key]?.trim();
  if (!value) {
    console.error(`Missing ${key} in .deploy.env (see .deploy.env.example)`);
    process.exit(1);
  }
  return value;
}

function normalizeEntrypoint(value) {
  const raw = (value?.trim() || DEFAULT_ENTRYPOINT).replace(/\\/g, "/");
  if (!raw || path.isAbsolute(raw) || raw.split("/").includes("..")) {
    console.error("Entrypoint must be a relative path like src/agent.py");
    process.exit(1);
  }
  return raw;
}

function resolveAgentConfig(env, cliOptions, { required = false } = {}) {
  const agentName = (cliOptions.name ?? env.LV_AGENT_NAME)?.trim();
  const entrypoint = normalizeEntrypoint(cliOptions.entrypoint ?? env.LV_AGENT_ENTRYPOINT);

  if (required && !agentName) {
    console.error(
      "Agent name is required. Pass --name my-agent or set LV_AGENT_NAME in .deploy.env",
    );
    process.exit(1);
  }

  return {
    agentName: agentName || "my-agent",
    entrypoint,
  };
}

function composeFilesFlag(env, { includeAgentOverride = true } = {}) {
  const parts = [];
  const extra = env.LV_COMPOSE_EXTRA?.trim();
  if (extra) {
    parts.push(...extra.split(/\s+/).filter(Boolean));
  } else {
    parts.push("-f", "docker-compose.yml");
  }
  if (includeAgentOverride) {
    parts.push("-f", "docker-compose.agent.yml");
  }
  return `${parts.join(" ")} `;
}

function remoteConfigureAgentBlock(agentName, entrypoint) {
  return `
RUNTIME=".agent.runtime.env"
STARTER="../agent-starter-python/.env.local"
AGENT_NAME=${shellQuote(agentName)}
AGENT_ENTRYPOINT=${shellQuote(entrypoint)}

if [ ! -f "$RUNTIME" ]; then
  if [ -f "$STARTER" ]; then
    cp "$STARTER" "$RUNTIME"
  else
    touch "$RUNTIME"
  fi
fi

update_env() {
  local key="$1" val="$2" file="$3"
  if grep -q "^\${key}=" "$file" 2>/dev/null; then
    sed -i "s|^\${key}=.*|\${key}=\${val}|" "$file"
  else
    printf '%s=%s\\n' "$key" "$val" >> "$file"
  fi
}

update_env LIVEKIT_URL ws://livekit:7880 "$RUNTIME"
update_env AGENT_NAME "$AGENT_NAME" "$RUNTIME"
update_env AGENT_ENTRYPOINT "$AGENT_ENTRYPOINT" "$RUNTIME"

if [ "$AGENT_ENTRYPOINT" != "${DEFAULT_ENTRYPOINT}" ]; then
  cat > docker-compose.agent.yml <<EOF
services:
  agent:
    command: ["uv", "run", "$AGENT_ENTRYPOINT", "start"]
EOF
else
  printf '%s\\n' 'services:' '  agent: {}' > docker-compose.agent.yml
fi
`;
}

function remoteScript(env, mode, agentConfig) {
  const root = requireConfig(env, "LV_DEPLOY_ROOT");
  const branch = env.LV_DEPLOY_BRANCH?.trim() || "main";
  const dashboard = `${root}/livekit-dashboard`;
  const composeFiles = composeFilesFlag(env);
  const { agentName, entrypoint } = agentConfig;

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
${remoteConfigureAgentBlock(agentName, entrypoint)}
echo "==> Building and starting agent (name=${agentName}, entrypoint=${entrypoint})"
docker compose ${composeFiles}--profile agent up -d ${buildFlag} --force-recreate --no-deps agent
echo "==> Agent container"
docker compose ${composeFiles}--profile agent ps agent
echo "==> Recent logs"
docker compose ${composeFiles}--profile agent logs agent --tail 40
echo ""
echo "Watch for: registered worker ... agent_name: ${agentName}"
`;
}

function normalizeSshTarget(raw) {
  let value = raw.trim();
  if (!value) return value;
  if (!value.includes("@")) {
    value = `ubuntu@${value}`;
  }
  const at = value.lastIndexOf("@");
  const user = value.slice(0, at);
  let host = value.slice(at + 1).trim();
  const original = host;
  host = host.replace(/^https?:\/\//i, "");
  host = host.replace(/\/+$/, "");
  if (/^[^[\]]+:\d+$/.test(host) && !/^\d+\.\d+\.\d+\.\d+:\d+$/.test(host)) {
    // hostname:port — strip port for ssh (keep ip:port as ip only below)
  }
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(host)) {
    host = host.split(":")[0];
  }
  if (original !== host && /https?:\/\//i.test(original)) {
    console.warn(`Normalized LV_DEPLOY_HOST host to ${host} (SSH does not use http://)`);
  }
  return `${user}@${host}`;
}

function sshTarget(env) {
  const raw = requireConfig(env, "LV_DEPLOY_HOST");
  const host = normalizeSshTarget(raw);
  if (/YOUR_VPS_IP|example\.com|changeme/i.test(host)) {
    console.error(
      `LV_DEPLOY_HOST is still a placeholder (${raw}).\n` +
        "Edit livekit-dashboard/.deploy.env and set your real SSH target, e.g.:\n" +
        '  LV_DEPLOY_HOST="root@103.191.209.120"\n' +
        "Test first: ssh root@103.191.209.120",
    );
    process.exit(1);
  }
  if (host.includes("http://") || host.includes("https://")) {
    console.error(
      `Invalid LV_DEPLOY_HOST (${raw}). Use user@IP only, not a URL:\n` +
        '  LV_DEPLOY_HOST="root@103.191.209.120"',
    );
    process.exit(1);
  }
  return host;
}

function sshOptions(env) {
  const parts = [
    "-o BatchMode=yes",
    "-o ConnectTimeout=15",
    "-o StrictHostKeyChecking=accept-new",
  ];
  const identity = env.LV_SSH_IDENTITY_FILE?.trim();
  if (identity) {
    parts.push(`-i ${JSON.stringify(identity.replace(/\\/g, "/"))}`);
  }
  const port = env.LV_SSH_PORT?.trim();
  if (port) parts.push(`-p ${port}`);
  return parts.join(" ");
}

function sshCommand(env, remoteQuoted) {
  const host = sshTarget(env);
  return `ssh ${sshOptions(env)} ${host} ${remoteQuoted}`;
}

function assertSshAccess(env) {
  const host = sshTarget(env);
  try {
    runCapture(sshCommand(env, `"echo ssh-ok"`));
    console.log(`SSH OK → ${host}`);
  } catch {
    console.error(`
Cannot SSH to ${host} (Permission denied).

Remote deploy needs passwordless SSH (npm cannot reliably type your password).

Try these fixes:

  1) Correct Linux user — many VPS use root, not ubuntu:
       LV_DEPLOY_HOST="root@103.191.209.120"

  2) Set up an SSH key on Windows:
       ssh-keygen -t ed25519
       type %USERPROFILE%\\.ssh\\id_ed25519.pub
     Add that public key in your VPS provider panel (SSH Keys),
     or on the server: ~/.ssh/authorized_keys

  3) Optional in .deploy.env:
       LV_SSH_IDENTITY_FILE=C:/Users/YourName/.ssh/id_ed25519

  4) Test manually (must work without password prompt):
       ssh root@103.191.209.120

Until SSH works, deploy locally instead:
       npm run agent:deploy
`);
    process.exit(1);
  }
}

function runRemote(env, mode, agentConfig) {
  const script = remoteScript(env, mode, agentConfig).trim();
  run(sshCommand(env, `"bash -lc ${shellQuote(script)}"`));
}

async function waitForRegistered(env, agentConfig, timeoutMs = 180_000) {
  const root = requireConfig(env, "LV_DEPLOY_ROOT");
  const dashboard = `${root}/livekit-dashboard`;
  const composeFiles = composeFilesFlag(env);
  const { agentName } = agentConfig;
  const started = Date.now();
  console.log(`\nWaiting for registered worker "${agentName}"…`);

  while (Date.now() - started < timeoutMs) {
    let logs = "";
    try {
      logs = runCapture(
        sshCommand(
          env,
          `"bash -lc ${shellQuote(`cd ${shellQuote(dashboard)} && docker compose ${composeFiles}--profile agent logs agent --tail 80 2>/dev/null`)}"`,
        ),
      );
    } catch {
      // container may still be starting
    }
    if (/registered worker/i.test(logs)) {
      if (!agentName || logs.includes(agentName)) {
        console.log("\n✓ Agent registered with LiveKit.");
        const id = logs.match(/"id": "(AW_[^"]+)"/)?.[1];
        if (id) console.log(`  Worker ID: ${id}`);
        console.log(`  Agent name: ${agentName}`);
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
  # Edit LV_DEPLOY_HOST, LV_DEPLOY_ROOT; secrets stay on VPS in agent-starter-python/.env.local

Commands:
  npm run agent:deploy:remote     Build + deploy agent on VPS
  npm run agent:deploy:remote:check   Test SSH to VPS (run this first)
  npm run agent:status:remote     Container status + recent logs
  npm run agent:logs:remote       Stream agent logs

Agent parameters (CLI overrides .deploy.env):
  --name, -n NAME                 AGENT_NAME (required for deploy unless set in .deploy.env)
  --entrypoint, -e, --file PATH   Python entrypoint, e.g. src/agent.py or src/agent3.py

Examples:
  npm run agent:deploy:remote -- --name CTF-Agent --entrypoint src/agent.py --push
  npm run agent:deploy:remote -- sales_bot src/agent3.py --push
  npm run agent:deploy:remote -- --name CTF-Agent --no-push

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
  const { flags, command, options } = parseArgs(process.argv.slice(2));
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

  if (options.name) env.LV_AGENT_NAME = options.name;
  if (options.entrypoint) env.LV_AGENT_ENTRYPOINT = options.entrypoint;

  const agentConfig = resolveAgentConfig(env, options, {
    required: command === "deploy",
  });

  if (command === "deploy") {
    assertSshAccess(env);
    console.log(`Deploying agent "${agentConfig.agentName}" (${agentConfig.entrypoint})`);
    maybeGitPush(env, flags);
    runRemote(env, "deploy", agentConfig);
    if (flags.has("--wait") || env.LV_WAIT === "1" || env.LV_WAIT?.toLowerCase() === "true") {
      await waitForRegistered(env, agentConfig);
    }
    return;
  }

  if (command === "check") {
    assertSshAccess(env);
    return;
  }

  if (command === "status") {
    runRemote(env, "status", agentConfig);
    return;
  }

  if (command === "logs") {
    runRemote(env, "logs", agentConfig);
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
