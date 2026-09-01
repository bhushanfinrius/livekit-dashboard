import { describe, expect, it } from "vitest";
import { loadGcsCredentials, resolveGcsCredentialsPath } from "@/lib/gcs";

describe("resolveGcsCredentialsPath", () => {
  it("returns configured path when missing (caller checks exists)", () => {
    expect(resolveGcsCredentialsPath("C:/missing/livekit-storage.json")).toBe(
      "C:/missing/livekit-storage.json",
    );
  });
});

describe("loadGcsCredentials", () => {
  it("returns null when path is set but file is missing", () => {
    const prev = process.env.GCS_CREDENTIALS_PATH;
    process.env.GCS_CREDENTIALS_PATH = "C:/definitely/not/a/real/file.json";
    delete process.env.GCS_CREDENTIALS_JSON;
    expect(loadGcsCredentials()).toBeNull();
    if (prev === undefined) delete process.env.GCS_CREDENTIALS_PATH;
    else process.env.GCS_CREDENTIALS_PATH = prev;
  });
});
