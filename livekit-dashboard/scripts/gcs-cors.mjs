#!/usr/bin/env node
/**
 * Apply bucket CORS so the LumiVoice player can fetch signed recording URLs and decode
 * waveform peaks in the browser. Run once per bucket, or after changing origins.
 *
 *   npm run recording:cors            apply the policy
 *   npm run recording:cors -- --show  print the current policy and exit
 *
 * Origins come from RECORDING_CORS_ORIGINS, else AUTH_URL plus localhost:3000.
 */
import {
  accessToken,
  bucketName,
  bucketUrl,
  corsCovers,
  corsOrigins,
  corsPolicy,
  gcsJson,
  loadServiceAccount,
  recordingEnv,
} from "./gcs-lib.mjs";

async function main() {
  const showOnly = process.argv.includes("--show");
  const env = recordingEnv();
  const bucket = bucketName(env);
  const origins = corsOrigins(env);
  const token = await accessToken(loadServiceAccount(env));

  const current = await gcsJson(token, bucketUrl(bucket, "cors"));
  if (showOnly) {
    console.log(`Bucket: ${bucket}`);
    console.log(JSON.stringify(current.cors ?? [], null, 2));
    return;
  }

  if (corsCovers(current.cors, origins)) {
    console.log(`✔ CORS already allows GET from: ${origins.join(", ")}`);
    return;
  }

  const updated = await gcsJson(token, bucketUrl(bucket, "cors"), {
    method: "PATCH",
    body: JSON.stringify({ cors: corsPolicy(origins) }),
  });
  console.log(`✔ Applied CORS to gs://${bucket} for: ${origins.join(", ")}`);
  console.log(JSON.stringify(updated.cors ?? [], null, 2));
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exit(1);
});
