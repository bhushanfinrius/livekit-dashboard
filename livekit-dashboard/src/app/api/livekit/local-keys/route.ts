import { auth } from "@/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { applyLocalLiveKitKeys, readLocalLiveKitKeys } from "@/lib/livekit/apply-local-keys";
import { liveKitErrorMessage } from "@/lib/livekit/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  try {
    return jsonOk(readLocalLiveKitKeys());
  } catch {
    return jsonError("Could not read livekit.yaml", 500, "CONFIG");
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  let mode: "generate" | "defaults" = "generate";
  try {
    const body = (await request.json()) as { mode?: string };
    if (body.mode === "defaults") mode = "defaults";
  } catch {
    mode = "generate";
  }

  try {
    const keys = await applyLocalLiveKitKeys(mode);
    return jsonOk({
      ...keys,
      applied: true,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : liveKitErrorMessage(error),
      400,
      "LIVEKIT",
    );
  }
}
