#!/usr/bin/env node
/**
 * Preflight for call recording. Verifies the parts that fail silently today:
 * storage config, bucket writability, waveform CORS, and the egress container.
 *
 *   npm run recording:check
 *
 * Per-project checks that need LiveKit credentials (inbound SIP dispatch rules) live in
 * the dashboard banner on the Egress page, since those credentials are stored encrypted.
 */
import { execFileSync } from "node:child_process";
import {
  accessToken,
  bucketName,
  bucketUrl,
  corsCovers,
  corsOrigins,
  gcsJson,
  loadServiceAccount,
  recordingEnv,
  DASHBOARD_ROOT,
} from "./gcs-lib.mjs";

const results = [];

function record(status, label, detail, fix) {
  results.push({ status, label, detail, fix });
}

async function checkStorage(env) {
  const bucket = bucketName(env);
  const serviceAccount = loadServiceAccount(env);
  record("ok", "Storage config", `gs://${bucket} as ${serviceAccount.client_email}`);
  return { bucket, token: await accessToken(serviceAccount) };
}

async function checkWritable(bucket, token) {
  const object = `recordings/.preflight/${Date.now()}.txt`;
  const uploadUrl =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(object)}`;
  try {
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
      body: "lumivoice recording preflight",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error?.message ?? `${response.status} ${response.statusText}`);
    }
    await fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`,
      { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
    );
    record("ok", "Bucket writable", "Probe object uploaded and removed");
  } catch (error) {
    record(
      "fail",
      "Bucket writable",
      error.message,
      "Grant the service account roles/storage.objectAdmin on the bucket",
    );
  }
}

async function checkCors(bucket, token, env) {
  const origins = corsOrigins(env);
  try {
    const current = await gcsJson(token, bucketUrl(bucket, "cors"));
    if (corsCovers(current.cors, origins)) {
      record("ok", "Waveform CORS", `GET allowed from ${origins.join(", ")}`);
    } else {
      record(
        "warn",
        "Waveform CORS",
        `Bucket does not allow GET from ${origins.join(", ")} — playback works, waveforms will not decode`,
        "npm run recording:cors",
      );
    }
  } catch (error) {
    const denied = /storage\.buckets\.(get|update)|permission/i.test(error.message);
    record(
      "warn",
      "Waveform CORS",
      error.message,
      denied
        ? "Grant the service account roles/storage.admin on the bucket, then npm run recording:cors"
        : "npm run recording:cors -- --show",
    );
  }
}

function checkEgressContainer() {
  try {
    const out = execFileSync(
      "docker",
      ["compose", "ps", "--format", "{{.Service}} {{.State}}"],
      { cwd: DASHBOARD_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const services = new Map(
      out
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2)
        .map(([service, state]) => [service, state]),
    );
    for (const service of ["redis", "egress"]) {
      const state = services.get(service);
      if (state === "running") {
        record("ok", `${service} container`, "running");
      } else {
        record(
          "fail",
          `${service} container`,
          state ? `state=${state}` : "not started",
          "npm run docker:up",
        );
      }
    }
  } catch {
    record("warn", "Docker containers", "Could not run docker compose ps", "Is Docker running?");
  }
}

async function main() {
  const env = recordingEnv();
  let storage;
  try {
    storage = await checkStorage(env);
  } catch (error) {
    record(
      "fail",
      "Storage config",
      error.message,
      "Set GCS_BUCKET_NAME and GCS_CREDENTIALS_PATH in livekit-dashboard/.env",
    );
  }

  if (storage) {
    await checkWritable(storage.bucket, storage.token);
    await checkCors(storage.bucket, storage.token, env);
  }
  checkEgressContainer();

  const icon = { ok: "✔", warn: "!", fail: "✖" };
  console.log("\nRecording readiness\n");
  for (const result of results) {
    console.log(`  ${icon[result.status]} ${result.label}: ${result.detail}`);
    if (result.fix && result.status !== "ok") console.log(`      fix → ${result.fix}`);
  }

  const failed = results.filter((result) => result.status === "fail").length;
  const warned = results.filter((result) => result.status === "warn").length;
  console.log(
    failed
      ? `\n✖ ${failed} blocking issue(s) — calls will not record.\n`
      : warned
        ? `\n! Recording works with ${warned} gap(s).\n`
        : "\n✔ Recording is ready.\n",
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exit(1);
});
