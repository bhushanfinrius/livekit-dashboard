#!/usr/bin/env node
/**
 * One-command VPS install/upgrade from git.
 *
 * From livekit-dashboard/livekit-dashboard:
 *   npm run vps:install          dashboard only
 *   npm run vps:install:agent    dashboard + agent worker
 */
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ROOT, "..");
const withAgent = process.argv.includes("--agent");

function run(cmd, cwd = ROOT) {
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

function main() {
  console.log(`\n→ git pull (${REPO})`);
  run("git pull origin bhushan", REPO);

  console.log("\n→ npm install");
  run("npm install");

  const child = spawn(
    process.execPath,
    ["scripts/vps-setup.mjs", ...(withAgent ? ["--agent"] : [])],
    { cwd: ROOT, stdio: "inherit", env: process.env },
  );
  child.on("exit", (code) => process.exit(code ?? 1));
}

main();
