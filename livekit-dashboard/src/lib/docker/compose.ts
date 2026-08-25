import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const OUR_LIVEKIT = "livekit-dashboard-livekit-1";
export const AGENT_COMPOSE_OVERRIDE = "docker-compose.agent.yml";

type ExecError = Error & { stdout?: Buffer | string; stderr?: Buffer | string };

function composeShell() {
  return process.platform === "win32" ? "cmd.exe" : "/bin/sh";
}

export function repoRoot() {
  return process.cwd();
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

export function dockerCompose(args: string, options?: { timeoutMs?: number }) {
  const overridePath = path.join(repoRoot(), AGENT_COMPOSE_OVERRIDE);
  const files = existsSync(overridePath)
    ? `-f docker-compose.yml -f ${AGENT_COMPOSE_OVERRIDE} `
    : "";
  try {
    return execSync(`docker compose ${files}${args}`, {
      cwd: repoRoot(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: composeShell(),
      timeout: options?.timeoutMs ?? 120_000,
    }).trim();
  } catch (error) {
    throw new Error(errorOutput(error) || "docker compose failed");
  }
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
