import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const OUR_LIVEKIT = "livekit-dashboard-livekit-1";
export const AGENT_COMPOSE_OVERRIDE = "docker-compose.agent.yml";
/** Relative to the compose project dir (livekit-dashboard/). Works from deck at /compose. */
export const COMPOSE_AGENT_BUILD_CONTEXT = "./agent-starter-python";

/** Build context path passed to `docker compose` (must not be an absolute Windows path in deck). */
export function agentBuildContextForCompose() {
  if (process.env.DECK_IN_COMPOSE === "1" || process.env.COMPOSE_PROJECT_DIR?.trim()) {
    return COMPOSE_AGENT_BUILD_CONTEXT;
  }
  const configured = process.env.AGENT_BUILD_CONTEXT?.trim();
  return configured || COMPOSE_AGENT_BUILD_CONTEXT;
}

type ExecError = Error & { stdout?: Buffer | string; stderr?: Buffer | string };

function composeShell() {
  return process.platform === "win32" ? "cmd.exe" : "/bin/sh";
}

/** Host compose project dir; `/compose` when LumiVoice runs in the deck container. */
export function composeProjectDir() {
  const fromEnv = process.env.COMPOSE_PROJECT_DIR?.trim();
  return fromEnv || process.cwd();
}

export function repoRoot() {
  return composeProjectDir();
}

function assertDockerCli() {
  try {
    execSync("docker version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: composeShell(),
      timeout: 10_000,
    });
  } catch (error) {
    if (process.env.DECK_IN_COMPOSE === "1") {
      throw new Error(
        "Agent Deploy from Docker LumiVoice needs the Docker CLI and socket on the deck service. Rebuild with the latest docker-compose.yml (`docker compose up -d --build deck`) or run `npm run dev` on the host and deploy from there.",
      );
    }
    throw new Error(errorOutput(error) || "docker CLI is not available");
  }
}

function errorOutput(error: unknown) {
  if (error && typeof error === "object") {
    const exec = error as ExecError;
    const stderr = exec.stderr != null ? String(exec.stderr) : "";
    const stdout = exec.stdout != null ? String(exec.stdout) : "";
    const combined = `${stderr}\n${stdout}`.trim();
    if (combined) return combined;
  }
  return error instanceof Error ? error.message : "docker compose failed";
}

const AGENT_PROFILE = "--profile agent";

export function dockerCompose(args: string, options?: { timeoutMs?: number }) {
  assertDockerCli();
  const projectDir = composeProjectDir();
  const overridePath = path.join(projectDir, AGENT_COMPOSE_OVERRIDE);
  const files = existsSync(overridePath)
    ? `-f docker-compose.yml -f ${AGENT_COMPOSE_OVERRIDE} `
    : "";
  try {
    const projectName = process.env.COMPOSE_PROJECT_NAME?.trim();
    const projectFlag = projectName ? `-p ${projectName} ` : "";
    return execSync(`docker compose ${projectFlag}${files}${args}`, {
      cwd: projectDir,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_BUILD_CONTEXT: agentBuildContextForCompose(),
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: composeShell(),
      timeout: options?.timeoutMs ?? 120_000,
    }).trim();
  } catch (error) {
    throw new Error(errorOutput(error) || "docker compose failed");
  }
}

export function agentCompose(args: string, options?: { timeoutMs?: number }) {
  return dockerCompose(`${AGENT_PROFILE} ${args}`, options);
}

export function occupying7880() {
  try {
    return execSync('docker ps --filter publish=7880 --format "{{.Names}}"', {
      encoding: "utf8",
      shell: composeShell(),
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function assertNoForeignLiveKitPort() {
  const others = occupying7880().filter((name) => name !== OUR_LIVEKIT);
  if (others.length > 0) {
    throw new Error(
      `Port 7880 is owned by ${others.join(", ")}. Stop that container so this repo's LiveKit can run.`,
    );
  }
}

export function assertThisRepoLiveKitIsUp() {
  assertNoForeignLiveKitPort();
  if (!occupying7880().includes(OUR_LIVEKIT)) {
    throw new Error(
      "This repo's LiveKit is not running on port 7880. Start it with `npm run docker:up` first.",
    );
  }
}
