import { execSync } from "node:child_process";

function run(command) {
  execSync(command, { stdio: "inherit", shell: true });
}

function occupying7880() {
  try {
    return execSync(
      'docker ps --filter publish=7880 --format "{{.Names}}"',
      { encoding: "utf8", shell: true },
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

run("docker compose up -d postgres redis");

const holders = occupying7880().filter((name) => name !== "livekit-dashboard-livekit-1");

if (holders.length > 0) {
  console.warn(`
Port 7880 is already in use by: ${holders.join(", ")}
Skipping this project's LiveKit + SIP containers so npm run dev can start.
Deck will talk to the LiveKit already listening on http://127.0.0.1:7880.

To run THIS repo's LiveKit instead:
  docker stop ${holders.join(" ")}
  docker compose up -d livekit sip egress
`);
  process.exit(0);
}

run("docker compose up -d livekit sip egress");
// Never start `deck` here — `npm run dev` already binds host :3000.
